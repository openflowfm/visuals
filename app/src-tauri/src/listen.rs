//! Audio in: an app's sound or the whole Mac's through a process tap
//! ([`crate::tap`]), or any Core Audio input and two of its channels, written
//! into the engine's ring ([`engine::live`]) for the render thread to read once
//! a frame. The page's audio commands, and the choice kept for next time.

use crate::tap::{self, Permission, Process, Target};
use crate::{bench, App};
use cpal::traits::{DeviceTrait, HostTrait};
use engine::live::peaks;
pub use engine::live::{ring, Ring};
use std::sync::Mutex;
use tauri::State;

fn name_of(d: &cpal::Device) -> String {
    d.description().map(|d| d.name().to_owned()).unwrap_or_default()
}

#[derive(serde::Serialize)]
pub struct Input {
    pub name: String,
    pub channels: u16,
}

#[tauri::command]
pub fn inputs() -> Vec<Input> {
    let host = cpal::default_host();
    host.input_devices().into_iter().flatten().map(|d| Input { name: name_of(&d), channels: d.default_input_config().map(|c| c.channels()).unwrap_or(0) }).collect()
}

/// Something to listen to: an app's sound or the whole system's, through a
/// process tap ([`crate::tap`]), or an input device as [`inputs`] lists it.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SourceId {
    /// The app with this bundle identifier.
    App { bundle: String },
    /// Everything the Mac plays.
    System,
    /// An input device, `size` its channel count to tell same-named ones apart.
    Device { name: String, size: usize },
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
    sources.extend(inputs().into_iter().map(|i| Source { id: SourceId::Device { name: i.name.clone(), size: i.channels as usize }, name: i.name, channels: i.channels }));
    AudioSources { taps, sources }
}

/// How sound arrives: an input device's stream, or a tap, the processes it
/// hears and the app process it is named by.
enum Stream {
    Input(#[allow(dead_code)] cpal::Stream),
    Tap(#[allow(dead_code)] tap::Tap, Vec<u32>, Option<i32>),
    #[cfg(test)]
    Fake,
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
struct Saved {
    source: SourceId,
    left: usize,
    right: usize,
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
            SavedFile::Before(c) => Saved { source: SourceId::Device { name: c.name, size: c.size }, left: c.left, right: c.right },
        }
    }
}

/// What was chosen last, to go back to when it comes back after going away
/// (an app that quit, an interface unplugged).
static WANTED: Mutex<Option<Saved>> = Mutex::new(None);

/// Listen to `source`, or else to the input `name` (the system input when
/// absent), channels `left` and `right` counted from 1. Returns the source's name.
/// Runs off the main thread: opening the first tap can wait on macOS's
/// permission prompt, which must not freeze the window.
#[tauri::command(async)]
pub fn listen_to(name: Option<String>, size: Option<usize>, left: Option<usize>, right: Option<usize>, source: Option<SourceId>, app: State<App>) -> Result<String, String> {
    let source = source.or_else(|| name.map(|name| SourceId::Device { name, size: size.unwrap_or(0) }));
    let (name, saved) = choose(&Mac, &app, source, left, right)?;
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
    /// Open `source` (the system input when `None`) on channels `left` and
    /// `right` (from 0), writing into `ring`.
    fn open(&self, source: Option<&SourceId>, channels: (usize, usize), ring: Ring) -> Result<Listening, String>;
    /// Whether `source` can't be heard any more: its app quit, or its input is unplugged.
    fn gone(&self, source: &SourceId) -> bool;
    fn processes(&self) -> Vec<Process>;
    fn taps_allowed(&self) -> bool;
}

struct Mac;

impl World for Mac {
    fn open(&self, source: Option<&SourceId>, channels: (usize, usize), ring: Ring) -> Result<Listening, String> {
        match source {
            None => listen(None, None, channels, ring),
            Some(SourceId::Device { name, size }) => listen(Some(name), Some(*size), channels, ring),
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
        }
    }

