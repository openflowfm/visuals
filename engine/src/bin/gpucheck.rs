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
//!
//! Exit codes: 0 when every preset drew (default-shader fall-backs are
//! reported, not failures); 1 when one failed to load or draw or panicked, or
//! on a usage error (bad flag or value, nothing to check); 2 on a timeout.

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

/// A usage error: message, exit code 1.
fn usage(msg: &str) -> ! {
    eprintln!("gpucheck: {msg}");
    std::process::exit(1);
}

/// The value after `flag`: a positive, finite number, or a usage error.
fn positive(args: &mut impl Iterator<Item = String>, flag: &str) -> f64 {
    let Some(s) = args.next() else { usage(&format!("{flag} needs a value")) };
    match s.parse::<f64>() {
        Ok(v) if v.is_finite() && v > 0.0 => v,
        _ => usage(&format!("{flag} takes a positive number, not {s:?}")),
    }
}

/// Like `positive`, but a whole number.
fn count_arg(args: &mut impl Iterator<Item = String>, flag: &str) -> usize {
    let v = positive(args, flag);
    if v.fract() != 0.0 {
        usage(&format!("{flag} takes a whole number, not {v}"));
    }
    v as usize
}

/// Writes the `--failures` file, if one was asked for.
fn write_failures(out: &Option<PathBuf>, lines: &[String]) {
    if let Some(out) = out {
        let mut lines = lines.to_vec();
        lines.sort();
        if let Err(e) = std::fs::write(out, lines.join("\n") + "\n") {
            eprintln!("gpucheck: could not write {}: {e}", out.display());
        }
    }
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
            "--failures" => {
                failures_out = Some(PathBuf::from(args.next().unwrap_or_else(|| usage("--failures needs a file"))))
            }
            "--frames" => frames = count_arg(&mut args, "--frames"),
            "--sample" => count = Some(count_arg(&mut args, "--sample")),
            "--all" => count = None,
            "--timeout" => timeout = positive(&mut args, "--timeout"),
            s if s.starts_with("--") => usage(&format!("unknown flag {s}")),
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
            let before = found.len();
            walk(t, &mut found);
            if found.len() == before {
                usage(&format!("no .milk presets in {}", t.display()));
            }
        } else if t.is_file() {
            files.push(t.clone());
        } else {
            usage(&format!("no such file or folder: {}", t.display()));
        }
    }
    found.sort();
    let pool = found.len();
    files.extend(match count {
        Some(n) => sample(found, n),
        None => found,
    });
    if files.is_empty() {
        usage("no presets to check");
    }
    eprintln!("checking {} presets ({} found in folders), timeout {timeout}s", files.len(), pool);

    let lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let current = Arc::new(Mutex::new(Current { path: None, stage: "starting", since: Instant::now() }));
    {
        let current = current.clone();
        let lines = lines.clone();
        let failures_out = failures_out.clone();
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
                    let mut l = lines.lock().unwrap_or_else(|e| e.into_inner()).clone();
                    l.push(format!("timed out\t{}\tin {}", path.display(), c.stage));
                    write_failures(&failures_out, &l);
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
    let push = |line: String| lines.lock().unwrap_or_else(|e| e.into_inner()).push(line);
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
                push(format!("fell back\t{}\t{}", path.display(), back.join(" | ")));
            }
            Ok(Err(e)) => {
                failed += 1;
                push(format!("failed\t{}\t{e}", path.display()));
            }
            Err(_) => {
                failed += 1;
                push(format!("panicked\t{}", path.display()));
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
    write_failures(&failures_out, &lines.lock().unwrap_or_else(|e| e.into_inner()));
    if failed > 0 {
        std::process::exit(1);
    }
}
