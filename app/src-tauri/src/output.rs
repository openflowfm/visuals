//! The live output: the show, full screen on a display of its own (a projector,
//! a second screen). A borderless native window with no webview; its content is
//! a Metal layer the bench's render thread presents the same finished picture
//! to, scaled to fit the display with the render resolution's aspect kept, black
//! around it ([`place`]). Esc held on it for 3 s leaves live mode, as Esc held in
//! the main window does (the `output-escape` event, told on Esc down and up).
//!
//! How it is drawn — the resolution, a render scale on it and a frame-rate cap
//! ([`Render`]) — is set in the Output panel and remembered
//! (`~/.openflow/visuals/render.json`).
//!
//! Live mode in the page opens it and leaving live mode closes it. While it is
//! open it paces the render thread (it waits for its display's refresh) and the
//! bench presents without waiting, so the show is the smooth one. The window
//! sits above the menu bar and the Dock, so neither covers it on its display,
//! and the mouse cursor is hidden while it is over it.
//!
//! The display it goes to is chosen in live mode and remembered
//! (`~/.openflow/visuals/output.json`). It closes when live mode ends, or when
//! its display goes away.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

/// One display, as the page lists them.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Display {
    /// The display's `CGDirectDisplayID`: stable while it stays connected.
    pub id: u32,
    /// Its place in the system's list of displays, from 0.
    pub index: usize,
    pub name: String,
    /// The display's size in pixels.
    pub width: u32,
    pub height: u32,
    /// The display with the menu bar.
    pub main: bool,
}

/// The output as the page sees it: the `output` event, and what the output commands return.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Status {
    /// The display it fills; absent when the output is closed.
    pub display: Option<Display>,
    /// The picture's size on it, in pixels.
    pub size: Option<(u32, u32)>,
}

/// The display chosen last, kept between launches.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    pub id: u32,
    pub name: String,
}

/// Where a picture of `aspect` goes in `area`: as large as fits, centred.
/// Returns x, y, width and height.
pub fn fit(area: (f64, f64), aspect: (f64, f64)) -> (f64, f64, f64, f64) {
    let scale = (area.0 / aspect.0).min(area.1 / aspect.1);
    let (w, h) = (aspect.0 * scale, aspect.1 * scale);
    ((area.0 - w) / 2.0, (area.1 - h) / 2.0, w, h)
}

/// The picture's place on a display `frame` points big at `scale` pixels a
/// point, for a picture of `aspect` ([`Render::base`]): its rect in points (x,
/// y, width, height), as large as fits with black around it, and its size in
/// pixels. The display's own aspect fills it.
pub fn place(frame: (f64, f64), scale: f64, aspect: (u32, u32)) -> ((f64, f64, f64, f64), (u32, u32)) {
    let rect = fit(frame, (aspect.0.max(1) as f64, aspect.1.max(1) as f64));
    (rect, ((rect.2 * scale).round() as u32, (rect.3 * scale).round() as u32))
}

/// The size the output renders at, before the render scale: the display's own
/// pixels, or a size of its own. JSON: `"display"` or `[width, height]`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(try_from = "ResolutionJson", into = "ResolutionJson")]
pub enum Resolution {
    #[default]
    Display,
    Size(u32, u32),
}

/// [`Resolution`] as the page writes it.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum ResolutionJson {
    Word(String),
    Size([u32; 2]),
}

impl TryFrom<ResolutionJson> for Resolution {
    type Error = String;
    fn try_from(json: ResolutionJson) -> Result<Self, String> {
        match json {
            ResolutionJson::Word(w) if w == "display" => Ok(Resolution::Display),
            ResolutionJson::Word(w) => Err(format!("unknown resolution {w:?}: \"display\" or [width, height]")),
            ResolutionJson::Size([w, h]) => Ok(Resolution::Size(w, h)),
        }
    }
}

impl From<Resolution> for ResolutionJson {
    fn from(r: Resolution) -> Self {
        match r {
            Resolution::Display => ResolutionJson::Word("display".into()),
            Resolution::Size(w, h) => ResolutionJson::Size([w, h]),
        }
    }
}

/// The largest side the output renders at: wgpu's default texture limit.
pub const MAX_SIDE: u32 = 8192;
/// The render scale's range.
const SCALES: (f64, f64) = (0.25, 4.0);
/// The frame-rate cap's range, in frames a second. At least 10, so the render
/// thread, which waits out the cap between frames, still hears commands promptly.
const RATES: (f64, f64) = (10.0, 1000.0);

/// How the live output is drawn: at `resolution` times `scale`, at most `fps`
/// frames a second (`None`: every refresh of its display).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default)]
pub struct Render {
    pub resolution: Resolution,
    pub scale: f64,
    pub fps: Option<f64>,
}

impl Default for Render {
    fn default() -> Self {
        Render { resolution: Resolution::Display, scale: 1.0, fps: None }
    }
}

