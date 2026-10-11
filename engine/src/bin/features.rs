//! Raw measurements of each preset, and a short clip of it, for fitting tags.
//!
//!   cargo run --release -p visuals-engine --bin features -- <pack folder> --out DIR
//!       [--sample N] [--jobs N] [--timeout S] [--retry]
//!
//! Writes `DIR/features.json` (see `engine::features`) and `DIR/clips/`, one
//! WebP sprite sheet per distinct preset, named by content hash: 24 frames of
//! 192×144 side by side, 12 a second, two seconds of the music run from step 90.
//!
//! Each preset is drawn at 384×288, one step a frame, for ten seconds (300
//! steps) four times with the same seed, each from black: to the measuring
//! bins' synthetic music, in silence, and to the music with its waves, then its
//! shapes, left out. `engine::features::Collector` measures the pictures.
//!
//! Incremental by content hash: a preset already measured by the current
//! analysis (`features::ANALYSIS`) with its clip on disk isn't drawn again,
//! nor one skipped before (unless `--retry`). The file is saved every few
//! seconds, so it can be built in short runs. `--sample N` takes N presets
//! spread evenly over the sorted paths, so over the styles, the same every
//! time; rows of the folder's other presets already in the file are kept, and
//! rows of presets gone from the folder dropped.
//!
//! Presets are drawn in `--jobs` child processes as `index` draws them (see
//! `pool`): the `--timeout` (60 s) starts once a child has its GPU, a preset
//! that times out is tried once more at the back of the queue, and a child
//! whose preset panicked is restarted.

mod pool;

use engine::analyse;
use engine::audio::{Audio, FFT_SIZE};
use engine::features::{self, Collector, Condition, Features, Row, Skipped, CLIP, SIZE, SMALL, STEPS};
use engine::render::{headless, Renderer};
use engine::runtime::PRESET_RATE;
use pool::{Job, Launch, Queue};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How often the file is saved while presets are drawn.
const SAVE_EVERY: Duration = Duration::from_secs(5);

/// What a child sends back for one preset.
#[derive(Debug, Serialize, Deserialize)]
enum Reply {
    Drew(BTreeMap<String, Option<f32>>),
    Failed(String),
}

impl pool::Reply for Reply {
    fn failed(why: String) -> Self {
        Reply::Failed(why)
    }

    fn why(&self) -> Option<&str> {
        match self {
            Reply::Drew(_) => None,
            Reply::Failed(why) => Some(why),
        }
    }
}

fn usage(msg: &str) -> ! {
    eprintln!("features: {msg}");
    eprintln!("usage: features <pack folder> --out DIR [--sample N] [--jobs N] [--timeout S] [--retry]");
    std::process::exit(1);
}

fn number<T: std::str::FromStr>(args: &mut impl Iterator<Item = String>, flag: &str) -> T {
    let s = args.next().unwrap_or_else(|| usage(&format!("{flag} needs a value")));
    s.parse().unwrap_or_else(|_| usage(&format!("{flag} takes a number, not {s:?}")))
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut folder, mut out, mut count) = (None, None, None);
    let (mut jobs, mut timeout, mut retry) = (1usize, 60.0f64, false);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--child" => return child(),
            "--out" => out = Some(PathBuf::from(args.next().unwrap_or_else(|| usage("--out needs a folder")))),
            "--sample" => count = Some(number::<usize>(&mut args, "--sample")),
            "--jobs" => jobs = number::<usize>(&mut args, "--jobs").max(1),
            "--timeout" => timeout = number(&mut args, "--timeout"),
            "--retry" => retry = true,
            s if s.starts_with("--") => usage(&format!("unknown flag {s}")),
            _ if folder.is_none() => folder = Some(PathBuf::from(arg)),
            _ => usage("one pack folder"),
        }
    }
    let folder = folder.unwrap_or_else(|| usage("which pack folder?"));
    let out = out.unwrap_or_else(|| usage("--out DIR is needed"));
    if !(timeout.is_finite() && timeout > 0.0) {
        usage("--timeout takes a positive number");
    }
    run(&folder, &out, count, jobs, Duration::from_secs_f64(timeout), retry);
}

