//! Live control: every way of changing what the bench plays — the page's buttons and
//! keys, the auto-advance timer, and (next) MIDI notes and CCs — is an [`Action`]
//! given to [`dispatch`]. A controller mapping only has to turn its messages into
//! actions.
//!
//! [`decide`] is the pure part (which preset an action means, given the playlists
//! and what is playing); [`dispatch`] then opens that preset on the bench and tells
//! the page with a `live` event ([`Now`]), whoever asked.

use crate::fx::{Fx, FxAction};
use crate::link::{Every, Unit};
use crate::playlists::{Store, View};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// One live action. As JSON: `{"kind": "next"}`, `{"kind": "go", "index": 3}`,
/// `{"kind": "load", "playlist": 0}`, `{"kind": "auto", "on": null}`…
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// The next preset: of the active playlist, or of the whole library without one. Wraps.
    Next,
    Previous,
    /// Any other preset of the active playlist (or the library).
    Random,
    /// Item `index` (from 0) of the active playlist.
    Go { index: usize },
    /// Make playlist number `playlist` (from 0, in the file's order) the active one and
    /// play its item `index`, or its first.
    Load { playlist: usize, index: Option<usize> },
    /// No active playlist: the library steps as a whole again.
    Unload,
    /// Auto-advance on, off, or (`null`) the other way round.
    Auto { on: Option<bool> },
    /// How long auto-advance stays on a preset, in seconds (1 to 3600).
    Seconds { seconds: f64 },
    /// Lock the current preset, or let it go (`null` toggles): while held, stepping,
    /// loading a playlist and auto-advance change nothing.
    Hold { on: Option<bool> },
    /// Change preset every this many bars on Link's bar lines, counted from the one
    /// (`crate::link`); 0 stops, more than 64 is 64. Turns the timed auto-advance off.
    Bars { bars: u32 },
    /// A live effect (`crate::fx`): `{"kind": "strobe", "on": true}`, `{"kind": "tap"}`…
    /// The same flat JSON as the others.
    #[serde(untagged)]
    Fx(FxAction),
}

/// What is playing, and how it moves on.
pub struct Live {
    /// The active playlist's id.
    pub playlist: Option<String>,
    /// Where in the active playlist the bench is.
    pub index: Option<usize>,
    pub auto: bool,
    pub seconds: f64,
    pub current: Option<PathBuf>,
    /// When the current preset started, for auto-advance.
    pub since: Instant,
    /// The current preset is locked: nothing moves it on.
    pub hold: bool,
    /// Changes every this many bars on Link's grid (`crate::link` keeps the
    /// schedule; this is what the page shows); 0 when off or when the schedule is
    /// in beats. Set only by [`Live::schedule`].
    pub bars: u32,
}

impl Default for Live {
    fn default() -> Self {
        Live { playlist: None, index: None, auto: false, seconds: 30.0, current: None, since: Instant::now(), hold: false, bars: 0 }
    }
}

impl Live {
    /// How long the timed auto-advance stays on a preset. Changes by bars are
    /// Link's, landing on its bar lines, not a count from the last change.
    pub fn period(&self, _bpm: f64) -> f64 {
        self.seconds
    }

    /// Change on Link's grid on `every`: the one place a schedule is decided, whether
    /// it came from the panel's bars, the Link panel or `VISUALS_LINK_EVERY`. Clamps to
    /// the one limit (64 bars, 256 beats), shows it as `bars` (0 for a beats schedule),
    /// and turns the timed auto-advance off when on, so the two never both change the
    /// preset. Returns the schedule Link is to keep.
    pub fn schedule(&mut self, every: Every) -> Every {
        let every = every.clamped();
        self.bars = if every.unit == Unit::Bars { every.every } else { 0 };
        if every.every > 0 {
            self.auto = false;
        }
        every
    }
}

/// [`Live`] as the page sees it.
#[derive(Serialize, Clone, Debug)]
pub struct DeckView {
    pub playlist: Option<String>,
    pub index: Option<usize>,
    pub auto: bool,
    pub seconds: f64,
    pub current: Option<String>,
    pub hold: bool,
    pub bars: u32,
}