impl Render {
    /// These settings brought into range: a size of at least 1×1 and at most
    /// [`MAX_SIDE`], a scale in [`SCALES`] (1 when not a number), a cap in
    /// [`RATES`] (none when not a positive number).
    pub fn kept(self) -> Render {
        let resolution = match self.resolution {
            Resolution::Size(w, h) => Resolution::Size(w.clamp(1, MAX_SIDE), h.clamp(1, MAX_SIDE)),
            r => r,
        };
        let scale = if self.scale.is_finite() && self.scale > 0.0 { self.scale.clamp(SCALES.0, SCALES.1) } else { 1.0 };
        let fps = self.fps.filter(|f| f.is_finite() && *f > 0.0).map(|f| f.clamp(RATES.0, RATES.1));
        Render { resolution, scale, fps }
    }

    /// The resolution on a display `display` pixels big: its own size, or the
    /// chosen one turned to the display's way round (1080p on a display rotated
    /// to portrait is 1080×1920), so a rotated display is filled.
    pub fn base(&self, display: (u32, u32)) -> (u32, u32) {
        let (dw, dh) = (display.0.max(1), display.1.max(1));
        match self.resolution {
            Resolution::Display => (dw, dh),
            Resolution::Size(w, h) if (dh > dw) != (h > w) => (h.max(1), w.max(1)),
            Resolution::Size(w, h) => (w.max(1), h.max(1)),
        }
    }

    /// The size presets draw at on a display `display` pixels big: [`base`](Self::base)
    /// times the scale, shrunk (keeping its aspect) to fit [`MAX_SIDE`].
    pub fn drawn(&self, display: (u32, u32)) -> (u32, u32) {
        let (w, h) = self.base(display);
        let scale = self.scale.clamp(SCALES.0, SCALES.1).min(MAX_SIDE as f64 / w.max(h) as f64);
        (((w as f64 * scale).round() as u32).clamp(1, MAX_SIDE), ((h as f64 * scale).round() as u32).clamp(1, MAX_SIDE))
    }

    /// The least time between two of the output's frames; none when uncapped.
    pub fn frame_time(&self) -> Option<std::time::Duration> {
        self.fps.map(|f| std::time::Duration::from_secs_f64(1.0 / f.clamp(RATES.0, RATES.1)))
    }
}

/// Where the render settings are kept, in [`crate::settings::dir`].
const RENDER: &str = "render.json";

fn render_state() -> &'static std::sync::Mutex<Render> {
    static STATE: OnceLock<std::sync::Mutex<Render>> = OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(crate::settings::load::<Render>(RENDER).unwrap_or_default().kept()))
}

/// The render settings in effect.
pub fn render() -> Render {
    *render_state().lock().unwrap()
}

/// The output's render settings.
#[tauri::command]
pub fn output_render() -> Render {
    render()
}

/// Sets how the output is drawn, keeps it for next launch, and redraws the open
/// output at it. Answers with the settings kept (brought into range).
#[tauri::command]
pub fn output_set_render(render: Render, handle: AppHandle) -> Result<Render, String> {
    let render = render.kept();
    *render_state().lock().unwrap() = render;
    crate::settings::save_json(RENDER, &render);
    handle.state::<crate::App>().send(crate::bench::Cmd::Cap(render.frame_time()));
    #[cfg(target_os = "macos")]
    native::on_main(&handle, native::rerender)?;
    Ok(render)
}

/// Which display the output goes to: display `index` when one is forced
/// (`VISUALS_DISPLAY`), else the one chosen last (by id, then by name, as ids
/// can change when a display is plugged in again), else the first that isn't
/// the main one, else the main one.
pub fn choose(displays: &[Display], saved: Option<&Choice>, index: Option<usize>) -> Option<u32> {
    let forced = index.and_then(|i| displays.iter().find(|d| d.index == i));
    let by_id = || saved.and_then(|s| displays.iter().find(|d| d.id == s.id));
    let by_name = || saved.and_then(|s| displays.iter().find(|d| d.name == s.name));
    let other = || displays.iter().find(|d| !d.main);
    forced.or_else(by_id).or_else(by_name).or_else(other).or_else(|| displays.first()).map(|d| d.id)
}

/// `VISUALS_LIVE=1`: the page starts in live mode.
fn live_from(value: Option<String>) -> bool {
    value.is_some_and(|v| !v.is_empty() && v != "0")
}

/// The views the page can start in (`VISUALS_VIEW`), as the page names them.
const VIEWS: [&str; 4] = ["home", "library", "live", "live-windowed"];

/// The view the page starts in: `VISUALS_VIEW` (`view`) when it names one, else
/// live mode with `VISUALS_LIVE=1` (`live`), else none (the page's own start).
fn view_from(view: Option<String>, live: Option<String>) -> Option<&'static str> {
    let named = view.and_then(|v| VIEWS.into_iter().find(|n| v.trim().eq_ignore_ascii_case(n)));
    named.or_else(|| live_from(live).then_some("live"))
}

