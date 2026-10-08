//! The small files the app keeps its choices in between runs (the audio input,
//! the output's display, the tempo), in `~/.openflow/visuals` (under
//! `OPENFLOW_HOME`). Failing to read or write one is not worth stopping the show
//! for: a missing or broken file reads as nothing kept.

use serde::de::DeserializeOwned;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// `~/.openflow/visuals`, or `$OPENFLOW_HOME/visuals`.
pub fn dir() -> PathBuf {
    dir_from(std::env::var_os("OPENFLOW_HOME"), std::env::var_os("HOME"))
}

fn dir_from(openflow_home: Option<OsString>, home: Option<OsString>) -> PathBuf {
    let home = openflow_home.map(PathBuf::from).unwrap_or_else(|| PathBuf::from(home.unwrap_or_default()).join(".openflow"));
    home.join("visuals")
}

/// The JSON kept in `name`, if it is there and reads as a `T`.
pub fn load<T: DeserializeOwned>(name: &str) -> Option<T> {
    load_at(&dir().join(name))
}

/// Keep `contents` in `name`, making the folder if need be.
pub fn save(name: &str, contents: impl AsRef<[u8]>) {
    save_at(&dir().join(name), contents.as_ref());
}

fn load_at<T: DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn save_at(path: &Path, contents: &[u8]) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, contents);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lives_under_openflow_home_or_home() {
        assert_eq!(dir_from(Some("/x/of".into()), Some("/home/me".into())), PathBuf::from("/x/of/visuals"));
        assert_eq!(dir_from(None, Some("/home/me".into())), PathBuf::from("/home/me/.openflow/visuals"));
    }

    #[test]
    fn saves_and_loads_making_the_folder() {
        let root = std::env::temp_dir().join(format!("visuals-settings-{}", std::process::id()));
        let path = root.join("deeper").join("thing.json");
        save_at(&path, br#"{"bpm": 99.50}"#);
        let v: serde_json::Value = load_at(&path).unwrap();
        assert_eq!(v["bpm"].as_f64(), Some(99.5));
        assert!(load_at::<serde_json::Value>(&root.join("missing.json")).is_none());
        std::fs::write(&path, "not json").unwrap();
        assert!(load_at::<serde_json::Value>(&path).is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
