//! Where the presets come from: the starter set bundled with the app, and the
//! full pack downloaded into the presets folder ([`engine::preset::pack_dir`]).
//! A stub for now: issue #86 fills in the download.

use crate::App;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The event the download's progress goes out on, a [`PackStatus`] each time.
// Contract placeholder: #86 emits it.
#[allow(dead_code)]
pub const PROGRESS: &str = "pack-progress";

/// How many presets the full pack has.
const TOTAL: usize = 9795;
/// The full pack's download, in bytes.
const SIZE: u64 = 130_000_000;

/// The folders presets are listed from: the presets folder, and the bundled
/// starter set when the app has one.
pub fn folders(app: &AppHandle) -> Vec<PathBuf> {
    let mut folders = vec![app.state::<App>().library.clone()];
    folders.extend(starter(app));
    folders
}

/// Every preset in `folders`, in order: what the library lists, and what live
/// actions (random, next, auto-advance) choose from.
pub fn milk_files_in(folders: &[PathBuf]) -> Vec<PathBuf> {
    folders.iter().flat_map(|f| engine::preset::milk_files(f)).collect()
}

/// Every preset the library lists.
pub fn milk_files(app: &AppHandle) -> Vec<PathBuf> {
    milk_files_in(&folders(app))
}

/// Where a folder-relative preset path is: in the first of `folders` that has
/// it, else in the first folder (the presets folder).
pub fn resolve_in(folders: &[PathBuf], rel: &std::path::Path) -> PathBuf {
    folders.iter().map(|f| f.join(rel)).find(|p| p.exists()).unwrap_or_else(|| folders.first().map(|f| f.join(rel)).unwrap_or_else(|| rel.to_path_buf()))
}

/// The bundled starter set's folder, when it is there.
pub fn starter(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("presets").join("starter")).filter(|d| d.is_dir())
}

/// Where the full pack's download is.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Idle,
    // Contract placeholders: #86 sets them.
    #[allow(dead_code)]
    Downloading,
    #[allow(dead_code)]
    Failed,
}

#[derive(Serialize, Clone, Debug)]
pub struct PackStatus {
    /// `.milk` files in the bundled starter set.
    starter: usize,
    /// `.milk` files in the presets folder.
    installed: usize,
    /// Presets in the full pack.
    total: usize,
    /// The full pack's download, in bytes.
    size: u64,
    state: State,
    /// Bytes downloaded so far.
    received: u64,
    /// Why the last download failed.
    error: Option<String>,
}

/// How many presets there are and where the full pack's download is.
#[tauri::command]
pub fn pack_status(handle: AppHandle, app: tauri::State<App>) -> PackStatus {
    PackStatus {
        starter: starter(&handle).map_or(0, |d| engine::preset::milk_files(&d).len()),
        installed: engine::preset::milk_files(&app.library).len(),
        total: TOTAL,
        size: SIZE,
        state: State::Idle,
        received: 0,
        error: None,
    }
}

/// Download the full pack into the presets folder, telling the page how it goes
/// on [`PROGRESS`].
#[tauri::command]
pub async fn pack_download() -> Result<(), String> {
    Err("the full pack can't be downloaded yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_presets_folder_still_lists_and_resolves_the_starter_set() {
        let dir = std::env::temp_dir().join(format!("visuals-pack-{}", std::process::id()));
        let presets = dir.join("presets");
        let starter = dir.join("starter");
        std::fs::create_dir_all(&presets).unwrap();
        std::fs::create_dir_all(starter.join("a")).unwrap();
        std::fs::write(starter.join("a/one.milk"), "").unwrap();
        let folders = vec![presets.clone(), starter.clone()];
        assert_eq!(milk_files_in(&folders), vec![starter.join("a/one.milk")]);
        assert_eq!(resolve_in(&folders, std::path::Path::new("a/one.milk")), starter.join("a/one.milk"));
        assert_eq!(resolve_in(&folders, std::path::Path::new("b.milk")), presets.join("b.milk"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
