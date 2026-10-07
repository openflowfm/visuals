//! Audio in: any Core Audio input, two of its channels, the last `WINDOW` samples
//! of each kept for the render thread to read once a frame.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

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

/// Where the last choice is kept, so the app comes back listening to it.
fn saved_at() -> std::path::PathBuf {
    let home = std::env::var_os("OPENFLOW_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow"));
    home.join("visuals").join("audio.json")
}

pub fn save(choice: &Choice) {
    let path = saved_at();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(choice) {
        let _ = std::fs::write(path, text);
    }
}

pub fn saved() -> Option<Choice> {
    serde_json::from_str(&std::fs::read_to_string(saved_at()).ok()?).ok()
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
