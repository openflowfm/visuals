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
    /// One value, live. Replies false when it needs a reload instead.
    Set(engine::runtime::Owner, String, f64, Sender<bool>),
    Previews(bool),
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
    /// The latest stage pictures, packed as [`engine::render::Renderer::read_previews`] packs them.
    pub previews: Arc<Mutex<Option<Vec<u8>>>>,
}

/// How often stage pictures are read back: every this many frames.
const PREVIEW_EVERY: u32 = 4;

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
    let previews = Arc::new(Mutex::new(None));
    let (out, pictures) = (stats.clone(), previews.clone());
    std::thread::Builder::new()
        .name("bench".into())
        .spawn(move || run(renderer, surface, config, rx, ring, out, pictures))
        .expect("bench thread");
    Thread { commands, stats, previews }
}

fn run(
    mut renderer: Renderer,
    surface: wgpu::Surface<'static>,
    mut config: wgpu::SurfaceConfiguration,
    rx: Receiver<Cmd>,
    ring: Ring,
    stats: Arc<Mutex<Stats>>,
    previews: Arc<Mutex<Option<Vec<u8>>>>,
) {
    let mut frames = 0u32;
    let mut logged = Instant::now();
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
                Cmd::Set(owner, key, value, reply) => {
                    let _ = reply.send(renderer.set_value(owner, &key, value));
                }
                Cmd::Previews(on) => {
                    renderer.set_previews(on);
                    if !on {
                        *previews.lock().unwrap() = None;
                    }
                }
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
        frames = frames.wrapping_add(1);
        if frames % PREVIEW_EVERY == 0 {
            if let Some(pictures) = renderer.read_previews() {
                *previews.lock().unwrap() = Some(pictures);
            }
        }
        window.1 += 1;
        window.2 += cpu;
        let secs = now.duration_since(window.0).as_secs_f64();
        if secs >= 1.0 {
            let s = Stats { fps: window.1 as f64 / secs, cpu_ms: window.2 * 1000.0 / window.1 as f64 };
            if now.duration_since(logged).as_secs() >= 5 {
                logged = now;
                eprintln!("bench: {:.0} fps, {:.2} ms cpu, surface {}x{}", s.fps, s.cpu_ms, config.width, config.height);
            }
            *stats.lock().unwrap() = s;
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
        // A layer-hosting view whose layer is the Metal layer, so the view's frame
        // is the layer's frame. Left to itself, wgpu adds a sublayer sized to the
        // view as it was then — 1×1 here — which never follows the view.
        let layer = objc2_quartz_core::CAMetalLayer::new();
        layer.setContentsScale(window.backingScaleFactor());
        view.setLayer(Some(&layer));
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

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCreateImage(bounds: CGRect, list: u32, window: u32, options: u32) -> *const std::ffi::c_void;
        fn CGImageGetWidth(image: *const std::ffi::c_void) -> usize;
        fn CGImageGetHeight(image: *const std::ffi::c_void) -> usize;
        fn CGImageGetBytesPerRow(image: *const std::ffi::c_void) -> usize;
        fn CGImageGetDataProvider(image: *const std::ffi::c_void) -> *const std::ffi::c_void;
        fn CGDataProviderCopyData(provider: *const std::ffi::c_void) -> *const std::ffi::c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(data: *const std::ffi::c_void) -> *const u8;
        fn CFRelease(object: *const std::ffi::c_void);
    }

    /// The window as the screen shows it — webview and bench together — as a PNG.
    /// A development aid: an app may capture its own windows without the screen
    /// recording permission, so the window can be checked without anyone's eyes.
    pub fn capture(path: &std::path::Path) -> Result<(), String> {
        let window = VIEW.with(|v| v.borrow().as_ref().and_then(|v| v.window())).ok_or("no window")?;
        let number = window.windowNumber() as u32;
        // `CGRectNull`, `kCGWindowListOptionIncludingWindow`, `kCGWindowImageBoundsIgnoreFraming`.
        let null = CGRect { x: f64::INFINITY, y: f64::INFINITY, w: 0.0, h: 0.0 };
        unsafe {
            let image = CGWindowListCreateImage(null, 1 << 3, number, 1);
            if image.is_null() {
                return Err("CGWindowListCreateImage returned nothing".into());
            }
            let (w, h, row) = (CGImageGetWidth(image), CGImageGetHeight(image), CGImageGetBytesPerRow(image));
            let data = CGDataProviderCopyData(CGImageGetDataProvider(image));
            let bytes = std::slice::from_raw_parts(CFDataGetBytePtr(data), row * h);
            let mut rgba = Vec::with_capacity(w * h * 4);
            for y in 0..h {
                for px in bytes[y * row..y * row + w * 4].chunks_exact(4) {
                    // BGRA, premultiplied; the window is opaque where it matters.
                    rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
            }
            CFRelease(data);
            CFRelease(image);
            let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
            let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.write_header().and_then(|mut w| w.write_image_data(&rgba)).map_err(|e| e.to_string())
        }
    }

    /// Move the view to `rect`, in the content view's points from its top left.
    /// Returns its size in pixels.
    pub fn place(x: f64, y: f64, width: f64, height: f64) -> Option<(u32, u32)> {
        VIEW.with(|v| {
            let view = v.borrow();
            let view = view.as_ref()?;
            let parent = unsafe { view.superview() }?;
            // The page's coordinates start at the webview's top left, which need
            // not be the parent's: the webview can be shorter than its parent
            // (a window held below its full height leaves it ~32pt short). So the
            // rect is placed relative to the webview — the largest sibling.
            let webview = parent
                .subviews()
                .iter()
                .filter(|v| !std::ptr::eq(&**v, &**view))
                .max_by(|a, b| (a.frame().size.width * a.frame().size.height).total_cmp(&(b.frame().size.width * b.frame().size.height)))
                .map(|v| v.frame())
                .unwrap_or_else(|| parent.frame());
            let left = webview.origin.x + x;
            let bottom = if parent.isFlipped() { webview.origin.y + y } else { webview.origin.y + webview.size.height - y - height };
            view.setFrame(NSRect::new(NSPoint::new(left, bottom), NSSize::new(width, height)));
            let scale = view.window().map(|w| w.backingScaleFactor()).unwrap_or(2.0);
            eprintln!(
                "bench: placed at {x:.0},{y:.0} {width:.0}x{height:.0} pt (parent {:.0}x{:.0}, flipped {}, scale {scale})",
                parent.frame().size.width,
                parent.frame().size.height,
                parent.isFlipped()
            );
            Some(((width * scale).round() as u32, (height * scale).round() as u32))
        })
    }
}
