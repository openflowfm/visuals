//! Frames a second at each quality level: a fixed sample of presets drawn
//! headless at each size, every refresh presented at that size.
//!
//!   cargo run --release -p visuals-engine --bin bench -- [presets or folders…]
//!       [--sizes 1920x1080,3840x2160] [--levels low,medium,high] [--sample N]
//!       [--frames N] [--churn N]
//!
//! With no presets it takes the app's starter set. A folder is sampled the same
//! way every run (`--sample`, 24 by default), spread evenly over its sorted paths.
//! Each preset is loaded, drawn for 10 refreshes to warm up, then timed over
//! `--frames` (120) refreshes of 1/60 s each — so every other one feeds back —
//! each presented to a picture the size asked for, drawn as fast as they go
//! with at most two ahead of the GPU, as a window's surface allows. "fps" is
//! refreshes over the time they took, to the last one finished; "cpu ms" the
//! CPU's time a refresh (equations and encoding). Where fps is well under
//! 1000 / cpu ms, the GPU is what limits it.
//!
//! `--churn N` first switches a running renderer between low and high N times
//! at the first size and prints the process's memory footprint (which counts
//! Metal's allocations) before and after: it must not grow with N.
//!
//! Exit 0 when every preset drew, 1 on a usage error or a preset that would not load.

mod common;

use engine::audio::Audio;
use engine::quality::{Level, Machine};
use engine::render::{headless, Renderer};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const WARM_UP: usize = 10;
/// Refreshes at most this many ahead of the GPU.
const IN_FLIGHT: usize = 2;

fn usage(msg: &str) -> ! {
    eprintln!("bench: {msg}");
    std::process::exit(1);
}

fn whole(args: &mut impl Iterator<Item = String>, flag: &str) -> usize {
    let s = args.next().unwrap_or_else(|| usage(&format!("{flag} needs a value")));
    s.parse().ok().filter(|&n| n > 0).unwrap_or_else(|| usage(&format!("{flag} takes a positive whole number, not {s:?}")))
}

