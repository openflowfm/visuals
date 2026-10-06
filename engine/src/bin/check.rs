//! Every preset in a folder through everything the engine compiles, with a report.
//!
//!   cargo run --release --bin check -- [folder] [--failures out.txt]
//!
//! The folder defaults to the preset library, `~/.openflow/visuals/presets`. A
//! stage counts as compiled when it reaches a validated naga module; a preset with
//! no shader for a stage passes that stage, since MilkDrop draws its default.

use engine::{preset, shader};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("milk")) {
            out.push(path);
        }
    }
}

/// The first line of an error, with names and numbers taken out, so failures group.
fn category(error: &str) -> String {
    let first = error.lines().find(|l| l.contains("ERROR") || !l.trim().is_empty()).unwrap_or("").trim();
    let without_place = regex_lite_strip(first);
    without_place.chars().take(110).collect()
}

fn regex_lite_strip(line: &str) -> String {
    let mut out = String::new();
    let mut quoted = false;
    for c in line.chars() {
        if c == '\'' {
            quoted = !quoted;
            out.push_str(if quoted { "'…" } else { "'" });
            continue;
        }
        if !quoted {
            out.push(if c.is_ascii_digit() { '#' } else { c });
        }
    }
    out
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut folder = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets");
    let mut failures_out: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == "--failures" {
            failures_out = args.next().map(PathBuf::from);
        } else {
            folder = PathBuf::from(arg);
        }
    }
    let mut files = Vec::new();
    walk(&folder, &mut files);
    files.sort();
    eprintln!("check: {} presets in {}", files.len(), folder.display());

    let results = Mutex::new(Vec::<(PathBuf, &'static str, String)>::new());
    let next = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(path) = files.get(i) else { break };
                let Ok(bytes) = std::fs::read(path) else { continue };
                let preset = preset::parse(&preset::decode(&bytes));
                for (kind, label, text) in [
                    (shader::Kind::Warp, "warp", &preset.warp),
                    (shader::Kind::Comp, "comp", &preset.comp),
                ] {
                    let outcome = match shader::translate(kind, text) {
                        Ok(Some(_)) => String::new(),
                        Ok(None) => "-".into(),
                        Err(e) => e.to_string(),
                    };
                    results.lock().unwrap().push((path.clone(), label, outcome));
                }
            });
        }
    });

    let results = results.into_inner().unwrap();
    let mut per_preset: BTreeMap<&PathBuf, bool> = BTreeMap::new();
    let (mut compiled, mut absent, mut failed) = (0, 0, 0);
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    let mut lines = Vec::new();
    for (path, label, outcome) in &results {
        let ok = outcome.is_empty() || outcome == "-";
        *per_preset.entry(path).or_insert(true) &= ok;
        match outcome.as_str() {
            "" => compiled += 1,
            "-" => absent += 1,
            error => {
                failed += 1;
                *groups.entry(category(error)).or_default() += 1;
                lines.push(format!("{label}\t{}\t{}", path.display(), error.lines().next().unwrap_or("")));
            }
        }
    }
    let presets_ok = per_preset.values().filter(|ok| **ok).count();
    println!(
        "shaders: {compiled} compiled, {failed} failed, {absent} absent ({:.2}% of present)",
        100.0 * compiled as f64 / (compiled + failed).max(1) as f64
    );
    println!(
        "presets: {presets_ok}/{} fully compiled ({:.2}%)",
        per_preset.len(),
        100.0 * presets_ok as f64 / per_preset.len().max(1) as f64
    );
    let mut sorted: Vec<_> = groups.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for (group, n) in sorted.iter().take(25) {
        println!("{n:6}  {group}");
    }
    if let Some(out) = failures_out {
        lines.sort();
        std::fs::write(&out, lines.join("\n") + "\n").expect("write failures");
        eprintln!("check: failures in {}", out.display());
    }
}
