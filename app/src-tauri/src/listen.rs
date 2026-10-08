//! Audio in: any Core Audio input, two of its channels, the last `WINDOW` samples
//! of each kept for the render thread to read once a frame. The page's audio
//! commands, and the choice kept for next time.

use crate::{bench, App};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::State;

pub const WINDOW: usize = 1024;

/// The latest `WINDOW` samples of the left and right channels.
pub type Ring = Arc<Mutex<(VecDeque<f32>, VecDeque<f32>)>>;

pub fn ring() -> Ring {
    Arc::new(Mutex::new((VecDeque::from(vec![0.0; WINDOW]), VecDeque::from(vec![0.0; WINDOW]))))
}

fn name_of(d: &cpal::Device) -> String {
    d.description().map(|d| d.name().to_owned()).unwrap_or_default()
}

#[derive(serde::Serialize)]
pub struct Input {
    pub name: String,
    pub channels: u16,
}

#[tauri::command]
pub fn inputs() -> Vec<Input> {
    let host = cpal::default_host();
    host.input_devices()
        .into_iter()
        .flatten()
        .map(|d| Input { name: name_of(&d), channels: d.default_input_config().map(|c| c.channels()).unwrap_or(0) })
        .collect()
}

/// An open input. Dropping it stops listening.
pub struct Listening {
    _stream: cpal::Stream,
    pub name: String,
    pub rate: f32,
    /// How many channels the input has.
    pub channels: usize,
    /// The two it is listening to, from 0.
    pub left: usize,
    pub right: usize,
}

/// What is being listened to, as the page shows it: channels counted from 1.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    pub name: String,
    pub left: usize,
    pub right: usize,
    /// The input's channel count, which tells same-named inputs apart.
    #[serde(default)]
    pub size: usize,
}

impl Listening {
    pub fn choice(&self) -> Choice {
        Choice { name: self.name.clone(), left: self.left + 1, right: self.right + 1, size: self.channels }
    }
}

/// Where the last choice is kept in [`crate::settings::dir`], so the app comes
/// back listening to it.
const SAVED: &str = "audio.json";

/// Listen to `name` (the system input when absent), channels `left` and `right`
/// counted from 1. Returns the input's name.
#[tauri::command]
pub fn listen_to(name: Option<String>, size: Option<usize>, left: Option<usize>, right: Option<usize>, app: State<App>) -> Result<String, String> {
    let l = listen_on(&app, name.as_deref(), size, left, right)?;
    crate::settings::save_json(SAVED, &l);
    Ok(l.name)
}

/// Open an input and make it what the bench hears. Channels count from 1. The
/// new input opens before the old one closes, so a switch that fails leaves the
/// bench hearing what it heard.
fn listen_on(app: &App, name: Option<&str>, size: Option<usize>, left: Option<usize>, right: Option<usize>) -> Result<Choice, String> {
    let channels = (left.unwrap_or(1).max(1) - 1, right.unwrap_or(2).max(1) - 1);
    let mut listening = app.listening.lock().unwrap();
    let l = listen(name, size, channels, app.ring.clone())?;
    app.send(bench::Cmd::SampleRate(l.rate));
    let choice = l.choice();
    eprintln!("listening to {} on channels {} and {} of {}, at {} Hz", choice.name, choice.left, choice.right, l.channels, l.rate);
    *listening = Some(l);
    Ok(choice)
}

/// Come back listening to what was chosen last; the system input when that is
/// gone or nothing was chosen.
pub fn resume(app: &App) {
    let saved: Option<Choice> = crate::settings::load(SAVED);
    let heard = saved
        .as_ref()
        .and_then(|c| listen_on(app, Some(&c.name), Some(c.size), Some(c.left), Some(c.right)).ok())
        .map(Ok)
        .unwrap_or_else(|| listen_on(app, None, None, None, None));
    if let Err(e) = heard {
        eprintln!("no audio input: {e}");
    }
}

#[derive(serde::Serialize)]
pub struct Heard {
    /// The input and the two channels heard, from 1; absent when nothing is open.
    choice: Option<Choice>,
    /// How many channels the input has.
    channels: usize,
}

/// What the bench is listening to.
#[tauri::command]
pub fn listening(app: State<App>) -> Heard {
    let l = app.listening.lock().unwrap();
    Heard { choice: l.as_ref().map(|l| l.choice()), channels: l.as_ref().map_or(0, |l| l.channels) }
}

/// The loudest sample in the left and right channels' latest windows, for a meter.
#[tauri::command]
pub fn levels(app: State<App>) -> (f32, f32) {
    peaks(&app.ring)
}

/// The loudest sample in each channel's latest window, 0–1, for a meter.
pub fn peaks(ring: &Ring) -> (f32, f32) {
    let ring = ring.lock().unwrap();
    let peak = |d: &VecDeque<f32>| d.iter().fold(0f32, |m, s| m.max(s.abs())).min(1.0);
    (peak(&ring.0), peak(&ring.1))
}

/// Open `input` (the system input when `None`) and write channels `left` and
/// `right` (from 0) into `ring`.
/// `size`, when given, picks between inputs that share a name — macOS calls
/// every aggregate device "Aggregate Device" — by their channel count.
pub fn listen(input: Option<&str>, size: Option<usize>, (left, right): (usize, usize), ring: Ring) -> Result<Listening, String> {
    let host = cpal::default_host();
    let device = match input {
        Some(want) => {
            let named: Vec<cpal::Device> = host.input_devices().map_err(|e| e.to_string())?.filter(|d| name_of(d) == want).collect();
            let channels_of = |d: &cpal::Device| d.default_input_config().map(|c| c.channels() as usize).unwrap_or(0);
            let at = named.iter().position(|d| Some(channels_of(d)) == size).unwrap_or(0);
            named.into_iter().nth(at).ok_or_else(|| format!("no input called {want}"))?
        }
        None => host.default_input_device().ok_or("no system input")?,
    };
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate() as f32;
    let (l, r) = (left.min(channels - 1), right.min(channels - 1));
    let stream = device
        .build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                // Never wait on the render thread from the audio thread.
                if let Ok(mut ring) = ring.try_lock() {
                    for frame in data.chunks_exact(channels) {
                        ring.0.push_back(frame[l]);
                        ring.1.push_back(frame[r]);
                    }
                    while ring.0.len() > WINDOW {
                        ring.0.pop_front();
                        ring.1.pop_front();
                    }
                }
            },
            |e| eprintln!("audio input stopped: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Listening { _stream: stream, name: name_of(&device), rate, channels, left: l, right: r })
}
