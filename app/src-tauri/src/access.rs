//! Reduced motion (#100): caps the strobe, flashes and punch and fades the
//! blackout ([`crate::fx`]'s `master`; presets' own flashing is theirs), and follows macOS's Reduce motion until a choice is made in
//! Settings. The choice (on, off, or none: follow macOS) is kept in
//! `access.json`; macOS's setting is read again every couple of seconds, so
//! turning it on in System Settings calms a show that is already playing.
//! A damaged `access.json` fails safe: motion is reduced, and the file is moved
//! aside and said as [`crate::settings`] does for every settings file.
//!
//! `access.json` also keeps whether "I understand" was chosen on the flashing
//! warning, so it is asked once. A file from before it was kept reads as not
//! chosen, and so does a damaged one: the warning shows again.

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

/// What's kept in [`FILE`]: the choice (`null` follows macOS), and whether the
/// flashing warning's "I understand" was chosen (missing in older files: not yet).
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Kept {
    reduce: Option<bool>,
    #[serde(default)]
    flash_warning_understood: bool,
}

const FILE: &str = "access.json";

/// The choice made in the app, and what's in force.
struct State {
    /// `None` follows macOS. Read from [`FILE`] at [`start`]; a damaged file
    /// makes it the fail-safe `Some(true)`.
    choice: Mutex<Option<bool>>,
    /// The choice as the user made it (in [`FILE`] or in Settings since), which
    /// is what's written back: never the fail-safe. Its lock is held while
    /// [`FILE`] is written, so the file ends with what's in force.
    chosen: Mutex<Option<bool>>,
    /// What the render thread reads every refresh, through [`reduced`].
    reduced: AtomicBool,
    /// "I understand" chosen on the flashing warning. Read from [`FILE`] at [`start`].
    understood: AtomicBool,
}

impl State {
    const fn new() -> State {
        State { choice: Mutex::new(None), chosen: Mutex::new(None), reduced: AtomicBool::new(false), understood: AtomicBool::new(false) }
    }

    /// Take what [`FILE`] read as (`kept`; `found` when it was there): the
    /// warning's answer, the choice as made, and the choice to start with.
    fn load(&self, kept: Option<Kept>, found: bool, system: impl FnOnce() -> bool) -> Motion {
        self.understood.store(kept.as_ref().is_some_and(|k| k.flash_warning_understood), Ordering::Relaxed);
        *self.chosen.lock().unwrap_or_else(|e| e.into_inner()) = kept.as_ref().and_then(|k| k.reduce);
        self.update(Some(first_choice(kept, found)), system)
    }

    /// Put the choice `on` in force and `save` it with the warning's answer;
    /// false when it couldn't be saved.
    fn choose(&self, on: Option<bool>, system: impl FnOnce() -> bool, save: impl FnOnce(&Kept) -> bool) -> (Motion, bool) {
        let mut chosen = self.chosen.lock().unwrap_or_else(|e| e.into_inner());
        *chosen = on;
        let motion = self.update(Some(on), system);
        let saved = save(&Kept { reduce: on, flash_warning_understood: self.understood.load(Ordering::Relaxed) });
        (motion, saved)
    }

    /// "I understand" was chosen: in force now, and `save`d beside the choice
    /// as the user made it; false when it couldn't be saved.
    fn understand(&self, save: impl FnOnce(&Kept) -> bool) -> bool {
        let chosen = self.chosen.lock().unwrap_or_else(|e| e.into_inner());
        self.understood.store(true, Ordering::Relaxed);
        save(&Kept { reduce: *chosen, flash_warning_understood: true })
    }

    /// Work out what's in effect from the choice (changed first by `change`, if
    /// given) and macOS now (`system`), and put it in force: all under the
    /// choice's lock, so a poll that read the old choice can't put it back in
    /// force after a new one.
    fn update(&self, change: Option<Option<bool>>, system: impl FnOnce() -> bool) -> Motion {
        let mut choice = self.choice.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(to) = change {
            *choice = to;
        }
        let motion = resolve(*choice, system());
        self.reduced.store(motion.reduced, Ordering::Relaxed);
        motion
    }
}

static STATE: State = State::new();
/// How often macOS's setting is read again.
const POLL: Duration = Duration::from_secs(2);

/// Whether motion is reduced now. Cheap: the render thread asks every refresh.
pub fn reduced() -> bool {
    STATE.reduced.load(Ordering::Relaxed)
}

/// What's in effect, given the app's `choice` and whether macOS's Reduce motion is on.
pub fn resolve(choice: Option<bool>, system_on: bool) -> Motion {
    match choice {
        Some(on) => Motion { reduced: on, system: false },
        None => Motion { reduced: system_on, system: true },
    }
}

/// The choice to start with, from what [`FILE`] read as (`kept`) and whether it
/// was there (`found`): a missing file follows macOS, but one that was there and
/// couldn't be read (damaged, or not holding a choice) fails safe, reducing motion.
fn first_choice(kept: Option<Kept>, found: bool) -> Option<bool> {
    match kept {
        Some(k) => k.reduce,
        None if found => Some(true),
        None => None,
    }
}

/// [`State::update`] for the app, with macOS's setting read afresh.
fn update_with(change: Option<Option<bool>>) -> Motion {
    STATE.update(change, system_reduces_motion)
}

fn update() -> Motion {
    update_with(None)
}

/// Whether motion is reduced now (macOS's setting read afresh).
#[tauri::command]
pub fn reduced_motion() -> Motion {
    update()
}

