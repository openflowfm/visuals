//! The editor page's commands, built only with the `lab` feature: applying an
//! edited preset on the bench, single values, the stage previews and MilkDrop's
//! default shaders. Listing and opening presets is the player's
//! ([`crate::library`]).

use crate::library::Report;
use crate::{bench, App};
use engine::preset::Preset;
use tauri::State;

#[tauri::command]
pub async fn apply(preset: Preset, app: State<'_, App>) -> Result<Report, String> {
    crate::library::load(&app, preset)
}

/// Change one value of the running preset. Returns false when it needs a reload
/// (a wave or shape turned on or off); the page applies the whole preset then.
#[tauri::command]
pub async fn set_value(owner: engine::runtime::Owner, key: String, value: f64, app: State<'_, App>) -> Result<bool, String> {
    app.ask(|tx| bench::Cmd::Set(owner, key, value, tx))
}

/// Keep the stage pictures `which` (`engine::render::PREVIEWS` indices) at
/// `width`×`height` (clamped to `engine::render::PREVIEW_MAX`); none stops them.
#[tauri::command]
pub fn set_previews(which: Vec<usize>, width: u32, height: u32, app: State<App>) {
    app.send(bench::Cmd::Previews(which, (width, height)));
}

/// The latest stage pictures as raw bytes, as `bench::packed` packs them: a
/// 12-byte header (width, height, which stages), then those pictures in
/// `PREVIEWS` order. Empty until there are some.
#[tauri::command]
pub fn previews(app: State<App>) -> tauri::ipc::Response {
    let bytes = app.bench.lock().unwrap().as_ref().and_then(|b| b.previews.lock().unwrap().clone()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

/// MilkDrop's default `warp` or `comp` shader as code for `preset`, its values
/// written in as numbers (`engine::shader::written_default`).
#[tauri::command]
pub fn default_shader(preset: Preset, which: engine::shader::Kind) -> String {
    engine::shader::written_default(which, &preset)
}
