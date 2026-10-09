//! Reduced motion: caps strobe and flashes, and follows macOS's Reduce motion
//! setting (#100).
//!
//! A stub for now: motion is never reduced, macOS's setting isn't read, and it
//! can't be turned on yet.

use serde::Serialize;
use tauri::AppHandle;

/// Whether motion is reduced.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct Motion {
    /// In effect now.
    pub reduced: bool,
    /// macOS's Reduce motion is on.
    pub system: bool,
}

/// Whether motion is reduced now.
#[tauri::command]
pub fn reduced_motion() -> Motion {
    Motion::default()
}

/// Turns reduced motion on or off, or (`None`) back to following macOS. Not there yet: always an error.
#[tauri::command]
pub fn reduced_motion_set(on: Option<bool>) -> Result<Motion, String> {
    let _ = on;
    Err("Reduced motion comes in 0.9.".into())
}

/// Called once at setup. Does nothing yet.
pub fn start(_handle: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn motion_is_not_reduced_yet() {
        assert_eq!(serde_json::to_string(&reduced_motion()).unwrap(), r#"{"reduced":false,"system":false}"#);
        assert!(reduced_motion_set(Some(true)).is_err());
    }
}
