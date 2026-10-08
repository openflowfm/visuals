//! The bench: a native view under the webview, drawn by the engine on its own
//! thread.
//!
//! The webview is transparent where the page leaves a hole for the bench, and the
//! page reports that hole's rectangle; the view is moved under it. No pixel of
//! the picture passes through the webview.

use crate::fx::Fx;
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
    /// The surface's size in physical pixels; 0×0 when the bench is hidden.
    Resize(u32, u32),
    SampleRate(f32),
    /// Present to the output too (a surface and its size in pixels), or stop
    /// (`None`). Replies once the old output surface is let go, so its window
    /// can close.
    Output(Option<(wgpu::Surface<'static>, (u32, u32))>, Sender<()>),
    /// The output surface's new size in pixels.
    OutputResize(u32, u32),
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

/// How often stage pictures are read back: every this many preset steps, so
/// fifteen a second at 1× — the editor's poll rate, and what the pictures had
/// at 60 frames a second before the preset clock.
const PREVIEW_EVERY: u64 = 2;

/// Whether the stage pictures are due a read, at `steps` into the preset with
/// the last read at `read`. A refresh can move the preset several steps at
/// once (fast speeds, slow displays), so this counts steps rather than landing
/// on multiples; a new preset (back to step 0) is read at once.
fn pictures_due(steps: u64, read: u64) -> bool {
    steps < read || steps >= read + PREVIEW_EVERY
}

/// One preset step at 1×: how often the levels are still heard while frozen.
const STEP: std::time::Duration = std::time::Duration::from_nanos((1e9 / engine::runtime::PRESET_RATE) as u64);

/// The pace of a loop no display paces (the window off screen).
const UNPACED: std::time::Duration = std::time::Duration::from_nanos(1_000_000_000 / 120);

/// Below this speed the preset clock stands still (frozen).
const STILL: f64 = 0.02;

/// Start drawing into `surface`, with the live effects `fx`. Returns once the device is up.
pub fn start(instance: wgpu::Instance, surface: wgpu::Surface<'static>, size: (u32, u32), ring: Ring, fx: Arc<Mutex<Fx>>) -> Thread {
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: Some(&surface),
        ..Default::default()
    }))
    .expect("a GPU adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).expect("a GPU device");
    let config = configuration(&adapter, &surface, size);
    surface.configure(&device, &config);
    let renderer = Renderer::new(device, queue, DRAW.0, DRAW.1);
    let (commands, rx) = std::sync::mpsc::channel();
    let stats = Arc::new(Mutex::new(Stats::default()));
    let previews = Arc::new(Mutex::new(None));
    let (out, pictures) = (stats.clone(), previews.clone());
    std::thread::Builder::new()
        .name("bench".into())
        .spawn(move || run(renderer, adapter, surface, config, rx, ring, out, pictures, fx))
        .expect("bench thread");
    Thread { commands, stats, previews }
}

/// How a surface is set up: a plain (not sRGB) format, as WebGL writes colour
/// values as they are, and presenting on the display's refresh.
fn configuration(adapter: &wgpu::Adapter, surface: &wgpu::Surface, size: (u32, u32)) -> wgpu::SurfaceConfiguration {
    let caps = surface.get_capabilities(adapter);
    let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
    let mut config = surface.get_default_config(adapter, size.0.max(1), size.1.max(1)).expect("surface config");
    config.format = format;
    config.present_mode = wgpu::PresentMode::AutoVsync;
    config
}

/// Show the latest picture on one surface.
fn show(renderer: &mut Renderer, surface: &wgpu::Surface, config: &wgpu::SurfaceConfiguration) {
    match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
            let view = frame.texture.create_view(&Default::default());
            renderer.present(&view, config.format);
            renderer.queue().present(frame);
        }
        _ => surface.configure(renderer.device(), config),
    }
}

/// The output: a second surface the same picture is presented to.
struct Output {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
}

