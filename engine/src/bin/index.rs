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
//! thumbnail on disk, measured by the current analysis (`index::ANALYSIS`),
//! isn't drawn again, nor one that was skipped before (unless `--retry`); its
//! name, style and levels are always read afresh. A `--frame` other than the
//! index's starts it afresh.
//!
//! Presets are drawn in `--jobs` child processes (this bin, run with
//! `--child`), so one stuck past `--timeout` seconds — a Metal compile can't be
//! interrupted — is killed and the run goes on. The clock starts once the child
//! has its GPU. A preset that times out goes to the back of the queue for one
//! more try in a fresh child; a second timeout lists it under `skipped`. A
//! child whose preset panicked is restarted, so no preset draws on a renderer a
//! panic left half-way. A child that fails to start doesn't cost its preset
//! anything: the preset goes back on the queue. After three such failures in a
//! row a driver gives up; when every driver has, the index so far is saved and
//! the run ends with exit status 1, naming why.
//!
//! `--sample N` takes N presets spread evenly over the sorted paths; the rows
//! of the folder's other presets already in `index.json` are kept as they are.
//! Rows for presets no longer in the folder are dropped.

use engine::analyse::{self, colour::Hues};
use engine::audio::{Audio, FFT_SIZE};
use engine::index::{self, Cuts, Index, Look, Skipped, THUMBNAIL};
use engine::render::{headless, Renderer};
use engine::runtime::PRESET_RATE;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
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
/// What a child prints once it has its GPU and renderer, before any preset.
const READY: &str = "ready";
/// How long a child may take to get its GPU; not counted against `--timeout`.
const SETUP: Duration = Duration::from_secs(120);
/// How often the index is saved while presets are drawn, so a run that is cut
/// off (by `timeout`, or the Mac sleeping) loses at most this much work: the
/// next run draws only what the saved index lacks.
const SAVE_EVERY: Duration = Duration::from_secs(5);
/// How many times a preset is tried before a timeout skips it.
const TRIES: u32 = 2;
/// How many children in a row may fail to start before a driver gives up: no
/// GPU, or a broken build, fails every child, and a run must end rather than
/// try the whole pack (or hang a CI job doing it).
const START_FAILURES: u32 = 3;

/// What a child sends back for one preset.
#[derive(Debug, Serialize, Deserialize)]
enum Reply {
    Drew { hues: Vec<u16>, brightness: f32, speed: Option<f32>, intensity: f32 },
    Failed(String),
}

impl Reply {
    /// A panic leaves the child's renderer in whatever state it was in.
    fn panicked(&self) -> bool {
        matches!(self, Reply::Failed(why) if why.starts_with("panicked"))
    }
}

/// How to start a child.
#[derive(Debug, Clone)]
struct Launch {
    program: PathBuf,
    args: Vec<String>,
}

/// A preset to draw, and how many times it's been tried.
#[derive(Debug, Clone)]
struct Job {
    hash: String,
    path: PathBuf,
    tries: u32,
}

/// What an old index already knows, by content hash.
#[derive(Debug, Default)]
struct Known {
    /// Drawn by the current analysis, with the thumbnail on disk.
    drawn: HashMap<String, (Look, String)>,
    /// Skipped before, and why.
    failed: HashMap<String, String>,
}

impl Known {
    fn from(old: Option<&Index>, has_thumbnail: impl Fn(&str) -> bool, retry: bool) -> Known {
        let mut known = Known::default();
        for r in old.iter().flat_map(|o| &o.rows) {
            if let (Some(look), Some(t)) = (&r.look, &r.thumbnail) {
                if look.analysis == index::ANALYSIS && has_thumbnail(t) {
                    known.drawn.insert(r.hash.clone(), (look.clone(), t.clone()));
                }
            }
        }
        if !retry {
            for s in old.iter().flat_map(|o| &o.skipped) {
                known.failed.insert(s.hash.clone(), s.why.clone());
            }
        }
        known
    }
}