/// `rel` as a path in the file: `/`-separated.
fn file_path(rel: &Path) -> String {
    rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// What an old file already knows: features by content hash (clip on disk), and skips by path.
#[derive(Debug, Default)]
struct Known {
    drawn: HashMap<String, BTreeMap<String, Option<f32>>>,
    failed: HashMap<String, String>,
}

impl Known {
    fn from(old: Option<&Features>, has_clip: impl Fn(&str) -> bool, retry: bool) -> Known {
        let mut known = Known::default();
        for r in old.iter().flat_map(|o| &o.rows).filter(|r| has_clip(&r.clip)) {
            known.drawn.insert(r.hash.clone(), r.features.clone());
        }
        if !retry {
            for s in old.iter().flat_map(|o| &o.skipped) {
                known.failed.insert(s.path.clone(), s.why.clone());
            }
        }
        known
    }
}

/// Adds `old`'s rows and skips for the presets in `folder` that this run didn't
/// take (`taken`), as they were; a row only with its clip on disk.
fn carry(file: &mut Features, old: Option<&Features>, folder: &HashSet<String>, taken: &HashSet<String>, has_clip: impl Fn(&str) -> bool) {
    let Some(old) = old else { return };
    let keep = |path: &String| folder.contains(path) && !taken.contains(path);
    file.rows.extend(old.rows.iter().filter(|r| keep(&r.path) && has_clip(&r.clip)).cloned());
    file.skipped.extend(old.skipped.iter().filter(|s| keep(&s.path)).cloned());
}

fn run(folder: &Path, out: &Path, count: Option<usize>, jobs: usize, timeout: Duration, retry: bool) {
    let found = engine::preset::milk_files(folder);
    if found.is_empty() {
        usage(&format!("no .milk presets in {}", folder.display()));
    }
    let pool_size = found.len();
    let in_folder: HashSet<String> = found.iter().map(|p| file_path(p.strip_prefix(folder).unwrap_or(p))).collect();
    let files = match count {
        Some(n) => engine::index::sample(found, n),
        None => found,
    };
    let clips = out.join("clips");
    if let Err(e) = std::fs::create_dir_all(&clips) {
        usage(&format!("can't create {}: {e}", clips.display()));
    }
    let file = out.join("features.json");
    let old = Features::load(&file);
    let has_clip = |c: &str| clips.join(c).is_file();
    let Known { drawn, failed } = Known::from(old.as_ref(), has_clip, retry);

    let mut features = Features::default();
    let mut queue = VecDeque::new();
    // Presets waiting on a drawing, by hash: their paths and styles.
    let mut waiting: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut taken = HashSet::new();
    for path in &files {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("features: can't read {}: {e}", path.display());
                continue;
            }
        };
        let rel = path.strip_prefix(folder).unwrap_or(path);
        let hash = engine::index::hash(&bytes);
        let row = engine::index::row(rel, hash.clone());
        taken.insert(row.path.clone());
        if let Some(f) = drawn.get(&hash) {
            features.rows.push(Row { path: row.path, clip: features::clip_name(&hash), hash, style: row.style, features: f.clone() });
        } else if let Some(why) = failed.get(&row.path) {
            features.skipped.push(Skipped { path: row.path, why: why.clone() });
        } else {
            let at = waiting.entry(hash.clone()).or_default();
            if at.is_empty() {
                queue.push_back(Job { hash, path: path.clone(), tries: 0 });
            }
            at.push((row.path, row.style));
        }
    }
    let taking = taken.len();
    let ready = features.rows.len() + features.skipped.len();
    carry(&mut features, old.as_ref(), &in_folder, &taken, has_clip);
    let to_draw = queue.len();
    eprintln!(
        "{taking} presets ({pool_size} in the folder, {} more kept from the file): {ready} already measured or skipped, {to_draw} to draw with {jobs} jobs, timeout {}s",
        features.rows.len() + features.skipped.len() - ready,
        timeout.as_secs_f64()
    );

    let started = Instant::now();
    let queue = Arc::new(Queue::new(queue));
    let (tx, results) = mpsc::channel();
    let launch = match std::env::current_exe() {
        Ok(program) => Launch { program, args: vec!["--child".into()] },
        Err(e) => usage(&format!("can't find this program to start children: {e}")),
    };
    let workers: Vec<_> = (0..jobs.min(to_draw))
        .map(|_| {
            let (queue, tx, clips, launch) = (queue.clone(), tx.clone(), clips.clone(), launch.clone());
            std::thread::spawn(move || pool::drive("features", &queue, &tx, &|h: &str| clips.join(features::clip_name(h)), &launch, timeout))
        })
        .collect();
    drop(tx);
    let (mut done, mut last_save) = (0, Instant::now());
    for (hash, path, reply) in results {
        done += 1;
        let presets = waiting.remove(&hash).unwrap_or_default();
        match reply {
            Reply::Drew(f) => {
                for (p, style) in presets {
                    features.rows.push(Row { path: p, hash: hash.clone(), style, features: f.clone(), clip: features::clip_name(&hash) });
                }
            }
            Reply::Failed(why) => {
                eprintln!("features: {why}\t{}", path.display());
                features.skipped.extend(presets.into_iter().map(|(p, _)| Skipped { path: p, why: why.clone() }));
            }
        }
        if done % 25 == 0 {
            let secs = started.elapsed().as_secs_f64();
            eprintln!("{done}/{to_draw} in {secs:.0}s ({:.2} presets/s)", done as f64 / secs);
        }
        if last_save.elapsed() >= SAVE_EVERY {
            save(&features, &file);
            last_save = Instant::now();
        }
    }
    let gave_up: Vec<String> = workers.into_iter().filter_map(|w| w.join().unwrap_or_else(|_| Some("its driver panicked".into()))).collect();
    let secs = started.elapsed().as_secs_f64();
    save(&features, &file);
    let left = queue.left().len();
    if left > 0 {
        eprintln!("features: {left} presets not drawn: children couldn't start ({}); the file so far is saved, run again to go on", gave_up.join("; "));
        std::process::exit(1);
    }
    println!("{}: {} presets measured, {} skipped; drew {to_draw} in {secs:.1}s ({:.2} presets/s)", file.display(), features.rows.len(), features.skipped.len(), to_draw as f64 / secs.max(1e-9));
    for s in &features.skipped {
        println!("skipped\t{}\t{}", s.why, s.path);
    }
}

