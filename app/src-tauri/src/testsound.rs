//! A test sound for the first run, so the visuals move before any music plays.
//! A beat is made here and written straight into the engine's ring, as if the
//! input had heard it; the input is closed meanwhile and opened again after.

use crate::{bench, App};
use engine::live::WINDOW;
use std::f64::consts::TAU;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long the test sound plays at most, so a page that went away never
/// leaves it on.
const LONGEST: Duration = Duration::from_secs(60);

/// The rate used when no input was open to give one.
const DEFAULT_RATE: f32 = 48000.0;

/// The test sound while it plays: what stops it, and its thread, which returns
/// whether it ran out of time (and so already went back to listening).
struct Playing {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<bool>,
}

static PLAYING: Mutex<Option<Playing>> = Mutex::new(None);

/// Play the test sound into the bench, or stop it and go back to listening to
/// what was chosen before. Starting it while it plays, or stopping it when it
/// doesn't, does nothing.
#[tauri::command]
pub fn test_sound(on: bool, handle: AppHandle) -> Result<(), String> {
    let mut playing = PLAYING.lock().unwrap();
    if on {
        if playing.as_ref().is_some_and(|p| !p.thread.is_finished()) {
            return Ok(());
        }
        // A thread that ran out of time has already gone back to listening.
        if let Some(p) = playing.take() {
            let _ = p.thread.join();
        }
        let app = handle.state::<App>();
        // Closing the input stops it writing into the ring, so the two never mix.
        let rate = app.listening.lock().unwrap().take().map_or(DEFAULT_RATE, |l| l.rate);
        app.send(bench::Cmd::SampleRate(rate));
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new().name("test sound".into()).spawn(move || play(handle, rate, flag)).map_err(|e| e.to_string())?;
        *playing = Some(Playing { stop, thread });
    } else if let Some(p) = playing.take() {
        p.stop.store(true, Ordering::Relaxed);
        let timed_out = p.thread.join().unwrap_or(false);
        if !timed_out {
            finish(&handle.state::<App>());
        }
    }
    Ok(())
}

/// Write the beat into the ring as time passes, until stopped or out of time.
/// Returns whether it ran out of time, after going back to listening then.
fn play(handle: AppHandle, rate: f32, stop: Arc<AtomicBool>) -> bool {
    let app = handle.state::<App>();
    let start = Instant::now();
    let mut made: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        let elapsed = start.elapsed();
        if elapsed >= LONGEST {
            finish(&app);
            return true;
        }
        let due = (elapsed.as_secs_f64() * rate as f64) as u64;
        // After a long stall only the last window matters.
        let from = made.max(due.saturating_sub(WINDOW as u64));
        if due > from {
            let samples = beat(rate, from, (due - from) as usize);
            let mut ring = app.ring.lock().unwrap();
            for &s in &samples {
                ring.0.push_back(s);
                ring.1.push_back(s);
            }
            while ring.0.len() > WINDOW {
                ring.0.pop_front();
                ring.1.pop_front();
            }
        }
        made = due;
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// Silence the ring and listen again to what was chosen before.
fn finish(app: &App) {
    {
        let mut ring = app.ring.lock().unwrap();
        let (left, right) = &mut *ring;
        left.iter_mut().chain(right.iter_mut()).for_each(|s| *s = 0.0);
    }
    crate::listen::resume(app);
}

/// The beat's `n` samples from sample `from` on, at `rate` Hz: 120 bpm, a kick
/// on every beat, a clap on beats 2 and 4, closed hi-hats on the eighths and a
/// bass line under it, so the bass, mids and treble all move. Each sample
/// depends only on its index, so it can be made in any chunks. Within ±0.9.
pub fn beat(rate: f32, from: u64, n: usize) -> Vec<f32> {
    let rate = rate as f64;
    (from..from + n as u64)
        .map(|i| {
            let t = i as f64 / rate;
            let beats = t / 0.5;
            let number = beats.floor() as u64;
            let tb = (beats - number as f64) * 0.5;
            let te = (t / 0.25).fract() * 0.25;
            // Kick: a sine sweeping from 150 Hz down to 45 Hz; its phase is the
            // sweep's integral, so it stays smooth.
            let phase = 45.0 * tb + 105.0 * (1.0 - (-30.0 * tb).exp()) / 30.0;
            let kick = 0.7 * (TAU * phase).sin() * (-7.0 * tb).exp();
            // Clap on beats 2 and 4: noise and a 200 Hz body.
            let clap = if number % 2 == 1 { (0.3 * noise(i) + 0.1 * (TAU * 200.0 * tb).sin()) * (-18.0 * tb).exp() } else { 0.0 };
            // Hi-hat: the noise's difference, which keeps only the top, cut short.
            let hat = 0.18 * (noise(i) - noise(i.wrapping_sub(1))) * (-70.0 * te).exp();
            // Bass: a bar of A, A, F, G, pulsing with the beat.
            let note = [55.0, 55.0, 43.65, 49.0][(number % 4) as usize];
            let bass = 0.2 * (TAU * note * t).sin() * (0.5 + 0.5 * (-4.0 * tb).exp());
            (0.9 * (kick + clap + hat + bass).tanh()) as f32
        })
        .collect()
}

/// Noise in [-1, 1) made from a sample's index alone.
fn noise(i: u64) -> f64 {
    let mut z = i.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48000.0;

    fn peak(s: &[f32]) -> f32 {
        s.iter().fold(0.0, |m, x| m.max(x.abs()))
    }

    /// The mean step from one sample to the next: large where there is treble.
    fn rough(s: &[f32]) -> f32 {
        s.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / s.len() as f32
    }

    #[test]
    fn the_same_samples_every_time() {
        assert_eq!(beat(RATE, 12345, 4000), beat(RATE, 12345, 4000));
    }

    #[test]
    fn chunks_make_the_same_sound_as_one_go() {
        let whole = beat(RATE, 0, 10000);
        let mut parts = Vec::new();
        let mut from = 0;
        for n in [1, 479, 1024, 3000, 5496] {
            parts.extend(beat(RATE, from, n));
            from += n as u64;
        }
        assert_eq!(parts, whole);
    }

    #[test]
    fn stays_within_bounds() {
        let s = beat(RATE, 0, 4 * RATE as usize);
        assert!(peak(&s) <= 0.9, "peak {}", peak(&s));
        assert!(peak(&s) > 0.3, "too quiet: {}", peak(&s));
    }

    #[test]
    fn the_kick_lands_on_the_beat() {
        let ms50 = (RATE * 0.05) as usize;
        let half = (RATE * 0.5) as u64;
        for b in 0..4u64 {
            let after = peak(&beat(RATE, b * half, ms50));
            let before = peak(&beat(RATE, (b + 1) * half - ms50 as u64, ms50));
            assert!(after > 2.0 * before, "beat {b}: {after} after, {before} before");
        }
    }

    #[test]
    fn hi_hats_bring_treble_on_the_eighths() {
        let ms10 = (RATE * 0.01) as usize;
        let eighth = (RATE * 0.25) as u64;
        // The off-beat eighths, where no kick starts.
        for e in [1u64, 3, 5, 7] {
            let on = rough(&beat(RATE, e * eighth, ms10));
            let before = rough(&beat(RATE, e * eighth - ms10 as u64, ms10));
            assert!(on > 0.02 && on > 5.0 * before, "eighth {e}: {on} on it, {before} before");
        }
    }
}
