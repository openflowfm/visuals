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

use engine::fx::{Master, Mirror as EngineMirror};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mirror {
    #[default]
    Off,
    X,
    Y,
    Quad,
}

impl Mirror {
    fn next(self) -> Mirror {
        match self {
            Mirror::Off => Mirror::X,
            Mirror::X => Mirror::Y,
            Mirror::Y => Mirror::Quad,
            Mirror::Quad => Mirror::Off,
        }
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
    Speed { speed: f64 },
    Freeze { on: Option<bool> },
    Transition { seconds: f64 },
    Strobe { on: Option<bool> },
    StrobeRate { rate: f64 },
    StrobeIntensity { value: f64 },
    StrobeStyle { style: StrobeStyle },
    Sync { source: Sync },
    Blackout { on: Option<bool> },
    BlackoutFade { seconds: f64 },
    Punch { on: Option<bool> },
    PunchOnBeat { on: Option<bool> },
    Brightness { value: f64 },
    Hue { value: f64 },
    Invert { on: Option<bool> },
    /// `null` steps off → x → y → quad → off.
    Mirror { mode: Option<Mirror> },
    Trails { value: f64 },
    Sensitivity { value: f64 },
    Tap,
    Bpm { bpm: f64 },
    FxReset,
}

/// The effects as the page sees them: the `fx` event, and `fx_state`. `hold` and
/// `bars` are the deck's, carried here so one event has the whole panel.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct View {
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
    pub bpm: f64,
    /// The tempo is a Link session's, not the taps'.
    pub linked: bool,
    pub hold: bool,
    pub bars: u32,
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
    pub speed: f64,
    pub freeze: bool,
    /// When freeze was last released.
    thawed: Option<Instant>,
    pub transition: f64,
    /// The crossfade from the last preset: when it started.
    fading: Option<Instant>,
    pub strobe: bool,
    pub strobe_rate: f64,
    pub strobe_intensity: f64,
    pub strobe_style: StrobeStyle,
    pub sync: Sync,
    pub blackout: bool,
    pub blackout_fade: f64,
    /// The blackout level when it last changed direction, and when.
    black_from: (f64, Instant),
    pub punch: bool,
    /// When the last punch was released or kicked.
    kicked: Option<Instant>,
    pub punch_on_beat: bool,
    pub brightness: f64,
    pub hue: f64,
    pub invert: bool,
    pub mirror: Mirror,
    pub trails: f64,
    pub sensitivity: f64,
    pub bpm: f64,
    /// Where the tempo's beats fall: the last tap.
    anchor: Instant,
    taps: Vec<Instant>,
    /// The last beat heard in the bass, and whether the bass is above the line now.
    heard: Option<Instant>,
    loud: bool,
    /// The tempo is a Link session's ([`Fx::follow`]), not the taps'.
    pub linked: bool,
}

impl Default for Fx {
    fn default() -> Self {
        let now = Instant::now();
        Fx {
            speed: 1.0,
            freeze: false,
            thawed: None,
            transition: 2.0,
            fading: None,
            strobe: false,
            strobe_rate: 1.0,
            strobe_intensity: 1.0,
            strobe_style: StrobeStyle::White,
            sync: Sync::Tempo,
            blackout: false,
            blackout_fade: 0.0,
            black_from: (0.0, now),
            punch: false,
            kicked: None,
            punch_on_beat: false,
            brightness: 1.0,
            hue: 0.0,
            invert: false,
            mirror: Mirror::Off,
            trails: 0.0,
            sensitivity: 1.0,
            bpm: 120.0,
            anchor: now,
            taps: Vec::new(),
            heard: None,
            loud: false,
            linked: false,
        }
    }
}

/// A finite number, clamped; `None` for NaN or infinity.
fn clamped(v: f64, lo: f64, hi: f64, what: &str) -> Result<f64, String> {
    if v.is_finite() { Ok(v.clamp(lo, hi)) } else { Err(format!("{what} must be a number")) }
}

