//! Main + optional microphone routing. Callbacks only append to independent bounded
//! queues; one clock resamples and sums them into the existing engine ring.
use crate::{listen, App};
use engine::live::{Ring, Sink, WINDOW};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::State;
pub const RATE: f32 = 48000.0;
#[derive(Clone, Copy, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    Main,
    Mic,
}
impl Lane {
    fn index(self) -> usize {
        match self {
            Self::Main => 0,
            Self::Mic => 1,
        }
    }
}
#[derive(serde::Serialize)]
pub struct LaneStatus {
    pub source: Option<listen::SourceId>,
    pub selected: Option<listen::SourceId>,
    pub choice: Option<listen::Choice>,
    pub channels: usize,
    pub enabled: bool,
    pub unavailable: bool,
    pub denied: bool,
}
#[derive(serde::Serialize)]
pub struct Status {
    pub main: LaneStatus,
    pub mic: LaneStatus,
}
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Preferences {
    pub main_off: bool,
    pub mic: Option<listen::Saved>,
}
#[derive(Default)]
pub struct Runtime {
    pub operation: Mutex<()>,
    /// Lanes reserved for the startup worker, cleared by a successful user choice.
    pub startup: AtomicU8,
    pub preferences: Mutex<Preferences>,
    pub mic: Mutex<Option<listen::Listening>>,
    mixer: Arc<Mixer>,
    started: AtomicBool,
    pub suspended: AtomicBool,
}
#[derive(Default)]
struct Mixer {
    ports: Mutex<[Option<Arc<Mutex<Port>>>; 2]>,
    paused: AtomicBool,
}
pub struct Port {
    samples: VecDeque<[f32; 2]>,
    rate: f64,
    phase: f64,
    updated: Instant,
}
impl Port {
    fn new() -> Self {
        Self { samples: VecDeque::with_capacity(16384), rate: RATE as f64, phase: 0.0, updated: Instant::now() }
    }
    fn push(&mut self, frames: &[[f32; 2]], now: Instant) {
        for frame in frames {
            if self.samples.len() >= (self.rate * 0.05).clamp(2.0, 16384.0) as usize {
                self.samples.pop_front();
            }
            self.samples.push_back(frame.map(clean));
        }
        self.updated = now;
    }
    fn skip(&mut self, output_frames: u64) {
        let position = self.phase + output_frames as f64 * self.rate / RATE as f64;
        let count = (position as usize).min(self.samples.len());
        self.samples.drain(..count);
        self.phase = if self.samples.is_empty() { 0.0 } else { position.fract() };
    }
    fn sample(&mut self, now: Instant) -> [f32; 2] {
        if now.saturating_duration_since(self.updated) > Duration::from_millis(100) {
            self.samples.clear();
            self.phase = 0.0;
            return [0.0; 2];
        }
        if self.samples.len() < 2 {
            return [0.0; 2];
        }
        let a = self.samples[0];
        let b = self.samples[1];
        let value = [a[0] + (b[0] - a[0]) * self.phase as f32, a[1] + (b[1] - a[1]) * self.phase as f32];
        self.phase += self.rate / RATE as f64;
        while self.phase >= 1.0 && !self.samples.is_empty() {
            self.samples.pop_front();
            self.phase -= 1.0;
        }
        if self.samples.is_empty() {
            self.phase = 0.0;
        }
        value
    }
}
fn clean(s: f32) -> f32 {
    if s.is_finite() { s.clamp(-1.0, 1.0) } else { 0.0 }
}
fn mix(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [clean(a[0] + b[0]), clean(a[1] + b[1])]
}
impl Runtime {
    pub fn prepare(&self) -> (Arc<Mutex<Port>>, Sink) {
        let port = Arc::new(Mutex::new(Port::new()));
        let write = port.clone();
        let sink = Sink::new(move |frames| {
            if let Ok(mut port) = write.try_lock() {
                port.push(frames, Instant::now());
            }
        });
        (port, sink)
    }
    pub fn commit(&self, lane: Lane, port: Arc<Mutex<Port>>, rate: f32, output: Ring) {
        port.lock().unwrap().rate = rate.max(1.0) as f64;
        self.mixer.ports.lock().unwrap()[lane.index()] = Some(port);
        if !self.started.swap(true, Ordering::Relaxed) {
            let weak = Arc::downgrade(&self.mixer);
            std::thread::spawn(move || {
                let start = Instant::now();
                let mut made = 0u64;
                while let Some(mixer) = weak.upgrade() {
                    let now = Instant::now();
                    let due = (start.elapsed().as_secs_f64() * RATE as f64) as u64;
                    let elapsed = due.saturating_sub(made);
                    let count = elapsed.min(WINDOW as u64) as usize;
                    let skipped = elapsed.saturating_sub(count as u64);
                    made = due;
                    {
                        let ports = mixer.ports.lock().unwrap();
                        if !mixer.paused.load(Ordering::Relaxed) {
                            if ports.iter().any(Option::is_some) {
                                let mut a = ports[0].as_ref().and_then(|p| p.try_lock().ok());
                                let mut b = ports[1].as_ref().and_then(|p| p.try_lock().ok());
                                if let Some(a) = a.as_mut() {
                                    a.skip(skipped);
                                }
                                if let Some(b) = b.as_mut() {
                                    b.skip(skipped);
                                }
                                let mut block = [[0.0; 2]; WINDOW];
                                for value in &mut block[..count] {
                                    *value = mix(a.as_mut().map_or([0.0; 2], |p| p.sample(now)), b.as_mut().map_or([0.0; 2], |p| p.sample(now)));
                                }
                                drop(a);
                                drop(b);
                                let mut ring = output.lock().unwrap();
                                for value in &block[..count] {
                                    ring.0.push_back(value[0]);
                                    ring.1.push_back(value[1]);
                                }
                                while ring.0.len() > WINDOW {
                                    ring.0.pop_front();
                                    ring.1.pop_front();
                                }
                            }
                        }
                    }
                    drop(mixer);
                    std::thread::sleep(Duration::from_millis(4));
                }
            });
        }
    }
    pub fn clear(&self, lane: Lane, output: &Ring) {
        let mut ports = self.mixer.ports.lock().unwrap();
        ports[lane.index()] = None;
        if ports.iter().all(Option::is_none) {
            let mut ring = output.lock().unwrap();
            ring.0.iter_mut().for_each(|s| *s = 0.0);
            ring.1.iter_mut().for_each(|s| *s = 0.0);
        }
    }
    pub fn pause(&self, on: bool) {
        let _ports = self.mixer.ports.lock().unwrap();
        self.suspended.store(on, Ordering::Relaxed);
        self.mixer.paused.store(on, Ordering::Relaxed);
    }
}
#[tauri::command(async)]
pub fn audio_status(app: State<App>) -> Status {
    listen::status(&app)
}
#[tauri::command(async)]
pub fn choose_audio_lane(lane: Lane, source: Option<listen::SourceId>, left: Option<usize>, right: Option<usize>, app: State<App>) -> Result<Status, String> {
    listen::choose_lane(&app, lane, source, left, right)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_both_lanes_and_preserves_either_alone() {
        assert_eq!(mix([0.2, -0.4], [0.3, 0.1]), [0.5, -0.3]);
        assert_eq!(mix([0.2, -0.4], [0.0; 2]), [0.2, -0.4]);
        assert_eq!(mix([0.0; 2], [0.3, 0.1]), [0.3, 0.1]);
        assert_eq!(mix([0.0; 2], [0.0; 2]), [0.0; 2]);
    }
    #[test]
    fn sanitizes_samples_and_bounds_sum() {
        let now = Instant::now();
        let mut p = Port::new();
        p.push(&[[f32::NAN, f32::INFINITY], [0.5, -0.5]], now);
        assert_eq!(p.sample(now), [0.0; 2]);
        assert_eq!(mix([0.8, -0.8], [0.7, -0.7]), [1.0, -1.0]);
    }
    #[test]
    fn interpolates_different_rates_without_changing_single_source_gain() {
        let now = Instant::now();
        let mut p = Port::new();
        p.rate = 24000.0;
        p.push(&[[0.0; 2], [0.5; 2], [1.0; 2]], now);
        assert_eq!(p.sample(now), [0.0; 2]);
        assert_eq!(p.sample(now), [0.25; 2]);
        assert_eq!(p.sample(now), [0.5; 2]);
        let mut p = Port::new();
        p.rate = 96000.0;
        p.push(&[[0.1; 2], [0.2; 2], [0.3; 2], [0.4; 2]], now);
        assert_eq!(p.sample(now), [0.1; 2]);
        assert_eq!(p.sample(now), [0.3; 2]);
    }
    #[test]
    fn stalled_source_goes_silent_and_discards_backlog() {
        let now = Instant::now();
        let mut p = Port::new();
        p.push(&[[0.5; 2]; 20], now);
        assert_eq!(p.sample(now + Duration::from_millis(101)), [0.0; 2]);
        assert!(p.samples.is_empty());
    }
    #[test]
    fn callback_never_waits_for_consumer_and_queue_is_bounded() {
        let runtime = Runtime::default();
        let (port, sink) = runtime.prepare();
        let hold = port.lock().unwrap();
        sink.write(&[[1.0; 2]]);
        drop(hold);
        assert!(port.lock().unwrap().samples.is_empty());
        sink.write(&[[0.2; 2]; 20000]);
        assert_eq!(port.lock().unwrap().samples.len(), 2400);
    }
    #[test]
    fn consumer_stall_drops_old_time_while_producer_continues() {
        let now = Instant::now();
        let mut p = Port::new();
        p.push(&[[0.1; 2]; 4800], now);
        p.push(&[[0.8; 2]; 1024], now + Duration::from_millis(100));
        assert!(p.samples.len() <= 2400);
        p.skip(4800 - 1024);
        assert!(p.samples.is_empty());
        p.push(&[[0.9; 2]; 256], now + Duration::from_millis(104));
        assert_eq!(p.sample(now + Duration::from_millis(104)), [0.9; 2]);
    }
    #[test]
    fn off_cannot_be_overwritten_by_a_previous_worker_snapshot() {
        let runtime = Runtime::default();
        let output = engine::live::ring();
        let (port, sink) = runtime.prepare();
        sink.write(&[[0.5; 2]; 2000]);
        runtime.commit(Lane::Main, port, RATE, output.clone());
        std::thread::sleep(Duration::from_millis(12));
        runtime.clear(Lane::Main, &output);
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(engine::live::peaks(&output), (0.0, 0.0));
    }
    #[test]
    fn pause_preserves_a_test_sound_written_after_it_returns() {
        let runtime = Runtime::default();
        let output = engine::live::ring();
        let (port, sink) = runtime.prepare();
        sink.write(&[[0.5; 2]; 2000]);
        runtime.commit(Lane::Main, port, RATE, output.clone());
        runtime.pause(true);
        {
            let mut ring = output.lock().unwrap();
            ring.0.iter_mut().for_each(|s| *s = 0.7);
        }
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(engine::live::peaks(&output).0, 0.7);
    }
}