impl Live {
    pub fn view(&self) -> DeckView {
        DeckView {
            playlist: self.playlist.clone(),
            index: self.index,
            auto: self.auto,
            seconds: self.seconds,
            current: self.current.as_ref().map(|p| p.to_string_lossy().into_owned()),
            hold: self.hold,
            bars: self.bars,
        }
    }

    fn play(&mut self, path: PathBuf) -> Option<PathBuf> {
        self.current = Some(path.clone());
        self.since = Instant::now();
        Some(path)
    }

    /// Keep pointing at the same thing after the playlists were edited: a deleted
    /// active playlist is no longer active, and a moved current item is followed.
    pub fn resync(&mut self, store: &Store) {
        let Some(id) = &self.playlist else { return };
        if store.position(id).is_none() {
            self.playlist = None;
            self.index = None;
            return;
        }
        let items = store.paths(id);
        let here = self.index.and_then(|i| items.get(i));
        if here.is_some() && here == self.current.as_ref() {
            return;
        }
        self.index = match self.current.as_ref().and_then(|c| items.iter().position(|p| p == c)) {
            Some(at) => Some(at),
            None if items.is_empty() => None,
            None => self.index.map(|i| i.min(items.len() - 1)),
        };
    }
}

/// `by` steps through `list` from `at`, wrapping; from nowhere, forward starts at the
/// first and back at the last.
fn stepped(len: usize, at: Option<usize>, by: isize) -> usize {
    match at {
        Some(at) => (at as isize + by).rem_euclid(len as isize) as usize,
        None if by < 0 => len - 1,
        None => 0,
    }
}

/// Any index but `at`, when there is another.
fn other(len: usize, at: Option<usize>, roll: u64) -> usize {
    let pick = (roll % len as u64) as usize;
    if Some(pick) == at && len > 1 { (pick + 1) % len } else { pick }
}

/// Apply `action` to `live`: returns the preset to open, if it means one.
/// `library` lists the whole library, asked for only when there is no active playlist.
pub fn decide(live: &mut Live, action: &Action, store: &Store, library: &dyn Fn() -> Vec<PathBuf>, roll: u64) -> Result<Option<PathBuf>, String> {
    let steps = matches!(action, Action::Next | Action::Previous | Action::Random | Action::Go { .. } | Action::Load { .. });
    if live.hold && steps {
        return Err("held: let go of HOLD to change the preset".into());
    }
    match action {
        Action::Next | Action::Previous | Action::Random => {
            let by = if *action == Action::Previous { -1 } else { 1 };
            if let Some(id) = live.playlist.clone() {
                let items = store.paths(&id);
                if items.is_empty() {
                    return Ok(None);
                }
                let at = if *action == Action::Random { other(items.len(), live.index, roll) } else { stepped(items.len(), live.index, by) };
                live.index = Some(at);
                return Ok(live.play(items[at].clone()));
            }
            let all = library();
            if all.is_empty() {
                return Ok(None);
            }
            let here = live.current.as_ref().and_then(|c| all.iter().position(|p| p == c));
            let at = if *action == Action::Random { other(all.len(), here, roll) } else { stepped(all.len(), here, by) };
            Ok(live.play(all[at].clone()))
        }
        Action::Go { index } => {
            let id = live.playlist.clone().ok_or("no playlist is loaded")?;
            let items = store.paths(&id);
            let path = items.get(*index).ok_or_else(|| format!("the playlist has {} items", items.len()))?.clone();
            live.index = Some(*index);
            Ok(live.play(path))
        }
        Action::Load { playlist, index } => {
            let list = store.lists.get(*playlist).ok_or_else(|| format!("there are {} playlists", store.lists.len()))?;
            let items = store.paths(&list.id);
            let index = index.unwrap_or(0);
            if !items.is_empty() && index >= items.len() {
                return Err(format!("{} has {} items", list.name, items.len()));
            }
            live.playlist = Some(list.id.clone());
            if items.is_empty() {
                live.index = None;
                return Ok(None);
            }
            live.index = Some(index);
            Ok(live.play(items[index].clone()))
        }
        Action::Unload => {
            live.playlist = None;
            live.index = None;
            Ok(None)
        }
        Action::Auto { on } => {
            live.auto = on.unwrap_or(!live.auto);
            live.since = Instant::now();
            Ok(None)
        }
        Action::Seconds { seconds } => {
            live.seconds = crate::fx::clamped(*seconds, 1.0, 3600.0, "seconds")?;
            Ok(None)
        }
        Action::Hold { on } => {
            live.hold = on.unwrap_or(!live.hold);
            // Let go, auto-advance gives the preset a whole period again.
            live.since = Instant::now();
            Ok(None)
        }
        // `dispatch` gives these to `Deck::set_schedule`, which tells Link too.
        Action::Bars { bars } => {
            live.schedule(Every { every: *bars, unit: Unit::Bars });
            Ok(None)
        }
        // Not the deck's: `dispatch` gives these to the effects.
        Action::Fx(_) => Ok(None),
    }
}