/// `VISUALS_PRESET=<path>`: the preset the page starts on, absolute or in the pack.
fn preset_from(value: Option<String>, folders: &[PathBuf]) -> Option<String> {
    let p = PathBuf::from(value.filter(|p| !p.is_empty())?);
    Some(if p.is_absolute() { p } else { crate::pack::resolve_in(folders, &p) }.to_string_lossy().into_owned())
}

/// `VISUALS_DISPLAY=<n>`: live mode outputs to display `n` (from 0, the system's order).
fn index_from(value: Option<String>) -> Option<usize> {
    value?.trim().parse().ok()
}

/// The display chosen last, in [`crate::settings::dir`].
const SAVED: &str = "output.json";

fn saved() -> Option<Choice> {
    crate::settings::load(SAVED)
}

static HANDLE: OnceLock<AppHandle> = OnceLock::new();
static INSTANCE: OnceLock<wgpu::Instance> = OnceLock::new();

/// Keep what opening the output needs, and close it when its display goes away.
pub fn init(handle: AppHandle, instance: wgpu::Instance) {
    let _ = HANDLE.set(handle);
    let _ = INSTANCE.set(instance);
    #[cfg(target_os = "macos")]
    {
        native::watch_displays();
        native::watch_cursor();
        native::watch_escape();
    }
}

/// The key code of Esc on a Mac keyboard (`kVK_Escape`).
const ESC: u16 = 53;

/// Where a key press went, for [`escapes`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum KeyWindow {
    /// The main window: its page has the key, and handles Esc itself (not
    /// while the user is typing in a field).
    Main,
    /// The output window.
    Output,
    /// No window: the app is in front with none of its windows key, as after
    /// a click on the output, which never becomes the key window.
    None,
}

/// Whether a key press is the output's Esc, which the page hears from outside
/// itself: Esc, with no modifier, while the output is open, sent to the output
/// or to no window. A short press shows the page's hidden panels; held for 3 s
/// it leaves live mode, so the page is told when it goes down and when it comes
/// up ([`escape_says`]).
pub fn escapes(key_code: u16, modifiers: bool, to: KeyWindow, open: bool) -> bool {
    key_code == ESC && !modifiers && open && to != KeyWindow::Main
}

/// One event the output's key monitor sees, for [`escape_says`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum KeyEvent {
    /// A key went down; `repeat` when it is the key repeating while held.
    Down { code: u16, modifiers: bool, repeat: bool },
    /// A key came up.
    Up { code: u16 },
    /// The app stopped being the active one: a key held then never comes up here.
    Deactivated,
}

/// What the output's Esc tells the page: the `output-escape` event's payload.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EscapeSays {
    Down,
    Up,
}

/// What one event does about the output's Esc, given whether it is held
/// (`held`, a down told and no up yet): what to tell the page, if anything, and
/// whether the event is taken (not passed on to a window).
///
/// A first press of the output's Esc ([`escapes`]) is told as down, and its
/// repeats are taken and not told, so they can't restart the page's timing of
/// a hold. Once held, Esc coming up anywhere, or the app being left, is told
/// as up, so a hold never outlives the key; an up on the main window is passed
/// on too, as its page hears its own keys.
pub fn escape_says(event: KeyEvent, to: KeyWindow, open: bool, held: bool) -> (Option<EscapeSays>, bool) {
    match event {
        KeyEvent::Down { code, modifiers, repeat } if escapes(code, modifiers, to, open) => (if repeat { None } else { Some(EscapeSays::Down) }, true),
        KeyEvent::Up { code } if code == ESC && held => (Some(EscapeSays::Up), to != KeyWindow::Main),
        KeyEvent::Deactivated if held => (Some(EscapeSays::Up), false),
        _ => (None, false),
    }
}

fn tell(status: &Status) {
    if let Some(h) = HANDLE.get() {
        let _ = h.emit("output", status);
    }
}

/// The view the page starts in (`VISUALS_VIEW`, or `VISUALS_LIVE=1`), or none.
#[tauri::command]
pub fn live_start() -> Option<&'static str> {
    let view = std::env::var("VISUALS_VIEW").ok();
    if view.as_deref().is_some_and(|v| !v.is_empty() && view_from(Some(v.into()), None).is_none()) {
        eprintln!("VISUALS_VIEW: not one of {}", VIEWS.join(", "));
    }
    view_from(view, std::env::var("VISUALS_LIVE").ok())
}

/// The preset the page starts on, in either mode.
#[tauri::command]
pub fn start_preset(handle: AppHandle) -> Option<String> {
    preset_from(std::env::var("VISUALS_PRESET").ok(), &crate::pack::folders(&handle))
}

