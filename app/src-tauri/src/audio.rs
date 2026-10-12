//! Independent main and optional microphone audio lanes. Additive IPC contract.
use crate::{listen::SourceId, App};
use tauri::State;
#[derive(Default)]
pub struct Runtime;
#[derive(Clone, Copy, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    Main,
    Mic,
}
#[derive(serde::Serialize)]
pub struct LaneStatus {
    pub source: Option<SourceId>,
    pub selected: Option<SourceId>,
    pub choice: Option<crate::listen::Choice>,
    pub channels: usize,
    pub enabled: bool,
    pub unavailable: bool,
    pub denied: bool,
}
#[derive(serde::Serialize)]
pub struct Status {
    pub main: LaneStatus,
    pub mic: LaneStatus,
}
#[tauri::command(async)]
pub fn audio_status(_app: State<App>) -> Result<Status, String> {
    Err("Audio lanes are not initialized".into())
}
#[tauri::command(async)]
pub fn choose_audio_lane(lane: Lane, source: Option<SourceId>, left: Option<usize>, right: Option<usize>, _app: State<App>) -> Result<Status, String> {
    let _ = (lane, source, left, right);
    Err("Audio lanes are not initialized".into())
}