/// The playlists, the live state and the live effects, managed by Tauri beside
/// `crate::App`. The effects are shared with the bench's render thread.
pub struct Deck {
    pub store: Mutex<Store>,
    pub live: Mutex<Live>,
    pub fx: Arc<Mutex<Fx>>,
}

impl Deck {
    pub fn new(store: Store) -> Deck {
        Deck { store: Mutex::new(store), live: Mutex::new(Live::default()), fx: Arc::new(Mutex::new(Fx::restored())) }
    }

    /// The effects panel's state: the effects, and the deck's hold and bars.
    pub fn fx_view(&self) -> crate::fx::View {
        let (hold, bars) = {
            let live = self.live.lock().unwrap();
            (live.hold, live.bars)
        };
        self.fx.lock().unwrap().view(hold, bars)
    }

    /// The page opened `path` itself (a library click): it is what plays now.
    pub fn opened(&self, path: &Path) {
        let mut live = self.live.lock().unwrap();
        live.current = Some(path.to_path_buf());
        live.since = Instant::now();
    }

    fn lists(&self) -> Lists {
        Lists { playlists: self.store.lock().unwrap().views(), deck: self.live.lock().unwrap().view() }
    }

    /// Change preset on Link's grid on `every` ([`Live::schedule`]), give Link the
    /// schedule, and tell the page. Link is told only after the deck's lock is let go,
    /// so no lock is held while taking Link's.
    pub fn set_schedule(&self, handle: &AppHandle, every: Every) -> Result<(), String> {
        let (every, view) = {
            let mut live = self.live.lock().unwrap();
            let every = live.schedule(every);
            (every, live.view())
        };
        handle.state::<crate::link::Link>().set_every(every);
        emit_deck(handle, self, view)
    }
}

/// Tell the page the deck's settings moved: `fx` (the effects panel shows hold and
/// bars), then `live`.
fn emit_deck(handle: &AppHandle, deck: &Deck, view: DeckView) -> Result<(), String> {
    handle.emit("fx", deck.fx_view()).map_err(|e| e.to_string())?;
    let now = Now { deck: view, opened: None, path: None, error: None };
    handle.emit("live", now).map_err(|e| e.to_string())
}

/// What an action did, sent to the page as the `live` event.
#[derive(Serialize, Clone)]
pub(crate) struct Now {
    deck: DeckView,
    /// The preset now on the bench, when the action changed it.
    opened: Option<crate::editor::Opened>,
    path: Option<String>,
    /// Why the preset at `path` did not open.
    error: Option<String>,
}

fn roll() -> u64 {
    let mut x = std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
    x ^= x << 13;
    x ^= x >> 7;
    x ^ (x << 17)
}

