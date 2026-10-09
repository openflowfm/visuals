//! Crash reports, with no server and no telemetry (#102): a crash is written to
//! a file on this machine, in `~/.openflow/visuals/crashes/`, and "Send report"
//! opens a prefilled GitHub issue that the user looks over and submits
//! themselves. Nothing is ever sent by the app.
//!
//! A report is written only when the app actually ends abnormally:
//! - a Rust panic that isn't caught: the panic hook [`install`] sets keeps its
//!   text in memory (and in this run's marker file). It becomes a report only
//!   when the process actually died of it: on the main thread it's written at
//!   exit, and otherwise on the next launch, from the marker of a process that
//!   is gone. At a clean exit the other pending panics are dropped: they were
//!   survived (tokio caught one in an async command, a rayon worker's or a
//!   joined thread's was handed on). A panic caught with [`catch`] is
//!   forgotten at once, so it never hides a later real crash.
//! - an exit that didn't go through `exit()` (a crash in native code, an abort,
//!   a force quit), noticed on the next launch: [`install`] leaves a marker
//!   file per process, `running-<pid>`, that a clean exit removes (an `atexit`
//!   handler). Only markers whose process is gone count, so a second copy of
//!   the app running alongside isn't reported. SIGTERM, SIGINT (Ctrl-C) and
//!   SIGHUP skip `atexit`, so a handler removes the marker for them (they're
//!   asked for, not crashes); a SIGKILL (Activity Monitor's Force Quit) can't
//!   be handled and counts as unclean.
//!
//! A report holds the app's version, the macOS version, the chip, what went
//! wrong with its backtrace, and the name of the preset on screen when it's from
//! our own packs (the starter set or the full pack; any other is "a preset of
//! your own", decision 54); never audio, file paths (only file names are kept),
//! the user's name or the Mac's, which are collected before the panic hook is
//! set so even the earliest crash has them scrubbed. Reports are always
//! written; turning them on (off by default) only makes the page offer the new
//! ones on the next launch. The last [`KEEP`] are kept.

use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::ThreadId;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// How many reports are kept; older ones are deleted.
const KEEP: usize = 20;
/// Whether reports are on, in [`crate::settings::dir`].
const SETTING: &str = "crash_reports.json";
/// Left in the crashes folder while the app runs, followed by the pid; removed by a clean exit.
const MARKER: &str = "running-";
/// Where "Send report" goes.
const NEW_ISSUE: &str = "https://github.com/openflowfm/visuals/issues/new";
/// The longest issue link made: GitHub and browsers take about 8 KB.
const URL_MAX: usize = 8000;
/// The full pack's folder in the presets folder (`pack.rs` unpacks it there).
const PACK_FOLDER: &str = "cream-of-the-crop";
/// What a report says instead of the name of a preset that isn't from our own packs.
const OWN_PRESET: &str = "a preset of your own";
/// Stands for [`OWN_PRESET`] while a text is scrubbed, so nothing after matches inside it.
const OWN_MARK: char = '\u{1}';

/// One crash, written locally.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CrashReport {
    pub id: String,
    /// Unix seconds.
    pub when: u64,
    /// One line on what went wrong.
    pub summary: String,
    /// The whole report, as "Send report" puts it in the issue (before it's cut to fit the link).
    pub text: String,
    /// "Send report" was used on it.
    pub sent: bool,
}

/// The crash reports kept, newest first.
#[tauri::command]
pub fn crash_reports(app: AppHandle) -> Vec<CrashReport> {
    remember(app);
    list(&dir())
}

/// Opens the GitHub issue for report `id`, prefilled for the user to submit, and marks it sent.
#[tauri::command]
pub fn crash_report_open(app: AppHandle, id: String) -> Result<(), String> {
    let dir = dir();
    let mut report = read(&dir, &id).ok_or_else(|| format!("There's no crash report {id}."))?;
    app.opener().open_url(issue_url(&report), None::<&str>).map_err(|e| e.to_string())?;
    report.sent = true;
    write(&dir, &report).map_err(|e| e.to_string())?;
    remember(app);
    Ok(())
}

/// Whether the page offers new crash reports on launch. Off until turned on.
#[tauri::command]
pub fn crash_reports_enabled(app: AppHandle) -> bool {
    remember(app);
    enabled_in(&crate::settings::dir())
}

/// Turns offering crash reports on or off. They are written either way.
#[tauri::command]
pub fn crash_reports_enable(on: bool) -> Result<(), String> {
    enable_in(&crate::settings::dir(), on).map_err(|e| e.to_string())
}

/// Called first thing in `main`: notes an unclean last exit, marks this run as
/// started, and sets the panic hook.
pub fn install() {
    let dir = dir();
    let _ = MAIN_THREAD.set(std::thread::current().id());
    let machine = MACHINE.get_or_init(Machine::here);
    // Headless test runs are killed rather than quit: not a crash worth a report.
    if std::env::var_os("VISUALS_HEADLESS").is_none() {
        let now = now();
        STARTED.store(now, Ordering::Relaxed);
        for report in unclean_exits(&dir, machine, now, alive) {
            let _ = write(&dir, &report);
        }
        let marker = dir.join(format!("{MARKER}{}", std::process::id()));
        if save_marker(&marker, &Marker { started: now, panics: Vec::new() }).is_ok() {
            if let Ok(c) = std::ffi::CString::new(marker.as_os_str().as_encoded_bytes()) {
                let _ = MARKER_C.set(c);
            }
            let _ = MARKER_PATH.set(marker);
            // SAFETY: `atexit` and `signal` from the C library, given functions that never unwind;
            // the signal handler only does async-signal-safe things.
            unsafe {
                atexit(at_exit);
                for sig in [SIGHUP, SIGINT, SIGTERM] {
                    if signal(sig, on_signal as extern "C" fn(std::ffi::c_int) as usize) == SIG_IGN {
                        signal(sig, SIG_IGN);
                    }
                }
            }
        }
    }
    rotate(&dir, KEEP);
    let _ = OWN_PACK.set(engine::preset::pack_dir().join(PACK_FOLDER));
    // Who the user is and what the Mac is called, before the hook is set, so even a
    // crash in the first moments has them scrubbed (decision 54).
    if !collect_names(NAMES_WAIT) {
        eprintln!("crash reports: the names to scrub took over {NAMES_WAIT:?}; they're added when ready");
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        guarded(|| keep_panic(info));
        previous(info);
    }));
}

/// The longest [`install`] waits for the names to scrub (usually a few ms: one
/// `scutil` run and two system calls). Past it the app starts anyway and they
/// fill in when ready; a panic before then scrubs the home folder and login.
const NAMES_WAIT: Duration = Duration::from_secs(1);