fn secs(a: Instant, b: Instant) -> f64 {
    b.saturating_duration_since(a).as_secs_f64()
}

impl Fx {
    /// With the tempo kept from last time, if there is one.
    pub fn restored() -> Fx {
        let mut fx = Fx::default();
        if let Some(bpm) = std::fs::read_to_string(tempo_file()).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v| v["bpm"].as_f64()) {
            fx.bpm = bpm.clamp(40.0, 240.0);
        }
        fx
    }

    /// Do `action` at `now`. Returns whether the tempo changed (to be saved).
    pub fn apply(&mut self, action: &FxAction, now: Instant) -> Result<bool, String> {
        let flip = |on: &Option<bool>, was: bool| on.unwrap_or(!was);
        match action {
            FxAction::Speed { speed } => self.speed = clamped(*speed, 0.25, 4.0, "speed")?,
            FxAction::Freeze { on } => {
                let to = flip(on, self.freeze);
                if self.freeze && !to {
                    self.thawed = Some(now);
                }
                self.freeze = to;
            }
            FxAction::Transition { seconds } => self.transition = clamped(*seconds, 0.0, 10.0, "seconds")?,
            FxAction::Strobe { on } => self.strobe = flip(on, self.strobe),
            FxAction::StrobeRate { rate } => self.strobe_rate = clamped(*rate, 0.25, 4.0, "rate")?,
            FxAction::StrobeIntensity { value } => self.strobe_intensity = clamped(*value, 0.0, 1.0, "intensity")?,
            FxAction::StrobeStyle { style } => self.strobe_style = *style,
            FxAction::Sync { source } => self.sync = *source,
            FxAction::Blackout { on } => {
                let to = flip(on, self.blackout);
                if to != self.blackout {
                    self.black_from = (self.black_level(now), now);
                }
                self.blackout = to;
            }
            FxAction::BlackoutFade { seconds } => {
                // A fade already under way carries on at the new rate from where it is.
                self.black_from = (self.black_level(now), now);
                self.blackout_fade = clamped(*seconds, 0.0, 10.0, "seconds")?;
            }
            FxAction::Punch { on } => {
                let to = flip(on, self.punch);
                // Pressed: full at once; released: dies away from there.
                if to != self.punch {
                    self.kicked = Some(now);
                }
                self.punch = to;
            }
            FxAction::PunchOnBeat { on } => self.punch_on_beat = flip(on, self.punch_on_beat),
            FxAction::Brightness { value } => self.brightness = clamped(*value, 0.0, 2.0, "brightness")?,
            FxAction::Hue { value } => self.hue = clamped(*value, 0.0, 1.0, "hue")?,
            FxAction::Invert { on } => self.invert = flip(on, self.invert),
            FxAction::Mirror { mode } => self.mirror = mode.unwrap_or_else(|| self.mirror.next()),
            FxAction::Trails { value } => self.trails = clamped(*value, 0.0, 1.0, "trails")?,
            FxAction::Sensitivity { value } => self.sensitivity = clamped(*value, 0.25, 4.0, "sensitivity")?,
            FxAction::Tap => return Ok(self.tap(now)),
            FxAction::Bpm { bpm } => {
                self.bpm = clamped(*bpm, 40.0, 240.0, "bpm")?;
                return Ok(true);
            }
            FxAction::FxReset => {
                let keep = Fx {
                    transition: self.transition,
                    strobe_rate: self.strobe_rate,
                    strobe_intensity: self.strobe_intensity,
                    strobe_style: self.strobe_style,
                    sync: self.sync,
                    blackout_fade: self.blackout_fade,
                    punch_on_beat: false,
                    sensitivity: self.sensitivity,
                    bpm: self.bpm,
                    anchor: self.anchor,
                    taps: std::mem::take(&mut self.taps),
                    heard: self.heard,
                    loud: self.loud,
                    black_from: (0.0, now),
                    ..Fx::default()
                };
                *self = keep;
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
        if self.taps.last().is_some_and(|&t| secs(t, now) > TAP_GAP) {
            self.taps.clear();
        }
        self.taps.push(now);
        if self.taps.len() > 9 {
            self.taps.remove(0);
        }
        self.anchor = now;
        if self.taps.len() < 2 {
            return false;
        }
        let gap = secs(self.taps[0], now) / (self.taps.len() - 1) as f64;
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
        self.anchor = now.checked_sub(Duration::from_secs_f64(back)).unwrap_or(now);
    }

    /// Back to the tapped tempo when the Link session has no peers left.
    pub fn unfollow(&mut self) {
        self.linked = false;
    }

    /// The last beat of the tempo at or before `now`.
    fn last_tempo_beat(&self, now: Instant) -> Instant {
        let len = self.beat_length();
        let since = now.saturating_duration_since(self.anchor).as_secs_f64();
        let back = since - (since / len).floor() * len;
        now.checked_sub(Duration::from_secs_f64(back)).unwrap_or(now)
    }

    /// The bass, after a frame was analysed: a beat when it rises over the line
    /// (`bass` well over its running average `bass_att`), not too soon after the last.
    pub fn listen(&mut self, bass: f64, bass_att: f64, now: Instant) {
        let loud = bass > 1.3 && bass > bass_att * 1.15;
        if loud && !self.loud && self.heard.is_none_or(|t| secs(t, now) >= BEAT_GAP) {
            self.heard = Some(now);
        }
        self.loud = loud;
    }

    /// The last beat, by the chosen sync.
    fn last_beat(&self, now: Instant) -> Option<Instant> {
        match self.sync {
            Sync::Tempo => Some(self.last_tempo_beat(now)),
            Sync::Audio => self.heard,
        }
    }

    /// The scale on the preset clock (1 is the preset's own 30 steps a second;
    /// the picture still renders every refresh): the speed, 0.25–4, and 0 while
    /// frozen, coming back up over [`THAW`] once released.
    pub fn speed_now(&self, now: Instant) -> f64 {
        if self.freeze {
            return 0.0;
        }
        let thaw = self.thawed.map_or(1.0, |t| (secs(t, now) / THAW).min(1.0));
        self.speed * thaw * thaw * (3.0 - 2.0 * thaw)
    }

    fn black_level(&self, now: Instant) -> f64 {
        let (from, at) = self.black_from;
        let to = if self.blackout { 1.0 } else { 0.0 };
        if self.blackout_fade <= 0.0 {
            return to;
        }
        let moved = secs(at, now) / self.blackout_fade;
        if to > from { (from + moved).min(to) } else { (from - moved).max(to) }
    }

    /// Whether the strobe is in a flash at `now`.
    fn flashing(&self, now: Instant) -> bool {
        match self.sync {
            Sync::Tempo => {
                let every = self.beat_length() / self.strobe_rate;
                let since = now.saturating_duration_since(self.anchor).as_secs_f64();
                let phase = since - (since / every).floor() * every;
                phase < FLASH.min(every * 0.5)
            }
            Sync::Audio => self.heard.is_some_and(|t| secs(t, now) < FLASH * 1.5),
        }
    }

    fn punch_level(&self, now: Instant) -> f64 {
        let decay = |t: Instant| (-secs(t, now) / PUNCH_DECAY).exp();
        let mut level: f64 = if self.punch { 1.0 } else { self.kicked.map_or(0.0, decay) };
        if self.punch_on_beat {
            if let Some(beat) = self.last_beat(now) {
                level = level.max(decay(beat));
            }
        }
        if level < 0.01 { 0.0 } else { level }
    }

    /// A preset was loaded: start the crossfade from the last one's picture.
    pub fn start_fade(&mut self, now: Instant) {
        self.fading = Some(now);
    }

    /// The share of the outgoing preset still showing.
    fn fade_level(&self, now: Instant) -> f64 {
        let Some(at) = self.fading else { return 0.0 };
        if self.transition <= 0.0 {
            return 0.0;
        }
        let x = (secs(at, now) / self.transition).min(1.0);
        1.0 - x * x * (3.0 - 2.0 * x)
    }

    /// The master pass at `now`.
    pub fn master(&self, now: Instant) -> Master {
        let mut black = self.black_level(now);
        let mut flash = 0.0;
        if self.strobe {
            let on = self.flashing(now);
            match self.strobe_style {
                StrobeStyle::White if on => flash = self.strobe_intensity,
                StrobeStyle::Black if !on => black = black.max(self.strobe_intensity),
                _ => {}
            }
        }
        Master {
            brightness: self.brightness as f32,
            hue: self.hue as f32,
            invert: if self.invert { 1.0 } else { 0.0 },
            mirror: match self.mirror {
                Mirror::Off => EngineMirror::Off,
                Mirror::X => EngineMirror::X,
                Mirror::Y => EngineMirror::Y,
                Mirror::Quad => EngineMirror::Quad,
            },
            flash: flash as f32,
            black: black as f32,
            punch: self.punch_level(now) as f32,
            fade: self.fade_level(now) as f32,
        }
    }

    /// The trails echo for the engine: how much of the frame before stays, per frame.
    pub fn echo(&self) -> f32 {
        if self.trails <= 0.0 { 0.0 } else { (0.75 + 0.23 * self.trails) as f32 }
    }

    pub fn view(&self, hold: bool, bars: u32) -> View {
        View {
            speed: self.speed,
            freeze: self.freeze,
            transition: self.transition,
            strobe: self.strobe,
            strobe_rate: self.strobe_rate,
            strobe_intensity: self.strobe_intensity,
            strobe_style: self.strobe_style,
            sync: self.sync,
            blackout: self.blackout,
            blackout_fade: self.blackout_fade,
            punch: self.punch,
            punch_on_beat: self.punch_on_beat,
            brightness: self.brightness,
            hue: self.hue,
            invert: self.invert,
            mirror: self.mirror,
            trails: self.trails,
            sensitivity: self.sensitivity,
            bpm: self.bpm,
            linked: self.linked,
            hold,
            bars,
        }
    }
}

/// `~/.openflow/visuals/tempo.json` (under `OPENFLOW_HOME`).
fn tempo_file() -> PathBuf {
    let home = std::env::var_os("OPENFLOW_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow"));
    home.join("visuals").join("tempo.json")
}