#[tauri::command]
pub fn displays(handle: AppHandle) -> Result<Vec<Display>, String> {
    #[cfg(target_os = "macos")]
    return native::on_main(&handle, |mtm| native::list(mtm).into_iter().map(|(d, _)| d).collect());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
        Ok(Vec::new())
    }
}

/// Open the output on display `id` (a [`Display::id`]) and remember the choice,
/// or, without one, on the display [`choose`] picks. Moves it when it is open
/// elsewhere.
#[tauri::command]
pub fn output_open(id: Option<u32>, handle: AppHandle) -> Result<Status, String> {
    #[cfg(target_os = "macos")]
    return native::on_main(&handle, move |mtm| {
        let displays: Vec<Display> = native::list(mtm).into_iter().map(|(d, _)| d).collect();
        let index = index_from(std::env::var("VISUALS_DISPLAY").ok());
        let chosen = id.or_else(|| choose(&displays, saved().as_ref(), index)).ok_or("no display")?;
        if id.is_some() {
            if let Some(d) = displays.iter().find(|d| d.id == chosen) {
                crate::settings::save_json(SAVED, &Choice { id: d.id, name: d.name.clone() });
            }
        }
        native::open(mtm, chosen)
    })?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, handle);
        Err("the live output needs macOS".into())
    }
}

#[tauri::command]
pub fn output_close(handle: AppHandle) -> Result<Status, String> {
    #[cfg(target_os = "macos")]
    return native::on_main(&handle, |mtm| {
        native::close(mtm);
        Status::default()
    });
    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
        Ok(Status::default())
    }
}

#[tauri::command]
pub fn output_status(handle: AppHandle) -> Result<Status, String> {
    #[cfg(target_os = "macos")]
    return native::on_main(&handle, native::status);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
        Ok(Status::default())
    }
}

#[cfg(target_os = "macos")]
pub mod native {
    //! The window, kept on the main thread.

