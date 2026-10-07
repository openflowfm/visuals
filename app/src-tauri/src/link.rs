//! Ableton Link, the one, and preset changes on the bar.
//!
//! The port of the old Node engine's clock (`server/link.ts`, the one in `resolve.ts` and
//! `server/show.ts`, `docs/clock.md`, `docs/wheel.md`), with its rules kept:
//!
//! - **Visuals follow; they never drive.** Link has no private session — it is every
//!   machine on the network — so nothing here sets the tempo, the beat or the transport,
//!   and there is no method that could: the session state is only ever *captured*,
//!   never committed.
//! - **Link's beat has no bar 1.** It started whenever the first peer did, so bars are
//!   counted from **the one**, a Link beat this app holds, and the one is taken off Link's
//!   *phase* (the part that is shared and musical), never off a rounded beat.
//! - **A peer joining a session that is already playing is not told so.** `playing` is
//!   Link's start/stop state and reads false until the next start or stop; the first read
//!   is never taken as a start.
//! - Quantum 4.
//!
//! Preset changes every N bars (or beats) are scheduled from Link's timeline: the next
//! boundary's beat is turned into Link's host time and the thread sleeps until exactly
//! then, so a change lands on the line rather than on whichever poll came after it. With
//! no peers Link keeps its own timeline at the last tempo it had, so the changes carry on
//! at that tempo; disabling Link only leaves the network, the clock still runs.

use rusty_link::{AblLink, SessionState};
use serde::{Deserialize, Serialize};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

/// Beats to the bar, as Link's phase is counted.
pub const QUANTUM: f64 = 4.0;
/// Tempo before any peer has said otherwise.
const TEMPO: f64 = 120.0;
/// How close to a boundary the scheduler stops re-checking and sleeps to it exactly.
const NEAR_US: i64 = 20_000;
/// The longest the scheduler sleeps before looking again (tempo, the one or the
/// interval may have moved).
const LOOK_US: i64 = 100_000;
/// Float slop on beats, and nothing else.
const EPS: f64 = 1e-6;

/// The bar line nearest here, as Link draws them: `beat` minus Link's `phase`, or the
/// coming line when more than half the bar has gone. What "set the one now" means — a
/// hand is as likely to be early as late, and a press three quarters of the way through
/// a bar means the downbeat that is about to happen. (`barLine` in `resolve.ts`.)
pub fn bar_line(beat: f64, phase: f64, quantum: f64) -> f64 {
    let bar = quantum.max(1.0);
    let phase = phase.rem_euclid(bar);
    beat - phase + if phase > bar / 2.0 { bar } else { 0.0 }
}

/// The bar line at `beat` or the first after it. A transport start: with a session up,
/// pressing play arms the transport and the music starts on the next bar line, so the
/// one is that line and never the press (`buildShow`'s wait in `server/show.ts`).
pub fn line_from(beat: f64, phase: f64, quantum: f64) -> f64 {
    let bar = quantum.max(1.0);
    let phase = phase.rem_euclid(bar);
    if phase < 1e-3 { beat - phase } else { beat - phase + bar }
}

/// Where `beat` is, counted from the one.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    /// From 1 at the one; 0 and below before it.
    pub bar: i64,
    /// From 1 to the quantum.
    pub beat_in_bar: u32,
    /// Beats into the bar, 0 to the quantum.
    pub bar_phase: f64,
}

pub fn count(beat: f64, one: f64, quantum: f64) -> Count {
    let bar = quantum.max(1.0);
    let since = beat - one;
    let bars = (since / bar).floor();
    let phase = (since - bars * bar).clamp(0.0, bar);
    Count { bar: bars as i64 + 1, beat_in_bar: (phase.floor() as u32 + 1).min(bar as u32), bar_phase: phase }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Unit {
    Bars,
    Beats,
}

/// How often the preset changes on the beat. `every` 0 is off.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Every {
    pub every: u32,
    pub unit: Unit,
}

impl Every {
    pub const OFF: Every = Every { every: 0, unit: Unit::Bars };

    /// In beats; none when off.
    pub fn period(&self, quantum: f64) -> Option<f64> {
        let n = self.every as f64;
        (self.every > 0).then(|| if self.unit == Unit::Bars { n * quantum.max(1.0) } else { n })
    }
}

