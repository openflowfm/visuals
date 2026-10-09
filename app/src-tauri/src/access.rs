//! Reduced motion (#100): caps the strobe, flashes and punch ([`crate::fx`]'s
//! `master`), and follows macOS's Reduce motion until a choice is made in
//! Settings. The choice (on, off, or none: follow macOS) is kept in
//! `access.json`; macOS's setting is read again every couple of seconds, so
//! turning it on in System Settings calms a show that is already playing.

use crate::settings;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;

/// Whether motion is reduced, as the page reads it (`api.Motion`).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct Motion {
    /// In effect now.
    pub reduced: bool,
    /// No choice made in the app: macOS's Reduce motion decides.
    pub system: bool,
}

/// The choice kept in [`FILE`]: `null` follows macOS.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Kept {
    reduce: Option<bool>,
}

const FILE: &str = "access.json";

/// What the render thread reads every refresh, through [`reduced`].
static REDUCED: AtomicBool = AtomicBool::new(false);
/// The choice made in the app; `None` follows macOS. Read from [`FILE`] at [`start`].
static CHOICE: Mutex<Option<bool>> = Mutex::new(None);
/// How often macOS's setting is read again.
const POLL: Duration = Duration::from_secs(2);

/// Whether motion is reduced now. Cheap: the render thread asks every refresh.
pub fn reduced() -> bool {
    REDUCED.load(Ordering::Relaxed)
}

/// What's in effect, given the app's `choice` and whether macOS's Reduce motion is on.
pub fn resolve(choice: Option<bool>, system_on: bool) -> Motion {
    match choice {
        Some(on) => Motion { reduced: on, system: false },
        None => Motion { reduced: system_on, system: true },
    }
}

/// The choice as [`FILE`] reads; a missing or broken file follows macOS.
fn read_choice(text: Option<&str>) -> Option<bool> {
    text.and_then(|t| serde_json::from_str::<Kept>(t).ok()).and_then(|k| k.reduce)
}

/// Work out what's in effect from the choice and macOS now, and put it in force.
fn update() -> Motion {
    let choice = *CHOICE.lock().unwrap_or_else(|e| e.into_inner());
    let motion = resolve(choice, system_reduces_motion());
    REDUCED.store(motion.reduced, Ordering::Relaxed);
    motion
}

/// Whether motion is reduced now (macOS's setting read afresh).
#[tauri::command]
pub fn reduced_motion() -> Motion {
    update()
}

/// Reduce motion (`true`), don't (`false`), or (`None`) follow macOS again; kept for next launch.
#[tauri::command]
pub fn reduced_motion_set(on: Option<bool>) -> Result<Motion, String> {
    *CHOICE.lock().unwrap_or_else(|e| e.into_inner()) = on;
    settings::save_json(FILE, &Kept { reduce: on });
    Ok(update())
}

/// Called once at setup: reads the kept choice and macOS's setting, and keeps
/// reading macOS's while the app runs.
pub fn start(_handle: &AppHandle) {
    let text = std::fs::read_to_string(settings::dir().join(FILE)).ok();
    *CHOICE.lock().unwrap_or_else(|e| e.into_inner()) = read_choice(text.as_deref());
    update();
    let _ = std::thread::Builder::new().name("reduce-motion".into()).spawn(|| {
        loop {
            std::thread::sleep(POLL);
            update();
        }
    });
}

/// macOS's Settings › Accessibility › Display › Reduce motion.
#[cfg(target_os = "macos")]
pub fn system_reduces_motion() -> bool {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    objc2::rc::autoreleasepool(|_| {
        let Some(class) = AnyClass::get(c"NSWorkspace") else { return false };
        // SAFETY: `sharedWorkspace` is a class method returning the shared instance (or nil),
        // and `accessibilityDisplayShouldReduceMotion` a BOOL property, safe from any thread.
        let workspace: *mut AnyObject = unsafe { msg_send![class, sharedWorkspace] };
        if workspace.is_null() {
            return false;
        }
        unsafe { msg_send![workspace, accessibilityDisplayShouldReduceMotion] }
    })
}

#[cfg(not(target_os = "macos"))]
pub fn system_reduces_motion() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_no_choice_it_follows_macos() {
        assert_eq!(resolve(None, true), Motion { reduced: true, system: true });
        assert_eq!(resolve(None, false), Motion { reduced: false, system: true });
    }

    #[test]
    fn a_choice_in_the_app_wins_over_macos() {
        assert_eq!(resolve(Some(false), true), Motion { reduced: false, system: false });
        assert_eq!(resolve(Some(true), false), Motion { reduced: true, system: false });
    }

    #[test]
    fn the_kept_choice_reads_back_and_a_bad_file_follows_macos() {
        for on in [Some(true), Some(false), None] {
            let text = serde_json::to_string(&Kept { reduce: on }).unwrap();
            assert_eq!(read_choice(Some(&text)), on);
        }
        assert_eq!(read_choice(None), None);
        assert_eq!(read_choice(Some("{not json")), None);
        assert_eq!(read_choice(Some(r#"{"reduce":"yes"}"#)), None);
    }

    #[test]
    fn the_page_reads_motion_as_it_expects() {
        assert_eq!(serde_json::to_string(&resolve(None, false)).unwrap(), r#"{"reduced":false,"system":true}"#);
    }

    #[test]
    fn macos_setting_reads_without_failing() {
        // Whatever this Mac says; it must answer, off the main thread too.
        let here = system_reduces_motion();
        let there = std::thread::spawn(system_reduces_motion).join().unwrap();
        assert_eq!(here, there);
    }
}
