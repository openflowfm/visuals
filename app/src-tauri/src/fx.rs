//! Live effects: what a performer plays on top of the preset — speed and freeze,
//! transitions, strobe, blackout, punch, colour and mirror, trails, sensitivity
//! and tap tempo.
//!
//! [`Fx`] is the state. Actions change it ([`Fx::apply`], from `actions::dispatch`),
//! and the bench's render thread reads it every refresh: [`Fx::speed_now`] for the
//! scale on the preset clock, [`Fx::master`] for the engine's master pass. Everything
//! that moves over time (a fade, a punch decaying, the strobe's phase) is worked
//! out from timestamps, so it is the same whenever it is asked for. Only the tempo
//! is kept across restarts.

pub use engine::fx::Mirror;
use engine::fx::Master;
use crate::settings;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// The mirror after `m`: off → x → y → quad → off.
fn next(m: Mirror) -> Mirror {
    match m {
        Mirror::Off => Mirror::X,
        Mirror::X => Mirror::Y,
        Mirror::Y => Mirror::Quad,
        Mirror::Quad => Mirror::Off,
    }
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StrobeStyle {
    /// Flashes of white over the picture.
    #[default]
    White,
    /// The picture itself flashes: black between the flashes.
    Black,
}

/// What strobe and punch-on-beat follow.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Sync {
    /// The tapped (or typed) tempo.
    #[default]
    Tempo,
    /// Beats heard in the bass.
    Audio,
}

/// One change to the effects. These are `actions::Action`s too: the same JSON,
/// the same `act` command, the same `dispatch`. `on: null` toggles.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FxAction {
    Speed {
        speed: f64,
    },
    Freeze {
        on: Option<bool>,
    },
    Transition {
        seconds: f64,
    },
    Strobe {
        on: Option<bool>,
    },
    StrobeRate {
        rate: f64,
    },
    StrobeIntensity {
        value: f64,
    },
    StrobeStyle {
        style: StrobeStyle,
    },
    Sync {
        source: Sync,
    },
    Blackout {
        on: Option<bool>,
    },
    BlackoutFade {
        seconds: f64,
    },
    Punch {
        on: Option<bool>,
    },
    PunchOnBeat {
        on: Option<bool>,
    },
    Brightness {
        value: f64,
    },
    Hue {
        value: f64,
    },
    Invert {
        on: Option<bool>,
    },
    /// `null` steps off → x → y → quad → off.
    Mirror {
        mode: Option<Mirror>,
    },
    Trails {
        value: f64,
    },
    Sensitivity {
        value: f64,
    },
    /// Live mode's one Intensity slider, 0–1 (½ is the picture as drawn): sets
    /// sensitivity, brightness and strobe level together on [`intensity`]'s curve.
    Intensity {
        value: f64,
    },
    Tap,
    Bpm {
        bpm: f64,
    },
    FxReset,
}

/// The effects as the page sees them: the `fx` event, and `fx_state`. `hold` and
/// `bars` are the deck's, carried here so one event has the whole panel.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct View {
    #[serde(flatten)]
    pub settings: Settings,
    pub bpm: f64,
    /// The tempo is a Link session's, not the taps'.
    pub linked: bool,
    pub hold: bool,
    pub bars: u32,
}

/// What the performer has set: every value an action sets directly.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Settings {
    pub speed: f64,
    pub freeze: bool,
    pub transition: f64,
    pub strobe: bool,
    pub strobe_rate: f64,
    pub strobe_intensity: f64,
    pub strobe_style: StrobeStyle,
    pub sync: Sync,
    pub blackout: bool,
    pub blackout_fade: f64,
    pub punch: bool,
    pub punch_on_beat: bool,
    pub brightness: f64,
    pub hue: f64,
    pub invert: bool,
    pub mirror: Mirror,
    pub trails: f64,
    pub sensitivity: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            speed: 1.0,
            freeze: false,
            transition: 2.0,
            strobe: false,
            strobe_rate: 1.0,
            strobe_intensity: 1.0,
            strobe_style: StrobeStyle::White,
            sync: Sync::Tempo,
            blackout: false,
            blackout_fade: 0.0,
            punch: false,
            punch_on_beat: false,
            brightness: 1.0,
            hue: 0.0,
            invert: false,
            mirror: Mirror::Off,
            trails: 0.0,
            sensitivity: 1.0,
        }
    }
}

impl Settings {
    /// Every picture and time effect back to normal, keeping how the performer set
    /// them up: the transition, the strobe's rate, intensity and style, the sync,
    /// the blackout fade and the sensitivity. Punch-on-beat goes off.
    fn reset_keeping_setup(&mut self) {
        *self = Settings {
            transition: self.transition,
            strobe_rate: self.strobe_rate,
            strobe_intensity: self.strobe_intensity,
            strobe_style: self.strobe_style,
            sync: self.sync,
            blackout_fade: self.blackout_fade,
            sensitivity: self.sensitivity,
            ..Settings::default()
        };
    }
}

/// What the Intensity slider sets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Intensity {
    pub sensitivity: f64,
    pub brightness: f64,
    pub strobe: f64,
}

/// The brightest the Intensity slider goes: punch and the strobe on top still leave colour, not white.
pub const INTENSITY_BRIGHTNESS_MAX: f64 = 1.2;
/// The strongest strobe flash the Intensity slider sets; a full-white flash only from the strobe's own level.
pub const INTENSITY_STROBE_MAX: f64 = 0.85;

/// The Intensity slider's curve, `v` 0–1 with ½ the picture as drawn: sensitivity
/// runs from ½× at the bottom to 2× at the top (a log taper, 1× in the middle),
/// brightness 0.8–[`INTENSITY_BRIGHTNESS_MAX`] and the strobe level
/// 0.35–[`INTENSITY_STROBE_MAX`], so the top of the slider never clips to white.
pub fn intensity(v: f64) -> Intensity {
    let v = v.clamp(0.0, 1.0);
    Intensity { sensitivity: 0.5 * 4f64.powf(v), brightness: 0.8 + (INTENSITY_BRIGHTNESS_MAX - 0.8) * v, strobe: 0.35 + (INTENSITY_STROBE_MAX - 0.35) * v }
}

/// With motion reduced ([`crate::access`]): the strongest a strobe flash (or a
/// black gap) gets, under even the bottom of the Intensity slider's strobe level.
pub const REDUCED_FLASH_MAX: f64 = 0.25;
/// With motion reduced: flashes come at least this far apart, two a second at
/// most, under the three a second that photosensitivity guidance draws the line at.
pub const REDUCED_FLASH_EVERY: f64 = 0.5;
/// Always, whatever the setting, tempo, taps or Link do: strobe flashes start at
/// least this far apart, eight a second at most.
pub const FLASH_EVERY: f64 = 0.125;
/// With motion reduced: a blackout fades in and out over at least this long,
/// never an instant cut, whatever its fade is set to.
pub const REDUCED_BLACKOUT_FADE: f64 = 0.25;
/// The tempos strobe and punch-on-beat keep time at: a typed or tapped tempo is
/// clamped to these, and a Link session's is halved or doubled into them.
pub const TEMPO_MIN: f64 = 40.0;
pub const TEMPO_MAX: f64 = 240.0;
/// With motion reduced: the strongest a punch gets (half its zoom and brightness).
pub const REDUCED_PUNCH_MAX: f64 = 0.5;
/// With motion reduced: the strongest punch-on-beat's pulse gets; it pulses at
/// most every [`REDUCED_FLASH_EVERY`] too.
pub const REDUCED_BEAT_PUNCH_MAX: f64 = 0.25;