/// Works out [`PRIVATE`] off this thread, waiting at most `wait` for it. True when it's ready.
fn collect_names(wait: Duration) -> bool {
    wait_for(|| _ = PRIVATE.get_or_init(Private::here), wait)
}

/// Runs `work` on a thread of its own and waits at most `wait` for it to finish;
/// past that it goes on in the background. True when it finished in time.
fn wait_for(work: impl FnOnce() + Send + 'static, wait: Duration) -> bool {
    let (done, finished) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("crash-private".into()).spawn(move || {
        work();
        let _ = done.send(());
    });
    spawned.is_ok() && finished.recv_timeout(wait).is_ok()
}

/// Called from the app's setup: the app (to read the preset on screen) and the
/// bundled starter set's folder, whose presets are ours to name.
pub fn start(app: &AppHandle) {
    if let Some(starter) = crate::pack::starter(app) {
        let _ = OWN_STARTER.set(starter);
    }
    remember(app.clone());
}

/// Runs `f` unless this thread is already in it, and catches a panic from it:
/// a panic while keeping a report must never abort the app or skip the previous hook.
fn guarded(f: impl FnOnce()) {
    if !IN_HOOK.try_with(|h| h.replace(true)).unwrap_or(true) {
        let _ = std::panic::catch_unwind(AssertUnwindSafe(f));
        let _ = IN_HOOK.try_with(|h| h.set(false));
    }
}

/// `std::panic::catch_unwind`, and a panic it catches isn't reported: use it
/// wherever a panic is caught and the app carries on.
pub fn catch<R>(f: impl FnOnce() -> R + std::panic::UnwindSafe) -> std::thread::Result<R> {
    let result = std::panic::catch_unwind(f);
    if result.is_err() {
        forget_panic(std::thread::current().id());
    }
    result
}

thread_local! {
    static IN_HOOK: Cell<bool> = const { Cell::new(false) };
}

/// The app, once the page has called in, to read the preset on screen at a crash.
static HANDLE: OnceLock<AppHandle> = OnceLock::new();
static MACHINE: OnceLock<Machine> = OnceLock::new();
static MARKER_PATH: OnceLock<PathBuf> = OnceLock::new();
/// The marker's path for the signal handler, which mustn't allocate.
static MARKER_C: OnceLock<std::ffi::CString> = OnceLock::new();
static PRIVATE: OnceLock<Private> = OnceLock::new();
/// The full pack's folder in the presets folder (openflowfm/visual-presets, or projectM's same presets as its fallback).
static OWN_PACK: OnceLock<PathBuf> = OnceLock::new();
/// The starter set bundled with the app, once [`start`] has run.
static OWN_STARTER: OnceLock<PathBuf> = OnceLock::new();
/// The thread [`install`] ran on: `main`'s, whose panic ends the process.
static MAIN_THREAD: OnceLock<ThreadId> = OnceLock::new();
/// When this run started, as its marker says.
static STARTED: AtomicU64 = AtomicU64::new(0);
/// Panics not (yet) caught, by thread: reported at exit, or from the marker on the next launch.
static PENDING: Mutex<Vec<(ThreadId, CrashReport)>> = Mutex::new(Vec::new());
/// Whether [`PENDING`] has any, for the signal handler, which can't lock.
static ANY_PENDING: AtomicBool = AtomicBool::new(false);
/// Tells apart reports made in the same millisecond.
static COUNT: AtomicU32 = AtomicU32::new(0);

fn remember(app: AppHandle) {
    let _ = HANDLE.set(app);
}

const SIGHUP: std::ffi::c_int = 1;
const SIGINT: std::ffi::c_int = 2;
const SIGTERM: std::ffi::c_int = 15;
const SIG_DFL: usize = 0;
const SIG_IGN: usize = 1;

unsafe extern "C" {
    fn atexit(f: extern "C" fn()) -> std::ffi::c_int;
    fn kill(pid: std::ffi::c_int, sig: std::ffi::c_int) -> std::ffi::c_int;
    fn signal(sig: std::ffi::c_int, handler: usize) -> usize;
    fn raise(sig: std::ffi::c_int) -> std::ffi::c_int;
    fn unlink(path: *const std::ffi::c_char) -> std::ffi::c_int;
}

/// SIGTERM, SIGINT or SIGHUP: the app was asked to stop, which isn't a crash, so
/// the marker goes (unless it holds a panic nothing caught), then the signal
/// does what it would have done.
extern "C" fn on_signal(sig: std::ffi::c_int) {
    // SAFETY: `unlink`, `signal` and `raise` are async-signal-safe; the path was made before the handler was set.
    unsafe {
        if !ANY_PENDING.load(Ordering::Relaxed)
            && let Some(path) = MARKER_C.get()
        {
            unlink(path.as_ptr());
        }
        signal(sig, SIG_DFL);
        raise(sig);
    }
}

fn pending() -> std::sync::MutexGuard<'static, Vec<(ThreadId, CrashReport)>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// What this run's marker holds: when it started and the panics not caught so far.
#[derive(Serialize, Deserialize, Default)]
struct Marker {
    started: u64,
    panics: Vec<CrashReport>,
}

fn save_marker(path: &Path, marker: &Marker) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string(marker).map_err(std::io::Error::other)?)
}

/// Writes the pending panics into this run's marker, for the next launch should the process die.
fn update_marker(pending: &[(ThreadId, CrashReport)]) {
    ANY_PENDING.store(!pending.is_empty(), Ordering::Relaxed);
    if let Some(path) = MARKER_PATH.get() {
        let _ = save_marker(path, &Marker { started: STARTED.load(Ordering::Relaxed), panics: pending.iter().map(|(_, r)| r.clone()).collect() });
    }
}

/// Drops the newest pending panic of `thread`: it was caught.
fn forget_panic(thread: ThreadId) {
    let mut pending = pending();
    if let Some(at) = pending.iter().rposition(|(t, _)| *t == thread) {
        pending.remove(at);
        update_marker(&pending);
    }
}

/// The pending panics that ended the process, from those still pending at exit:
/// only the main thread's. The rest were survived, so they're dropped.
fn died_of(pending: Vec<(ThreadId, CrashReport)>, main: Option<ThreadId>) -> Vec<CrashReport> {
    pending.into_iter().filter(|(t, _)| Some(*t) == main).map(|(_, r)| r).collect()
}

