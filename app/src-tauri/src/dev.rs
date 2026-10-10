//! Development hooks, for checking the app without a screen or a hand on it:
//! `VISUALS_FX` sends live actions and `VISUALS_CAPTURE` / `VISUALS_CAPTURE_OUTPUT`
//! save pictures of the window and the live output, each after a pause;
//! `VISUALS_FROST` and `VISUALS_FROST_TINT` (debug builds) try other frosts.
//!
//! `VISUALS_HEADLESS=1` keeps the app off the screen while it runs, so a check
//! doesn't get in anyone's way: no Dock icon or menu bar, it never becomes the
//! active app, and its windows (the editor and the live output) are drawn as
//! usual but placed beyond every display, where nobody sees them and captures
//! still can. Once its captures are written, it quits.

use crate::{actions, bench, output};
use objc2::MainThreadMarker;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2_app_kit::{NSColor, NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSString};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager};

/// Whether `VISUALS_HEADLESS` asks for the app to stay off the screen.
pub fn headless() -> bool {
    flag_from(std::env::var("VISUALS_HEADLESS").ok())
}

fn flag_from(value: Option<String>) -> bool {
    value.is_some_and(|v| !v.is_empty() && v != "0")
}

/// Where a window goes to be beyond all `screens` (frames as x, y, width,
/// height, in the global coordinates `NSScreen` uses): to the right of the
/// rightmost one, with a wide gap, level with the lowest.
fn beyond(screens: &[(f64, f64, f64, f64)]) -> (f64, f64) {
    let right = screens.iter().map(|s| s.0 + s.2).fold(0.0, f64::max);
    let bottom = screens.iter().map(|s| s.1).fold(f64::INFINITY, f64::min);
    (right + 4000.0, if bottom.is_finite() { bottom } else { 0.0 })
}

/// Put `window` where no display shows it, let the mouse pass through it, and
/// order it in behind the app's other windows without activating anything. It
/// stays in the window list, so it is drawn and can be captured.
pub fn park(mtm: MainThreadMarker, window: &NSWindow) {
    let screens: Vec<_> = NSScreen::screens(mtm)
        .iter()
        .map(|s| {
            let f = s.frame();
            (f.origin.x, f.origin.y, f.size.width, f.size.height)
        })
        .collect();
    let (x, y) = beyond(&screens);
    unconstrain(window);
    window.setIgnoresMouseEvents(true);
    window.setExcludedFromWindowsMenu(true);
    // It goes in fully transparent and only becomes opaque once it is
    // certainly off every display.
    window.setAlphaValue(0.0);
    window.orderBack(None);
    window.setFrameOrigin(NSPoint::new(x, y));
    let f = window.frame();
    let seen = screens.iter().any(|s| f.origin.x < s.0 + s.2 && f.origin.x + f.size.width > s.0 && f.origin.y < s.1 + s.3 && f.origin.y + f.size.height > s.1);
    if seen {
        eprintln!("headless: the window was pulled back onto a display, so it stays transparent (its capture will be empty)");
    } else {
        window.setAlphaValue(1.0);
        eprintln!("headless: window parked off screen at {},{} ({}x{})", f.origin.x, f.origin.y, f.size.width, f.size.height);
    }
}

/// Let windows of `window`'s class go anywhere: AppKit pulls a titled window
/// back onto a display whenever it is ordered in or moved
/// (`constrainFrameRect:toScreen:`), which would bring it into view.
fn unconstrain(window: &NSWindow) {
    unsafe extern "C-unwind" fn anywhere(_: *mut AnyObject, _: Sel, rect: NSRect, _: *mut AnyObject) -> NSRect {
        rect
    }
    // SAFETY: the replacement has the selector's signature and type encoding
    // (`- (NSRect)constrainFrameRect:(NSRect)rect toScreen:(NSScreen *)screen`),
    // and it is installed on the main thread.
    unsafe {
        let class = objc2::ffi::object_getClass((window as *const NSWindow).cast()) as *mut AnyClass;
        let imp: objc2::runtime::Imp = std::mem::transmute(anywhere as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, NSRect, *mut AnyObject) -> NSRect);
        let types = c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";
        objc2::ffi::class_replaceMethod(class, objc2::sel!(constrainFrameRect:toScreen:), imp, types.as_ptr());
    }
}

