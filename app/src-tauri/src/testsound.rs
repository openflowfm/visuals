//! A test sound for the first run, so the visuals move, and the user hears
//! something, before any music plays. The music is the teaser video's
//! placeholder track (`teaser/README.md`, "1. The music"), made here sample by
//! sample from the same recipe: it plays through the system's output and, as
//! each block goes out, into the engine's ring, as if the input had heard it.
//! The input is closed meanwhile and opened again after.

use crate::{bench, App};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use engine::live::Sink;
use std::f64::consts::TAU;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Tauri's event when the test sound stops by itself, out of time.
pub const ENDED: &str = "test-sound-ended";

/// How long the test sound plays at most, so a page that went away never
/// leaves it on.
const LONGEST: Duration = Duration::from_secs(60);

/// How long the output may take to open before the test sound gives up.
const OPENING: Duration = Duration::from_secs(5);

/// How loud the speakers play it; the visuals hear it at full level.
const VOLUME: f32 = 0.6;

/// The part of the track played, looped, in seconds: from bar 6 (hats, bass and
/// kick all in) through the breakdown and the drop to bar 24, where the closing
/// pad starts. Both ends fall on a beat, so the loop keeps time.
const FROM: f64 = 11.25;
const TO: f64 = 45.0;

/// How long the start fades in, in seconds, so it doesn't click.
const FADE_IN: f64 = 0.02;

/// The test sound while it plays: what stops it, and its thread, which returns
/// whether it ran out of time (and so already went back to listening).
struct Playing {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<bool>,
}

static PLAYING: Mutex<Option<Playing>> = Mutex::new(None);

/// Play the test sound through the speakers and into the bench, or stop it and
/// go back to listening to what was chosen before. Starting it while it plays,
/// or stopping it when it doesn't, does nothing. When the system's output can't
/// be opened it fails, listening again to what was chosen.
#[tauri::command(async)]
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
        {
            let _operation = app.audio.operation.lock().unwrap();
            app.audio.pause(true);
            app.listening.lock().unwrap().take();
            app.audio.mic.lock().unwrap().take();
            app.audio.clear(crate::audio::Lane::Main, &app.ring);
            app.audio.clear(crate::audio::Lane::Mic, &app.ring);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let player_handle = handle.clone();
        let (opened, opening) = mpsc::channel();
        let thread = match std::thread::Builder::new().name("test sound".into()).spawn(move || play(player_handle, flag, opened)) {
            Ok(thread) => thread,
            Err(e) => {
                finish(&app);
                return Err(e.to_string());
            }
        };
        match opening.recv_timeout(OPENING) {
            Ok(Ok(rate)) => {
                app.send(bench::Cmd::SampleRate(rate));
                *playing = Some(Playing { stop, thread });
            }
            failed => {
                // A thread still opening ends by itself once it sees `stop`, and never writes the ring after it.
                stop.store(true, Ordering::Relaxed);
                finish(&app);
                return Err(match failed {
                    Ok(Err(e)) => format!("Couldn't play through the speakers: {e}"),
                    _ => "The speakers didn't answer in time.".into(),
                });
            }
        }
    } else if let Some(p) = playing.take() {
        p.stop.store(true, Ordering::Relaxed);
        let timed_out = p.thread.join().unwrap_or(false);
        if !timed_out {
            finish(&handle.state::<App>());
        }
    }
    Ok(())
}

/// Open the system's output and play the track through it, writing each block
/// into the ring as it goes out, until stopped or out of time. Says on `opened`
/// the output's rate, or why it couldn't open. Returns whether it ran out of
/// time, after going back to listening then.
fn play(handle: AppHandle, stop: Arc<AtomicBool>, opened: mpsc::Sender<Result<f32, String>>) -> bool {
    let app = handle.state::<App>();
    let stream = match open_output(Sink::ring(app.ring.clone()), stop.clone()) {
        Ok((stream, rate)) => {
            let _ = opened.send(Ok(rate));
            stream
        }
        Err(e) => {
            let _ = opened.send(Err(e));
            return false;
        }
    };
    let start = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        if start.elapsed() >= LONGEST {
            stop.store(true, Ordering::Relaxed);
            drop(stream);
            finish(&app);
            let _ = handle.emit(ENDED, ());
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// The system's default output, playing the track from `FROM`; each block also
/// goes to `sink` until `stop` is set. Returns the stream and its rate.
fn open_output(sink: Sink, stop: Arc<AtomicBool>) -> Result<(cpal::Stream, f32), String> {
    let device = cpal::default_host().default_output_device().ok_or("there is no sound output")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    if channels == 0 {
        return Err("the output has no channels".into());
    }
    let rate = config.sample_rate() as f32;
    fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
        device: &cpal::Device,
        config: cpal::StreamConfig,
        channels: usize,
        rate: f32,
        sink: Sink,
        stop: Arc<AtomicBool>,
    ) -> Result<cpal::Stream, String> {
        let mut played: u64 = 0;
        let mut block: Vec<[f32; 2]> = Vec::with_capacity(8192);
        device
            .build_output_stream(
                config,
                move |data: &mut [T], _| {
                    block.clear();
                    for frame in data.chunks_mut(channels) {
                        let s = looped(rate, played);
                        played += 1;
                        let out = T::from_sample(s * VOLUME);
                        frame.iter_mut().for_each(|x| *x = out);
                        block.push([s, s]);
                    }
                    if !stop.load(Ordering::Relaxed) {
                        sink.write(&block);
                    }
                },
                |e| eprintln!("test sound output stopped: {e}"),
                None,
            )
            .map_err(|e| e.to_string())
    }
    let format = config.sample_format();
    let config: cpal::StreamConfig = config.into();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, config, channels, rate, sink, stop)?,
        cpal::SampleFormat::F64 => build::<f64>(&device, config, channels, rate, sink, stop)?,
        cpal::SampleFormat::I16 => build::<i16>(&device, config, channels, rate, sink, stop)?,
        cpal::SampleFormat::I32 => build::<i32>(&device, config, channels, rate, sink, stop)?,
        cpal::SampleFormat::U16 => build::<u16>(&device, config, channels, rate, sink, stop)?,
        other => return Err(format!("unsupported output format: {other}")),
    };
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, rate))
}