/// The first boundary — the one plus a whole number of periods — after `beat`, and after
/// the one last fired, so a change that landed is never made twice.
pub fn next_boundary(beat: f64, one: f64, period: f64, fired: Option<f64>) -> f64 {
    let mut next = one + (((beat - one) / period).floor() + 1.0) * period;
    if next <= beat {
        next += period;
    }
    if let Some(fired) = fired {
        while next <= fired + EPS {
            next += period;
        }
    }
    next
}

/// What the scheduler does next.
#[derive(Debug, PartialEq)]
pub enum Step {
    /// Nothing scheduled; wait to be told.
    Idle,
    /// Look again in this many microseconds.
    Wait(i64),
    /// Change at boundary `beat`, `in_us` microseconds from now.
    Fire { beat: f64, in_us: i64 },
}

/// The scheduler's decision, given Link's clock now (`now_us`, and the beat at it) and
/// `time_at`, Link's map from a beat to its host time. Pure, so it is tested against a
/// made-up timeline.
pub fn step(every: Every, one: f64, fired: Option<f64>, now_us: i64, beat: f64, time_at: impl Fn(f64) -> i64) -> Step {
    let Some(period) = every.period(QUANTUM) else { return Step::Idle };
    let target = next_boundary(beat, one, period, fired);
    let in_us = time_at(target) - now_us;
    if in_us > NEAR_US { Step::Wait((in_us - NEAR_US).min(LOOK_US)) } else { Step::Fire { beat: target, in_us: in_us.max(0) } }
}

/// Was this read a transport start? The first read never is: a peer joining a session
/// that is already playing is not told so, and one that is told late must not re-phase.
pub fn started(was: Option<bool>, now: bool) -> bool {
    was == Some(false) && now
}

/// What the app holds about the beat; everything else is Link's.
struct Held {
    one: f64,
    every: Every,
    /// The last boundary a change was made on.
    fired: Option<f64>,
    /// Bumped whenever the one or the interval moves, so a change already being slept
    /// toward is dropped when its boundary is no longer one.
    generation: u64,
    was_playing: Option<bool>,
}

/// The Link peer and the one, managed by Tauri.
pub struct Link {
    link: AblLink,
    held: Mutex<Held>,
    wake: Condvar,
}

/// The beat as the page sees it: the `link` event, and what every command returns.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    /// On the network. When off, the clock still runs at the last tempo.
    pub enabled: bool,
    pub tempo: f64,
    pub peers: u64,
    /// Link's start/stop state. A session already playing when we joined reads false.
    pub playing: bool,
    /// Link's session beat: continuous, shared, not aligned to anything musical.
    pub beat: f64,
    /// Link's phase in the bar, 0 to the quantum.
    pub phase: f64,
    pub quantum: f64,
    /// The Link beat the bars are counted from.
    pub one: f64,
    #[serde(flatten)]
    pub count: Count,
    pub every: Every,
    /// The Link beat of the next change, when changes are on.
    pub next: Option<f64>,
    /// Milliseconds since the Unix epoch when sampled, so the page can run on from here.
    pub at: f64,
}

impl Link {
    fn new(enabled: bool) -> Link {
        let link = AblLink::new(TEMPO);
        // Hear starts and stops. Nothing here ever commits a session state, so this
        // only listens.
        link.enable_start_stop_sync(true);
        link.enable(enabled);
        Link {
            link,
            held: Mutex::new(Held { one: 0.0, every: Every::OFF, fired: None, generation: 0, was_playing: None }),
            wake: Condvar::new(),
        }
    }

    fn session(&self) -> (SessionState, i64) {
        let mut s = SessionState::new();
        self.link.capture_app_session_state(&mut s);
        (s, self.link.clock_micros())
    }