/// Keep the tempo for next time. Failing to is not worth stopping the show for.
pub fn save_tempo(bpm: f64) {
    let file = tempo_file();
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, format!("{{\"bpm\": {bpm:.2}}}\n"));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, s: f64) -> Instant {
        start + Duration::from_secs_f64(s)
    }

    #[test]
    fn a_link_session_with_peers_keeps_the_beat() {
        let mut fx = Fx::default();
        let t = Instant::now() + Duration::from_secs(10);
        // Half way through a beat at 120 bpm: the last beat was 0.25 s ago.
        fx.follow(120.0, 7.5, t);
        assert!(fx.linked);
        assert_eq!(fx.bpm, 120.0);
        let last = fx.last_tempo_beat(t);
        assert!((t.duration_since(last).as_secs_f64() - 0.25).abs() < 1e-6);
        // Taps don't fight the session's tempo.
        assert!(!fx.apply(&FxAction::Tap, at(t, 0.1)).unwrap());
        assert!(!fx.apply(&FxAction::Tap, at(t, 0.4)).unwrap());
        assert_eq!(fx.bpm, 120.0);
        fx.unfollow();
        assert!(!fx.linked);
    }

    #[test]
    fn values_are_clamped_and_toggles_flip() {
        let mut fx = Fx::default();
        let now = Instant::now();
        fx.apply(&FxAction::Speed { speed: 9.0 }, now).unwrap();
        assert_eq!(fx.speed, 4.0);
        fx.apply(&FxAction::Speed { speed: 0.0 }, now).unwrap();
        assert_eq!(fx.speed, 0.25);
        assert!(fx.apply(&FxAction::Brightness { value: f64::NAN }, now).is_err());
        fx.apply(&FxAction::Transition { seconds: 99.0 }, now).unwrap();
        assert_eq!(fx.transition, 10.0);
        fx.apply(&FxAction::Invert { on: None }, now).unwrap();
        assert!(fx.invert);
        fx.apply(&FxAction::Invert { on: Some(true) }, now).unwrap();
        assert!(fx.invert);
        fx.apply(&FxAction::Invert { on: None }, now).unwrap();
        assert!(!fx.invert);
        for want in [Mirror::X, Mirror::Y, Mirror::Quad, Mirror::Off] {
            fx.apply(&FxAction::Mirror { mode: None }, now).unwrap();
            assert_eq!(fx.mirror, want);
        }
        fx.apply(&FxAction::Bpm { bpm: 1000.0 }, now).unwrap();
        assert_eq!(fx.bpm, 240.0);
    }

    #[test]
    fn defaults_draw_the_picture_as_it_is() {
        let fx = Fx::default();
        assert_eq!(fx.master(Instant::now()), Master::default());
        assert_eq!(fx.speed_now(Instant::now()), 1.0);
        assert_eq!(fx.echo(), 0.0);
    }

    #[test]
    fn freeze_holds_and_thaws_smoothly() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Speed { speed: 0.5 }, t).unwrap();
        fx.apply(&FxAction::Freeze { on: Some(true) }, t).unwrap();
        assert_eq!(fx.speed_now(at(t, 1.0)), 0.0);
        fx.apply(&FxAction::Freeze { on: Some(false) }, at(t, 1.0)).unwrap();
        let half = fx.speed_now(at(t, 1.0 + THAW / 2.0));
        assert!(half > 0.0 && half < 0.5, "{half}");
        assert_eq!(fx.speed_now(at(t, 2.0)), 0.5);
    }

    #[test]
    fn blackout_fades_and_turns_back_from_where_it_is() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Blackout { on: None }, t).unwrap();
        assert_eq!(fx.master(t).black, 1.0, "no fade: at once");
        fx.apply(&FxAction::Blackout { on: Some(false) }, t).unwrap();
        fx.apply(&FxAction::BlackoutFade { seconds: 2.0 }, t).unwrap();
        fx.apply(&FxAction::Blackout { on: Some(true) }, t).unwrap();
        assert!((fx.master(at(t, 1.0)).black - 0.5).abs() < 1e-3);
        fx.apply(&FxAction::Blackout { on: Some(false) }, at(t, 1.0)).unwrap();
        assert!((fx.master(at(t, 1.5)).black - 0.25).abs() < 1e-3);
        assert_eq!(fx.master(at(t, 3.0)).black, 0.0);
    }

    #[test]
    fn taps_set_the_tempo_and_the_strobe_follows_it() {
        let mut fx = Fx::default();
        let t = Instant::now();
        for i in 0..4 {
            fx.apply(&FxAction::Tap, at(t, i as f64 * 0.5)).unwrap();
        }
        assert!((fx.bpm - 120.0).abs() < 0.01, "{}", fx.bpm);
        // A long pause starts a new tempo rather than averaging it in.
        fx.apply(&FxAction::Tap, at(t, 10.0)).unwrap();
        fx.apply(&FxAction::Tap, at(t, 10.4)).unwrap();
        assert!((fx.bpm - 150.0).abs() < 0.01, "{}", fx.bpm);
        // The beat falls on the last tap: a flash there, none halfway to the next.
        fx.apply(&FxAction::Strobe { on: Some(true) }, t).unwrap();
        assert_eq!(fx.master(at(t, 10.4 + 0.4 * 3.0 + 0.01)).flash, 1.0);
        assert_eq!(fx.master(at(t, 10.4 + 0.2)).flash, 0.0);
        // Two flashes a beat: one halfway too.
        fx.apply(&FxAction::StrobeRate { rate: 2.0 }, t).unwrap();
        assert_eq!(fx.master(at(t, 10.4 + 0.2 + 0.01)).flash, 1.0);
        // Black gaps: the picture shows in the flash and black between.
        fx.apply(&FxAction::StrobeStyle { style: StrobeStyle::Black }, t).unwrap();
        assert_eq!(fx.master(at(t, 10.4 + 0.1)).black, 1.0);
        assert_eq!(fx.master(at(t, 10.4 + 0.01)).black, 0.0);
        fx.apply(&FxAction::Strobe { on: None }, t).unwrap();
        assert_eq!(fx.master(at(t, 10.4 + 0.1)).black, 0.0);
    }

    #[test]
    fn heard_beats_drive_the_strobe_in_audio_sync() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Sync { source: Sync::Audio }, t).unwrap();
        fx.apply(&FxAction::Strobe { on: Some(true) }, t).unwrap();
        assert_eq!(fx.master(t).flash, 0.0, "nothing heard yet");
        fx.listen(1.0, 1.0, t);
        fx.listen(2.0, 1.0, at(t, 1.0));
        assert_eq!(fx.master(at(t, 1.01)).flash, 1.0);
        assert_eq!(fx.master(at(t, 1.2)).flash, 0.0);
        // Staying loud is one beat, not one a frame.
        fx.listen(2.0, 1.0, at(t, 1.5));
        assert_eq!(fx.master(at(t, 1.51)).flash, 0.0);
    }

    #[test]
    fn punch_is_held_then_dies_away() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Punch { on: Some(true) }, t).unwrap();
        assert_eq!(fx.master(at(t, 2.0)).punch, 1.0);
        fx.apply(&FxAction::Punch { on: Some(false) }, at(t, 2.0)).unwrap();
        let p = fx.master(at(t, 2.1)).punch;
        assert!(p > 0.2 && p < 1.0, "{p}");
        assert_eq!(fx.master(at(t, 3.0)).punch, 0.0);
    }

    #[test]
    fn a_transition_fades_the_outgoing_picture_out() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Transition { seconds: 2.0 }, t).unwrap();
        fx.start_fade(t);
        assert_eq!(fx.master(t).fade, 1.0);
        assert!((fx.master(at(t, 1.0)).fade - 0.5).abs() < 1e-3);
        assert_eq!(fx.master(at(t, 2.0)).fade, 0.0);
    }

    #[test]
    fn reset_keeps_the_tempo_and_settings() {
        let mut fx = Fx::default();
        let t = Instant::now();
        fx.apply(&FxAction::Bpm { bpm: 128.0 }, t).unwrap();
        fx.apply(&FxAction::Invert { on: Some(true) }, t).unwrap();
        fx.apply(&FxAction::Freeze { on: Some(true) }, t).unwrap();
        fx.apply(&FxAction::Sensitivity { value: 2.0 }, t).unwrap();
        fx.apply(&FxAction::FxReset, t).unwrap();
        assert!(!fx.invert && !fx.freeze);
        assert_eq!((fx.bpm, fx.sensitivity), (128.0, 2.0));
        assert_eq!(fx.master(t), Master::default());
    }

    #[test]
    fn actions_read_as_json() {
        let read = |s: &str| serde_json::from_str::<FxAction>(s).unwrap();
        assert_eq!(read(r#"{"kind":"strobe","on":null}"#), FxAction::Strobe { on: None });
        assert_eq!(read(r#"{"kind":"mirror","mode":"quad"}"#), FxAction::Mirror { mode: Some(Mirror::Quad) });
        assert_eq!(read(r#"{"kind":"strobe_style","style":"black"}"#), FxAction::StrobeStyle { style: StrobeStyle::Black });
        assert_eq!(read(r#"{"kind":"fx_reset"}"#), FxAction::FxReset);
    }
}
