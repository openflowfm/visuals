//! Live control: every way of changing what the bench plays — the page's buttons and
//! keys, the auto-advance timer, and (next) MIDI notes and CCs — is an [`Action`]
//! given to [`dispatch`]. A controller mapping only has to turn its messages into
//! actions.
//!
//! [`decide`] is the pure part (which preset an action means, given the playlists
//! and what is playing); [`dispatch`] then opens that preset on the bench and tells
//! the page with a `live` event ([`Now`]), whoever asked.
//!
//! A playlist's settings ([`Settings`]: change timing, order, transition, speed,
//! trails, hue) are taken by the deck when it loads. A live tweak of any of them
//! lasts until the next playlist loads, and the deck reports which differ
//! ([`DeckView::differs`]). A smart playlist (or an unsaved filter,
//! [`Action::Query`]) is worked out when it loads and plays as it was then.

use crate::fx::{Fx, FxAction};
use crate::link::{Every, Unit};
use crate::playlists::{Change, Exported, Kind, Order, Settings, Store, View};
use crate::query::LibraryQuery;
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
    Go {
        index: usize,
    },
    /// Make playlist number `playlist` (from 0, in the file's order) the active one,
    /// take its settings, and play its item `index`, or its first in its order.
    Load {
        playlist: usize,
        index: Option<usize>,
    },
    /// Play the presets `query` picks (never a hidden one) as an unsaved smart
    /// playlist, keeping the deck's settings: a mood chip in live.
    ///
    /// With `at`, the page has just opened `at` from the library's grid filtered by
    /// `query`: the deck follows the grid instead, in its order from `at`, opening
    /// nothing; while a playlist is loaded it changes nothing.
    Query {
        query: LibraryQuery,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<PathBuf>,
    },
    /// No active playlist: the library steps as a whole again.
    Unload,
    /// Auto-advance on, off, or (`null`) the other way round.
    Auto {
        on: Option<bool>,
    },
    /// How long auto-advance stays on a preset, in seconds (1 to 3600).
    Seconds {
        seconds: f64,
    },
    /// Lock the current preset, or let it go (`null` toggles): while held, stepping,
    /// loading a playlist and auto-advance change nothing.
    Hold {
        on: Option<bool>,
    },
    /// Change preset every this many bars on Link's bar lines, counted from the one
    /// (`crate::link`); 0 stops, more than 64 is 64. Turns the timed auto-advance off.
    Bars {
        bars: u32,
    },
    /// A live effect (`crate::fx`): `{"kind": "strobe", "on": true}`, `{"kind": "tap"}`…
    /// The same flat JSON as the others.
    #[serde(untagged)]
    Fx(FxAction),
}

/// What is playing, and how it moves on.
pub struct Live {
    /// The active playlist's id.
    pub playlist: Option<String>,
    /// The unsaved filter playing ([`Action::Query`]), when that is what plays.
    pub query: Option<LibraryQuery>,
    /// What the active playlist or filter plays, as it was worked out when it
    /// loaded (a manual playlist's follows its edits).
    pub items: Vec<PathBuf>,
    /// Where in `items` the bench is.
    pub index: Option<usize>,
    pub order: Order,
    /// The play order: indices into `items`, shuffled or not.
    pub sequence: Vec<usize>,
    /// The loaded playlist's settings, which live tweaks are told apart from.
    pub settings: Option<Settings>,
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
        Live {
            playlist: None,
            query: None,
            items: Vec::new(),
            index: None,
            order: Order::InOrder,
            sequence: Vec::new(),
            settings: None,
            auto: false,
            seconds: 30.0,
            current: None,
            since: Instant::now(),
            hold: false,
            bars: 0,
        }
    }
}

/// A playlist setting's name, as [`DeckView::differs`] lists it.
pub type SettingName = &'static str;

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
    pub order: Order,
    /// The loaded playlist's settings.
    pub settings: Option<Settings>,
    /// Which of `settings` the deck has been tweaked away from since it loaded:
    /// `change`, `order`, `transition`, `speed`, `trails`, `hue`.
    pub differs: Vec<SettingName>,
    /// What `next` opens, when a playlist or filter plays.
    pub next: Option<String>,
    /// Where `next` is in the playlist's or filter's items, so a preset listed
    /// twice is told apart.
    pub next_index: Option<usize>,
    /// How many presets the playlist or filter playing has.
    pub count: usize,
    /// The unsaved filter playing.
    pub query: Option<LibraryQuery>,
}

/// The schedule on Link's grid a playlist's change timing means: none for seconds.
pub fn every_of(change: Change) -> Every {
    match change {
        Change::Seconds { .. } => Every::OFF,
        Change::Bars { every } => Every { every, unit: Unit::Bars },
    }
}

/// Set the effects a playlist's settings carry.
pub fn apply_fx(fx: &mut Fx, s: &Settings, now: Instant) {
    for action in [FxAction::Transition { seconds: s.transition }, FxAction::Speed { speed: s.speed }, FxAction::Trails { value: s.trails }, FxAction::Hue { value: s.hue }] {
        let _ = fx.apply(&action, now);
    }
}

/// Set the effects among a playlist's settings that changed from `old` to `new`,
/// leaving the rest (and live tweaks of them) alone.
pub fn apply_fx_changed(fx: &mut Fx, old: &Settings, new: &Settings, now: Instant) {
    let changed = |a: f64, b: f64| (a - b).abs() >= 1e-9;
    let actions = [
        (changed(old.transition, new.transition), FxAction::Transition { seconds: new.transition }),
        (changed(old.speed, new.speed), FxAction::Speed { speed: new.speed }),
        (changed(old.trails, new.trails), FxAction::Trails { value: new.trails }),
        (changed(old.hue, new.hue), FxAction::Hue { value: new.hue }),
    ];
    for (_, action) in actions.iter().filter(|(c, _)| *c) {
        let _ = fx.apply(action, now);
    }
}

/// `0..len` shuffled from `roll`.
fn shuffled(len: usize, mut roll: u64) -> Vec<usize> {
    let mut order: Vec<usize> = (0..len).collect();
    for i in (1..len).rev() {
        roll ^= roll << 13;
        roll ^= roll >> 7;
        roll ^= roll << 17;
        order.swap(i, (roll % (i as u64 + 1)) as usize);
    }
    order
}

impl Live {
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

    /// A playlist or filter is playing (not the library as a whole).
    pub fn active(&self) -> bool {
        self.playlist.is_some() || self.query.is_some()
    }

    /// Work out the play order afresh for `items`.
    fn arrange(&mut self, roll: u64) {
        self.sequence = match self.order {
            Order::InOrder => (0..self.items.len()).collect(),
            Order::Shuffle => shuffled(self.items.len(), roll | 1),
        };
    }

