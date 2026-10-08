//! Development hooks, for checking the app without a screen or a hand on it:
//! `VISUALS_FX` sends live actions and `VISUALS_CAPTURE` / `VISUALS_CAPTURE_OUTPUT`
//! save pictures of the window and the live output, each after a pause.

use crate::{actions, bench, output};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;

/// Seconds from `name` in the environment, or `default` when it is unset or not a number.
fn env_secs(name: &str, default: f64) -> f64 {
    secs_from(std::env::var(name).ok(), default)
}

fn secs_from(value: Option<String>, default: f64) -> f64 {
    value.and_then(|s| s.parse().ok()).unwrap_or(default)
}

/// `VISUALS_FX='[{"kind": "mirror", "mode": "quad"}, …]'` sends those live actions
/// once the page is up (after `VISUALS_FX_AFTER` seconds, 5 by default), for
/// checking effects in a capture.
pub fn send_fx(handle: &AppHandle) {
    let Some(text) = std::env::var_os("VISUALS_FX") else { return };
    let list = match serde_json::from_str::<Vec<actions::Action>>(&text.to_string_lossy()) {
        Ok(list) => list,
        Err(e) => return eprintln!("VISUALS_FX: {e}"),
    };
    let after = env_secs("VISUALS_FX_AFTER", 5.0);
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs_f64(after));
        for action in list {
            if let Err(e) = actions::dispatch(&handle, action) {
                eprintln!("VISUALS_FX: {e}");
            }
        }
        eprintln!("VISUALS_FX: sent");
    });
}

/// Write what the window (`VISUALS_CAPTURE`) and the live output
/// (`VISUALS_CAPTURE_OUTPUT`) show to PNGs, after `VISUALS_CAPTURE_AFTER` seconds
/// (8 by default).
pub fn capture(handle: &AppHandle) {
    let window = std::env::var_os("VISUALS_CAPTURE").map(PathBuf::from);
    let output = std::env::var_os("VISUALS_CAPTURE_OUTPUT").map(PathBuf::from);
    if window.is_none() && output.is_none() {
        return;
    }
    let after = env_secs("VISUALS_CAPTURE_AFTER", 8.0);
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs_f64(after));
        let _ = handle.run_on_main_thread(move || {
            let shots = [(window, bench::view::capture as fn(&Path) -> Result<(), String>, "window"), (output, output::native::capture, "live output")];
            for (path, capture, what) in shots {
                let Some(path) = path else { continue };
                match capture(&path) {
                    Ok(()) => eprintln!("captured the {what} to {}", path.display()),
                    Err(e) => eprintln!("capture of the {what} failed: {e}"),
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_seconds_or_falls_back() {
        assert_eq!(secs_from(Some("2.5".into()), 8.0), 2.5);
        assert_eq!(secs_from(Some("soon".into()), 8.0), 8.0);
        assert_eq!(secs_from(None, 5.0), 5.0);
    }
}
