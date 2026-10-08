//! The preset library's index: a thumbnail of each preset and what it looks like.
//!
//!   cargo run --release -p visuals-engine --bin index -- <pack folder> --out DIR
//!       [--sample N] [--jobs N] [--timeout S] [--frame F] [--retry]
//!
//! Writes `DIR/index.json` (see `engine::index`) and a `DIR/thumbnails/` folder
//! of 192×144 WebP pictures, one per distinct preset, named by content hash.
//! The folder's sub-folders are the styles, theirs the sub-styles.
//!
//! Each preset is drawn to the measuring bins' synthetic music, one step a
//! frame, to step `--frame` (90: three seconds); the thumbnail is that last
//! picture. Its look is measured over the second half of the run on the
//! thumbnail-sized pictures: dominant hues, mean brightness, speed (block
//! motion, as `motion` measures it) and intensity (frame difference).
//!
//! Incremental: a preset whose content hash is already in `index.json` with a
//! thumbnail on disk isn't drawn again, nor one that timed out or failed before
//! (unless `--retry`); its name, style and levels are always read afresh.
//!
//! Presets are drawn in `--jobs` child processes (this bin, run with
//! `--child`), so one stuck past `--timeout` seconds — a Metal compile can't be
//! interrupted — is killed, listed under `skipped` and the run goes on.
//! `--sample N` takes N presets spread evenly over the sorted paths.

use engine::analyse::{self, colour::Hues};
use engine::audio::{Audio, FFT_SIZE};
use engine::index::{self, Cuts, Index, Look, Skipped, THUMBNAIL};
use engine::render::{headless, Renderer};
use engine::runtime::PRESET_RATE;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Pictures are drawn at this many times the thumbnail size and shrunk.
const SUPERSAMPLE: u32 = 2;
/// WebP quality, 0–100.
const QUALITY: f32 = 75.0;

/// What a child sends back for one preset.
#[derive(Debug, Serialize, Deserialize)]
enum Reply {
    Drew { hues: Vec<u16>, brightness: f32, speed: Option<f32>, intensity: f32 },
    Failed(String),
}

fn usage(msg: &str) -> ! {
    eprintln!("index: {msg}");
    eprintln!("usage: index <pack folder> --out DIR [--sample N] [--jobs N] [--timeout S] [--frame F] [--retry]");
    std::process::exit(1);
}

fn number<T: std::str::FromStr>(args: &mut impl Iterator<Item = String>, flag: &str) -> T {
    let s = args.next().unwrap_or_else(|| usage(&format!("{flag} needs a value")));
    s.parse().unwrap_or_else(|_| usage(&format!("{flag} takes a number, not {s:?}")))
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut folder = None;
    let mut out = None;
    let mut count = None;
    let mut jobs = 1usize;
    let mut timeout = 20.0f64;
    let mut frame = 90u32;
    let mut retry = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--child" => return child(number(&mut args, "--child")),
            "--out" => out = Some(PathBuf::from(args.next().unwrap_or_else(|| usage("--out needs a folder")))),
            "--sample" => count = Some(number::<usize>(&mut args, "--sample")),
            "--jobs" => jobs = number::<usize>(&mut args, "--jobs").max(1),
            "--timeout" => timeout = number(&mut args, "--timeout"),
            "--frame" => frame = number::<u32>(&mut args, "--frame").max(2),
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
    run(&folder, &out, count, jobs, Duration::from_secs_f64(timeout), frame, retry);
}