/// At exit: a main-thread panic becomes a report, other pending panics are dropped, and the marker goes.
extern "C" fn at_exit() {
    let _ = std::panic::catch_unwind(|| {
        let reports = died_of(std::mem::take(&mut *pending()), MAIN_THREAD.get().copied());
        if !reports.is_empty() {
            let dir = dir();
            for report in &reports {
                let _ = write(&dir, report);
            }
            rotate(&dir, KEEP);
        }
        if let Some(path) = MARKER_PATH.get() {
            let _ = std::fs::remove_file(path);
        }
    });
}

/// Whether process `pid` is still running.
fn alive(pid: u32) -> bool {
    let Ok(pid @ 1..) = std::ffi::c_int::try_from(pid) else { return false };
    // SAFETY: signal 0 only checks the process exists; nothing is sent.
    let exists = unsafe { kill(pid, 0) } == 0;
    // EPERM: it exists, run by someone else.
    exists || std::io::Error::last_os_error().raw_os_error() == Some(1)
}

/// `~/.openflow/visuals/crashes`.
fn dir() -> PathBuf {
    crate::settings::dir().join("crashes")
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A new report's id: the time in milliseconds (so ids sort by age), the process and a count.
fn new_id() -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{millis:013}-{}-{}", std::process::id(), COUNT.fetch_add(1, Ordering::Relaxed))
}

/// Only ids [`new_id`] could make, so an id never reaches outside the folder.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[derive(Serialize, Deserialize, Default)]
struct Setting {
    on: bool,
}

fn enabled_in(settings: &Path) -> bool {
    std::fs::read_to_string(settings.join(SETTING)).ok().and_then(|t| serde_json::from_str::<Setting>(&t).ok()).is_some_and(|s| s.on)
}

fn enable_in(settings: &Path, on: bool) -> std::io::Result<()> {
    std::fs::create_dir_all(settings)?;
    std::fs::write(settings.join(SETTING), serde_json::to_string_pretty(&Setting { on }).unwrap_or_default())
}

fn read(dir: &Path, id: &str) -> Option<CrashReport> {
    if !valid_id(id) {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{id}.json"))).ok()?).ok()
}

fn write(dir: &Path, report: &CrashReport) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(report).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(format!("{}.json", report.id)), text)
}

/// The report files' ids, oldest first.
fn ids(dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> =
        std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| e.file_name().to_str()?.strip_suffix(".json").map(str::to_owned)).filter(|id| valid_id(id)).collect();
    ids.sort();
    ids
}

/// The reports in `dir`, newest first.
fn list(dir: &Path) -> Vec<CrashReport> {
    ids(dir).iter().rev().filter_map(|id| read(dir, id)).collect()
}

/// Deletes all but the newest `keep` reports.
fn rotate(dir: &Path, keep: usize) {
    let ids = ids(dir);
    for id in &ids[..ids.len().saturating_sub(keep)] {
        let _ = std::fs::remove_file(dir.join(format!("{id}.json")));
    }
}

/// What a report says about this machine.
#[derive(Clone, Debug, PartialEq)]
struct Machine {
    version: String,
    macos: String,
    chip: String,
}

impl Machine {
    fn here() -> Machine {
        Machine { version: env!("CARGO_PKG_VERSION").into(), macos: macos_version().unwrap_or_else(|| "unknown".into()), chip: chip().unwrap_or_else(|| "unknown".into()) }
    }
}

/// The macOS version, from the system's own plist (no process started).
fn macos_version() -> Option<String> {
    let plist = std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
    plist_string(&plist, "ProductVersion")
}

/// The `<string>` after `<key>key</key>` in a plist's XML.
fn plist_string(plist: &str, key: &str) -> Option<String> {
    let after = &plist[plist.find(&format!("<key>{key}</key>"))?..];
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")?;
    Some(after[start..start + end].trim().to_owned())
}

#[cfg(target_os = "macos")]
fn chip() -> Option<String> {
    unsafe extern "C" {
        fn sysctlbyname(name: *const std::ffi::c_char, oldp: *mut std::ffi::c_void, oldlenp: *mut usize, newp: *mut std::ffi::c_void, newlen: usize) -> std::ffi::c_int;
    }
    let mut buf = [0u8; 256];
    let mut len = buf.len();
    // SAFETY: a NUL-terminated name, and a buffer whose length is passed with it.
    let ok = unsafe { sysctlbyname(c"machdep.cpu.brand_string".as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) } == 0;
    let name = std::ffi::CStr::from_bytes_until_nul(&buf[..len.min(buf.len())]).ok()?.to_str().ok()?.trim().to_owned();
    (ok && !name.is_empty()).then_some(name)
}

#[cfg(not(target_os = "macos"))]
fn chip() -> Option<String> {
    Some(std::env::consts::ARCH.into())
}

/// The preset on screen, if the app has started and the deck isn't locked mid-change.
fn current_preset() -> Option<PathBuf> {
    let deck = HANDLE.get()?.try_state::<crate::actions::Deck>()?;
    let live = deck.live.try_lock().ok()?;
    live.current.clone()
}

/// A preset's name: its file name without the folder or `.milk`.
fn preset_name(path: &Path) -> Option<String> {
    Some(path.file_stem()?.to_string_lossy().into_owned())
}

/// Which presets a report may name (decision 54): only ours, from the folders in
/// `roots` (the starter set, the full pack). Any other preset is
/// [`OWN_PRESET`], and the name of the one on screen, when it isn't ours, is
/// hidden wherever it turns up.
struct Presets {
    roots: Vec<PathBuf>,
    /// The on-screen preset's file name and name, when it isn't ours; longest first.
    hidden: Vec<String>,
}

impl Presets {
    fn new(roots: Vec<PathBuf>, on_screen: Option<&Path>) -> Presets {
        let mut presets = Presets { roots, hidden: Vec::new() };
        if let Some(path) = on_screen.filter(|p| !presets.ours(p)) {
            presets.hidden = [path.file_name(), path.file_stem()].into_iter().flatten().map(|n| n.to_string_lossy().trim().to_owned()).filter(|n| n.chars().count() >= 3).collect();
            presets.hidden.sort_by_key(|n| std::cmp::Reverse(n.len()));
        }
        presets
    }

    /// Our folders as this run knows them, and the preset on screen.
    fn here(on_screen: Option<&Path>) -> Presets {
        Presets::new([OWN_PACK.get(), OWN_STARTER.get()].into_iter().flatten().cloned().collect(), on_screen)
    }

    /// Whether `path` is a preset from our own packs: inside one of their folders, with no `..` to climb out.
    fn ours(&self, path: &Path) -> bool {
        path.is_absolute() && !path.components().any(|c| matches!(c, std::path::Component::ParentDir)) && self.roots.iter().any(|r| path.starts_with(r))
    }