/// How long freeze takes to come back up to speed once released.
const THAW: f64 = 0.4;
/// How long a punch takes to die away.
const PUNCH_DECAY: f64 = 0.15;
/// A strobe flash, at most; shorter when the flashes come faster.
const FLASH: f64 = 0.045;
/// Taps further apart than this start a new tempo.
const TAP_GAP: f64 = 2.0;
/// Two heard beats are at least this far apart.
const BEAT_GAP: f64 = 0.22;

pub struct Fx {
    pub settings: Settings,
    pub bpm: f64,
    /// The tempo is a Link session's ([`Fx::follow`]), not the taps'.
    pub linked: bool,
    timing: Timing,
}

/// When things happened, for what moves over time.
struct Timing {
    /// When freeze was last released.
    thawed: Option<Instant>,
    /// The crossfade from the last preset: when it started.
    fading: Option<Instant>,
    /// The blackout level when it last changed direction, and when.
    black_from: (f64, Instant),
    /// When the last punch was released or kicked.
    kicked: Option<Instant>,
    /// Where the tempo's beats fall: the last tap.
    anchor: Instant,
    taps: Vec<Instant>,
    /// The last beat heard in the bass, and whether the bass is above the line now.
    heard: Option<Instant>,
    loud: bool,
    /// The last heard beat at least [`REDUCED_FLASH_EVERY`] after the one before:
    /// what an audio strobe flashes on with motion reduced.
    heard_slow: Option<Instant>,
    /// When the last strobe flash shown started ([`paced`]).
    flash_shown: Option<Instant>,
    /// With motion reduced: the last beat punch-on-beat pulsed on ([`paced`]).
    punch_shown: Option<Instant>,
    /// Whether motion was reduced at the last [`Fx::master_with`]: what a
    /// blackout's fade is worked out with when it is pressed.
    reduced: bool,
}

/// How far apart strobe flashes start at least: [`REDUCED_FLASH_EVERY`] with
/// motion `reduced`, [`FLASH_EVERY`] always.
fn flash_every(reduced: bool) -> f64 {
    if reduced { REDUCED_FLASH_EVERY } else { FLASH_EVERY }
}

/// `bpm` halved or doubled until it is within [`TEMPO_MIN`]–[`TEMPO_MAX`], so its
/// beats still fall on (every other…) beat of the tempo it came from.
fn fold_tempo(bpm: f64) -> f64 {
    if !bpm.is_finite() || bpm <= 0.0 {
        return 120.0;
    }
    let mut b = bpm;
    while b > TEMPO_MAX {
        b /= 2.0;
    }
    while b < TEMPO_MIN {
        b *= 2.0;
    }
    b
}

/// Whether a flash (or beat pulse) that started at `start` may show, given when
/// the last one shown started (`shown`, updated when it may). It may when it is
/// that same one, or starts at least `every` after it, whatever moved the beat
/// there: a tap, a new tempo or a Link session. One that starts sooner, or
/// earlier, is refused.
fn paced(shown: &mut Option<Instant>, start: Instant, every: f64) -> bool {
    /// How far apart two readings of one start may be (rounding), and still be the same flash.
    const SAME: f64 = 0.001;
    /// How much sooner than `every` the next one may start and still show: Link re-anchors
    /// the beat on each frame, so a flash due one interval on can land a few ms early.
    /// A few ms, not a fraction of `every`: 10% lets a jumpy session or fast taps
    /// through at 450 ms reduced, over the two-a-second cap.
    const SLACK: f64 = 0.005;
    let Some(last) = *shown else {
        *shown = Some(start);
        return true;
    };
    let after = secs(last, start);
    let before = secs(start, last);
    if after.max(before) < SAME {
        return true;
    }
    if after >= every - SLACK {
        *shown = Some(start);
        return true;
    }
    false
}

impl Timing {
    /// Nothing under way: no fade, thaw or punch dying away, and no blackout.
    /// The tempo's beat and what was heard stay.
    fn settle(&mut self, now: Instant) {
        self.thawed = None;
        self.fading = None;
        self.kicked = None;
        self.black_from = (0.0, now);
    }
}

/// A finite number, clamped; an error naming `what` for NaN or infinity.
pub(crate) fn clamped(v: f64, lo: f64, hi: f64, what: &str) -> Result<f64, String> {
    if v.is_finite() { Ok(v.clamp(lo, hi)) } else { Err(format!("{what} must be a number")) }
}

fn secs(a: Instant, b: Instant) -> f64 {
    b.saturating_duration_since(a).as_secs_f64()
}

impl Fx {
    /// Everything at its default, with the tempo's beat falling at `now`.
    pub fn new(now: Instant) -> Fx {
        Fx {
            settings: Settings::default(),
            bpm: 120.0,
            linked: false,
            timing: Timing {
                thawed: None,
                fading: None,
                black_from: (0.0, now),
                kicked: None,
                anchor: now,
                taps: Vec::new(),
                heard: None,
                loud: false,
                heard_slow: None,
                flash_shown: None,
                punch_shown: None,
                reduced: false,
            },
        }
    }

    /// With the tempo kept from last time, if there is one.
    pub fn restored() -> Fx {
        let mut fx = Fx::new(Instant::now());
        if let Some(bpm) = settings::load::<serde_json::Value>(TEMPO_FILE).and_then(|v| v["bpm"].as_f64()) {
            fx.bpm = bpm.clamp(TEMPO_MIN, TEMPO_MAX);
        }
        fx.timing.reduced = crate::access::reduced();
        fx
    }

    /// Do `action` at `now`. Returns whether the tempo changed (to be saved).
    pub fn apply(&mut self, action: &FxAction, now: Instant) -> Result<bool, String> {
        let flip = |on: &Option<bool>, was: bool| on.unwrap_or(!was);
        let level = self.black_level(now, self.timing.reduced);
        let (s, timing) = (&mut self.settings, &mut self.timing);
        match action {
            FxAction::Speed { speed } => s.speed = clamped(*speed, 0.25, 4.0, "speed")?,
            FxAction::Freeze { on } => {
                let to = flip(on, s.freeze);
                if s.freeze && !to {
                    timing.thawed = Some(now);
                }
                s.freeze = to;
            }
            FxAction::Transition { seconds } => s.transition = clamped(*seconds, 0.0, 10.0, "seconds")?,
            FxAction::Strobe { on } => s.strobe = flip(on, s.strobe),
            FxAction::StrobeRate { rate } => s.strobe_rate = clamped(*rate, 0.25, 4.0, "rate")?,
            FxAction::StrobeIntensity { value } => s.strobe_intensity = clamped(*value, 0.0, 1.0, "intensity")?,
            FxAction::StrobeStyle { style } => s.strobe_style = *style,
            FxAction::Sync { source } => s.sync = *source,
            FxAction::Blackout { on } => {
                let to = flip(on, s.blackout);
                if to != s.blackout {
                    timing.black_from = (level, now);
                }
                s.blackout = to;
            }
            FxAction::BlackoutFade { seconds } => {
                // A fade already under way carries on at the new rate from where it is.
                timing.black_from = (level, now);
                s.blackout_fade = clamped(*seconds, 0.0, 10.0, "seconds")?;
            }
            FxAction::Punch { on } => {
                let to = flip(on, s.punch);
                // Pressed: full at once; released: dies away from there.
                if to != s.punch {
                    timing.kicked = Some(now);
                }
                s.punch = to;
            }
            FxAction::PunchOnBeat { on } => s.punch_on_beat = flip(on, s.punch_on_beat),
            FxAction::Brightness { value } => s.brightness = clamped(*value, 0.0, 2.0, "brightness")?,
            FxAction::Hue { value } => s.hue = clamped(*value, 0.0, 1.0, "hue")?,
            FxAction::Invert { on } => s.invert = flip(on, s.invert),
            FxAction::Mirror { mode } => s.mirror = mode.unwrap_or_else(|| next(s.mirror)),
            FxAction::Trails { value } => s.trails = clamped(*value, 0.0, 1.0, "trails")?,
            FxAction::Sensitivity { value } => s.sensitivity = clamped(*value, 0.25, 4.0, "sensitivity")?,
            FxAction::Intensity { value } => {
                let curve = intensity(clamped(*value, 0.0, 1.0, "intensity")?);
                (s.sensitivity, s.brightness, s.strobe_intensity) = (curve.sensitivity, curve.brightness, curve.strobe);
            }
            FxAction::Tap => return Ok(self.tap(now)),
            FxAction::Bpm { bpm } => {
                self.bpm = clamped(*bpm, TEMPO_MIN, TEMPO_MAX, "bpm")?;
                return Ok(true);
            }
            FxAction::FxReset => {
                s.reset_keeping_setup();
                timing.settle(now);
            }
        }
        Ok(false)
    }