    fn frame(&self) -> Frame {
        let (s, now) = self.session();
        let beat = s.beat_at_time(now, QUANTUM);
        let held = self.held.lock().unwrap();
        Frame {
            enabled: self.link.is_enabled(),
            tempo: s.tempo(),
            peers: self.link.num_peers(),
            playing: s.is_playing(),
            beat,
            phase: s.phase_at_time(now, QUANTUM),
            quantum: QUANTUM,
            one: held.one,
            count: count(beat, held.one, QUANTUM),
            every: held.every,
            next: held.every.period(QUANTUM).map(|p| next_boundary(beat, held.one, p, held.fired)),
            at: UNIX_EPOCH.elapsed().map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0),
        }
    }

    /// Change what the app holds and wake the scheduler to it.
    fn change(&self, f: impl FnOnce(&mut Held)) {
        let mut held = self.held.lock().unwrap();
        f(&mut held);
        held.generation += 1;
        self.wake.notify_all();
    }

    /// The 10 Hz read: take the one from a transport start, and tell the page.
    fn tick(&self) -> Frame {
        let (s, _) = self.session();
        let playing = s.is_playing();
        let was = self.held.lock().unwrap().was_playing;
        if started(was, playing) {
            let at = s.time_for_is_playing();
            let line = line_from(s.beat_at_time(at, QUANTUM), s.phase_at_time(at, QUANTUM), QUANTUM);
            self.change(|h| h.one = line);
        }
        self.held.lock().unwrap().was_playing = Some(playing);
        self.frame()
    }

    /// Sleep to the next boundary and change the preset on it, for ever.
    fn schedule(&self, handle: &AppHandle) {
        loop {
            let (every, one, fired, generation) = {
                let h = self.held.lock().unwrap();
                (h.every, h.one, h.fired, h.generation)
            };
            let (s, now) = self.session();
            let beat = s.beat_at_time(now, QUANTUM);
            match step(every, one, fired, now, beat, |b| s.time_at_beat(b, QUANTUM)) {
                Step::Idle => {
                    let h = self.held.lock().unwrap();
                    let _ = self.wake.wait_timeout_while(h, Duration::from_millis(500), |h| h.generation == generation);
                }
                Step::Wait(us) => {
                    let h = self.held.lock().unwrap();
                    let _ = self.wake.wait_timeout_while(h, Duration::from_micros(us as u64), |h| h.generation == generation);
                }
                Step::Fire { beat, in_us } => {
                    std::thread::sleep(Duration::from_micros(in_us as u64));
                    {
                        let mut h = self.held.lock().unwrap();
                        if h.generation != generation {
                            continue;
                        }
                        h.fired = Some(beat);
                    }
                    if std::env::var_os("VISUALS_LINK_LOG").is_some() {
                        eprintln!("link: change at beat {beat}");
                    }
                    if let Err(e) = crate::actions::dispatch(handle, crate::actions::Action::Next) {
                        eprintln!("link: change on the beat: {e}");
                    }
                }
            }
        }
    }
}

/// Join Link (unless `VISUALS_LINK=0`), and start the 10 Hz `link` event and the
/// scheduler that changes the preset on the beat.
pub fn start(handle: AppHandle) {
    let enabled = std::env::var("VISUALS_LINK").map_or(true, |v| v != "0");
    let link = Link::new(enabled);
    // `VISUALS_LINK_EVERY=<bars>` starts with changes on.
    if let Some(bars) = std::env::var("VISUALS_LINK_EVERY").ok().and_then(|s| s.parse().ok()) {
        link.change(|h| h.every = Every { every: bars, unit: Unit::Bars });
    }
    handle.manage(link);
    // Development: `VISUALS_LINK_LOG=1` prints the frame once a second.
    let log = std::env::var_os("VISUALS_LINK_LOG").is_some();
    let ticker = handle.clone();
    std::thread::spawn(move || {
        let mut peers = None;
        for n in 0u64.. {
            std::thread::sleep(Duration::from_millis(100));
            let frame = ticker.state::<Link>().tick();
            if peers != Some((frame.enabled, frame.peers)) {
                peers = Some((frame.enabled, frame.peers));
                eprintln!("link: {}, {} peers, {:.1} bpm", if frame.enabled { "on" } else { "off" }, frame.peers, frame.tempo);
            }
            if log && n % 10 == 0 {
                eprintln!("link: {frame:?}");
            }
            let _ = ticker.emit("link", frame);
        }
    });
    std::thread::spawn(move || handle.state::<Link>().schedule(&handle));
}

#[tauri::command]
pub fn link_state(link: State<Link>) -> Frame {
    link.frame()
}

/// Join or leave the Link session. Off, the clock runs on at the last tempo.
#[tauri::command]
pub fn link_enable(on: bool, link: State<Link>) -> Frame {
    link.link.enable(on);
    link.frame()
}

