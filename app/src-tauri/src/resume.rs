//! A show that never stops (#99).
//!
//! **Picking up where the app left off.** Every change to the deck ([`note`])
//! keeps the playlist, the position in it, the preset playing, the unsaved
//! filter playing, the live tweaks ([`Tweaks`]) and hold in `resume.json`
//! (`crate::settings`). On the next launch, after a crash or a quit, [`start`]
//! loads that playlist again at that position (or, for a smart playlist worked
//! out again, wherever that preset now is), or plays that filter again from
//! that preset, or opens that preset when neither was playing; then it puts
//! the tweaks back and holds again. The source needs nothing here:
//! `crate::listen` already comes back listening to the one chosen last
//! (`audio.json`), which [`resume_state`] reports. Nothing is resumed on the
//! first run, or when the app is started on a given preset (`VISUALS_PRESET`).
//!
//! **Skipping what fails.** A preset that can't be read, that the bench won't
//! load, or that panics on the bench, whether the deck or the library opened
//! it, is kept in `failed.json` with its file's size and modification time, and
//! sent to the page ([`FAILED`], [`presets_failed`]), which marks it in the
//! library. Stepping (next, previous, random, and auto-advance) moves on past
//! it ([`open_failed`]), and the main window's status strip says so in a short
//! note that fades ([`SKIPPED`]); nothing is ever shown on the output. The mark
//! goes when the file changes or the preset opens after all (a newer engine);
//! a preset that panicked drawing has to draw again, not only load ([`Panics`]),
//! and isn't opened again by stepping this run. Panics that step the deck on
//! have a budget ([`BUDGET`]), so presets that all panic never keep it stepping.

use crate::actions::{Action, Deck, DeckView};
use crate::bench::Drawing;
use crate::fx::FxAction;
use crate::library::Opened;
use crate::query::LibraryQuery;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Where the app was: the playlist and the position in it, the preset on screen,
/// the filter playing, the deck's tweaks and hold, and what it listened to.
/// Files from before the tweaks, hold and filter were kept read as none of them.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Resume {
    pub playlist: Option<String>,
    pub index: Option<usize>,
    pub current: Option<String>,
    pub source: Option<crate::listen::SourceId>,
    /// The unsaved filter playing (a mood, or the library's grid followed).
    #[serde(default)]
    pub query: Option<LibraryQuery>,
    #[serde(default)]
    pub tweaks: Option<Tweaks>,
    #[serde(default)]
    pub hold: bool,
}

/// The deck's live tweaks: how it changes preset (`auto`, `seconds` and `bars`,
/// together) and the effects a playlist sets. With a playlist loaded, only what
/// the deck reports as tweaked away from it (`DeckView::differs`) is kept, so the
/// playlist's own settings, edited since, win over the rest; with none, there is
/// nothing to differ from, and all of them are kept. Files that kept every value
/// read as every value tweaked.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Tweaks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bars: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trails: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hue: Option<f64>,
}

/// Where the deck is kept, in `crate::settings::dir`.
const FILE: &str = "resume.json";
/// The presets that failed, in `crate::settings::dir`.
const FAILED_FILE: &str = "failed.json";
/// The event the whole list of failed presets goes out on when it changes.
pub const FAILED: &str = "presets-failed";

/// What the launch found to pick up, for [`resume_state`].
static FOUND: OnceLock<Option<Resume>> = OnceLock::new();
/// Set once the deck is back where it was (or there was nothing to do): until then
/// [`note`] keeps nothing, so a page acting early can't overwrite where the show was.
static RESTORED: AtomicBool = AtomicBool::new(false);
/// What [`note`] kept last, so an unchanged deck isn't written again.
static KEPT: Mutex<Option<Resume>> = Mutex::new(None);

/// Where the app was last time, if it should pick up there; `None` when nothing was playing.
#[tauri::command]
pub fn resume_state() -> Option<Resume> {
    FOUND.get().cloned().flatten()
}

/// Whether there's anything to pick up in `r`.
fn worth(r: &Resume) -> bool {
    r.playlist.is_some() || r.current.is_some() || r.query.is_some()
}

/// Whether to pick up at all: never on the first run, nor when started on a given preset.
fn wanted(first_run: bool, preset: Option<&str>) -> bool {
    !first_run && preset.is_none_or(str::is_empty)
}

