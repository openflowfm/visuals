//! What the user keeps about presets: ★, their own tags, hidden ("never play"),
//! and overrides of the automatic groups the index gives a preset
//! ([`crate::catalog`]). Kept per preset by its key (folder-relative path,
//! `cream-of-the-crop/Dancer/…/x.milk`), for the presets the user has touched
//! only.
//!
//! The file is `~/.openflow/visuals/library.json` (`OPENFLOW_VISUALS_LIBRARY`
//! overrides), versioned:
//!
//! ```json
//! { "version": 1,
//!   "presets": {
//!     "cream-of-the-crop/Dancer/Whirl/ORB - Xenon.milk": {
//!       "hash": "<SHA-256 of the file, hex>",
//!       "star": true, "tags": ["warm up"], "hidden": false,
//!       "overrides": { "style": "Hypnotic", "speed": "low" } } } }
//! ```
//!
//! Every field of a preset but the key may be left out (false, empty, none).
//! `hash` lets a preset that moved be found again by its content. The file is
//! written through a temporary file and renamed into place; one that won't
//! parse is moved aside (`library.json.bad`) rather than overwritten, as
//! `playlists.rs` does. Each change goes out to the page as [`CHANGED`].
//!
//! The 0.4 contract's stub: changes are kept in memory only; #93 reads and
//! writes the file, re-matches moved presets and keeps hidden ones out of play.

use engine::index::Level;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// The event a change goes out on, the whole [`LibraryData`] each time.
pub const CHANGED: &str = "library-changed";

/// The file format's version.
pub const VERSION: u32 = 1;

/// The user's own values for a preset's automatic groups; `None` keeps the index's.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Overrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Hues in degrees, the strongest first (the colour group).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hues: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intensity: Option<Level>,
}

impl Overrides {
    fn is_empty(&self) -> bool {
        *self == Overrides::default()
    }

    /// Takes each value `other` sets.
    fn merge(&mut self, other: Overrides) {
        fn take<T>(into: &mut Option<T>, from: Option<T>) {
            if from.is_some() {
                *into = from;
            }
        }
        take(&mut self.style, other.style);
        take(&mut self.sub_style, other.sub_style);
        take(&mut self.authors, other.authors);
        take(&mut self.title, other.title);
        take(&mut self.hues, other.hues);
        take(&mut self.brightness, other.brightness);
        take(&mut self.speed, other.speed);
        take(&mut self.intensity, other.intensity);
    }
}

/// What the user keeps about one preset.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Mine {
    /// The file's content hash when last touched, to find it again if it moves.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub star: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Never played by random or auto-advance, and shown only when asked for.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Overrides::is_empty")]
    pub overrides: Overrides,
}

impl Mine {
    fn is_empty(&self) -> bool {
        !self.star && !self.hidden && self.tags.is_empty() && self.overrides.is_empty()
    }
}

/// `library.json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LibraryData {
    pub version: u32,
    /// By key; only presets the user has touched.
    pub presets: BTreeMap<String, Mine>,
}

impl Default for LibraryData {
    fn default() -> Self {
        LibraryData { version: VERSION, presets: BTreeMap::new() }
    }
}

/// One change, made to each preset [`library_set`] is given. A field left out
/// changes nothing.
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Change {
    pub star: Option<bool>,
    pub hidden: Option<bool>,
    /// Tags to add (once each) and to take off.
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    /// Drop the preset's overrides before `overrides` is applied.
    pub clear_overrides: bool,
    /// Values to set; the ones left out stay as they are.
    pub overrides: Option<Overrides>,
}

/// Applies `change` to the presets at `keys`. A preset left with nothing kept is dropped.
pub fn apply(data: &mut LibraryData, keys: &[String], change: &Change) {
    for key in keys {
        let mine = data.presets.entry(key.clone()).or_default();
        if let Some(star) = change.star {
            mine.star = star;
        }
        if let Some(hidden) = change.hidden {
            mine.hidden = hidden;
        }
        mine.tags.retain(|t| !change.remove_tags.contains(t));
        for t in &change.add_tags {
            if !mine.tags.contains(t) {
                mine.tags.push(t.clone());
            }
        }
        if change.clear_overrides {
            mine.overrides = Overrides::default();
        }
        if let Some(o) = &change.overrides {
            mine.overrides.merge(o.clone());
        }
        if mine.is_empty() {
            data.presets.remove(key);
        }
    }
}

