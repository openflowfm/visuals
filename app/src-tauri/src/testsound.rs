//! A test sound for the first run, so the visuals move before any music plays.
//! A stub for now: issue #88 plays it here.

/// Play the test sound into the bench, or stop it.
#[tauri::command]
pub fn test_sound(on: bool) -> Result<(), String> {
    let _ = on;
    Err("the test sound isn't ready yet".into())
}