/// Called once at setup: problems with settings go to the page from now on, the
/// failed presets are read, a preset that panics on the bench is marked and
/// moved on from, and the deck is put back where it was once the bench is there.
pub fn start(handle: &AppHandle) {
    crate::settings::install(handle);
    let failed = crate::settings::load::<FailedFile>(FAILED_FILE).map(|f| still_failing(f.presets)).unwrap_or_default();
    *FAILURES.lock().unwrap() = failed;
    let watching = handle.clone();
    crate::bench::on_drawing(move |drawing| match drawing {
        Drawing::Steady => PANICS.lock().unwrap().steady(),
        // Off the bench's thread: marking writes a file, and moving on asks the bench.
        Drawing::Drew(path) => {
            let handle = watching.clone();
            std::thread::spawn(move || drew(&handle, &path));
        }
        Drawing::Panicked(path, why) => {
            let handle = watching.clone();
            std::thread::spawn(move || moved_on(&handle, path, &why));
        }
    });
    let found = crate::settings::load::<Resume>(FILE).filter(worth).map(|r| Resume { source: kept_source(), ..r });
    let _ = FOUND.set(found.clone());
    let go = found.filter(|_| wanted(crate::settings::first_run(), std::env::var("VISUALS_PRESET").ok().as_deref()));
    let Some(r) = go else {
        RESTORED.store(true, Ordering::SeqCst);
        return;
    };
    let handle = handle.clone();
    std::thread::spawn(move || {
        // The bench starts later in setup; give it a moment.
        let until = Instant::now() + Duration::from_secs(10);
        while handle.state::<crate::App>().commands().is_err() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        restore(&handle, &r);
        RESTORED.store(true, Ordering::SeqCst);
    });
}

/// The preset from `path` drew a refresh (`crate::bench::Drawing::Drew`): it
/// works after all, so its mark goes, a mark from a panic too.
fn drew(handle: &AppHandle, path: &Path) {
    PANICS.lock().unwrap().drew(path);
    set_mark(handle, path, Verdict::Drew);
}

/// The preset from `path` panicked drawing (`crate::bench::Drawing::Panicked`;
/// `None` for one without a file, the editor's), and the bench stopped drawing
/// it: mark it failed and, when the deck is still on it, step on past it as
/// stepping does past any failed preset, within [`BUDGET`].
fn moved_on(handle: &AppHandle, path: Option<PathBuf>, why: &str) {
    let Some(path) = path else {
        eprintln!("resume: a preset without a file panicked drawing ({why}); nothing to mark");
        return;
    };
    let current = handle.state::<Deck>().live.lock().unwrap().current.clone();
    set_mark(handle, &path, Verdict::PanickedDrawing);
    let on = PANICS.lock().unwrap().panicked(&path, current.as_deref());
    match on {
        OnPanic::Leave => {}
        OnPanic::Stop => {
            eprintln!("resume: {BUDGET} presets in a row panicked drawing; holding the picture rather than stepping on");
            let _ = handle.emit(SKIPPED, path.to_string_lossy());
        }
        OnPanic::Step => {
            if open_failed(handle, &path, why) != Failed::Skip {
                return;
            }
            if let Err(e) = crate::actions::step_past(handle, &path, &format!("it panicked drawing ({why})")) {
                eprintln!("resume: moving on from a preset that panicked: {e}");
            }
        }
    }
}

/// How many panics in a row, with no preset drawing steadily between them
/// (`crate::bench::STEADY`), step the deck on before it stops stepping and holds
/// the picture: as many as a step skips presets that fail to open
/// (`crate::actions`), so a run of broken presets in a playlist is still got
/// past, while a deck of nothing but panicking presets stops within a few
/// seconds, after at most this many loads.
pub const BUDGET: usize = 8;

/// The presets that panicked drawing this run, and how many panics in a row
/// stepped the deck on.
#[derive(Debug, Default)]
pub(crate) struct Panics {
    drawing: std::collections::BTreeSet<PathBuf>,
    streak: usize,
}

/// What to do about a preset that panicked drawing ([`Panics::panicked`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OnPanic {
    /// The deck has moved on from it already: leave the deck be.
    Leave,
    /// Step on past it.
    Step,
    /// Too many in a row: stay, and the picture holds.
    Stop,
}

static PANICS: Mutex<Panics> = Mutex::new(Panics { drawing: std::collections::BTreeSet::new(), streak: 0 });

impl Panics {
    /// The preset from `path` panicked drawing while the deck was on `current`.
    pub(crate) fn panicked(&mut self, path: &Path, current: Option<&Path>) -> OnPanic {
        self.drawing.insert(path.to_path_buf());
        if current != Some(path) {
            return OnPanic::Leave;
        }
        self.streak += 1;
        if self.streak > BUDGET { OnPanic::Stop } else { OnPanic::Step }
    }

    /// The preset from `path` drew a refresh.
    pub(crate) fn drew(&mut self, path: &Path) {
        self.drawing.remove(path);
    }

    /// The preset on the bench has drawn steadily: the budget is whole again.
    pub(crate) fn steady(&mut self) {
        self.streak = 0;
    }

    /// Why the deck shouldn't open `path` again: it panicked drawing this run and
    /// hasn't drawn since. Opening it from the library still tries.
    pub(crate) fn refused(&self, path: &Path) -> Option<String> {
        self.drawing.contains(path).then(|| "it panicked drawing".to_string())
    }
}

/// The source `crate::listen` comes back to (`audio.json`).
fn kept_source() -> Option<crate::listen::SourceId> {
    let audio = crate::settings::load::<Value>("audio.json")?;
    serde_json::from_value(audio.get("source")?.clone()).ok()
}

