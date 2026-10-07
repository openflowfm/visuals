//! The engine's half of the harness's recorded mode: render presets from a plan
//! the harness writes, and save the frames it asks for as raw RGBA.
//!
//!   cargo run --release -p visuals-engine --bin compare -- <plan.txt>
//!
//! The plan is tab-separated lines, written by `harness/compare.ts`:
//!
//!   size      <w> <h>
//!   frames    <n>                  Butterchurn frames per preset: preset steps
//!   dt        <seconds>            preset time per frame (1/30: one step)
//!   refresh   <hz>                 how many pictures a second ours draws
//!                                  (1/dt by default: one a step); between
//!                                  steps it draws a part of the next one
//!   seed      <u64>                the preset's random seed
//!   audio     <file>               n × 3072 bytes: mono, left, right — 1024 each,
//!                                  Butterchurn's `timeByteArray`, `…L`, `…R`
//!   captures  <frame> …            1-based: the picture after that many frames
//!                                  (at the refresh that lands on it)
//!   preset    <index> <file.milk> <out prefix>
//!
//! Each capture is written to `<out prefix>-<frame>.rgba`, rows top to bottom.
//! Every preset gets a fresh renderer, so its clock, noise and `rand_frame`
//! stream start where Butterchurn's do on a fresh page. On stdout, one line per
//! event: `ok <index> <ms>`, `fallback <index> <kind> <why>`, `fail <index> <why>`.

use engine::audio::{Audio, FFT_SIZE};
use engine::render::{headless, Renderer};
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};

struct Plan {
    width: u32,
    height: u32,
    frames: usize,
    dt: f64,
    refresh: Option<f64>,
    seed: u64,
    audio: Vec<u8>,
    captures: Vec<usize>,
    presets: Vec<(String, String, String)>,
}

fn read_plan(path: &str) -> Result<Plan, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut plan = Plan { width: 640, height: 360, frames: 0, dt: 1.0 / engine::runtime::PRESET_RATE, refresh: None, seed: 1, audio: Vec::new(), captures: Vec::new(), presets: Vec::new() };
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let fields: Vec<&str> = line.split('\t').collect();
        let num = |i: usize| fields.get(i).and_then(|s| s.parse::<f64>().ok()).ok_or(format!("bad line: {line}"));
        match fields[0] {
            "size" => (plan.width, plan.height) = (num(1)? as u32, num(2)? as u32),
            "frames" => plan.frames = num(1)? as usize,
            "dt" => plan.dt = num(1)?,
            "refresh" => plan.refresh = Some(num(1)?).filter(|hz| *hz > 0.0),
            "seed" => plan.seed = fields.get(1).and_then(|s| s.parse().ok()).ok_or(format!("bad line: {line}"))?,
            "audio" => plan.audio = std::fs::read(fields.get(1).ok_or("audio needs a file")?).map_err(|e| format!("read audio: {e}"))?,
            "captures" => plan.captures = fields[1..].iter().filter_map(|s| s.parse().ok()).collect(),
            "preset" if fields.len() == 4 => plan.presets.push((fields[1].into(), fields[2].into(), fields[3].into())),
            _ => return Err(format!("bad line: {line}")),
        }
    }
    if plan.audio.len() < plan.frames * 3 * FFT_SIZE {
        return Err(format!("audio holds {} frames, the plan renders {}", plan.audio.len() / (3 * FFT_SIZE), plan.frames));
    }
    Ok(plan)
}

/// One preset, start to finish. Errors are the reason it could not be drawn.
fn run(plan: &Plan, device: &wgpu::Device, queue: &wgpu::Queue, index: &str, file: &str, prefix: &str) -> Result<(), String> {
    let mut renderer = Renderer::new(device.clone(), queue.clone(), plan.width, plan.height);
    let text = engine::preset::decode(&std::fs::read(file).map_err(|e| format!("read: {e}"))?);
    let loaded = renderer.load(&text, plan.seed).map_err(|e| format!("load: {e}"))?;
    for (kind, why) in &loaded.fell_back {
        println!("fallback\t{index}\t{kind:?}\t{}", why.lines().next().unwrap_or("").replace('\t', " "));
    }
    let mut audio = Audio::default();
    let window = |frame: usize, part: usize| -> [u8; FFT_SIZE] {
        let at = (frame * 3 + part) * FFT_SIZE;
        plan.audio[at..at + FFT_SIZE].try_into().unwrap()
    };
    // Frames per refresh: 1 draws once a step, as Butterchurn does; ½ draws a
    // picture between every two steps.
    let hz = plan.refresh.unwrap_or(1.0 / plan.dt);
    let per = 1.0 / (hz * plan.dt);
    let refreshes = (plan.frames as f64 / per).round() as usize;
    for j in 0..refreshes {
        // A step's equations run at the first refresh after the step before,
        // so that refresh hears the step's own window, as Butterchurn's frame does.
        let frame = (((j as f64) * per + 1e-9).floor() as usize).min(plan.frames - 1);
        audio.update_bytes(&window(frame, 0), &window(frame, 1), &window(frame, 2));
        renderer.render(&mut audio, plan.dt * per);
        let at = (j + 1) as f64 * per;
        let landed = at.round();
        if (at - landed).abs() < 1e-6 && plan.captures.contains(&(landed as usize)) {
            let pixels = renderer.read_back();
            std::fs::write(format!("{prefix}-{}.rgba", landed as usize), pixels).map_err(|e| format!("write: {e}"))?;
        }
    }
    Ok(())
}

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: compare <plan.txt>");
        std::process::exit(2);
    };
    let plan = read_plan(&path).unwrap_or_else(|e| {
        eprintln!("compare: {e}");
        std::process::exit(2);
    });
    let (mut device, mut queue) = headless().expect("a GPU");
    // A preset that panics the renderer must not end the run: report it, and
    // start the next one on a fresh device in case the old one is poisoned.
    std::panic::set_hook(Box::new(|_| {}));
    for (index, file, prefix) in &plan.presets {
        let started = std::time::Instant::now();
        let outcome = catch_unwind(AssertUnwindSafe(|| run(&plan, &device, &queue, index, file, prefix)));
        match outcome {
            Ok(Ok(())) => println!("ok\t{index}\t{:.0}", started.elapsed().as_secs_f64() * 1000.0),
            Ok(Err(why)) => println!("fail\t{index}\t{}", why.replace(['\t', '\n'], " ")),
            Err(panic) => {
                let why = panic
                    .downcast_ref::<String>()
                    .map(String::as_str)
                    .or_else(|| panic.downcast_ref::<&str>().copied())
                    .unwrap_or("panicked");
                println!("fail\t{index}\tthe renderer panicked: {}", why.replace(['\t', '\n'], " "));
                (device, queue) = headless().expect("a GPU");
            }
        }
        std::io::stdout().flush().ok();
    }
}
