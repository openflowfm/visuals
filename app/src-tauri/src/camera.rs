//! Production camera IPC. See docs/camera-app-contract.md.
use crate::App;
use tauri::State;

#[tauri::command]
pub async fn camera_begin(_app: State<'_, App>) -> Result<String, String> {
    Err("Camera is not implemented yet".into())
}
#[tauri::command]
pub async fn camera_submit(_request: tauri::ipc::Request<'_>, _app: State<'_, App>) -> Result<u32, String> {
    Err("Camera is not implemented yet".into())
}
#[tauri::command]
pub async fn camera_end(session_token: String, _app: State<'_, App>) -> Result<(), String> {
    let _ = session_token;
    Ok(())
}