/// Keep a webview drawing while its window is off the screen: WebKit otherwise
/// sees the window as hidden and stops painting the page.
///
/// # Safety
/// `webview` must be a live `WKWebView`, and this must run on the main thread.
pub unsafe fn keep_drawing(webview: *mut std::ffi::c_void) {
    let webview: &objc2::runtime::AnyObject = unsafe { &*(webview as *const objc2::runtime::AnyObject) };
    let sel = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
    // SAFETY: a plain selector check, then a private WebKit setter taking a BOOL.
    unsafe {
        let responds: bool = objc2::msg_send![webview, respondsToSelector: sel];
        if responds {
            let _: () = objc2::msg_send![webview, _setWindowOcclusionDetectionEnabled: false];
        } else {
            eprintln!("headless: this WebKit can't be told to keep drawing off screen");
        }
    }
}

/// Seconds from `name` in the environment, or `default` when it is unset or not a number.
fn env_secs(name: &str, default: f64) -> f64 {
    secs_from(std::env::var(name).ok(), default)
}

fn secs_from(value: Option<String>, default: f64) -> f64 {
    value.and_then(|s| s.parse().ok()).unwrap_or(default)
}

/// `VISUALS_WINDOW_SIZE=1440x900` sizes the main window (logical points), to
/// capture the page at a given width, even one under the window's minimum.
pub fn size(window: &tauri::WebviewWindow) {
    let Some((w, h)) = size_from(std::env::var("VISUALS_WINDOW_SIZE").ok()) else { return };
    let size = tauri::LogicalSize::new(w, h);
    if let Err(e) = window.set_min_size(Some(size)).and_then(|()| window.set_size(size)) {
        eprintln!("VISUALS_WINDOW_SIZE: {e}");
    }
}

fn size_from(value: Option<String>) -> Option<(f64, f64)> {
    let value = value?;
    let (w, h) = value.split_once('x')?;
    let (w, h) = (w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?);
    (w >= 1.0 && h >= 1.0).then_some((w, h))
}

/// `VISUALS_FX='[{"kind": "mirror", "mode": "quad"}, …]'` sends those live actions
/// once the page is up (after `VISUALS_FX_AFTER` seconds, 5 by default), for
/// checking effects in a capture.
pub fn send_fx(handle: &AppHandle) {
    let Some(text) = std::env::var_os("VISUALS_FX") else { return };
    let list = match serde_json::from_str::<Vec<actions::Action>>(&text.to_string_lossy()) {
        Ok(list) => list,
        Err(e) => return eprintln!("VISUALS_FX: {e}"),
    };
    let after = env_secs("VISUALS_FX_AFTER", 5.0);
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs_f64(after));
        for action in list {
            if let Err(e) = actions::dispatch(&handle, action) {
                eprintln!("VISUALS_FX: {e}");
            }
        }
        eprintln!("VISUALS_FX: sent");
    });
}

/// Write what the window (`VISUALS_CAPTURE`) and the live output
/// (`VISUALS_CAPTURE_OUTPUT`) show to PNGs, after `VISUALS_CAPTURE_AFTER` seconds
/// (8 by default). In headless mode the app then quits.
pub fn capture(handle: &AppHandle) {
    let window = std::env::var_os("VISUALS_CAPTURE").map(PathBuf::from);
    let output = std::env::var_os("VISUALS_CAPTURE_OUTPUT").map(PathBuf::from);
    if window.is_none() && output.is_none() {
        return;
    }
    let after = env_secs("VISUALS_CAPTURE_AFTER", 8.0);
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs_f64(after));
        // Headless, the Metal layers show black to the window server, so the
        // pictures they were given are read from the GPU and pasted in.
        let snapshot = |output: bool, wanted: bool| -> Option<bench::Picture> {
            if !(wanted && headless()) {
                return None;
            }
            handle.state::<crate::App>().ask(|reply| bench::Cmd::Snapshot(output, reply)).ok().flatten()
        };
        let overlays = [snapshot(false, window.is_some()), snapshot(true, output.is_some())];
        let quit = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            type Capture = fn(&Path, Option<&bench::Picture>) -> Result<(), String>;
            let shots: [(Option<PathBuf>, Capture, &str); 2] = [(window, bench::view::capture, "window"), (output, output::native::capture, "live output")];
            for ((path, capture, what), overlay) in shots.into_iter().zip(overlays) {
                let Some(path) = path else { continue };
                match capture(&path, overlay.as_ref()) {
                    Ok(()) => eprintln!("captured the {what} to {}", path.display()),
                    Err(e) => eprintln!("capture of the {what} failed: {e}"),
                }
            }
            if headless() {
                eprintln!("headless: captures done, quitting");
                quit.exit(0);
            }
        });
    });
}

