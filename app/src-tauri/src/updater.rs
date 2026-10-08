//! Updates: checking for a newer release and installing it. A stub for now:
//! issue #87 starts the Tauri updater here.

use serde::Serialize;

/// A newer release than the one running.
#[derive(Serialize, Clone, Debug)]
pub struct Update {
    version: String,
    /// What changed, as the release says it.
    notes: String,
    /// When it was published, as the release gives it.
    date: Option<String>,
}

/// Start looking for updates, when the app starts. #87 sets up the updater
/// plugin here (`app.plugin(tauri_plugin_updater::Builder::new().build())`).
pub fn start(app: tauri::AppHandle) {
    let _ = app;
}

/// A newer release, if there is one.
#[tauri::command]
pub async fn update_check() -> Result<Option<Update>, String> {
    Ok(None)
}

/// Download and install the newer release, then restart into it.
#[tauri::command]
pub async fn update_install() -> Result<(), String> {
    Err("no update to install".into())
}