fn run(folder: &Path, out: &Path, count: Option<usize>, jobs: usize, timeout: Duration, frame: u32, retry: bool) {
    let found = engine::preset::milk_files(folder);
    if found.is_empty() {
        usage(&format!("no .milk presets in {}", folder.display()));
    }
    let pool = found.len();
    let files = match count {
        Some(n) => index::sample(found, n),
        None => found,
    };
    let thumbs = out.join("thumbnails");
    if let Err(e) = std::fs::create_dir_all(&thumbs) {
        usage(&format!("can't create {}: {e}", thumbs.display()));
    }
    let file = out.join("index.json");
    let old = Index::load(&file).filter(|old| old.frame == frame && old.thumbnail == THUMBNAIL);

    // What's known already, by content hash.
    let mut drawn: HashMap<String, (Look, String)> = HashMap::new();
    let mut failed: HashMap<String, String> = HashMap::new();
    for r in old.iter().flat_map(|o| &o.rows) {
        if let (Some(look), Some(t)) = (&r.look, &r.thumbnail) {
            if thumbs.join(t).is_file() {
                drawn.insert(r.hash.clone(), (look.clone(), t.clone()));
            }
        }
    }
    if !retry {
        for s in old.iter().flat_map(|o| &o.skipped) {
            failed.insert(s.hash.clone(), s.why.clone());
        }
    }

    let mut index = Index::new(frame);
    let mut queue = VecDeque::new();
    let mut waiting: HashMap<String, Vec<usize>> = HashMap::new();
    for path in &files {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("index: can't read {}: {e}", path.display());
                continue;
            }
        };
        let rel = path.strip_prefix(folder).unwrap_or(path);
        let mut row = index::row(rel, index::hash(&bytes));
        if let Some((look, thumb)) = drawn.get(&row.hash) {
            let mut look = look.clone();
            look.relevel();
            row.look = Some(look);
            row.thumbnail = Some(thumb.clone());
        } else if let Some(why) = failed.get(&row.hash) {
            index.skipped.push(Skipped { path: row.path.clone(), hash: row.hash.clone(), why: why.clone() });
        } else {
            let at = waiting.entry(row.hash.clone()).or_default();
            if at.is_empty() {
                queue.push_back((row.hash.clone(), path.clone()));
            }
            at.push(index.rows.len());
        }
        index.rows.push(row);
    }
    let to_draw = queue.len();
    eprintln!(
        "{} presets ({pool} in the folder): {} already indexed, {to_draw} to draw with {jobs} jobs, timeout {}s",
        index.rows.len(),
        index.rows.len() - waiting.values().map(Vec::len).sum::<usize>(),
        timeout.as_secs_f64()
    );

    let started = Instant::now();
    let queue = Arc::new(Mutex::new(queue));
    let (tx, results) = mpsc::channel();
    let workers: Vec<_> = (0..jobs.min(to_draw))
        .map(|_| {
            let (queue, tx, thumbs) = (queue.clone(), tx.clone(), thumbs.clone());
            std::thread::spawn(move || drive(&queue, &tx, &thumbs, frame, timeout))
        })
        .collect();
    drop(tx);
    let mut done = 0;
    for (hash, path, reply) in results {
        done += 1;
        let rows = waiting.remove(&hash).unwrap_or_default();
        match reply {
            Reply::Drew { hues, brightness, speed, intensity } => {
                let look = Look::new(hues, brightness, speed, intensity);
                for i in rows {
                    index.rows[i].look = Some(look.clone());
                    index.rows[i].thumbnail = Some(index::thumbnail_name(&hash));
                }
            }
            Reply::Failed(why) => {
                eprintln!("index: {why}\t{}", path.display());
                for i in rows {
                    index.skipped.push(Skipped { path: index.rows[i].path.clone(), hash: hash.clone(), why: why.clone() });
                }
            }
        }
        if done % 100 == 0 {
            let secs = started.elapsed().as_secs_f64();
            eprintln!("{done}/{to_draw} in {secs:.0}s ({:.2} presets/s)", done as f64 / secs);
        }
        if done % 500 == 0 {
            save(&mut index, &file);
        }
    }
    for w in workers {
        let _ = w.join();
    }
    let secs = started.elapsed().as_secs_f64();
    save(&mut index, &file);
    report(&index, to_draw, secs, &file);
}

fn save(index: &mut Index, file: &Path) {
    index.rows.sort_by(|a, b| a.path.cmp(&b.path));
    index.skipped.sort_by(|a, b| a.path.cmp(&b.path));
    if let Err(e) = index.save(file) {
        eprintln!("index: can't write {}: {e}", file.display());
        std::process::exit(1);
    }
}

