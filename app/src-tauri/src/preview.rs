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

#[tauri::command]
pub fn stats(app: State<App>) -> bench::Stats {
    app.bench.lock().unwrap().as_ref().map(|b| *b.stats.lock().unwrap()).unwrap_or_default()
}
