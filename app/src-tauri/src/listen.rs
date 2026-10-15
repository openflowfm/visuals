//! Audio in: an app's sound or the whole Mac's through a process tap
//! ([`crate::tap`]), or any Core Audio input and two of its channels, written
//! into the engine's ring ([`engine::live`]) for the render thread to read once
//! a frame. The page's audio commands, and the choice kept for next time.

use crate::tap::{self, Permission, Process, Target};
use crate::{bench, App};
use cpal::traits::{DeviceTrait, HostTrait};
use engine::live::{peaks, Sink};
#[path = "listen_access.rs"]
mod access;
#[path = "listen_connect.rs"]
mod connect;
use crate::audio::{Lane, LaneStatus, Status};
use std::sync::atomic::{AtomicBool, Ordering};
pub use engine::live::{ring, Ring};
use std::sync::Mutex;
use tauri::State;

fn name_of(d: &cpal::Device) -> String {
    d.description().map(|d| d.name().to_owned()).unwrap_or_default()
}

#[derive(serde::Serialize)]
pub struct Input {
    pub uid: Option<String>,
    pub name: String,
    pub channels: u16,
}

#[tauri::command]
pub fn inputs() -> Vec<Input> {
    let host = cpal::default_host();
    host.input_devices()
        .into_iter()
        .flatten()
        .map(|d| Input { uid: d.id().ok().map(|id| id.to_string()), name: name_of(&d), channels: engine::live::input_config(&d).map(|c| c.channels()).unwrap_or(0) })
        .collect()
}

/// Something to listen to: an app's sound or the whole system's, through a
/// process tap ([`crate::tap`]), or an input device as [`inputs`] lists it.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SourceId {
    /// The app with this bundle identifier.
    App { bundle: String },
    /// Everything the Mac plays.
    System,
    /// An input device, `size` its channel count to tell same-named ones apart.
    Device {
        name: String,
        size: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uid: Option<String>,
    },
}

#[derive(serde::Serialize)]
pub struct Source {
    id: SourceId,
    name: String,
    channels: u16,
}

#[derive(serde::Serialize)]
pub struct AudioSources {
    /// Whether apps and the system can be listened to on this Mac.
    taps: bool,
    sources: Vec<Source>,
}

/// What the picker calls the whole Mac's sound.
pub const EVERYTHING: &str = "everything on this Mac";

/// Said when macOS keeps other apps' sound from this one.
const NOT_ALLOWED: &str = "visual[flow] isn't allowed to hear other apps: turn it on in System Settings › Privacy & Security › Screen & System Audio Recording";

/// An app that can be listened to: every process of it, helpers included,
/// plays into one tap.
#[derive(Debug, PartialEq)]
struct Playing {
    bundle: String,
    /// The process to name it by: the app itself when it has opened audio.
    pid: i32,
    daw: bool,
}

/// The apps worth offering, from Core Audio's processes: running DAWs, playing
/// or not, then any other app playing sound now. Not `me`.
fn apps(processes: &[Process], me: i32) -> Vec<Playing> {
    let mut found: Vec<(Playing, bool)> = vec![];
    for p in processes.iter().filter(|p| p.pid != me && !p.bundle.is_empty()) {
        let bundle = tap::app_of(&p.bundle);
        match found.iter_mut().find(|(a, _)| a.bundle == bundle) {
            Some((_, playing)) => *playing |= p.playing,
            None => found.push((Playing { bundle: bundle.to_owned(), pid: pid_of(processes, bundle, me).unwrap_or(p.pid), daw: tap::daw(bundle).is_some() }, p.playing)),
        }
    }
    let mut apps: Vec<Playing> = found.into_iter().filter(|(a, playing)| a.daw || *playing).map(|(a, _)| a).collect();
    // DAWs first; otherwise in Core Audio's order.
    apps.sort_by_key(|a| !a.daw);
    apps
}

/// The process to name `bundle` by, and whose change means the app restarted:
/// the app itself when it has opened audio, else its first helper. Not `me`.
fn pid_of(processes: &[Process], bundle: &str, me: i32) -> Option<i32> {
    let mut mine = processes.iter().filter(|p| p.pid != me && tap::belongs(&p.bundle, bundle));
    let first = mine.next()?;
    Some(std::iter::once(first).chain(mine).find(|p| p.bundle == bundle).unwrap_or(first).pid)
}

/// Whether a tap on `bundle` that hears `tapped`, named by `main`, should be
/// opened again: the app's own process changed (it restarted), or a process of
/// it that the tap misses is playing. Helpers coming and going alone don't count.
fn retap(processes: &[Process], bundle: &str, me: i32, tapped: &[u32], main: Option<i32>) -> bool {
    pid_of(processes, bundle, me) != main || processes.iter().any(|p| p.pid != me && tap::belongs(&p.bundle, bundle) && p.playing && !tapped.contains(&p.object))
}

/// An app's name: the DAW's, or what the Dock calls it.
fn app_name(bundle: &str, pid: Option<i32>) -> String {
    tap::daw(bundle).map(str::to_owned).or_else(|| pid.and_then(tap::app_name)).unwrap_or_else(|| bundle.to_owned())
}

/// The Core Audio objects of every process of `bundle`, sorted.
fn objects_of(bundle: &str) -> Vec<u32> {
    let me = std::process::id() as i32;
    let mut objects: Vec<u32> = tap::processes().into_iter().filter(|p| p.pid != me && tap::belongs(&p.bundle, bundle)).map(|p| p.object).collect();
    objects.sort();
    objects
}

/// Everything there is to listen to: running DAWs, everything on this Mac,
/// other apps playing sound (all three on macOS 14.4 and later), and the input
/// devices.
#[tauri::command(async)]
pub fn audio_sources() -> AudioSources {
    let taps = tap::supported();
    let mut sources = vec![];
    if taps {
        let apps = apps(&tap::processes(), std::process::id() as i32);
        let daws = apps.iter().filter(|a| a.daw).count();
        sources.extend(apps.into_iter().map(|a| Source { name: app_name(&a.bundle, Some(a.pid)), id: SourceId::App { bundle: a.bundle }, channels: 2 }));
        sources.insert(daws, Source { id: SourceId::System, name: EVERYTHING.into(), channels: 2 });
    }
    sources.extend(inputs().into_iter().map(|i| Source { id: SourceId::Device { name: i.name.clone(), size: i.channels as usize, uid: i.uid }, name: i.name, channels: i.channels }));
    AudioSources { taps, sources }
}