/// What putting the deck back takes.
#[derive(Debug, PartialEq)]
enum Plan {
    /// Load playlist number `playlist`, at item `index`.
    Load {
        playlist: usize,
        index: Option<usize>,
    },
    /// Play the filter `query` again, from `current` when there was one.
    Query {
        query: LibraryQuery,
        current: Option<PathBuf>,
    },
    /// No playlist (or it's gone) nor filter: open this preset.
    Open(PathBuf),
    Nothing,
}

/// The plan for `r`, given the playlists' ids in order.
fn plan(r: &Resume, ids: &[String]) -> Plan {
    if let Some(n) = r.playlist.as_ref().and_then(|id| ids.iter().position(|i| i == id)) {
        return Plan::Load { playlist: n, index: r.index };
    }
    let current = r.current.as_ref().map(PathBuf::from);
    if let Some(query) = r.query.clone().filter(|_| r.playlist.is_none()) {
        return Plan::Query { query, current };
    }
    match current {
        Some(c) => Plan::Open(c),
        None => Plan::Nothing,
    }
}

fn restore(handle: &AppHandle, r: &Resume) {
    let deck = handle.state::<Deck>();
    let ids: Vec<String> = deck.store.lock().unwrap().lists.iter().map(|l| l.id.clone()).collect();
    let said = |what: &str, e: String| eprintln!("resume: {what}: {e}");
    let act = |what: &str, action: Action| crate::actions::dispatch(handle, action).map_err(|e| said(what, e)).is_ok();
    // Open `path` for the deck; whether it opened.
    let open_here = |path: &Path| {
        let (opened, error) = open(handle, &handle.state::<crate::App>(), path);
        if opened.is_some() {
            deck.opened(path);
        } else if let Some(e) = error {
            said("opening the preset", e);
        }
        opened.is_some()
    };
    match plan(r, &ids) {
        Plan::Load { playlist, index } => {
            // The position may be gone (items removed since): the playlist's start, then.
            if !act("loading the playlist at its position", Action::Load { playlist, index }) && !act("loading the playlist", Action::Load { playlist, index: None }) {
                return;
            }
            // A smart playlist is worked out again: go to where that preset is now.
            let elsewhere = r.current.as_ref().and_then(|c| {
                let live = deck.live.lock().unwrap();
                let here = live.current.as_ref().is_some_and(|p| p.as_os_str() == c.as_str());
                if here { None } else { live.items.iter().position(|p| p.as_os_str() == c.as_str()) }
            });
            if let Some(index) = elsewhere {
                act("going back to the preset", Action::Go { index });
            }
        }
        Plan::Query { query, current } => {
            // From the preset that was playing, as the grid follows from what it opened;
            // otherwise from the filter's start.
            match current.filter(|p| p.is_file()).filter(|p| open_here(p)) {
                Some(at) => act("following the filter again", Action::Query { query, at: Some(at) }),
                None => act("playing the filter again", Action::Query { query, at: None }),
            };
        }
        Plan::Open(path) if path.is_file() => {
            open_here(&path);
        }
        Plan::Open(_) | Plan::Nothing => {}
    }
    let fx = deck.fx.lock().unwrap().settings.clone();
    for action in again(r, &deck.view(), &fx) {
        act("putting the deck's tweaks back", action);
    }
}

/// The actions that put `r`'s tweaks and hold back on a deck now at `deck`, with
/// the effects `fx`: only what differs, and hold last, as it refuses loads.
fn again(r: &Resume, deck: &DeckView, fx: &crate::fx::Settings) -> Vec<Action> {
    let mut actions = Vec::new();
    if let Some(t) = r.tweaks {
        let differ = |kept: Option<f64>, now: f64| kept.filter(|k| (k - now).abs() >= 1e-9);
        let effects = [
            differ(t.transition, fx.transition).map(|seconds| FxAction::Transition { seconds }),
            differ(t.speed, fx.speed).map(|speed| FxAction::Speed { speed }),
            differ(t.trails, fx.trails).map(|value| FxAction::Trails { value }),
            differ(t.hue, fx.hue).map(|value| FxAction::Hue { value }),
        ];
        actions.extend(effects.into_iter().flatten().map(Action::Fx));
        // Bars turn the timed auto-advance off, so auto goes after them.
        let bars = t.bars.filter(|&b| b != deck.bars);
        if let Some(bars) = bars {
            actions.push(Action::Bars { bars });
        }
        if let Some(seconds) = differ(t.seconds, deck.seconds) {
            actions.push(Action::Seconds { seconds });
        }
        if let Some(auto) = t.auto.filter(|&a| a != deck.auto || bars.is_some()) {
            actions.push(Action::Auto { on: Some(auto) });
        }
    }
    if r.hold && !deck.hold {
        actions.push(Action::Hold { on: Some(true) });
    }
    actions
}

/// Where `deck` is, with the effects `fx`, to keep.
fn kept_from(deck: &DeckView, fx: &crate::fx::Settings) -> Resume {
    Resume { playlist: deck.playlist.clone(), index: deck.index, current: deck.current.clone(), source: None, query: deck.query.clone(), tweaks: tweaks_of(deck, fx), hold: deck.hold }
}

