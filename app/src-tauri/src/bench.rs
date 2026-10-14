//! The bench: a native view under the webview, drawn by the engine on its own
//! thread.
//!
//! The webview is transparent where the page leaves a hole for the bench, and the
//! page reports that hole's rectangle; the view is moved under it. No pixel of
//! the picture passes through the webview.

use crate::fx::Fx;
use engine::audio::Audio;
use engine::live::{configuration, show, Ring};
use engine::preset::Preset;
use engine::render::Renderer;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub mod hover;

/// The size presets draw at while the output is closed, whatever the size of
/// the hole they are shown in. With the output open, its render settings decide
/// it (`output::Render::drawn`).
pub const DRAW: (u32, u32) = (1920, 1080);

pub enum Cmd {
    PersonBegin(Sender<String>),
    PersonFrame(crate::camera::Packet, Sender<Result<u32, String>>),
    PersonEnd(String, Sender<()>),
    #[cfg(feature = "dev-bridge")]
    CameraFrame(u32, u32, Vec<u8>, f32, Sender<Result<(), String>>),
    #[cfg(feature = "dev-bridge")]
    CameraContours(engine::contours::Contours, Sender<Result<(), String>>),
    #[cfg(feature = "dev-bridge")]
    CameraSettings(f64, f32),
    #[cfg(feature = "dev-bridge")]
    CameraResize(u32, u32),
    #[cfg(feature = "dev-bridge")]
    CameraAudio(Vec<f32>, f32, Sender<()>),
    #[cfg(feature = "dev-bridge")]
    CameraAudioStop(Sender<()>),
    #[cfg(feature = "dev-bridge")]
    CameraStop(Sender<()>),
    #[cfg(feature = "dev-bridge")]
    CameraSnapshot(Sender<Option<(Picture, u64)>>),
    /// Load a preset with this seed; its file, when it has one (the editor's has none),
    /// is what [`on_drawing`] names.
    Load(Box<Preset>, u64, Option<PathBuf>, Sender<Result<engine::render::Loaded, String>>),
    /// One value, live. Replies false when it needs a reload instead.
    #[cfg_attr(not(feature = "lab"), allow(dead_code))]
    Set(engine::runtime::Owner, String, f64, Sender<bool>),
    /// Keep these stage pictures (`engine::render::PREVIEWS` indices) at this
    /// size; none stops them.
    #[cfg_attr(not(feature = "lab"), allow(dead_code))]
    Previews(Vec<usize>, (u32, u32)),
    /// The surface's size in physical pixels; 0×0 when the bench is hidden.
    Resize(u32, u32),
    SampleRate(f32),
    /// Present to the output too (a surface, its size in pixels, and the size
    /// presets draw at for it), or stop (`None`). Replies once the old output
    /// surface is let go, so its window can close.
    Output(Option<(wgpu::Surface<'static>, (u32, u32), (u32, u32))>, Sender<()>),
    /// The output surface's new size in pixels, and the new size presets draw at.
    OutputResize((u32, u32), (u32, u32)),
    /// While the output is open, draw at most once in this time (its frame-rate
    /// cap); `None`: every refresh of its display.
    Cap(Option<Duration>),
    /// The picture as the bench (false) or the output (true) is shown it, read
    /// back from the GPU at that surface's size; `None` when it isn't shown.
    /// Headless captures use it, since the window server never composes a
    /// Metal layer on a window that is on no display.
    Snapshot(bool, Sender<Option<Picture>>),
    /// Draw at this render scale and mesh size from now on (`quality.rs`).
    Quality(engine::quality::Quality),
}

/// A picture: its width and height in pixels, and its RGBA rows top to bottom.
pub type Picture = (u32, u32, Vec<u8>);

/// How round the bench's corners are, in points, for a hole at `rect` (x, y,
/// width, height in points from the top left) in a content view `area` big,
/// whose page asked for `radius`: the hole's own border-radius, which only
/// Home's hero has (`--lay-hero-radius`, 18); 0, square, for every other hole.
/// Never rounded where it reaches the window's edge (live's full-bleed picture:
/// the window's own corners are macOS's), and never more than half the shorter side.
pub fn corner_radius(rect: (f64, f64, f64, f64), area: (f64, f64), radius: f64) -> f64 {
    let (x, y, w, h) = rect;
    // Half a point of slack: the page's rects are fractional.
    let edge = 0.5;
    if radius.is_nan() || radius <= 0.0 || x <= edge || y <= edge || x + w >= area.0 - edge || y + h >= area.1 - edge {
        return 0.0;
    }
    radius.min(w.min(h) / 2.0).max(0.0)
}

/// How much of the pixel at (`x`, `y`) in a `w`×`h` box with corners of radius
/// `r` (all in pixels) the box covers, 0 to 1: anti-aliased over a pixel, as
/// Core Animation's mask is, so a capture's edge matches the screen's.
fn coverage(x: i64, y: i64, w: i64, h: i64, r: f64) -> f64 {
    if r <= 0.0 {
        return 1.0;
    }
    let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
    let into = |c: f64, len: f64| {
        if c < r {
            r - c
        } else if c > len - r {
            c - (len - r)
        } else {
            0.0
        }
    };
    let (dx, dy) = (into(cx, w as f64), into(cy, h as f64));
    if dx <= 0.0 || dy <= 0.0 {
        return 1.0;
    }
    (r - dx.hypot(dy) + 0.5).clamp(0.0, 1.0)
}

/// Paste `picture` into `rgba` (an image `size` big), scaled (nearest pixel) to
/// fill `rect` (x, y, width, height in pixels from the top left), cut off where
/// it runs past the image's edges, with its corners rounded by `radius` pixels
/// as the bench's layer is (0: square), what was there showing past them.
pub fn paste(rgba: &mut [u8], size: (u32, u32), rect: (i64, i64, i64, i64), radius: f64, picture: &Picture) {
    let (x0, y0, rw, rh) = rect;
    let (pw, ph, pixels) = (picture.0 as i64, picture.1 as i64, &picture.2);
    if rw <= 0 || rh <= 0 || pw <= 0 || ph <= 0 {
        return;
    }
    for y in y0.max(0)..(y0 + rh).min(size.1 as i64) {
        let sy = (y - y0) * ph / rh;
        for x in x0.max(0)..(x0 + rw).min(size.0 as i64) {
            let c = coverage(x - x0, y - y0, rw, rh, radius);
            if c <= 0.0 {
                continue;
            }
            let sx = (x - x0) * pw / rw;
            let from = ((sy * pw + sx) * 4) as usize;
            let to = ((y * size.0 as i64 + x) * 4) as usize;
            for i in 0..3 {
                rgba[to + i] = (rgba[to + i] as f64 * (1.0 - c) + pixels[from + i] as f64 * c).round() as u8;
            }
            // Opaque, as the bench's layer is.
            rgba[to + 3] = 255;
        }
    }
}

/// Draw the finished picture through the master pass, as [`show`] does, into a
/// texture of `size`, and read it back; `None` when the read-back won't map.
fn snapshot(renderer: &mut Renderer, size: (u32, u32)) -> Option<Picture> {
    let (w, h) = (size.0.max(1), size.1.max(1));
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let device = renderer.device().clone();
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("snapshot"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    renderer.present(&texture.create_view(&Default::default()), format, (w, h));
    let row = (w * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("snapshot read back"),
        size: (row * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) } },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    renderer.queue().submit([encoder.finish()]);
    let slice = staging.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::PollType::wait_indefinitely()).ok();
    let data = slice.get_mapped_range().ok()?;
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h as usize {
        rgba.extend_from_slice(&data[y * row as usize..][..w as usize * 4]);
    }
    Some((w, h, rgba))
}

/// A single bounded readback allocation, reused only by the experimental camera.
/// Ordinary application snapshots retain their existing lifetime and behavior.
#[cfg(feature = "dev-bridge")]
pub(crate) struct CameraSnapshot {
    size: (u32, u32),
    row: u32,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    staging: wgpu::Buffer,
}

#[cfg(feature = "dev-bridge")]
impl CameraSnapshot {
    pub(crate) fn new(renderer: &Renderer, size: (u32, u32)) -> Self {
        let (w, h) = size;
        let device = renderer.device();
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("camera snapshot"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let row = (w * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera snapshot readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        Self { size, row, texture, view, staging }
    }

    pub(crate) fn read(&self, renderer: &mut Renderer) -> Option<Picture> {
        let (w, h) = self.size;
        renderer.present(&self.view, wgpu::TextureFormat::Rgba8Unorm, self.size);
        let device = renderer.device();
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            self.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &self.staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(self.row), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        renderer.queue().submit([encoder.finish()]);
        let slice = self.staging.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        // Drop the mapped view before unmapping, including the failure path.
        let picture = (|| {
            device.poll(wgpu::PollType::wait_indefinitely()).ok()?;
            let data = slice.get_mapped_range().ok()?;
            let rgba = if self.row == w * 4 {
                data.to_vec()
            } else {
                let mut rgba = Vec::with_capacity((w * h * 4) as usize);
                for row in data.chunks_exact(self.row as usize) {
                    rgba.extend_from_slice(&row[..w as usize * 4]);
                }
                rgba
            };
            Some((w, h, rgba))
        })();
        self.staging.unmap();
        picture
    }
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
    /// The latest stage pictures, as [`packed`] packs them.
    #[cfg_attr(not(feature = "lab"), allow(dead_code))]
    pub previews: Arc<Mutex<Option<Vec<u8>>>>,
}

/// The bytes before the pictures in [`packed`]: width, height and which.
pub const HEADER: usize = 12;

/// Stage pictures as the page reads them: a 12-byte header of three
/// little-endian u32s — each picture's width, its height, and which stages
/// are in, as a mask (bit `i` for `engine::render::PREVIEWS[i]`) — then each
/// of those pictures' RGBA rows, top to bottom, in ascending stage order. The
/// header makes a read taken before the page's last ask still readable.
pub fn packed(p: &engine::render::Previews) -> Vec<u8> {
    let mask = p.which.iter().fold(0u32, |m, &i| m | 1 << i);
    let mut out = Vec::with_capacity(HEADER + p.pixels.len());
    for n in [p.size.0, p.size.1, mask] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&p.pixels);
    out
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
const STEP: Duration = Duration::from_nanos((1e9 / engine::runtime::PRESET_RATE) as u64);

/// The pace of a loop no display paces (the window off screen).
const UNPACED: Duration = Duration::from_nanos(1_000_000_000 / 120);

/// Below this speed the preset clock stands still (frozen).
const STILL: f64 = 0.02;

/// How the bench presents: on its display's refresh, unless the output is open
/// and paces the loop instead, or the app is headless — its windows are then on
/// no display, so no refresh comes and a picture waiting for one never shows.
fn bench_present_mode(output_open: bool) -> wgpu::PresentMode {
    #[cfg(target_os = "macos")]
    let headless = crate::dev::headless();
    #[cfg(not(target_os = "macos"))]
    let headless = false;
    if output_open || headless { wgpu::PresentMode::AutoNoVsync } else { wgpu::PresentMode::AutoVsync }
}

/// Start drawing into `surface`, with the live effects `fx`. Returns once the device is up.
pub fn start(instance: wgpu::Instance, surface: wgpu::Surface<'static>, size: (u32, u32), ring: Ring, fx: Arc<Mutex<Fx>>) -> Thread {
    let (adapter, device, queue) = engine::live::surface_device(&instance, &surface);
    let mut config = configuration(&adapter, &surface, size);
    config.present_mode = bench_present_mode(false);
    surface.configure(&device, &config);
    let mut renderer = Renderer::new(device, queue, DRAW.0, DRAW.1);
    renderer.set_quality(crate::quality::initial());
    let (commands, rx) = std::sync::mpsc::channel();
    let stats = Arc::new(Mutex::new(Stats::default()));
    let previews = Arc::new(Mutex::new(None));
    let now = Instant::now();
    let bench = Loop {
        renderer,
        person: crate::camera::Session::default(),
        #[cfg(feature = "dev-bridge")]
        camera: None,
        #[cfg(feature = "dev-bridge")]
        camera_audio: None,
        #[cfg(feature = "dev-bridge")]
        camera_snapshot: None,
        #[cfg(feature = "dev-bridge")]
        camera_sequence: 0,
        #[cfg(feature = "dev-bridge")]
        camera_settings: (1.0, 0.0),
        adapter,
        surface,
        config,
        ring,
        stats: stats.clone(),
        previews: previews.clone(),
        fx,
        output: None,
        bench_shown: true,
        logged: now,
        audio: Audio::default(),
        last: now,
        due: now,
        refresh: Duration::ZERO,
        pacer: engine::runtime::Pacer::default(),
        cap: crate::output::render().frame_time(),
        capped: None,
        window: (now, 0, 0.0),
        loaded: false,
        pictures_read: 0,
        source: None,
        drawing: Drawn::Not,
    };
    std::thread::Builder::new().name("bench".into()).spawn(move || bench.run(rx)).expect("bench thread");
    Thread { commands, stats, previews }
}

/// The output: a second surface the same picture is presented to.
struct Output {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
}

/// The bench thread's loop: it handles the page's commands, then draws a
/// refresh and presents it to the bench and the output.
struct Loop {
    renderer: Renderer,
    person: crate::camera::Session,
    #[cfg(feature = "dev-bridge")]
    camera: Option<Instant>,
    #[cfg(feature = "dev-bridge")]
    camera_audio: Option<(Instant, Vec<f32>)>,
    #[cfg(feature = "dev-bridge")]
    camera_snapshot: Option<CameraSnapshot>,
    #[cfg(feature = "dev-bridge")]
    camera_sequence: u64,
    #[cfg(feature = "dev-bridge")]
    camera_settings: (f64, f32),
    adapter: wgpu::Adapter,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    ring: Ring,
    stats: Arc<Mutex<Stats>>,
    previews: Arc<Mutex<Option<Vec<u8>>>>,
    fx: Arc<Mutex<Fx>>,
    /// With the output open, the output waits for its display's refresh and
    /// paces the loop; the bench presents without waiting, so the show is the
    /// smooth one.
    output: Option<Output>,
    bench_shown: bool,
    /// When the log line was last written.
    logged: Instant,
    audio: Audio,
    /// When the last refresh was drawn.
    last: Instant,
    /// When the levels are next heard while frozen.
    due: Instant,
    /// The time round the loop, smoothed: how often the display refreshes.
    refresh: Duration,
    pacer: engine::runtime::Pacer,
    /// The output's frame-rate cap: the least time between frames while it is open.
    cap: Option<Duration>,
    /// When the next capped frame is due; `None` until the first.
    capped: Option<Instant>,
    /// The stats window: its start, the refreshes in it and their CPU seconds.
    window: (Instant, u32, f64),
    loaded: bool,
    /// The preset step the stage pictures were last read at.
    pictures_read: u64,
    /// The file of the preset on the bench, when it has one.
    source: Option<PathBuf>,
    /// How far the preset on the bench has got drawing since it loaded.
    drawing: Drawn,
}

/// How the preset on the bench is getting on, told to [`on_drawing`].
#[derive(Clone, Debug, PartialEq)]
pub enum Drawing {
    /// The preset from this file drew its first refresh since it loaded.
    Drew(PathBuf),
    /// The preset on the bench has drawn for [`STEADY`] without panicking.
    Steady,
    /// The preset from this file (`None`: one without, the editor's) panicked
    /// drawing, and why. The bench has stopped drawing it; the picture holds.
    Panicked(Option<PathBuf>, String),
}

/// How long a preset draws without panicking before it counts as drawing fine
/// ([`Drawing::Steady`]): long enough to get past presets that panic a moment in
/// (the first beat, a variable that grows), short enough that a show that recovered
/// is soon trusted again. About 60 of the preset's steps at 1×.
pub const STEADY: Duration = Duration::from_secs(2);

/// How far the preset on the bench has got since it loaded.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Drawn {
    /// No refresh drawn yet.
    Not,
    /// Drawing since then.
    Since(Instant),
    /// Drawn for [`STEADY`], and told.
    Steady,
}

impl Drawn {
    /// A refresh drew fine at `now`: what to tell about the preset from `source`.
    fn drew(&mut self, now: Instant, source: Option<&PathBuf>) -> Option<Drawing> {
        match *self {
            Drawn::Not => {
                *self = Drawn::Since(now);
                source.cloned().map(Drawing::Drew)
            }
            Drawn::Since(at) if now.duration_since(at) >= STEADY => {
                *self = Drawn::Steady;
                Some(Drawing::Steady)
            }
            Drawn::Since(_) | Drawn::Steady => None,
        }
    }
}

type DrawingHook = Box<dyn Fn(Drawing) + Send + Sync>;
static ON_DRAWING: OnceLock<DrawingHook> = OnceLock::new();

/// Call `f` as the preset on the bench draws its first refresh, draws steadily, or
/// panics drawing ([`Drawing`]). `f` runs on the bench's thread, so it must not
/// wait on the bench, nor take long.
pub fn on_drawing(f: impl Fn(Drawing) + Send + Sync + 'static) {
    let _ = ON_DRAWING.set(Box::new(f));
}

fn tell(drawing: Drawing) {
    if let Some(hook) = ON_DRAWING.get() {
        hook(drawing);
    }
}

/// Run `f`, catching a panic (`crate::crash::catch`, so it is no crash report):
/// what it returned, or what the panic said.
fn survive<T>(f: impl FnOnce() -> T) -> Result<T, String> {
    crate::crash::catch(std::panic::AssertUnwindSafe(f))
        .map_err(|payload| payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a panic".into()))
}

impl Loop {
    /// Handle commands and draw, for good: a panic in either is caught, so the
    /// bench goes on. A preset that panics loading or drawing stops being drawn
    /// (the picture holds) until the next one loads, and is reported: as the
    /// load's error, or to [`on_drawing`].
    fn run(mut self, rx: Receiver<Cmd>) {
        loop {
            // Block while there is nothing to draw, so a closed window costs nothing.
            let next = if self.loaded { rx.try_recv().ok() } else { rx.recv().ok() };
            if let Some(cmd) = next {
                // A command's reply is dropped with it, so whoever asked hears an error.
                if let Err(why) = survive(|| self.command(cmd)) {
                    eprintln!("bench: a command panicked ({why}); going on");
                }
                continue;
            }
            match survive(|| self.frame()) {
                Ok(()) => {
                    if let Some(drawing) = self.drawing.drew(Instant::now(), self.source.as_ref()) {
                        tell(drawing);
                    }
                }
                Err(why) => {
                    eprintln!("bench: the preset panicked drawing ({why}); stopped drawing it");
                    self.loaded = false;
                    tell(Drawing::Panicked(self.source.take(), why));
                }
            }
        }
    }

    fn command(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::PersonBegin(reply) => {
                self.renderer.clear_camera_layers();
                let _ = reply.send(self.person.begin());
            }
            Cmd::PersonFrame(packet, reply) => {
                let result = self.person.accepts(&packet).and_then(|()| {
                    let m = &packet.meta;
                    let layers = engine::render::CameraLayers {
                        contours: engine::contours::Contours { width: m.width, height: m.height, mix: m.feed_mix, color: None, paths: m.paths.clone() },
                        rgba: packet.rgba.clone(),
                        camera_opacity: m.camera_opacity,
                        outline_opacity: m.outline_opacity,
                        outline_width: m.outline_width,
                        interpolation_ms: m.interpolation_ms,
                        source_epoch: m.source_epoch,
                    };
                    self.renderer.set_camera_layers(layers).map_err(str::to_owned)?;
                    self.person.accepted(&packet);
                    if self.person.expired(Instant::now()) {
                        self.renderer.expire_camera_layers();
                    }
                    Ok(packet.meta.sequence)
                });
                let _ = reply.send(result);
            }
            Cmd::PersonEnd(token, reply) => {
                if self.person.end(&token) {
                    self.renderer.clear_camera_layers();
                }
                let _ = reply.send(());
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraSnapshot(reply) => {
                let picture = if self.loaded && self.bench_shown {
                    let size = (self.config.width, self.config.height);
                    if self.camera_snapshot.as_ref().is_none_or(|s| s.size != size) {
                        self.camera_snapshot = Some(CameraSnapshot::new(&self.renderer, size));
                    }
                    self.camera_snapshot.as_ref().and_then(|s| s.read(&mut self.renderer)).map(|picture| (picture, self.camera_sequence))
                } else {
                    None
                };
                let _ = reply.send(picture);
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraContours(contours, reply) => {
                let result = self.renderer.set_contours(contours).map_err(str::to_owned);
                if result.is_ok() {
                    self.camera = Some(Instant::now());
                }
                let _ = reply.send(result);
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraFrame(w, h, rgba, mix, reply) => {
                let result = self.renderer.set_camera_frame(w, h, &rgba, mix).map_err(str::to_owned);
                if result.is_ok() {
                    self.camera = Some(Instant::now());
                }
                let _ = reply.send(result);
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraAudio(samples, rate, reply) => {
                self.audio.set_sample_rate(rate);
                self.camera_audio = Some((Instant::now(), samples));
                let _ = reply.send(());
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraAudioStop(reply) => {
                self.camera_audio = None;
                self.audio = Audio::default();
                let _ = reply.send(());
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraResize(w, h) => {
                self.renderer.resize(w, h);
                self.command(Cmd::Resize(w, h));
            }
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraSettings(speed, persistence) => self.camera_settings = (speed, persistence),
            #[cfg(feature = "dev-bridge")]
            Cmd::CameraStop(reply) => {
                self.stop_camera();
                let _ = reply.send(());
            }
            Cmd::Load(preset, seed, source, reply) => {
                // In the show (the output open), a new preset crossfades from the
                // last one's picture; the editor's reloads on every edit never do.
                let fading = self.loaded && self.output.is_some() && self.fx.lock().unwrap().settings.transition > 0.0;
                if fading {
                    self.renderer.keep_outgoing();
                }
                let result = match survive(|| self.renderer.load_preset(*preset, seed)) {
                    Ok(loaded) => loaded.map_err(|e| e.to_string()),
                    Err(why) => {
                        // Half loaded, maybe: nothing is drawn until a preset loads whole.
                        self.loaded = false;
                        self.source = None;
                        Err(format!("it panicked loading ({why})"))
                    }
                };
                // A preset that didn't load leaves the last one drawing, as it was.
                if result.is_ok() {
                    self.source = source;
                    self.drawing = Drawn::Not;
                }
                if fading && result.is_ok() {
                    self.fx.lock().unwrap().start_fade(Instant::now());
                }
                // The first preset starts at its step 0, not after the wait for it.
                if !self.loaded {
                    self.last = Instant::now();
                }
                self.loaded |= result.is_ok();
                let _ = reply.send(result);
            }
            Cmd::Resize(w, h) => {
                self.bench_shown = w > 0 && h > 0;
                if self.bench_shown {
                    self.config.width = w;
                    self.config.height = h;
                    self.surface.configure(self.renderer.device(), &self.config);
                }
            }
            Cmd::Output(next, done) => {
                // The old output's surface goes first: its window closes after the reply.
                self.output = None;
                let drawn = next.as_ref().map(|(_, _, drawn)| *drawn);
                if let Some((s, size, _)) = next {
                    let mut c = configuration(&self.adapter, &s, size);
                    #[cfg(target_os = "macos")]
                    if crate::dev::headless() {
                        // Off every display: no refresh to wait for.
                        c.present_mode = wgpu::PresentMode::AutoNoVsync;
                    }
                    s.configure(self.renderer.device(), &c);
                    self.output = Some(Output { surface: s, config: c });
                }
                let draw = drawn.unwrap_or(DRAW);
                self.renderer.resize(draw.0, draw.1);
                self.capped = None;
                self.config.present_mode = bench_present_mode(self.output.is_some());
                if self.bench_shown {
                    self.surface.configure(self.renderer.device(), &self.config);
                }
                // Let the measured refresh follow the new pacer.
                self.refresh = Duration::ZERO;
                let _ = done.send(());
            }
            Cmd::OutputResize((w, h), draw) => {
                if let Some(output) = self.output.as_mut() {
                    if (output.config.width, output.config.height) != (w.max(1), h.max(1)) {
                        output.config.width = w.max(1);
                        output.config.height = h.max(1);
                        output.surface.configure(self.renderer.device(), &output.config);
                    }
                    self.renderer.resize(draw.0, draw.1);
                }
            }
            Cmd::Cap(cap) => {
                self.cap = cap;
                self.capped = None;
            }
            Cmd::Snapshot(output, reply) => {
                let size = match (output, &self.output) {
                    (true, Some(o)) => Some((o.config.width, o.config.height)),
                    (false, _) if self.bench_shown => Some((self.config.width, self.config.height)),
                    _ => None,
                };
                let _ = reply.send(size.filter(|_| self.loaded).and_then(|size| snapshot(&mut self.renderer, size)));
            }
            Cmd::SampleRate(rate) => self.audio.set_sample_rate(rate),
            Cmd::Quality(quality) => self.renderer.set_quality(quality),
            Cmd::Set(owner, key, value, reply) => {
                let _ = reply.send(self.renderer.set_value(owner, &key, value));
            }
            Cmd::Previews(wanted, size) => {
                // No stage kept, so no pictures: the last poll's bytes would be stale.
                if !self.renderer.set_previews(&wanted, size) {
                    *self.previews.lock().unwrap() = None;
                }
            }
        }
    }

    /// Draw one refresh and present it.
    ///
    /// The display paces this loop: presenting waits for its refresh (the
    /// output's display when the output is open), and every refresh is drawn.
    /// The preset's clock moves on by the time since the last refresh × the
    /// speed (`Renderer::render`): a step, MilkDrop's frame, every 1/30 s at
    /// 1×, and the refreshes between steps drawn part of the way into the
    /// next one. So speed scales the motion and never the frame rate, and a
    /// 120 Hz display shows the same preset, at the same pace, as a 60 Hz one.
    /// Frozen, the clock stands still and the picture holds. A window that
    /// isn't on screen gets no refreshes to wait for, and the loop would spin;
    /// below a 4 ms round it is paced by sleeping instead.
    #[cfg(feature = "dev-bridge")]
    fn stop_camera(&mut self) {
        self.camera = None;
        self.camera_snapshot = None;
        self.camera_audio = None;
        self.audio = Audio::default();
        self.renderer.clear_camera();
        self.renderer.set_trails(0.0);
        self.renderer.clear();
    }

    /// With the output open and its frame rate capped, wait until the next
    /// frame is due. Due times run on from each other rather than from when a
    /// frame was drawn, so a refresh rounding each frame later still averages
    /// the cap (30 on a 60 Hz display: every other refresh); a stall longer
    /// than a frame starts them again from now.
    fn hold_to_cap(&mut self) {
        let Some(period) = self.cap.filter(|_| self.output.is_some()) else {
            self.capped = None;
            return;
        };
        let now = Instant::now();
        let due = match self.capped {
            Some(due) if due + period > now => due,
            _ => now,
        };
        if due > now {
            std::thread::sleep(due - now);
        }
        self.capped = Some(due + period);
    }

    fn frame(&mut self) {
        #[cfg(feature = "dev-bridge")]
        if self.camera.is_some_and(|last| last.elapsed() > Duration::from_secs(2)) {
            self.stop_camera();
        }
        if self.person.expired(Instant::now()) {
            self.renderer.expire_camera_layers();
        }
        let unpaced = !self.refresh.is_zero() && self.refresh < Duration::from_millis(4);
        if unpaced {
            std::thread::sleep(UNPACED.saturating_sub(self.last.elapsed()));
        }
        self.hold_to_cap();
        let now = Instant::now();
        let (speed, gain, echo) = {
            let fx = self.fx.lock().unwrap();
            (fx.speed_now(now), fx.gain() as f32, fx.echo())
        };
        #[cfg(feature = "dev-bridge")]
        let (speed, echo) = if self.camera.is_some() { self.camera_settings } else { (speed, echo) };
        let frozen = speed < STILL;
        // A stall (a slow load, the machine asleep) moves the preset on at most a
        // quarter second; otherwise whole refreshes, evened out (`Pacer`).
        self.renderer.advance_camera(now.duration_since(self.last).as_secs_f32());
        let elapsed = self.pacer.tick(now.duration_since(self.last).as_secs_f64()).min(0.25);
        self.last = now;
        {
            let (l, r): (Vec<f32>, Vec<f32>) = {
                let ring = self.ring.lock().unwrap();
                // Sensitivity: a gain on what the presets hear.
                (ring.0.iter().map(|s| s * gain).collect(), ring.1.iter().map(|s| s * gain).collect())
            };
            #[cfg(feature = "dev-bridge")]
            let (l, r) = if let Some((at, samples)) = &self.camera_audio {
                let samples = camera_audio_window(*at, samples, now).to_vec();
                (samples.clone(), samples)
            } else {
                (l, r)
            };
            self.audio.update(&l, &r);
        }
        self.renderer.set_trails(echo);
        let heard = self.renderer.clock.frame;
        let started = Instant::now();
        self.renderer.render(&mut self.audio, if frozen { 0.0 } else { elapsed * speed });
        #[cfg(feature = "dev-bridge")]
        {
            self.camera_sequence = self.camera_sequence.saturating_add(1);
        }
        let cpu = started.elapsed().as_secs_f64();
        if self.renderer.clock.frame != heard {
            self.fx.lock().unwrap().listen(self.audio.bass(), self.audio.bass_att(), now);
        } else if frozen && now >= self.due {
            // Still listening, so beats keep driving the strobe while frozen.
            self.due = now + STEP;
            self.audio.update_levels(engine::runtime::PRESET_RATE, self.renderer.clock.frame);
            self.fx.lock().unwrap().listen(self.audio.bass(), self.audio.bass_att(), now);
        }
        let master = self.fx.lock().unwrap().master(Instant::now());
        self.renderer.set_master(master);
        // The bench first: it doesn't wait. Then the output, which waits for its
        // display's refresh when it has one.
        if self.bench_shown {
            show(&mut self.renderer, &self.surface, &self.config);
        }
        if let Some(output) = &self.output {
            show(&mut self.renderer, &output.surface, &output.config);
        }
        // How often the display refreshes: the time round this loop, smoothed.
        let round = now.elapsed();
        self.refresh = if self.refresh.is_zero() { round } else { self.refresh.mul_f64(0.9) + round.mul_f64(0.1) };
        // Stage pictures change only with a step.
        if pictures_due(self.renderer.steps(), self.pictures_read) {
            self.pictures_read = self.renderer.steps();
            if let Some(pictures) = self.renderer.read_previews() {
                *self.previews.lock().unwrap() = Some(packed(&pictures));
            }
        }
        self.report(now, cpu, speed, unpaced);
    }

    /// Count a refresh that took `cpu` seconds: the stats every second, the
    /// log line every five.
    fn report(&mut self, now: Instant, cpu: f64, speed: f64, unpaced: bool) {
        self.window.1 += 1;
        self.window.2 += cpu;
        let secs = now.duration_since(self.window.0).as_secs_f64();
        if secs < 1.0 {
            return;
        }
        let s = Stats { fps: self.window.1 as f64 / secs, cpu_ms: self.window.2 * 1000.0 / self.window.1 as f64 };
        if now.duration_since(self.logged).as_secs() >= 5 {
            self.logged = now;
            let (l, r) = engine::live::peaks(&self.ring);
            eprintln!(
                "bench: {:.0} fps, {:.2} ms cpu, preset at {speed:.2}×, surface {}, output {}, display {:.0} Hz{}, input peaks {l:.3} {r:.3}",
                s.fps,
                s.cpu_ms,
                if self.bench_shown { format!("{}x{}", self.config.width, self.config.height) } else { "hidden".into() },
                self.output.as_ref().map_or("closed".into(), |w| format!("{}x{}", w.config.width, w.config.height)),
                1.0 / self.refresh.as_secs_f64().max(1e-6),
                if unpaced { ", not on screen" } else { "" }
            );
        }
        *self.stats.lock().unwrap() = s;
        self.window = (now, 0, 0.0);
    }
}

/// What sits in the main window's content view, as far as the bench cares
/// (decision 69): the frost (the window's `NSVisualEffectView`), the bench, and
/// everything else (the webview). Bottom to top they must go frost, bench,
/// webview: the frost over the bench would hide the picture, and anything else
/// under it would be hidden by it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    Frost,
    Bench,
    Other,
}

/// Whether the bench is stacked right in `order` (bottom to top): above every
/// frost view and below everything else.
pub fn stacked(order: &[Layer]) -> bool {
    let Some(bench) = order.iter().position(|l| *l == Layer::Bench) else {
        return false;
    };
    order.iter().enumerate().all(|(i, l)| match l {
        Layer::Frost => i < bench,
        Layer::Other => i > bench,
        Layer::Bench => i == bench,
    })
}

/// Where the bench goes among `order` (the content view's subviews without it,
/// bottom to top): just above the topmost frost view (`Some` of its index), or,
/// with no frost yet, at the very bottom (`None`). A frost added later goes to
/// the very bottom too (window-vibrancy puts it there), so it ends up under the
/// bench either way.
pub fn slot(order: &[Layer]) -> Option<usize> {
    order.iter().rposition(|l| *l == Layer::Frost)
}

#[cfg(target_os = "macos")]
pub mod view {
    //! The native view, kept on the main thread.

    use super::Layer;
    use objc2::rc::Retained;
    use objc2::{class, msg_send, MainThreadMarker};
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use raw_window_handle::{AppKitDisplayHandle, AppKitWindowHandle, RawDisplayHandle, RawWindowHandle};
    use std::cell::RefCell;
    use std::ptr::NonNull;

    thread_local! {
        static VIEW: RefCell<Option<Retained<NSView>>> = const { RefCell::new(None) };
    }

    /// The tags window-vibrancy 0.8.1 gives the effect view it adds for the
    /// window's `windowEffects`: an `NSVisualEffectView`'s material
    /// (`NS_VIEW_TAG_BLUR_VIEW`), or macOS 26's `NSGlassEffectView`
    /// (`NS_VIEW_TAG_GLASS_VIEW`, `VISUALS_FROST=glass`). Tauri applies the
    /// effects on the main thread after the window is made, so before or after
    /// the bench attaches, and again for `VISUALS_FROST` (`dev::frost`).
    /// Window-vibrancy isn't a dependency of ours to import them from: if an
    /// update changes them, [`restack`] finds no frost and never says it stacked over one.
    const FROST_TAGS: [isize; 2] = [91376254, 96945937];

    /// Put a view in `ns_window`'s content view, just above the frost if it is
    /// there yet and under everything else, and make a surface on it.
    ///
    /// # Safety
    /// `ns_window` must be a live `NSWindow`, and this must run on the main thread.
    pub unsafe fn create(ns_window: *mut std::ffi::c_void, instance: &wgpu::Instance) -> wgpu::Surface<'static> {
        let mtm = MainThreadMarker::new().expect("main thread");
        let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
        let content = window.contentView().expect("content view");
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
        let view = metal_view(mtm, rect, window.backingScaleFactor());
        // Clipped to its corners, which [`place`] sets (the output's view stays square).
        if let Some(layer) = view.layer() {
            layer.setMasksToBounds(true);
        }
        insert(&content, &view);
        let surface = surface_on(&view, instance);
        VIEW.with(|v| *v.borrow_mut() = Some(view));
        surface
    }

    /// `content`'s subviews, bottom to top, and what each is.
    fn layers(content: &NSView, bench: &NSView) -> Vec<(Layer, Retained<NSView>)> {
        content
            .subviews()
            .iter()
            .map(|v| {
                let layer = if std::ptr::eq(&*v, bench) {
                    Layer::Bench
                } else if FROST_TAGS.contains(&v.tag()) {
                    Layer::Frost
                } else {
                    Layer::Other
                };
                (layer, v)
            })
            .collect()
    }

    /// Add (or move) `bench` into `content` at its [`super::slot`].
    fn insert(content: &NSView, bench: &NSView) {
        let others: Vec<(Layer, Retained<NSView>)> = layers(content, bench).into_iter().filter(|(l, _)| *l != Layer::Bench).collect();
        let order: Vec<Layer> = others.iter().map(|(l, _)| *l).collect();
        match super::slot(&order) {
            Some(i) => content.addSubview_positioned_relativeTo(bench, NSWindowOrderingMode::Above, Some(&others[i].1)),
            None => content.addSubview_positioned_relativeTo(bench, NSWindowOrderingMode::Below, None),
        }
    }

    /// Check the bench sits above the frost and under the webview, and put it
    /// back if anything moved it. Cheap when it is right (a walk over a few
    /// subviews), so [`place`] runs it on every layout the page reports: at
    /// start, after a resize, after live mode and back. Says on stderr when it
    /// had to move it, and once when it first finds itself over the frost.
    fn restack(bench: &NSView) {
        let Some(content) = (unsafe { bench.superview() }) else { return };
        let order = |content: &NSView| layers(content, bench).into_iter().map(|(l, _)| l).collect::<Vec<_>>();
        let before = order(&content);
        if !super::stacked(&before) {
            insert(&content, bench);
            eprintln!("bench: stacked {before:?}; moved to {:?}", order(&content));
        }
        let after = order(&content);
        if !super::stacked(&after) {
            // Insert only places the bench above the frost, so another view
            // below the frost can leave it unstacked; logged, not fatal.
            eprintln!("bench: still stacked {after:?} after moving it");
        }
        static SAID: std::sync::Once = std::sync::Once::new();
        if after.contains(&Layer::Frost) {
            SAID.call_once(|| eprintln!("bench: stacked {after:?}, bottom to top"));
        }
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
    /// `overlay` is pasted over the bench (see [`capture_view`]).
    pub fn capture(path: &std::path::Path, overlay: Option<&super::Picture>) -> Result<(), String> {
        let view = VIEW.with(|v| v.borrow().clone()).ok_or("no window")?;
        capture_view(&view, path, overlay)
    }

    /// `view`'s window as the screen shows it, as a PNG — even when another
    /// window covers it — with `overlay` scaled into where `view` is, unless it
    /// is hidden. Headless, the window is on no display and the window server
    /// leaves `view`'s Metal layer black, so the picture it was given comes
    /// from the GPU instead ([`super::Cmd::Snapshot`]).
    pub fn capture_view(view: &NSView, path: &std::path::Path, overlay: Option<&super::Picture>) -> Result<(), String> {
        let window = view.window().ok_or("no window")?;
        let (w, h, mut rgba) = window_image(window.windowNumber() as u32)?;
        if let Some(picture) = overlay.filter(|_| !view.isHidden()) {
            // The view's rect in the window, from its bottom left, in points;
            // the image is the window's frame, from its top left, in pixels.
            let r = view.convertRect_toView(view.bounds(), None);
            let frame = window.frame().size;
            let scale = w as f64 / frame.width;
            let px = |v: f64| (v * scale).round() as i64;
            let rect = (px(r.origin.x), px(frame.height - r.origin.y - r.size.height), px(r.size.width), px(r.size.height));
            // Rounded as the layer is ([`place`]), so the capture shows the screen's corners.
            let radius = view.layer().filter(|l| l.masksToBounds()).map_or(0.0, |l| l.cornerRadius() * scale);
            super::paste(&mut rgba, (w, h), rect, radius, picture);
        }
        engine::picture::save_png(path, w, h, &rgba).map_err(|e| e.to_string())
    }

    /// Window `number` as the screen shows it, as RGBA rows.
    fn window_image(number: u32) -> Result<super::Picture, String> {
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
            Ok((w as u32, h as u32, rgba))
        }
    }

    /// Move the view to `rect`, in the content view's points from its top left.
    /// Returns its size in pixels: 0×0 for an empty rect, which hides the bench.
    /// Its corners are rounded by `radius` points, as [`super::corner_radius`] allows.
    pub fn place(x: f64, y: f64, width: f64, height: f64, radius: f64) -> Option<(u32, u32)> {
        VIEW.with(|v| {
            let view = v.borrow();
            let view = view.as_ref()?;
            restack(view);
            let hidden = width < 1.0 || height < 1.0;
            view.setHidden(hidden);
            if hidden {
                return Some((0, 0));
            }
            let parent = unsafe { view.superview() }?;
            // The page's coordinates start at the window's top left: the title
            // bar is an overlay (`tauri.conf.json`), so the content view, the
            // webview and the page all run up to the window's top edge, under the
            // window buttons. (With macOS's own title bar the page began below it,
            // at the content layout rect's top; that rect still stops under the
            // title bar's area, so it is no longer where the page starts.)
            let window = view.window()?;
            let area = parent.bounds();
            let left = area.origin.x + x;
            let bottom = if parent.isFlipped() { area.origin.y + y } else { area.origin.y + area.size.height - y - height };
            view.setFrame(NSRect::new(NSPoint::new(left, bottom), NSSize::new(width, height)));
            let radius = super::corner_radius((x, y, width, height), (area.size.width, area.size.height), radius);
            if let Some(layer) = view.layer().filter(|l| l.cornerRadius() != radius) {
                // At once: Core Animation would otherwise ease the corners in or out over a quarter second, going live or back.
                unsafe {
                    let _: () = msg_send![class!(CATransaction), begin];
                    let _: () = msg_send![class!(CATransaction), setDisableActions: true];
                }
                layer.setCornerRadius(radius);
                unsafe {
                    let _: () = msg_send![class!(CATransaction), commit];
                }
            }
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
    fn a_panic_on_the_bench_is_survived_with_what_it_said() {
        assert_eq!(survive(|| 7), Ok(7));
        assert_eq!(survive(|| -> u8 { panic!("the mesh ran out") }), Err("the mesh ran out".to_string()));
        let n = 3;
        assert_eq!(survive(|| -> u8 { panic!("step {n} broke") }), Err("step 3 broke".to_string()));
        // The thread goes on: a later call still runs.
        assert_eq!(survive(|| "next frame"), Ok("next frame"));
    }

    #[test]
    fn pastes_a_picture_scaled_and_clipped() {
        // A 2×1 picture, red then green, into a 4×2 image of grey.
        let picture = (2, 1, vec![255, 0, 0, 9, 0, 255, 0, 9]);
        let mut image = vec![7; 4 * 2 * 4];
        paste(&mut image, (4, 2), (1, 0, 4, 2), 0.0, &picture);
        let px = |x: usize, y: usize| image[(y * 4 + x) * 4..][..4].to_vec();
        assert_eq!(px(0, 0), [7, 7, 7, 7]);
        // Twice the size: each picture pixel covers two columns, made opaque.
        assert_eq!(px(1, 0), [255, 0, 0, 255]);
        assert_eq!(px(2, 1), [255, 0, 0, 255]);
        // The fourth column would be outside; the third is green.
        assert_eq!(px(3, 1), [0, 255, 0, 255]);
        // Wholly outside, or empty: nothing changes.
        let before = image.clone();
        paste(&mut image, (4, 2), (9, 9, 2, 2), 0.0, &picture);
        paste(&mut image, (4, 2), (0, 0, 0, 2), 0.0, &picture);
        assert_eq!(image, before);
    }

    #[test]
    fn pastes_with_rounded_corners_and_a_soft_edge() {
        // A red 20×20 picture over grey, rounded by 8 pixels.
        let picture = (20, 20, [255, 0, 0, 255].repeat(400));
        let mut image = vec![100; 20 * 20 * 4];
        paste(&mut image, (20, 20), (0, 0, 20, 20), 8.0, &picture);
        let px = |x: usize, y: usize| image[(y * 20 + x) * 4..][..4].to_vec();
        // Past the curve, in every corner, what was there shows.
        for (x, y) in [(0, 0), (19, 0), (0, 19), (19, 19), (1, 1), (18, 18)] {
            assert_eq!(px(x, y), [100, 100, 100, 100], "({x}, {y})");
        }
        // Along the straight edges and inside, the picture, opaque.
        for (x, y) in [(10, 0), (0, 10), (19, 10), (10, 19), (10, 10), (8, 8)] {
            assert_eq!(px(x, y), [255, 0, 0, 255], "({x}, {y})");
        }
        // On the curve, a blend of the two: no hard step and no dark fringe.
        let edge = px(1, 3);
        assert!(edge[0] > 100 && edge[0] < 255 && edge[1] < 100 && edge[1] > 0, "{edge:?}");
        assert_eq!(edge[3], 255);
        // Mirrored corners blend alike.
        assert_eq!(px(1, 3), px(18, 16));
    }

    #[test]
    fn rounds_only_the_hole_that_asks_and_never_the_full_bleed_picture() {
        let window = (1440.0, 900.0);
        let hero = (264.0, 72.0, 780.0, 438.75);
        // Home's hero, inset in the main column, asks for --lay-hero-radius.
        assert_eq!(corner_radius(hero, window, 18.0), 18.0);
        // Another inset hole (onboarding's, the editor's) asks for none: square.
        assert_eq!(corner_radius(hero, window, 0.0), 0.0);
        assert_eq!(corner_radius(hero, window, f64::NAN), 0.0);
        assert_eq!(corner_radius(hero, window, -4.0), 0.0);
        // Live's picture fills the window, or reaches any of its edges: square whatever is asked.
        assert_eq!(corner_radius((0.0, 0.0, 1440.0, 900.0), window, 18.0), 0.0);
        assert_eq!(corner_radius((0.0, 40.0, 1440.0, 860.0), window, 18.0), 0.0);
        assert_eq!(corner_radius((100.0, 100.0, 1340.0, 400.0), window, 18.0), 0.0);
        // Fractional rects a hair inside the edge are still full bleed.
        assert_eq!(corner_radius((0.25, 0.0, 1439.5, 900.0), window, 18.0), 0.0);
        // Never more than half the shorter side.
        assert_eq!(corner_radius((100.0, 100.0, 200.0, 20.0), window, 18.0), 10.0);
    }

    #[test]
    fn stage_pictures_go_to_the_page_with_their_size_and_which() {
        let pixels: Vec<u8> = (0..2 * 2 * 4 * 2).map(|n| n as u8).collect();
        let p = engine::render::Previews { size: (2, 2), which: vec![0, 14], pixels: pixels.clone() };
        let bytes = packed(&p);
        let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        assert_eq!((word(0), word(4), word(8)), (2, 2, 1 | 1 << 14));
        assert_eq!(&bytes[HEADER..], &pixels[..]);
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

    #[test]
    fn tells_the_first_refresh_then_steady_drawing_once_each() {
        let t = Instant::now();
        let file = PathBuf::from("/p/x.milk");
        let mut drawn = Drawn::Not;
        assert_eq!(drawn.drew(t, Some(&file)), Some(Drawing::Drew(file.clone())));
        assert_eq!(drawn.drew(t + Duration::from_millis(500), Some(&file)), None, "told once");
        assert_eq!(drawn.drew(t + STEADY, Some(&file)), Some(Drawing::Steady));
        assert_eq!(drawn.drew(t + STEADY * 3, Some(&file)), None, "told once");
        // The editor's preset has no file: nothing to name, but it still draws steadily.
        let mut editor = Drawn::Not;
        assert_eq!(editor.drew(t, None), None);
        assert_eq!(editor.drew(t + STEADY, None), Some(Drawing::Steady));
    }

    /// The content view as AppKit keeps it, bottom to top: the bench put in at
    /// its [`slot`] (`view::insert`), the frost as tauri and window-vibrancy put
    /// it in (the old one taken out, the new one at the very bottom).
    #[derive(Default)]
    struct Content(Vec<Layer>);

    impl Content {
        fn bench(&mut self) {
            self.0.retain(|l| *l != Layer::Bench);
            let at = slot(&self.0).map_or(0, |i| i + 1);
            self.0.insert(at, Layer::Bench);
        }
        fn frost(&mut self) {
            self.0.retain(|l| *l != Layer::Frost);
            self.0.insert(0, Layer::Frost);
        }
        fn webview(&mut self) {
            self.0.push(Layer::Other);
        }
    }

    #[test]
    fn the_bench_goes_above_the_frost_and_under_the_webview_in_any_order() {
        use Layer::*;
        // The frost applied before the bench attaches, or after it, or again
        // after (`set_effects`): the same stack.
        for steps in ["wfb", "wbf", "fwb", "wfbf", "wbff"] {
            let mut c = Content::default();
            for s in steps.chars() {
                match s {
                    'w' => c.webview(),
                    'f' => c.frost(),
                    _ => c.bench(),
                }
            }
            assert_eq!(c.0, [Frost, Bench, Other], "{steps}");
            assert!(stacked(&c.0), "{steps}");
        }
        // No frost (another tauri, or `windowEffects` gone): the bench at the bottom.
        let mut c = Content::default();
        c.webview();
        c.bench();
        assert_eq!(c.0, [Bench, Other]);
        assert!(stacked(&c.0));
    }

    #[test]
    fn a_bench_under_the_frost_or_over_the_webview_is_not_stacked() {
        use Layer::*;
        // What putting the bench at the very bottom did once the frost was there.
        assert!(!stacked(&[Bench, Frost, Other]));
        assert!(!stacked(&[Frost, Other, Bench]));
        assert!(!stacked(&[Frost, Other]));
        // Moving it puts it back.
        let mut c = Content(vec![Bench, Frost, Other]);
        c.bench();
        assert_eq!(c.0, [Frost, Bench, Other]);
    }
}

#[cfg(feature = "dev-bridge")]
fn camera_audio_window(at: Instant, samples: &[f32], now: Instant) -> &[f32] {
    if now.saturating_duration_since(at) <= Duration::from_millis(250) { samples } else { &[] }
}

#[cfg(all(test, feature = "dev-bridge"))]
mod camera_audio_tests {
    use super::*;
    #[test]
    fn camera_snapshot_reuses_mapped_buffer_and_preserves_pixels() {
        let Some((device, queue)) = engine::render::headless() else { panic!("camera readback test requires GPU") };
        let mut renderer = Renderer::new(device, queue, 65, 37);
        renderer.load(include_str!("bridge/echo-tunnel.milk"), 1).unwrap();
        renderer.render(&mut Audio::default(), 1.0 / 60.0);
        // Padded rows and both HD sizes exercise repeated map/unmap and resize.
        for size in [(65, 37), (1280, 720), (1920, 1080)] {
            renderer.resize(size.0, size.1);
            renderer.render(&mut Audio::default(), 1.0 / 60.0);
            let expected = snapshot(&mut renderer, size).unwrap();
            let cached = CameraSnapshot::new(&renderer, size);
            for _ in 0..3 {
                let actual = cached.read(&mut renderer).unwrap();
                assert_eq!(actual, expected);
                assert_eq!(actual.2.len(), (size.0 * size.1 * 4) as usize);
            }
        }
    }

    #[test]
    fn real_fft_hears_pcm_and_expired_windows_are_silent() {
        let now = Instant::now();
        let pcm: Vec<f32> = (0..1024).map(|i| (i as f32 * std::f32::consts::TAU * 180.0 / 48000.0).sin() * 0.7).collect();
        let mut audio = Audio::new(48000.0);
        let fresh = camera_audio_window(now, &pcm, now);
        audio.update(fresh, fresh);
        audio.update_levels(60.0, 1);
        assert!(audio.bass() > 0.0);
        assert!(audio.freq.iter().any(|v| *v > 0.0));
        let stale = camera_audio_window(now, &pcm, now + Duration::from_millis(251));
        assert!(stale.is_empty());
        audio.update(stale, stale);
        assert!(audio.freq.iter().all(|v| *v == 0.0));
        let stopped = Audio::default();
        assert!(stopped.freq.iter().all(|v| *v == 0.0));
    }
}