/// The user's library data, managed by Tauri beside `crate::App`.
pub struct Store {
    /// Where it is kept; read and written by #93.
    #[allow(dead_code)]
    file: PathBuf,
    data: Mutex<LibraryData>,
}

impl Store {
    /// The data kept in `file`. Stub: starts empty.
    pub fn open(file: PathBuf) -> Store {
        Store { file, data: Mutex::new(LibraryData::default()) }
    }
}

/// Where the library data lives unless `OPENFLOW_VISUALS_LIBRARY` says otherwise.
pub fn default_file() -> PathBuf {
    std::env::var_os("OPENFLOW_VISUALS_LIBRARY").map(PathBuf::from).unwrap_or_else(|| crate::settings::dir().join("library.json"))
}

/// The presets random and auto-advance may choose from the library's `all`:
/// all but the hidden ones. Stub: all of them.
pub fn playable(_handle: &AppHandle, all: Vec<PathBuf>) -> Vec<PathBuf> {
    all
}

/// Everything the user keeps about presets.
#[tauri::command]
pub fn library_data(store: State<Store>) -> LibraryData {
    store.data.lock().unwrap().clone()
}

/// Make `change` to each preset at `keys` (folder-relative, as
/// [`crate::catalog::Row::key`]), keep it, and tell the page ([`CHANGED`]).
#[tauri::command]
pub fn library_set(keys: Vec<String>, change: Change, store: State<Store>, handle: AppHandle) -> Result<LibraryData, String> {
    let data = {
        let mut data = store.data.lock().unwrap();
        apply(&mut data, &keys, &change);
        data.clone()
    };
    handle.emit(CHANGED, &data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_apply_to_each_key_and_untouched_presets_drop_out() {
        let mut data = LibraryData::default();
        let keys = ["a.milk".to_string(), "b.milk".to_string()];
        apply(&mut data, &keys, &Change { star: Some(true), add_tags: vec!["warm".into(), "warm".into()], ..Default::default() });
        assert_eq!(data.presets["a.milk"], Mine { star: true, tags: vec!["warm".into()], ..Default::default() });
        apply(&mut data, &keys[..1], &Change { overrides: Some(Overrides { speed: Some(Level::Low), ..Default::default() }), ..Default::default() });
        apply(&mut data, &keys[..1], &Change { overrides: Some(Overrides { style: Some("Hypnotic".into()), ..Default::default() }), ..Default::default() });
        assert_eq!(data.presets["a.milk"].overrides, Overrides { speed: Some(Level::Low), style: Some("Hypnotic".into()), ..Default::default() });
        apply(&mut data, &keys, &Change { star: Some(false), remove_tags: vec!["warm".into()], ..Default::default() });
        assert!(!data.presets.contains_key("b.milk"));
        apply(&mut data, &keys[..1], &Change { clear_overrides: true, ..Default::default() });
        assert!(data.presets.is_empty());
    }

    #[test]
    fn the_file_format_reads_as_documented() {
        let text = r#"{ "version": 1, "presets": { "cream-of-the-crop/Dancer/x.milk": { "hash": "ab", "star": true, "tags": ["warm up"], "overrides": { "style": "Hypnotic", "speed": "low" } } } }"#;
        let data: LibraryData = serde_json::from_str(text).unwrap();
        let mine = &data.presets["cream-of-the-crop/Dancer/x.milk"];
        assert_eq!((mine.star, mine.hidden, mine.overrides.speed), (true, false, Some(Level::Low)));
        let back = serde_json::to_value(&data).unwrap();
        assert_eq!(back, serde_json::from_str::<serde_json::Value>(text).unwrap());
    }
}
