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
}

/// Open `input` (the system input when `None`) and write channels `left` and
/// `right` (from 0) into `ring`.
pub fn listen(input: Option<&str>, (left, right): (usize, usize), ring: Ring) -> Result<Listening, String> {
    let host = cpal::default_host();
    let device = match input {
        Some(want) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| name_of(d) == want)
            .ok_or_else(|| format!("no input called {want}"))?,
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
    Ok(Listening { _stream: stream, name: name_of(&device), rate })
}