    /// Take a playlist's settings: its order and change timing here (the effects
    /// are [`apply_fx`]'s, Link's schedule [`every_of`]'s).
    pub fn take(&mut self, s: &Settings, roll: u64) {
        self.settings = Some(*s);
        self.order = s.order;
        self.arrange(roll);
        self.take_change(s.change);
    }

    /// Change on `change`: Link's schedule, or auto-advance on every so many seconds from now.
    fn take_change(&mut self, change: Change) {
        self.schedule(every_of(change));
        if let Change::Seconds { every } = change {
            self.auto = true;
            self.seconds = every;
            self.since = Instant::now();
        }
    }

    /// The playing playlist's settings were edited from `old` to `new`: take
    /// only what changed. A new order draws a new play order; new change timing
    /// restarts the timer (and turns auto-advance on for seconds); anything
    /// else, and live tweaks of what didn't change, stay as they are. The
    /// effects are [`apply_fx_changed`]'s.
    pub fn retake(&mut self, old: &Settings, new: &Settings, roll: u64) {
        self.settings = Some(*new);
        if old.order != new.order {
            self.order = new.order;
            self.arrange(roll);
        }
        if old.change != new.change {
            self.take_change(new.change);
        }
    }

    /// The item `by` steps from where the deck is, in the play order; from
    /// nowhere, forward starts at the first and back at the last.
    fn stepped(&self, by: isize) -> Option<usize> {
        let len = self.sequence.len();
        if len == 0 {
            return None;
        }
        let at = self.index.and_then(|i| self.sequence.iter().position(|&s| s == i));
        Some(
            self.sequence[match at {
                Some(at) => (at as isize + by).rem_euclid(len as isize) as usize,
                None if by < 0 => len - 1,
                None => 0,
            }],
        )
    }

    /// What `next` opens, while a playlist or filter plays.
    pub fn next_path(&self) -> Option<&PathBuf> {
        if !self.active() {
            return None;
        }
        self.stepped(1).and_then(|i| self.items.get(i))
    }

    /// Which of the loaded playlist's settings the deck (and the effects, `fx`) differ from.
    pub fn differs(&self, fx: &crate::fx::Settings) -> Vec<SettingName> {
        let Some(s) = &self.settings else { return Vec::new() };
        let same = |a: f64, b: f64| (a - b).abs() < 1e-9;
        let change = match s.change {
            Change::Seconds { every } => self.auto && self.bars == 0 && same(self.seconds, every),
            Change::Bars { every } => self.bars == every,
        };
        [
            ("change", change),
            ("order", self.order == s.order),
            ("transition", same(fx.transition, s.transition)),
            ("speed", same(fx.speed, s.speed)),
            ("trails", same(fx.trails, s.trails)),
            ("hue", same(fx.hue, s.hue)),
        ]
        .into_iter()
        .filter(|(_, same)| !same)
        .map(|(name, _)| name)
        .collect()
    }

    /// The page's view of the deck, with the effects `fx` to tell tweaks by.
    pub fn view(&self, fx: &crate::fx::Settings) -> DeckView {
        DeckView {
            playlist: self.playlist.clone(),
            index: self.index,
            auto: self.auto,
            seconds: self.seconds,
            current: self.current.as_ref().map(|p| p.to_string_lossy().into_owned()),
            hold: self.hold,
            bars: self.bars,
            order: self.order,
            settings: self.settings,
            differs: self.differs(fx),
            next: self.next_path().map(|p| p.to_string_lossy().into_owned()),
            next_index: if self.active() { self.stepped(1).filter(|&i| i < self.items.len()) } else { None },
            count: if self.active() { self.items.len() } else { 0 },
            query: self.query.clone(),
        }
    }

    fn play(&mut self, path: PathBuf) -> Option<PathBuf> {
        self.current = Some(path.clone());
        self.since = Instant::now();
        Some(path)
    }

    /// The page opened `path` itself (the grid, the start preset, a drop, the lab):
    /// it plays now. Following the grid, the deck steps on from it when the grid
    /// has it, and stops following otherwise, so it never steps from a stale place.
    fn opened(&mut self, path: PathBuf) {
        if self.playlist.is_none() && self.query.is_some() {
            match self.items.iter().position(|p| *p == path) {
                Some(at) => self.index = Some(at),
                None => self.unload(),
            }
        }
        self.play(path);
    }

    /// No playlist or filter: the library steps as a whole.
    fn unload(&mut self) {
        self.playlist = None;
        self.query = None;
        self.items.clear();
        self.sequence.clear();
        self.settings = None;
        self.index = None;
    }