/// The tweaks to keep of `deck`, with the effects `fx`: what differs from the
/// loaded playlist's settings, or everything when none is loaded; none when
/// nothing differs.
fn tweaks_of(deck: &DeckView, fx: &crate::fx::Settings) -> Option<Tweaks> {
    let tweaked = |name: &str| deck.settings.is_none() || deck.differs.contains(&name);
    let change = tweaked("change");
    let t = Tweaks {
        auto: change.then_some(deck.auto),
        seconds: change.then_some(deck.seconds),
        bars: change.then_some(deck.bars),
        transition: tweaked("transition").then_some(fx.transition),
        speed: tweaked("speed").then_some(fx.speed),
        trails: tweaked("trails").then_some(fx.trails),
        hue: tweaked("hue").then_some(fx.hue),
    };
    (t != Tweaks::default()).then_some(t)
}

/// Called after every change to the deck: keep where it is, when that changed.
pub fn note(handle: &AppHandle, deck: &DeckView) {
    if !RESTORED.load(Ordering::SeqCst) {
        return;
    }
    let fx = handle.state::<Deck>().fx.lock().unwrap().settings.clone();
    keep(&KEPT, kept_from(deck, &fx), |now| crate::settings::save_json(FILE, now));
}

/// Save `now` unless it is what `kept` says was saved last. The check and the
/// save happen under one lock, so an older deck can't land last; `kept` changes
/// only when the save worked, so a failed one is tried again.
fn keep(kept: &Mutex<Option<Resume>>, now: Resume, save: impl FnOnce(&Resume) -> bool) {
    let mut kept = kept.lock().unwrap();
    if kept.as_ref() == Some(&now) {
        return;
    }
    if save(&now) {
        *kept = Some(now);
    }
}

/// What the deck does about a preset that failed to open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failed {
    /// Say so. Not answered now that every failure steps on, but the deck still handles it.
    #[allow(dead_code)]
    Report,
    /// Step on to the next one, with only a note in the main window's status strip.
    Skip,
}

/// The event each skip goes out on, with the skipped preset's path: the main
/// window's status strip counts them into a short note that fades (decision 60).
pub const SKIPPED: &str = "preset-skipped";

/// Asked by the deck when the preset at `path` failed to open while stepping
/// (next, previous, random, auto-advance): always skip it, and tell the page
/// ([`SKIPPED`]). [`open`] has already marked it.
pub fn open_failed(handle: &AppHandle, path: &Path, _error: &str) -> Failed {
    if WHEN_FAILED == Failed::Skip {
        let _ = handle.emit(SKIPPED, path.to_string_lossy());
    }
    WHEN_FAILED
}

/// [`open_failed`]'s answer.
const WHEN_FAILED: Failed = Failed::Skip;

/// A preset's file when it failed: its size and modification time (seconds),
/// so the mark goes when the file changes; and whether it panicked drawing,
/// when loading fine isn't enough to unmark it.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
struct Mark {
    size: u64,
    modified: u64,
    #[serde(default, skip_serializing_if = "not")]
    drawing: bool,
}

fn not(b: &bool) -> bool {
    !*b
}

impl Mark {
    /// The same file as `other`.
    fn same_file(&self, other: &Mark) -> bool {
        (self.size, self.modified) == (other.size, other.modified)
    }
}

/// What became of a preset, for its mark ([`mark`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    /// It can't be read, or the bench won't load it.
    Failed,
    /// It panicked drawing.
    PanickedDrawing,
    /// The bench loaded it, which says nothing about drawing.
    Loaded,
    /// It drew a refresh.
    Drew,
}

/// `failed.json`.
#[derive(Serialize, Deserialize, Default)]
struct FailedFile {
    /// By path.
    presets: BTreeMap<String, Mark>,
}

static FAILURES: Mutex<BTreeMap<String, Mark>> = Mutex::new(BTreeMap::new());

fn mark_of(path: &Path) -> Option<Mark> {
    let meta = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    Some(Mark { size: meta.len(), modified, drawing: false })
}

/// The failures whose file is still as it was when it failed.
fn still_failing(mut presets: BTreeMap<String, Mark>) -> BTreeMap<String, Mark> {
    presets.retain(|path, mark| mark_of(Path::new(path)).is_some_and(|m| m.same_file(mark)));
    presets
}

/// Mark `path` for what became of it: failed, or no longer. A mark from a panic
/// while drawing goes only when it draws, not when it loads. Returns whether
/// that changed anything.
fn mark(failures: &mut BTreeMap<String, Mark>, path: &Path, verdict: Verdict) -> bool {
    let key = path.to_string_lossy().into_owned();
    let was = failures.get(&key).copied();
    match verdict {
        Verdict::Failed | Verdict::PanickedDrawing => match mark_of(path) {
            Some(m) => {
                // It panicked drawing once: it still has to draw, whatever else fails.
                let drawing = verdict == Verdict::PanickedDrawing || was.is_some_and(|w| w.drawing && w.same_file(&m));
                let m = Mark { drawing, ..m };
                failures.insert(key, m) != Some(m)
            }
            // A file that's gone isn't a preset that fails: the library has lost it.
            None => failures.remove(&key).is_some(),
        },
        Verdict::Loaded if was.is_some_and(|w| w.drawing) => false,
        Verdict::Loaded | Verdict::Drew => failures.remove(&key).is_some(),
    }
}