/// `rel` as an index path: `/`-separated.
fn index_path(rel: &Path) -> String {
    rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// Adds `old`'s rows and skips for the presets in `folder` (index paths) that
/// this run didn't take (`taken`), as they were: their names, styles and
/// levels read afresh, their thumbnail kept only when it's on disk.
fn carry(index: &mut Index, old: Option<&Index>, folder: &HashSet<String>, taken: &HashSet<String>, has_thumbnail: impl Fn(&str) -> bool) {
    let Some(old) = old else { return };
    let keep = |path: &String| folder.contains(path) && !taken.contains(path);
    for r in old.rows.iter().filter(|r| keep(&r.path)) {
        let mut row = index::row(Path::new(&r.path), r.hash.clone());
        if let (Some(look), Some(t)) = (&r.look, &r.thumbnail) {
            if has_thumbnail(t) {
                let mut look = look.clone();
                look.relevel();
                row.look = Some(look);
                row.thumbnail = Some(t.clone());
            }
        }
        index.rows.push(row);
    }
    index.skipped.extend(old.skipped.iter().filter(|s| keep(&s.path)).cloned());
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
    let in_folder: HashSet<String> = found.iter().map(|p| index_path(p.strip_prefix(folder).unwrap_or(p))).collect();
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
    let has_thumbnail = |t: &str| thumbs.join(t).is_file();
    let Known { drawn, failed } = Known::from(old.as_ref(), has_thumbnail, retry);

    let mut index = Index::new(frame);
    let mut queue = VecDeque::new();
    let mut waiting: HashMap<String, Vec<usize>> = HashMap::new();
    let mut taken = HashSet::new();
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
        taken.insert(row.path.clone());
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
                queue.push_back(Job { hash: row.hash.clone(), path: path.clone(), tries: 0 });
            }
            at.push(index.rows.len());
        }
        index.rows.push(row);
    }
    let taking = index.rows.len();
    carry(&mut index, old.as_ref(), &in_folder, &taken, has_thumbnail);
    let to_draw = queue.len();
    eprintln!(
        "{taking} presets ({pool} in the folder, {} more kept from the index): {} already indexed, {to_draw} to draw with {jobs} jobs, timeout {}s",
        index.rows.len() - taking,
        taking - waiting.values().map(Vec::len).sum::<usize>(),
        timeout.as_secs_f64()
    );

    let started = Instant::now();
    let queue = Arc::new(Mutex::new(queue));
    let (tx, results) = mpsc::channel();
    let launch = match std::env::current_exe() {
        Ok(program) => Launch { program, args: vec!["--child".into(), frame.to_string()] },
        Err(e) => usage(&format!("can't find this program to start children: {e}")),
    };
    let workers: Vec<_> = (0..jobs.min(to_draw))
        .map(|_| {
            let (queue, tx, thumbs, launch) = (queue.clone(), tx.clone(), thumbs.clone(), launch.clone());
            std::thread::spawn(move || drive(&queue, &tx, &thumbs, &launch, timeout))
        })
        .collect();
    drop(tx);
    let mut done = 0;
    let mut last_save = Instant::now();
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
        if last_save.elapsed() >= SAVE_EVERY {
            save(&index, &file);
            last_save = Instant::now();
        }
    }
    let gave_up: Vec<String> = workers.into_iter().filter_map(|w| w.join().unwrap_or_else(|_| Some("its driver panicked".into()))).collect();
    let secs = started.elapsed().as_secs_f64();
    save(&index, &file);
    let left = queue.lock().unwrap_or_else(|e| e.into_inner()).len();
    if left > 0 {
        eprintln!("index: {left} presets not drawn: children couldn't start ({}); the index so far is saved, run again to go on", gave_up.join("; "));
        std::process::exit(1);
    }
    report(&index, to_draw, secs, &file);
}

