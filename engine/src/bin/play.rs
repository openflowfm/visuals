//! The proof of concept: MilkDrop presets in a native window, on Metal, from any
//! audio input.
//!
//!   cargo run --release --bin play -- [folder or .milk files…] [options]
//!
//!   --input <name>     an input device whose name contains this (default: the system
//!                      input; `none` for silence)
//!   --channels L,R     which input channels are left and right, from 1 (default 1,2)
//!   --size WxH         the size the preset draws at (default 1920x1080)
//!   --every <seconds>  move to a random preset this often; 0 holds (default 0)
//!   --list-inputs      print the inputs and exit
//!
//! Keys: → or space next, ← previous, R random, F fullscreen, Esc quit.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use engine::audio::Audio;
use engine::render::Renderer;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Fullscreen, Window, WindowId};

const WINDOW: usize = 1024;

/// The latest `WINDOW` samples of the two chosen channels.
type Ring = Arc<Mutex<(VecDeque<f32>, VecDeque<f32>)>>;

struct Options {
    presets: Vec<PathBuf>,
    input: Option<String>,
    channels: (usize, usize),
    size: (u32, u32),
    every: f64,
}

fn options() -> Options {
    let mut args = std::env::args().skip(1);
    let mut o = Options { presets: Vec::new(), input: None, channels: (0, 1), size: (1920, 1080), every: 0.0 };
    let mut paths = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => o.input = args.next(),
            "--channels" => {
                if let Some((l, r)) = args.next().as_deref().and_then(|s| s.split_once(',')) {
                    o.channels = (l.parse::<usize>().unwrap_or(1).max(1) - 1, r.parse::<usize>().unwrap_or(2).max(1) - 1);
                }
            }
            "--size" => {
                if let Some((w, h)) = args.next().as_deref().and_then(|s| s.split_once('x')) {
                    o.size = (w.parse().unwrap_or(1920), h.parse().unwrap_or(1080));
                }
            }
            "--every" => o.every = args.next().and_then(|s| s.parse().ok()).unwrap_or(0.0),
            "--list-inputs" => {
                let host = cpal::default_host();
                for d in host.input_devices().into_iter().flatten() {
                    let name = d.description().map(|d| d.name().to_owned()).unwrap_or_default();
                    let channels = d.default_input_config().map(|c| c.channels()).unwrap_or(0);
                    println!("{name} ({channels} channels)");
                }
                std::process::exit(0);
            }
            _ => paths.push(PathBuf::from(arg)),
        }
    }
    if paths.is_empty() {
        paths.push(PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets"));
    }
    for p in paths {
        if p.is_dir() {
            walk(&p, &mut o.presets);
        } else {
            o.presets.push(p);
        }
    }
    o.presets.sort();
    o
}

fn walk(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("milk")) {
            out.push(path);
        }
    }
}