/// Do `action`: move the live state, open what it means on the bench, tell the page.
/// Callable from any thread — the page's `act`, the auto-advance timer, a MIDI input.
pub fn dispatch(handle: &AppHandle, action: Action) -> Result<(), String> {
    let deck = handle.state::<Deck>();
    if let Action::Fx(fx) = &action {
        let tempo = {
            let mut state = deck.fx.lock().unwrap();
            state.apply(fx, Instant::now())?.then_some(state.bpm)
        };
        if let Some(bpm) = tempo {
            crate::fx::save_tempo(bpm);
        }
        return handle.emit("fx", deck.fx_view()).map_err(|e| e.to_string());
    }
    if let Action::Bars { bars } = action {
        return deck.set_schedule(handle, Every { every: bars, unit: Unit::Bars });
    }
    if let Action::Hold { .. } = action {
        let view = {
            let store = deck.store.lock().unwrap();
            let mut live = deck.live.lock().unwrap();
            decide(&mut live, &action, &store, &Vec::<PathBuf>::new, 0)?;
            live.view()
        };
        return emit_deck(handle, &deck, view);
    }
    let app = handle.state::<crate::App>();
    let path = {
        let store = deck.store.lock().unwrap();
        let mut live = deck.live.lock().unwrap();
        let library = || engine::preset::milk_files(&app.library);
        decide(&mut live, &action, &store, &library, roll())?
    };
    let (opened, error) = match &path {
        Some(p) => match crate::editor::open_path(&app, &p.to_string_lossy()) {
            Ok(o) => (Some(o), None),
            Err(e) => (None, Some(e)),
        },
        None => (None, None),
    };
    let now = Now { deck: deck.live.lock().unwrap().view(), opened, path: path.map(|p| p.to_string_lossy().into_owned()), error };
    handle.emit("live", now).map_err(|e| e.to_string())
}

/// Advance on the active playlist (or the library) every `seconds` while auto is on.
pub fn start_auto(handle: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let deck = handle.state::<Deck>();
            let bpm = deck.fx.lock().unwrap().bpm;
            let due = {
                let mut live = deck.live.lock().unwrap();
                let due = live.auto && !live.hold && live.since.elapsed().as_secs_f64() >= live.period(bpm);
                if due {
                    // Even when Next finds nothing to play, wait a whole period again.
                    live.since = Instant::now();
                }
                due
            };
            if due {
                if let Err(e) = dispatch(&handle, Action::Next) {
                    eprintln!("auto-advance: {e}");
                }
            }
        }
    });
}

/// Every playlist and the live state, which every playlist command returns.
#[derive(Serialize)]
pub struct Lists {
    playlists: Vec<View>,
    deck: DeckView,
}

/// Run an edit on the store, save it, and keep the live state pointing right.
fn edit(deck: &Deck, f: impl FnOnce(&mut Store) -> Result<(), String>) -> Result<Lists, String> {
    {
        let mut store = deck.store.lock().unwrap();
        f(&mut store)?;
        store.save()?;
        deck.live.lock().unwrap().resync(&store);
    }
    Ok(deck.lists())
}

/// The page's way in. What the action did arrives as the `live` event, as it does
/// for every other source; an action that makes no sense comes back as an error.
#[tauri::command]
pub async fn act(action: Action, handle: AppHandle) -> Result<(), String> {
    dispatch(&handle, action)
}

/// The live effects as they are now; then the `fx` event follows them.
#[tauri::command]
pub fn fx_state(deck: State<Deck>) -> crate::fx::View {
    deck.fx_view()
}

#[tauri::command]
pub fn playlists(deck: State<Deck>) -> Lists {
    deck.lists()
}

#[tauri::command]
pub fn playlist_create(name: String, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.create(&name).map(|_| ()))
}

#[tauri::command]
pub fn playlist_rename(id: String, name: String, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.rename(&id, &name))
}

#[tauri::command]
pub fn playlist_delete(id: String, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.delete(&id))
}

#[tauri::command]
pub fn playlist_add(id: String, path: String, at: Option<usize>, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.add(&id, Path::new(&path), at))
}

#[tauri::command]
pub fn playlist_remove(id: String, index: usize, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.remove(&id, index))
}

#[tauri::command]
pub fn playlist_move_item(id: String, from: usize, to: usize, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.move_item(&id, from, to))
}

