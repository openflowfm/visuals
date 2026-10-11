//! The bench as the page shows it: its place in the window and how it is drawing.

use crate::{bench, App};
use tauri::State;
#[cfg(target_os = "macos")]
use tauri::Manager;

/// The page's hole for the bench, in CSS pixels from the window's top left.
#[tauri::command]
pub fn place_bench(x: f64, y: f64, width: f64, height: f64, handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let inner = handle.clone();
        handle
            .run_on_main_thread(move || {
                if let Some((w, h)) = bench::view::place(x, y, width, height) {
                    inner.state::<App>().send(bench::Cmd::Resize(w, h));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (x, y, width, height, handle);
    Ok(())
}

/// Show the preset at `path` moving in its library tile, drawn at about
/// `width`×`height` (`bench::hover`), in place of the one hovered before; no
/// path stops. Returns the hover's ticket, which its pictures carry (0 for none).
#[tauri::command]
pub async fn hover_preview(path: Option<String>, width: u32, height: u32, app: State<'_, App>, handle: tauri::AppHandle) -> Result<u32, String> {
    let Some(path) = path else {
        bench::hover::stop();
        return Ok(0);
    };
    let file = std::path::Path::new(&path);
    let text = engine::preset::decode(&crate::library::read_preset(file)?);
    Ok(bench::hover::show_tuned(engine::preset::parse(&text), (width, height), &app.ring, bench::hover::tuning(&handle, file)))
}

/// The hover's latest picture as raw bytes: a 16-byte header (ticket, count,
/// width, height), then its RGBA rows top to bottom (`bench::hover::packed`).
/// Empty until there is one newer than the count `after`; 0×0 when the preset failed.
#[tauri::command]
pub async fn hover_frame(after: u32) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bench::hover::frame(after))
}

#[tauri::command]
pub fn stats(app: State<App>) -> bench::Stats {
    app.bench.lock().unwrap().as_ref().map(|b| *b.stats.lock().unwrap()).unwrap_or_default()
}
