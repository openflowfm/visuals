//! Presets loaded into the renderer and drawn, on the GPU: the check that
//! Metal accepts what the translation produced, not only that naga validated it.
//!
//!   cargo run --release --bin gpucheck -- [files or folders…] [--sample N | --all]
//!       [--timeout S] [--failures out.txt] [--frames N]
//!
//! With no files or folders it takes the pack (~/.openflow/visuals/presets).
//! A folder is sampled: by default DEFAULT_SAMPLE presets, the same ones every
//! run, spread evenly over the sorted paths (so over the pack's folders);
//! `--all` checks every one. Files named directly are always checked.
//!
//! A preset passes when both of its pipelines are built from its own shaders —
//! not MilkDrop's defaults — and it draws without a panic. A preset taking
//! longer than `--timeout` seconds (a stuck Metal compile can't be interrupted)
//! ends the run with exit code 2, naming it and the stage it was in.

use engine::audio::Audio;
use engine::render::{headless, Renderer};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Presets checked by default: about a minute when Metal compiles cold
/// (~4 presets/s); seconds once its shader cache is warm (~65/s).
const DEFAULT_SAMPLE: usize = 250;

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("milk")) {
            out.push(path);
        }
    }
}

/// `n` of `files` (sorted), evenly spaced: deterministic and spread over folders.
fn sample(files: Vec<PathBuf>, n: usize) -> Vec<PathBuf> {
    if n >= files.len() {
        return files;
    }
    (0..n).map(|i| files[i * files.len() / n].clone()).collect()
}

/// What the watchdog sees: which preset, which stage, since when.
struct Current {
    path: Option<PathBuf>,
    stage: &'static str,
    since: Instant,
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut targets = Vec::new();
    let mut failures_out = None;
    let mut frames = 2;
    let mut count = Some(DEFAULT_SAMPLE);
    let mut timeout = 20.0;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--failures" => failures_out = args.next().map(PathBuf::from),
            "--frames" => frames = args.next().and_then(|s| s.parse().ok()).unwrap_or(2),
            "--sample" => count = Some(args.next().and_then(|s| s.parse().ok()).expect("--sample N")),
            "--all" => count = None,
            "--timeout" => timeout = args.next().and_then(|s| s.parse().ok()).expect("--timeout S"),
            _ => targets.push(PathBuf::from(arg)),
        }
    }
    if targets.is_empty() {
        targets.push(PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets"));
    }
    let mut files = Vec::new();
    let mut found = Vec::new();
    for t in &targets {
        if t.is_dir() {
            walk(t, &mut found);
        } else {
            files.push(t.clone());
        }
    }
    found.sort();
    let pool = found.len();
    files.extend(match count {
        Some(n) => sample(found, n),
        None => found,
    });
    eprintln!("checking {} presets ({} found in folders), timeout {timeout}s", files.len(), pool);

    let current = Arc::new(Mutex::new(Current { path: None, stage: "starting", since: Instant::now() }));
    {
        let current = current.clone();
        let limit = Duration::from_secs_f64(timeout);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(250));
            let c = current.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(path) = &c.path {
                if c.since.elapsed() > limit {
                    println!("timed out\t{}\tin {}", path.display(), c.stage);
                    eprintln!(
                        "gpucheck: stopped — {} took over {timeout}s in {} (a stuck Metal compile can't be interrupted)",
                        path.display(),
                        c.stage
                    );
                    std::process::exit(2);
                }
            }
        });
    }
    let set = |path: Option<&PathBuf>, stage: &'static str| {
        let mut c = current.lock().unwrap_or_else(|e| e.into_inner());
        if path.is_some() || stage == "done" {
            c.path = path.cloned();
            c.since = Instant::now();
        }
        c.stage = stage;
    };

    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, 640, 360);
    let mut audio = Audio::default();
    let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.07).sin() * 0.7).collect();
    let (mut ok, mut fell_back, mut failed) = (0, 0, 0);
    let mut lines = Vec::new();
    let started = Instant::now();
    for (i, path) in files.iter().enumerate() {
        set(Some(path), "read");
        let text = engine::preset::decode(&std::fs::read(path).unwrap_or_default());
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Vec<String>, String> {
            set(None, "load (shader compile)");
            let loaded = renderer.load(&text, 1).map_err(|e| e.to_string())?;
            set(None, "draw");
            for _ in 0..frames {
                audio.update(&tone, &tone);
                // Half a step a refresh: every other one feeds back, the rest
                // draw between steps, so both paths meet every preset's shaders.
                renderer.render(&mut audio, 0.5 / engine::runtime::PRESET_RATE);
            }
            Ok(loaded.fell_back.iter().map(|(k, why)| format!("{k:?}: {}", why.lines().next().unwrap_or(""))).collect())
        }));
        set(None, "done");
        match outcome {
            Ok(Ok(back)) if back.is_empty() => ok += 1,
            Ok(Ok(back)) => {
                fell_back += 1;
                lines.push(format!("fell back\t{}\t{}", path.display(), back.join(" | ")));
            }
            Ok(Err(e)) => {
                failed += 1;
                lines.push(format!("failed\t{}\t{e}", path.display()));
            }
            Err(_) => {
                failed += 1;
                lines.push(format!("panicked\t{}", path.display()));
            }
        }
        if (i + 1) % 100 == 0 {
            let secs = started.elapsed().as_secs_f64();
            eprintln!("{}/{} in {secs:.0}s ({:.1} presets/s)", i + 1, files.len(), (i + 1) as f64 / secs);
        }
    }
    let n = files.len().max(1) as f64;
    println!(
        "gpu: {ok} drew with their own shaders ({:.2}%), {fell_back} drew with a default shader, {failed} did not draw — {} presets in {:.1}s",
        100.0 * ok as f64 / n,
        files.len(),
        started.elapsed().as_secs_f64()
    );
    lines.sort();
    if let Some(out) = failures_out {
        std::fs::write(&out, lines.join("\n") + "\n").expect("write failures");
    }
}
