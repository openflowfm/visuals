//! The quality setting: render scale and mesh size, at three levels or picked
//! for the machine (`auto`) (#101).
//!
//! A stub for now: the quality is always `auto`, which draws as high, and it
//! can't be chosen yet.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// A quality level; `auto` picks one of the others for the machine.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    #[default]
    Auto,
    Low,
    Medium,
    High,
}

/// The level the user chose, and the one drawn at (never `auto`).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Quality {
    pub chosen: Level,
    pub effective: Level,
}

/// The quality now.
#[tauri::command]
pub fn quality_get() -> Quality {
    Quality { chosen: Level::Auto, effective: Level::High }
}

/// Chooses the quality. Not there yet: always an error.
#[tauri::command]
pub fn quality_set(level: Level) -> Result<Quality, String> {
    let _ = level;
    Err("Choosing the quality comes in 0.9.".into())
}

/// Called once at setup. Does nothing yet.
pub fn start(_handle: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_quality_is_auto_drawn_high_and_cant_be_chosen_yet() {
        assert_eq!(serde_json::to_string(&quality_get()).unwrap(), r#"{"chosen":"auto","effective":"high"}"#);
        assert_eq!(serde_json::from_str::<Level>(r#""medium""#).unwrap(), Level::Medium);
        assert!(quality_set(Level::Low).is_err());
    }
}