/// The process's memory footprint in MB, as `footprint` reads it (Metal's
/// allocations included); `None` where it can't be read.
fn footprint_mb() -> Option<f64> {
    let out = std::process::Command::new("/usr/bin/footprint").args(["-p", &std::process::id().to_string()]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let rest = text.split("Footprint: ").nth(1)?;
    let mut words = rest.split_whitespace();
    let n: f64 = words.next()?.parse().ok()?;
    let unit = match words.next()? {
        "B" => 1.0 / (1024.0 * 1024.0),
        "KB" => 1.0 / 1024.0,
        "MB" => 1.0,
        "GB" => 1024.0,
        _ => return None,
    };
    Some(n * unit)
}

/// The picture a refresh is presented to: the size asked for, as a window's surface would be.
fn output(device: &wgpu::Device, size: (u32, u32)) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("output"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

/// Refreshes drawn one after another, at most [`IN_FLIGHT`] ahead of the GPU.
struct Refreshes<'a> {
    renderer: &'a mut Renderer,
    audio: &'a mut Audio,
    view: &'a wgpu::TextureView,
    size: (u32, u32),
    flight: VecDeque<wgpu::SubmissionIndex>,
    n: usize,
}

impl Refreshes<'_> {
    /// One refresh, presented; returns the CPU's time on it.
    fn next(&mut self) -> Duration {
        // A tone that swells and falls, so presets that follow the audio move.
        let level = 0.4 + 0.4 * ((self.n as f32) * 0.21).sin().abs();
        self.n += 1;
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.07).sin() * level).collect();
        let started = Instant::now();
        self.audio.update(&tone, &tone);
        self.renderer.render(self.audio, 1.0 / 60.0);
        self.renderer.present(self.view, wgpu::TextureFormat::Bgra8Unorm, self.size);
        let cpu = started.elapsed();
        self.flight.push_back(self.renderer.queue().submit([]));
        if self.flight.len() > IN_FLIGHT {
            let index = self.flight.pop_front();
            self.renderer.device().poll(wgpu::PollType::Wait { submission_index: index, timeout: None }).ok();
        }
        cpu
    }

    /// Wait for every refresh drawn so far.
    fn finish(&mut self) {
        self.renderer.device().poll(wgpu::PollType::wait_indefinitely()).ok();
        self.flight.clear();
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut targets = Vec::new();
    let mut sizes = vec![(1920, 1080), (3840, 2160)];
    let mut levels = Level::ALL.to_vec();
    let (mut sample, mut frames, mut churn) = (24, 120, 0);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--sizes" => {
                let s = args.next().unwrap_or_else(|| usage("--sizes needs a value"));
                sizes = s.split(',').map(|s| common::parse_size(s).filter(|&(w, h)| w > 0 && h > 0).unwrap_or_else(|| usage(&format!("not a size: {s:?}")))).collect();
            }
            "--levels" => {
                let s = args.next().unwrap_or_else(|| usage("--levels needs a value"));
                levels = s.split(',').map(|l| l.parse().unwrap_or_else(|e: String| usage(&e))).collect();
            }
            "--sample" => sample = whole(&mut args, "--sample"),
            "--frames" => frames = whole(&mut args, "--frames"),
            "--churn" => churn = whole(&mut args, "--churn"),
            s if s.starts_with("--") => usage(&format!("unknown flag {s}")),
            _ => targets.push(PathBuf::from(arg)),
        }
    }
    if targets.is_empty() {
        targets.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../app/src-tauri/presets/starter")));
    }
    let mut files = Vec::new();
    for t in &targets {
        if t.is_dir() {
            let mut found = engine::preset::milk_files(t);
            found.sort();
            files.extend(engine::index::sample(found, sample));
        } else if t.is_file() {
            files.push(t.clone());
        } else {
            usage(&format!("no such file or folder: {}", t.display()));
        }
    }
    if files.is_empty() {
        usage("no presets to draw");
    }
    let texts: Vec<(PathBuf, String)> = files.iter().map(|p| (p.clone(), engine::preset::decode(&std::fs::read(p).unwrap_or_default()))).collect();

    let machine = Machine::detect();
    let picks: Vec<String> = sizes.iter().map(|&s| format!("{} at {}x{}", engine::quality::auto(&machine, s).name(), s.0, s.1)).collect();
    println!(
        "machine: {} · {} GPU cores · {} GB · auto picks {}",
        machine.chip.as_deref().unwrap_or("unknown chip"),
        machine.gpu_cores.map_or("?".into(), |c| c.to_string()),
        machine.memory_bytes.map_or("?".into(), |m| (m >> 30).to_string()),
        picks.join(", ")
    );
    println!("{} presets, {frames} refreshes each after {WARM_UP} to warm up", texts.len());

    let (device, queue) = headless().unwrap_or_else(|| usage("no GPU"));
    let mut renderer = Renderer::new(device, queue, sizes[0].0, sizes[0].1);
    let mut audio = Audio::default();

    if churn > 0 {
        let size = sizes[0];
        let view = output(renderer.device(), size);
        renderer.load(&texts[0].1, 1).unwrap_or_else(|e| usage(&format!("{}: {e}", texts[0].0.display())));
        let mut drawn = 0;
        let mut draw = |renderer: &mut Renderer, audio: &mut Audio, n: usize| {
            let mut r = Refreshes { renderer, audio, view: &view, size, flight: VecDeque::new(), n: drawn };
            for _ in 0..n {
                r.next();
            }
            r.finish();
            drawn += n;
        };
        draw(&mut renderer, &mut audio, WARM_UP);
        let before = footprint_mb();
        for _ in 0..churn {
            for level in [Level::Low, Level::High] {
                renderer.set_quality(level.quality());
                draw(&mut renderer, &mut audio, 2);
            }
        }
        let after = footprint_mb();
        match (before, after) {
            (Some(b), Some(a)) => println!("churn: {churn}× low and back at {}x{}: footprint {b:.0} MB before, {a:.0} MB after", size.0, size.1),
            _ => println!("churn: {churn}× low and back: footprint unreadable"),
        }
    }

    println!("size       level     fps (all)  median  slowest  cpu ms  slowest preset");
    let mut failed = false;
    for &size in &sizes {
        renderer.resize(size.0, size.1);
        let view = output(renderer.device(), size);
        for &level in &levels {
            renderer.set_quality(level.quality());
            // Per preset: seconds a refresh, and the CPU's.
            let mut per_preset: Vec<(f64, f64, &PathBuf)> = Vec::new();
            for (path, text) in &texts {
                if let Err(e) = renderer.load(text, 1) {
                    eprintln!("bench: {}: {e}", path.display());
                    failed = true;
                    continue;
                }
                let mut r = Refreshes { renderer: &mut renderer, audio: &mut audio, view: &view, size, flight: VecDeque::new(), n: 0 };
                for _ in 0..WARM_UP {
                    r.next();
                }
                r.finish();
                let started = Instant::now();
                let cpu: Duration = (0..frames).map(|_| r.next()).sum();
                r.finish();
                per_preset.push((started.elapsed().as_secs_f64() / frames as f64, cpu.as_secs_f64() / frames as f64, path));
            }
            if per_preset.is_empty() {
                continue;
            }
            let n = per_preset.len() as f64;
            let mean = per_preset.iter().map(|p| p.0).sum::<f64>() / n;
            let cpu = per_preset.iter().map(|p| p.1).sum::<f64>() / n;
            per_preset.sort_by(|a, b| a.0.total_cmp(&b.0));
            let median = per_preset[per_preset.len() / 2].0;
            let (slowest, _, slowest_path) = per_preset[per_preset.len() - 1];
            println!(
                "{:<10} {:<7} {:>11.0} {:>7.0} {:>8.0} {:>7.2}  {}",
                format!("{}x{}", size.0, size.1),
                level.name(),
                1.0 / mean,
                1.0 / median,
                1.0 / slowest,
                cpu * 1000.0,
                slowest_path.file_stem().map_or(String::new(), |s| s.to_string_lossy().into_owned())
            );
        }
    }
    if failed {
        std::process::exit(1);
    }
}