    fn gone(&self, source: &SourceId) -> bool {
        match source {
            SourceId::App { bundle } => objects_of(bundle).is_empty(),
            SourceId::System => false,
            SourceId::Device { name, size } => !inputs().iter().any(|i| i.name == *name && i.channels as usize == *size),
        }
    }

    fn processes(&self) -> Vec<Process> {
        tap::processes()
    }

    fn taps_allowed(&self) -> bool {
        tap::supported() && tap::permission() != Permission::Denied
    }
}

fn tapped(source: SourceId, target: Target, name: String, objects: Vec<u32>, main: Option<i32>, channels: (usize, usize), ring: Ring) -> Result<Listening, String> {
    if !tap::supported() {
        return Err("listening to apps needs macOS 14.4 or later".into());
    }
    if tap::permission() == Permission::Denied {
        return Err(NOT_ALLOWED.into());
    }
    let t = tap::open(&target, channels, ring)?;
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
    let channels = (left.unwrap_or(1).max(1) - 1, right.unwrap_or(2).max(1) - 1);
    let l = world.open(source, channels, app.ring.clone())?;
    app.send(bench::Cmd::SampleRate(l.rate));
    let choice = l.choice();
    let heard = l.source.clone();
    eprintln!("listening to {} on channels {} and {} of {}, at {} Hz", choice.name, choice.left, choice.right, l.channels, l.rate);
    *slot = Some(l);
    Ok((choice, heard))
}

/// What to listen to when `gone` goes away: the whole Mac for an app (when this
/// Mac can tap it), the system input otherwise.
fn fallback(gone: &SourceId, taps: bool) -> Option<SourceId> {
    match gone {
        SourceId::App { .. } if taps => Some(SourceId::System),
        _ => None,
    }
}

/// Listen to what stands in for `gone`, keeping its channels; the system input
/// when that fails too.
fn fall_back(world: &dyn World, app: &App, slot: &mut Option<Listening>, gone: &SourceId, left: usize, right: usize) -> Result<Choice, String> {
    let instead = fallback(gone, world.taps_allowed());
    eprintln!("{gone:?} is gone; listening to {} instead", instead.as_ref().map_or("the system input", |_| EVERYTHING));
    if let Some(Ok((c, _))) = instead.map(|s| listen_on(world, app, slot, Some(&s), Some(left), Some(right))) {
        return Ok(c);
    }
    listen_on(world, app, slot, None, None, None).map(|(c, _)| c)
}

/// Come back listening to what was chosen last, or what stands in for it when
/// it is gone; the system input when nothing was chosen.
pub fn resume(app: &App) {
    let saved: Option<Saved> = crate::settings::load::<SavedFile>(SAVED).map(Saved::from);
    let mut slot = app.listening.lock().unwrap();
    *WANTED.lock().unwrap() = saved.clone();
    let heard = match &saved {
        Some(s) => listen_on(&Mac, app, &mut slot, Some(&s.source), Some(s.left), Some(s.right)).map(|(c, _)| c).or_else(|_| fall_back(&Mac, app, &mut slot, &s.source, s.left, s.right)),
        None => listen_on(&Mac, app, &mut slot, None, None, None).map(|(c, _)| c),
    };
    if let Err(e) = heard {
        eprintln!("no audio input: {e}");
    }
}

/// Keep listening to what was chosen: fall back when it goes away, and go back
/// to it when it returns (or, for an app, restarts or starts playing from a
/// process the tap misses). Run each time the page asks what is heard, every
/// few seconds. The choice is read under the listening lock, so a choice being
/// made ([`choose`]) is never undone by one made before it.
fn follow(world: &dyn World, app: &App) {
    let mut slot = app.listening.lock().unwrap();
    let wanted = WANTED.lock().unwrap().clone();
    let Some((source, tapped, main, left, right)) = slot.as_ref().map(|l| (l.source.clone(), l.tapped().0.to_vec(), l.tapped().1, l.left + 1, l.right + 1)) else { return };
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
    follow(&Mac, &app);
    let l = app.listening.lock().unwrap();
    let denied = l.as_ref().is_some_and(|l| l.is_tap()) && tap::permission() == Permission::Denied;
    Heard { choice: l.as_ref().map(|l| l.choice()), channels: l.as_ref().map_or(0, |l| l.channels), denied }
}

/// The loudest sample in the left and right channels' latest windows, for a meter.
#[tauri::command]
pub fn levels(app: State<App>) -> (f32, f32) {
    peaks(&app.ring)
}

/// Open `input` (the system input when `None`) and write channels `left` and
/// `right` (from 0) into `ring`.
/// `size`, when given, picks between inputs that share a name — macOS calls
/// every aggregate device "Aggregate Device" — by their channel count.
pub fn listen(input: Option<&str>, size: Option<usize>, channels: (usize, usize), ring: Ring) -> Result<Listening, String> {
    let host = cpal::default_host();
    let device = match input {
        Some(want) => {
            let named: Vec<cpal::Device> = host.input_devices().map_err(|e| e.to_string())?.filter(|d| name_of(d) == want).collect();
            let channels_of = |d: &cpal::Device| d.default_input_config().map(|c| c.channels() as usize).unwrap_or(0);
            let at = named.iter().position(|d| Some(channels_of(d)) == size).unwrap_or(0);
            named.into_iter().nth(at).ok_or_else(|| format!("no input called {want}"))?
        }
        None => host.default_input_device().ok_or("no system input")?,
    };
    let open = engine::live::open_input(&device, channels, ring)?;
    let name = name_of(&device);
    Ok(Listening {
        stream: Stream::Input(open.stream),
        source: SourceId::Device { name: name.clone(), size: open.channels },
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
        fn open(&self, source: Option<&SourceId>, _: (usize, usize), _: Ring) -> Result<Listening, String> {
            let _ = self.0.lock().unwrap().send(());
            std::thread::sleep(std::time::Duration::from_millis(200));
            let source = source.cloned().unwrap_or(SourceId::Device { name: "system input".into(), size: 2 });
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

    #[test]
    fn following_never_undoes_a_choice_being_made() {
        let (said, opening) = std::sync::mpsc::channel();
        let world = Slow(std::sync::Mutex::new(said));
        let daw = SourceId::App { bundle: "com.ableton.live".into() };
        let mic = SourceId::Device { name: "MacBook Pro Microphone".into(), size: 1 };
        let app = App { bench: Mutex::new(None), ring: ring(), listening: Mutex::new(None), library: Default::default(), seed: Default::default() };
        *app.listening.lock().unwrap() = Some(world.open(Some(&daw), (0, 1), app.ring.clone()).unwrap());
        opening.recv().unwrap();
        *WANTED.lock().unwrap() = Some(Saved { source: daw, left: 1, right: 2 });
        std::thread::scope(|s| {
            let choosing = s.spawn(|| choose(&world, &app, Some(mic.clone()), Some(1), Some(2)));
            // The user's pick is opening (the prompt is up) when the poll comes.
            opening.recv().unwrap();
            follow(&world, &app);
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
        assert_eq!(fallback(&SourceId::Device { name: "Scarlett".into(), size: 2 }, true), None);
    }

    #[test]
    fn reads_the_choice_as_saved_now_and_as_saved_before() {
        let now: SavedFile = serde_json::from_str(r#"{"source":{"kind":"app","bundle":"com.ableton.live"},"left":1,"right":2}"#).unwrap();
        assert_eq!(Saved::from(now), Saved { source: SourceId::App { bundle: "com.ableton.live".into() }, left: 1, right: 2 });
        let before: SavedFile = serde_json::from_str(r#"{"name":"Scarlett 18i20","left":3,"right":4,"size":18}"#).unwrap();
        assert_eq!(Saved::from(before), Saved { source: SourceId::Device { name: "Scarlett 18i20".into(), size: 18 }, left: 3, right: 4 });
    }

    #[test]
    fn names_a_daw_by_the_table_and_an_unknown_app_by_its_bundle() {
        assert_eq!(app_name("com.ableton.live", None), "Ableton Live");
        assert_eq!(app_name("com.example.nothing", None), "com.example.nothing");
    }
}
