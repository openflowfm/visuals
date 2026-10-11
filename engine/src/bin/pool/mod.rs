//! Presets drawn in child processes, shared by the bins that draw a whole pack
//! (`index`, `features`).
//!
//! A bin runs itself as children (its own `--child` flag, in [`Launch`]), each
//! of which makes its state once ([`child`]'s `setup`, getting its GPU), says
//! [`READY`], then answers one JSON [`Reply`] line for each `<preset>\t<out>`
//! line it's sent. Drivers ([`drive`], one thread each) share a [`Queue`] of
//! presets and a child apiece, so one stuck past the timeout — a Metal compile
//! can't be interrupted — is killed and the run goes on. The clock starts once
//! the child has its GPU. A preset that times out goes to the back of the queue
//! for one more try in a fresh child; a second timeout fails it. A child whose
//! preset panicked is restarted, so no preset draws on a renderer a panic left
//! half-way. A child that fails to start doesn't cost its preset anything: the
//! preset goes back on the queue. After [`START_FAILURES`] such failures in a
//! row a driver gives up, and the drivers still going draw what it put back
//! (one that ran out of presets waits while others hold some, in case they
//! come back).

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::Duration;

/// What a child prints once it has its GPU and renderer, before any preset.
const READY: &str = "ready";
/// How long a child may take to get its GPU; not counted against the timeout.
const SETUP: Duration = Duration::from_secs(120);
/// How many times a preset is tried before a timeout fails it.
const TRIES: u32 = 2;
/// How many children in a row may fail to start before a driver gives up: no
/// GPU, or a broken build, fails every child, and a run must end rather than
/// try the whole pack (or hang a CI job doing it).
const START_FAILURES: u32 = 3;

/// A child's answer for one preset: drawn, or failed with why.
pub trait Reply: Serialize + DeserializeOwned + Send + 'static {
    /// A failure, and why.
    fn failed(why: String) -> Self;
    /// Why it failed; None when it drew.
    fn why(&self) -> Option<&str>;
    /// A panic leaves the child's renderer half-way: `why` starts with "panicked".
    fn panicked(&self) -> bool {
        self.why().is_some_and(|w| w.starts_with("panicked"))
    }
}

/// How to start a child.
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// A preset to draw, and how many times it's been tried.
#[derive(Debug, Clone)]
pub struct Job {
    pub hash: String,
    pub path: PathBuf,
    pub tries: u32,
}

/// The presets still to draw, shared by the drivers. A driver takes one at a
/// time and then either finishes it ([`Queue::done`]) or puts it back
/// ([`Queue::put_back`]). A driver that finds the queue empty waits while
/// another still holds a preset, since it may come back (a timeout to try
/// again, or a driver giving up), so a preset put back late is still drawn by
/// the drivers left rather than by the next run.
pub struct Queue {
    state: Mutex<Pending>,
    changed: Condvar,
}

struct Pending {
    jobs: VecDeque<Job>,
    /// Presets taken and not yet finished or put back.
    out: usize,
    /// Drivers waiting in [`Queue::take`].
    waiting: usize,
}

impl Queue {
    pub fn new(jobs: VecDeque<Job>) -> Queue {
        Queue { state: Mutex::new(Pending { jobs, out: 0, waiting: 0 }), changed: Condvar::new() }
    }

    fn lock(&self) -> MutexGuard<'_, Pending> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The next preset, waiting while the queue is empty but presets are out;
    /// `None` once there's nothing left to draw or to come back.
    pub fn take(&self) -> Option<Job> {
        let mut s = self.lock();
        loop {
            if let Some(job) = s.jobs.pop_front() {
                s.out += 1;
                return Some(job);
            }
            if s.out == 0 {
                return None;
            }
            s.waiting += 1;
            self.changed.notify_all();
            s = self.changed.wait(s).unwrap_or_else(|e| e.into_inner());
            s.waiting -= 1;
        }
    }