/// Open an input and keep the last `WINDOW` samples of two of its channels.
fn listen(input: Option<&str>, (left, right): (usize, usize)) -> Option<(cpal::Stream, Ring, f32)> {
    let host = cpal::default_host();
    let device = match input {
        Some(want) => host.input_devices().ok()?.find(|d| {
            d.description().map(|x| x.name().to_lowercase().contains(&want.to_lowercase())).unwrap_or(false)
        })?,
        None => host.default_input_device()?,
    };
    let config = device.default_input_config().ok()?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate() as f32;
    let name = device.description().map(|d| d.name().to_owned()).unwrap_or_default();
    let ring: Ring = Arc::new(Mutex::new((VecDeque::from(vec![0.0; WINDOW]), VecDeque::from(vec![0.0; WINDOW]))));
    let writer = ring.clone();
    let (l, r) = (left.min(channels - 1), right.min(channels - 1));
    let stream = device
        .build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                if let Ok(mut ring) = writer.try_lock() {
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
        .ok()?;
    stream.play().ok()?;
    eprintln!("listening to {name}, channels {} and {}, at {rate} Hz", l + 1, r + 1);
    Some((stream, ring, rate))
}

struct App {
    options: Options,
    window: Option<Arc<Window>>,
    surface: Option<wgpu::Surface<'static>>,
    config: Option<wgpu::SurfaceConfiguration>,
    renderer: Option<Renderer>,
    audio: Audio,
    ring: Option<Ring>,
    _stream: Option<cpal::Stream>,
    index: usize,
    last: Instant,
    changed: Instant,
    frames: u32,
    timing: (Instant, f64),
    rng: engine::eel::Memory,
}

impl App {
    fn load(&mut self, index: usize) {
        let Some(renderer) = self.renderer.as_mut() else { return };
        let total = self.options.presets.len();
        for step in 0..total {
            let i = (index + step) % total;
            let path = &self.options.presets[i];
            let text = engine::preset::decode(&std::fs::read(path).unwrap_or_default());
            match renderer.load(&text, i as u64 + 1) {
                Ok(loaded) => {
                    self.index = i;
                    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    let note = if loaded.fell_back.is_empty() { String::new() } else { format!(" ({} shader fell back)", loaded.fell_back.len()) };
                    println!("[{}/{}] {name}{note}", i + 1, total);
                    if let Some(w) = &self.window {
                        w.set_title(&format!("visual[flow] — {name}"));
                    }
                    self.changed = Instant::now();
                    return;
                }
                Err(e) => eprintln!("skipping {}: {e}", path.display()),
            }
        }
    }

    fn step(&mut self, by: isize) {
        let n = self.options.presets.len() as isize;
        if n > 0 {
            self.load(((self.index as isize + by).rem_euclid(n)) as usize);
        }
    }

    fn random(&mut self) {
        let n = self.options.presets.len();
        if n > 0 {
            let i = (self.rng.random() * n as f64) as usize;
            self.load(i);
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = Arc::new(
            event_loop
                .create_window(Window::default_attributes().with_title("visual[flow]").with_inner_size(winit::dpi::LogicalSize::new(1280, 720)))
                .expect("window"),
        );
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(window.clone()).expect("surface");
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .expect("adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).expect("device");
        let caps = surface.get_capabilities(&adapter);
        // A plain (not sRGB) format: WebGL writes colour values as they are.
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
        let size = window.inner_size();
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).expect("surface config");
        config.format = format;
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&device, &config);
        self.renderer = Some(Renderer::new(device, queue, self.options.size.0, self.options.size.1));
        self.window = Some(window.clone());
        self.surface = Some(surface);
        self.config = Some(config);
        self.load(0);
        window.request_redraw();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let (Some(surface), Some(config), Some(renderer)) = (&self.surface, &mut self.config, &self.renderer) {
                    config.width = size.width.max(1);
                    config.height = size.height.max(1);
                    surface.configure(renderer.device(), config);
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent { logical_key, state: ElementState::Pressed, .. }, .. } => match logical_key {
                Key::Named(NamedKey::ArrowRight | NamedKey::Space) => self.step(1),
                Key::Named(NamedKey::ArrowLeft) => self.step(-1),
                Key::Named(NamedKey::Escape) => event_loop.exit(),
                Key::Character(c) if c.eq_ignore_ascii_case("r") => self.random(),
                Key::Character(c) if c.eq_ignore_ascii_case("f") => {
                    if let Some(w) = &self.window {
                        w.set_fullscreen(if w.fullscreen().is_some() { None } else { Some(Fullscreen::Borderless(None)) });
                    }
                }
                _ => {}
            },
            WindowEvent::RedrawRequested => {
                // At the preset rate, not the display's (`runtime::FRAME_RATE`).
                let frame = 1.0 / engine::runtime::FRAME_RATE;
                let early = frame - self.last.elapsed().as_secs_f64();
                if early > 0.0 {
                    std::thread::sleep(std::time::Duration::from_secs_f64(early));
                }
                let now = Instant::now();
                let elapsed = now.duration_since(self.last).as_secs_f64().clamp(0.001, 0.25);
                self.last = now;
                if self.options.every > 0.0 && now.duration_since(self.changed).as_secs_f64() > self.options.every {
                    self.random();
                }
                if let Some(ring) = &self.ring {
                    let (l, r): (Vec<f32>, Vec<f32>) = {
                        let ring = ring.lock().unwrap();
                        (ring.0.iter().copied().collect(), ring.1.iter().copied().collect())
                    };
                    self.audio.update(&l, &r);
                }
                let (Some(renderer), Some(surface), Some(config)) = (self.renderer.as_mut(), &self.surface, &self.config) else { return };
                let started = Instant::now();
                renderer.render(&mut self.audio, elapsed);
                match surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                        let view = frame.texture.create_view(&Default::default());
                        renderer.present(&view, config.format);
                        renderer.queue().present(frame);
                    }
                    _ => surface.configure(renderer.device(), config),
                }
                self.timing.1 += started.elapsed().as_secs_f64();
                self.frames += 1;
                if now.duration_since(self.timing.0).as_secs_f64() >= 5.0 {
                    let secs = now.duration_since(self.timing.0).as_secs_f64();
                    eprintln!("{:.0} fps, {:.2} ms CPU per frame", self.frames as f64 / secs, self.timing.1 * 1000.0 / self.frames as f64);
                    self.frames = 0;
                    self.timing = (now, 0.0);
                }
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            _ => {}
        }
    }
}

fn main() {
    let options = options();
    if options.presets.is_empty() {
        eprintln!("no .milk presets found");
        std::process::exit(1);
    }
    let heard = if options.input.as_deref() == Some("none") { None } else { listen(options.input.as_deref(), options.channels) };
    if heard.is_none() {
        eprintln!("no audio input; presets will move to silence");
    }
    let mut audio = Audio::default();
    let (stream, ring) = match heard {
        Some((stream, ring, rate)) => {
            audio.set_sample_rate(rate);
            (Some(stream), Some(ring))
        }
        None => (None, None),
    };
    let event_loop = EventLoop::new().expect("event loop");
    let now = Instant::now();
    let mut app = App {
        options,
        window: None,
        surface: None,
        config: None,
        renderer: None,
        audio,
        ring,
        _stream: stream,
        index: 0,
        last: now,
        changed: now,
        frames: 0,
        timing: (now, 0.0),
        rng: engine::eel::Memory::new(now.elapsed().as_nanos() as u64 ^ 0x9e37_79b9),
    };
    event_loop.run_app(&mut app).expect("run");
}