/// How sound arrives: an input device's stream, or a tap, the processes it
/// hears and the app process it is named by.
enum Stream {
    Input(#[allow(dead_code)] cpal::Stream),
    Tap(#[allow(dead_code)] tap::Tap, Vec<u32>, Option<i32>),
    #[cfg(test)]
    Fake,
    #[cfg(test)]
    FakeTracked(#[allow(dead_code)] DropNotice),
}
#[cfg(test)]
struct DropNotice(std::sync::mpsc::Sender<()>);
#[cfg(test)]
impl Drop for DropNotice {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

/// What is being listened to. Dropping it stops listening.
pub struct Listening {
    stream: Stream,
    pub source: SourceId,
    pub name: String,
    pub rate: f32,
    /// How many channels the source has.
    pub channels: usize,
    /// The two it is listening to, from 0.
    pub left: usize,
    pub right: usize,
}

/// What is being listened to, as the page shows it: channels counted from 1.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    pub name: String,
    pub left: usize,
    pub right: usize,
    /// The input's channel count, which tells same-named inputs apart.
    #[serde(default)]
    pub size: usize,
}

impl Listening {
    pub fn choice(&self) -> Choice {
        Choice { name: self.name.clone(), left: self.left + 1, right: self.right + 1, size: self.channels }
    }

    /// The processes a tap hears and the app process it is named by; nothing for an input.
    fn tapped(&self) -> (&[u32], Option<i32>) {
        match &self.stream {
            Stream::Tap(_, objects, main) => (objects, *main),
            _ => (&[], None),
        }
    }

    /// Whether this is a tap, which needs the permission to hear other apps.
    fn is_tap(&self) -> bool {
        matches!(self.source, SourceId::App { .. } | SourceId::System)
    }
}

/// Where the last choice is kept in [`crate::settings::dir`], so the app comes
/// back listening to it.
const SAVED: &str = "audio.json";

/// The choice kept for next time: channels count from 1.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct Saved {
    pub source: SourceId,
    pub left: usize,
    pub right: usize,
}

/// `audio.json` as this version writes it, or as 0.2 did (an input by name).
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SavedFile {
    Now(Saved),
    Before(Choice),
}

impl From<SavedFile> for Saved {
    fn from(file: SavedFile) -> Saved {
        match file {
            SavedFile::Now(s) => s,
            SavedFile::Before(c) => Saved { source: SourceId::Device { name: c.name, size: c.size, uid: None }, left: c.left, right: c.right },
        }
    }
}

/// What was chosen last, to go back to when it comes back after going away
/// (an app that quit, an interface unplugged).
static WANTED: Mutex<Option<Saved>> = Mutex::new(None);

/// Why each lane's chosen source isn't heard (main, then microphone): the last
/// failed open, naming the source. Cleared when it opens or the lane turns off.
static TROUBLE: Mutex<[Option<String>; 2]> = Mutex::new([None, None]);

/// Whether the main lane's chosen source was seen gone while nothing was heard,
/// so [`follow`] opens it when it comes back.
static AWAITED: AtomicBool = AtomicBool::new(false);

fn trouble(lane: Lane) -> Option<String> {
    TROUBLE.lock().unwrap()[lane.index()].clone()
}
fn set_trouble(lane: Lane, why: Option<String>) {
    TROUBLE.lock().unwrap()[lane.index()] = why;
}

/// A source as the page names it, for saying which one failed.
fn source_name(source: Option<&SourceId>) -> String {
    match source {
        None => "the system input".into(),
        Some(SourceId::System) => EVERYTHING.into(),
        Some(SourceId::App { bundle }) => app_name(bundle, None),
        Some(SourceId::Device { name, .. }) => name.clone(),
    }
}

/// Open `source` for `lane`, an error naming the source and why it failed.
fn open_named(world: &dyn World, lane: Lane, source: Option<&SourceId>, channels: (usize, usize), ring: Sink) -> Result<Listening, String> {
    let opened = world.open(source, channels, ring).map_err(|e| format!("Couldn't open {}: {e}", source_name(source)));
    set_trouble(lane, opened.as_ref().err().cloned());
    opened
}

/// Listen to `source`, or else to the input `name` (the system input when
/// absent), channels `left` and `right` counted from 1. Returns the source's name.
/// Runs off the main thread: opening the first tap can wait on macOS's
/// permission prompt, which must not freeze the window.
#[tauri::command(async)]
pub fn listen_to(name: Option<String>, size: Option<usize>, left: Option<usize>, right: Option<usize>, source: Option<SourceId>, app: State<App>) -> Result<String, String> {
    let _operation = app.audio.operation.lock().unwrap();
    if app.audio.suspended.load(Ordering::Relaxed) {
        return Err("Stop the test sound before changing audio inputs".into());
    }
    let source = source.or_else(|| name.map(|name| SourceId::Device { name, size: size.unwrap_or(0), uid: None }));
    let (name, saved) = choose(&Mac, &app, source, left, right)?;
    chosen_since_startup(&app, Lane::Main);
    app.audio.preferences.lock().unwrap().main_off = false;
    crate::settings::save_json("audio-lanes.json", &*app.audio.preferences.lock().unwrap());
    crate::settings::save_json(SAVED, &saved);
    Ok(name)
}

/// Make `source` the choice and listen to it, as one step under the listening
/// lock: the choice is set before opening, so [`follow`] can never act on the
/// one before it. A failed open puts the choice back. Returns the source's
/// name and the choice to keep for next time.
fn choose(world: &dyn World, app: &App, source: Option<SourceId>, left: Option<usize>, right: Option<usize>) -> Result<(String, Saved), String> {
    let mut slot = app.listening.lock().unwrap();
    let before = WANTED.lock().unwrap().clone();
    if let Some(s) = &source {
        *WANTED.lock().unwrap() = Some(Saved { source: s.clone(), left: left.unwrap_or(1), right: right.unwrap_or(2) });
    }
    match listen_on(world, app, &mut slot, source.as_ref(), left, right) {
        Ok((choice, heard)) => {
            let saved = Saved { source: heard, left: choice.left, right: choice.right };
            *WANTED.lock().unwrap() = Some(saved.clone());
            Ok((choice.name, saved))
        }
        Err(e) => {
            *WANTED.lock().unwrap() = before;
            Err(e)
        }
    }
}

/// Where sound comes from: this Mac, or a stand-in in tests.
trait World: Sync {
    /// A fixture world can forbid acquisition before any source lookup or open.
    fn acquisition_allowed(&self) -> bool {
        true
    }

    /// Open `source` (the system input when `None`) on channels `left` and
    /// `right` (from 0), writing into `ring`.
    fn open(&self, source: Option<&SourceId>, channels: (usize, usize), ring: Sink) -> Result<Listening, String>;
    /// Whether `source` can't be heard any more: its app quit, or its input is unplugged.
    fn gone(&self, source: &SourceId) -> bool;
    fn processes(&self) -> Vec<Process>;
    fn taps_allowed(&self) -> bool;
}

struct Mac;

impl World for Mac {
    fn acquisition_allowed(&self) -> bool {
        !crate::dev::camera_capture_fixture()
    }

    fn open(&self, source: Option<&SourceId>, channels: (usize, usize), ring: Sink) -> Result<Listening, String> {
        physical_audio_allowed()?;
        let source = source.cloned();
        // An input device: settle macOS's microphone permission first, so the open
        // never waits on its prompt inside the driver, and a slow device fails fast.
        let (key, device) = match source.as_ref() {
            None => ("input:system".to_owned(), true),
            Some(SourceId::Device { name, size, uid }) => (format!("input:{}", uid.clone().unwrap_or_else(|| format!("{name}/{size}"))), true),
            Some(SourceId::System) => ("tap:system".to_owned(), false),
            Some(SourceId::App { bundle }) => (format!("tap:{bundle}"), false),
        };
        if device {
            access::microphone_allowed()?;
        }
        connect::run(key, if device { connect::DEVICE_DEADLINE } else { connect::TAP_DEADLINE }, move |attempt| {
            attempt.stage("finding the audio source")?;
            let opened = match source.as_ref() {
                None => listen_device(None, None, None, channels, ring, &attempt),
                Some(SourceId::Device { name, size, uid }) => listen_device(Some(name), Some(*size), uid.as_deref(), channels, ring, &attempt),
                Some(SourceId::System) => tapped(SourceId::System, Target::Everything, EVERYTHING.into(), vec![], None, channels, ring),
                Some(SourceId::App { bundle }) => {
                    let objects = objects_of(bundle);
                    if objects.is_empty() {
                        return Err(format!("{} isn't running", app_name(bundle, None)));
                    }
                    // Named by the same process as in `audio_sources`, so the picker finds it.
                    let pid = pid_of(&tap::processes(), bundle, std::process::id() as i32);
                    tapped(SourceId::App { bundle: bundle.clone() }, Target::Processes(objects.clone()), app_name(bundle, pid), objects, pid, channels, ring)
                }
            }?;
            attempt.stage("returning the audio connection")?;
            Ok(opened)
        })
    }

    fn gone(&self, source: &SourceId) -> bool {
        match source {
            SourceId::App { bundle } => objects_of(bundle).is_empty(),
            SourceId::System => false,
            SourceId::Device { name, size, uid } => !inputs().iter().any(|i| uid.as_ref().map_or(i.name == *name && i.channels as usize == *size, |id| i.uid.as_ref() == Some(id))),
        }
    }

    fn processes(&self) -> Vec<Process> {
        tap::processes()
    }

    fn taps_allowed(&self) -> bool {
        tap::supported() && tap::permission() != Permission::Denied
    }
}

fn tapped(source: SourceId, target: Target, name: String, objects: Vec<u32>, main: Option<i32>, channels: (usize, usize), ring: Sink) -> Result<Listening, String> {
    physical_audio_allowed()?;
    if !tap::supported() {
        return Err("listening to apps needs macOS 14.4 or later".into());
    }
    if tap::permission() == Permission::Denied {
        return Err(NOT_ALLOWED.into());
    }
    let t = tap::open_sink(&target, channels, ring)?;
    // The first tap asks; a refusal leaves it open but silent, which `listening` reports.
    if tap::permission() == Permission::Denied {
        eprintln!("{NOT_ALLOWED}");
    }
    let last = t.channels.max(1) - 1;
    Ok(Listening { source, name, rate: t.rate, channels: t.channels, left: channels.0.min(last), right: channels.1.min(last), stream: Stream::Tap(t, objects, main) })
}

/// Open a source into `slot` (the listening lock, held) and make it what the
/// bench hears. Channels count from 1. The new source opens before the old one
/// closes, so a switch that fails leaves the bench hearing what it heard.
/// Returns what is heard and its source.
fn listen_on(world: &dyn World, app: &App, slot: &mut Option<Listening>, source: Option<&SourceId>, left: Option<usize>, right: Option<usize>) -> Result<(Choice, SourceId), String> {
    if !world.acquisition_allowed() {
        return Err("Audio acquisition is disabled for the headless Camera UI fixture".into());
    }
    let channels = (left.unwrap_or(1).max(1) - 1, right.unwrap_or(2).max(1) - 1);
    if source.is_some_and(|source| app.audio.mic.lock().unwrap().as_ref().is_some_and(|mic| &mic.source == source)) {
        return Err("This input is already selected as the microphone".into());
    }
    let (port, sink) = app.audio.prepare();
    let l = open_named(world, Lane::Main, source, channels, sink)?;
    if app.audio.mic.lock().unwrap().as_ref().is_some_and(|mic| mic.source == l.source) {
        return Err("This input is already selected as the microphone".into());
    }
    app.audio.commit(Lane::Main, port, l.rate, app.ring.clone());
    app.send(bench::Cmd::SampleRate(crate::audio::RATE));
    let choice = l.choice();
    let heard = l.source.clone();
    eprintln!("listening to {} on channels {} and {} of {}, at {} Hz", choice.name, choice.left, choice.right, l.channels, l.rate);
    *slot = Some(l);
    Ok((choice, heard))
}

/// What to listen to when `gone` goes away: the whole Mac for an app (when this
/// Mac can tap it). Nothing for an input device: another device is never swapped
/// in for it.
fn fallback(gone: &SourceId, taps: bool) -> Option<SourceId> {
    match gone {
        SourceId::App { .. } if taps => Some(SourceId::System),
        _ => None,
    }
}

/// Listen to what stands in for `gone`, keeping its channels. With no stand-in
/// (an input device), or when it fails too, the main lane goes quiet and waits
/// for `gone` itself ([`follow`] opens it again when it's back), saying why.
fn fall_back(world: &dyn World, app: &App, slot: &mut Option<Listening>, gone: &SourceId, left: usize, right: usize) -> Result<Choice, String> {
    if let Some(instead) = fallback(gone, world.taps_allowed()) {
        eprintln!("{gone:?} is gone; listening to {EVERYTHING} instead");
        if let Ok((c, _)) = listen_on(world, app, slot, Some(&instead), Some(left), Some(right)) {
            return Ok(c);
        }
    }
    if slot.as_ref().is_some_and(|l| &l.source == gone) {
        *slot = None;
        app.audio.clear(Lane::Main, &app.ring);
    }
    let missing = if matches!(gone, SourceId::App { .. }) { "isn't running" } else { "is disconnected" };
    let why = trouble(Lane::Main).unwrap_or_else(|| format!("{} {missing}", source_name(Some(gone))));
    set_trouble(Lane::Main, Some(why.clone()));
    eprintln!("{why}; waiting for it");
    Err(why)
}

const START_MAIN: u8 = 1;
const START_MIC: u8 = 2;

/// Reserve the saved routes before the page can poll, but never acquire audio on
/// the main thread. The worker owns an AppHandle for the lifetime of its work.
pub fn start(handle: &tauri::AppHandle) {
    use tauri::Manager;
    if !Mac.acquisition_allowed() {
        return;
    }
    let saved = crate::settings::load::<SavedFile>(SAVED).map(Saved::from);
    let first_run = crate::settings::first_run();
    let app = handle.state::<App>();
    prepare_startup(&app, crate::settings::load("audio-lanes.json").unwrap_or_default(), saved.clone());
    let handle = handle.clone();
    if let Err(error) = spawn_startup(move || resume_startup_with(&Mac, &handle.state::<App>(), saved, first_run)) {
        app.audio.startup.store(0, Ordering::Release);
        eprintln!("couldn't start saved audio in the background: {error}");
    }
}
fn spawn_startup(work: impl FnOnce() + Send + 'static) -> std::io::Result<std::thread::JoinHandle<()>> {
    std::thread::Builder::new().name("saved audio startup".into()).spawn(work)
}
fn prepare_startup(app: &App, preferences: crate::audio::Preferences, saved: Option<Saved>) {
    let _operation = app.audio.operation.lock().unwrap();
    *app.audio.preferences.lock().unwrap() = preferences;
    *WANTED.lock().unwrap() = saved;
    app.audio.startup.store(START_MAIN | START_MIC, Ordering::Release);
}
fn resume_startup_with(world: &dyn World, app: &App, saved: Option<Saved>, first_run: bool) {
    let _operation = app.audio.operation.lock().unwrap();
    let lanes = app.audio.startup.swap(0, Ordering::AcqRel);
    // A choice that beat this worker to the operation lock owns that lane. A
    // choice made later runs after startup, so it remains the final selection.
    if lanes & START_MAIN != 0 {
        resume_with(world, app, saved, first_run);
    }
    if lanes & START_MIC != 0 {
        follow_mic(world, app);
    }
}
fn chosen_since_startup(app: &App, lane: Lane) {
    app.audio.startup.fetch_and(
        !match lane {
            Lane::Main => START_MAIN,
            Lane::Mic => START_MIC,
        },
        Ordering::AcqRel,
    );
}

/// Come back listening to what was chosen last, or what stands in for it when
/// it is gone. Nothing chosen during the first run: nothing is opened, so macOS
/// asks nothing about the microphone before the welcome's "Listen to" step has
/// said why. Nothing chosen once the first run is done (finished, skipped, or an
/// install from before the welcome): the system's default input, as before.
pub fn resume(app: &App) {
    let _operation = app.audio.operation.lock().unwrap();
    app.audio.startup.store(0, Ordering::Release);
    *app.audio.preferences.lock().unwrap() = crate::settings::load("audio-lanes.json").unwrap_or_default();
    resume_with(&Mac, app, crate::settings::load::<SavedFile>(SAVED).map(Saved::from), crate::settings::first_run());
    follow_mic(&Mac, app);
}

fn resume_with(world: &dyn World, app: &App, saved: Option<Saved>, first_run: bool) {
    if !world.acquisition_allowed() || app.audio.preferences.lock().unwrap().main_off || app.audio.suspended.load(Ordering::Relaxed) {
        return;
    }
    let mut slot = app.listening.lock().unwrap();
    *WANTED.lock().unwrap() = saved.clone();
    let Some(s) = saved else {
        if first_run {
            eprintln!("nothing chosen to listen to yet");
        } else if let Err(e) = listen_on(world, app, &mut slot, None, None, None) {
            eprintln!("no audio input: {e}");
        }
        return;
    };
    let heard = listen_on(world, app, &mut slot, Some(&s.source), Some(s.left), Some(s.right)).map(|(c, _)| c).or_else(|_| fall_back(world, app, &mut slot, &s.source, s.left, s.right));
    if let Err(e) = heard {
        eprintln!("no audio input: {e}");
    }
}

/// Keep listening to what was chosen: fall back when it goes away, and go back
/// to it when it returns (or, for an app, restarts or starts playing from a
/// process the tap misses). Run each time the page asks what is heard, every
/// few seconds. The choice is read under the listening lock, so a choice being
/// made ([`choose`]) is never undone by one made before it. With nothing open
/// and nothing chosen, the system's default input opens once `first_run` says
/// the welcome is over (it was skipped without picking a source).
fn follow(world: &dyn World, app: &App, first_run: impl Fn() -> bool) {
    if app.audio.startup.load(Ordering::Acquire) & START_MAIN != 0 {
        return;
    }
    if !world.acquisition_allowed() || app.audio.preferences.lock().unwrap().main_off || app.audio.suspended.load(Ordering::Relaxed) {
        return;
    }
    let mut slot = app.listening.lock().unwrap();
    let wanted = WANTED.lock().unwrap().clone();
    if slot.is_none() && wanted.is_none() && !first_run() {
        let _ = listen_on(world, app, &mut slot, None, None, None);
        return;
    }
    let Some((source, tapped, main, left, right)) = slot.as_ref().map(|l| (l.source.clone(), l.tapped().0.to_vec(), l.tapped().1, l.left + 1, l.right + 1)) else {
        // Nothing heard: the chosen source went away or didn't open. Open it again
        // once it has been away and is back; one that is here but failed to open
        // waits for the user to pick it again, rather than stalling every poll.
        if let Some(w) = wanted {
            if world.gone(&w.source) {
                AWAITED.store(true, Ordering::Release);
            } else if AWAITED.swap(false, Ordering::AcqRel) {
                let _ = listen_on(world, app, &mut slot, Some(&w.source), Some(w.left), Some(w.right));
            }
        }
        return;
    };
    if let Some(w) = wanted {
        let changed = match &w.source {
            SourceId::App { bundle } if w.source == source => retap(&world.processes(), bundle, std::process::id() as i32, &tapped, main),
            _ => w.source != source,
        };
        if changed && !world.gone(&w.source) && listen_on(world, app, &mut slot, Some(&w.source), Some(w.left), Some(w.right)).is_ok() {
            return;
        }
    }
    if world.gone(&source) {
        // Why is that it went away, not an older failed switch.
        set_trouble(Lane::Main, None);
        let _ = fall_back(world, app, &mut slot, &source, left, right);
    }
}

#[derive(serde::Serialize)]
pub struct Heard {
    /// The source and the two channels heard, from 1; absent when nothing is open.
    choice: Option<Choice>,
    /// How many channels the source has.
    channels: usize,
    /// Whether a tap is heard but macOS refused it other apps' sound, so it hears silence.
    denied: bool,
}

/// What the bench is listening to, after following the chosen source ([`follow`]).
#[tauri::command(async)]
pub fn listening(app: State<App>) -> Heard {
    let _operation = app.audio.operation.lock().unwrap();
    follow(&Mac, &app, crate::settings::first_run);
    follow_mic(&Mac, &app);
    let l = app.listening.lock().unwrap();
    let denied = l.as_ref().is_some_and(|l| l.is_tap()) && tap::permission() == Permission::Denied;
    Heard { choice: l.as_ref().map(|l| l.choice()), channels: l.as_ref().map_or(0, |l| l.channels), denied }
}

/// The loudest sample in the left and right channels' latest windows, for a meter.
#[tauri::command]
pub fn levels(app: State<App>) -> (f32, f32) {
    peaks(&app.ring)
}

/// Last boundary before Core Audio device/tap acquisition. Keep this even when
/// callers already use the World guard: direct low-level callers must be safe.
fn physical_audio_allowed() -> Result<(), String> {
    if crate::dev::camera_capture_fixture() { Err("Audio acquisition is disabled for the headless Camera UI fixture".into()) } else { Ok(()) }
}

/// Open `input` (the system input when `None`) and write channels `left` and
/// `right` (from 0) into `ring`.
/// `size`, when given, picks between inputs that share a name — macOS calls
/// every aggregate device "Aggregate Device" — by their channel count.
fn listen_device(input: Option<&str>, size: Option<usize>, uid: Option<&str>, channels: (usize, usize), ring: Sink, attempt: &connect::Attempt) -> Result<Listening, String> {
    physical_audio_allowed()?;
    let host = cpal::default_host();
    let device = if let Some(uid) = uid {
        host.device_by_id(&uid.parse().map_err(|e: cpal::Error| e.to_string())?).ok_or("selected input is disconnected")?
    } else {
        match input {
            Some(want) => {
                let named: Vec<cpal::Device> = host.input_devices().map_err(|e| e.to_string())?.filter(|d| name_of(d) == want).collect();
                let channels_of = |d: &cpal::Device| engine::live::input_config(d).map(|c| c.channels() as usize).unwrap_or(0);
                let at = if size.is_some_and(|n| n > 0) { named.iter().position(|d| Some(channels_of(d)) == size).ok_or("selected input is disconnected")? } else { 0 };
                named.into_iter().nth(at).ok_or_else(|| format!("no input called {want}"))?
            }
            None => host.default_input_device().ok_or("no system input")?,
        }
    };
    let open = engine::live::open_input_sink_with_progress(&device, channels, ring, |stage| attempt.stage(stage))?;
    let name = name_of(&device);
    Ok(Listening {
        stream: Stream::Input(open.stream),
        source: SourceId::Device { name: name.clone(), size: open.channels, uid: device.id().ok().map(|id| id.to_string()) },
        name,
        rate: open.rate,
        channels: open.channels,
        left: open.left,
        right: open.right,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: i32, bundle: &str, playing: bool) -> Process {
        Process { object: pid as u32 + 100, pid, bundle: bundle.into(), playing }
    }

    struct Fake {
        gone: Mutex<Vec<SourceId>>,
        fail: Mutex<bool>,
    }
    impl World for Fake {
        fn open(&self, source: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
            if *self.fail.lock().unwrap() {
                return Err("input failed".into());
            }
            let source = source.cloned().unwrap_or(SourceId::System);
            Ok(Listening { stream: Stream::Fake, source, name: "fixture".into(), rate: 44100.0, channels: 1, left: 0, right: 0 })
        }
        fn gone(&self, s: &SourceId) -> bool {
            self.gone.lock().unwrap().contains(s)
        }
        fn processes(&self) -> Vec<Process> {
            vec![]
        }
        fn taps_allowed(&self) -> bool {
            true
        }
    }
    fn device(name: &str) -> SourceId {
        SourceId::Device { name: name.into(), size: 1, uid: Some(name.into()) }
    }
    #[test]
    fn independent_lanes_preserve_other_lane_and_failed_replacement() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = app();
        let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
        choose_lane_with(&world, &app, Lane::Main, Some(SourceId::System), None, None).unwrap();
        choose_lane_with(&world, &app, Lane::Mic, Some(device("mic")), None, None).unwrap();
        assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, SourceId::System);
        *world.fail.lock().unwrap() = true;
        assert!(choose_lane_with(&world, &app, Lane::Mic, Some(device("other")), None, None).is_err());
        assert_eq!(app.audio.mic.lock().unwrap().as_ref().unwrap().source, device("mic"));
        assert_eq!(app.audio.preferences.lock().unwrap().mic.as_ref().unwrap().source, device("mic"));
        choose_lane_with(&world, &app, Lane::Main, None, None, None).unwrap();
        follow(&world, &app, || false);
        assert!(app.listening.lock().unwrap().is_none());
        assert!(app.audio.mic.lock().unwrap().is_some());
        let persisted = serde_json::to_string(&*app.audio.preferences.lock().unwrap()).unwrap();
        let next = self::app();
        *next.audio.preferences.lock().unwrap() = serde_json::from_str(&persisted).unwrap();
        resume_with(&world, &next, None, false);
        assert!(next.listening.lock().unwrap().is_none());
    }
    #[test]
    fn mic_loss_waits_for_exact_device_and_recovers_without_fallback() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = app();
        let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
        choose_lane_with(&world, &app, Lane::Mic, Some(device("mic")), None, None).unwrap();
        world.gone.lock().unwrap().push(device("mic"));
        follow_mic(&world, &app);
        assert!(app.audio.mic.lock().unwrap().is_none());
        assert!(snapshot(&app).mic.unavailable);
        world.gone.lock().unwrap().clear();
        follow_mic(&world, &app);
        assert_eq!(app.audio.mic.lock().unwrap().as_ref().unwrap().source, device("mic"));
        assert!(choose_lane_with(&world, &app, Lane::Main, Some(device("mic")), None, None).is_err());
        choose_lane_with(&world, &app, Lane::Mic, None, None, None).unwrap();
        follow_mic(&world, &app);
        assert!(app.audio.mic.lock().unwrap().is_none());
    }
    struct Gated {
        entered: Mutex<std::sync::mpsc::Sender<()>>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl World for Gated {
        fn open(&self, source: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
            self.entered.lock().unwrap().send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
            let source = source.cloned().unwrap_or(SourceId::System);
            Ok(Listening { stream: Stream::Fake, source, name: "startup fixture".into(), rate: 48000.0, channels: 2, left: 0, right: 1 })
        }
        fn gone(&self, _: &SourceId) -> bool {
            false
        }
        fn processes(&self) -> Vec<Process> {
            vec![]
        }
        fn taps_allowed(&self) -> bool {
            false
        }
    }
    #[test]
    fn dispatching_startup_returns_while_hardware_is_blocked_and_later_manual_choice_wins() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = std::sync::Arc::new(app());
        let saved = Saved { source: device("saved main"), left: 1, right: 1 };
        prepare_startup(&app, Default::default(), Some(saved.clone()));
        let (entered, opening) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let worker_app = app.clone();
        let worker = spawn_startup(move || resume_startup_with(&Gated { entered: Mutex::new(entered), release: Mutex::new(wait) }, &worker_app, Some(saved), false)).unwrap();
        // This thread can continue before native acquisition returns.
        opening.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert!(!worker.is_finished());
        let (finished, chosen) = std::sync::mpsc::channel();
        let manual_app = app.clone();
        let manual = std::thread::spawn(move || {
            let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
            let status = choose_lane_transaction(&world, &manual_app, Lane::Main, Some(device("manual main")), None, None, |_, _| {}).unwrap();
            finished.send(status.main.source).unwrap();
        });
        assert!(chosen.try_recv().is_err());
        release.send(()).unwrap();
        worker.join().unwrap();
        manual.join().unwrap();
        assert_eq!(chosen.recv().unwrap(), Some(device("manual main")));
        assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, device("manual main"));
    }
    #[test]
    fn polls_cannot_open_default_input_before_reserved_saved_routes() {
        struct NoOpen;
        impl World for NoOpen {
            fn open(&self, _: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
                panic!("poll opened before saved startup")
            }
            fn gone(&self, _: &SourceId) -> bool {
                panic!("poll inspected before saved startup")
            }
            fn processes(&self) -> Vec<Process> {
                vec![]
            }
            fn taps_allowed(&self) -> bool {
                false
            }
        }
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = app();
        prepare_startup(
            &app,
            crate::audio::Preferences { main_off: false, mic: Some(Saved { source: device("saved mic"), left: 1, right: 1 }) },
            Some(Saved { source: device("saved main"), left: 1, right: 1 }),
        );
        follow(&NoOpen, &app, || false);
        follow_mic(&NoOpen, &app);
        assert!(app.listening.lock().unwrap().is_none());
        assert!(app.audio.mic.lock().unwrap().is_none());
    }
    #[test]
    fn early_manual_choices_own_only_their_lane_and_the_other_saved_lane_resumes() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        for lane in [Lane::Main, Lane::Mic] {
            let app = app();
            let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
            let saved = Saved { source: device("saved main"), left: 1, right: 1 };
            prepare_startup(&app, crate::audio::Preferences { main_off: false, mic: Some(Saved { source: device("saved mic"), left: 1, right: 1 }) }, Some(saved.clone()));
            choose_lane_transaction(&world, &app, lane, Some(device("manual")), None, None, |_, _| {}).unwrap();
            resume_startup_with(&world, &app, Some(saved), false);
            let (main, mic) = match lane {
                Lane::Main => ("manual", "saved mic"),
                Lane::Mic => ("saved main", "manual"),
            };
            assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, device(main));
            assert_eq!(app.audio.mic.lock().unwrap().as_ref().unwrap().source, device(mic));
        }
    }
    #[test]
    fn early_explicit_off_is_not_undone_by_startup() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = app();
        let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
        let saved = Saved { source: device("saved main"), left: 1, right: 1 };
        prepare_startup(&app, crate::audio::Preferences { main_off: false, mic: Some(Saved { source: device("saved mic"), left: 1, right: 1 }) }, Some(saved.clone()));
        choose_lane_transaction(&world, &app, Lane::Main, None, None, None, |_, _| {}).unwrap();
        choose_lane_transaction(&world, &app, Lane::Mic, None, None, None, |_, _| {}).unwrap();
        resume_startup_with(&world, &app, Some(saved), false);
        assert!(app.listening.lock().unwrap().is_none());
        assert!(app.audio.mic.lock().unwrap().is_none());
        assert!(app.audio.preferences.lock().unwrap().main_off);
    }
    #[test]
    fn timed_out_microphone_transaction_preserves_main_drops_late_stream_and_can_retry() {
        struct Blocked {
            connector: connect::Connector,
            release: std::sync::Arc<Mutex<Option<std::sync::mpsc::Receiver<()>>>>,
            dropped: std::sync::mpsc::Sender<()>,
        }
        impl World for Blocked {
            fn open(&self, source: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
                let source = source.unwrap().clone();
                let release = self.release.clone();
                let dropped = self.dropped.clone();
                self.connector.run(std::time::Duration::from_millis(20), move |attempt| {
                    attempt.stage("building the Core Audio input stream")?;
                    if let Some(wait) = release.lock().unwrap().take() {
                        wait.recv().unwrap();
                    }
                    Ok(Listening { stream: Stream::FakeTracked(DropNotice(dropped)), source, name: "fixture".into(), rate: 48000.0, channels: 1, left: 0, right: 0 })
                })
            }
            fn gone(&self, _: &SourceId) -> bool {
                false
            }
            fn processes(&self) -> Vec<Process> {
                vec![]
            }
            fn taps_allowed(&self) -> bool {
                false
            }
        }
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = app();
        let ready = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
        choose_lane_transaction(&ready, &app, Lane::Main, Some(device("main")), None, None, |_, _| {}).unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        let (dropped, was_dropped) = std::sync::mpsc::channel();
        let world = Blocked { connector: Default::default(), release: std::sync::Arc::new(Mutex::new(Some(wait))), dropped };
        let error = choose_lane_transaction(&world, &app, Lane::Mic, Some(device("mic")), None, None, |_, _| panic!("failed open must not save")).err().unwrap();
        assert!(error.contains("timed out"));
        assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, device("main"));
        assert!(app.audio.mic.lock().unwrap().is_none());
        assert!(app.audio.preferences.lock().unwrap().mic.is_none());
        assert!(choose_lane_transaction(&world, &app, Lane::Mic, Some(device("mic")), None, None, |_, _| {}).is_err());
        release.send(()).unwrap();
        was_dropped.recv_timeout(std::time::Duration::from_secs(1)).expect("retired stream closes on worker");
        assert!(app.audio.mic.lock().unwrap().is_none());
        let stopped = std::time::Instant::now();
        while world.connector.pending() {
            assert!(stopped.elapsed() < std::time::Duration::from_secs(1));
            std::thread::yield_now();
        }
        let status = choose_lane_transaction(&world, &app, Lane::Mic, Some(device("mic")), None, None, |prefs, _| assert!(prefs.mic.is_some())).unwrap();
        assert!(status.main.enabled && status.mic.enabled);
        assert_eq!(status.main.source, Some(device("main")));
    }
    #[test]
    fn microphone_command_completes_its_full_transaction() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let app = std::sync::Arc::new(app());
        let worker = app.clone();
        let (done, completed) = std::sync::mpsc::channel();
        let task = std::thread::spawn(move || {
            let world = Fake { gone: Mutex::new(vec![]), fail: Mutex::new(false) };
            let reply = choose_lane_transaction(&world, &worker, Lane::Mic, Some(device("mic")), None, None, |preferences, _| assert!(preferences.mic.is_some()));
            done.send(reply.map(|status| status.mic.enabled)).unwrap();
        });
        assert_eq!(completed.recv_timeout(std::time::Duration::from_secs(2)).expect("command must return after opening"), Ok(true));
        task.join().unwrap();
    }
    #[test]
    fn device_identity_ignores_changed_labels_but_distinguishes_identical_names() {
        assert_eq!(device("a"), SourceId::Device { name: "new name".into(), size: 1, uid: Some("a".into()) });
        assert_ne!(device("a"), SourceId::Device { name: "a".into(), size: 1, uid: Some("b".into()) });
    }
    #[test]
    fn offers_daws_first_then_apps_playing_and_never_itself() {
        let processes = [
            process(1, "com.spotify.client", true),
            process(2, "com.apple.finder", false),
            process(3, "com.google.Chrome.helper.Renderer", true),
            process(4, "com.google.Chrome", false),
            process(5, "com.ableton.live", false),
            process(6, "", true),
            process(7, "fm.openflow.visuals", true),
        ];
        let apps = apps(&processes, 7);
        let found: Vec<(&str, i32, bool)> = apps.iter().map(|a| (a.bundle.as_str(), a.pid, a.daw)).collect();
        // Chrome is named by its own process, not its helper's.
        assert_eq!(found, vec![("com.ableton.live", 5, true), ("com.spotify.client", 1, false), ("com.google.Chrome", 4, false)]);
    }

    #[test]
    fn names_an_app_by_the_same_process_when_offered_and_when_opened() {
        let processes = [process(3, "com.google.Chrome.helper.Renderer", true), process(4, "com.google.Chrome", false), process(8, "com.vendor.only.helper", true)];
        assert_eq!(apps(&processes, 0)[0].pid, pid_of(&processes, "com.google.Chrome", 0).unwrap());
        assert_eq!(pid_of(&processes, "com.google.Chrome", 0), Some(4));
        // An app heard only through a helper is named by it.
        assert_eq!(pid_of(&processes, "com.vendor.only", 0), Some(8));
        assert_eq!(apps(&processes, 0)[1].pid, 8);
    }

    #[test]
    fn taps_an_app_again_only_when_it_restarts_or_a_missed_process_plays() {
        let chrome = "com.google.Chrome";
        let tapped = [104, 103];
        let now = [process(4, chrome, false), process(3, "com.google.Chrome.helper.Renderer", true)];
        assert!(!retap(&now, chrome, 0, &tapped, Some(4)));
        // A helper that comes and goes silently doesn't count, nor one that left.
        assert!(!retap(&[process(4, chrome, false), process(9, "com.google.Chrome.helper", false)], chrome, 0, &tapped, Some(4)));
        // A new helper playing does.
        assert!(retap(&[process(4, chrome, false), process(9, "com.google.Chrome.helper", true)], chrome, 0, &tapped, Some(4)));
        // So does the app itself restarting.
        assert!(retap(&[process(5, chrome, false), process(3, "com.google.Chrome.helper.Renderer", true)], chrome, 0, &tapped, Some(4)));
    }

    /// Opens anything after a pause, as the permission prompt makes a tap
    /// wait; says when an open begins.
    struct Slow(std::sync::Mutex<std::sync::mpsc::Sender<()>>);

    impl World for Slow {
        fn open(&self, source: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
            let _ = self.0.lock().unwrap().send(());
            std::thread::sleep(std::time::Duration::from_millis(200));
            let source = source.cloned().unwrap_or(SourceId::Device { name: "system input".into(), size: 2, uid: None });
            Ok(Listening { stream: Stream::Fake, name: format!("{source:?}"), source, rate: 48000.0, channels: 2, left: 0, right: 1 })
        }
        fn gone(&self, _: &SourceId) -> bool {
            false
        }
        fn processes(&self) -> Vec<Process> {
            vec![]
        }
        fn taps_allowed(&self) -> bool {
            true
        }
    }

    /// `WANTED` is one for the process: tests that set it take turns.
    static WANTS: Mutex<()> = Mutex::new(());

    fn app() -> App {
        App { bench: Mutex::new(None), ring: ring(), listening: Mutex::new(None), audio: Default::default(), library: Default::default(), seed: Default::default() }
    }

    #[test]
    fn blocked_fixture_cannot_open_audio_on_resume_poll_or_explicit_choice() {
        struct Blocked;
        impl World for Blocked {
            fn acquisition_allowed(&self) -> bool {
                false
            }
            fn open(&self, _: Option<&SourceId>, _: (usize, usize), _: Sink) -> Result<Listening, String> {
                panic!("fixture tried to open audio")
            }
            fn gone(&self, _: &SourceId) -> bool {
                panic!("fixture inspected a physical source")
            }
            fn processes(&self) -> Vec<Process> {
                panic!("fixture inspected physical processes")
            }
            fn taps_allowed(&self) -> bool {
                panic!("fixture inspected tap permission")
            }
        }
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        *WANTED.lock().unwrap() = None;
        let app = app();
        let world = Blocked;
        resume_with(&world, &app, None, false);
        for _ in 0..10 {
            follow(&world, &app, || false);
        }
        for source in [None, Some(SourceId::Device { name: "fixture mic".into(), size: 2, uid: None }), Some(SourceId::System), Some(SourceId::App { bundle: "fixture.app".into() })] {
            assert!(choose(&world, &app, source.clone(), None, None).is_err());
            if let Some(source) = source {
                resume_with(&world, &app, Some(Saved { source, left: 1, right: 2 }), false);
            }
        }
        assert!(choose_lane_with(&world, &app, Lane::Mic, Some(device("blocked")), None, None).is_err());
        follow_mic(&world, &app);
        assert!(app.audio.mic.lock().unwrap().is_none());
        assert!(app.listening.lock().unwrap().is_none());
        assert!(WANTED.lock().unwrap().is_none());
        assert_eq!(peaks(&app.ring), (0.0, 0.0));
    }

    #[test]
    fn opens_nothing_until_a_source_is_chosen_then_what_was_chosen() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let (said, opened) = std::sync::mpsc::channel();
        let world = Slow(std::sync::Mutex::new(said));
        let app = app();
        // A first run: nothing saved, so no input opens (and macOS asks nothing).
        resume_with(&world, &app, None, true);
        assert!(opened.try_recv().is_err());
        assert!(app.listening.lock().unwrap().is_none());
        assert!(WANTED.lock().unwrap().is_none());
        // Following finds nothing to follow, and opens nothing either.
        follow(&world, &app, || true);
        assert!(opened.try_recv().is_err());
        // Once chosen, the next launch comes back to it.
        let mic = SourceId::Device { name: "MacBook Pro Microphone".into(), size: 1, uid: None };
        resume_with(&world, &app, Some(Saved { source: mic.clone(), left: 1, right: 1 }), false);
        assert!(opened.try_recv().is_ok());
        assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, mic);
    }

    #[test]
    fn an_upgrade_with_nothing_chosen_listens_to_the_system_input() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let (said, opened) = std::sync::mpsc::channel();
        let world = Slow(std::sync::Mutex::new(said));
        let app = app();
        // The first run is done (an older install), but no audio.json was written.
        resume_with(&world, &app, None, false);
        assert!(opened.try_recv().is_ok());
        assert!(app.listening.lock().unwrap().is_some());
        assert!(WANTED.lock().unwrap().is_none());
    }

    #[test]
    fn skipping_the_welcome_without_a_source_opens_the_system_input() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let (said, opened) = std::sync::mpsc::channel();
        let world = Slow(std::sync::Mutex::new(said));
        let app = app();
        resume_with(&world, &app, None, true);
        assert!(opened.try_recv().is_err());
        // The welcome is skipped: the next poll opens the system input.
        follow(&world, &app, || false);
        assert!(opened.try_recv().is_ok());
        assert!(app.listening.lock().unwrap().is_some());
        // And a launch after it does too.
        let later = self::app();
        resume_with(&world, &later, None, false);
        assert!(opened.try_recv().is_ok());
    }

    #[test]
    fn following_never_undoes_a_choice_being_made() {
        let _turn = WANTS.lock().unwrap_or_else(|e| e.into_inner());
        let (said, opening) = std::sync::mpsc::channel();
        let world = Slow(std::sync::Mutex::new(said));
        let daw = SourceId::App { bundle: "com.ableton.live".into() };
        let mic = SourceId::Device { name: "MacBook Pro Microphone".into(), size: 1, uid: None };
        let app = app();
        *app.listening.lock().unwrap() = Some(world.open(Some(&daw), (0, 1), Sink::ring(app.ring.clone())).unwrap());
        opening.recv().unwrap();
        *WANTED.lock().unwrap() = Some(Saved { source: daw, left: 1, right: 2 });
        std::thread::scope(|s| {
            let choosing = s.spawn(|| choose(&world, &app, Some(mic.clone()), Some(1), Some(2)));
            // The user's pick is opening (the prompt is up) when the poll comes.
            opening.recv().unwrap();
            follow(&world, &app, || true);
            choosing.join().unwrap().unwrap();
        });
        assert_eq!(app.listening.lock().unwrap().as_ref().unwrap().source, mic);
        assert_eq!(WANTED.lock().unwrap().as_ref().unwrap().source, mic);
    }

    #[test]
    fn a_gone_app_falls_back_to_the_whole_mac_and_anything_else_to_the_system_input() {
        let daw = SourceId::App { bundle: "com.ableton.live".into() };
        assert_eq!(fallback(&daw, true), Some(SourceId::System));
        assert_eq!(fallback(&daw, false), None);
        assert_eq!(fallback(&SourceId::Device { name: "Scarlett".into(), size: 2, uid: None }, true), None);
    }

    #[test]
    fn reads_the_choice_as_saved_now_and_as_saved_before() {
        let now: SavedFile = serde_json::from_str(r#"{"source":{"kind":"app","bundle":"com.ableton.live"},"left":1,"right":2}"#).unwrap();
        assert_eq!(Saved::from(now), Saved { source: SourceId::App { bundle: "com.ableton.live".into() }, left: 1, right: 2 });
        let before: SavedFile = serde_json::from_str(r#"{"name":"Scarlett 18i20","left":3,"right":4,"size":18}"#).unwrap();
        assert_eq!(Saved::from(before), Saved { source: SourceId::Device { name: "Scarlett 18i20".into(), size: 18, uid: None }, left: 3, right: 4 });
    }

    #[test]
    fn names_a_daw_by_the_table_and_an_unknown_app_by_its_bundle() {
        assert_eq!(app_name("com.ableton.live", None), "Ableton Live");
        assert_eq!(app_name("com.example.nothing", None), "com.example.nothing");
    }
}

fn lane_status(lane: Lane, l: Option<&Listening>, selected: Option<SourceId>, enabled: bool) -> LaneStatus {
    let unavailable = enabled && (l.is_none() || selected.as_ref().is_some_and(|s| l.is_some_and(|l| &l.source != s)));
    LaneStatus {
        source: l.map(|l| l.source.clone()),
        choice: l.map(Listening::choice),
        channels: l.map_or(0, |l| l.channels),
        unavailable,
        // Only while the choice isn't heard: a failed switch keeps the working source, and says so itself.
        problem: if unavailable { trouble(lane) } else { None },
        selected,
        enabled,
        denied: l.is_some_and(Listening::is_tap) && tap::permission() == Permission::Denied,
    }
}
fn snapshot(app: &App) -> Status {
    let prefs = app.audio.preferences.lock().unwrap().clone();
    let main = app.listening.lock().unwrap();
    let mic = app.audio.mic.lock().unwrap();
    let selected = WANTED.lock().unwrap().as_ref().map(|s| s.source.clone()).or_else(|| main.as_ref().map(|l| l.source.clone()));
    Status {
        main: lane_status(Lane::Main, main.as_ref(), if prefs.main_off { None } else { selected }, !prefs.main_off),
        mic: lane_status(Lane::Mic, mic.as_ref(), prefs.mic.as_ref().map(|s| s.source.clone()), prefs.mic.is_some()),
    }
}
pub fn status(app: &App) -> Status {
    let _operation = app.audio.operation.lock().unwrap();
    follow(&Mac, app, crate::settings::first_run);
    follow_mic(&Mac, app);
    snapshot(app)
}
fn mic_on(world: &dyn World, app: &App, saved: &Saved) -> Result<Listening, String> {
    if !world.acquisition_allowed() {
        return Err("Audio acquisition is disabled for the headless Camera UI fixture".into());
    }
    if !matches!(saved.source, SourceId::Device { .. }) {
        return Err("The microphone lane needs an input device".into());
    }
    if app.listening.lock().unwrap().as_ref().is_some_and(|l| l.source == saved.source) {
        return Err("This input is already selected as the main source".into());
    }
    let (port, sink) = app.audio.prepare();
    let l = open_named(world, Lane::Mic, Some(&saved.source), (saved.left.max(1) - 1, saved.right.max(1) - 1), sink)?;
    if app.listening.lock().unwrap().as_ref().is_some_and(|main| main.source == l.source) {
        return Err("This input is already selected as the main source".into());
    }
    app.audio.commit(Lane::Mic, port, l.rate, app.ring.clone());
    app.send(bench::Cmd::SampleRate(crate::audio::RATE));
    Ok(l)
}
fn follow_mic(world: &dyn World, app: &App) {
    if app.audio.startup.load(Ordering::Acquire) & START_MIC != 0 {
        return;
    }
    if !world.acquisition_allowed() || app.audio.suspended.load(Ordering::Relaxed) {
        return;
    }
    let wanted = app.audio.preferences.lock().unwrap().mic.clone();
    let Some(wanted) = wanted else { return };
    let mut slot = app.audio.mic.lock().unwrap();
    if slot.as_ref().is_some_and(|l| world.gone(&l.source)) {
        *slot = None;
        app.audio.clear(Lane::Mic, &app.ring);
        set_trouble(Lane::Mic, Some(format!("{} is disconnected", source_name(Some(&wanted.source)))));
    }
    if slot.is_none() && !world.gone(&wanted.source) {
        if let Ok(l) = mic_on(world, app, &wanted) {
            *slot = Some(l);
        }
    }
}
fn choose_lane_with(world: &dyn World, app: &App, lane: Lane, source: Option<SourceId>, left: Option<usize>, right: Option<usize>) -> Result<(), String> {
    if app.audio.suspended.load(Ordering::Relaxed) {
        return Err("Stop the test sound before changing audio inputs".into());
    }
    match lane {
        Lane::Main => {
            if let Some(source) = source {
                choose(world, app, Some(source), left, right)?;
                app.audio.preferences.lock().unwrap().main_off = false;
            } else {
                *app.listening.lock().unwrap() = None;
                app.audio.preferences.lock().unwrap().main_off = true;
                app.audio.clear(Lane::Main, &app.ring);
                set_trouble(Lane::Main, None);
            }
        }
        Lane::Mic => {
            if let Some(source) = source {
                let mut saved = Saved { source, left: left.unwrap_or(1), right: right.unwrap_or(2) };
                let l = mic_on(world, app, &saved)?;
                saved.left = l.left + 1;
                saved.right = l.right + 1;
                saved.source = l.source.clone();
                *app.audio.mic.lock().unwrap() = Some(l);
                app.audio.preferences.lock().unwrap().mic = Some(saved);
            } else {
                *app.audio.mic.lock().unwrap() = None;
                app.audio.preferences.lock().unwrap().mic = None;
                app.audio.clear(Lane::Mic, &app.ring);
                set_trouble(Lane::Mic, None);
            }
        }
    }
    Ok(())
}
pub fn choose_lane(app: &App, lane: Lane, source: Option<SourceId>, left: Option<usize>, right: Option<usize>) -> Result<Status, String> {
    choose_lane_transaction(&Mac, app, lane, source, left, right, |preferences, wanted| {
        crate::settings::save_json("audio-lanes.json", preferences);
        if let Some(saved) = wanted {
            crate::settings::save_json(SAVED, saved);
        }
    })
}
fn choose_lane_transaction(
    world: &dyn World,
    app: &App,
    lane: Lane,
    source: Option<SourceId>,
    left: Option<usize>,
    right: Option<usize>,
    persist: impl FnOnce(&crate::audio::Preferences, Option<&Saved>),
) -> Result<Status, String> {
    let _operation = app.audio.operation.lock().unwrap();
    choose_lane_with(world, app, lane, source, left, right)?;
    chosen_since_startup(app, lane);
    let preferences = app.audio.preferences.lock().unwrap().clone();
    let wanted = WANTED.lock().unwrap().clone();
    persist(&preferences, wanted.as_ref());
    Ok(snapshot(app))
}

impl PartialEq for SourceId {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::System, Self::System) => true,
            (Self::App { bundle: a }, Self::App { bundle: b }) => a == b,
            (Self::Device { name: a, size: sa, uid: ua }, Self::Device { name: b, size: sb, uid: ub }) => match (ua, ub) {
                (Some(a), Some(b)) => a == b,
                _ => a == b && sa == sb,
            },
            _ => false,
        }
    }
}