/// The materials `VISUALS_FROST` can give the main window, by the names it takes
/// (tauri's `Effect`s, which window-vibrancy 0.8.1 draws as an
/// `NSVisualEffectView`'s material, or on macOS 26 as an `NSGlassEffectView`),
/// and `off`: a solid window. `tauri.conf.json`'s `windowEffects` is the default.
const FROSTS: [(&str, Option<Effect>); 12] = [
    ("under-window", Some(Effect::UnderWindowBackground)),
    ("sidebar", Some(Effect::Sidebar)),
    ("hud", Some(Effect::HudWindow)),
    ("fullscreen-ui", Some(Effect::FullScreenUI)),
    ("popover", Some(Effect::Popover)),
    ("menu", Some(Effect::Menu)),
    ("header", Some(Effect::HeaderView)),
    ("content", Some(Effect::ContentBackground)),
    ("window", Some(Effect::WindowBackground)),
    ("glass", Some(Effect::LiquidGlassRegular)),
    ("glass-clear", Some(Effect::LiquidGlassClear)),
    ("off", None),
];

/// `VISUALS_FROST`'s value as a name from [`FROSTS`] and its material (`None`
/// for `off`); `Err` names what it takes.
fn frost_from(value: &str) -> Result<(&'static str, Option<Effect>), String> {
    let value = value.trim().to_ascii_lowercase();
    FROSTS.iter().find(|(name, _)| *name == value).copied().ok_or_else(|| {
        let names: Vec<&str> = FROSTS.iter().map(|(n, _)| *n).collect();
        format!("no material {value:?}; one of {}", names.join(", "))
    })
}

/// `VISUALS_FROST_TINT`'s value: how much of the page's tint goes over the
/// frost, 0 (none) to 1 (all of it, as shipped), clamped.
fn tint_from(value: &str) -> Result<f64, String> {
    let tint: f64 = value.trim().parse().map_err(|_| format!("{value:?} isn't a number from 0 to 1"))?;
    if tint.is_finite() { Ok(tint.clamp(0.0, 1.0)) } else { Err(format!("{value:?} isn't a number from 0 to 1")) }
}

/// The script that tells the page which frost it is over: `data-frost` on the
/// root (home.css gives the lighter materials brighter captions) and
/// `--frost-tint` with `data-frost-tint` (home.css scales its surfaces' tints by it).
fn frost_script(name: Option<&str>, tint: Option<f64>) -> String {
    let mut js = String::from("(function(){var r=document.documentElement;");
    if let Some(name) = name {
        js += &format!("r.dataset.frost='{name}';");
    }
    if let Some(tint) = tint {
        js += &format!("r.style.setProperty('--frost-tint','{tint}');r.dataset.frostTint='';");
    }
    js + "})();"
}