    use super::{Display, EscapeSays, HANDLE, INSTANCE, KeyEvent, KeyWindow, Status, escape_says, place, tell};
    use crate::bench;
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSBackingStoreType, NSColor, NSEvent, NSEventMask, NSEventModifierFlags, NSEventSubtype, NSEventType, NSScreen, NSStatusWindowLevel, NSView, NSWindow, NSWindowCollectionBehavior,
        NSWindowStyleMask,
    };
    use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, ns_string};
    use std::cell::RefCell;
    use tauri::{AppHandle, Emitter, Manager};

    struct Open {
        window: Retained<NSWindow>,
        picture: Retained<NSView>,
        display: Display,
        frame: NSRect,
        scale: f64,
        size: (u32, u32),
    }

    thread_local! {
        static OUTPUT: RefCell<Option<Open>> = const { RefCell::new(None) };
    }

    /// Run `f` on the main thread and wait for it; straight away when already there.
    pub fn on_main<R: Send + 'static>(handle: &AppHandle, f: impl FnOnce(MainThreadMarker) -> R + Send + 'static) -> Result<R, String> {
        if let Some(mtm) = MainThreadMarker::new() {
            return Ok(f(mtm));
        }
        let (tx, rx) = std::sync::mpsc::channel();
        handle
            .run_on_main_thread(move || {
                let _ = tx.send(f(MainThreadMarker::new().expect("main thread")));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }

    fn id_of(screen: &NSScreen) -> u32 {
        screen.deviceDescription().objectForKey(ns_string!("NSScreenNumber")).and_then(|n| n.downcast::<NSNumber>().ok()).map_or(0, |n| n.unsignedIntValue())
    }

    /// The displays, in the system's order: the first has the menu bar.
    pub fn list(mtm: MainThreadMarker) -> Vec<(Display, Retained<NSScreen>)> {
        NSScreen::screens(mtm)
            .iter()
            .enumerate()
            .map(|(index, screen)| {
                let size = screen.frame().size;
                let scale = screen.backingScaleFactor();
                let display = Display {
                    id: id_of(&screen),
                    index,
                    name: screen.localizedName().to_string(),
                    width: (size.width * scale).round() as u32,
                    height: (size.height * scale).round() as u32,
                    main: index == 0,
                };
                (display, screen)
            })
            .collect()
    }

    fn commands() -> Option<std::sync::mpsc::Sender<bench::Cmd>> {
        HANDLE.get()?.state::<crate::App>().commands().ok()
    }

    /// The picture's place in a window `frame` big on `display` of `scale`, at
    /// the render settings in effect: its rect in points, its size in pixels,
    /// and the size presets draw at.
    fn picture(frame: NSRect, scale: f64, display: &Display) -> (NSRect, (u32, u32), (u32, u32)) {
        let render = super::render();
        let pixels = (display.width, display.height);
        let ((x, y, w, h), size) = place((frame.size.width, frame.size.height), scale, render.base(pixels));
        (NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)), size, render.drawn(pixels))
    }

    pub fn status(_: MainThreadMarker) -> Status {
        OUTPUT.with(|o| match o.borrow().as_ref() {
            Some(open) => Status { display: Some(open.display.clone()), size: Some(open.size) },
            None => Status::default(),
        })
    }

    /// Open the output on display `id`.
    pub fn open(mtm: MainThreadMarker, id: u32) -> Result<Status, String> {
        let (display, screen) = list(mtm).into_iter().find(|(d, _)| d.id == id).ok_or_else(|| format!("no display {id}"))?;
        if OUTPUT.with(|o| o.borrow().as_ref().is_some_and(|o| o.display.id == id)) {
            return Ok(status(mtm));
        }
        let commands = commands().ok_or("the bench has not started")?;
        let instance = INSTANCE.get().ok_or("no GPU instance")?;
        close_quietly(mtm);
        let frame = screen.frame();
        let scale = screen.backingScaleFactor();
        // SAFETY: a plain borderless window, made and kept on the main thread.
        let window = unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(mtm.alloc(), frame, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false) };
        // SAFETY: the window is kept by `OUTPUT` until it is closed, and not after.
        unsafe { window.setReleasedWhenClosed(false) };
        window.setBackgroundColor(Some(&NSColor::blackColor()));
        window.setOpaque(true);
        window.setHasShadow(false);
        // Above the menu bar (24) and the Dock (20), so neither covers the show.
        window.setLevel(NSStatusWindowLevel);
        window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::IgnoresCycle,
        );
        window.setFrame_display(frame, false);
        let content = NSView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
        window.setContentView(Some(&content));
        let (rect, size, drawn) = picture(frame, scale, &display);
        let view = bench::view::metal_view(mtm, rect, scale);
        content.addSubview(&view);
        let surface = bench::view::surface_on(&view, instance);
        if crate::dev::headless() {
            // Drawn as usual, but beyond every display and below the other windows.
            window.setLevel(0);
            crate::dev::park(mtm, &window);
        } else {
            window.orderFrontRegardless();
        }
        let (done, _) = std::sync::mpsc::channel();
        commands.send(bench::Cmd::Output(Some((surface, size, drawn)), done)).map_err(|e| e.to_string())?;
        eprintln!("output: open on {} ({}x{}), picture {}x{}, drawn at {}x{}", display.name, display.width, display.height, size.0, size.1, drawn.0, drawn.1);
        OUTPUT.with(|o| *o.borrow_mut() = Some(Open { window, picture: view, display, frame, scale, size }));
        let now = status(mtm);
        tell(&now);
        Ok(now)
    }

    /// Stop presenting to the output, then close its window.
    fn close_quietly(_: MainThreadMarker) -> bool {
        let Some(open) = OUTPUT.with(|o| o.borrow_mut().take()) else { return false };
        if let Some(commands) = commands() {
            let (done, wait) = std::sync::mpsc::channel();
            if commands.send(bench::Cmd::Output(None, done)).is_ok() {
                // The render thread may be waiting on the output's next
                // drawable, which gives up after a second.
                let _ = wait.recv_timeout(std::time::Duration::from_secs(3));
            }
        }
        open.window.orderOut(None);
        open.window.close();
        eprintln!("output: closed");
        true
    }

    pub fn close(mtm: MainThreadMarker) {
        if close_quietly(mtm) {
            tell(&Status::default());
        }
    }

    /// The displays changed: close the output if its display is gone, or fit
    /// it to the display's new size.
    fn check(mtm: MainThreadMarker) {
        let Some((id, frame, scale)) = OUTPUT.with(|o| o.borrow().as_ref().map(|o| (o.display.id, o.frame, o.scale))) else { return };
        let Some((display, screen)) = list(mtm).into_iter().find(|(d, _)| d.id == id) else {
            eprintln!("output: its display went away");
            close(mtm);
            return;
        };
        let (new_frame, new_scale) = (screen.frame(), screen.backingScaleFactor());
        if new_frame == frame && new_scale == scale {
            return;
        }
        refit(mtm, display, new_frame, new_scale);
    }

    /// The render settings changed: place the open output's picture again and
    /// draw it at them.
    pub fn rerender(mtm: MainThreadMarker) {
        let Some((display, frame, scale)) = OUTPUT.with(|o| o.borrow().as_ref().map(|o| (o.display.clone(), o.frame, o.scale))) else { return };
        refit(mtm, display, frame, scale);
    }

    /// Fit the open output to `display`, `frame` big at `scale`, at the render
    /// settings in effect, and say so.
    fn refit(mtm: MainThreadMarker, display: Display, new_frame: NSRect, new_scale: f64) {
        let (rect, size, drawn) = picture(new_frame, new_scale, &display);
        OUTPUT.with(|o| {
            let mut o = o.borrow_mut();
            let Some(open) = o.as_mut() else { return };
            if open.frame != new_frame {
                if crate::dev::headless() {
                    open.window.setContentSize(new_frame.size);
                    crate::dev::park(mtm, &open.window);
                } else {
                    open.window.setFrame_display(new_frame, true);
                }
            }
            open.picture.setFrame(rect);
            if let Some(layer) = open.picture.layer() {
                layer.setContentsScale(new_scale);
            }
            (open.display, open.frame, open.scale, open.size) = (display, new_frame, new_scale, size);
        });
        if let Some(commands) = commands() {
            let _ = commands.send(bench::Cmd::OutputResize(size, drawn));
        }
        tell(&status(mtm));
    }

    type Reconfigured = unsafe extern "C" fn(display: u32, flags: u32, user: *mut std::ffi::c_void);

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGDisplayRegisterReconfigurationCallback(callback: Reconfigured, user: *mut std::ffi::c_void) -> i32;
    }

    unsafe extern "C" fn reconfigured(_display: u32, flags: u32, _user: *mut std::ffi::c_void) {
        // `kCGDisplayBeginConfigurationFlag`: a change is starting; act once it has happened.
        if flags & 1 != 0 {
            return;
        }
        if let Some(handle) = HANDLE.get() {
            let _ = handle.run_on_main_thread(|| check(MainThreadMarker::new().expect("main thread")));
        }
    }

    pub fn watch_displays() {
        // SAFETY: a plain C callback that needs no user data.
        unsafe { CGDisplayRegisterReconfigurationCallback(reconfigured, std::ptr::null_mut()) };
    }

    thread_local! {
        static HIDDEN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    /// Hide the mouse cursor while it is over the output, and show it again when
    /// it leaves or the output closes. `NSCursor`'s hide and unhide are counted, so
    /// they are only ever called in pairs.
    fn cursor(_: MainThreadMarker) {
        // Where the window is, not its display: headless, it is parked off the screen.
        let frame = OUTPUT.with(|o| o.borrow().as_ref().map(|o| o.window.frame()));
        let over = frame.is_some_and(|f| {
            // SAFETY: a class method returning a plain point, on the main thread.
            let p: NSPoint = unsafe { objc2::msg_send![objc2::class!(NSEvent), mouseLocation] };
            p.x >= f.origin.x && p.x < f.origin.x + f.size.width && p.y >= f.origin.y && p.y < f.origin.y + f.size.height
        });
        HIDDEN.with(|hidden| {
            if over == hidden.get() {
                return;
            }
            // SAFETY: class methods with no arguments, on the main thread.
            unsafe {
                if over {
                    let _: () = objc2::msg_send![objc2::class!(NSCursor), hide];
                } else {
                    let _: () = objc2::msg_send![objc2::class!(NSCursor), unhide];
                }
            }
            hidden.set(over);
        });
    }

    /// Follow the mouse ten times a second: the output never becomes the key
    /// window, so it gets no mouse-moved events of its own to hide the cursor on.
    pub fn watch_cursor() {
        std::thread::Builder::new()
            .name("output cursor".into())
            .spawn(|| {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if let Some(handle) = HANDLE.get() {
                        let _ = handle.run_on_main_thread(|| cursor(MainThreadMarker::new().expect("main thread")));
                    }
                }
            })
            .expect("output cursor thread");
    }

    thread_local! {
        /// The output's Esc is held: its down was told and its up not yet.
        static ESC_HELD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    /// Esc while the output is open, sent to the output or to no window (the
    /// output never becomes the key window, so a key pressed after clicking it
    /// can land on none): tell the page when it goes down and when it comes up
    /// (`output-escape`, "down" or "up"), so it can time a hold: held 3 s,
    /// it leaves live mode, as Esc held in the main window does; a short press
    /// shows the hidden panels. Repeats are taken and not told, and the app
    /// being left while it is held is told as up ([`escape_says`]). Esc in the
    /// main window is the page's to handle.
    pub fn watch_escape() {
        let Some(handle) = HANDLE.get() else { return };
        let _ = handle.run_on_main_thread(|| {
            let block = block2::RcBlock::new(|event: std::ptr::NonNull<NSEvent>| -> *mut NSEvent {
                let mtm = MainThreadMarker::new().expect("main thread");
                // SAFETY: AppKit hands the monitor a live event, on the main thread.
                let e = unsafe { event.as_ref() };
                let output = OUTPUT.with(|o| o.borrow().as_ref().map(|o| o.window.clone()));
                let to = match e.window(mtm) {
                    None => KeyWindow::None,
                    Some(w) if output.as_ref().is_some_and(|o| *o == w) => KeyWindow::Output,
                    Some(_) => KeyWindow::Main,
                };
                // Only a key event has a key code (asking another for one raises).
                let key = match e.r#type() {
                    NSEventType::KeyDown => {
                        let modifiers = e.modifierFlags().intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Option | NSEventModifierFlags::Control | NSEventModifierFlags::Shift);
                        KeyEvent::Down { code: e.keyCode(), modifiers, repeat: e.isARepeat() }
                    }
                    NSEventType::KeyUp => KeyEvent::Up { code: e.keyCode() },
                    NSEventType::AppKitDefined if e.subtype() == NSEventSubtype::ApplicationDeactivated => KeyEvent::Deactivated,
                    _ => return event.as_ptr(),
                };
                let (says, taken) = escape_says(key, to, output.is_some(), ESC_HELD.get());
                if let Some(says) = says {
                    ESC_HELD.set(says == EscapeSays::Down);
                    if let Some(h) = HANDLE.get() {
                        let _ = h.emit("output-escape", says);
                    }
                }
                if taken { std::ptr::null_mut() } else { event.as_ptr() }
            });
            // SAFETY: the handler returns the event it was given, or null to drop it.
            let mask = NSEventMask::KeyDown | NSEventMask::KeyUp | NSEventMask::AppKitDefined;
            let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) };
            // Kept for the app's life.
            std::mem::forget(monitor);
        });
    }

    /// The output's window as a PNG (development: `VISUALS_CAPTURE_OUTPUT`).
    /// `overlay` is pasted over the picture (see [`bench::view::capture_view`]).
    pub fn capture(path: &std::path::Path, overlay: Option<&bench::Picture>) -> Result<(), String> {
        let picture = OUTPUT.with(|o| o.borrow().as_ref().map(|o| o.picture.clone())).ok_or("the live output is not open")?;
        bench::view::capture_view(&picture, path, overlay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: u32, index: usize, name: &str) -> Display {
        Display { id, index, name: name.into(), width: 1920, height: 1080, main: index == 0 }
    }

    #[test]
    fn fits_a_wide_picture_with_bars() {
        // A 16:9 picture on a 16:10 display: bars above and below.
        assert_eq!(fit((1920.0, 1200.0), (1920.0, 1080.0)), (0.0, 60.0, 1920.0, 1080.0));
        // On an ultrawide one: bars at the sides.
        assert_eq!(fit((3440.0, 1440.0), (1920.0, 1080.0)), (440.0, 0.0, 2560.0, 1440.0));
        // The same aspect fills it.
        assert_eq!(fit((3840.0, 2160.0), (1920.0, 1080.0)), (0.0, 0.0, 3840.0, 2160.0));
    }

    #[test]
    fn esc_off_the_page_leaves_live_mode() {
        // On the output, or with no window key (after a click on the output).
        assert!(escapes(ESC, false, KeyWindow::Output, true));
        assert!(escapes(ESC, false, KeyWindow::None, true));
        // The main window's page handles its own Esc, minding fields.
        assert!(!escapes(ESC, false, KeyWindow::Main, true));
        // Not with the output closed, with a modifier, or another key.
        assert!(!escapes(ESC, false, KeyWindow::None, false));
        assert!(!escapes(ESC, true, KeyWindow::Output, true));
        assert!(!escapes(36, false, KeyWindow::Output, true));
    }

    #[test]
    fn tells_the_outputs_esc_down_and_up_so_a_hold_can_be_timed() {
        let down = |repeat| KeyEvent::Down { code: ESC, modifiers: false, repeat };
        let up = KeyEvent::Up { code: ESC };
        // The first press is told and taken; its repeats are taken and not told.
        assert_eq!(escape_says(down(false), KeyWindow::Output, true, false), (Some(EscapeSays::Down), true));
        assert_eq!(escape_says(down(true), KeyWindow::Output, true, true), (None, true));
        assert_eq!(escape_says(down(false), KeyWindow::None, true, false), (Some(EscapeSays::Down), true));
        // Coming up while held is told, wherever it lands; on the main window its page hears it too.
        assert_eq!(escape_says(up, KeyWindow::Output, true, true), (Some(EscapeSays::Up), true));
        assert_eq!(escape_says(up, KeyWindow::Main, true, true), (Some(EscapeSays::Up), false));
        // The output closed while held (leaving live): the up is still told.
        assert_eq!(escape_says(up, KeyWindow::None, false, true), (Some(EscapeSays::Up), true));
        // Not held: an up is nobody's business here.
        assert_eq!(escape_says(up, KeyWindow::Output, true, false), (None, false));
        // The app left while held cancels the hold; not held, it says nothing.
        assert_eq!(escape_says(KeyEvent::Deactivated, KeyWindow::None, true, true), (Some(EscapeSays::Up), false));
        assert_eq!(escape_says(KeyEvent::Deactivated, KeyWindow::None, true, false), (None, false));
        // Esc in the main window, another key, or a modifier: the page's, untouched.
        assert_eq!(escape_says(down(false), KeyWindow::Main, true, false), (None, false));
        assert_eq!(escape_says(KeyEvent::Down { code: 36, modifiers: false, repeat: false }, KeyWindow::Output, true, false), (None, false));
        assert_eq!(escape_says(KeyEvent::Up { code: 36 }, KeyWindow::Output, true, true), (None, false));
        assert_eq!(escape_says(KeyEvent::Down { code: ESC, modifiers: true, repeat: false }, KeyWindow::Output, true, false), (None, false));
        // The payload the page reads.
        assert_eq!(serde_json::to_string(&EscapeSays::Down).unwrap(), "\"down\"");
        assert_eq!(serde_json::to_string(&EscapeSays::Up).unwrap(), "\"up\"");
    }

    #[test]
    fn places_the_picture_at_the_resolutions_aspect_and_fills_a_rotated_display() {
        let p1080 = Render { resolution: Resolution::Size(1920, 1080), ..Render::default() };
        // A 16:9 resolution: the 4K display (2× backing) gets it all…
        assert_eq!(place((1920.0, 1080.0), 2.0, p1080.base((3840, 2160))), ((0.0, 0.0, 1920.0, 1080.0), (3840, 2160)));
        // …an ultrawide 16:9 with bars at the sides.
        assert_eq!(place((3440.0, 1440.0), 1.0, p1080.base((3440, 1440))), ((440.0, 0.0, 2560.0, 1440.0), (2560, 1440)));
        // The same ultrawide rotated 90°: the whole display, not a 1440×810 strip.
        assert_eq!(place((1440.0, 3440.0), 1.0, Render::default().base((1440, 3440))), ((0.0, 0.0, 1440.0, 3440.0), (1440, 3440)));
        // 1080p on a rotated 1080p display is turned with it: at 2× backing, its pixels are twice its points.
        assert_eq!(p1080.base((1080, 1920)), (1080, 1920));
        assert_eq!(place((1080.0, 1920.0), 2.0, p1080.base((2160, 3840))), ((0.0, 0.0, 1080.0, 1920.0), (2160, 3840)));
    }

    #[test]
    fn chooses_the_display() {
        let two = [display(1, 0, "Built-in"), display(7, 1, "Projector")];
        let one = [display(1, 0, "Built-in")];
        // Nothing chosen yet: the display without the menu bar, or the only one.
        assert_eq!(choose(&two, None, None), Some(7));
        assert_eq!(choose(&one, None, None), Some(1));
        // The one chosen last, by id, then by name.
        let built_in = Choice { id: 1, name: "Built-in".into() };
        assert_eq!(choose(&two, Some(&built_in), None), Some(1));
        let replugged = Choice { id: 99, name: "Projector".into() };
        assert_eq!(choose(&two, Some(&replugged), None), Some(7));
        // Gone altogether: as if nothing was chosen.
        let gone = Choice { id: 99, name: "TV".into() };
        assert_eq!(choose(&one, Some(&gone), None), Some(1));
        // Forced by index wins; a missing index doesn't.
        assert_eq!(choose(&two, Some(&built_in), Some(1)), Some(7));
        assert_eq!(choose(&two, Some(&built_in), Some(5)), Some(1));
        assert_eq!(choose(&[], None, None), None);
    }

    #[test]
    fn starts_from_the_environment() {
        assert!(live_from(Some("1".into())));
        assert!(!live_from(Some("0".into())));
        assert!(!live_from(Some(String::new())));
        assert!(!live_from(None));
        // VISUALS_VIEW names the view, and wins over VISUALS_LIVE; anything else is ignored.
        assert_eq!(view_from(Some("live-windowed".into()), None), Some("live-windowed"));
        assert_eq!(view_from(Some(" Library ".into()), Some("1".into())), Some("library"));
        assert_eq!(view_from(Some("home".into()), None), Some("home"));
        assert_eq!(view_from(Some("editor".into()), Some("1".into())), Some("live"));
        assert_eq!(view_from(None, Some("1".into())), Some("live"));
        assert_eq!(view_from(None, Some("0".into())), None);
        assert_eq!(view_from(None, None), None);
        assert_eq!(index_from(Some("1".into())), Some(1));
        assert_eq!(index_from(Some(" 0 ".into())), Some(0));
        assert_eq!(index_from(Some("projector".into())), None);
        assert_eq!(index_from(None), None);
        let library = &[PathBuf::from("/p")][..];
        assert_eq!(preset_from(None, library), None);
        assert_eq!(preset_from(Some(String::new()), library), None);
        assert_eq!(preset_from(Some("a/b.milk".into()), library).as_deref(), Some("/p/a/b.milk"));
        assert_eq!(preset_from(Some("/x.milk".into()), library).as_deref(), Some("/x.milk"));
    }
}