/// "Here is the one": the nearest bar line, or the coming one late in a bar.
#[tauri::command]
pub fn link_set_one(link: State<Link>) -> Frame {
    let (s, now) = link.session();
    let line = bar_line(s.beat_at_time(now, QUANTUM), s.phase_at_time(now, QUANTUM), QUANTUM);
    link.change(|h| h.one = line);
    link.frame()
}

/// Move the one by `beats` (a beat either way, from the page), within a bar.
#[tauri::command]
pub fn link_nudge(beats: f64, link: State<Link>) -> Result<Frame, String> {
    if !beats.is_finite() {
        return Err("beats must be a number".into());
    }
    link.change(|h| h.one += beats.clamp(-QUANTUM, QUANTUM));
    Ok(link.frame())
}

/// Back to Link's own bar lines: the one at Link's beat 0.
#[tauri::command]
pub fn link_reset_one(link: State<Link>) -> Frame {
    link.change(|h| h.one = 0.0);
    link.frame()
}

/// Change the preset every `every` bars or beats (0: off), through `actions::dispatch`'s
/// Next — the playing playlist's next, or the library's. Turning it on turns time-based
/// auto-advance off, so the two never both change the preset.
#[tauri::command]
pub fn link_sync(every: u32, unit: Unit, link: State<Link>, handle: AppHandle) -> Result<Frame, String> {
    if every > 256 {
        return Err("every is at most 256".into());
    }
    link.change(|h| h.every = Every { every, unit });
    let auto = handle.state::<crate::actions::Deck>().live.lock().unwrap().auto;
    if every > 0 && auto {
        crate::actions::dispatch(&handle, crate::actions::Action::Auto { on: Some(false) })?;
    }
    Ok(link.frame())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn takes_the_one_off_the_bar_line_link_draws_not_off_a_whole_beat() {
        // Two beats into the bar: the line was at 98.4, and rounding the beat would have
        // said 100.
        assert!(close(bar_line(100.4, 2.0, 4.0), 98.4));
        // Three quarters of the way through: the downbeat meant is the coming one.
        assert!(close(bar_line(100.4, 3.0, 4.0), 101.4));
        assert!(close(bar_line(100.0, 0.0, 4.0), 100.0));
        // A hair before the line is the line.
        assert!(close(bar_line(99.9, 3.9, 4.0), 100.0));
    }

    #[test]
    fn a_transport_start_waits_for_the_bar_line_the_music_starts_on() {
        // Play pressed a beat and a half into the bar: the music starts at the next line.
        assert!(close(line_from(101.5, 1.5, 4.0), 104.0));
        assert!(close(line_from(103.5, 3.5, 4.0), 104.0));
        // Already on the line (Link moved the start there): that line.
        assert!(close(line_from(104.0, 0.0, 4.0), 104.0));
        assert!(close(line_from(104.0004, 0.0004, 4.0), 104.0));
    }

    #[test]
    fn only_a_start_seen_happening_is_a_start() {
        // A session already playing when we joined: the first read is not a start.
        assert!(!started(None, true));
        assert!(started(Some(false), true));
        // Still playing is not starting.
        assert!(!started(Some(true), true));
        assert!(!started(Some(true), false));
    }

    #[test]
    fn counts_bars_from_the_one_not_from_links_zero() {
        // Four bars of four from a one at 8: the first change is at 24, not at 16.
        let every = Every { every: 4, unit: Unit::Bars };
        let period = every.period(4.0).unwrap();
        assert_eq!(period, 16.0);
        assert!(close(next_boundary(15.9, 8.0, period, None), 24.0));
        assert!(close(next_boundary(23.9, 8.0, period, None), 24.0));
        assert!(close(next_boundary(24.0, 8.0, period, None), 40.0));
        assert_eq!(count(8.0, 8.0, 4.0), Count { bar: 1, beat_in_bar: 1, bar_phase: 0.0 });
        assert_eq!(count(23.9, 8.0, 4.0).bar, 4);
        assert_eq!(count(23.9, 8.0, 4.0).beat_in_bar, 4);
        assert_eq!(count(24.0, 8.0, 4.0).bar, 5);
        // Before the one.
        assert_eq!(count(7.0, 8.0, 4.0), Count { bar: 0, beat_in_bar: 4, bar_phase: 3.0 });
    }

    #[test]
    fn setting_the_one_moves_when_the_next_change_is_and_changes_nothing_now() {
        // Set at a downbeat: nothing changes there; the next change is a whole period on.
        let one = bar_line(100.0, 0.0, 4.0);
        let period = 16.0;
        assert!(close(next_boundary(100.0, one, period, None), 116.0));
        assert!(close(next_boundary(115.9, one, period, None), 116.0));
        // Set late in a bar: the one is the coming line, and the change lands on it.
        let one = bar_line(100.4, 3.0, 4.0);
        assert!(close(next_boundary(100.4, one, period, None), 101.4));
    }

    #[test]
    fn nudges_and_beats() {
        let every = Every { every: 2, unit: Unit::Beats };
        assert_eq!(every.period(4.0), Some(2.0));
        assert_eq!(Every::OFF.period(4.0), None);
        // A one a beat later moves every boundary a beat later.
        assert!(close(next_boundary(5.0, 1.0, 4.0, None), 9.0));
        assert!(close(next_boundary(5.0, 0.0, 4.0, None), 8.0));
        assert!(close(next_boundary(5.0, -1.0, 4.0, None), 7.0));
    }

    /// A made-up Link timeline: `tempo` from beat 0 at host time `origin`.
    fn timeline(tempo: f64, origin: i64) -> (impl Fn(f64) -> i64, impl Fn(i64) -> f64) {
        let per = 60_000_000.0 / tempo;
        (move |b: f64| origin + (b * per).round() as i64, move |t: i64| (t - origin) as f64 / per)
    }

    /// Drive [`step`] the way the thread does, on a virtual clock from `from_us` to
    /// `to_us`; returns the host times and beats changes were made at.
    fn run(every: Every, one: f64, tempo: f64, from_us: i64, to_us: i64, stall: Option<(i64, i64)>) -> Vec<(i64, f64)> {
        let (time_at, beat_at) = timeline(tempo, 0);
        let mut now = from_us;
        let mut fired = None;
        let mut out = Vec::new();
        while now < to_us {
            if let Some((at, until)) = stall {
                if now >= at && now < until {
                    now = until;
                }
            }
            match step(every, one, fired, now, beat_at(now), &time_at) {
                Step::Idle => break,
                Step::Wait(us) => now += us,
                Step::Fire { beat, in_us } => {
                    now += in_us;
                    fired = Some(beat);
                    out.push((now, beat));
                    // The dispatch itself takes a moment.
                    now += 3_000;
                }
            }
        }
        out
    }

    #[test]
    fn changes_land_exactly_on_the_boundaries_once_each() {
        // 120 bpm, every bar, from beat 1 to beat 17: lines at 4, 8, 12, 16.
        let fired = run(Every { every: 1, unit: Unit::Bars }, 0.0, 120.0, 500_000, 8_500_000, None);
        assert_eq!(fired, vec![(2_000_000, 4.0), (4_000_000, 8.0), (6_000_000, 12.0), (8_000_000, 16.0)]);
        // Counted from a nudged one, every two bars.
        let fired = run(Every { every: 2, unit: Unit::Bars }, 1.0, 120.0, 0, 9_000_000, None);
        assert_eq!(fired.iter().map(|f| f.1).collect::<Vec<_>>(), vec![1.0, 9.0, 17.0]);
        assert_eq!(fired[1].0, 4_500_000);
    }

    #[test]
    fn a_missed_boundary_is_skipped_not_made_late() {
        // Asleep from 1.95 s to 2.6 s (the machine, a long load): the line at 2 s is gone,
        // and the next change is at the next line, not at 2.6 s.
        let fired = run(Every { every: 1, unit: Unit::Bars }, 0.0, 120.0, 0, 4_500_000, Some((1_950_000, 2_600_000)));
        assert_eq!(fired, vec![(4_000_000, 8.0)]);
    }

    #[test]
    fn off_schedules_nothing() {
        assert_eq!(step(Every::OFF, 0.0, None, 0, 0.0, |b| b as i64), Step::Idle);
    }

    #[test]
    fn frames_read_as_the_page_expects() {
        let every: Every = serde_json::from_str(r#"{"every":8,"unit":"bars"}"#).unwrap();
        assert_eq!(every, Every { every: 8, unit: Unit::Bars });
        let c = serde_json::to_value(count(5.5, 0.0, 4.0)).unwrap();
        assert_eq!(c["bar"], 2);
        assert_eq!(c["beatInBar"], 2);
    }
}