    /// Keep pointing at the same thing after the playlists were edited: a deleted
    /// active playlist is no longer active, a manual one's items follow its edits
    /// (a new order is drawn when their number changes), and a moved current item
    /// is followed. A smart playlist plays what it was worked out as on load.
    pub fn resync(&mut self, store: &Store, roll: u64) {
        let Some(id) = &self.playlist else { return };
        let Some(list) = store.find(id) else {
            self.unload();
            return;
        };
        if list.kind == Kind::Manual {
            let items = store.paths(id);
            if items.len() != self.items.len() {
                self.items = items;
                self.arrange(roll);
            } else {
                self.items = items;
            }
        }
        let here = self.index.and_then(|i| self.items.get(i));
        if here.is_some() && here == self.current.as_ref() {
            return;
        }
        self.index = match self.current.as_ref().and_then(|c| self.items.iter().position(|p| p == c)) {
            Some(at) => Some(at),
            None if self.items.is_empty() => None,
            None => self.index.map(|i| i.min(self.items.len() - 1)),
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
/// `library` lists the whole library, asked for only when there is no active playlist;
/// `resolve` works out a smart playlist's or filter's presets (never hidden ones),
/// asked for only when one loads.
pub fn decide(live: &mut Live, action: &Action, store: &Store, library: &dyn Fn() -> Vec<PathBuf>, resolve: &dyn Fn(&LibraryQuery) -> Vec<PathBuf>, roll: u64) -> Result<Option<PathBuf>, String> {
    // Following the grid opens nothing, so hold doesn't refuse it.
    let steps = matches!(action, Action::Next | Action::Previous | Action::Random | Action::Go { .. } | Action::Load { .. } | Action::Query { at: None, .. });
    if live.hold && steps {
        return Err("held: let go of HOLD to change the preset".into());
    }
    match action {
        Action::Next | Action::Previous | Action::Random => {
            let by = if *action == Action::Previous { -1 } else { 1 };
            if live.active() {
                if live.items.is_empty() {
                    return Ok(None);
                }
                let at = if *action == Action::Random { other(live.items.len(), live.index, roll) } else { live.stepped(by).unwrap_or(0) };
                live.index = Some(at);
                return Ok(live.play(live.items[at].clone()));
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
            if !live.active() {
                return Err("no playlist is loaded".into());
            }
            let path = live.items.get(*index).ok_or_else(|| format!("the playlist has {} items", live.items.len()))?.clone();
            live.index = Some(*index);
            Ok(live.play(path))
        }
        Action::Load { playlist, index } => {
            let list = store.lists.get(*playlist).ok_or_else(|| format!("there are {} playlists", store.lists.len()))?;
            let items = match list.kind {
                Kind::Manual => store.paths(&list.id),
                Kind::Smart => resolve(list.query.as_ref().unwrap_or(&LibraryQuery::default())),
            };
            if let Some(i) = index {
                if !items.is_empty() && *i >= items.len() {
                    return Err(format!("{} has {} items", list.name, items.len()));
                }
            }
            live.unload();
            live.playlist = Some(list.id.clone());
            live.items = items;
            live.take(&list.settings.checked().unwrap_or_default(), roll);
            start(live, *index)
        }
        Action::Query { query, at } => {
            if at.is_some() && live.playlist.is_some() {
                return Ok(None);
            }
            let items = resolve(query);
            live.unload();
            live.query = Some(query.clone());
            live.items = items;
            let Some(at) = at else {
                live.arrange(roll);
                return start(live, None);
            };
            // The grid's order, whatever the last playlist's was.
            live.order = Order::InOrder;
            live.arrange(roll);
            live.index = live.items.iter().position(|p| p == at);
            // The page opened it: the deck's current is what the page shows.
            live.current = Some(at.clone());
            Ok(None)
        }
        Action::Unload => {
            live.unload();
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

/// Play item `index` of what just loaded, or the first in its order; nothing when it is empty.
fn start(live: &mut Live, index: Option<usize>) -> Result<Option<PathBuf>, String> {
    let Some(at) = index.or_else(|| live.sequence.first().copied()).filter(|&at| at < live.items.len()) else {
        live.index = None;
        return Ok(None);
    };
    live.index = Some(at);
    Ok(live.play(live.items[at].clone()))
}

/// How many presets "recently played" remembers.
const PLAYED: usize = 200;
/// Where they are kept, in `crate::settings::dir`.
const PLAYED_FILE: &str = "played.json";

/// The playlists, the live state and the live effects, managed by Tauri beside
/// `crate::App`. The effects are shared with the bench's render thread.
pub struct Deck {
    pub store: Mutex<Store>,
    pub live: Mutex<Live>,
    pub fx: Arc<Mutex<Fx>>,
    /// The presets played, newest first, at most [`PLAYED`]; kept across launches.
    pub played: Mutex<Vec<String>>,
}

impl Deck {
    pub fn new(store: Store) -> Deck {
        let played = crate::settings::load::<Vec<String>>(PLAYED_FILE).unwrap_or_default();
        Deck { store: Mutex::new(store), live: Mutex::new(Live::default()), fx: Arc::new(Mutex::new(Fx::restored())), played: Mutex::new(played) }
    }

    /// The deck as the page sees it. The effects are read first and let go, so
    /// no lock is held while taking another.
    pub fn view(&self) -> DeckView {
        let fx = self.fx.lock().unwrap().settings.clone();
        self.live.lock().unwrap().view(&fx)
    }

    /// The effects panel's state: the effects, and the deck's hold and bars.
    pub fn fx_view(&self) -> crate::fx::View {
        let (hold, bars) = {
            let live = self.live.lock().unwrap();
            (live.hold, live.bars)
        };
        self.fx.lock().unwrap().view(hold, bars)
    }

    /// `path` is playing: remember it, newest first.
    fn record(&self, path: &Path) {
        let path = path.to_string_lossy().into_owned();
        let mut played = self.played.lock().unwrap();
        played.retain(|p| *p != path);
        played.insert(0, path);
        played.truncate(PLAYED);
        crate::settings::save_json(PLAYED_FILE, &*played);
    }

    /// The page opened `path` itself (a library click): it is what plays now.
    pub fn opened(&self, path: &Path) {
        self.live.lock().unwrap().opened(path.to_path_buf());
        self.record(path);
    }

    /// Tell the page the effects panel moved.
    pub fn emit_fx(&self, handle: &AppHandle) -> Result<(), String> {
        handle.emit("fx", self.fx_view()).map_err(|e| e.to_string())
    }

    /// Follow Link's session `frame` (`n` is the ticker's count): with peers, the
    /// effects' beat (strobe, punch on beat) is the session's; alone, it is the
    /// tapped tempo again. Returns whether the page must be sent `fx`: when that
    /// changed, and once a second while linked.
    pub fn follow_link(&self, frame: &crate::link::Frame, n: u64) -> bool {
        let mut fx = self.fx.lock().unwrap();
        let was = fx.linked;
        if frame.enabled && frame.peers > 0 {
            fx.follow(frame.tempo, frame.beat, Instant::now());
        } else {
            fx.unfollow();
        }
        was != fx.linked || (fx.linked && n % 10 == 0)
    }

    fn lists(&self) -> Lists {
        let playlists = {
            let mut store = self.store.lock().unwrap();
            // Items with no hash yet whose file has appeared since: hashed and kept.
            if store.hash_missing() {
                if let Err(e) = store.save() {
                    eprintln!("playlists: {e}");
                }
            }
            store.views()
        };
        Lists { playlists, deck: self.view() }
    }

    /// Tell the page the playlists changed outside a playlist command (presets that
    /// moved, `crate::userlib`): the [`Lists`] a command would return, as [`LISTS`].
    pub fn emit_lists(&self, handle: &AppHandle) -> Result<(), String> {
        handle.emit(LISTS, serde_json::to_value(self.lists()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    /// Change preset on Link's grid on `every` ([`Live::schedule`]), give Link the
    /// schedule, and tell the page. Link is told only after the deck's lock is let go,
    /// so no lock is held while taking Link's.
    pub fn set_schedule(&self, handle: &AppHandle, every: Every) -> Result<(), String> {
        let every = self.live.lock().unwrap().schedule(every);
        handle.state::<crate::link::Link>().set_every(every);
        emit_deck(handle, self)
    }

    /// The effects and Link's schedule of the settings `s` a playlist just gave the deck.
    fn took(&self, handle: &AppHandle, s: &Settings) {
        apply_fx(&mut self.fx.lock().unwrap(), s, Instant::now());
        handle.state::<crate::link::Link>().set_every(every_of(s.change).clamped());
    }

    /// The effects and Link's schedule of what changed from `old` to `new` in the
    /// playing playlist's settings ([`Live::retake`]).
    fn retook(&self, handle: &AppHandle, old: &Settings, new: &Settings) {
        apply_fx_changed(&mut self.fx.lock().unwrap(), old, new, Instant::now());
        if old.change != new.change {
            handle.state::<crate::link::Link>().set_every(every_of(new.change).clamped());
        }
    }
}

/// Tell the page the deck's settings moved: `fx` (the effects panel shows hold and
/// bars), then `live`.
fn emit_deck(handle: &AppHandle, deck: &Deck) -> Result<(), String> {
    deck.emit_fx(handle)?;
    emit_now(handle, Now { deck: deck.view(), opened: None, path: None, error: None })
}

/// Send `now` as the `live` event, and let `crate::resume` keep where the deck is.
fn emit_now(handle: &AppHandle, now: Now) -> Result<(), String> {
    crate::resume::note(handle, &now.deck);
    handle.emit("live", now).map_err(|e| e.to_string())
}

/// What an action did, sent to the page as the `live` event.
#[derive(Serialize, Clone)]
pub(crate) struct Now {
    deck: DeckView,
    /// The preset now on the bench, when the action changed it.
    opened: Option<crate::library::Opened>,
    path: Option<String>,
    /// Why the preset at `path` did not open.
    error: Option<String>,
}

/// A fresh random number, for random picks and shuffles.
pub(crate) fn roll() -> u64 {
    let mut x = std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
    x ^= x << 13;
    x ^= x >> 7;
    x ^ (x << 17)
}

/// How many presets in a row a step may skip when they fail to open and
/// `crate::resume::open_failed` says to skip them.
const SKIPS: usize = 8;

/// Do `action`: move the live state, open what it means on the bench, tell the page.
/// Callable from any thread — the page's `act`, the auto-advance timer, a MIDI input.
pub fn dispatch(handle: &AppHandle, action: Action) -> Result<(), String> {
    dispatch_skipping(handle, action, SKIPS)
}

fn dispatch_skipping(handle: &AppHandle, action: Action, skips: usize) -> Result<(), String> {
    let deck = handle.state::<Deck>();
    if let Action::Fx(fx) = &action {
        let tempo = {
            let mut state = deck.fx.lock().unwrap();
            state.apply(fx, Instant::now())?.then_some(state.bpm)
        };
        if let Some(bpm) = tempo {
            crate::fx::save_tempo(bpm);
        }
        // `live` too: an effect a playlist sets may now differ from it.
        return emit_deck(handle, &deck);
    }
    if let Action::Bars { bars } = action {
        return deck.set_schedule(handle, Every { every: bars, unit: Unit::Bars });
    }
    if let Action::Hold { .. } = action {
        {
            let store = deck.store.lock().unwrap();
            let mut live = deck.live.lock().unwrap();
            decide(&mut live, &action, &store, &Vec::<PathBuf>::new, &|_| Vec::new(), 0)?;
        }
        return emit_deck(handle, &deck);
    }
    let app = handle.state::<crate::App>();
    let all = crate::userlib::playable(handle, crate::pack::milk_files(handle));
    let played = deck.played.lock().unwrap().clone();
    let resolve = |q: &LibraryQuery| crate::query::resolve(q, &crate::catalog::cached_rows(handle), &crate::userlib::data(handle), &played);
    let library = || all.clone();
    let (path, took) = step(&deck.store, &deck.live, &action, &library, &resolve, roll())?;
    if let Some(s) = took {
        deck.took(handle, &s);
        deck.emit_fx(handle)?;
    }
    let (opened, error) = match &path {
        Some(p) => crate::resume::open(handle, &app, p),
        None => (None, None),
    };
    if let (Some(p), Some(e)) = (&path, &error) {
        let stepping = matches!(action, Action::Next | Action::Previous | Action::Random);
        if stepping && skips > 0 && crate::resume::open_failed(handle, p, e) == crate::resume::Failed::Skip {
            return dispatch_skipping(handle, action, skips - 1);
        }
    }
    if let (Some(p), Some(_)) = (&path, &opened) {
        deck.record(p);
    }
    let now = Now { deck: deck.view(), opened, path: path.map(|p| p.to_string_lossy().into_owned()), error };
    emit_now(handle, now)
}

/// [`decide`] `action` on the deck's playlists and live state, holding their
/// locks only to read a smart playlist's filter and then to apply: what a
/// smart playlist or filter picks (`resolve`, which goes through the whole
/// library) is worked out with no lock held. Returns the preset to open and,
/// for a load, the settings the deck took.
fn step(
    store: &Mutex<Store>,
    live: &Mutex<Live>,
    action: &Action,
    library: &dyn Fn() -> Vec<PathBuf>,
    resolve: &dyn Fn(&LibraryQuery) -> Vec<PathBuf>,
    roll: u64,
) -> Result<(Option<PathBuf>, Option<Settings>), String> {
    // Following the grid while a playlist is loaded changes nothing: work nothing out.
    if matches!(action, Action::Query { at: Some(_), .. }) && live.lock().unwrap().playlist.is_some() {
        return Ok((None, None));
    }
    let query = match action {
        Action::Load { playlist, .. } => store.lock().unwrap().lists.get(*playlist).filter(|l| l.kind == Kind::Smart).map(|l| l.query.clone().unwrap_or_default()),
        Action::Query { query, .. } => Some(query.clone()),
        _ => None,
    };
    // Held, the load is refused anyway: no need to work anything out (following the grid isn't refused).
    let held = live.lock().unwrap().hold && !matches!(action, Action::Query { at: Some(_), .. });
    let resolved = query.filter(|_| !held).map(|q| {
        let items = resolve(&q);
        (q, items)
    });
    // The filter is the one worked out unless the playlists changed in between.
    let picked = |q: &LibraryQuery| match &resolved {
        Some((asked, items)) if asked == q => items.clone(),
        _ => Vec::new(),
    };
    let store = store.lock().unwrap();
    let mut live = live.lock().unwrap();
    let path = decide(&mut live, action, &store, library, &picked, roll)?;
    Ok((path, if matches!(action, Action::Load { .. }) { live.settings } else { None }))
}

/// Advance on the active playlist (or the library) every `seconds` while auto is on.
pub fn start_auto(handle: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let deck = handle.state::<Deck>();
            let due = {
                let mut live = deck.live.lock().unwrap();
                let due = live.auto && !live.hold && live.since.elapsed().as_secs_f64() >= live.seconds;
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

/// The event [`Deck::emit_lists`] sends the playlists out on.
pub const LISTS: &str = "lists";

/// Every playlist and the live state, which every playlist command returns.
#[derive(Serialize)]
pub struct Lists {
    playlists: Vec<View>,
    deck: DeckView,
}

/// Run an edit on the store, save it, and keep the live state pointing right.
fn edit<T>(deck: &Deck, f: impl FnOnce(&mut Store) -> Result<T, String>) -> Result<T, String> {
    let mut store = deck.store.lock().unwrap();
    let before = store.lists.clone();
    let out = f(&mut store)?;
    if let Err(e) = store.save() {
        // Memory and the file agree: the edit is undone.
        store.lists = before;
        return Err(e);
    }
    deck.live.lock().unwrap().resync(&store, roll());
    Ok(out)
}

fn edited(deck: &Deck, f: impl FnOnce(&mut Store) -> Result<(), String>) -> Result<Lists, String> {
    edit(deck, f)?;
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
    edited(&deck, |s| s.create(&name).map(|_| ()))
}

#[tauri::command]
pub fn playlist_rename(id: String, name: String, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.rename(&id, &name))
}

#[tauri::command]
pub fn playlist_delete(id: String, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.delete(&id))
}

#[tauri::command]
pub fn playlist_add(id: String, path: String, at: Option<usize>, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.add(&id, Path::new(&path), at))
}

#[tauri::command]
pub fn playlist_remove(id: String, index: usize, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.remove(&id, index))
}

#[tauri::command]
pub fn playlist_move_item(id: String, from: usize, to: usize, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.move_item(&id, from, to))
}

#[tauri::command]
pub fn playlist_move(id: String, to: usize, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.move_list(&id, to))
}

/// Change playlist `id`'s settings. When it is the one playing, the deck takes
/// what changed at once ([`Live::retake`]): the rest, its play order and timer,
/// and live tweaks of what didn't change stay as they are.
#[tauri::command]
pub fn playlist_settings(id: String, settings: Settings, deck: State<Deck>, handle: AppHandle) -> Result<Lists, String> {
    let (old, new) = edit(&deck, |s| {
        let old = s.find(&id).map(|l| l.settings);
        s.set_settings(&id, settings)?;
        Ok((old, s.find(&id).map(|l| l.settings)))
    })?;
    let changed = {
        let mut live = deck.live.lock().unwrap();
        match (live.playlist.as_deref() == Some(id.as_str()), live.settings.or(old), new) {
            (true, Some(old), Some(new)) => {
                live.retake(&old, &new, roll());
                Some((old, new))
            }
            _ => None,
        }
    };
    if let Some((old, new)) = changed {
        deck.retook(&handle, &old, &new);
        emit_deck(&handle, &deck)?;
    }
    Ok(deck.lists())
}

/// Change smart playlist `id`'s filter; it plays the new one from its next load.
#[tauri::command]
pub fn playlist_set_query(id: String, query: LibraryQuery, deck: State<Deck>) -> Result<Lists, String> {
    edited(&deck, |s| s.set_query(&id, query))
}

/// Save `query` as a smart playlist named `name`. Returns its id; the playlists
/// follow as the `lists` event.
#[tauri::command]
pub fn smart_playlist_save(name: String, query: LibraryQuery, deck: State<Deck>, handle: AppHandle) -> Result<String, String> {
    let id = edit(&deck, |s| s.create_smart(&name, query))?;
    deck.emit_lists(&handle)?;
    Ok(id)
}

/// Playlist `id` as a file to share: its presets by path and content hash.
#[tauri::command]
pub fn playlist_export(id: String, deck: State<Deck>) -> Result<Exported, String> {
    deck.store.lock().unwrap().export(&id)
}

/// Add the playlist a shared file's `text` holds. Its presets not where it says
/// are looked for by their hash.
#[tauri::command]
pub fn playlist_import(text: String, deck: State<Deck>, handle: AppHandle) -> Result<Lists, String> {
    edit(&deck, |s| s.import(&text))?;
    crate::userlib::rematch(&handle);
    Ok(deck.lists())
}

/// What the playlist or filter playing plays, in its play order.
#[tauri::command]
pub fn deck_items(deck: State<Deck>) -> Vec<String> {
    let live = deck.live.lock().unwrap();
    live.sequence.iter().filter_map(|&i| live.items.get(i)).map(|p| p.to_string_lossy().into_owned()).collect()
}

/// The presets played, newest first.
#[tauri::command]
pub fn recently_played(deck: State<Deck>) -> Vec<String> {
    deck.played.lock().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playlists::Change;

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

    /// Smart playlists and filters pick nothing here.
    fn nothing(_: &LibraryQuery) -> Vec<PathBuf> {
        Vec::new()
    }

    fn d(live: &mut Live, action: &Action, s: &Store) -> Result<Option<PathBuf>, String> {
        decide(live, action, s, &none, &nothing, 0)
    }

    fn rolled(live: &mut Live, action: &Action, s: &Store, roll: u64) -> Result<Option<PathBuf>, String> {
        decide(live, action, s, &none, &nothing, roll)
    }

    #[test]
    fn steps_through_the_active_playlist() {
        let (s, lib) = store();
        let mut live = Live::default();
        let p = |n: &str| Some(lib.join(format!("{n}.milk")));
        assert_eq!(d(&mut live, &Action::Load { playlist: 0, index: None }, &s).unwrap(), p("x"));
        assert_eq!(live.playlist.as_deref(), Some(s.lists[0].id.as_str()));
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap(), p("y"));
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap(), p("z"));
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap(), p("x"));
        assert_eq!(d(&mut live, &Action::Previous, &s).unwrap(), p("z"));
        assert_eq!(d(&mut live, &Action::Go { index: 1 }, &s).unwrap(), p("y"));
        assert_eq!(live.current, p("y"));
        assert_eq!(live.next_path(), p("z").as_ref());
        assert!(d(&mut live, &Action::Go { index: 3 }, &s).is_err());
        // Random never repeats the current item while there is another.
        for roll in 0..6 {
            let mut l = Live { playlist: live.playlist.clone(), items: live.items.clone(), sequence: live.sequence.clone(), index: Some(1), current: p("y"), ..Live::default() };
            assert_ne!(rolled(&mut l, &Action::Random, &s, roll).unwrap(), p("y"));
        }
        assert_eq!(d(&mut live, &Action::Load { playlist: 0, index: Some(2) }, &s).unwrap(), p("z"));
        assert!(d(&mut live, &Action::Load { playlist: 0, index: Some(3) }, &s).is_err());
        assert!(d(&mut live, &Action::Load { playlist: 2, index: None }, &s).is_err());
    }

    #[test]
    fn an_empty_playlist_plays_nothing_and_unload_returns_to_the_library() {
        let (s, lib) = store();
        let mut live = Live::default();
        assert_eq!(d(&mut live, &Action::Load { playlist: 1, index: None }, &s).unwrap(), None);
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap(), None);
        assert_eq!(live.index, None);
        d(&mut live, &Action::Unload, &s).unwrap();
        assert_eq!(live.playlist, None);
        assert!(d(&mut live, &Action::Go { index: 0 }, &s).is_err());
        let library = || vec![lib.join("a.milk"), lib.join("b.milk")];
        let mut step = |a: Action| decide(&mut live, &a, &s, &library, &nothing, 0).unwrap();
        assert_eq!(step(Action::Next), Some(lib.join("a.milk")));
        assert_eq!(step(Action::Next), Some(lib.join("b.milk")));
        assert_eq!(step(Action::Next), Some(lib.join("a.milk")));
        assert_eq!(step(Action::Previous), Some(lib.join("b.milk")));
    }

    #[test]
    fn auto_and_seconds() {
        let (s, _) = store();
        let mut live = Live::default();
        d(&mut live, &Action::Auto { on: None }, &s).unwrap();
        assert!(live.auto);
        d(&mut live, &Action::Auto { on: Some(true) }, &s).unwrap();
        assert!(live.auto);
        d(&mut live, &Action::Auto { on: None }, &s).unwrap();
        assert!(!live.auto);
        d(&mut live, &Action::Seconds { seconds: 0.1 }, &s).unwrap();
        assert_eq!(live.seconds, 1.0);
        assert!(d(&mut live, &Action::Seconds { seconds: f64::NAN }, &s).is_err());
    }

    #[test]
    fn edits_keep_the_live_state_pointing_right() {
        let (mut s, lib) = store();
        let mut live = Live::default();
        d(&mut live, &Action::Load { playlist: 0, index: Some(2) }, &s).unwrap();
        let id = s.lists[0].id.clone();
        s.move_item(&id, 2, 0).unwrap();
        live.resync(&s, 0);
        assert_eq!(live.index, Some(0));
        s.remove(&id, 0).unwrap();
        live.resync(&s, 0);
        assert_eq!(live.index, Some(0));
        assert_eq!(live.items, [lib.join("x.milk"), lib.join("y.milk")]);
        assert_eq!(live.sequence, [0, 1], "a new order for the new number of items");
        assert_eq!(s.paths(&id)[0], lib.join("x.milk"));
        s.delete(&id).unwrap();
        live.resync(&s, 0);
        assert_eq!((live.playlist.clone(), live.index, live.items.len()), (None, None, 0));
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
        assert_eq!(read(r#"{"kind":"query","query":{"groups":{"tags":["chill"]},"text":""}}"#), Action::Query { query: serde_json::from_str(r#"{"groups":{"tags":["chill"]}}"#).unwrap(), at: None });
        assert_eq!(read(r#"{"kind":"query","query":{"groups":{},"text":""},"at":"/p/a.milk"}"#), Action::Query { query: LibraryQuery::default(), at: Some(PathBuf::from("/p/a.milk")) });
        // The effects read as actions too, in the same flat shape.
        assert_eq!(read(r#"{"kind":"strobe","on":true}"#), Action::Fx(FxAction::Strobe { on: Some(true) }));
        assert_eq!(read(r#"{"kind":"tap"}"#), Action::Fx(FxAction::Tap));
        assert_eq!(read(r#"{"kind":"speed","speed":0.5}"#), Action::Fx(FxAction::Speed { speed: 0.5 }));
        assert_eq!(serde_json::to_string(&Action::Fx(FxAction::Tap)).unwrap(), r#"{"kind":"tap"}"#);
        assert!(serde_json::from_str::<Action>(r#"{"kind":"nonsense"}"#).is_err());
    }

    #[test]
    fn hold_ignores_steps_and_bars_leave_the_seconds() {
        let (s, lib) = store();
        let mut live = Live::default();
        d(&mut live, &Action::Load { playlist: 0, index: None }, &s).unwrap();
        d(&mut live, &Action::Hold { on: None }, &s).unwrap();
        assert!(live.hold);
        for action in
            [Action::Next, Action::Previous, Action::Random, Action::Go { index: 2 }, Action::Load { playlist: 0, index: Some(1) }, Action::Query { query: LibraryQuery::default(), at: None }]
        {
            assert!(d(&mut live, &action, &s).is_err(), "{action:?} while held");
        }
        assert_eq!(live.current, Some(lib.join("x.milk")));
        // Settings still change while held.
        d(&mut live, &Action::Seconds { seconds: 10.0 }, &s).unwrap();
        d(&mut live, &Action::Hold { on: Some(false) }, &s).unwrap();
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap(), Some(lib.join("y.milk")));
        assert_eq!(live.seconds, 10.0);
        d(&mut live, &Action::Bars { bars: 8 }, &s).unwrap();
        assert_eq!(live.seconds, 10.0, "bars are Link's schedule, not the timed period");
        d(&mut live, &Action::Bars { bars: 1000 }, &s).unwrap();
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

    #[test]
    fn a_playlist_s_settings_apply_when_it_loads_and_a_tweak_lasts_until_the_next_load() {
        let (mut s, _) = store();
        let (a, b) = (s.lists[0].id.clone(), s.lists[1].id.clone());
        s.set_settings(&a, Settings { change: Change::Seconds { every: 12.0 }, transition: 4.0, speed: 2.0, trails: 0.5, hue: 0.25, ..Settings::default() }).unwrap();
        s.set_settings(&b, Settings { change: Change::Bars { every: 16 }, ..Settings::default() }).unwrap();
        let mut live = Live::default();
        let mut fx = Fx::new(Instant::now());
        d(&mut live, &Action::Load { playlist: 0, index: None }, &s).unwrap();
        apply_fx(&mut fx, &live.settings.unwrap(), Instant::now());
        assert!(live.auto);
        assert_eq!((live.seconds, live.bars), (12.0, 0));
        assert_eq!((fx.settings.transition, fx.settings.speed, fx.settings.trails, fx.settings.hue), (4.0, 2.0, 0.5, 0.25));
        assert!(live.view(&fx.settings).differs.is_empty());

        // Live tweaks: reported as differing from the playlist's settings.
        d(&mut live, &Action::Seconds { seconds: 20.0 }, &s).unwrap();
        fx.apply(&FxAction::Speed { speed: 1.0 }, Instant::now()).unwrap();
        let view = live.view(&fx.settings);
        assert_eq!(view.differs, ["change", "speed"]);
        assert_eq!(view.settings, Some(s.lists[0].settings));
        // Stepping keeps the tweaks.
        d(&mut live, &Action::Next, &s).unwrap();
        assert_eq!(live.seconds, 20.0);

        // The next playlist's settings replace them: on Link's bars, auto-advance off.
        d(&mut live, &Action::Load { playlist: 1, index: None }, &s).unwrap();
        apply_fx(&mut fx, &live.settings.unwrap(), Instant::now());
        assert_eq!((live.auto, live.bars), (false, 16));
        assert_eq!(every_of(live.settings.unwrap().change), Every { every: 16, unit: Unit::Bars });
        assert_eq!((fx.settings.speed, fx.settings.trails), (1.0, 0.0));
        assert!(live.view(&fx.settings).differs.is_empty());
        d(&mut live, &Action::Bars { bars: 4 }, &s).unwrap();
        assert_eq!(live.view(&fx.settings).differs, ["change"]);
        // Unloaded, nothing is a tweak of anything.
        d(&mut live, &Action::Unload, &s).unwrap();
        assert!(live.view(&fx.settings).differs.is_empty());
    }

    #[test]
    fn shuffle_plays_every_item_once_a_round_and_says_what_is_next() {
        let (mut s, lib) = store();
        let a = s.lists[0].id.clone();
        for n in ["u", "v", "w"] {
            s.add(&a, &lib.join(format!("{n}.milk")), None).unwrap();
        }
        s.set_settings(&a, Settings { order: Order::Shuffle, ..Settings::default() }).unwrap();
        let mut live = Live::default();
        let first = rolled(&mut live, &Action::Load { playlist: 0, index: None }, &s, 12345).unwrap().unwrap();
        assert_eq!(live.order, Order::Shuffle);
        let mut seen = vec![first];
        for _ in 1..6 {
            let next = live.next_path().cloned();
            let opened = d(&mut live, &Action::Next, &s).unwrap();
            assert_eq!(opened, next, "next says what next opens");
            seen.push(opened.unwrap());
        }
        let mut sorted = seen.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 6, "each item once: {seen:?}");
        assert_ne!(live.sequence, [0, 1, 2, 3, 4, 5], "shuffled");
        // Round again, in the same order.
        assert_eq!(d(&mut live, &Action::Next, &s).unwrap().as_ref(), Some(&seen[0]));
    }

    #[test]
    fn a_smart_playlist_and_a_filter_play_what_they_resolve_to_on_load() {
        let (mut s, lib) = store();
        let calm = LibraryQuery { text: "calm".into(), ..Default::default() };
        s.create_smart("Calm", calm.clone()).unwrap();
        let asked = std::cell::RefCell::new(Vec::new());
        let resolve = |q: &LibraryQuery| {
            asked.borrow_mut().push(q.text.clone());
            if q.text == "calm" { vec![lib.join("c1.milk"), lib.join("c2.milk")] } else { vec![lib.join("m.milk")] }
        };
        let mut live = Live::default();
        let go = |live: &mut Live, a: Action| decide(live, &a, &s, &none, &resolve, 0).unwrap();
        assert_eq!(go(&mut live, Action::Load { playlist: 2, index: None }), Some(lib.join("c1.milk")));
        assert_eq!(live.view(&Default::default()).count, 2);
        assert_eq!(go(&mut live, Action::Next), Some(lib.join("c2.milk")));
        assert_eq!(go(&mut live, Action::Next), Some(lib.join("c1.milk")));
        assert_eq!(*asked.borrow(), ["calm"], "worked out once, on load");
        // A mood: an unsaved filter, keeping the deck's settings.
        let mood = LibraryQuery { text: "mood".into(), ..Default::default() };
        assert_eq!(go(&mut live, Action::Query { query: mood.clone(), at: None }), Some(lib.join("m.milk")));
        let view = live.view(&Default::default());
        assert_eq!((view.playlist, view.query, view.count, view.settings), (None, Some(mood), 1, None));
        assert_eq!(go(&mut live, Action::Next), Some(lib.join("m.milk")));
        assert!(go(&mut live, Action::Go { index: 0 }).is_some());
        go(&mut live, Action::Unload);
        assert_eq!((live.query.clone(), live.view(&Default::default()).count), (None, 0));
    }

    #[test]
    fn a_smart_playlist_is_worked_out_with_neither_lock_held() {
        let (mut s, lib) = store();
        s.create_smart("Calm", LibraryQuery { text: "calm".into(), ..Default::default() }).unwrap();
        let (store, live) = (Mutex::new(s), Mutex::new(Live::default()));
        let asked = std::cell::Cell::new(0);
        let resolve = |_: &LibraryQuery| {
            asked.set(asked.get() + 1);
            assert!(store.try_lock().is_ok(), "the playlists are not locked while resolving");
            assert!(live.try_lock().is_ok(), "the deck is not locked while resolving");
            vec![lib.join("c.milk")]
        };
        let (path, took) = step(&store, &live, &Action::Load { playlist: 2, index: None }, &none, &resolve, 0).unwrap();
        assert_eq!((path, took), (Some(lib.join("c.milk")), Some(Settings::default())));
        let (path, took) = step(&store, &live, &Action::Query { query: LibraryQuery::default(), at: None }, &none, &resolve, 0).unwrap();
        assert_eq!((path, took), (Some(lib.join("c.milk")), None));
        assert_eq!(asked.get(), 2);
        // A manual playlist and a step resolve nothing.
        step(&store, &live, &Action::Load { playlist: 0, index: None }, &none, &resolve, 0).unwrap();
        step(&store, &live, &Action::Next, &none, &resolve, 0).unwrap();
        assert_eq!(asked.get(), 2);
    }

    #[test]
    fn following_the_grid_steps_in_its_order_across_groups_and_leaves_a_playlist_alone() {
        let (s, lib) = store();
        // What the grid shows (resolve leaves hidden presets out), two styles one after the other.
        let grid: Vec<PathBuf> = ["calm/1", "calm/2", "loud/1", "loud/2"].iter().map(|n| lib.join(format!("{n}.milk"))).collect();
        let resolve = |_: &LibraryQuery| grid.clone();
        let p = |n: &str| Some(lib.join(format!("{n}.milk")));
        let follow = |at: &str| Action::Query { query: LibraryQuery { text: "grid".into(), ..Default::default() }, at: p(at) };
        // A shuffled deck: the grid still plays in its own order.
        let mut live = Live { order: Order::Shuffle, ..Live::default() };
        let go = |live: &mut Live, a: Action| decide(live, &a, &s, &none, &resolve, 7).unwrap();
        assert_eq!(go(&mut live, follow("calm/2")), None, "the page opened it: the deck opens nothing");
        assert_eq!((live.index, live.order, live.query.as_ref().map(|q| q.text.as_str())), (Some(1), Order::InOrder, Some("grid")));
        assert_eq!(go(&mut live, Action::Next), p("loud/1"), "on into the next group");
        assert_eq!(go(&mut live, Action::Next), p("loud/2"));
        assert_eq!(go(&mut live, Action::Next), p("calm/1"), "wraps to the first group");
        assert_eq!(go(&mut live, Action::Previous), p("loud/2"), "back into the last group");
        for roll in 0..8 {
            let r = decide(&mut live, &Action::Random, &s, &none, &resolve, roll).unwrap();
            assert!(r.as_ref().is_some_and(|r| grid.contains(r)), "random stays in the grid");
        }
        // Random never repeats the one playing while there is another.
        go(&mut live, follow("loud/1"));
        live.current = p("loud/1");
        for roll in 0..8 {
            let mut l = Live { query: live.query.clone(), items: live.items.clone(), sequence: live.sequence.clone(), index: live.index, ..Live::default() };
            assert_ne!(decide(&mut l, &Action::Random, &s, &none, &resolve, roll).unwrap(), p("loud/1"));
        }
        // A preset the grid's playable set leaves out (a hidden one): stepping starts from the first.
        go(&mut live, follow("hidden"));
        assert_eq!(live.index, None);
        assert_eq!(go(&mut live, Action::Next), p("calm/1"));
        // Held, the grid is still followed (it opens nothing), but steps are refused.
        live.hold = true;
        go(&mut live, follow("loud/2"));
        assert_eq!(live.index, Some(3));
        assert!(decide(&mut live, &Action::Next, &s, &none, &resolve, 0).is_err());
        live.hold = false;
        // With a playlist loaded, nothing changes.
        assert_eq!(go(&mut live, Action::Load { playlist: 0, index: None }), p("x"));
        assert_eq!(go(&mut live, follow("calm/1")), None);
        assert_eq!((live.playlist.as_deref(), live.query.clone(), live.index), (Some(s.lists[0].id.as_str()), None, Some(0)));
        assert_eq!(go(&mut live, Action::Next), p("y"));
    }

    #[test]
    fn following_the_grid_is_worked_out_even_while_held() {
        let (s, lib) = store();
        let (store, live) = (Mutex::new(s), Mutex::new(Live { hold: true, ..Live::default() }));
        let resolve = |_: &LibraryQuery| vec![lib.join("a.milk"), lib.join("b.milk")];
        let follow = Action::Query { query: LibraryQuery::default(), at: Some(lib.join("b.milk")) };
        assert_eq!(step(&store, &live, &follow, &none, &resolve, 0).unwrap(), (None, None));
        assert_eq!(live.lock().unwrap().index, Some(1));
    }

    #[test]
    fn following_the_grid_with_a_playlist_loaded_resolves_nothing() {
        let (s, lib) = store();
        let (store, live) = (Mutex::new(s), Mutex::new(Live::default()));
        let asked = std::cell::Cell::new(0);
        let resolve = |_: &LibraryQuery| {
            asked.set(asked.get() + 1);
            Vec::new()
        };
        step(&store, &live, &Action::Load { playlist: 0, index: None }, &none, &resolve, 0).unwrap();
        let follow = Action::Query { query: LibraryQuery::default(), at: Some(lib.join("x.milk")) };
        assert_eq!(step(&store, &live, &follow, &none, &resolve, 0).unwrap(), (None, None));
        assert_eq!(asked.get(), 0);
    }

    #[test]
    fn opening_from_elsewhere_while_following_never_steps_from_a_stale_place() {
        let (s, lib) = store();
        let grid: Vec<PathBuf> = ["a", "b", "c"].iter().map(|n| lib.join(format!("{n}.milk"))).collect();
        let resolve = |_: &LibraryQuery| grid.clone();
        let mut live = Live::default();
        let follow = Action::Query { query: LibraryQuery::default(), at: Some(grid[0].clone()) };
        decide(&mut live, &follow, &s, &none, &resolve, 0).unwrap();
        assert_eq!(live.current, Some(grid[0].clone()), "the deck's current is what the page opened");
        // Opened from elsewhere, but in the grid: the deck steps on from it.
        live.opened(grid[1].clone());
        assert_eq!(decide(&mut live, &Action::Next, &s, &none, &resolve, 0).unwrap(), Some(grid[2].clone()));
        // Not in the grid (a dropped file): the deck stops following.
        let dropped = lib.join("dropped.milk");
        live.opened(dropped.clone());
        assert_eq!((live.query.clone(), live.index, live.current.clone()), (None, None, Some(dropped)));
    }

    #[test]
    fn settings_out_of_their_limits_are_checked_when_a_playlist_loads() {
        let (mut s, _) = store();
        // As a hand edit leaves them: changing every 0 seconds, at speed 99.
        s.lists[0].settings = Settings { change: Change::Seconds { every: 0.0 }, speed: 99.0, ..Settings::default() };
        let (store, live) = (Mutex::new(s), Mutex::new(Live::default()));
        let (_, took) = step(&store, &live, &Action::Load { playlist: 0, index: None }, &none, &nothing, 0).unwrap();
        let took = took.unwrap();
        assert_eq!((took.change, took.speed), (Change::Seconds { every: 1.0 }, 4.0));
        let live = live.lock().unwrap();
        assert_eq!((live.auto, live.seconds), (true, 1.0), "never every 100 ms");
        let mut fx = Fx::new(Instant::now());
        apply_fx(&mut fx, &took, Instant::now());
        assert_eq!(fx.settings.speed, 4.0);
    }

    #[test]
    fn editing_the_playing_playlist_takes_only_what_changed() {
        let (mut s, lib) = store();
        let a = s.lists[0].id.clone();
        for n in ["u", "v", "w"] {
            s.add(&a, &lib.join(format!("{n}.milk")), None).unwrap();
        }
        s.set_settings(&a, Settings { order: Order::Shuffle, ..Settings::default() }).unwrap();
        let mut live = Live::default();
        let mut fx = Fx::new(Instant::now());
        rolled(&mut live, &Action::Load { playlist: 0, index: None }, &s, 12345).unwrap();
        apply_fx(&mut fx, &live.settings.unwrap(), Instant::now());
        d(&mut live, &Action::Next, &s).unwrap();
        // Live: auto-advance turned off, speed tweaked.
        d(&mut live, &Action::Auto { on: Some(false) }, &s).unwrap();
        fx.apply(&FxAction::Speed { speed: 2.0 }, Instant::now()).unwrap();
        let (next, sequence, since) = (live.next_path().cloned(), live.sequence.clone(), live.since);
        let view = live.view(&fx.settings);
        assert_eq!(view.next_index.map(|i| &live.items[i]), next.as_ref());

        // Dragging trails, a step at a time.
        let mut old = live.settings.unwrap();
        for trails in [0.1, 0.2, 0.3] {
            let new = Settings { trails, ..old };
            live.retake(&old, &new, roll());
            apply_fx_changed(&mut fx, &old, &new, Instant::now());
            old = new;
        }
        assert_eq!(live.next_path().cloned(), next, "next stays next");
        assert_eq!((&live.sequence, live.since, live.auto), (&sequence, since, false), "the order and timer are kept, auto stays off");
        assert_eq!((fx.settings.trails, fx.settings.speed), (0.3, 2.0), "trails taken, the speed tweak kept");
        assert_eq!(live.settings.unwrap().trails, 0.3);

        // A new change timing restarts the timer and turns auto-advance on.
        let new = Settings { change: Change::Seconds { every: 5.0 }, ..old };
        live.retake(&old, &new, roll());
        assert_eq!((live.auto, live.seconds, &live.sequence), (true, 5.0, &sequence));
        // A new order draws a new play order.
        let new2 = Settings { order: Order::InOrder, ..new };
        live.retake(&new, &new2, roll());
        assert_eq!(live.sequence, [0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn next_index_tells_a_preset_listed_twice_apart() {
        let (mut s, lib) = store();
        let a = s.lists[0].id.clone();
        s.add(&a, &lib.join("x.milk"), None).unwrap();
        let mut live = Live::default();
        d(&mut live, &Action::Load { playlist: 0, index: Some(2) }, &s).unwrap();
        let view = live.view(&Default::default());
        assert_eq!((view.next.as_deref(), view.next_index), (Some(lib.join("x.milk").to_string_lossy().as_ref()), Some(3)));
    }
}