    /// Waits until a driver is waiting in [`Queue::take`].
    #[cfg(test)]
    fn until_waiting(&self) {
        let mut s = self.lock();
        while s.waiting == 0 {
            s = self.changed.wait(s).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// A taken preset is finished.
    pub fn done(&self) {
        self.lock().out -= 1;
        self.changed.notify_all();
    }

    /// A taken preset goes back: to the front (untried) or the back (to try again later).
    pub fn put_back(&self, job: Job, front: bool) {
        let mut s = self.lock();
        s.out -= 1;
        if front {
            s.jobs.push_front(job);
        } else {
            s.jobs.push_back(job);
        }
        drop(s);
        self.changed.notify_all();
    }

    /// The presets nobody drew.
    pub fn left(&self) -> Vec<Job> {
        self.lock().jobs.iter().cloned().collect()
    }
}

/// A preset taken from a [`Queue`], until it is finished ([`Taken::done`]) or
/// put back ([`Taken::put_back`]). Dropped without either, as when its driver
/// panics, it counts as finished undrawn, so the other drivers don't wait for
/// it forever; the next run draws it. `who` prefixes the line saying so.
struct Taken<'a> {
    who: &'a str,
    queue: &'a Queue,
    job: Option<Job>,
}

impl<'a> Taken<'a> {
    fn new(who: &'a str, queue: &'a Queue, job: Job) -> Taken<'a> {
        Taken { who, queue, job: Some(job) }
    }

    fn job(&mut self) -> &mut Job {
        self.job.as_mut().expect("a taken job")
    }

    fn done(mut self) -> Job {
        let job = self.job.take().expect("a taken job");
        self.queue.done();
        job
    }

    fn put_back(mut self, front: bool) {
        self.queue.put_back(self.job.take().expect("a taken job"), front);
    }
}

impl Drop for Taken<'_> {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            eprintln!("{}: its driver stopped while drawing it; the next run draws it\t{}", self.who, job.path.display());
            self.queue.done();
        }
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
enum Outcome<R> {
    Replied(R),
    TimedOut,
    Crashed,
}

fn ask<R: Reply>(r: &mut Running, preset: &Path, out: &Path, timeout: Duration) -> Outcome<R> {
    if writeln!(r.stdin, "{}\t{}", preset.display(), out.display()).and_then(|_| r.stdin.flush()).is_err() {
        return Outcome::Crashed;
    }
    match r.lines.recv_timeout(timeout) {
        Ok(line) => Outcome::Replied(serde_json::from_str(&line).unwrap_or_else(|e| R::failed(format!("failed: bad reply {line:?}: {e}")))),
        Err(RecvTimeoutError::Timeout) => Outcome::TimedOut,
        Err(RecvTimeoutError::Disconnected) => Outcome::Crashed,
    }
}

