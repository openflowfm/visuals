//! The hover preview: the preset under the pointer in Home's library, drawing in
//! its tile.
//!
//! A second engine render on a thread and GPU device of its own, so the bench
//! and the live output never wait on it or share its work: it draws one preset
//! at a tile's size, about thirty times a second, from the same sound the bench
//! hears, and keeps the latest picture for the page to read ([`frame`]). It
//! draws only while a tile is hovered ([`show`] to [`stop`]); idle for
//! [`IDLE`], the thread ends and lets its device go, and the next [`show`]
//! starts another.
//!
//! It draws the preset as the bench would play it ([`Tuning`]): at the
//! preset's own speed, hearing the bench's sensitivity times the preset's own.

use crate::fx::Fx;
use crate::userlib::PresetTune;
use engine::audio::Audio;
use engine::live::Ring;
use engine::preset::Preset;
use engine::render::Renderer;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

/// The largest picture drawn: a big tile on a 2× display. More only costs.
pub const MAX: (u32, u32) = (640, 360);

/// The bytes before the picture in [`frame`]: ticket, count, width and height.
pub const HEADER: usize = 16;

/// How long between pictures: thirty a second, a preset's own step rate.
const EVERY: Duration = Duration::from_nanos(1_000_000_000 / 30);

/// How long the thread waits with nothing hovered before it lets its device go.
const IDLE: Duration = Duration::from_secs(30);

/// `width`×`height` kept within [`MAX`] and at least 16×9, keeping its aspect (near enough).
pub fn clamp(width: u32, height: u32) -> (u32, u32) {
    let (w, h) = (width.max(16) as f64, height.max(9) as f64);
    let scale = (MAX.0 as f64 / w).min(MAX.1 as f64 / h).min(1.0);
    (((w * scale).round() as u32).max(1), ((h * scale).round() as u32).max(1))
}

/// A picture as the page reads it: four little-endian u32s — the ticket of the
/// hover it is of ([`show`]'s answer), its count (which [`frame`] is asked
/// after), its width and its height — then its RGBA rows, top to bottom. A
/// hover whose preset failed is the header alone, 0×0.
pub fn packed(ticket: u32, count: u32, picture: &super::Picture) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER + picture.2.len());
    for n in [ticket, count, picture.0, picture.1] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&picture.2);
    out
}

/// How a hovered preset is drawn: its own speed and sensitivity, and the
/// bench's effects for the sensitivity the user set. The default is untuned:
/// as made, hearing the sound as it is.
#[derive(Default, Clone)]
pub struct Tuning {
    /// The hovered preset's own tune (`crate::tune`).
    pub own: PresetTune,
    /// The bench's effects, read each picture so a sensitivity changed while
    /// hovering is heard at once.
    pub fx: Option<Arc<Mutex<Fx>>>,
}

impl Tuning {
    /// The speed and the gain on what the preset hears, now. The speed is the
    /// preset's own alone: the live or playlist speed is the bench's (frozen,
    /// it would freeze every hover too). The gain is the bench's sensitivity
    /// times the preset's own, never `Fx::gain`, which carries the playing
    /// preset's tune rather than this one's.
    fn now(&self) -> (f64, f32) {
        let bench = self.fx.as_ref().map_or(1.0, |fx| fx.lock().map_or(1.0, |fx| fx.settings.sensitivity));
        (self.own.speed(), (bench * self.own.sensitivity()) as f32)
    }
}

/// The hovered preset at `path` as the bench would play it: its own tune
/// (`crate::userlib::tune_of`) and the bench's effects.
// preview.rs's `hover_preview` calls this once it passes its AppHandle and path.
#[allow(dead_code)]
pub fn tuning(handle: &tauri::AppHandle, path: &Path) -> Tuning {
    Tuning { own: crate::userlib::tune_of(handle, path), fx: handle.try_state::<crate::actions::Deck>().map(|deck| deck.fx.clone()) }
}

/// What the preset hears: `samples` scaled by `gain`, as the bench scales its own.
fn heard<'a>(samples: impl Iterator<Item = &'a f32>, gain: f32) -> Vec<f32> {
    samples.map(|s| s * gain).collect()
}

enum Ask {
    Show { preset: Box<Preset>, seed: u64, size: (u32, u32), ticket: u32, tuning: Tuning },
    Stop,
}