/// Keep and tell the page the new list when marking `path` changed it.
fn set_mark(handle: &AppHandle, path: &Path, verdict: Verdict) {
    let list = {
        let mut failures = FAILURES.lock().unwrap();
        if !mark(&mut failures, path, verdict) {
            return;
        }
        // Saved under the lock, so an older list can't land last.
        crate::settings::save_json(FAILED_FILE, &FailedFile { presets: failures.clone() });
        failures.clone()
    };
    if matches!(verdict, Verdict::Failed | Verdict::PanickedDrawing) {
        eprintln!("resume: {} failed; marked, and skipped in live", path.display());
    }
    let _ = handle.emit(FAILED, list.into_keys().collect::<Vec<_>>());
}

/// The presets (by path) that failed to open, for the library to mark.
#[tauri::command]
pub fn presets_failed() -> Vec<String> {
    FAILURES.lock().unwrap().keys().cloned().collect()
}

/// Why an opened preset didn't load on the bench, from its report (`library::Report`):
/// its equations or shaders failed to build, so the bench kept the last one.
fn load_problem(opened: &Value) -> Option<String> {
    let message = opened.pointer("/report/equations/0/message")?.as_str()?;
    Some(format!("it didn't load ({message})"))
}

/// Open the preset at `path` on the bench for the deck: what opened, or why it
/// didn't. A preset that can't be read or that the bench won't load is marked failed;
/// one that didn't open because asking the bench failed (not up yet) is only reported.
/// One that panicked drawing this run, and hasn't drawn since, isn't opened again
/// ([`Panics::refused`]).
pub fn open(handle: &AppHandle, app: &crate::App, path: &Path) -> (Option<Opened>, Option<String>) {
    if let Some(why) = PANICS.lock().unwrap().refused(path) {
        return (None, Some(why));
    }
    for_the_deck(open_reported(handle, app, path))
}

/// Open the preset at `path` on the bench as the library does, marking it as
/// [`open`] does: what the bench answered, with its report of what failed to
/// build, or why it couldn't be asked.
pub fn open_reported(handle: &AppHandle, app: &crate::App, path: &Path) -> Result<Opened, String> {
    let readable = crate::library::read_preset(path).map(|_| ());
    let (result, failed) = judge(readable, || crate::library::open_path(app, &path.to_string_lossy()));
    if let Some(failed) = failed {
        set_mark(handle, path, if failed { Verdict::Failed } else { Verdict::Loaded });
    }
    result
}

/// What the deck makes of the bench's answer: a preset that didn't load is an
/// error, as one that couldn't be read is.
fn for_the_deck<T: Serialize>(result: Result<T, String>) -> (Option<T>, Option<String>) {
    match result {
        Ok(o) => match serde_json::to_value(&o).ok().as_ref().and_then(load_problem) {
            Some(e) => (None, Some(e)),
            None => (Some(o), None),
        },
        Err(e) => (None, Some(e)),
    }
}