/// Writes `index` sorted by path. A sorted copy: `waiting` holds positions in
/// `index.rows`, so the rows mustn't move while presets are still drawing.
fn save(index: &Index, file: &Path) {
    let mut sorted = index.clone();
    sorted.rows.sort_by(|a, b| a.path.cmp(&b.path));
    sorted.skipped.sort_by(|a, b| a.path.cmp(&b.path));
    if let Err(e) = sorted.save(file) {
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

/// Starts a child and waits, up to [`SETUP`], for it to say it's [`READY`].
fn spawn(launch: &Launch) -> std::io::Result<Running> {
    let mut child = Command::new(&launch.program).args(&launch.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
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
    let r = Running { child, stdin, lines };
    let why = match r.lines.recv_timeout(SETUP) {
        Ok(line) if line == READY => return Ok(r),
        Ok(line) => format!("it said {line:?} before it was ready"),
        Err(RecvTimeoutError::Timeout) => format!("it wasn't ready within {}s", SETUP.as_secs()),
        Err(RecvTimeoutError::Disconnected) => "it ended before it was ready".into(),
    };
    stop(r);
    Err(std::io::Error::other(why))
}

fn stop(mut r: Running) {
    let _ = r.child.kill();
    let _ = r.child.wait();
}

/// What came of asking a child for one preset.
enum Outcome {
    Replied(Reply),
    TimedOut,
    Crashed,
}

fn ask(r: &mut Running, preset: &Path, thumb: &Path, timeout: Duration) -> Outcome {
    if writeln!(r.stdin, "{}\t{}", preset.display(), thumb.display()).and_then(|_| r.stdin.flush()).is_err() {
        return Outcome::Crashed;
    }
    match r.lines.recv_timeout(timeout) {
        Ok(line) => Outcome::Replied(serde_json::from_str(&line).unwrap_or_else(|e| Reply::Failed(format!("failed: bad reply {line:?}: {e}")))),
        Err(RecvTimeoutError::Timeout) => Outcome::TimedOut,
        Err(RecvTimeoutError::Disconnected) => Outcome::Crashed,
    }
}

/// Draws presets from `queue` in a child until it's empty. The child is
/// restarted after a timeout, a crash or a panic; a preset that times out goes
/// to the back of the queue until it has had [`TRIES`]. A preset whose child
/// fails to start goes back on the queue untried; after [`START_FAILURES`] in a
/// row this driver gives up, returning why.
fn drive(queue: &Mutex<VecDeque<Job>>, results: &mpsc::Sender<(String, PathBuf, Reply)>, thumbs: &Path, launch: &Launch, timeout: Duration) -> Option<String> {
    let mut running: Option<Running> = None;
    let mut failures = 0;
    let mut gave_up = None;
    loop {
        let Some(mut job) = queue.lock().unwrap_or_else(|e| e.into_inner()).pop_front() else { break };
        let mut r = match running.take().map_or_else(|| spawn(launch), Ok) {
            Ok(r) => {
                failures = 0;
                r
            }
            Err(e) => {
                failures += 1;
                eprintln!("index: can't start a child ({failures} in a row): {e}");
                queue.lock().unwrap_or_else(|e| e.into_inner()).push_front(job);
                if failures >= START_FAILURES {
                    gave_up = Some(format!("{failures} in a row, the last: {e}"));
                    break;
                }
                continue;
            }
        };
        job.tries += 1;
        let thumb = thumbs.join(index::thumbnail_name(&job.hash));
        let reply = match ask(&mut r, &job.path, &thumb, timeout) {
            Outcome::Replied(reply) => {
                if reply.panicked() {
                    stop(r);
                } else {
                    running = Some(r);
                }
                reply
            }
            Outcome::TimedOut => {
                stop(r);
                if job.tries < TRIES {
                    eprintln!("index: timed out, trying again later\t{}", job.path.display());
                    queue.lock().unwrap_or_else(|e| e.into_inner()).push_back(job);
                    continue;
                }
                Reply::Failed("timed out".into())
            }
            Outcome::Crashed => {
                stop(r);
                Reply::Failed("crashed".into())
            }
        };
        if results.send((job.hash, job.path, reply)).is_err() {
            break;
        }
    }
    if let Some(r) = running {
        // Closing its input ends it.
        let Running { mut child, stdin, .. } = r;
        drop(stdin);
        let _ = child.wait();
    }
    gave_up
}

/// The child: says [`READY`] once it has its GPU, then draws each preset named
/// on stdin (`<preset>\t<thumbnail>`), writes its thumbnail and answers one
/// JSON [`Reply`] line.
fn child(frame: u32) {
    let (w, h) = (THUMBNAIL.0 * SUPERSAMPLE, THUMBNAIL.1 * SUPERSAMPLE);
    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, w, h);
    std::panic::set_hook(Box::new(|_| {}));
    let stdout = std::io::stdout();
    {
        let mut out = stdout.lock();
        if writeln!(out, "{READY}").and_then(|_| out.flush()).is_err() {
            return;
        }
    }
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Some((preset, thumb)) = line.split_once('\t') else { continue };
        let reply = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| draw(&mut renderer, Path::new(preset), Path::new(thumb), frame))) {
            Ok(Ok(reply)) => reply,
            Ok(Err(e)) => Reply::Failed(format!("failed: {e}")),
            Err(p) => Reply::Failed(format!("panicked: {}", p.downcast_ref::<String>().map(String::as_str).or(p.downcast_ref::<&str>().copied()).unwrap_or("?"))),
        };
        let panicked = reply.panicked();
        let mut out = stdout.lock();
        if writeln!(out, "{}", serde_json::to_string(&reply).expect("a reply serialises")).and_then(|_| out.flush()).is_err() || panicked {
            // After a panic the parent starts a fresh child.
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
    use super::*;

    /// A child that's `sh -c script`: tests drive the real driver against a
    /// stand-in that speaks the same lines without a GPU.
    fn sh(script: &str) -> Launch {
        Launch { program: "/bin/sh".into(), args: vec!["-c".into(), script.into()] }
    }

    /// Runs `presets` through one driver with `launch`; the replies in order.
    fn run_driver(launch: &Launch, presets: &[&str], timeout: Duration) -> Vec<(PathBuf, String)> {
        let (replies, left, gave_up) = run_driver_whole(launch, presets, timeout);
        assert!(left.is_empty() && gave_up.is_none(), "{left:?} {gave_up:?}");
        replies
    }

    /// The same, with the presets left on the queue and why the driver gave up.
    fn run_driver_whole(launch: &Launch, presets: &[&str], timeout: Duration) -> (Vec<(PathBuf, String)>, Vec<PathBuf>, Option<String>) {
        let queue = Mutex::new(presets.iter().map(|p| Job { hash: format!("{p}hash"), path: PathBuf::from(p), tries: 0 }).collect::<VecDeque<_>>());
        let (tx, rx) = mpsc::channel();
        let gave_up = drive(&queue, &tx, &std::env::temp_dir(), launch, timeout);
        drop(tx);
        let replies = rx
            .iter()
            .map(|(_, path, reply)| match reply {
                Reply::Failed(why) => (path, why),
                Reply::Drew { .. } => (path, "drew".into()),
            })
            .collect();
        let left = queue.into_inner().unwrap().into_iter().map(|j| j.path).collect();
        (replies, left, gave_up)
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("visuals-index-bin-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_clock_starts_after_the_child_is_ready() {
        // Setup takes longer than the timeout; the answer itself is quick.
        let launch = sh(r#"sleep 1; echo ready; while read l; do echo '{"Failed":"answered"}'; done"#);
        let replies = run_driver(&launch, &["a"], Duration::from_millis(500));
        assert_eq!(replies, vec![(PathBuf::from("a"), "answered".into())]);
    }

    #[test]
    fn children_that_never_start_end_the_driver_and_leave_every_preset_queued() {
        for script in ["echo hello", "exit 1"] {
            let started = Instant::now();
            let (replies, left, gave_up) = run_driver_whole(&sh(script), &["a", "b", "c", "d", "e"], Duration::from_secs(5));
            assert!(replies.is_empty(), "nothing skipped: {replies:?}");
            assert_eq!(left, ["a", "b", "c", "d", "e"].map(PathBuf::from), "requeued in order");
            assert!(gave_up.as_deref().is_some_and(|w| w.starts_with(&format!("{START_FAILURES} in a row"))), "{gave_up:?}");
            assert!(started.elapsed() < Duration::from_secs(5));
        }
    }

    #[test]
    fn a_child_that_fails_to_start_costs_its_preset_nothing_and_only_failures_in_a_row_count() {
        let dir = scratch("start-fails");
        let count = dir.join("starts");
        // Two of every three children end before they're ready: four failures in
        // all, never three in a row. The panic makes the driver start another.
        let launch = sh(&format!(
            r#"c=$(cat '{f}' 2>/dev/null || echo 0); c=$((c+1)); echo $c > '{f}'; [ $((c % 3)) -ne 0 ] && exit 1; echo ready; while read l; do case "$l" in *panic*) echo '{{"Failed":"panicked: boom"}}'; exit;; esac; echo '{{"Failed":"answered"}}'; done"#,
            f = count.display()
        ));
        let replies = run_driver(&launch, &["panic", "a"], Duration::from_secs(5));
        assert_eq!(replies, [(PathBuf::from("panic"), "panicked: boom".into()), (PathBuf::from("a"), "answered".into())]);
        assert_eq!(std::fs::read_to_string(&count).unwrap().trim(), "6");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_panic_restarts_the_child() {
        // Each reply counts the presets its process has been asked for.
        let launch = sh(r#"echo ready; n=0; while read l; do n=$((n+1)); case "$l" in *panic*) echo '{"Failed":"panicked: boom"}';; *) echo "{\"Failed\":\"answer $n\"}";; esac; done"#);
        let replies = run_driver(&launch, &["a", "panic", "b"], Duration::from_secs(5));
        let why: Vec<&str> = replies.iter().map(|(_, w)| w.as_str()).collect();
        assert_eq!(why, ["answer 1", "panicked: boom", "answer 1"]);
    }

    #[test]
    fn a_timeout_is_tried_once_more_at_the_back_of_the_queue() {
        let dir = scratch("retry");
        let marker = dir.join("slow-once");
        // `slow` hangs the first time only; `hang` always does. `exec` so the kill takes the sleep.
        let launch = sh(&format!(
            r#"echo ready; while read l; do case "$l" in *slow*) if [ ! -e '{m}' ]; then touch '{m}'; exec sleep 30; fi;; *hang*) exec sleep 30;; esac; echo '{{"Failed":"answered"}}'; done"#,
            m = marker.display()
        ));
        let replies = run_driver(&launch, &["slow", "a", "hang"], Duration::from_millis(500));
        let got: Vec<(&str, &str)> = replies.iter().map(|(p, w)| (p.to_str().unwrap(), w.as_str())).collect();
        assert_eq!(got, [("a", "answered"), ("slow", "answered"), ("hang", "timed out")]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn drawn_row(path: &str, hash: &str, analysis: u32) -> index::Row {
        let mut r = index::row(Path::new(path), hash.into());
        let mut look = Look::new(vec![10], 0.5, Some(3.0), 9.0);
        look.analysis = analysis;
        r.look = Some(look);
        r.thumbnail = Some(index::thumbnail_name(hash));
        r
    }

    #[test]
    fn only_looks_from_the_current_analysis_are_reused() {
        let mut old = Index::new(90);
        old.rows.push(drawn_row("A/now.milk", "aaaa", index::ANALYSIS));
        old.rows.push(drawn_row("A/before.milk", "bbbb", index::ANALYSIS - 1));
        old.rows.push(drawn_row("A/lost.milk", "cccc", index::ANALYSIS));
        old.skipped.push(Skipped { path: "A/x.milk".into(), hash: "dddd".into(), why: "crashed".into() });
        let on_disk = |t: &str| t != index::thumbnail_name("cccc");
        let known = Known::from(Some(&old), on_disk, false);
        assert_eq!(known.drawn.keys().collect::<Vec<_>>(), ["aaaa"]);
        assert_eq!(known.failed.get("dddd").map(String::as_str), Some("crashed"));
        assert!(Known::from(Some(&old), on_disk, true).failed.is_empty());
    }

    #[test]
    fn rows_the_run_did_not_take_are_kept_while_in_the_folder() {
        let mut old = Index::new(90);
        old.rows.push(drawn_row("A/taken.milk", "aaaa", index::ANALYSIS));
        old.rows.push(drawn_row("A/kept.milk", "bbbb", index::ANALYSIS - 1));
        old.rows.push(drawn_row("A/gone.milk", "cccc", index::ANALYSIS));
        old.rows.push(index::row(Path::new("B/hung.milk"), "dddd".into()));
        old.skipped.push(Skipped { path: "B/hung.milk".into(), hash: "dddd".into(), why: "timed out".into() });
        old.skipped.push(Skipped { path: "B/gone.milk".into(), hash: "eeee".into(), why: "timed out".into() });
        let folder: HashSet<String> = ["A/taken.milk", "A/kept.milk", "B/hung.milk"].map(String::from).into();
        let taken: HashSet<String> = ["A/taken.milk".to_string()].into();
        let mut index = Index::new(90);
        carry(&mut index, Some(&old), &folder, &taken, |_| true);
        let paths: Vec<&str> = index.rows.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(paths, ["A/kept.milk", "B/hung.milk"]);
        assert_eq!(index.rows[0], old.rows[1], "kept as it was, its analysis too");
        assert_eq!(index.skipped, vec![old.skipped[0].clone()]);

        let mut index = Index::new(90);
        carry(&mut index, Some(&old), &folder, &taken, |_| false);
        assert_eq!((index.rows[0].look.as_ref(), index.rows[0].thumbnail.as_ref()), (None, None), "no thumbnail on disk, no look");
    }

    #[test]
    fn index_paths_use_slashes() {
        assert_eq!(index_path(&Path::new("A").join("B").join("c.milk")), "A/B/c.milk");
        assert_eq!(index_path(Path::new("A/x.milk")), index::row(Path::new("A/x.milk"), String::new()).path);
    }

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