    /// A tap: the tempo is the mean gap between the taps so far (up to the last
    /// eight), and the beat falls on this tap. Returns whether the tempo changed.
    fn tap(&mut self, now: Instant) -> bool {
        // A Link session with peers keeps the tempo; a tap would fight it.
        if self.linked {
            return false;
        }
        let taps = &mut self.timing.taps;
        if taps.last().is_some_and(|&t| secs(t, now) > TAP_GAP) {
            taps.clear();
        }
        taps.push(now);
        if taps.len() > 9 {
            taps.remove(0);
        }
        self.timing.anchor = now;
        let taps = &self.timing.taps;
        if taps.len() < 2 {
            return false;
        }
        let gap = secs(taps[0], now) / (taps.len() - 1) as f64;
        if gap <= 0.0 {
            return false;
        }
        self.bpm = (60.0 / gap).clamp(TEMPO_MIN, TEMPO_MAX);
        true
    }

    /// How long a beat is for the strobe and punch-on-beat: of the tempo halved
    /// or doubled into [`TEMPO_MIN`]–[`TEMPO_MAX`] ([`fold_tempo`]), so a Link
    /// session at 999 bpm keeps time at an eighth of it (halved three times, to
    /// 124.875 bpm), on every eighth of its beats.
    fn beat_length(&self) -> f64 {
        60.0 / fold_tempo(self.bpm)
    }

    /// Take the tempo and the beat from a Link session with peers: `beat` is the
    /// session's beat count (only how far into a beat it is matters, and, when the
    /// session's tempo is out of [`TEMPO_MIN`]–[`TEMPO_MAX`], which of its beats
    /// our slower or faster beat falls on). While followed, taps don't set the
    /// tempo; the band's clock wins. Not saved — it is the session's, not ours.
    /// The tempo shown is the session's; the effects keep time at it folded into
    /// range ([`Fx::beat_length`]), still on its beats.
    pub fn follow(&mut self, bpm: f64, beat: f64, now: Instant) {
        self.linked = true;
        self.bpm = bpm.clamp(20.0, 999.0);
        // Session beats to one of ours: 8 at 999 bpm, ½ at 20.
        let per = self.bpm / fold_tempo(self.bpm);
        let back = (beat / per).rem_euclid(1.0) * self.beat_length();
        self.timing.anchor = now.checked_sub(Duration::from_secs_f64(back)).unwrap_or(now);
    }

    /// Back to the tapped tempo when the Link session has no peers left.
    pub fn unfollow(&mut self) {
        self.linked = false;
    }

    /// The last beat of the tempo at or before `now`.
    fn last_tempo_beat(&self, now: Instant) -> Instant {
        let len = self.beat_length();
        let since = now.saturating_duration_since(self.timing.anchor).as_secs_f64();
        let back = since - (since / len).floor() * len;
        now.checked_sub(Duration::from_secs_f64(back)).unwrap_or(now)
    }

    /// The bass, after a frame was analysed: a beat when it rises over the line
    /// (`bass` well over its running average `bass_att`), not too soon after the last.
    pub fn listen(&mut self, bass: f64, bass_att: f64, now: Instant) {
        let loud = bass > 1.3 && bass > bass_att * 1.15;
        let timing = &mut self.timing;
        if loud && !timing.loud && timing.heard.is_none_or(|t| secs(t, now) >= BEAT_GAP) {
            timing.heard = Some(now);
            if timing.heard_slow.is_none_or(|t| secs(t, now) >= REDUCED_FLASH_EVERY) {
                timing.heard_slow = Some(now);
            }
        }
        timing.loud = loud;
    }

    /// The last beat, by the chosen sync.
    fn last_beat(&self, now: Instant) -> Option<Instant> {
        match self.settings.sync {
            Sync::Tempo => Some(self.last_tempo_beat(now)),
            Sync::Audio => self.timing.heard,
        }
    }

    /// The scale on the preset clock (1 is the preset's own 30 steps a second;
    /// the picture still renders every refresh): the speed, 0.25–4, and 0 while
    /// frozen, coming back up over [`THAW`] once released.
    pub fn speed_now(&self, now: Instant) -> f64 {
        if self.settings.freeze {
            return 0.0;
        }
        let thaw = self.timing.thawed.map_or(1.0, |t| (secs(t, now) / THAW).min(1.0));
        self.settings.speed * thaw * thaw * (3.0 - 2.0 * thaw)
    }

    /// How long a blackout takes to fade in or out: as set, and with motion
    /// `reduced` at least [`REDUCED_BLACKOUT_FADE`].
    fn blackout_fade(&self, reduced: bool) -> f64 {
        let fade = self.settings.blackout_fade;
        if reduced { fade.max(REDUCED_BLACKOUT_FADE) } else { fade }
    }

    fn black_level(&self, now: Instant, reduced: bool) -> f64 {
        let (from, at) = self.timing.black_from;
        let to = if self.settings.blackout { 1.0 } else { 0.0 };
        let fade = self.blackout_fade(reduced);
        if fade <= 0.0 {
            return to;
        }
        let moved = secs(at, now) / fade;
        if to > from { (from + moved).min(to) } else { (from - moved).max(to) }
    }

    /// When the strobe's flash under way at `now` started, if one is. The sync's
    /// flashes come at most every [`flash_every`] ([`FLASH_EVERY`], or
    /// [`REDUCED_FLASH_EVERY`] with motion `reduced`): a fast tempo's skip beats
    /// (every 2nd, 4th…, so they stay on the beat), heard beats too close to the
    /// last one flashed are let go. (What moves the beat — taps, a new tempo,
    /// Link — is paced in [`Fx::master_with`].)
    fn flashing(&self, now: Instant, reduced: bool) -> Option<Instant> {
        match self.settings.sync {
            Sync::Tempo => {
                let mut every = self.beat_length() / self.settings.strobe_rate;
                let least = flash_every(reduced);
                if every < least {
                    every *= 2f64.powf((least / every).log2().ceil());
                }
                let since = now.saturating_duration_since(self.timing.anchor).as_secs_f64();
                let into = (since / every).floor() * every;
                (since - into < FLASH.min(every * 0.5)).then(|| self.timing.anchor + Duration::from_secs_f64(into))
            }
            Sync::Audio => {
                let beat = if reduced { self.timing.heard_slow } else { self.timing.heard };
                beat.filter(|&t| secs(t, now) < FLASH * 1.5)
            }
        }
    }

