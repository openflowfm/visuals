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
            timing: Timing { thawed: None, fading: None, black_from: (0.0, now), kicked: None, anchor: now, taps: Vec::new(), heard: None, loud: false },
        }
    }

    /// With the tempo kept from last time, if there is one.
    pub fn restored() -> Fx {
        let mut fx = Fx::new(Instant::now());
        if let Some(bpm) = settings::load::<serde_json::Value>(TEMPO_FILE).and_then(|v| v["bpm"].as_f64()) {
            fx.bpm = bpm.clamp(40.0, 240.0);
        }
        fx
    }

    /// Do `action` at `now`. Returns whether the tempo changed (to be saved).
    pub fn apply(&mut self, action: &FxAction, now: Instant) -> Result<bool, String> {
        let flip = |on: &Option<bool>, was: bool| on.unwrap_or(!was);
        let level = self.black_level(now);
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
                self.bpm = clamped(*bpm, 40.0, 240.0, "bpm")?;
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
        self.bpm = (60.0 / gap).clamp(40.0, 240.0);
        true
    }

    fn beat_length(&self) -> f64 {
        60.0 / self.bpm
    }

    /// Take the tempo and the beat from a Link session with peers: `into_beat` is
    /// how far into the current beat it is (0–1). While followed, taps don't set the
    /// tempo; the band's clock wins. Not saved — it is the session's, not ours.
    pub fn follow(&mut self, bpm: f64, into_beat: f64, now: Instant) {
        self.linked = true;
        self.bpm = bpm.clamp(20.0, 999.0);
        let back = into_beat.rem_euclid(1.0) * self.beat_length();
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

    fn black_level(&self, now: Instant) -> f64 {
        let (from, at) = self.timing.black_from;
        let to = if self.settings.blackout { 1.0 } else { 0.0 };
        if self.settings.blackout_fade <= 0.0 {
            return to;
        }
        let moved = secs(at, now) / self.settings.blackout_fade;
        if to > from { (from + moved).min(to) } else { (from - moved).max(to) }
    }

    /// Whether the strobe is in a flash at `now`.
    fn flashing(&self, now: Instant) -> bool {
        match self.settings.sync {
            Sync::Tempo => {
                let every = self.beat_length() / self.settings.strobe_rate;
                let since = now.saturating_duration_since(self.timing.anchor).as_secs_f64();
                let phase = since - (since / every).floor() * every;
                phase < FLASH.min(every * 0.5)
            }
            Sync::Audio => self.timing.heard.is_some_and(|t| secs(t, now) < FLASH * 1.5),
        }
    }

    fn punch_level(&self, now: Instant) -> f64 {
        let decay = |t: Instant| (-secs(t, now) / PUNCH_DECAY).exp();
        let mut level: f64 = if self.settings.punch { 1.0 } else { self.timing.kicked.map_or(0.0, decay) };
        if self.settings.punch_on_beat {
            if let Some(beat) = self.last_beat(now) {
                level = level.max(decay(beat));
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

    /// The master pass at `now`.
    pub fn master(&self, now: Instant) -> Master {
        let s = &self.settings;
        let mut black = self.black_level(now);
        let mut flash = 0.0;
        if s.strobe {
            let on = self.flashing(now);
            match s.strobe_style {
                StrobeStyle::White if on => flash = s.strobe_intensity,
                StrobeStyle::Black if !on => black = black.max(s.strobe_intensity),
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
            punch: self.punch_level(now) as f32,
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
        let fx = fx();
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
        assert_eq!(fx.master(t(10.4 + 0.4 * 3.0 + 0.01)).flash, 1.0);
        assert_eq!(fx.master(t(10.4 + 0.2)).flash, 0.0);
        // Two flashes a beat: one halfway too.
        act(&mut fx, FxAction::StrobeRate { rate: 2.0 }, 0.0);
        assert_eq!(fx.master(t(10.4 + 0.2 + 0.01)).flash, 1.0);
        // Black gaps: the picture shows in the flash and black between.
        act(&mut fx, FxAction::StrobeStyle { style: StrobeStyle::Black }, 0.0);
        assert_eq!(fx.master(t(10.4 + 0.1)).black, 1.0);
        assert_eq!(fx.master(t(10.4 + 0.01)).black, 0.0);
        act(&mut fx, FxAction::Strobe { on: None }, 0.0);
        assert_eq!(fx.master(t(10.4 + 0.1)).black, 0.0);
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