/// Silence the ring and listen again to what was chosen before.
fn finish(app: &App) {
    app.audio.pause(false);
    {
        let mut ring = app.ring.lock().unwrap();
        let (left, right) = &mut *ring;
        left.iter_mut().chain(right.iter_mut()).for_each(|s| *s = 0.0);
    }
    crate::listen::resume(app);
}

/// The `played`th sample of the test sound at `rate` Hz: the track from `FROM`
/// to `TO`, over and over, faded in over its first `FADE_IN`.
fn looped(rate: f32, played: u64) -> f32 {
    let rate = rate as f64;
    let span = ((TO - FROM) * rate).round() as u64;
    let at = (FROM * rate).round() as u64 + played % span;
    let fade = (played as f64 / (FADE_IN * rate)).min(1.0) as f32;
    track(rate, at) * fade
}

/// The teaser's placeholder track (teaser/README.md's ffmpeg recipe): its
/// sample `i` at `rate` Hz. 128 bpm, so a beat is 0.46875 s and a bar 1.875 s:
/// a pad under soft hats, the kick from bar 4, hats and bass from bar 6, a
/// breakdown with a riser at bars 13–16, the drop at bar 16, a pad to close
/// from bar 24. Each sample depends only on its index. Within ±0.9.
pub fn track(rate: f64, i: u64) -> f32 {
    let t = i as f64 / rate;
    let between = |a: f64, b: f64| if (a..=b).contains(&t) { 1.0 } else { 0.0 };
    let from = |a: f64| if t >= a { 1.0 } else { 0.0 };
    let beat = t % 0.46875;
    let off = (t + 0.234375) % 0.46875;
    let groove = between(11.25, 24.375) + between(30.0, 45.0);
    let intro = 1.0 - from(7.5);
    let note = if (t / 1.875).floor() % 4.0 < 2.0 { 55.0 } else { 43.65 };
    let kick = (from(7.5) - between(24.375, 30.0) - from(45.0)) * 0.9 * (TAU * (50.0 * beat + 4.0 * (1.0 - (-25.0 * beat).exp()))).sin() * (-7.0 * beat).exp();
    let hats = (groove + 0.5 * intro) * 0.12 * noise(i) * (-80.0 * off).exp();
    let bass = groove * 0.3 * (TAU * note * t).sin() * (1.0 - (-10.0 * beat).exp());
    let swell = 1.0 + 2.0 * between(24.375, 30.0) + 1.5 * intro;
    let pad = 0.06 * ((TAU * 220.0 * t).sin() + (TAU * 261.63 * t).sin() + (TAU * 329.63 * t).sin()) * swell * ((52.5 - t) / 4.0).min(1.0);
    let rise = (between(24.375, 30.0) * (t - 24.375) / 5.625 + between(5.625, 7.5) * (t - 5.625) / 1.875) * 0.25 * noise(i ^ 0x5555_5555_5555_5555);
    // ffmpeg's limiter at 0.9, as a soft clip.
    (0.9 * ((kick + hats + bass + pad + rise) / 0.9).tanh()) as f32
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

    fn run(from: u64, n: usize) -> Vec<f32> {
        (from..from + n as u64).map(|i| looped(RATE, i)).collect()
    }

    fn peak(s: &[f32]) -> f32 {
        s.iter().fold(0.0, |m, x| m.max(x.abs()))
    }

    #[test]
    fn the_same_samples_every_time() {
        assert_eq!(run(12345, 4000), run(12345, 4000));
    }

    #[test]
    fn stays_within_bounds_and_loud_enough_to_hear() {
        let s = run(0, 4 * RATE as usize);
        assert!(peak(&s) <= 0.9, "peak {}", peak(&s));
        assert!(peak(&s) > 0.3, "too quiet: {}", peak(&s));
    }

    #[test]
    fn starts_from_silence() {
        assert!(looped(RATE, 0).abs() < 1e-6);
    }

    #[test]
    fn the_kick_lands_on_the_beat() {
        let ms50 = (RATE * 0.05) as usize;
        let beat = (RATE as f64 * 0.46875) as u64;
        for b in 1..5u64 {
            let after = peak(&run(b * beat, ms50));
            let before = peak(&run((b + 1) * beat - ms50 as u64, ms50));
            assert!(after > 1.5 * before, "beat {b}: {after} after, {before} before");
        }
    }

    #[test]
    fn loops_back_to_the_start() {
        let span = ((TO - FROM) * RATE as f64).round() as u64;
        assert_eq!(run(span + 1000, 500), run(1000, 500));
    }
}
