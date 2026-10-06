//! Every preset loaded into the renderer and drawn, on the GPU: the check that
//! Metal accepts what the translation produced, not only that naga validated it.
//!
//!   cargo run --release --bin gpucheck -- [folder] [--failures out.txt] [--frames N]
//!
//! A preset passes when both of its pipelines are built from its own shaders —
//! not MilkDrop's defaults — and it draws without a panic.

use engine::audio::Audio;
use engine::render::{headless, Renderer};
use std::path::{Path, PathBuf};

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

fn main() {
    let mut args = std::env::args().skip(1);
    let mut folder = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets");
    let mut failures_out = None;
    let mut frames = 2;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--failures" => failures_out = args.next().map(PathBuf::from),
            "--frames" => frames = args.next().and_then(|s| s.parse().ok()).unwrap_or(2),
            _ => folder = PathBuf::from(arg),
        }
    }
    let mut files = Vec::new();
    walk(&folder, &mut files);
    files.sort();
    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, 640, 360);
    let mut audio = Audio::default();
    let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.07).sin() * 0.7).collect();
    let (mut ok, mut fell_back, mut failed) = (0, 0, 0);
    let mut lines = Vec::new();
    let started = std::time::Instant::now();
    for (i, path) in files.iter().enumerate() {
        let text = engine::preset::decode(&std::fs::read(path).unwrap_or_default());
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Vec<String>, String> {
            let loaded = renderer.load(&text, 1).map_err(|e| e.to_string())?;
            for _ in 0..frames {
                audio.update(&tone, &tone);
                renderer.render(&mut audio, 1.0 / 60.0);
            }
            Ok(loaded.fell_back.iter().map(|(k, why)| format!("{k:?}: {}", why.lines().next().unwrap_or(""))).collect())
        }));
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
        if (i + 1) % 1000 == 0 {
            eprintln!("{}/{} in {:.0}s", i + 1, files.len(), started.elapsed().as_secs_f64());
        }
    }
    let n = files.len().max(1) as f64;
    println!(
        "gpu: {ok} drew with their own shaders ({:.2}%), {fell_back} drew with a default shader, {failed} did not draw — {} presets in {:.0}s",
        100.0 * ok as f64 / n,
        files.len(),
        started.elapsed().as_secs_f64()
    );
    if let Some(out) = failures_out {
        lines.sort();
        std::fs::write(&out, lines.join("\n") + "\n").expect("write failures");
    }
}
