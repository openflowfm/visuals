//! The live output: the show, full screen on a display of its own (a projector,
//! a second screen). A borderless native window with no webview; its content is
//! a Metal layer the bench's render thread presents the same finished picture
//! to, scaled to fit the display with the preset's aspect kept, black around it.
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
use tauri::{AppHandle, Emitter};

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

/// `VISUALS_DISPLAY=<n>`: live mode outputs to display `n` (from 0, the system's order).
fn index_from(value: Option<String>) -> Option<usize> {
    value?.trim().parse().ok()
}

fn saved_at() -> PathBuf {
    let home = std::env::var_os("OPENFLOW_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow"));
    home.join("visuals").join("output.json")
}

fn save(choice: &Choice) {
    let path = saved_at();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(choice) {
        let _ = std::fs::write(path, text);
    }
}

fn saved() -> Option<Choice> {
    serde_json::from_str(&std::fs::read_to_string(saved_at()).ok()?).ok()
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
    }
}

fn tell(status: &Status) {
    if let Some(h) = HANDLE.get() {
        let _ = h.emit("output", status);
    }
}

/// Whether the page starts in live mode.
#[tauri::command]
pub fn live_start() -> bool {
    live_from(std::env::var("VISUALS_LIVE").ok())
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
                save(&Choice { id: d.id, name: d.name.clone() });
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

    use super::{Display, HANDLE, INSTANCE, Status, fit, tell};
    use crate::bench;
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSBackingStoreType, NSColor, NSScreen, NSStatusWindowLevel, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
    };
    use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, ns_string};
    use std::cell::RefCell;
    use tauri::{AppHandle, Manager};

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
        screen
            .deviceDescription()
            .objectForKey(ns_string!("NSScreenNumber"))
            .and_then(|n| n.downcast::<NSNumber>().ok())
            .map_or(0, |n| n.unsignedIntValue())
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
        let app = HANDLE.get()?.state::<crate::App>();
        let bench = app.bench.lock().unwrap();
        bench.as_ref().map(|b| b.commands.clone())
    }

    /// The picture's place in a window `frame` big on a display of `scale`: its
    /// rect in points, and its size in pixels.
    fn picture(frame: NSRect, scale: f64) -> (NSRect, (u32, u32)) {
        let (x, y, w, h) = fit((frame.size.width, frame.size.height), (bench::DRAW.0 as f64, bench::DRAW.1 as f64));
        let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
        (rect, ((w * scale).round() as u32, (h * scale).round() as u32))
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
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(mtm.alloc(), frame, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false)
        };
        // SAFETY: the window is kept by `OUTPUT` until it is closed, and not after.
        unsafe { window.setReleasedWhenClosed(false) };
        window.setBackgroundColor(Some(&NSColor::blackColor()));
        window.setOpaque(true);
        window.setHasShadow(false);
        // Above the menu bar (24) and the Dock (20), so neither covers the show.
        window.setLevel(NSStatusWindowLevel);
        window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        window.setFrame_display(frame, false);
        let content = NSView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
        window.setContentView(Some(&content));
        let (rect, size) = picture(frame, scale);
        let view = bench::view::metal_view(mtm, rect, scale);
        content.addSubview(&view);
        let surface = bench::view::surface_on(&view, instance);
        window.orderFrontRegardless();
        let (done, _) = std::sync::mpsc::channel();
        commands.send(bench::Cmd::Output(Some((surface, size)), done)).map_err(|e| e.to_string())?;
        eprintln!("output: open on {} ({}x{}), picture {}x{}", display.name, display.width, display.height, size.0, size.1);
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
        let (rect, size) = picture(new_frame, new_scale);
        OUTPUT.with(|o| {
            let mut o = o.borrow_mut();
            let Some(open) = o.as_mut() else { return };
            open.window.setFrame_display(new_frame, true);
            open.picture.setFrame(rect);
            if let Some(layer) = open.picture.layer() {
                layer.setContentsScale(new_scale);
            }
            (open.display, open.frame, open.scale, open.size) = (display, new_frame, new_scale, size);
        });
        if let Some(commands) = commands() {
            let _ = commands.send(bench::Cmd::OutputResize(size.0, size.1));
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
        let frame = OUTPUT.with(|o| o.borrow().as_ref().map(|o| o.frame));
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

    /// The output's window as a PNG (development: `VISUALS_CAPTURE_OUTPUT`).
    pub fn capture(path: &std::path::Path) -> Result<(), String> {
        let number = OUTPUT.with(|o| o.borrow().as_ref().map(|o| o.window.windowNumber() as u32)).ok_or("the live output is not open")?;
        bench::view::capture_window(number, path)
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
        assert_eq!(index_from(Some("1".into())), Some(1));
        assert_eq!(index_from(Some(" 0 ".into())), Some(0));
        assert_eq!(index_from(Some("projector".into())), None);
        assert_eq!(index_from(None), None);
    }
}