#[allow(clippy::too_many_arguments)]
fn run(
    mut renderer: Renderer,
    adapter: wgpu::Adapter,
    surface: wgpu::Surface<'static>,
    mut config: wgpu::SurfaceConfiguration,
    rx: Receiver<Cmd>,
    ring: Ring,
    stats: Arc<Mutex<Stats>>,
    previews: Arc<Mutex<Option<Vec<u8>>>>,
    fx: Arc<Mutex<Fx>>,
) {
    // With the output open, the output waits for its display's refresh and paces
    // the loop; the bench presents without waiting, so the show is the smooth one.
    let mut output: Option<Output> = None;
    let mut bench_shown = true;
    let mut logged = Instant::now();
    let mut audio = Audio::default();
    let mut last = Instant::now();
    let mut due = Instant::now();
    let mut refresh = std::time::Duration::ZERO;
    let mut pacer = engine::runtime::Pacer::default();
    let mut window = (Instant::now(), 0u32, 0.0f64);
    let mut loaded = false;
    // The preset step the stage pictures were last read at.
    let mut pictures_read = 0u64;
    loop {
        // Block while there is nothing to draw, so a closed window costs nothing.
        let next = if loaded { rx.try_recv().ok() } else { rx.recv().ok() };
        if let Some(cmd) = next {
            match cmd {
                Cmd::Load(preset, seed, reply) => {
                    // In the show (the output open), a new preset crossfades from the
                    // last one's picture; the editor's reloads on every edit never do.
                    let fading = loaded && output.is_some() && fx.lock().unwrap().settings.transition > 0.0;
                    if fading {
                        renderer.keep_outgoing();
                    }
                    let result = renderer.load_preset(*preset, seed).map_err(|e| e.to_string());
                    if fading && result.is_ok() {
                        fx.lock().unwrap().start_fade(Instant::now());
                    }
                    // The first preset starts at its step 0, not after the wait for it.
                    if !loaded {
                        last = Instant::now();
                    }
                    loaded |= result.is_ok();
                    let _ = reply.send(result);
                }
                Cmd::Resize(w, h) => {
                    bench_shown = w > 0 && h > 0;
                    if bench_shown {
                        config.width = w;
                        config.height = h;
                        surface.configure(renderer.device(), &config);
                    }
                }
                Cmd::Output(next, done) => {
                    // The old output's surface goes first: its window closes after the reply.
                    output = None;
                    if let Some((s, size)) = next {
                        let c = configuration(&adapter, &s, size);
                        s.configure(renderer.device(), &c);
                        output = Some(Output { surface: s, config: c });
                    }
                    config.present_mode = if output.is_some() { wgpu::PresentMode::AutoNoVsync } else { wgpu::PresentMode::AutoVsync };
                    if bench_shown {
                        surface.configure(renderer.device(), &config);
                    }
                    // Let the measured refresh follow the new pacer.
                    refresh = std::time::Duration::ZERO;
                    let _ = done.send(());
                }
                Cmd::OutputResize(w, h) => {
                    if let Some(output) = output.as_mut() {
                        output.config.width = w.max(1);
                        output.config.height = h.max(1);
                        output.surface.configure(renderer.device(), &output.config);
                    }
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
        // The display paces this loop: presenting waits for its refresh (the
        // output's display when the output is open), and every refresh is drawn.
        // The preset's clock moves on by the time since the last refresh × the
        // speed (`Renderer::render`): a step, MilkDrop's frame, every 1/30 s at
        // 1×, and the refreshes between steps drawn part of the way into the
        // next one. So speed scales the motion and never the frame rate, and a
        // 120 Hz display shows the same preset, at the same pace, as a 60 Hz one.
        // Frozen, the clock stands still and the picture holds. A window that
        // isn't on screen gets no refreshes to wait for, and the loop would spin;
        // below a 4 ms round it is paced by sleeping instead.
        let unpaced = !refresh.is_zero() && refresh < std::time::Duration::from_millis(4);
        if unpaced {
            std::thread::sleep(UNPACED.saturating_sub(last.elapsed()));
        }
        let now = Instant::now();
        let (speed, gain, echo) = {
            let fx = fx.lock().unwrap();
            (fx.speed_now(now), fx.settings.sensitivity as f32, fx.echo())
        };
        let frozen = speed < STILL;
        // A stall (a slow load, the machine asleep) moves the preset on at most a
        // quarter second; otherwise whole refreshes, evened out (`Pacer`).
        let elapsed = pacer.tick(now.duration_since(last).as_secs_f64()).min(0.25);
        last = now;
        {
            let (l, r): (Vec<f32>, Vec<f32>) = {
                let ring = ring.lock().unwrap();
                // Sensitivity: a gain on what the presets hear.
                (ring.0.iter().map(|s| s * gain).collect(), ring.1.iter().map(|s| s * gain).collect())
            };
            audio.update(&l, &r);
        }
        renderer.set_trails(echo);
        let heard = renderer.clock.frame;
        let started = Instant::now();
        renderer.render(&mut audio, if frozen { 0.0 } else { elapsed * speed });
        let cpu = started.elapsed().as_secs_f64();
        if renderer.clock.frame != heard {
            fx.lock().unwrap().listen(audio.bass(), audio.bass_att(), now);
        } else if frozen && now >= due {
            // Still listening, so beats keep driving the strobe while frozen.
            due = now + STEP;
            audio.update_levels(engine::runtime::PRESET_RATE, renderer.clock.frame);
            fx.lock().unwrap().listen(audio.bass(), audio.bass_att(), now);
        }
        renderer.set_master(fx.lock().unwrap().master(Instant::now()));
        // The bench first: it doesn't wait. Then the output, which waits for its
        // display's refresh when it has one.
        if bench_shown {
            show(&mut renderer, &surface, &config);
        }
        if let Some(output) = &output {
            show(&mut renderer, &output.surface, &output.config);
        }
        // How often the display refreshes: the time round this loop, smoothed.
        let round = now.elapsed();
        refresh = if refresh.is_zero() { round } else { refresh.mul_f64(0.9) + round.mul_f64(0.1) };
        // Stage pictures change only with a step.
        if pictures_due(renderer.steps(), pictures_read) {
            pictures_read = renderer.steps();
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
                let (l, r) = crate::listen::peaks(&ring);
                eprintln!(
                    "bench: {:.0} fps, {:.2} ms cpu, preset at {speed:.2}×, surface {}, output {}, display {:.0} Hz{}, input peaks {l:.3} {r:.3}",
                    s.fps,
                    s.cpu_ms,
                    if bench_shown { format!("{}x{}", config.width, config.height) } else { "hidden".into() },
                    output.as_ref().map_or("closed".into(), |w| format!("{}x{}", w.config.width, w.config.height)),
                    1.0 / refresh.as_secs_f64().max(1e-6),
                    if unpaced { ", not on screen" } else { "" }
                );
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
        let view = metal_view(mtm, rect, window.backingScaleFactor());
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        let surface = surface_on(&view, instance);
        VIEW.with(|v| *v.borrow_mut() = Some(view));
        surface
    }

    /// A layer-hosting view whose layer is a Metal layer, so the view's frame is
    /// the layer's frame. Left to itself, wgpu adds a sublayer sized to the view
    /// as it was then — 1×1 for the bench — which never follows the view.
    pub fn metal_view(mtm: MainThreadMarker, rect: NSRect, scale: f64) -> Retained<NSView> {
        let view = NSView::initWithFrame(mtm.alloc(), rect);
        let layer = objc2_quartz_core::CAMetalLayer::new();
        layer.setContentsScale(scale);
        layer.setOpaque(true);
        view.setLayer(Some(&layer));
        view.setWantsLayer(true);
        view
    }

    /// A surface on a [`metal_view`].
    pub fn surface_on(view: &NSView, instance: &wgpu::Instance) -> wgpu::Surface<'static> {
        let handle = AppKitWindowHandle::new(NonNull::from(view).cast());
        // SAFETY: the view is live, and is kept until the render thread has let
        // go of the surface (the bench's for the app's life, the output's until
        // `Cmd::Output(None)` is answered).
        unsafe {
            instance
                .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                    raw_display_handle: Some(RawDisplayHandle::AppKit(AppKitDisplayHandle::new())),
                    raw_window_handle: RawWindowHandle::AppKit(handle),
                })
                .expect("surface")
        }
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
        capture_window(window.windowNumber() as u32, path)
    }

    /// Window `number` as the screen shows it, as a PNG — even when another
    /// window covers it.
    pub fn capture_window(number: u32, path: &std::path::Path) -> Result<(), String> {
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
            engine::picture::save_png(path, w as u32, h as u32, &rgba).map_err(|e| e.to_string())
        }
    }

    /// Move the view to `rect`, in the content view's points from its top left.
    /// Returns its size in pixels: 0×0 for an empty rect, which hides the bench.
    pub fn place(x: f64, y: f64, width: f64, height: f64) -> Option<(u32, u32)> {
        VIEW.with(|v| {
            let view = v.borrow();
            let view = view.as_ref()?;
            let hidden = width < 1.0 || height < 1.0;
            view.setHidden(hidden);
            if hidden {
                return Some((0, 0));
            }
            let parent = unsafe { view.superview() }?;
            // The page's coordinates start at the top left of the window's content
            // layout rect, not of the view it sits in: the webview runs up under
            // the title bar and the page begins below it (32pt here). The layout
            // rect is in the window's coordinates, which are the content view's.
            let window = view.window()?;
            let area = window.contentLayoutRect();
            let left = area.origin.x + x;
            let bottom = if parent.isFlipped() {
                window.frame().size.height - (area.origin.y + area.size.height) + y
            } else {
                area.origin.y + area.size.height - y - height
            };
            view.setFrame(NSRect::new(NSPoint::new(left, bottom), NSSize::new(width, height)));
            let scale = window.backingScaleFactor();
            Some(((width * scale).round() as u32, (height * scale).round() as u32))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The steps the pictures are read at, for refreshes moving the preset `per` steps each.
    fn reads(per: u64, refreshes: u64) -> Vec<u64> {
        let mut read = 0;
        (1..=refreshes)
            .map(|n| n * per)
            .filter(|&steps| {
                let due = pictures_due(steps, read);
                if due {
                    read = steps;
                }
                due
            })
            .collect()
    }

    #[test]
    fn stage_pictures_follow_the_preset_clock_at_any_speed() {
        // A step a refresh (1× at 30 Hz): pictures every other step.
        assert_eq!(reads(1, 8), [2, 4, 6, 8]);
        // 4× on a 30 Hz display: four steps a refresh, and still a picture each time
        // (counting multiples of four from an odd step would never land).
        assert_eq!(reads(4, 3), [4, 8, 12]);
        assert_eq!(reads(3, 4), [3, 6, 9, 12]);
        // A new preset starts again at step 0 and is read at once.
        assert!(pictures_due(0, 40));
        assert!(!pictures_due(41, 40));
    }
}