#[tauri::command]
pub fn playlist_move(id: String, to: usize, deck: State<Deck>) -> Result<Lists, String> {
    edit(&deck, |s| s.move_list(&id, to))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("visuals-actions-{}-{}", std::process::id(), roll()));
        let lib = dir.join("lib");
        let mut s = Store::open(dir.join("p.json"), lib.clone());
        let a = s.create("a").unwrap();
        for n in ["x", "y", "z"] {
            s.add(&a, &lib.join(format!("{n}.milk")), None).unwrap();
        }
        s.create("empty").unwrap();
        (s, lib)
    }

    fn none() -> Vec<PathBuf> {
        Vec::new()
    }

    #[test]
    fn steps_through_the_active_playlist() {
        let (s, lib) = store();
        let mut live = Live::default();
        let p = |n: &str| Some(lib.join(format!("{n}.milk")));
        assert_eq!(decide(&mut live, &Action::Load { playlist: 0, index: None }, &s, &none, 0).unwrap(), p("x"));
        assert_eq!(live.playlist.as_deref(), Some(s.lists[0].id.as_str()));
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, 0).unwrap(), p("y"));
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, 0).unwrap(), p("z"));
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, 0).unwrap(), p("x"));
        assert_eq!(decide(&mut live, &Action::Previous, &s, &none, 0).unwrap(), p("z"));
        assert_eq!(decide(&mut live, &Action::Go { index: 1 }, &s, &none, 0).unwrap(), p("y"));
        assert_eq!(live.current, p("y"));
        assert!(decide(&mut live, &Action::Go { index: 3 }, &s, &none, 0).is_err());
        // Random never repeats the current item while there is another.
        for roll in 0..6 {
            let mut l = Live { playlist: live.playlist.clone(), index: Some(1), current: p("y"), ..Live::default() };
            assert_ne!(decide(&mut l, &Action::Random, &s, &none, roll).unwrap(), p("y"));
        }
        assert_eq!(decide(&mut live, &Action::Load { playlist: 0, index: Some(2) }, &s, &none, 0).unwrap(), p("z"));
        assert!(decide(&mut live, &Action::Load { playlist: 0, index: Some(3) }, &s, &none, 0).is_err());
        assert!(decide(&mut live, &Action::Load { playlist: 2, index: None }, &s, &none, 0).is_err());
    }

    #[test]
    fn an_empty_playlist_plays_nothing_and_unload_returns_to_the_library() {
        let (s, lib) = store();
        let mut live = Live::default();
        assert_eq!(decide(&mut live, &Action::Load { playlist: 1, index: None }, &s, &none, 0).unwrap(), None);
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, 0).unwrap(), None);
        assert_eq!(live.index, None);
        decide(&mut live, &Action::Unload, &s, &none, 0).unwrap();
        assert_eq!(live.playlist, None);
        assert!(decide(&mut live, &Action::Go { index: 0 }, &s, &none, 0).is_err());
        let library = || vec![lib.join("a.milk"), lib.join("b.milk")];
        assert_eq!(decide(&mut live, &Action::Next, &s, &library, 0).unwrap(), Some(lib.join("a.milk")));
        assert_eq!(decide(&mut live, &Action::Next, &s, &library, 0).unwrap(), Some(lib.join("b.milk")));
        assert_eq!(decide(&mut live, &Action::Next, &s, &library, 0).unwrap(), Some(lib.join("a.milk")));
        assert_eq!(decide(&mut live, &Action::Previous, &s, &library, 0).unwrap(), Some(lib.join("b.milk")));
    }

    #[test]
    fn auto_and_seconds() {
        let (s, _) = store();
        let mut live = Live::default();
        decide(&mut live, &Action::Auto { on: None }, &s, &none, 0).unwrap();
        assert!(live.auto);
        decide(&mut live, &Action::Auto { on: Some(true) }, &s, &none, 0).unwrap();
        assert!(live.auto);
        decide(&mut live, &Action::Auto { on: None }, &s, &none, 0).unwrap();
        assert!(!live.auto);
        decide(&mut live, &Action::Seconds { seconds: 0.1 }, &s, &none, 0).unwrap();
        assert_eq!(live.seconds, 1.0);
        assert!(decide(&mut live, &Action::Seconds { seconds: f64::NAN }, &s, &none, 0).is_err());
    }

    #[test]
    fn edits_keep_the_live_state_pointing_right() {
        let (mut s, lib) = store();
        let mut live = Live::default();
        decide(&mut live, &Action::Load { playlist: 0, index: Some(2) }, &s, &none, 0).unwrap();
        let id = s.lists[0].id.clone();
        s.move_item(&id, 2, 0).unwrap();
        live.resync(&s);
        assert_eq!(live.index, Some(0));
        s.remove(&id, 0).unwrap();
        live.resync(&s);
        assert_eq!(live.index, Some(0));
        assert_eq!(s.paths(&id)[0], lib.join("x.milk"));
        s.delete(&id).unwrap();
        live.resync(&s);
        assert_eq!((live.playlist.clone(), live.index), (None, None));
    }

    #[test]
    fn actions_read_as_json() {
        let read = |s: &str| serde_json::from_str::<Action>(s).unwrap();
        assert_eq!(read(r#"{"kind":"next"}"#), Action::Next);
        assert_eq!(read(r#"{"kind":"go","index":3}"#), Action::Go { index: 3 });
        assert_eq!(read(r#"{"kind":"load","playlist":1,"index":null}"#), Action::Load { playlist: 1, index: None });
        assert_eq!(read(r#"{"kind":"auto","on":null}"#), Action::Auto { on: None });
        assert_eq!(read(r#"{"kind":"hold","on":true}"#), Action::Hold { on: Some(true) });
        assert_eq!(read(r#"{"kind":"bars","bars":8}"#), Action::Bars { bars: 8 });
        // The effects read as actions too, in the same flat shape.
        assert_eq!(read(r#"{"kind":"strobe","on":true}"#), Action::Fx(FxAction::Strobe { on: Some(true) }));
        assert_eq!(read(r#"{"kind":"tap"}"#), Action::Fx(FxAction::Tap));
        assert_eq!(read(r#"{"kind":"speed","speed":0.5}"#), Action::Fx(FxAction::Speed { speed: 0.5 }));
        assert_eq!(serde_json::to_string(&Action::Fx(FxAction::Tap)).unwrap(), r#"{"kind":"tap"}"#);
        assert!(serde_json::from_str::<Action>(r#"{"kind":"nonsense"}"#).is_err());
    }

    #[test]
    fn hold_ignores_steps_and_bars_set_the_period() {
        let (s, lib) = store();
        let mut live = Live::default();
        decide(&mut live, &Action::Load { playlist: 0, index: None }, &s, &none, 0).unwrap();
        decide(&mut live, &Action::Hold { on: None }, &s, &none, 0).unwrap();
        assert!(live.hold);
        for action in [Action::Next, Action::Previous, Action::Random, Action::Go { index: 2 }, Action::Load { playlist: 0, index: Some(1) }] {
            assert!(decide(&mut live, &action, &s, &none, 0).is_err(), "{action:?} while held");
        }
        assert_eq!(live.current, Some(lib.join("x.milk")));
        // Settings still change while held.
        decide(&mut live, &Action::Seconds { seconds: 10.0 }, &s, &none, 0).unwrap();
        decide(&mut live, &Action::Hold { on: Some(false) }, &s, &none, 0).unwrap();
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, 0).unwrap(), Some(lib.join("y.milk")));
        assert_eq!(live.period(120.0), 10.0);
        decide(&mut live, &Action::Bars { bars: 8 }, &s, &none, 0).unwrap();
        assert_eq!(live.period(120.0), 10.0, "bars are Link's schedule, not the timed period");
        decide(&mut live, &Action::Bars { bars: 1000 }, &s, &none, 0).unwrap();
        assert_eq!(live.bars, 64);
    }

    #[test]
    fn one_schedule_one_limit() {
        let bars = |every| Every { every, unit: Unit::Bars };
        let beats = |every| Every { every, unit: Unit::Beats };
        let mut live = Live::default();
        // Within the limit: kept, shown, and the timed advance stops.
        live.auto = true;
        assert_eq!(live.schedule(bars(8)), bars(8));
        assert_eq!(live.bars, 8);
        assert!(!live.auto);
        // Over it: clamped to 64 bars, or 256 beats (the same length at quantum 4),
        // for Link and the panel alike.
        assert_eq!(live.schedule(bars(1000)), bars(64));
        assert_eq!(live.bars, 64);
        assert_eq!(live.schedule(beats(1000)), beats(256));
        assert_eq!(live.schedule(beats(256)), beats(256));
        // A beats schedule is no whole number of bars: `bars` shows 0.
        assert_eq!(live.schedule(beats(8)), beats(8));
        assert_eq!(live.bars, 0);
        // Off leaves auto-advance as it was.
        live.auto = true;
        assert_eq!(live.schedule(Every::OFF), Every::OFF);
        assert_eq!(live.bars, 0);
        assert!(live.auto);
        live.schedule(beats(0));
        assert!(live.auto, "0 beats is off too");
    }
}
