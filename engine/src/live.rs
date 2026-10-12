//! What a live player shares, the app's bench and the `play` binary alike: the
//! microphone ring an input stream writes into and the render loop reads once a
//! frame, and a window surface set up for the renderer. Finding the device,
//! logging and error types stay with each caller.

use crate::render::Renderer;
use cpal::traits::{DeviceTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// How many of the latest samples the ring keeps of each channel.
pub const WINDOW: usize = 1024;

/// The latest `WINDOW` samples of the left and right channels.
pub type Ring = Arc<Mutex<(VecDeque<f32>, VecDeque<f32>)>>;

/// A ring of silence.
pub fn ring() -> Ring {
    Arc::new(Mutex::new((VecDeque::from(vec![0.0; WINDOW]), VecDeque::from(vec![0.0; WINDOW]))))
}

/// The loudest sample in each channel's latest window, 0–1, for a meter.
pub fn peaks(ring: &Ring) -> (f32, f32) {
    let ring = ring.lock().unwrap();
    let peak = |d: &VecDeque<f32>| d.iter().fold(0f32, |m, s| m.max(s.abs())).min(1.0);
    (peak(&ring.0), peak(&ring.1))
}

/// An open input stream. Dropping `stream` stops listening.
pub struct Input {
    pub stream: cpal::Stream,
    pub rate: f32,
    /// How many channels the input has.
    pub channels: usize,
    /// The two it is listening to, from 0: the ones asked for, kept within the input's.
    pub left: usize,
    pub right: usize,
}

/// Open `device` and write its channels `left` and `right` (from 0) into `ring`.
/// The ring is the caller's, so it can outlive a switch to another input.
/// A nonblocking callback destination shared by device and process-tap inputs.
#[derive(Clone)]
pub struct Sink(Arc<dyn Fn(&[[f32; 2]]) + Send + Sync>);
impl Sink {
    pub fn new(write: impl Fn(&[[f32; 2]]) + Send + Sync + 'static) -> Self {
        Self(Arc::new(write))
    }
    pub fn write(&self, frames: &[[f32; 2]]) {
        (self.0)(frames);
    }
    pub fn ring(ring: Ring) -> Self {
        Self::new(move |frames| {
            if let Ok(mut ring) = ring.try_lock() {
                for &[l, r] in frames {
                    ring.0.push_back(l);
                    ring.1.push_back(r);
                }
                while ring.0.len() > WINDOW {
                    ring.0.pop_front();
                    ring.1.pop_front();
                }
            }
        })
    }
}
pub fn open_input(device: &cpal::Device, channels: (usize, usize), ring: Ring) -> Result<Input, String> {
    open_input_sink(device, channels, Sink::ring(ring))
}
pub fn open_input_sink(device: &cpal::Device, (left, right): (usize, usize), sink: Sink) -> Result<Input, String> {
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    if channels == 0 {
        return Err("input has no channels".into());
    }
    let rate = config.sample_rate() as f32;
    let (l, r) = (left.min(channels - 1), right.min(channels - 1));
    fn build<T: cpal::SizedSample>(device: &cpal::Device, config: &cpal::StreamConfig, sink: Sink, channels: usize, l: usize, r: usize) -> Result<cpal::Stream, String>
    where
        f32: cpal::FromSample<T>,
    {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[T], _| {
                    let mut block = [[0.0; 2]; 256];
                    for chunk in data.chunks(channels * 256) {
                        let mut count = 0;
                        for frame in chunk.chunks_exact(channels) {
                            block[count] = [frame[l].to_sample::<f32>(), frame[r].to_sample::<f32>()];
                            count += 1;
                        }
                        sink.write(&block[..count]);
                    }
                },
                |e| eprintln!("audio input stopped: {e}"),
                None,
            )
            .map_err(|e| e.to_string())
    }
    macro_rules! open {
        ($t:ty) => {
            build::<$t>(device, &config.into(), sink, channels, l, r)?
        };
    }
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => open!(f32),
        cpal::SampleFormat::F64 => open!(f64),
        cpal::SampleFormat::I8 => open!(i8),
        cpal::SampleFormat::I16 => open!(i16),
        cpal::SampleFormat::I32 => open!(i32),
        cpal::SampleFormat::I64 => open!(i64),
        cpal::SampleFormat::U8 => open!(u8),
        cpal::SampleFormat::U16 => open!(u16),
        cpal::SampleFormat::U32 => open!(u32),
        cpal::SampleFormat::U64 => open!(u64),
        other => return Err(format!("unsupported input format: {other}")),
    };
    stream.play().map_err(|e| e.to_string())?;
    Ok(Input { stream, rate, channels, left: l, right: r })
}

/// A high-performance adapter that can present to `surface`, and its device.
pub fn surface_device(instance: &wgpu::Instance, surface: &wgpu::Surface) -> (wgpu::Adapter, wgpu::Device, wgpu::Queue) {
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: Some(surface),
        ..Default::default()
    }))
    .expect("a GPU adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).expect("a GPU device");
    (adapter, device, queue)
}

/// How a surface is set up: a plain (not sRGB) format, as WebGL writes colour
/// values as they are, and presenting on the display's refresh.
pub fn configuration(adapter: &wgpu::Adapter, surface: &wgpu::Surface, size: (u32, u32)) -> wgpu::SurfaceConfiguration {
    let caps = surface.get_capabilities(adapter);
    let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
    let mut config = surface.get_default_config(adapter, size.0.max(1), size.1.max(1)).expect("surface config");
    config.format = format;
    config.present_mode = wgpu::PresentMode::AutoVsync;
    config
}

/// Show the latest picture on one surface; a surface that has no texture to
/// give (resized, lost) is set up again and skipped this time.
pub fn show(renderer: &mut Renderer, surface: &wgpu::Surface, config: &wgpu::SurfaceConfiguration) {
    match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
            let view = frame.texture.create_view(&Default::default());
            renderer.present(&view, config.format, (config.width, config.height));
            renderer.queue().present(frame);
        }
        _ => surface.configure(renderer.device(), config),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_ring_is_a_window_of_silence() {
        let ring = ring();
        let (l, r) = &*ring.lock().unwrap();
        assert_eq!((l.len(), r.len()), (WINDOW, WINDOW));
        assert!(l.iter().chain(r).all(|&s| s == 0.0));
    }

    #[test]
    fn peaks_are_the_loudest_sample_of_each_channel_up_to_one() {
        let ring = ring();
        {
            let mut ring = ring.lock().unwrap();
            ring.0[3] = -0.5;
            ring.0[7] = 0.25;
            ring.1[0] = 3.0;
        }
        assert_eq!(peaks(&ring), (0.5, 1.0));
    }
}