/// The run's numbers, and the cut points that would split this set into thirds.
fn report(index: &Index, drew: usize, secs: f64, file: &Path) {
    let looks: Vec<&Look> = index.rows.iter().filter_map(|r| r.look.as_ref()).collect();
    println!(
        "{}: {} presets, {} with a thumbnail, {} skipped; drew {drew} in {secs:.1}s ({:.2} presets/s)",
        file.display(),
        index.rows.len(),
        looks.len(),
        index.skipped.len(),
        drew as f64 / secs.max(1e-9)
    );
    let measure = |name: &str, values: Vec<f32>, levels: Vec<index::Level>| {
        let t = Cuts::terciles(&values).map_or("—".into(), |c| format!("{:.3} / {:.3}", c.0, c.1));
        let n = |l| levels.iter().filter(|&&x| x == l).count();
        println!("{name}: terciles {t}; levels low {} mid {} high {}", n(index::Level::Low), n(index::Level::Mid), n(index::Level::High));
    };
    measure("brightness", looks.iter().map(|l| l.brightness).collect(), looks.iter().map(|l| l.brightness_level).collect());
    measure("speed", looks.iter().filter_map(|l| l.speed).collect(), looks.iter().map(|l| l.speed_level).collect());
    measure("intensity", looks.iter().map(|l| l.intensity).collect(), looks.iter().map(|l| l.intensity_level).collect());
    println!("speed unmeasured (levelled by intensity): {}", looks.iter().filter(|l| l.speed.is_none()).count());
    for s in &index.skipped {
        println!("skipped\t{}\t{}", s.why, s.path);
    }
}

/// A running child and the lines it sends back.
struct Running {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

fn spawn(frame: u32) -> std::io::Result<Running> {
    let mut child = Command::new(std::env::current_exe()?).args(["--child", &frame.to_string()]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let (tx, lines) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    Ok(Running { child, stdin, lines })
}

fn stop(mut r: Running) {
    let _ = r.child.kill();
    let _ = r.child.wait();
}

/// Draws presets from `queue` in a child until it's empty, restarting the
/// child after a timeout or a crash.
fn drive(queue: &Mutex<VecDeque<(String, PathBuf)>>, results: &mpsc::Sender<(String, PathBuf, Reply)>, thumbs: &Path, frame: u32, timeout: Duration) {
    let mut running: Option<Running> = None;
    loop {
        let Some((hash, path)) = queue.lock().unwrap_or_else(|e| e.into_inner()).pop_front() else { break };
        let r = match running.take().map_or_else(|| spawn(frame), Ok) {
            Ok(r) => r,
            Err(e) => {
                let _ = results.send((hash, path, Reply::Failed(format!("failed: can't start a child: {e}"))));
                continue;
            }
        };
        let thumb = thumbs.join(index::thumbnail_name(&hash));
        let mut r = r;
        let reply = if writeln!(r.stdin, "{}\t{}", path.display(), thumb.display()).and_then(|_| r.stdin.flush()).is_err() {
            stop(r);
            Reply::Failed("crashed".into())
        } else {
            match r.lines.recv_timeout(timeout) {
                Ok(line) => {
                    running = Some(r);
                    serde_json::from_str(&line).unwrap_or_else(|e| Reply::Failed(format!("failed: bad reply {line:?}: {e}")))
                }
                Err(RecvTimeoutError::Timeout) => {
                    stop(r);
                    Reply::Failed("timed out".into())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    stop(r);
                    Reply::Failed("crashed".into())
                }
            }
        };
        if results.send((hash, path, reply)).is_err() {
            break;
        }
    }
    if let Some(r) = running {
        // Closing its input ends it.
        let Running { mut child, stdin, .. } = r;
        drop(stdin);
        let _ = child.wait();
    }
}

/// The child: draws each preset named on stdin (`<preset>\t<thumbnail>`),
/// writes its thumbnail and answers one JSON [`Reply`] line.
fn child(frame: u32) {
    std::panic::set_hook(Box::new(|_| {}));
    let (w, h) = (THUMBNAIL.0 * SUPERSAMPLE, THUMBNAIL.1 * SUPERSAMPLE);
    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, w, h);
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Some((preset, thumb)) = line.split_once('\t') else { continue };
        let reply = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| draw(&mut renderer, Path::new(preset), Path::new(thumb), frame))) {
            Ok(Ok(reply)) => reply,
            Ok(Err(e)) => Reply::Failed(format!("failed: {e}")),
            Err(p) => Reply::Failed(format!("panicked: {}", p.downcast_ref::<String>().map(String::as_str).or(p.downcast_ref::<&str>().copied()).unwrap_or("?"))),
        };
        let mut out = stdout.lock();
        if writeln!(out, "{}", serde_json::to_string(&reply).expect("a reply serialises")).and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}