/// The thread's commands, while it runs.
static THREAD: Mutex<Option<Sender<Ask>>> = Mutex::new(None);
/// The latest picture of the hover, and whether its preset failed.
struct Latest {
    /// [`packed`]; empty when none.
    bytes: Vec<u8>,
    /// Counts every picture stored, so the page can ask only for a newer one.
    count: u32,
    /// The ticket whose preset failed to load or draw (0: none).
    failed: u32,
}

static FRAME: Mutex<Latest> = Mutex::new(Latest { bytes: Vec::new(), count: 0, failed: 0 });
/// The last hover's ticket.
static TICKET: AtomicU32 = AtomicU32::new(0);

/// Start drawing `preset` at `size` (clamped, [`clamp`]) in place of whatever
/// was hovered, hearing `ring`. Returns its ticket: the pictures of this hover
/// carry it, so a picture of the last one is never shown in this one's tile.
pub fn show(preset: Preset, size: (u32, u32), ring: &Ring) -> u32 {
    show_tuned(preset, size, ring, Tuning::default())
}

/// [`show`], drawing `preset` with `tuning` ([`tuning`]) rather than as made.
// preview.rs's `hover_preview` calls this once it passes its AppHandle and path.
#[allow(dead_code)]
pub fn show_tuned(preset: Preset, size: (u32, u32), ring: &Ring, tuning: Tuning) -> u32 {
    let ticket = next_ticket();
    let seed = std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1);
    let mut ask = Ask::Show { preset: Box::new(preset), seed, size: clamp(size.0, size.1), ticket, tuning };
    let mut thread = THREAD.lock().unwrap();
    if let Some(tx) = thread.as_ref() {
        match tx.send(ask) {
            Ok(()) => return ticket,
            // It ended (idle, or its device wouldn't start): start another.
            Err(std::sync::mpsc::SendError(back)) => ask = back,
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = tx.send(ask);
    let ring = ring.clone();
    match std::thread::Builder::new().name("hover".into()).spawn(move || run(rx, ring)) {
        Ok(_) => *thread = Some(tx),
        Err(e) => eprintln!("hover: no thread ({e})"),
    }
    ticket
}

/// Stop drawing: nothing is hovered, or the page went away.
pub fn stop() {
    if let Some(tx) = THREAD.lock().unwrap().as_ref() {
        let _ = tx.send(Ask::Stop);
    }
    next_ticket();
}

/// A new ticket, the last picture let go with the old one. Under the picture's
/// lock, so a picture of the old ticket being stored now can't land after.
fn next_ticket() -> u32 {
    let mut frame = FRAME.lock().unwrap();
    frame.bytes.clear();
    frame.failed = 0;
    TICKET.fetch_add(1, Ordering::Relaxed).wrapping_add(1)
}

/// The latest picture, [`packed`], when it is newer than the one counted
/// `after`; empty when there is none newer. A hover whose preset failed answers
/// its header alone (0×0), so the page stops asking.
pub fn frame(after: u32) -> Vec<u8> {
    let latest = FRAME.lock().unwrap();
    let ticket = TICKET.load(Ordering::Relaxed);
    if latest.failed != 0 && latest.failed == ticket {
        return packed(ticket, latest.count, &(0, 0, Vec::new()));
    }
    if latest.bytes.is_empty() || latest.count == after {
        return Vec::new();
    }
    latest.bytes.clone()
}

/// Mark `ticket`'s preset failed, while it is still the hover asked for.
fn fail(ticket: u32) {
    let mut frame = FRAME.lock().unwrap();
    if TICKET.load(Ordering::Relaxed) == ticket {
        frame.bytes.clear();
        frame.failed = ticket;
    }
}

/// What the thread is drawing.
struct Drawing {
    ticket: u32,
    size: (u32, u32),
    last: Instant,
    tuning: Tuning,
}

fn run(rx: Receiver<Ask>, ring: Ring) {
    let Some((device, queue)) = engine::render::headless() else {
        eprintln!("hover: no GPU device; no hover previews");
        return;
    };
    let mut renderer: Option<Renderer> = None;
    let mut audio = Audio::default();
    let mut drawing: Option<Drawing> = None;
    loop {
        let ask = if drawing.is_some() {
            match rx.try_recv() {
                Ok(ask) => Some(ask),
                Err(std::sync::mpsc::TryRecvError::Empty) => None,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return,
            }
        } else {
            match rx.recv_timeout(IDLE) {
                Ok(ask) => Some(ask),
                Err(RecvTimeoutError::Timeout) => {
                    // Let go of the slot first, so a `show` from now on starts another thread.
                    let mut thread = THREAD.lock().unwrap();
                    // One that came in meanwhile is drawn rather than dropped.
                    match rx.try_recv() {
                        Ok(ask) => {
                            drop(thread);
                            Some(ask)
                        }
                        Err(_) => {
                            *thread = None;
                            return;
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        if let Some(ask) = ask {
            match ask {
                Ask::Stop => drawing = None,
                Ask::Show { preset, seed, size, ticket, tuning } => {
                    let r = renderer.get_or_insert_with(|| Renderer::new(device.clone(), queue.clone(), size.0, size.1));
                    if r.output_size() != size {
                        r.resize(size.0, size.1);
                    }
                    drawing = match super::survive(|| r.load_preset(*preset, seed)) {
                        Ok(Ok(_)) => Some(Drawing { ticket, size, last: Instant::now(), tuning }),
                        Ok(Err(e)) => {
                            eprintln!("hover: the preset didn't load ({e})");
                            fail(ticket);
                            None
                        }
                        Err(why) => {
                            eprintln!("hover: the preset panicked loading ({why})");
                            fail(ticket);
                            None
                        }
                    };
                }
            }
            continue;
        }
        let (Some(d), Some(r)) = (drawing.as_mut(), renderer.as_mut()) else { continue };
        let now = Instant::now();
        let elapsed = now.duration_since(d.last).as_secs_f64().min(0.25);
        d.last = now;
        let (speed, gain) = d.tuning.now();
        {
            let ring = ring.lock().unwrap();
            let (l, r) = (heard(ring.0.iter(), gain), heard(ring.1.iter(), gain));
            audio.update(&l, &r);
        }
        let (ticket, size) = (d.ticket, d.size);
        match super::survive(|| {
            r.render(&mut audio, elapsed * speed);
            super::snapshot(r, size)
        }) {
            Ok(Some(picture)) => {
                // Only while it is still the hover asked for: a stop or a newer show clears it.
                let mut frame = FRAME.lock().unwrap();
                if TICKET.load(Ordering::Relaxed) == ticket {
                    frame.count = frame.count.wrapping_add(1).max(1);
                    frame.bytes = packed(ticket, frame.count, &picture);
                }
            }
            Ok(None) => {}
            Err(why) => {
                eprintln!("hover: the preset panicked drawing ({why}); stopped");
                fail(ticket);
                drawing = None;
                continue;
            }
        }
        std::thread::sleep(EVERY.saturating_sub(now.elapsed()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hover is one per app: tests that use it take turns.
    static ONE: Mutex<()> = Mutex::new(());

    /// The bench's effects with the live speed 2 and sensitivity 1.5, playing a
    /// preset tuned to half speed and twice the sensitivity.
    fn bench() -> Arc<Mutex<Fx>> {
        let now = Instant::now();
        let mut fx = Fx::new(now);
        fx.apply(&crate::fx::FxAction::Speed { speed: 2.0 }, now).unwrap();
        fx.apply(&crate::fx::FxAction::Sensitivity { value: 1.5 }, now).unwrap();
        fx.tune = crate::fx::Tune { speed: 0.5, sensitivity: 2.0 };
        Arc::new(Mutex::new(fx))
    }

    #[test]
    fn an_untuned_hover_draws_as_made() {
        assert_eq!(Tuning::default().now(), (1.0, 1.0));
    }

    #[test]
    fn a_hover_takes_its_own_tune_and_the_benchs_sensitivity_but_not_the_playing_presets() {
        let own = PresetTune { speed: Some(0.25), sensitivity: Some(2.0) };
        assert_eq!(Tuning { own, fx: None }.now(), (0.25, 2.0), "its own tune alone");
        let fx = bench();
        let tuning = Tuning { own, fx: Some(fx.clone()) };
        // The live speed 2 and the playing preset's tune (0.5, 2) leave it be.
        assert_eq!(tuning.now(), (0.25, 3.0));
        fx.lock().unwrap().apply(&crate::fx::FxAction::Sensitivity { value: 0.5 }, Instant::now()).unwrap();
        assert_eq!(tuning.now(), (0.25, 1.0), "a sensitivity changed while hovering is heard at once");
        assert_eq!(Tuning { own: PresetTune::default(), fx: Some(fx) }.now(), (1.0, 0.5), "untuned: the bench's sensitivity alone");
    }

    #[test]
    fn the_sound_is_scaled_by_the_gain() {
        assert_eq!(heard([0.5, -0.25, 0.0].iter(), 2.0), vec![1.0, -0.5, 0.0]);
        assert_eq!(heard([0.5].iter(), 1.0), vec![0.5]);
    }

    #[test]
    fn sizes_stay_within_the_largest_and_keep_their_aspect() {
        assert_eq!(clamp(320, 180), (320, 180));
        assert_eq!(clamp(1280, 720), MAX);
        assert_eq!(clamp(2000, 500), (640, 160));
        assert_eq!(clamp(0, 0), (16, 9));
    }

    #[test]
    fn a_picture_goes_to_the_page_with_its_ticket_and_size() {
        let bytes = packed(7, 3, &(2, 1, vec![1, 2, 3, 4, 5, 6, 7, 8]));
        assert_eq!(&bytes[..HEADER], &[7, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(&bytes[HEADER..], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }

    /// The whole round on a GPU: a hovered preset's pictures come with its
    /// ticket and size, move, and stop with it. Passes without a GPU (nothing to draw on).
    #[test]
    fn a_hovered_preset_draws_moving_pictures_until_stopped() {
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        if engine::render::headless().is_none() {
            return;
        }
        let count = |f: &[u8]| u32::from_le_bytes(f[4..8].try_into().unwrap());
        let wait = |ticket: u32, after: Option<&Vec<u8>>| -> Option<Vec<u8>> {
            let until = Instant::now() + Duration::from_secs(20);
            while Instant::now() < until {
                let f = frame(after.map_or(0, |a| count(a)));
                if f.len() > HEADER && f[..4] == ticket.to_le_bytes() && after.is_none_or(|a| *a != f) {
                    return Some(f);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            None
        };
        // A wave that turns with time: no two pictures the same.
        let preset =
            engine::preset::parse("[preset00]\nnWaveMode=0\nzoom=1\nper_frame_1=wave_r=0.5+0.5*sin(time*7);wave_g=0.5+0.5*cos(time*5);\nper_frame_2=ob_size=0.1;ob_r=0.5+0.5*sin(time*3);ob_a=1;\n");
        let ticket = show(preset, (64, 36), &engine::live::ring());
        let first = wait(ticket, None).expect("a picture of the hovered preset");
        assert_eq!(&first[8..HEADER], &[64, 0, 0, 0, 36, 0, 0, 0]);
        assert_eq!(first.len(), HEADER + 64 * 36 * 4);
        let second = wait(ticket, Some(&first)).expect("the picture moves");
        assert_ne!(count(&second), count(&first));
        stop();
        assert!(frame(0).is_empty());
        std::thread::sleep(Duration::from_millis(200));
        assert!(frame(0).is_empty(), "no pictures once stopped");
    }

    /// The page polls with the count it last saw: the same picture is never sent twice,
    /// and a failed preset says so, so the page stops asking.
    #[test]
    fn a_picture_already_seen_is_not_sent_again_and_a_failure_is_said() {
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let ticket = next_ticket();
        {
            let mut latest = FRAME.lock().unwrap();
            latest.count = 41;
            latest.bytes = packed(ticket, 41, &(1, 1, vec![9, 9, 9, 9]));
        }
        assert_eq!(frame(40).len(), HEADER + 4);
        assert!(frame(41).is_empty(), "nothing newer than what the page has");
        fail(ticket);
        let said = frame(41);
        assert_eq!(said.len(), HEADER);
        assert_eq!(&said[..4], &ticket.to_le_bytes());
        assert_eq!(&said[8..HEADER], &[0; 8]);
        next_ticket();
        assert!(frame(0).is_empty(), "a new hover forgets the failure");
    }
}