    /// The punch at `now`: held or dying away, and punch-on-beat's pulse. With
    /// motion `reduced`, the first is capped at [`REDUCED_PUNCH_MAX`], and the
    /// pulse at [`REDUCED_BEAT_PUNCH_MAX`] and to one every [`REDUCED_FLASH_EVERY`]
    /// at most (a beat too soon after the last one pulsed is let go).
    fn punch_level(&mut self, now: Instant, reduced: bool) -> f64 {
        let decay = |t: Instant| (-secs(t, now) / PUNCH_DECAY).exp();
        let mut level: f64 = if self.settings.punch { 1.0 } else { self.timing.kicked.map_or(0.0, decay) };
        if reduced {
            level = level.min(REDUCED_PUNCH_MAX);
        }
        if self.settings.punch_on_beat {
            if let Some(beat) = self.last_beat(now) {
                let pulse = if !reduced {
                    decay(beat)
                } else if paced(&mut self.timing.punch_shown, beat, REDUCED_FLASH_EVERY) {
                    decay(beat).min(REDUCED_BEAT_PUNCH_MAX)
                } else {
                    self.timing.punch_shown.map_or(0.0, decay).min(REDUCED_BEAT_PUNCH_MAX)
                };
                level = level.max(pulse);
            }
        }
        if level < 0.01 { 0.0 } else { level }
    }

    /// A preset was loaded: start the crossfade from the last one's picture.
    pub fn start_fade(&mut self, now: Instant) {
        self.timing.fading = Some(now);
    }

    /// The share of the outgoing preset still showing.
    fn fade_level(&self, now: Instant) -> f64 {
        let Some(at) = self.timing.fading else { return 0.0 };
        let transition = self.settings.transition;
        if transition <= 0.0 {
            return 0.0;
        }
        let x = (secs(at, now) / transition).min(1.0);
        1.0 - x * x * (3.0 - 2.0 * x)
    }

    /// The master pass at `now`, with motion reduced when the app's setting says so ([`crate::access::reduced`]).
    pub fn master(&mut self, now: Instant) -> Master {
        self.master_with(now, crate::access::reduced())
    }

    /// The master pass at `now`, asked every refresh with `now` going forward.
    /// The strobe's flashes always start at least [`FLASH_EVERY`] apart, whatever
    /// its rate, taps, tempo or Link session do. With motion `reduced`, its
    /// flashes and gaps are capped at [`REDUCED_FLASH_MAX`] and start at least
    /// [`REDUCED_FLASH_EVERY`] apart; a blackout fades over at least
    /// [`REDUCED_BLACKOUT_FADE`]; a punch is capped at [`REDUCED_PUNCH_MAX`], and
    /// punch-on-beat as [`Fx::punch_level`] says.
    pub fn master_with(&mut self, now: Instant, reduced: bool) -> Master {
        if reduced != self.timing.reduced {
            // A blackout under way carries on from where it is at the new fade.
            self.timing.black_from = (self.black_level(now, self.timing.reduced), now);
            self.timing.reduced = reduced;
        }
        let punch = self.punch_level(now, reduced);
        let mut black = self.black_level(now, reduced);
        let mut flash = 0.0;
        let s = &self.settings;
        if s.strobe {
            let on = match self.flashing(now, reduced) {
                Some(start) => paced(&mut self.timing.flash_shown, start, flash_every(reduced)),
                None => false,
            };
            let level = if reduced { s.strobe_intensity.min(REDUCED_FLASH_MAX) } else { s.strobe_intensity };
            match s.strobe_style {
                StrobeStyle::White if on => flash = level,
                StrobeStyle::Black if !on => black = black.max(level),
                _ => {}
            }
        }
        Master {
            brightness: s.brightness as f32,
            hue: s.hue as f32,
            invert: if s.invert { 1.0 } else { 0.0 },
            mirror: s.mirror,
            flash: flash as f32,
            black: black as f32,
            punch: punch as f32,
            fade: self.fade_level(now) as f32,
        }
    }

    /// The trails echo for the engine: how much of the frame before stays, per frame.
    pub fn echo(&self) -> f32 {
        let trails = self.settings.trails;
        if trails <= 0.0 { 0.0 } else { (0.75 + 0.23 * trails) as f32 }
    }

    pub fn view(&self, hold: bool, bars: u32) -> View {
        View { settings: self.settings.clone(), bpm: self.bpm, linked: self.linked, hold, bars }
    }
}

/// The tempo's file in [`settings::dir`].
const TEMPO_FILE: &str = "tempo.json";

/// Keep the tempo for next time. Failing to is not worth stopping the show for.
pub fn save_tempo(bpm: f64) {
    settings::save(TEMPO_FILE, tempo_text(bpm));
}