fn draw(r: &mut Renderer, preset: &Path, thumb: &Path, frame: u32) -> Result<Reply, String> {
    let text = engine::preset::decode(&std::fs::read(preset).map_err(|e| e.to_string())?);
    r.load(&text, 1).map_err(|e| e.to_string())?;
    let (w, h) = (THUMBNAIL.0 as usize, THUMBNAIL.1 as usize);
    let mut audio = Audio::new(analyse::RATE as f32);
    let mut samples = vec![0f32; FFT_SIZE];
    let mut hues = Hues::default();
    let (mut brightness, mut pictures) = (0.0f64, 0usize);
    let (mut differences, mut motions) = (Vec::new(), Vec::new());
    let mut before: Option<Vec<f32>> = None;
    for step in 1..=frame {
        analyse::music(step as f64 / PRESET_RATE, &mut samples);
        audio.update(&samples, &samples);
        r.render(&mut audio, 1.0 / PRESET_RATE);
        if step < frame / 2 {
            continue;
        }
        let small = analyse::shrink(&r.read_back(), w * SUPERSAMPLE as usize, h * SUPERSAMPLE as usize, SUPERSAMPLE as usize);
        let now = analyse::luma(&small);
        hues.add(&small);
        brightness += now.iter().map(|&v| v as f64).sum::<f64>() / now.len() as f64 / 255.0;
        pictures += 1;
        if let Some(before) = &before {
            differences.push(analyse::difference(before, &now));
            let f = analyse::flow(before, &now, w, h);
            match f.measured() {
                Some(m) => motions.push(m),
                // Textured, but not found again: moving faster than the search.
                None if f.textured * 10 >= f.blocks => motions.push(analyse::SEARCH as f64),
                None => {}
            }
        }
        before = Some(now);
        if step == frame {
            let rgb: Vec<u8> = small.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
            let webp = webp::Encoder::from_rgb(&rgb, w as u32, h as u32).encode(QUALITY);
            let tmp = thumb.with_extension("webp.tmp");
            std::fs::write(&tmp, &*webp).and_then(|_| std::fs::rename(&tmp, thumb)).map_err(|e| format!("can't write {}: {e}", thumb.display()))?;
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    // Speed needs motion followed on at least a third of the refreshes.
    let speed = (motions.len() * 3 >= differences.len() && !motions.is_empty()).then(|| mean(&motions) as f32);
    Ok(Reply::Drew { hues: hues.dominant(), brightness: (brightness / pictures.max(1) as f64) as f32, speed, intensity: mean(&differences) as f32 })
}

#[cfg(test)]
mod tests {
    use super::Reply;

    #[test]
    fn replies_round_trip_on_one_line() {
        for reply in [Reply::Drew { hues: vec![10, 200], brightness: 0.5, speed: None, intensity: 3.0 }, Reply::Failed("failed: no\nnewline".into())] {
            let line = serde_json::to_string(&reply).unwrap();
            assert!(!line.contains('\n'));
            let back: Reply = serde_json::from_str(&line).unwrap();
            assert_eq!(format!("{back:?}"), format!("{reply:?}"));
        }
    }
}