fn save(features: &Features, file: &Path) {
    if let Err(e) = features.save(file) {
        eprintln!("features: can't write {}: {e}", file.display());
        std::process::exit(1);
    }
}

/// The child (`pool::child`): gets its GPU and a renderer at [`SIZE`], then
/// draws each preset named on stdin (`<preset>\t<clip>`), writes its clip and
/// answers one JSON [`Reply`] line.
fn child() {
    let setup = || {
        let (device, queue) = headless().expect("a GPU");
        Renderer::new(device, queue, SIZE.0, SIZE.1)
    };
    pool::child(setup, draw);
}

fn draw(r: &mut Renderer, preset: &Path, clip: &Path) -> Result<Reply, String> {
    let text = engine::preset::decode(&std::fs::read(preset).map_err(|e| e.to_string())?);
    let (w, h) = (SIZE.0 as usize, SIZE.1 as usize);
    let (cw, ch) = (CLIP.size[0] as usize, CLIP.size[1] as usize);
    let clip_steps = features::clip_steps();
    let mut sheet = vec![0u8; cw * CLIP.frames as usize * ch * 3];
    let mut collector = Collector::new();
    let mut samples = vec![0f32; FFT_SIZE];
    for condition in Condition::ALL {
        r.clear();
        r.set_hide(condition.hide());
        let loaded = r.load(&text, features::SEED);
        if let Err(e) = loaded {
            r.set_hide(Default::default());
            return Err(e.to_string());
        }
        let mut audio = Audio::new(analyse::RATE as f32);
        for step in 1..=STEPS {
            if condition.hears() {
                analyse::music(step as f64 / PRESET_RATE, &mut samples);
            } else {
                samples.fill(0.0);
            }
            audio.update(&samples, &samples);
            r.render(&mut audio, 1.0 / PRESET_RATE);
            if !Collector::wants(condition, step) {
                continue;
            }
            let rgba = r.read_back();
            let small = analyse::shrink(&rgba, w, h, w / SMALL.0);
            collector.add(condition, step, &rgba, &small);
            if condition == Condition::Music {
                if let Some(i) = clip_steps.iter().position(|&s| s == step) {
                    // The small picture is the clip's size; frame i sits i frames across.
                    let row = cw * CLIP.frames as usize * 3;
                    for y in 0..ch {
                        for x in 0..cw {
                            let (from, to) = ((y * cw + x) * 4, y * row + (i * cw + x) * 3);
                            sheet[to..to + 3].copy_from_slice(&small[from..from + 3]);
                        }
                    }
                }
            }
        }
    }
    r.set_hide(Default::default());
    let webp = webp::Encoder::from_rgb(&sheet, (cw * CLIP.frames as usize) as u32, ch as u32).encode(features::CLIP_QUALITY);
    let tmp = clip.with_extension("webp.tmp");
    std::fs::write(&tmp, &*webp).and_then(|_| std::fs::rename(&tmp, clip)).map_err(|e| format!("can't write {}: {e}", clip.display()))?;
    Ok(Reply::Drew(collector.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, hash: &str) -> Row {
        Row { path: path.into(), hash: hash.into(), style: "A".into(), features: BTreeMap::new(), clip: features::clip_name(hash) }
    }

    #[test]
    fn known_reuses_rows_with_clips_and_skips_unless_retrying() {
        let mut old = Features::default();
        old.rows.push(row("A/a.milk", "aaaa"));
        old.rows.push(row("A/lost.milk", "cccc"));
        old.skipped.push(Skipped { path: "A/x.milk".into(), why: "timed out".into() });
        let on_disk = |c: &str| c != features::clip_name("cccc");
        let known = Known::from(Some(&old), on_disk, false);
        assert_eq!(known.drawn.keys().collect::<Vec<_>>(), ["aaaa"]);
        assert_eq!(known.failed.get("A/x.milk").map(String::as_str), Some("timed out"));
        assert!(Known::from(Some(&old), on_disk, true).failed.is_empty());
    }

    #[test]
    fn rows_not_taken_are_kept_while_in_the_folder() {
        let mut old = Features::default();
        old.rows.extend([row("A/taken.milk", "aaaa"), row("A/kept.milk", "bbbb"), row("A/gone.milk", "cccc")]);
        old.skipped.push(Skipped { path: "B/hung.milk".into(), why: "timed out".into() });
        let folder: HashSet<String> = ["A/taken.milk", "A/kept.milk", "B/hung.milk"].map(String::from).into();
        let taken: HashSet<String> = ["A/taken.milk".to_string()].into();
        let mut f = Features::default();
        carry(&mut f, Some(&old), &folder, &taken, |_| true);
        assert_eq!(f.rows, vec![old.rows[1].clone()]);
        assert_eq!(f.skipped, old.skipped);
        let mut f = Features::default();
        carry(&mut f, Some(&old), &folder, &taken, |_| false);
        assert!(f.rows.is_empty(), "no clip on disk, no row");
    }

    #[test]
    fn replies_round_trip_on_one_line() {
        let drew = Reply::Drew([("speed".to_string(), None), ("glow".to_string(), Some(0.25))].into());
        for reply in [drew, Reply::Failed("failed: no\nnewline".into())] {
            let line = serde_json::to_string(&reply).unwrap();
            assert!(!line.contains('\n'));
            let back: Reply = serde_json::from_str(&line).unwrap();
            assert_eq!(format!("{back:?}"), format!("{reply:?}"));
        }
    }
}