/// The tempo file's bytes, written by hand so they stay `{"bpm": 120.00}`.
fn tempo_text(bpm: f64) -> String {
    format!("{{\"bpm\": {bpm:.2}}}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tempo_file_keeps_its_bytes() {
        assert_eq!(tempo_text(120.0), "{\"bpm\": 120.00}\n");
        assert_eq!(tempo_text(128.456), "{\"bpm\": 128.46}\n");
    }

    /// `s` seconds into a test: every test's clock starts at the same moment, far
    /// enough ahead of now that going back a beat from it never underflows.
    fn t(s: f64) -> Instant {
        static START: std::sync::LazyLock<Instant> = std::sync::LazyLock::new(|| Instant::now() + Duration::from_secs(10));
        *START + Duration::from_secs_f64(s)
    }

    /// The effects at their defaults, with the beat falling at `t(0.0)`.
    fn fx() -> Fx {
        Fx::new(t(0.0))
    }

    fn act(fx: &mut Fx, action: FxAction, at: f64) {
        fx.apply(&action, t(at)).unwrap();
    }

    #[test]
    fn a_link_session_with_peers_keeps_the_beat() {
        let mut fx = fx();
        // Half way through a beat at 120 bpm: the last beat was 0.25 s ago.
        fx.follow(120.0, 7.5, t(0.0));
        assert!(fx.linked);
        assert_eq!(fx.bpm, 120.0);
        let last = fx.last_tempo_beat(t(0.0));
        assert!((t(0.0).duration_since(last).as_secs_f64() - 0.25).abs() < 1e-6);
        // Taps don't fight the session's tempo.
        assert!(!fx.apply(&FxAction::Tap, t(0.1)).unwrap());
        assert!(!fx.apply(&FxAction::Tap, t(0.4)).unwrap());
        assert_eq!(fx.bpm, 120.0);
        fx.unfollow();
        assert!(!fx.linked);
    }

    #[test]
    fn values_are_clamped_and_toggles_flip() {
        let mut fx = fx();
        act(&mut fx, FxAction::Speed { speed: 9.0 }, 0.0);
        assert_eq!(fx.settings.speed, 4.0);
        act(&mut fx, FxAction::Speed { speed: 0.0 }, 0.0);
        assert_eq!(fx.settings.speed, 0.25);
        assert_eq!(fx.apply(&FxAction::Brightness { value: f64::NAN }, t(0.0)), Err("brightness must be a number".into()));
        act(&mut fx, FxAction::Transition { seconds: 99.0 }, 0.0);
        assert_eq!(fx.settings.transition, 10.0);
        act(&mut fx, FxAction::Invert { on: None }, 0.0);
        assert!(fx.settings.invert);
        act(&mut fx, FxAction::Invert { on: Some(true) }, 0.0);
        assert!(fx.settings.invert);
        act(&mut fx, FxAction::Invert { on: None }, 0.0);
        assert!(!fx.settings.invert);
        for want in [Mirror::X, Mirror::Y, Mirror::Quad, Mirror::Off] {
            act(&mut fx, FxAction::Mirror { mode: None }, 0.0);
            assert_eq!(fx.settings.mirror, want);
        }
        act(&mut fx, FxAction::Bpm { bpm: 1000.0 }, 0.0);
        assert_eq!(fx.bpm, 240.0);
    }

    #[test]
    fn defaults_draw_the_picture_as_it_is() {
        let mut fx = fx();
        assert_eq!(fx.master(t(0.0)), Master::default());
        assert_eq!(fx.speed_now(t(0.0)), 1.0);
        assert_eq!(fx.echo(), 0.0);
    }

    #[test]
    fn freeze_holds_and_thaws_smoothly() {
        let mut fx = fx();
        act(&mut fx, FxAction::Speed { speed: 0.5 }, 0.0);
        act(&mut fx, FxAction::Freeze { on: Some(true) }, 0.0);
        assert_eq!(fx.speed_now(t(1.0)), 0.0);
        act(&mut fx, FxAction::Freeze { on: Some(false) }, 1.0);
        let half = fx.speed_now(t(1.0 + THAW / 2.0));
        assert!(half > 0.0 && half < 0.5, "{half}");
        assert_eq!(fx.speed_now(t(2.0)), 0.5);
    }

    #[test]
    fn blackout_fades_and_turns_back_from_where_it_is() {
        let mut fx = fx();
        act(&mut fx, FxAction::Blackout { on: None }, 0.0);
        assert_eq!(fx.master(t(0.0)).black, 1.0, "no fade: at once");
        act(&mut fx, FxAction::Blackout { on: Some(false) }, 0.0);
        act(&mut fx, FxAction::BlackoutFade { seconds: 2.0 }, 0.0);
        act(&mut fx, FxAction::Blackout { on: Some(true) }, 0.0);
        assert!((fx.master(t(1.0)).black - 0.5).abs() < 1e-3);
        act(&mut fx, FxAction::Blackout { on: Some(false) }, 1.0);
        assert!((fx.master(t(1.5)).black - 0.25).abs() < 1e-3);
        assert_eq!(fx.master(t(3.0)).black, 0.0);
    }

    #[test]
    fn taps_set_the_tempo_and_the_strobe_follows_it() {
        let mut fx = fx();
        for i in 0..4 {
            act(&mut fx, FxAction::Tap, i as f64 * 0.5);
        }
        assert!((fx.bpm - 120.0).abs() < 0.01, "{}", fx.bpm);
        // A long pause starts a new tempo rather than averaging it in.
        act(&mut fx, FxAction::Tap, 10.0);
        act(&mut fx, FxAction::Tap, 10.4);
        assert!((fx.bpm - 150.0).abs() < 0.01, "{}", fx.bpm);
        // The beat falls on the last tap: a flash there, none halfway to the next.
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        assert_eq!(fx.master(t(10.4 + 0.2)).flash, 0.0);
        assert_eq!(fx.master(t(10.4 + 0.4 * 3.0 + 0.01)).flash, 1.0);
        // Two flashes a beat: one halfway too.
        act(&mut fx, FxAction::StrobeRate { rate: 2.0 }, 0.0);
        assert_eq!(fx.master(t(11.6 + 0.2 + 0.01)).flash, 1.0);
        // Black gaps: the picture shows in the flash and black between.
        act(&mut fx, FxAction::StrobeStyle { style: StrobeStyle::Black }, 0.0);
        assert_eq!(fx.master(t(11.8 + 0.1)).black, 1.0);
        assert_eq!(fx.master(t(12.0 + 0.01)).black, 0.0);
        act(&mut fx, FxAction::Strobe { on: None }, 0.0);
        assert_eq!(fx.master(t(12.0 + 0.1)).black, 0.0);
    }

    #[test]
    fn heard_beats_drive_the_strobe_in_audio_sync() {
        let mut fx = fx();
        act(&mut fx, FxAction::Sync { source: Sync::Audio }, 0.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        assert_eq!(fx.master(t(0.0)).flash, 0.0, "nothing heard yet");
        fx.listen(1.0, 1.0, t(0.0));
        fx.listen(2.0, 1.0, t(1.0));
        assert_eq!(fx.master(t(1.01)).flash, 1.0);
        assert_eq!(fx.master(t(1.2)).flash, 0.0);
        // Staying loud is one beat, not one a frame.
        fx.listen(2.0, 1.0, t(1.5));
        assert_eq!(fx.master(t(1.51)).flash, 0.0);
    }

    #[test]
    fn punch_is_held_then_dies_away() {
        let mut fx = fx();
        act(&mut fx, FxAction::Punch { on: Some(true) }, 0.0);
        assert_eq!(fx.master(t(2.0)).punch, 1.0);
        act(&mut fx, FxAction::Punch { on: Some(false) }, 2.0);
        let p = fx.master(t(2.1)).punch;
        assert!(p > 0.2 && p < 1.0, "{p}");
        assert_eq!(fx.master(t(3.0)).punch, 0.0);
    }

    #[test]
    fn a_transition_fades_the_outgoing_picture_out() {
        let mut fx = fx();
        act(&mut fx, FxAction::Transition { seconds: 2.0 }, 0.0);
        fx.start_fade(t(0.0));
        assert_eq!(fx.master(t(0.0)).fade, 1.0);
        assert!((fx.master(t(1.0)).fade - 0.5).abs() < 1e-3);
        assert_eq!(fx.master(t(2.0)).fade, 0.0);
    }

    #[test]
    fn reset_keeps_the_tempo_and_settings() {
        let mut fx = fx();
        act(&mut fx, FxAction::Bpm { bpm: 128.0 }, 0.0);
        act(&mut fx, FxAction::Invert { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::Freeze { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::Sensitivity { value: 2.0 }, 0.0);
        act(&mut fx, FxAction::FxReset, 0.0);
        assert!(!fx.settings.invert && !fx.settings.freeze);
        assert_eq!((fx.bpm, fx.settings.sensitivity), (128.0, 2.0));
        assert_eq!(fx.master(t(0.0)), Master::default());
    }

    #[test]
    fn reset_settles_what_is_under_way_and_keeps_the_beat() {
        let mut fx = fx();
        // Under way at 1 s: a thaw, a punch dying away, a crossfade and a blackout
        // fading back out, with punch-on-beat on.
        act(&mut fx, FxAction::Freeze { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::Freeze { on: Some(false) }, 1.0);
        act(&mut fx, FxAction::Punch { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::Punch { on: Some(false) }, 1.0);
        act(&mut fx, FxAction::PunchOnBeat { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::BlackoutFade { seconds: 4.0 }, 0.0);
        act(&mut fx, FxAction::Blackout { on: Some(true) }, 0.0);
        act(&mut fx, FxAction::Blackout { on: Some(false) }, 1.0);
        fx.start_fade(t(1.0));
        // Two taps half a second apart, a beat heard just now, and a Link session.
        act(&mut fx, FxAction::Tap, 0.0);
        act(&mut fx, FxAction::Tap, 0.5);
        fx.listen(2.0, 1.0, t(1.0));
        fx.follow(120.0, 0.0, t(0.5));

        act(&mut fx, FxAction::FxReset, 1.0);
        assert!(!fx.settings.punch_on_beat);
        assert_eq!(fx.speed_now(t(1.0)), 1.0, "no thaw left");
        assert_eq!(fx.master(t(1.0)), Master::default(), "no punch, fade or blackout left");
        // A Link session's tempo survives a reset.
        assert!(fx.linked);

        // The heard beat stays: an audio strobe flashes on it.
        act(&mut fx, FxAction::Sync { source: Sync::Audio }, 1.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 1.0);
        assert_eq!(fx.master(t(1.01)).flash, 1.0);
        // The taps stay: a third one averages them in (gaps 0.5 and 1.0: 80 bpm).
        fx.unfollow();
        assert!(fx.apply(&FxAction::Tap, t(1.5)).unwrap());
        assert!((fx.bpm - 80.0).abs() < 0.01, "{}", fx.bpm);
    }

    #[test]
    fn intensity_moves_three_settings_on_a_capped_curve() {
        let mut fx = fx();
        // The middle is the picture as drawn.
        act(&mut fx, FxAction::Intensity { value: 0.5 }, 0.0);
        assert!((fx.settings.sensitivity - 1.0).abs() < 1e-9);
        assert!((fx.settings.brightness - 1.0).abs() < 1e-9);
        // Out of range is clamped; the top stays short of white.
        act(&mut fx, FxAction::Intensity { value: 7.0 }, 0.0);
        assert_eq!((fx.settings.sensitivity, fx.settings.brightness, fx.settings.strobe_intensity), (2.0, INTENSITY_BRIGHTNESS_MAX, INTENSITY_STROBE_MAX));
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let m = fx.master(t(0.0));
        assert!(m.flash < 1.0 && m.brightness < 1.25, "{m:?}");
        act(&mut fx, FxAction::Intensity { value: -1.0 }, 0.0);
        assert!((fx.settings.sensitivity - 0.5).abs() < 1e-9 && (fx.settings.brightness - 0.8).abs() < 1e-9 && (fx.settings.strobe_intensity - 0.35).abs() < 1e-9);
        assert_eq!(fx.apply(&FxAction::Intensity { value: f64::NAN }, t(0.0)), Err("intensity must be a number".into()));
        // Every step up raises all three.
        let mut last = intensity(0.0);
        for i in 1..=10 {
            let now = intensity(i as f64 / 10.0);
            assert!(now.sensitivity > last.sensitivity && now.brightness > last.brightness && now.strobe > last.strobe);
            last = now;
        }
        let read = serde_json::from_str::<FxAction>(r#"{"kind":"intensity","value":0.25}"#).unwrap();
        assert_eq!(read, FxAction::Intensity { value: 0.25 });
    }

    #[test]
    fn reduced_motion_caps_the_strobe_and_punch_under_what_intensity_reaches() {
        // The cap is under the whole Intensity slider's strobe range, not just its top.
        assert!(REDUCED_FLASH_MAX < intensity(0.0).strobe && REDUCED_FLASH_MAX < INTENSITY_STROBE_MAX);
        let mut fx = fx();
        // The strongest the strobe goes: full level, 4 flashes a beat at 240 bpm (16 a second).
        act(&mut fx, FxAction::Bpm { bpm: 240.0 }, 0.0);
        act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
        act(&mut fx, FxAction::StrobeIntensity { value: 1.0 }, 0.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let anchor = fx.timing.anchor;
        let at = |s: f64| anchor + Duration::from_secs_f64(s);
        // Sampled every 5 ms over two seconds: count the flashes and find the brightest.
        let flashes = |fx: &mut Fx, reduced: bool| {
            let (mut count, mut peak, mut was) = (0, 0f32, false);
            for i in 0..400 {
                let f = fx.master_with(at(i as f64 * 0.005), reduced).flash;
                peak = peak.max(f);
                if f > 0.0 && !was {
                    count += 1;
                }
                was = f > 0.0;
            }
            (count, peak)
        };
        assert_eq!(flashes(&mut fx, false), (16, 1.0), "unreduced: as set, up to eight a second");
        // From the top again, as if the strobe had just been turned on.
        fx.timing.flash_shown = None;
        // Still on the beat: the anchor's beat flashes.
        assert!(fx.master_with(at(0.01), true).flash > 0.0);
        let (count, peak) = flashes(&mut fx, true);
        assert!(count <= 4, "at most two a second: {count}");
        assert!(count > 0 && (peak as f64 - REDUCED_FLASH_MAX).abs() < 1e-6, "{count} {peak}");
        // Black gaps are capped the same way.
        act(&mut fx, FxAction::StrobeStyle { style: StrobeStyle::Black }, 0.0);
        let gap = fx.master_with(at(0.1), true).black;
        assert!((gap as f64 - REDUCED_FLASH_MAX).abs() < 1e-6, "{gap}");
        assert_eq!(fx.master_with(at(0.1), false).black, 1.0);
        // Intensity's top doesn't get past the cap either.
        act(&mut fx, FxAction::StrobeStyle { style: StrobeStyle::White }, 0.0);
        act(&mut fx, FxAction::Intensity { value: 1.0 }, 0.0);
        assert!(fx.master_with(at(0.01), true).flash as f64 <= REDUCED_FLASH_MAX + 1e-6);
        // A held punch is halved.
        act(&mut fx, FxAction::Punch { on: Some(true) }, 0.0);
        assert_eq!(fx.master_with(at(0.3), false).punch, 1.0);
        assert_eq!(fx.master_with(at(0.3), true).punch as f64, REDUCED_PUNCH_MAX);
    }

    /// Runs `fx` from `t(0)` for `seconds`, a refresh every 5 ms, calling `meddle`
    /// with each refresh's time first (to tap, set a tempo…): when each strobe
    /// flash and each punch pulse began, and the strongest of each.
    fn run(fx: &mut Fx, seconds: f64, reduced: bool, mut meddle: impl FnMut(&mut Fx, f64)) -> (Vec<f64>, f32, Vec<f64>, f32) {
        let (mut flashes, mut flash_peak, mut lit) = (Vec::new(), 0f32, false);
        let (mut pulses, mut punch_peak, mut last) = (Vec::new(), 0f32, 0f32);
        for i in 0..(seconds / 0.005) as usize {
            let s = i as f64 * 0.005;
            meddle(fx, s);
            let m = fx.master_with(t(s), reduced);
            if m.flash > 0.0 && !lit {
                flashes.push(s);
            }
            lit = m.flash > 0.0;
            flash_peak = flash_peak.max(m.flash);
            // A pulse begins where the punch jumps up.
            if m.punch > last + 0.05 {
                pulses.push(s);
            }
            last = m.punch;
            punch_peak = punch_peak.max(m.punch);
        }
        (flashes, flash_peak, pulses, punch_peak)
    }

    /// How much sooner than [`REDUCED_FLASH_EVERY`] two starts [`run`] saw may
    /// look: a flash starting between refreshes is seen at the next one (5 ms),
    /// plus the rounding [`paced`] allows.
    const SAMPLED: f64 = 0.006;

    /// The shortest time between two of `starts`.
    fn closest(starts: &[f64]) -> f64 {
        starts.windows(2).map(|w| w[1] - w[0]).fold(f64::INFINITY, f64::min)
    }

    #[test]
    fn reduced_motion_keeps_rapid_taps_to_two_flashes_a_second() {
        let tapping = |fx: &mut Fx, s: f64| {
            // Seven taps a second: each one puts the beat (and a flash) on itself.
            if (s * 1000.0).round() as u64 % 140 == 0 {
                act(fx, FxAction::Tap, s);
            }
        };
        let mut fx = fx();
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let (flashes, ..) = run(&mut fx, 4.0, false, tapping);
        assert!(flashes.len() >= 20, "unreduced, every tap flashes: {flashes:?}");
        let mut fx = self::fx();
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let (flashes, peak, ..) = run(&mut fx, 4.0, true, tapping);
        assert!(flashes.len() >= 4, "it still flashes: {flashes:?}");
        assert!(closest(&flashes) >= REDUCED_FLASH_EVERY - SAMPLED, "{flashes:?}");
        assert!(peak as f64 <= REDUCED_FLASH_MAX + 1e-6);
    }

    #[test]
    fn reduced_motion_keeps_a_tempo_sweep_and_link_to_two_flashes_a_second() {
        // The tempo stepped up every 30 ms from 40 to 240 bpm, four flashes a beat.
        let sweep = |fx: &mut Fx, s: f64| {
            if (s * 1000.0).round() as u64 % 30 == 0 {
                act(fx, FxAction::Bpm { bpm: 40.0 + 200.0 * (s / 3.0).min(1.0) }, s);
            }
        };
        // A Link session whose phase jumps about every 20 ms.
        let link = |fx: &mut Fx, s: f64| {
            if (s * 1000.0).round() as u64 % 20 == 0 {
                fx.follow(180.0, (s * 7.3).fract(), t(s));
            }
        };
        for (name, meddle) in [("sweep", &sweep as &dyn Fn(&mut Fx, f64)), ("link", &link)] {
            let mut fx = fx();
            act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
            act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
            let (fast, ..) = run(&mut fx, 4.0, false, |fx, s| meddle(fx, s));
            assert!(closest(&fast) < 0.3, "{name} unreduced flashes faster: {fast:?}");
            let mut fx = self::fx();
            act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
            act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
            let (flashes, ..) = run(&mut fx, 4.0, true, |fx, s| meddle(fx, s));
            assert!(flashes.len() >= 3, "{name} still flashes: {flashes:?}");
            assert!(closest(&flashes) >= REDUCED_FLASH_EVERY - SAMPLED, "{name}: {flashes:?}");
        }
    }

    #[test]
    fn reduced_motion_paces_and_softens_punch_on_beat() {
        let tapping = |fx: &mut Fx, s: f64| {
            if s >= 2.0 && (s * 1000.0).round() as u64 % 150 == 0 {
                act(fx, FxAction::Tap, s);
            }
        };
        // 240 bpm (four beats a second), then taps over six a second.
        let mut fx = fx();
        act(&mut fx, FxAction::Bpm { bpm: 240.0 }, 0.0);
        act(&mut fx, FxAction::PunchOnBeat { on: Some(true) }, 0.0);
        let (_, _, pulses, peak) = run(&mut fx, 4.0, false, tapping);
        assert!(closest(&pulses) < 0.3 && peak > 0.9, "unreduced: every beat, full: {pulses:?} {peak}");
        let mut fx = self::fx();
        act(&mut fx, FxAction::Bpm { bpm: 240.0 }, 0.0);
        act(&mut fx, FxAction::PunchOnBeat { on: Some(true) }, 0.0);
        let (_, _, pulses, peak) = run(&mut fx, 4.0, true, tapping);
        assert!(pulses.len() >= 4, "it still pulses: {pulses:?}");
        assert!(closest(&pulses) >= REDUCED_FLASH_EVERY - SAMPLED, "at most two a second: {pulses:?}");
        assert!((peak as f64 - REDUCED_BEAT_PUNCH_MAX).abs() < 1e-6, "{peak}");
    }

    #[test]
    fn a_flash_is_paced_by_when_the_last_one_started() {
        let mut shown = None;
        let every = REDUCED_FLASH_EVERY;
        assert!(paced(&mut shown, t(1.0), every), "the first");
        assert!(paced(&mut shown, t(1.0), every), "the same one, read again");
        assert!(!paced(&mut shown, t(1.2), every), "too soon");
        assert!(!paced(&mut shown, t(0.8), every), "earlier than the last");
        assert!(paced(&mut shown, t(1.5), every), "half a second on");
        assert_eq!(shown, Some(t(1.5)));
        // Unreduced, an eighth of a second is enough.
        assert!(!paced(&mut shown, t(1.6), FLASH_EVERY), "too soon");
        assert!(paced(&mut shown, t(1.625), FLASH_EVERY));
    }

    #[test]
    fn the_strobe_never_flashes_more_than_eight_a_second() {
        // 240 bpm, four flashes a beat: sixteen a second as set, eight on the beat.
        let mut fx = fx();
        act(&mut fx, FxAction::Bpm { bpm: 240.0 }, 0.0);
        act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let (flashes, peak, ..) = run(&mut fx, 2.0, false, |_, _| {});
        assert_eq!(flashes.len(), 16, "{flashes:?}");
        assert!(flashes.iter().all(|s| (s / FLASH_EVERY - (s / FLASH_EVERY).round()).abs() < 0.05), "on the beat: {flashes:?}");
        assert_eq!(peak, 1.0, "the level is as set");

        // A Link session at 999 bpm (about 66 flashes a second at four a beat),
        // followed as its frames come, ten a second.
        let link = |fx: &mut Fx, s: f64| {
            if (s * 1000.0).round() as u64 % 100 == 0 {
                fx.follow(999.0, s * 999.0 / 60.0, t(s));
            }
        };
        // Taps twenty a second, each putting the beat (and a flash) on itself.
        let tapping = |fx: &mut Fx, s: f64| {
            if (s * 1000.0).round() as u64 % 50 == 0 {
                act(fx, FxAction::Tap, s);
            }
        };
        // A Link session whose phase jumps about every 20 ms.
        let jumpy = |fx: &mut Fx, s: f64| {
            if (s * 1000.0).round() as u64 % 20 == 0 {
                fx.follow(999.0, s * 37.3, t(s));
            }
        };
        for (name, meddle) in [("link", &link as &dyn Fn(&mut Fx, f64)), ("taps", &tapping), ("jumpy link", &jumpy)] {
            for sync in [Sync::Tempo, Sync::Audio] {
                let mut fx = self::fx();
                act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
                act(&mut fx, FxAction::Sync { source: sync }, 0.0);
                act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
                let (flashes, ..) = run(&mut fx, 4.0, false, |fx, s| {
                    meddle(fx, s);
                    // Bass hits every frame it can, for audio sync.
                    fx.listen(if (s * 1000.0).round() as u64 % 10 == 0 { 2.0 } else { 0.0 }, 1.0, t(s));
                });
                if sync == Sync::Tempo {
                    assert!(flashes.len() >= 8, "{name} still flashes: {flashes:?}");
                }
                assert!(closest(&flashes) >= FLASH_EVERY - SAMPLED, "{name} {sync:?}: {flashes:?}");
                assert!(flashes.len() as f64 <= 4.0 * 8.0 + 1.0, "{name} {sync:?}: {} in 4 s", flashes.len());
            }
        }
    }

    #[test]
    fn link_jitter_does_not_drop_flashes_due_one_interval_on() {
        // 120 bpm, four flashes a beat: eight a second, right at the cap. Link's
        // frames, ten a second, re-anchor the beat a few ms off each time.
        let mut fx = fx();
        act(&mut fx, FxAction::StrobeRate { rate: 4.0 }, 0.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        let (flashes, ..) = run(&mut fx, 4.0, false, |fx, s| {
            let ms = (s * 1000.0).round() as u64;
            if ms % 100 == 0 {
                let jitter = [0.002, -0.002, 0.001, -0.001][(ms / 100 % 4) as usize];
                fx.follow(120.0, (s + jitter) * 2.0, t(s));
            }
        });
        assert!(flashes.len() >= 31, "eight a second: {} in 4 s {flashes:?}", flashes.len());
        assert!(flashes.len() <= 33, "{} in 4 s", flashes.len());
    }

    #[test]
    fn link_tempo_keeps_time_in_range_on_the_sessions_beats() {
        let mut fx = fx();
        // 480 bpm keeps time at 240, on every other session beat: at beat 6.5,
        // the last of ours was beat 6, half a session beat (62.5 ms) ago.
        fx.follow(480.0, 6.5, t(0.0));
        assert_eq!(fx.bpm, 480.0, "the session's tempo is shown");
        assert!((fx.beat_length() - 0.25).abs() < 1e-9);
        assert!((t(0.0).duration_since(fx.last_tempo_beat(t(0.0))).as_secs_f64() - 0.0625).abs() < 1e-6);
        // At beat 7.5 it was beat 6 too: 1.5 session beats ago.
        fx.follow(480.0, 7.5, t(0.0));
        assert!((t(0.0).duration_since(fx.last_tempo_beat(t(0.0))).as_secs_f64() - 0.1875).abs() < 1e-6);
        // 999 bpm is a quarter of it; 20 bpm is doubled, on and between its beats.
        fx.follow(999.0, 0.0, t(0.0));
        assert!((fx.beat_length() - 60.0 / 124.875).abs() < 1e-9);
        fx.follow(20.0, 0.25, t(0.0));
        assert!((fx.beat_length() - 1.5).abs() < 1e-9);
        assert!((t(0.0).duration_since(fx.last_tempo_beat(t(0.0))).as_secs_f64() - 0.75).abs() < 1e-6);
        for bpm in [20.0, 39.0, 40.0, 120.0, 240.0, 241.0, 500.0, 999.0, 1e6] {
            let folded = fold_tempo(bpm);
            assert!((TEMPO_MIN..=TEMPO_MAX).contains(&folded), "{bpm} → {folded}");
        }
        // Left by the session at 999, the tempo keeps time in range too.
        fx.follow(999.0, 0.0, t(0.0));
        fx.unfollow();
        assert!(fx.beat_length() >= 60.0 / TEMPO_MAX);
    }

    #[test]
    fn reduced_motion_fades_a_blackout_whatever_its_fade() {
        let mut fx = fx();
        assert_eq!(fx.blackout_fade(false), 0.0, "no fade set");
        fx.master_with(t(0.0), true);
        act(&mut fx, FxAction::Blackout { on: Some(true) }, 0.0);
        assert_eq!(fx.master_with(t(0.0), true).black, 0.0, "not an instant cut");
        let half = fx.master_with(t(REDUCED_BLACKOUT_FADE / 2.0), true).black;
        assert!((half - 0.5).abs() < 1e-3, "{half}");
        assert_eq!(fx.master_with(t(REDUCED_BLACKOUT_FADE), true).black, 1.0);
        // Pressed again and again, it only ever moves at that pace.
        for i in 0..20 {
            let s = 1.0 + i as f64 * 0.03;
            act(&mut fx, FxAction::Blackout { on: None }, s);
            let a = fx.master_with(t(s), true).black;
            let b = fx.master_with(t(s + 0.03), true).black;
            assert!((b - a).abs() <= (0.03 / REDUCED_BLACKOUT_FADE) as f32 + 1e-3, "{a} → {b}");
        }
        // A longer fade set is kept.
        act(&mut fx, FxAction::Blackout { on: Some(false) }, 2.0);
        act(&mut fx, FxAction::BlackoutFade { seconds: 2.0 }, 10.0);
        act(&mut fx, FxAction::Blackout { on: Some(true) }, 10.0);
        assert!((fx.master_with(t(11.0), true).black - 0.5).abs() < 1e-3);
        // Off, it cuts at once as before.
        let mut fx = self::fx();
        fx.master_with(t(0.0), false);
        act(&mut fx, FxAction::Blackout { on: Some(true) }, 0.0);
        assert_eq!(fx.master_with(t(0.0), false).black, 1.0);
        // Turned on with the blackout already full, it stays full.
        assert_eq!(fx.master_with(t(1.0), true).black, 1.0);
    }

    #[test]
    fn reduced_motion_lets_heard_beats_too_close_together_go() {
        let mut fx = fx();
        act(&mut fx, FxAction::Sync { source: Sync::Audio }, 0.0);
        act(&mut fx, FxAction::Strobe { on: Some(true) }, 0.0);
        // Beats heard 0.3 s apart (over three a second), each after a quiet moment:
        // reduced, the 1st and 3rd flash (0.6 s apart), the 2nd and 4th are let go.
        let mut flashed = Vec::new();
        for i in 0..4 {
            let beat = 1.0 + i as f64 * 0.3;
            fx.listen(1.0, 1.0, t(beat - 0.1));
            fx.listen(2.0, 1.0, t(beat));
            assert_eq!(fx.master_with(t(beat + 0.01), false).flash, 1.0, "unreduced: every beat");
            flashed.push(fx.master_with(t(beat + 0.01), true).flash as f64);
        }
        assert_eq!(flashed, [REDUCED_FLASH_MAX, 0.0, REDUCED_FLASH_MAX, 0.0]);
    }

    #[test]
    fn actions_read_as_json() {
        let read = |s: &str| serde_json::from_str::<FxAction>(s).unwrap();
        assert_eq!(read(r#"{"kind":"strobe","on":null}"#), FxAction::Strobe { on: None });
        assert_eq!(read(r#"{"kind":"mirror","mode":"quad"}"#), FxAction::Mirror { mode: Some(Mirror::Quad) });
        assert_eq!(read(r#"{"kind":"strobe_style","style":"black"}"#), FxAction::StrobeStyle { style: StrobeStyle::Black });
        assert_eq!(read(r#"{"kind":"fx_reset"}"#), FxAction::FxReset);
        for (mode, json) in [(Mirror::Off, "off"), (Mirror::X, "x"), (Mirror::Y, "y"), (Mirror::Quad, "quad")] {
            assert_eq!(serde_json::to_value(mode).unwrap(), json);
        }
    }

    /// The fields of `interface Fx` in the page's `fx.ts`, which reads the `fx` event.
    fn page_fields() -> Vec<String> {
        let ts = include_str!("../../src/fx.ts");
        let body = ts.split("export interface Fx {").nth(1).and_then(|s| s.split("\n}").next()).expect("interface Fx in fx.ts");
        body.lines().map(str::trim).filter(|l| !l.starts_with("/*") && !l.starts_with('*') && !l.starts_with("//")).filter_map(|l| l.split_once(':').map(|(name, _)| name.trim().to_string())).collect()
    }

    #[test]
    fn the_view_is_flat_and_has_the_fields_the_page_reads() {
        let view = serde_json::to_value(fx().view(true, 4)).unwrap();
        let mut keys: Vec<String> = view.as_object().unwrap().keys().cloned().collect();
        let mut want = page_fields();
        keys.sort();
        want.sort();
        assert_eq!(want.len(), 22, "{want:?}");
        assert_eq!(keys, want);
        assert!(view.as_object().unwrap().values().all(|v| !v.is_object()), "flat: {view}");
        assert_eq!((view["mirror"].as_str(), view["hold"].as_bool(), view["bars"].as_u64()), (Some("off"), Some(true), Some(4)));
    }
}