    /// How a report names the preset at `path`: by its name when it's ours, else [`OWN_MARK`] (for [`OWN_PRESET`]).
    fn name(&self, path: &Path) -> String {
        self.ours(path).then(|| preset_name(path)).flatten().unwrap_or_else(|| OWN_MARK.to_string())
    }
}

/// Where `.milk` ends in `name` (any case), when it's there and not part of a longer word.
fn milk_end(name: &str) -> Option<usize> {
    let lower = name.to_ascii_lowercase();
    lower.match_indices(".milk").map(|(at, m)| at + m.len()).find(|&end| !lower[end..].starts_with(char::is_alphanumeric))
}

/// What a panic said.
struct Panic {
    thread: String,
    location: Option<String>,
    message: String,
    backtrace: String,
}

/// Keeps a report of the panic in memory and in the marker, until it's caught or the app ends.
fn keep_panic(info: &std::panic::PanicHookInfo) {
    let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "(no message)".into());
    let panic = Panic {
        thread: std::thread::current().name().unwrap_or("unnamed").to_owned(),
        location: info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())),
        message,
        backtrace: std::backtrace::Backtrace::force_capture().to_string(),
    };
    let machine = MACHINE.get_or_init(Machine::here);
    // Never work the names out here (it starts `scutil`, and could wait on the thread doing it).
    let minimal;
    let private = match PRIVATE.get() {
        Some(p) => p,
        None => {
            minimal = Private::minimal();
            &minimal
        }
    };
    let on_screen = current_preset();
    let presets = Presets::here(on_screen.as_deref());
    let report = panic_report(new_id(), now(), &panic, machine, on_screen.as_deref(), private, &presets);
    let mut pending = pending();
    pending.push((std::thread::current().id(), report));
    update_marker(&pending);
}

/// What must not reach a report: the home folder, and the names of the user and the machine.
struct Private {
    home: Option<String>,
    /// Matched without regard to case, where a word starts; longest first.
    names: Vec<String>,
}

impl Private {
    /// The home folder and the user's login name.
    fn home_and_user() -> (Option<String>, Option<String>) {
        let home = std::env::var("HOME").ok().filter(|h| h.len() > 1);
        let user = std::env::var("USER").ok().or_else(|| home.as_deref().and_then(|h| Path::new(h).file_name()).map(|n| n.to_string_lossy().into_owned()));
        (home, user)
    }

    /// Only what's known without asking the system: for a panic before [`Private::here`] is ready.
    fn minimal() -> Private {
        let (home, user) = Private::home_and_user();
        Private::new(home, user.into_iter().collect())
    }

    fn here() -> Private {
        let (home, user) = Private::home_and_user();
        let mut names: Vec<String> = user.into_iter().collect();
        // The full name and each part of it ("Ryan Gavin", "Ryan", "Gavin").
        if let Some(full) = full_name() {
            names.extend(full.split(|c: char| !c.is_alphanumeric()).map(str::to_owned));
            names.push(full);
        }
        // The Mac's names whole, not split: "Ryan's MacBook Pro", "Ryans-MacBook-Pro.local".
        for name in [computer_name(), host_name()].into_iter().flatten() {
            if let Some((short, _)) = name.split_once('.') {
                names.push(short.to_owned());
            }
            names.push(name);
        }
        Private::new(home, names)
    }

    fn new(home: Option<String>, names: Vec<String>) -> Private {
        let mut names: Vec<String> = names.into_iter().map(|n| n.trim().to_owned()).filter(|n| n.chars().count() >= 3).collect();
        names.sort_by_key(|n| std::cmp::Reverse(n.len()));
        names.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
        Private { home, names }
    }
}

/// The user's full name, from the user database.
#[cfg(target_os = "macos")]
fn full_name() -> Option<String> {
    /// `struct passwd` as macOS lays it out.
    #[repr(C)]
    struct Passwd {
        name: *const std::ffi::c_char,
        passwd: *const std::ffi::c_char,
        uid: u32,
        gid: u32,
        change: std::ffi::c_long,
        class: *const std::ffi::c_char,
        gecos: *const std::ffi::c_char,
        dir: *const std::ffi::c_char,
        shell: *const std::ffi::c_char,
        expire: std::ffi::c_long,
    }
    unsafe extern "C" {
        fn getuid() -> u32;
        fn getpwuid(uid: u32) -> *const Passwd;
    }
    // SAFETY: `getpwuid` returns null or a valid entry whose strings are NUL-terminated or null.
    unsafe {
        let pw = getpwuid(getuid());
        if pw.is_null() || (*pw).gecos.is_null() {
            return None;
        }
        let gecos = std::ffi::CStr::from_ptr((*pw).gecos).to_string_lossy();
        Some(gecos.split(',').next()?.trim().to_owned()).filter(|n| !n.is_empty())
    }
}

#[cfg(not(target_os = "macos"))]
fn full_name() -> Option<String> {
    None
}

/// The Mac's name as Sharing shows it, such as `Ryan's MacBook Pro`.
#[cfg(target_os = "macos")]
fn computer_name() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).stderr(std::process::Stdio::null()).output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    (out.status.success() && !name.is_empty()).then_some(name)
}

#[cfg(not(target_os = "macos"))]
fn computer_name() -> Option<String> {
    None
}

/// This machine's host name, such as `Ryans-MacBook-Pro.local`.
fn host_name() -> Option<String> {
    unsafe extern "C" {
        fn gethostname(name: *mut std::ffi::c_char, len: usize) -> std::ffi::c_int;
    }
    let mut buf = [0u8; 256];
    // SAFETY: a buffer with its length; one byte is kept for the NUL.
    if unsafe { gethostname(buf.as_mut_ptr().cast(), buf.len() - 1) } != 0 {
        return None;
    }
    let name = std::ffi::CStr::from_bytes_until_nul(&buf).ok()?.to_string_lossy().trim().to_owned();
    (!name.is_empty()).then_some(name)
}

/// How many bytes at the start of `rest` match `needle` (already lowercased), comparing lowercased forms.
fn match_lowercase(rest: &str, needle: &[char]) -> Option<usize> {
    let mut k = 0;
    for (at, c) in rest.char_indices() {
        if k == needle.len() {
            return Some(at);
        }
        for l in c.to_lowercase() {
            if needle.get(k) != Some(&l) {
                return None;
            }
            k += 1;
        }
    }
    (k == needle.len()).then_some(rest.len())
}