/// Draws presets from `queue` in a child until there are none left, nor any
/// out with other drivers ([`Queue::take`]), sending each reply to `results`
/// with its preset's hash and path. `who` prefixes its stderr lines ("index",
/// "features"); `out(hash)` is the file path sent to the child after a tab.
/// The child is restarted after a timeout, a crash or a panic; a preset that
/// times out goes to the back of the queue until it has had [`TRIES`]. A preset
/// whose child fails to start goes back on the queue untried; after
/// [`START_FAILURES`] in a row this driver gives up, returning why, and the
/// other drivers draw what it put back.
pub fn drive<R: Reply>(who: &str, queue: &Queue, results: &mpsc::Sender<(String, PathBuf, R)>, out: &dyn Fn(&str) -> PathBuf, launch: &Launch, timeout: Duration) -> Option<String> {
    let mut running: Option<Running> = None;
    let mut failures = 0;
    let mut gave_up = None;
    loop {
        let Some(job) = queue.take() else { break };
        // From here a panic can't leave the preset out for good.
        let mut taken = Taken::new(who, queue, job);
        let mut r = match running.take().map_or_else(|| spawn(launch), Ok) {
            Ok(r) => {
                failures = 0;
                r
            }
            Err(e) => {
                failures += 1;
                eprintln!("{who}: can't start a child ({failures} in a row): {e}");
                taken.put_back(true);
                if failures >= START_FAILURES {
                    gave_up = Some(format!("{failures} in a row, the last: {e}"));
                    break;
                }
                continue;
            }
        };
        let job = taken.job();
        job.tries += 1;
        let (tries, path) = (job.tries, job.path.clone());
        let file = out(&job.hash);
        let reply = match ask::<R>(&mut r, &path, &file, timeout) {
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
                if tries < TRIES {
                    eprintln!("{who}: timed out, trying again later\t{}", path.display());
                    taken.put_back(false);
                    continue;
                }
                R::failed("timed out".into())
            }
            Outcome::Crashed => {
                stop(r);
                R::failed("crashed".into())
            }
        };
        let job = taken.done();
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

/// The child: makes its state with `setup` (getting its GPU), says [`READY`],
/// then for each `<preset>\t<out>` line on stdin draws it with `draw` and
/// answers one JSON [`Reply`] line. An error is answered as "failed: …"; a
/// panic (its hook silenced) as "panicked: …", after which the child ends and
/// its parent starts a fresh one.
pub fn child<S, R: Reply>(setup: impl FnOnce() -> S, mut draw: impl FnMut(&mut S, &Path, &Path) -> Result<R, String>) {
    let mut state = setup();
    std::panic::set_hook(Box::new(|_| {}));
    let stdout = std::io::stdout();
    {
        let mut out = stdout.lock();
        if writeln!(out, "{READY}").and_then(|_| out.flush()).is_err() {
            return;
        }
    }
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Some((preset, file)) = line.split_once('\t') else { continue };
        let reply = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| draw(&mut state, Path::new(preset), Path::new(file)))) {
            Ok(Ok(reply)) => reply,
            Ok(Err(e)) => R::failed(format!("failed: {e}")),
            Err(p) => R::failed(format!("panicked: {}", p.downcast_ref::<String>().map(String::as_str).or(p.downcast_ref::<&str>().copied()).unwrap_or("?"))),
        };
        let panicked = reply.panicked();
        let mut out = stdout.lock();
        if writeln!(out, "{}", serde_json::to_string(&reply).expect("a reply serialises")).and_then(|_| out.flush()).is_err() || panicked {
            // After a panic the parent starts a fresh child.
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::sync::Arc;
    use std::time::Instant;

    /// A stand-in reply, on the wire as a bin's own: `{"Failed":"why"}`.
    #[derive(Debug, Serialize, Deserialize)]
    enum Answer {
        #[allow(dead_code)] // what a GPU child would send; these stand-ins never draw
        Drew,
        Failed(String),
    }

    impl Reply for Answer {
        fn failed(why: String) -> Self {
            Answer::Failed(why)
        }

        fn why(&self) -> Option<&str> {
            match self {
                Answer::Drew => None,
                Answer::Failed(why) => Some(why),
            }
        }
    }

    /// A child that's `sh -c script`: tests drive the real driver against a
    /// stand-in that speaks the same lines without a GPU.
    fn sh(script: &str) -> Launch {
        Launch { program: "/bin/sh".into(), args: vec!["-c".into(), script.into()] }
    }

    fn tmp(_: &str) -> PathBuf {
        std::env::temp_dir()
    }

    /// Runs `presets` through one driver with `launch`; the replies in order.
    fn run_driver(launch: &Launch, presets: &[&str], timeout: Duration) -> Vec<(PathBuf, String)> {
        let (replies, left, gave_up) = run_driver_whole(launch, presets, timeout);
        assert!(left.is_empty() && gave_up.is_none(), "{left:?} {gave_up:?}");
        replies
    }

    /// The same, with the presets left on the queue and why the driver gave up.
    fn run_driver_whole(launch: &Launch, presets: &[&str], timeout: Duration) -> (Vec<(PathBuf, String)>, Vec<PathBuf>, Option<String>) {
        let queue = jobs(presets);
        let (tx, rx) = mpsc::channel();
        let gave_up = drive::<Answer>("test", &queue, &tx, &tmp, launch, timeout);
        drop(tx);
        let left = queue.left().into_iter().map(|j| j.path).collect();
        (answers(rx), left, gave_up)
    }

    fn jobs(presets: &[&str]) -> Queue {
        Queue::new(presets.iter().map(|p| Job { hash: format!("{p}hash"), path: PathBuf::from(p), tries: 0 }).collect())
    }

    fn answers(rx: Receiver<(String, PathBuf, Answer)>) -> Vec<(PathBuf, String)> {
        rx.iter().map(|(_, path, reply)| (path, reply.why().unwrap_or("drew").to_string())).collect()
    }

    #[test]
    fn a_preset_put_back_after_the_queue_ran_dry_is_still_drawn() {
        // Another driver holds `late` (here, the test): the driver finds the
        // queue empty and waits, rather than ending, until it comes back.
        let queue = Arc::new(jobs(&["late"]));
        let held = queue.take().unwrap();
        let (tx, rx) = mpsc::channel();
        let driver = {
            let queue = queue.clone();
            let launch = sh(r#"echo ready; while read l; do echo '{"Failed":"answered"}'; done"#);
            std::thread::spawn(move || drive::<Answer>("test", &queue, &tx, &tmp, &launch, Duration::from_secs(5)))
        };
        // Once the driver waits, the holder gives up on it, as a driver whose
        // children won't start does.
        queue.until_waiting();
        queue.put_back(held, true);
        assert_eq!(driver.join().unwrap(), None);
        assert_eq!(answers(rx), [(PathBuf::from("late"), "answered".into())]);
        assert!(queue.left().is_empty());

        // With nothing out, an empty queue ends a driver at once.
        let (tx, rx) = mpsc::channel();
        assert_eq!(drive::<Answer>("test", &jobs(&[]), &tx, &tmp, &sh("exit 1"), Duration::from_secs(5)), None);
        drop(tx);
        assert!(answers(rx).is_empty());
    }

    #[test]
    fn a_driver_that_panics_holding_a_preset_doesnt_leave_the_others_waiting() {
        // The test holds `lost` as a driver would; the driver waits for it.
        let queue = Arc::new(jobs(&["lost"]));
        let held = queue.take().unwrap();
        let (tx, rx) = mpsc::channel();
        let driver = {
            let queue = queue.clone();
            std::thread::spawn(move || drive::<Answer>("test", &queue, &tx, &tmp, &sh("exit 1"), Duration::from_secs(5)))
        };
        let holder = {
            let queue = queue.clone();
            std::thread::spawn(move || {
                let _taken = Taken::new("test", &queue, held);
                queue.until_waiting();
                panic!("a driver panics between take and done");
            })
        };
        assert!(holder.join().is_err(), "it panicked");
        assert_eq!(driver.join().unwrap(), None, "and the waiting driver ended");
        assert!(answers(rx).is_empty());
        assert!(queue.left().is_empty());
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("visuals-pool-bin-{name}-{}", std::process::id()));
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
    fn the_out_path_follows_the_preset_after_a_tab() {
        // The child answers with what it was sent, so the line is checked as is.
        let launch = sh(r#"echo ready; while IFS= read -r l; do printf '{"Failed":"%s"}\n' "$(printf '%s' "$l" | tr '\t' '|')"; done"#);
        let queue = jobs(&["a.milk"]);
        let (tx, rx) = mpsc::channel();
        let out = |h: &str| PathBuf::from(format!("/out/{h}.webp"));
        assert_eq!(drive::<Answer>("test", &queue, &tx, &out, &launch, Duration::from_secs(5)), None);
        drop(tx);
        assert_eq!(answers(rx), [(PathBuf::from("a.milk"), "a.milk|/out/a.milkhash.webp".into())]);
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
}