/// What opening a preset came to (the bench's answer as it gave it), and whether to
/// mark it failed (`Some(true)`), unmark it (`Some(false)`) or leave its mark alone
/// (`None`). `readable` is whether its file reads as a preset; `open` asks the bench.
/// Only the file failing to read or the bench answering that it won't load is a
/// failure: an error from asking the bench at all says nothing about the preset.
fn judge<T: Serialize>(readable: Result<(), String>, open: impl FnOnce() -> Result<T, String>) -> (Result<T, String>, Option<bool>) {
    if let Err(e) = readable {
        return (Err(e), Some(true));
    }
    match open() {
        Err(e) => (Err(e), None),
        Ok(o) => {
            let failed = serde_json::to_value(&o).ok().as_ref().and_then(load_problem).is_some();
            (Ok(o), Some(failed))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(playlist: Option<&str>, index: Option<usize>, current: Option<&str>) -> Resume {
        Resume { playlist: playlist.map(Into::into), index, current: current.map(Into::into), ..Resume::default() }
    }

    /// Every tweak, at what a fresh deck has.
    fn tweaks() -> Tweaks {
        let fx = crate::fx::Settings::default();
        Tweaks { auto: Some(false), seconds: Some(30.0), bars: Some(0), transition: Some(fx.transition), speed: Some(fx.speed), trails: Some(fx.trails), hue: Some(fx.hue) }
    }

    #[test]
    fn resume_reads_and_writes_as_the_page_expects() {
        assert_eq!(serde_json::to_string(&Resume::default()).unwrap(), r#"{"playlist":null,"index":null,"current":null,"source":null,"query":null,"tweaks":null,"hold":false}"#);
        // A file from before the tweaks, hold and filter were kept still reads.
        let kept: Resume = serde_json::from_str(r#"{"version":1,"playlist":"a","index":3,"current":"/p/x.milk","source":{"kind":"system"}}"#).unwrap();
        assert_eq!(kept.source, Some(crate::listen::SourceId::System));
        assert_eq!((kept.query.as_ref(), kept.tweaks, kept.hold), (None, None, false));
        assert!(worth(&kept));
        assert!(!worth(&Resume::default()));
        // A filter alone is worth picking up.
        assert!(worth(&Resume { query: Some(LibraryQuery::default()), ..Resume::default() }));
        // And it all reads back as written.
        let full = Resume { query: Some(LibraryQuery::default()), tweaks: Some(Tweaks { speed: Some(2.0), ..tweaks() }), hold: true, ..r(None, None, Some("/x.milk")) };
        let back: Resume = serde_json::from_str(&serde_json::to_string(&full).unwrap()).unwrap();
        assert_eq!(back, full);
        // Only the tweaks kept are written, and read back as such.
        let some = Resume { tweaks: Some(Tweaks { hue: Some(0.5), ..Tweaks::default() }), ..Resume::default() };
        let text = serde_json::to_string(&some).unwrap();
        assert!(text.contains(r#""tweaks":{"hue":0.5}"#), "{text}");
        assert_eq!(serde_json::from_str::<Resume>(&text).unwrap(), some);
        // A file that kept every value reads as every value tweaked.
        let every: Resume = serde_json::from_str(r#"{"tweaks":{"auto":true,"seconds":12.0,"bars":0,"transition":1.0,"speed":2.0,"trails":0.0,"hue":0.0}}"#).unwrap();
        assert_eq!(every.tweaks.map(|t| (t.auto, t.speed)), Some((Some(true), Some(2.0))));
    }

    #[test]
    fn picks_up_except_on_the_first_run_or_a_given_preset() {
        assert!(wanted(false, None));
        assert!(wanted(false, Some("")));
        assert!(!wanted(true, None));
        assert!(!wanted(false, Some("cream-of-the-crop/x.milk")));
    }

    #[test]
    fn plans_the_playlist_by_id_then_the_filter_then_the_preset() {
        let ids = vec!["a".to_string(), "b".to_string()];
        assert_eq!(plan(&r(Some("b"), Some(4), Some("/x.milk")), &ids), Plan::Load { playlist: 1, index: Some(4) });
        // The playlist moved in the file: still found by its id.
        assert_eq!(plan(&r(Some("a"), None, None), &ids), Plan::Load { playlist: 0, index: None });
        // Deleted since: the preset that was playing.
        assert_eq!(plan(&r(Some("gone"), Some(1), Some("/x.milk")), &ids), Plan::Open("/x.milk".into()));
        assert_eq!(plan(&r(None, None, Some("/y.milk")), &ids), Plan::Open("/y.milk".into()));
        assert_eq!(plan(&r(None, None, None), &ids), Plan::Nothing);
        // An unsaved filter plays again, from the preset that was playing.
        let q = LibraryQuery::default();
        let filter = Resume { query: Some(q.clone()), ..r(None, Some(2), Some("/y.milk")) };
        assert_eq!(plan(&filter, &ids), Plan::Query { query: q.clone(), current: Some("/y.milk".into()) });
        assert_eq!(plan(&Resume { query: Some(q.clone()), ..Resume::default() }, &ids), Plan::Query { query: q, current: None });
    }

    #[test]
    fn keeps_the_deck_s_playlist_position_preset_filter_tweaks_and_hold() {
        let fx = crate::fx::Settings { speed: 2.0, hue: 0.25, ..crate::fx::Settings::default() };
        let deck: DeckView = {
            let mut live = crate::actions::Live::default();
            live.playlist = Some("p".into());
            live.index = Some(2);
            live.current = Some("/a/b.milk".into());
            live.auto = true;
            live.seconds = 12.0;
            live.hold = true;
            live.view(&fx)
        };
        let kept = kept_from(&deck, &fx);
        assert_eq!((kept.playlist, kept.index, kept.current), (Some("p".into()), Some(2), Some("/a/b.milk".into())));
        // No playlist's settings to differ from: every value is kept.
        assert_eq!(kept.tweaks, Some(Tweaks { auto: Some(true), seconds: Some(12.0), speed: Some(2.0), hue: Some(0.25), ..tweaks() }));
        assert!(kept.hold);
        let filtering = crate::actions::Live { query: Some(LibraryQuery::default()), ..crate::actions::Live::default() };
        assert_eq!(kept_from(&filtering.view(&fx), &fx).query, Some(LibraryQuery::default()));
    }

    #[test]
    fn keeps_only_what_was_tweaked_away_from_the_playlist_so_its_edits_win() {
        use crate::playlists::{Change, Settings};
        let settings = Settings { change: Change::Seconds { every: 20.0 }, speed: 1.0, hue: 0.0, ..Settings::default() };
        let live = |seconds: f64| crate::actions::Live { playlist: Some("p".into()), settings: Some(settings), auto: true, seconds, ..crate::actions::Live::default() };
        // As the playlist has it: nothing tweaked, nothing kept.
        let as_set = crate::fx::Settings { transition: settings.transition, speed: 1.0, trails: settings.trails, hue: 0.0, ..crate::fx::Settings::default() };
        assert_eq!(kept_from(&live(20.0).view(&as_set), &as_set).tweaks, None);
        // Speed turned up live: only speed is kept.
        let faster = crate::fx::Settings { speed: 2.0, ..as_set.clone() };
        let kept = kept_from(&live(20.0).view(&faster), &faster);
        assert_eq!(kept.tweaks, Some(Tweaks { speed: Some(2.0), ..Tweaks::default() }));
        // The playlist's settings edited between runs (hue, change every 10 s): on
        // the next launch the deck has those, and only the speed tweak goes back.
        let edited = Settings { change: Change::Seconds { every: 10.0 }, hue: 0.5, ..settings };
        let next_launch = crate::actions::Live { settings: Some(edited), ..live(10.0) };
        let fx = crate::fx::Settings { hue: 0.5, ..as_set.clone() };
        assert_eq!(again(&kept, &next_launch.view(&fx), &fx), vec![Action::Fx(FxAction::Speed { speed: 2.0 })]);
        // The change timing tweaked: auto, seconds and bars go together.
        let timing = kept_from(&live(45.0).view(&as_set), &as_set).tweaks.unwrap();
        assert_eq!((timing.auto, timing.seconds, timing.bars, timing.speed), (Some(true), Some(45.0), Some(0), None));
    }

    #[test]
    fn puts_back_only_the_tweaks_that_differ_and_holds_last() {
        let fx = crate::fx::Settings::default();
        let deck = crate::actions::Live::default().view(&fx);
        // Nothing kept, or nothing different: nothing to do.
        assert!(again(&Resume::default(), &deck, &fx).is_empty());
        assert!(again(&Resume { tweaks: Some(tweaks()), ..Resume::default() }, &deck, &fx).is_empty());
        let r = Resume { tweaks: Some(Tweaks { speed: Some(0.5), auto: Some(true), seconds: Some(10.0), ..tweaks() }), hold: true, ..Resume::default() };
        assert_eq!(again(&r, &deck, &fx), vec![Action::Fx(FxAction::Speed { speed: 0.5 }), Action::Seconds { seconds: 10.0 }, Action::Auto { on: Some(true) }, Action::Hold { on: Some(true) }]);
        // Bars first, which turn auto off, then auto as it was.
        let bars = Resume { tweaks: Some(Tweaks { bars: Some(8), ..tweaks() }), ..Resume::default() };
        assert_eq!(again(&bars, &deck, &fx), vec![Action::Bars { bars: 8 }, Action::Auto { on: Some(false) }]);
        // Already held: not toggled.
        let held = crate::actions::Live { hold: true, ..crate::actions::Live::default() }.view(&fx);
        assert!(again(&Resume { hold: true, ..Resume::default() }, &held, &fx).is_empty());
    }

    #[test]
    fn a_failed_preset_is_marked_until_its_file_changes_or_it_opens() {
        let root = std::env::temp_dir().join(format!("visuals-resume-failed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let bad = root.join("bad.milk");
        std::fs::write(&bad, "[preset00]\nper_frame_1=zoom=(;\n").unwrap();
        let mut failures = BTreeMap::new();
        assert!(mark(&mut failures, &bad, Verdict::Failed));
        assert!(!mark(&mut failures, &bad, Verdict::Failed), "marked once");
        assert_eq!(still_failing(failures.clone()).len(), 1);
        // Kept and read back as the file has it.
        let text = serde_json::to_string(&FailedFile { presets: failures.clone() }).unwrap();
        let back: FailedFile = serde_json::from_str(&text).unwrap();
        assert_eq!(back.presets, failures);
        // Edited (another size): no longer marked.
        std::fs::write(&bad, "[preset00]\nper_frame_1=zoom=1.01;\n").unwrap();
        assert!(still_failing(failures.clone()).is_empty());
        // It opened after all: unmarked.
        assert!(mark(&mut failures, &bad, Verdict::Loaded));
        assert!(failures.is_empty());
        // A missing file is never marked.
        assert!(!mark(&mut failures, &root.join("gone.milk"), Verdict::Failed));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_preset_that_panicked_drawing_is_unmarked_only_by_drawing() {
        let root = std::env::temp_dir().join(format!("visuals-resume-drawing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let x = root.join("x.milk");
        std::fs::write(&x, "[preset00]\n").unwrap();
        let mut failures = BTreeMap::new();
        assert!(mark(&mut failures, &x, Verdict::PanickedDrawing));
        // Reopening loads it fine, which says nothing about drawing: still marked.
        assert!(!mark(&mut failures, &x, Verdict::Loaded));
        assert!(failures[&x.to_string_lossy().into_owned()].drawing);
        // Failing to load as well doesn't forget that it has to draw.
        mark(&mut failures, &x, Verdict::Failed);
        assert!(!mark(&mut failures, &x, Verdict::Loaded));
        // Kept as such across launches, while the file is the same.
        let back: FailedFile = serde_json::from_str(&serde_json::to_string(&FailedFile { presets: failures.clone() }).unwrap()).unwrap();
        assert_eq!(back.presets, failures);
        assert_eq!(still_failing(failures.clone()), failures);
        // It drew: unmarked.
        assert!(mark(&mut failures, &x, Verdict::Drew));
        assert!(failures.is_empty());
        // A load failure's mark isn't written with the flag, as before.
        mark(&mut failures, &x, Verdict::Failed);
        assert!(!serde_json::to_string(&FailedFile { presets: failures.clone() }).unwrap().contains(r#""drawing""#));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_panic_steps_on_only_from_the_preset_the_deck_is_on_within_the_budget() {
        let (a, b) = (PathBuf::from("/p/a.milk"), PathBuf::from("/p/b.milk"));
        let mut panics = Panics::default();
        // The deck moved on to b before a's panic was heard: a is marked, b left be.
        assert_eq!(panics.panicked(&a, Some(&b)), OnPanic::Leave);
        assert!(panics.refused(&a).is_some());
        assert!(panics.refused(&b).is_none());
        assert_eq!(panics.panicked(&a, None), OnPanic::Leave);
        // Panics in a row on what the deck shows step on, BUDGET times, then stop.
        let steps = (0..20).map(|n| PathBuf::from(format!("/p/{n}.milk"))).take_while(|p| panics.panicked(p, Some(p)) == OnPanic::Step).count();
        assert_eq!(steps, BUDGET);
        assert_eq!(panics.panicked(&b, Some(&b)), OnPanic::Stop, "stays stopped");
        // A preset drawing steadily makes the budget whole again.
        panics.steady();
        assert_eq!(panics.panicked(&b, Some(&b)), OnPanic::Step);
        // Drawing a refresh lets the deck open it again.
        panics.drew(&a);
        assert!(panics.refused(&a).is_none());
    }

    #[test]
    fn only_a_preset_s_own_failure_marks_it() {
        let bad = serde_json::json!({ "report": { "equations": [{ "message": "unexpected (" }] } });
        let good = serde_json::json!({ "report": { "equations": [] } });
        // The bench wasn't there to ask: reported, not marked.
        let (r, mark) = judge::<Value>(Ok(()), || Err("the bench isn't running".into()));
        assert!(r.is_err());
        assert_eq!(mark, None);
        // The bench said its equations fail (or it panicked loading): marked.
        assert_eq!(judge(Ok(()), || Ok(bad.clone())).1, Some(true));
        // The file isn't a preset: marked, without asking the bench.
        assert_eq!(judge::<Value>(Err("is not a file".into()), || panic!("not asked")).1, Some(true));
        // It opened: unmarked.
        assert_eq!(judge(Ok(()), || Ok(good.clone())).1, Some(false));
    }

    #[test]
    fn the_library_gets_the_bench_s_report_and_the_deck_an_error() {
        let bad = serde_json::json!({ "report": { "equations": [{ "message": "unexpected (" }] } });
        // Marked either way; the library's open still has the report to show where it failed.
        let (result, mark) = judge(Ok(()), || Ok(bad.clone()));
        assert_eq!((result.as_ref().ok(), mark), (Some(&bad), Some(true)));
        // The deck's open makes it an error.
        assert_eq!(for_the_deck(result), (None, Some("it didn't load (unexpected ()".into())));
        let good = serde_json::json!({ "report": { "equations": [] } });
        assert_eq!(for_the_deck::<Value>(Ok(good.clone())), (Some(good), None));
        assert_eq!(for_the_deck::<Value>(Err("gone".into())), (None, Some("gone".into())));
    }

    #[test]
    fn a_deck_is_kept_once_saved_and_tried_again_when_a_save_fails() {
        let kept = Mutex::new(None);
        let deck = r(Some("p"), Some(1), None);
        let mut tries = 0;
        keep(&kept, deck.clone(), |_| {
            tries += 1;
            false
        });
        assert_eq!(*kept.lock().unwrap(), None, "a failed save isn't remembered");
        keep(&kept, deck.clone(), |_| {
            tries += 1;
            true
        });
        assert_eq!(tries, 2, "tried again");
        keep(&kept, deck.clone(), |_| panic!("unchanged: not saved again"));
        assert_eq!(*kept.lock().unwrap(), Some(deck));
    }

    #[test]
    fn a_preset_the_bench_would_not_load_is_a_failure_and_stepping_skips_it() {
        let opened = serde_json::json!({ "preset": {}, "report": { "equations": [{ "stage": "equations", "message": "unexpected (", "line": null }], "shaders": [] } });
        assert_eq!(load_problem(&opened).as_deref(), Some("it didn't load (unexpected ()"));
        // Shaders that fell back to MilkDrop's default still draw: not a failure.
        let fell_back = serde_json::json!({ "preset": {}, "report": { "equations": [], "shaders": [{ "stage": "warp", "message": "x", "line": null }] } });
        assert_eq!(load_problem(&fell_back), None);
        assert_eq!(WHEN_FAILED, Failed::Skip, "stepping moves on past it, with a note in the status strip that fades (decision 60)");
    }
}