/// Reduce motion (`true`), don't (`false`), or (`None`) follow macOS again;
/// kept for next launch. The choice is in force at once either way; if it
/// couldn't be kept, the error says so (and the settings' problems too).
#[tauri::command]
pub fn reduced_motion_set(on: Option<bool>) -> Result<Motion, String> {
    let (motion, kept) = STATE.choose(on, system_reduces_motion, keep);
    if !kept {
        return Err(NOT_KEPT.into());
    }
    Ok(motion)
}

/// Write [`FILE`].
fn keep(kept: &Kept) -> bool {
    settings::save_json(FILE, kept)
}

/// What [`reduced_motion_set`] says when the choice couldn't be kept.
const NOT_KEPT: &str = "Couldn't save the reduced motion setting; it is in force until visual[flow] quits.";

/// Whether "I understand" was chosen on the flashing warning, at this launch or one before.
#[tauri::command]
pub fn flash_warning_understood() -> bool {
    STATE.understood.load(Ordering::Relaxed)
}

/// "I understand" was chosen on the flashing warning: kept for every launch
/// after. It holds until visual[flow] quits even if it couldn't be kept, which
/// the error says. The reduce-flashing choice is written back as the user made
/// it: after a damaged `access.json`, not the fail-safe in force.
#[tauri::command]
pub fn flash_warning_understand() -> Result<(), String> {
    if !STATE.understand(keep) {
        return Err(NOT_KEPT_WARNING.into());
    }
    Ok(())
}

/// What [`flash_warning_understand`] says when it couldn't be kept.
const NOT_KEPT_WARNING: &str = "Couldn't save that you've read the flashing warning; it will be shown again at the next launch.";

/// Called once at setup: reads the kept choice (a damaged file is moved aside
/// and said, as every settings file is, and reduces motion) and macOS's
/// setting, and keeps reading macOS's while the app runs.
pub fn start(_handle: &AppHandle) {
    let found = settings::dir().join(FILE).exists();
    STATE.load(settings::load::<Kept>(FILE), found, system_reduces_motion);
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
    fn the_kept_choice_reads_back_and_a_bad_file_fails_safe() {
        for on in [Some(true), Some(false), None] {
            assert_eq!(first_choice(Some(Kept { reduce: on, flash_warning_understood: false }), true), on);
        }
        assert_eq!(first_choice(None, false), None, "no file: follow macOS");
        assert_eq!(first_choice(None, true), Some(true), "a file that couldn't be read: reduce motion");
        // A versioned file reads as a choice; a damaged one doesn't (settings moves it aside).
        assert_eq!(serde_json::from_str::<Kept>(r#"{"version":1,"reduce":false}"#).unwrap(), Kept { reduce: Some(false), flash_warning_understood: false });
        assert!(serde_json::from_str::<Kept>(r#"{"reduce":"yes"}"#).is_err());
    }

    #[test]
    fn the_flashing_warnings_answer_is_kept_and_an_older_file_reads_as_not_yet() {
        // A file from before the answer was kept: the choice reads, and the warning shows again.
        assert_eq!(serde_json::from_str::<Kept>(r#"{"reduce":true}"#).unwrap(), Kept { reduce: Some(true), flash_warning_understood: false });
        let kept = Kept { reduce: None, flash_warning_understood: true };
        let json = serde_json::to_string(&kept).unwrap();
        assert_eq!(json, r#"{"reduce":null,"flash_warning_understood":true}"#);
        assert_eq!(serde_json::from_str::<Kept>(&json).unwrap(), kept);
    }

    #[test]
    fn understanding_the_warning_keeps_the_saved_choice_as_it_was() {
        let saved = Mutex::new(None::<Kept>);
        let save = |k: &Kept| {
            *saved.lock().unwrap() = Some(Kept { reduce: k.reduce, flash_warning_understood: k.flash_warning_understood });
            true
        };
        // A damaged file: motion is reduced to be safe, but "I understand" doesn't save that as the user's choice.
        let damaged = State::new();
        assert!(damaged.load(None, true, || false).reduced);
        assert!(damaged.understand(save));
        assert_eq!(saved.lock().unwrap().take(), Some(Kept { reduce: None, flash_warning_understood: true }));
        assert!(damaged.reduced.load(Ordering::Relaxed), "the fail-safe stays in force this run");
        // A kept choice of off is written back as off, whatever macOS says.
        let off = State::new();
        off.load(Some(Kept { reduce: Some(false), flash_warning_understood: false }), true, || true);
        assert!(off.understand(save));
        assert_eq!(saved.lock().unwrap().take(), Some(Kept { reduce: Some(false), flash_warning_understood: true }));
        // A choice made after a damaged file is the user's, and is kept with the answer.
        let (motion, _) = damaged.choose(Some(false), || false, save);
        assert!(!motion.reduced);
        assert_eq!(saved.lock().unwrap().take(), Some(Kept { reduce: Some(false), flash_warning_understood: true }));
    }

    #[test]
    fn a_choice_and_a_poll_at_once_leave_the_choice_in_force() {
        // macOS says off; polls racing a choice of "on" never undo it, nor one of "off" after it.
        static HERE: State = State::new();
        let polls = std::thread::spawn(|| {
            for _ in 0..2000 {
                HERE.update(None, || false);
            }
        });
        for _ in 0..200 {
            HERE.update(Some(None), || false);
            HERE.update(Some(Some(true)), || false);
            assert!(HERE.reduced.load(Ordering::Relaxed));
        }
        polls.join().unwrap();
        assert!(HERE.reduced.load(Ordering::Relaxed));
        assert_eq!(HERE.update(None, || false), Motion { reduced: true, system: false });
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
