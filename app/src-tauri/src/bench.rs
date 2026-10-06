//! The bench: a native view under the webview, drawn by the engine on its own
//! thread.
//!
//! The webview is transparent where the page leaves a hole for the bench, and the
//! page reports that hole's rectangle; the view is moved under it. No pixel of
//! the picture passes through the webview.

use crate::listen::Ring;
use engine::audio::Audio;
use engine::preset::Preset;
use engine::render::Renderer;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// The size presets draw at, whatever the size of the hole they are shown in.
pub const DRAW: (u32, u32) = (1920, 1080);

pub enum Cmd {
    Load(Box<Preset>, u64, Sender<Result<engine::render::Loaded, String>>),
    /// The surface's size in physical pixels.
    Resize(u32, u32),
    SampleRate(f32),
}

#[derive(Default, Clone, Copy, serde::Serialize)]
pub struct Stats {
    pub fps: f64,
    /// CPU time per frame: equations, mesh, waves and shapes, and encoding.
    pub cpu_ms: f64,
}

pub struct Thread {
    pub commands: Sender<Cmd>,
    pub stats: Arc<Mutex<Stats>>,
}

/// Start drawing into `surface`. Returns once the device is up.
pub fn start(instance: wgpu::Instance, surface: wgpu::Surface<'static>, size: (u32, u32), ring: Ring) -> Thread {
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: Some(&surface),
        ..Default::default()
    }))
    .expect("a GPU adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).expect("a GPU device");
    let caps = surface.get_capabilities(&adapter);
    // A plain (not sRGB) format: WebGL writes colour values as they are.
    let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
    let mut config = surface.get_default_config(&adapter, size.0.max(1), size.1.max(1)).expect("surface config");
    config.format = format;
    config.present_mode = wgpu::PresentMode::AutoVsync;
    surface.configure(&device, &config);
    let renderer = Renderer::new(device, queue, DRAW.0, DRAW.1);
    let (commands, rx) = std::sync::mpsc::channel();
    let stats = Arc::new(Mutex::new(Stats::default()));
    let out = stats.clone();
    std::thread::Builder::new()
        .name("bench".into())
        .spawn(move || run(renderer, surface, config, rx, ring, out))
        .expect("bench thread");
    Thread { commands, stats }
}

fn run(
    mut renderer: Renderer,
    surface: wgpu::Surface<'static>,
    mut config: wgpu::SurfaceConfiguration,
    rx: Receiver<Cmd>,
    ring: Ring,
    stats: Arc<Mutex<Stats>>,
) {
    let mut audio = Audio::default();
    let mut last = Instant::now();
    let mut window = (Instant::now(), 0u32, 0.0f64);
    let mut loaded = false;
    loop {
        // Block while there is nothing to draw, so a closed window costs nothing.
        let next = if loaded { rx.try_recv().ok() } else { rx.recv().ok() };
        if let Some(cmd) = next {
            match cmd {
                Cmd::Load(preset, seed, reply) => {
                    let result = renderer.load_preset(*preset, seed).map_err(|e| e.to_string());
                    loaded |= result.is_ok();
                    let _ = reply.send(result);
                }
                Cmd::Resize(w, h) => {
                    config.width = w.max(1);
                    config.height = h.max(1);
                    surface.configure(renderer.device(), &config);
                }
                Cmd::SampleRate(rate) => audio.set_sample_rate(rate),
            }
            continue;
        }
        let now = Instant::now();
        let elapsed = now.duration_since(last).as_secs_f64().clamp(0.001, 0.25);
        last = now;
        {
            let (l, r): (Vec<f32>, Vec<f32>) = {
                let ring = ring.lock().unwrap();
                (ring.0.iter().copied().collect(), ring.1.iter().copied().collect())
            };
            audio.update(&l, &r);
        }
        let started = Instant::now();
        renderer.render(&mut audio, elapsed);
        let cpu = started.elapsed().as_secs_f64();
        // Waits for the display: this is what paces the loop.
        match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                let view = frame.texture.create_view(&Default::default());
                renderer.present(&view, config.format);
                renderer.queue().present(frame);
            }
            _ => surface.configure(renderer.device(), &config),
        }
        window.1 += 1;
        window.2 += cpu;
        let secs = now.duration_since(window.0).as_secs_f64();
        if secs >= 1.0 {
            *stats.lock().unwrap() = Stats { fps: window.1 as f64 / secs, cpu_ms: window.2 * 1000.0 / window.1 as f64 };
            window = (now, 0, 0.0);
        }
    }
}

#[cfg(target_os = "macos")]
pub mod view {
    //! The native view, kept on the main thread.

    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use raw_window_handle::{AppKitDisplayHandle, AppKitWindowHandle, RawDisplayHandle, RawWindowHandle};
    use std::cell::RefCell;
    use std::ptr::NonNull;

    thread_local! {
        static VIEW: RefCell<Option<Retained<NSView>>> = const { RefCell::new(None) };
    }

    /// Put a view under everything in `ns_window`'s content view, and make a
    /// surface on it.
    ///
    /// # Safety
    /// `ns_window` must be a live `NSWindow`, and this must run on the main thread.
    pub unsafe fn create(ns_window: *mut std::ffi::c_void, instance: &wgpu::Instance) -> wgpu::Surface<'static> {
        let mtm = MainThreadMarker::new().expect("main thread");
        let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
        let content = window.contentView().expect("content view");
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
        let view = NSView::initWithFrame(mtm.alloc(), rect);
        view.setWantsLayer(true);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        let handle = AppKitWindowHandle::new(NonNull::from(&*view).cast());
        let surface = unsafe {
            instance
                .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                    raw_display_handle: Some(RawDisplayHandle::AppKit(AppKitDisplayHandle::new())),
                    raw_window_handle: RawWindowHandle::AppKit(handle),
                })
                .expect("surface")
        };
        VIEW.with(|v| *v.borrow_mut() = Some(view));
        surface
    }

    /// Move the view to `rect`, in the content view's points from its top left.
    /// Returns its size in pixels.
    pub fn place(x: f64, y: f64, width: f64, height: f64) -> Option<(u32, u32)> {
        VIEW.with(|v| {
            let view = v.borrow();
            let view = view.as_ref()?;
            let parent = unsafe { view.superview() }?;
            let from_bottom = if parent.isFlipped() { y } else { parent.frame().size.height - y - height };
            view.setFrame(NSRect::new(NSPoint::new(x, from_bottom), NSSize::new(width, height)));
            let scale = view.window().map(|w| w.backingScaleFactor()).unwrap_or(2.0);
            Some(((width * scale).round() as u32, (height * scale).round() as u32))
        })
    }
}