/// In a debug build, `VISUALS_FROST=<material>` gives the main window that
/// material instead of `tauri.conf.json`'s (`off`: a solid window), and
/// `VISUALS_FROST_TINT=<0..1>` scales the page's tints over it, so materials
/// can be compared in a real run without rebuilding (decision 69). The bench
/// restacks itself above whichever frost is there (`bench::view`).
pub fn frost(window: &tauri::WebviewWindow) {
    if !cfg!(debug_assertions) {
        return;
    }
    let material = match std::env::var("VISUALS_FROST").ok().filter(|v| !v.is_empty()).map(|v| frost_from(&v)).transpose() {
        Ok(m) => m,
        Err(e) => return eprintln!("VISUALS_FROST: {e}"),
    };
    let tint = match std::env::var("VISUALS_FROST_TINT").ok().filter(|v| !v.is_empty()).map(|v| tint_from(&v)).transpose() {
        Ok(t) => t,
        Err(e) => return eprintln!("VISUALS_FROST_TINT: {e}"),
    };
    if material.is_none() && tint.is_none() {
        return;
    }
    if let Some((name, effect)) = material {
        let applied = match effect {
            Some(effect) => window.set_effects(EffectsBuilder::new().effect(effect).state(EffectState::Active).build()),
            None => window.set_effects(None).and_then(|()| window.ns_window()).map(|ns_window| {
                // SAFETY: tauri hands over the live NSWindow, and setup runs on the main thread.
                let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
                // The material's darkest, opaque: the window is transparent, so
                // without a colour the desktop would show through unblurred.
                ns_window.setBackgroundColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(0.118, 0.118, 0.122, 1.0)));
            }),
        };
        match applied {
            Ok(()) => eprintln!("VISUALS_FROST: the main window is {name}"),
            Err(e) => eprintln!("VISUALS_FROST: {e}"),
        }
    }
    let js = frost_script(material.map(|(name, _)| name), tint);
    // A user script, so the page has it on every load (vite reloads it in a dev run).
    let script = js.clone();
    let added = window.with_webview(move |webview| {
        // SAFETY: tauri hands over the live WKWebView on the main thread; these
        // are WebKit's public `WKUserContentController` and `WKUserScript` calls.
        unsafe {
            let webview: &AnyObject = &*(webview.inner() as *const AnyObject);
            let Some(class) = AnyClass::get(c"WKUserScript") else { return };
            let config: Retained<AnyObject> = objc2::msg_send![webview, configuration];
            let content: Retained<AnyObject> = objc2::msg_send![&*config, userContentController];
            let source = NSString::from_str(&script);
            let alloc: Allocated<AnyObject> = objc2::msg_send![class, alloc];
            // WKUserScriptInjectionTimeAtDocumentEnd is 1.
            let user: Retained<AnyObject> = objc2::msg_send![alloc, initWithSource: &*source, injectionTime: 1isize, forMainFrameOnly: true];
            let _: () = objc2::msg_send![&*content, addUserScript: &*user];
        }
    });
    if let Err(e) = added {
        eprintln!("VISUALS_FROST: {e}");
    }
    // And now, in case the page is already up.
    let _ = window.eval(&js);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_frost_material() {
        assert_eq!(frost_from("hud"), Ok(("hud", Some(Effect::HudWindow))));
        assert_eq!(frost_from(" Sidebar "), Ok(("sidebar", Some(Effect::Sidebar))));
        assert_eq!(frost_from("under-window"), Ok(("under-window", Some(Effect::UnderWindowBackground))));
        assert_eq!(frost_from("glass"), Ok(("glass", Some(Effect::LiquidGlassRegular))));
        assert_eq!(frost_from("off"), Ok(("off", None)));
        let e = frost_from("mica").unwrap_err();
        assert!(e.contains("mica") && e.contains("fullscreen-ui"), "{e}");
        // Every name is distinct, so each reads back as itself.
        for (name, effect) in FROSTS {
            assert_eq!(frost_from(name), Ok((name, effect)));
        }
    }

    #[test]
    fn reads_a_frost_tint() {
        assert_eq!(tint_from("0.4"), Ok(0.4));
        assert_eq!(tint_from("0"), Ok(0.0));
        assert_eq!(tint_from("3"), Ok(1.0));
        assert_eq!(tint_from("-1"), Ok(0.0));
        assert!(tint_from("half").is_err());
        assert!(tint_from("NaN").is_err());
    }

    #[test]
    fn tells_the_page_its_frost() {
        assert_eq!(frost_script(Some("hud"), Some(0.5)), "(function(){var r=document.documentElement;r.dataset.frost='hud';r.style.setProperty('--frost-tint','0.5');r.dataset.frostTint='';})();");
        assert!(!frost_script(Some("off"), None).contains("frost-tint"));
        assert!(!frost_script(None, Some(0.0)).contains("dataset.frost="));
    }

    #[test]
    fn reads_seconds_or_falls_back() {
        assert_eq!(secs_from(Some("2.5".into()), 8.0), 2.5);
        assert_eq!(secs_from(Some("soon".into()), 8.0), 8.0);
        assert_eq!(secs_from(None, 5.0), 5.0);
    }

    #[test]
    fn reads_a_window_size() {
        assert_eq!(size_from(Some("1440x900".into())), Some((1440.0, 900.0)));
        assert_eq!(size_from(Some("800 x 900".into())), Some((800.0, 900.0)));
        assert_eq!(size_from(Some("big".into())), None);
        assert_eq!(size_from(Some("0x900".into())), None);
        assert_eq!(size_from(None), None);
    }

    #[test]
    fn reads_the_headless_flag() {
        assert!(flag_from(Some("1".into())));
        assert!(!flag_from(Some("0".into())));
        assert!(!flag_from(Some(String::new())));
        assert!(!flag_from(None));
    }

    #[test]
    fn parks_beyond_every_display() {
        // A laptop with a projector to its left, set lower.
        let screens = [(0.0, 0.0, 1512.0, 982.0), (-1920.0, -300.0, 1920.0, 1080.0)];
        let (x, y) = beyond(&screens);
        assert!(screens.iter().all(|s| x > s.0 + s.2));
        assert_eq!(y, -300.0);
        // One to the right: past it.
        assert_eq!(beyond(&[(0.0, 0.0, 1512.0, 982.0), (1512.0, 0.0, 3840.0, 2160.0)]), (1512.0 + 3840.0 + 4000.0, 0.0));
        assert_eq!(beyond(&[]), (4000.0, 0.0));
    }
}