/// `text` with every `needle` replaced by `with`, ignoring case (any script's);
/// with `word_start`, only where a word starts ("Ryan's" and "ryans-mac", not "Bryan").
fn replace_ignoring_case(text: &str, needle: &str, with: &str, word_start: bool) -> String {
    if needle.is_empty() {
        return text.to_owned();
    }
    let needle: Vec<char> = needle.to_lowercase().chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut prev: Option<char> = None;
    while let Some(c) = text[i..].chars().next() {
        let at_start = !word_start || !prev.is_some_and(char::is_alphanumeric);
        if let Some(len) = at_start.then(|| match_lowercase(&text[i..], &needle)).flatten() {
            let end = i + len;
            out.push_str(with);
            prev = text[..end].chars().next_back();
            i = end;
        } else {
            out.push(c);
            prev = Some(c);
            i += c.len_utf8();
        }
    }
    out
}

/// Where a path stops. Not at square brackets: the app's own name has them (`visual[flow].app`).
fn ends_path(c: char) -> bool {
    c.is_whitespace() || "\"'`()<>,;{}".contains(c)
}

/// `text` with every absolute path, spaces and all, cut to its file name
/// (`/a/My Drive/d.rs:3:1` → `d.rs:3:1`), the home folder dropped and the names
/// of the user and the machine replaced, whatever their case. A preset's path
/// (`….milk`) keeps its file name only when it's one of ours (`presets`); any
/// other, and the hidden name of the one on screen, become [`OWN_PRESET`].
fn scrub(text: &str, private: &Private, presets: &Presets) -> String {
    let mut text = text.to_owned();
    if let Some(home) = &private.home {
        text = replace_ignoring_case(&text, home, "~", false);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    let mut prev: Option<char> = None;
    while let Some(c) = rest.chars().next() {
        let starts_path = (c == '/' || rest.starts_with("~/")) && !prev.is_some_and(|p| p.is_alphanumeric() || "._-/~".contains(p));
        if starts_path {
            let mut end = rest.find(ends_path).unwrap_or(rest.len());
            // Words after single spaces are part of the path up to the last one with a `/` in it,
            // before anything else ends it: `/Volumes/My Backup Drive/x` is one path. A file
            // name with spaces at the end (`/a/My Song.wav`) is kept as it is.
            let mut scan = end;
            while rest[scan..].starts_with(' ') {
                let next = &rest[scan + 1..];
                let word = next.find(ends_path).unwrap_or(next.len());
                if word == 0 || next.starts_with('/') || next.starts_with("~/") {
                    break;
                }
                scan += 1 + word;
                if next[..word].contains('/') {
                    end = scan;
                } else if milk_end(&next[..word]).is_some() && milk_end(file_name(&rest[..end])).is_none() {
                    // A preset's file name with spaces in it (`/a/Geiss - Swirl.milk`) is part of its path.
                    end = scan;
                    break;
                }
            }
            let path = &rest[..end];
            let name = file_name(path);
            match milk_end(name) {
                Some(at) if !presets.ours(&unhome(&path[..path.len() - name.len() + at], private)) => {
                    out.push(OWN_MARK);
                    out.push_str(&name[at..]);
                }
                _ => out.push_str(name),
            }
            prev = path.chars().next_back();
            rest = &rest[end..];
        } else {
            out.push(c);
            prev = Some(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    for name in &presets.hidden {
        out = replace_ignoring_case(&out, name, &OWN_MARK.to_string(), true);
    }
    for name in &private.names {
        out = replace_ignoring_case(&out, name, "<user>", true);
    }
    out.replace(OWN_MARK, OWN_PRESET)
}

/// The last part of a path.
fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or("")
}

/// `path` with a leading `~/` put back to the home folder it stands for.
fn unhome(path: &str, private: &Private) -> PathBuf {
    match (path.strip_prefix("~/"), &private.home) {
        (Some(rest), Some(home)) => Path::new(home).join(rest),
        _ => PathBuf::from(path),
    }
}

fn header(machine: &Machine, preset: Option<&str>) -> String {
    format!("visual[flow] crash report\n\nVersion: {}\nmacOS: {}\nChip: {}\nPreset: {}\n", machine.version, machine.macos, machine.chip, preset.unwrap_or("none"))
}

/// The first line of `text`, at most 200 characters.
fn one_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    match line.char_indices().nth(200) {
        Some((at, _)) => format!("{}…", &line[..at]),
        None => line.to_owned(),
    }
}

/// The report of `panic`, with `preset` (the one on screen) named only when it's one of ours.
fn panic_report(id: String, when: u64, panic: &Panic, machine: &Machine, preset: Option<&Path>, private: &Private, presets: &Presets) -> CrashReport {
    let scrub = |text: &str| scrub(text, private, presets);
    let message = scrub(&panic.message);
    let location = panic.location.as_deref().map(scrub).unwrap_or_else(|| "an unknown place".into());
    let preset = preset.map(|p| scrub(&presets.name(p)));
    let text = format!("{}Thread: {}\n\nPanicked at {location}:\n{message}\n\nBacktrace:\n{}", header(machine, preset.as_deref()), scrub(&panic.thread), scrub(&panic.backtrace));
    CrashReport { id, when, summary: one_line(&format!("Panic: {message}")), text, sent: false }
}

/// Reports for the runs that ended without a clean exit: each marker whose
/// process is gone (`alive` says), with the panics it kept or else a report of
/// the unclean exit. Those markers are cleared; a running copy's is left alone.
fn unclean_exits(dir: &Path, machine: &Machine, now: u64, alive: impl Fn(u32) -> bool) -> Vec<CrashReport> {
    let mut reports = Vec::new();
    let own = std::process::id();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|n| n.strip_prefix(MARKER)).and_then(|p| p.parse::<u32>().ok()) else { continue };
        if pid == own || alive(pid) {
            continue;
        }
        let marker: Marker = std::fs::read_to_string(entry.path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let _ = std::fs::remove_file(entry.path());
        if !marker.panics.is_empty() {
            reports.extend(marker.panics);
            continue;
        }
        let started = marker.started;
        let summary = "visual[flow] quit unexpectedly (a crash outside Rust, or a force quit)".to_owned();
        let text = format!("{}\n{summary}. It started at {started} (Unix seconds) and was noticed at the next launch, {now}.\n", header(machine, None));
        reports.push(CrashReport { id: new_id(), when: now, summary, text, sent: false });
    }
    reports
}

/// A code fence longer than any run of backticks in `text`, so the text can't close it.
fn fence(text: &str) -> String {
    let mut longest = 0;
    let mut run = 0;
    for c in text.chars() {
        run = if c == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    "`".repeat(longest.max(2) + 1)
}

/// `text` percent-encoded for a URL query.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The link to a new issue on openflowfm/visuals with `report` filled in, at most
/// [`URL_MAX`] long: the text is cut at the end to fit.
fn issue_url(report: &CrashReport) -> String {
    let title = one_line(&format!("Crash: {}", report.summary));
    let fence = fence(&report.text);
    let intro = format!("Sent from visual[flow]'s crash report. Add what you were doing if you like, then submit.\n\n{fence}\n");
    let cut = "\n… (cut to fit the link)";
    let outro = format!("\n{fence}\n");
    let head = format!("{NEW_ISSUE}?title={}&body={}", encode(&title), encode(&intro));
    let budget = URL_MAX.saturating_sub(head.len() + encode(&outro).len());
    let whole = encode(&report.text).len() <= budget;
    let room = if whole { budget } else { budget.saturating_sub(encode(cut).len()) };
    let mut body = String::new();
    let mut used = 0;
    for c in report.text.chars() {
        let n = encode(c.encode_utf8(&mut [0; 4])).len();
        if used + n > room {
            break;
        }
        used += n;
        body.push(c);
    }
    if !whole {
        body.push_str(cut);
    }
    format!("{head}{}{}", encode(&body), encode(&outro))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("visuals-crash-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn machine() -> Machine {
        Machine { version: "0.9.0".into(), macos: "15.5".into(), chip: "Apple M2 Pro".into() }
    }

    fn private() -> Private {
        Private::new(Some("/Users/jdoe".into()), vec!["jdoe".into()])
    }

    fn nobody() -> Private {
        Private::new(None, Vec::new())
    }

    /// No folders of ours: every preset is the user's.
    fn none() -> Presets {
        Presets::new(Vec::new(), None)
    }

    /// Ours: the full pack in jdoe's presets folder, and a starter set.
    const PACK: &str = "/Users/jdoe/.openflow/visuals/presets/cream-of-the-crop";
    const STARTER: &str = "/Applications/My Apps/visual[flow].app/Contents/Resources/presets/starter";

    fn ours(on_screen: Option<&str>) -> Presets {
        Presets::new(vec![PACK.into(), STARTER.into()], on_screen.map(Path::new))
    }

    fn report(id: &str, when: u64) -> CrashReport {
        CrashReport { id: id.into(), when, summary: "s".into(), text: "t".into(), sent: false }
    }

    #[test]
    fn a_report_serializes_as_the_page_reads_it() {
        assert_eq!(serde_json::to_string(&report("a", 1)).unwrap(), r#"{"id":"a","when":1,"summary":"s","text":"t","sent":false}"#);
    }

    #[test]
    fn a_panic_report_has_the_machine_preset_message_and_backtrace_but_no_paths_or_names() {
        let panic = Panic {
            thread: "bench".into(),
            location: Some("/Users/jdoe/.cargo/registry/src/index.crates.io-6f17d22bba15001f/wgpu-30.0.1/src/lib.rs:12:5".into()),
            message: "couldn't read /Users/jdoe/Music/jdoe-set.wav: denied".into(),
            backtrace: "   0: std::panicking::begin_panic\n             at /rustc/abc123/library/std/src/panicking.rs:700:5\n   1: visuals::bench::draw\n             at ./app/src-tauri/src/bench.rs:40:9\n   2: main\n             at /private/var/folders/xy/T/build/main.rs:1:1"
                .into(),
        };
        let swirl = format!("{PACK}/Geiss/Geiss - Swirl.milk");
        let r = panic_report("1-2-3".into(), 42, &panic, &machine(), Some(Path::new(&swirl)), &private(), &ours(Some(&swirl)));
        assert_eq!(r.when, 42);
        assert!(!r.sent);
        for want in [
            "Version: 0.9.0",
            "macOS: 15.5",
            "Chip: Apple M2 Pro",
            "Preset: Geiss - Swirl",
            "Thread: bench",
            "lib.rs:12:5",
            "panicking.rs:700:5",
            "bench.rs:40:9",
            "std::panicking::begin_panic",
            "couldn't read",
        ] {
            assert!(r.text.contains(want), "missing {want:?} in\n{}", r.text);
        }
        for never in ["/Users", "jdoe", "/rustc", "/private", ".cargo", "registry", "Music"] {
            assert!(!r.text.contains(never) && !r.summary.contains(never), "{never:?} leaked into\n{}", r.text);
        }
        assert_eq!(r.summary, "Panic: couldn't read <user>-set.wav: denied");
    }

    #[test]
    fn scrubbing_keeps_relative_names_and_ordinary_slashes() {
        let p = nobody();
        assert_eq!(scrub("at src/main.rs:3:1 and 1/2 and /tmp/x/y.rs", &p, &none()), "at src/main.rs:3:1 and 1/2 and y.rs");
        assert_eq!(scrub("\"/a/b/c\"", &p, &none()), "\"c\"");
        assert_eq!(scrub("~/presets/z.txt", &p, &none()), "z.txt");
        // The character before a path is the text's, not the end of a path cut short.
        assert_eq!(scrub("/a/b/c/d", &p, &none()), "d");
        assert_eq!(scrub("x /a/b./c/d", &p, &none()), "x d");
    }

    #[test]
    fn scrubbing_takes_the_whole_path_spaces_and_all() {
        let p = nobody();
        assert_eq!(scrub("couldn't read /Volumes/Backup Drive/sets/a.wav: denied", &p, &none()), "couldn't read a.wav: denied");
        assert_eq!(scrub("open ~/Music/DJ Sets/Friday Night/b.wav failed", &p, &none()), "open b.wav failed");
        assert_eq!(scrub("at /Volumes/My Backup Drive/x.rs:3:1", &p, &none()), "at x.rs:3:1");
        assert_eq!(scrub("/a/My Song.wav is bad", &p, &none()), "My Song.wav is bad");
        assert_eq!(scrub("from /a/b to /c/d", &p, &none()), "from b to d");
        for never in ["Backup", "Drive", "DJ Sets", "Friday", "Volumes", "Music"] {
            let s = scrub("x /Volumes/Backup Drive/a and ~/Music/DJ Sets/Friday Night/b y", &p, &none());
            assert!(!s.contains(never), "{never:?} leaked into {s:?}");
        }
    }

    #[test]
    fn names_are_scrubbed_whatever_their_case() {
        let p = Private::new(
            Some("/Users/ryan".into()),
            vec!["ryan".into(), "Ryan Gavin".into(), "Ryan".into(), "Gavin".into(), "Ryans-MacBook-Pro".into(), "Ryans-MacBook-Pro.local".into(), "Ryan's Studio".into(), "Al".into()],
        );
        assert_eq!(scrub("connected Ryan's AirPods", &p, &none()), "connected <user>'s AirPods");
        assert_eq!(scrub("host RYANS-MACBOOK-PRO.LOCAL and ryans-macbook-pro", &p, &none()), "host <user> and <user>");
        assert_eq!(scrub("Ryan Gavin on Ryan's Studio, gavin", &p, &none()), "<user> on <user>, <user>");
        assert_eq!(scrub("/USERS/RYAN/x.rs", &p, &none()), "x.rs");
        // Only where a word starts, and never a name too short to be one.
        assert_eq!(scrub("Bryan's Algo", &p, &none()), "Bryan's Algo");
    }

    #[test]
    fn names_outside_ascii_are_scrubbed_whatever_their_case() {
        let p = Private::new(None, vec!["Zoë".into(), "ZOË".into(), "Ørjan".into()]);
        assert_eq!(p.names.len(), 2, "one name in two cases is kept once");
        assert_eq!(scrub("ZOË and zoë and Zoë's ØRJAN, not Mazoë", &p, &none()), "<user> and <user> and <user>'s <user>, not Mazoë");
    }

    #[test]
    fn only_a_main_thread_panic_is_reported_at_a_clean_exit() {
        let main = std::thread::current().id();
        let other = std::thread::spawn(|| std::thread::current().id()).join().unwrap();
        let pending = vec![(other, report("survived", 1)), (main, report("died", 2))];
        assert_eq!(died_of(pending.clone(), Some(main)), vec![report("died", 2)]);
        assert_eq!(died_of(pending[..1].to_vec(), Some(main)), vec![], "a panic another thread survived isn't a crash");
        assert_eq!(died_of(pending, None), vec![]);
    }

    #[test]
    fn the_minimal_scrub_takes_the_home_folder_and_the_user() {
        let p = Private::minimal();
        if let Ok(user) = std::env::var("USER")
            && user.chars().count() >= 3
        {
            assert_eq!(scrub(&format!("hi {user}"), &p, &none()), "hi <user>");
        }
        if let Ok(home) = std::env::var("HOME") {
            assert_eq!(scrub(&format!("{home}/x.rs"), &p, &none()), "x.rs");
        }
    }

    #[test]
    fn a_preset_name_is_its_file_name_without_the_folder() {
        assert_eq!(preset_name(Path::new("/Users/jdoe/presets/Geiss - Swirl.milk")).as_deref(), Some("Geiss - Swirl"));
    }

    fn crash_on(preset: &str, message: &str) -> CrashReport {
        let panic = Panic { thread: "main".into(), location: None, message: message.into(), backtrace: String::new() };
        panic_report("1-2-3".into(), 1, &panic, &machine(), Some(Path::new(preset)), &private(), &ours(Some(preset)))
    }

    #[test]
    fn a_preset_from_our_packs_is_named_and_any_other_is_not() {
        let starter = format!("{STARTER}/cream-of-the-crop/Dancer/ORB - Xenon.milk");
        let r = crash_on(&starter, &format!("couldn't draw {starter}: lost"));
        assert!(r.text.contains("Preset: ORB - Xenon\n"), "{}", r.text);
        assert_eq!(r.summary, "Panic: couldn't draw ORB - Xenon.milk: lost");

        let pack = format!("{PACK}/Fractal/a - b.milk");
        assert!(crash_on(&pack, "x").text.contains("Preset: a - b\n"));

        for theirs in ["/Users/jdoe/presets/My Secret Set.milk", "/Users/jdoe/Desktop/cream-of-the-crop/My Secret Set.milk", &format!("{PACK}/../My Secret Set.milk")] {
            let r = crash_on(theirs, &format!("couldn't draw {theirs}: lost; My Secret Set has no waves, my secret set.MILK"));
            assert!(r.text.contains("Preset: a preset of your own\n"), "{}", r.text);
            assert_eq!(r.summary, "Panic: couldn't draw a preset of your own: lost; a preset of your own has no waves, a preset of your own");
            assert!(!r.text.to_lowercase().contains("secret"), "{}", r.text);
        }
    }

    #[test]
    fn a_preset_path_in_a_message_is_named_only_when_its_ours() {
        let p = private();
        let presets = ours(None);
        // Ours by its path, written out or from home.
        assert_eq!(scrub(&format!("bad {PACK}/A/Geiss - Swirl.milk: x"), &p, &presets), "bad Geiss - Swirl.milk: x");
        assert_eq!(scrub("bad ~/.openflow/visuals/presets/cream-of-the-crop/A/b.MILK:3", &p, &presets), "bad b.MILK:3");
        // Anything else, whatever its case or what follows it.
        assert_eq!(scrub("bad /tmp/x/Mine Too.milk: x", &p, &presets), "bad a preset of your own: x");
        assert_eq!(scrub("bad ~/presets/z.MILK, then", &p, &presets), "bad a preset of your own, then");
        assert_eq!(scrub("\"/Volumes/USB Stick/sets/z.milk\"", &p, &presets), "\"a preset of your own\"");
        // Not a preset: only paths are cut to a file name, as before.
        assert_eq!(scrub("/tmp/x/notes.milkshake", &p, &presets), "notes.milkshake");
        // A name from no path stays: nothing says whose it is, unless it's the one on screen.
        assert_eq!(scrub("Geiss - Swirl", &p, &presets), "Geiss - Swirl");
        let on_screen = ours(Some("/tmp/preset.milk"));
        assert_eq!(scrub("/tmp/preset.milk failed: preset", &p, &on_screen), "a preset of your own failed: a preset of your own", "the placeholder's own words aren't touched");
    }

    #[test]
    fn the_names_are_ready_before_the_hook_so_an_early_report_is_scrubbed() {
        // What `install` does before it sets the hook.
        assert!(collect_names(NAMES_WAIT), "the names took longer than {NAMES_WAIT:?}");
        let private = PRIVATE.get().expect("collected");
        let mut names: Vec<String> = [computer_name(), host_name(), full_name()].into_iter().flatten().filter(|n| n.chars().count() >= 3).collect();
        names.extend(std::env::var("USER").ok().filter(|u| u.chars().count() >= 3));
        assert!(!names.is_empty());
        for name in names {
            let panic = Panic { thread: "main".into(), location: None, message: format!("lost {name}"), backtrace: String::new() };
            let r = panic_report(new_id(), 1, &panic, &machine(), None, private, &none());
            assert!(r.summary.starts_with("Panic: lost <user>"), "{name:?} in {}", r.summary);
            assert!(!r.text.contains(&name), "{name:?} leaked into {}", r.text);
        }
    }

    #[test]
    fn a_slow_lookup_is_waited_for_only_so_long() {
        let (release, wait) = std::sync::mpsc::channel::<()>();
        assert!(!wait_for(move || _ = wait.recv(), Duration::from_millis(50)));
        drop(release);
        assert!(wait_for(|| (), Duration::from_secs(5)));
    }

    #[test]
    fn reports_are_written_listed_newest_first_and_only_the_last_twenty_kept() {
        let dir = temp("rotate");
        for i in 0..25u64 {
            write(&dir, &report(&format!("{i:013}-1-0"), i)).unwrap();
        }
        rotate(&dir, KEEP);
        let kept = list(&dir);
        assert_eq!(kept.len(), 20);
        assert_eq!(kept.first().unwrap().when, 24);
        assert_eq!(kept.last().unwrap().when, 5);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ids_never_reach_outside_the_folder() {
        let dir = temp("ids");
        write(&dir, &report("ok-1", 1)).unwrap();
        assert!(read(&dir, "ok-1").is_some());
        assert!(read(&dir, "../ok-1").is_none());
        assert!(read(&dir, "").is_none());
        assert!(valid_id(&new_id()));
        assert_ne!(new_id(), new_id());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reports_are_off_until_turned_on() {
        let dir = temp("setting");
        assert!(!enabled_in(&dir));
        enable_in(&dir, true).unwrap();
        assert!(enabled_in(&dir));
        enable_in(&dir, false).unwrap();
        assert!(!enabled_in(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn marker(dir: &Path, pid: u32, panics: Vec<CrashReport>) -> PathBuf {
        let path = dir.join(format!("{MARKER}{pid}"));
        save_marker(&path, &Marker { started: 50, panics }).unwrap();
        path
    }

    #[test]
    fn an_unclean_exit_is_reported_once() {
        let dir = temp("marker");
        assert_eq!(unclean_exits(&dir, &machine(), 100, |_| false), vec![], "no marker: a first launch or a clean exit");
        let gone = marker(&dir, 4_000_001, Vec::new());
        let reports = unclean_exits(&dir, &machine(), 100, |_| false);
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].when, 100);
        assert!(reports[0].text.contains("Version: 0.9.0") && reports[0].text.contains("quit unexpectedly"));
        assert!(!gone.exists());
        assert_eq!(unclean_exits(&dir, &machine(), 101, |_| false), vec![]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_copy_still_running_is_left_alone() {
        let dir = temp("copies");
        let running = marker(&dir, 4_000_002, Vec::new());
        let own = marker(&dir, std::process::id(), Vec::new());
        assert_eq!(unclean_exits(&dir, &machine(), 100, |pid| pid == 4_000_002), vec![]);
        assert!(running.exists() && own.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_run_that_died_after_a_panic_reports_the_panic() {
        let dir = temp("died");
        marker(&dir, 4_000_003, vec![report("0000000000060-1-0", 60)]);
        assert_eq!(unclean_exits(&dir, &machine(), 100, |_| false), vec![report("0000000000060-1-0", 60)]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_signal_numbers_are_this_systems() {
        // `kill -l` lists them; macOS and Linux agree on these three.
        assert_eq!((SIGHUP, SIGINT, SIGTERM), (1, 2, 15));
    }

    #[test]
    fn this_process_is_alive_and_a_made_up_one_isnt() {
        assert!(alive(std::process::id()));
        assert!(!alive(4_000_004));
        assert!(!alive(u32::MAX));
    }

    #[test]
    fn a_caught_panic_is_forgotten_and_one_nothing_caught_is_kept() {
        let (caught, kept) = std::thread::spawn(|| {
            let me = std::thread::current().id();
            pending().push((me, report("caught", 1)));
            // `catch` forgets this thread's newest panic once it catches it; a plain `catch_unwind` would leave it.
            assert!(catch(|| panic!("caught here")).is_err());
            let caught = !pending().iter().any(|(t, r)| *t == me && r.id == "caught");
            pending().push((me, report("kept", 2)));
            let kept = pending().iter().any(|(t, r)| *t == me && r.id == "kept");
            pending().retain(|(t, _)| *t != me);
            (caught, kept)
        })
        .join()
        .unwrap();
        assert!(caught && kept);
    }

    #[test]
    fn a_panic_while_keeping_a_report_goes_no_further() {
        let mut ran = 0;
        guarded(|| {
            ran += 1;
            guarded(|| unreachable!("not run again while in it"));
            panic!("while keeping a report");
        });
        assert_eq!(ran, 1);
        guarded(|| ran += 1);
        assert_eq!(ran, 2, "runs again once out of it");
    }

    #[test]
    fn a_fence_is_longer_than_any_backticks_in_the_text() {
        assert_eq!(fence("plain"), "```");
        assert_eq!(fence("a ``` b"), "````");
        assert_eq!(fence("`````"), "``````");
        let mut r = report("a", 1);
        r.text = "x\n```\ny".into();
        assert!(issue_url(&r).contains(&encode("\n````\n")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_mac_is_described() {
        let here = Machine::here();
        assert_eq!(here.version, env!("CARGO_PKG_VERSION"));
        assert_ne!(here.macos, "unknown");
        assert_ne!(here.chip, "unknown");
    }

    #[test]
    fn the_plist_gives_the_macos_version() {
        let plist = "<dict>\n\t<key>ProductName</key>\n\t<string>macOS</string>\n\t<key>ProductVersion</key>\n\t<string>15.5</string>\n</dict>";
        assert_eq!(plist_string(plist, "ProductVersion").as_deref(), Some("15.5"));
        assert_eq!(plist_string(plist, "Nope"), None);
    }

    #[test]
    fn the_issue_link_is_prefilled_and_fits() {
        let mut r = report("a", 1);
        r.summary = "Panic: boom & bust".into();
        r.text = "Version: 0.9.0\nline two".into();
        let url = issue_url(&r);
        assert!(url.starts_with("https://github.com/openflowfm/visuals/issues/new?title=Crash%3A%20Panic%3A%20boom%20%26%20bust&body="));
        assert!(url.contains("Version%3A%200.9.0%0Aline%20two"));
        assert!(!url.contains("cut%20to%20fit"));

        r.text = "frame ü\n".repeat(2000);
        let url = issue_url(&r);
        assert!(url.len() <= URL_MAX, "{} long", url.len());
        assert!(url.len() > URL_MAX - 40);
        assert!(url.contains("cut%20to%20fit%20the%20link"));
        assert!(url.ends_with("%0A%60%60%60%0A"));
    }

    #[test]
    fn encoding_keeps_only_unreserved_characters() {
        assert_eq!(encode("a-b_c.d~e f&g=h/ü"), "a-b_c.d~e%20f%26g%3Dh%2F%C3%BC");
    }
}
