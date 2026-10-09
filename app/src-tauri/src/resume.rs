//! Picking up where the app left off: after a crash or relaunch it reopens on
//! the last playlist, position and source (#99).
//!
//! A stub for now: nothing is kept, so there's never anything to resume, and a
//! preset that fails to open is reported as before.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

/// Where the app was: the playlist and the position in it, the preset on screen and what it listened to.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Resume {
    pub playlist: Option<String>,
    pub index: Option<usize>,
    pub current: Option<String>,
    pub source: Option<crate::listen::SourceId>,
}

/// Where the app was last time, if it should pick up there. Always `None` for now.
#[tauri::command]
pub fn resume_state() -> Option<Resume> {
    None
}

/// Called once at setup. Does nothing yet.
pub fn start(_handle: &AppHandle) {}

/// Called after every change to the deck, to keep where it is. Does nothing yet.
pub fn note(_handle: &AppHandle, _deck: &crate::actions::DeckView) {}

/// What the deck does about a preset that failed to open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failed {
    /// Say so, as now.
    Report,
    /// Step on to the next one without a word.
    Skip,
}

/// Asked by the deck when the preset at `path` failed to open. Always [`Failed::Report`] for now.
pub fn open_failed(_handle: &AppHandle, _path: &Path, _error: &str) -> Failed {
    Failed::Report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_is_nothing_to_resume_yet() {
        assert_eq!(resume_state(), None);
        assert_eq!(serde_json::to_string(&Resume::default()).unwrap(), r#"{"playlist":null,"index":null,"current":null,"source":null}"#);
    }
}
