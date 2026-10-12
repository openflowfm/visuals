//! Production camera IPC. See docs/camera-app-contract.md.
use crate::{bench, App};
use engine::contours::{Contours, Path};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Metadata {
    pub session_token: String,
    pub sequence: u32,
    pub source_epoch: u32,
    pub width: u32,
    pub height: u32,
    pub remaining_fresh_ms: f32,
    pub feed_mix: f32,
    pub camera_opacity: f32,
    pub outline_opacity: f32,
    pub outline_width: f32,
    pub interpolation_ms: f32,
    pub paths: Vec<Path>,
}
pub(crate) struct Packet {
    pub meta: Metadata,
    pub rgba: Vec<u8>,
    pub received: Instant,
}
impl Packet {
    fn parse(bytes: &[u8], received: Instant) -> Result<Self, String> {
        if bytes.len() < 8 || bytes.len() > 2 * 1024 * 1024 || &bytes[..4] != b"CAM1" {
            return Err("Invalid camera packet".into());
        }
        let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        if length > 1024 * 1024 || length > bytes.len() - 8 {
            return Err("Invalid camera metadata length".into());
        }
        let meta: Metadata = serde_json::from_slice(&bytes[8..8 + length]).map_err(|e| e.to_string())?;
        let unit = |x: f32| x.is_finite() && (0.0..=1.0).contains(&x);
        if meta.session_token.is_empty()
            || meta.session_token.len() > 64
            || meta.sequence == 0
            || !unit(meta.feed_mix)
            || !unit(meta.camera_opacity)
            || !unit(meta.outline_opacity)
            || !meta.outline_width.is_finite()
            || !(0.25..=4.0).contains(&meta.outline_width)
            || !meta.interpolation_ms.is_finite()
            || !(0.0..=100.0).contains(&meta.interpolation_ms)
            || !meta.remaining_fresh_ms.is_finite()
            || !(0.0..=250.0).contains(&meta.remaining_fresh_ms)
        {
            return Err("Invalid camera metadata values".into());
        }
        let contours = Contours { width: meta.width, height: meta.height, mix: meta.feed_mix, color: None, paths: meta.paths.clone() };
        contours.validate().map_err(str::to_owned)?;
        if meta.paths.iter().flat_map(|p| &p.points).any(|p| p.color.is_none()) {
            return Err("Camera points require RGB colors".into());
        }
        let rgba = &bytes[8 + length..];
        if rgba.len() != meta.width as usize * meta.height as usize * 4 {
            return Err("Camera RGBA length does not match dimensions".into());
        }
        Ok(Self { meta, rgba: rgba.to_vec(), received })
    }
}

/// Owned by the render thread: command order is the session linearization point.
#[derive(Default)]
pub(crate) struct Session {
    generation: u64,
    token: Option<String>,
    sequence: u32,
    pub deadline: Option<Instant>,
}
impl Session {
    pub fn begin(&mut self) -> String {
        self.generation = self.generation.checked_add(1).expect("camera generation exhausted");
        let token = self.generation.to_string();
        self.token = Some(token.clone());
        self.sequence = 0;
        self.deadline = None;
        token
    }
    pub fn accepts(&self, packet: &Packet) -> Result<(), String> {
        if self.token.as_deref() != Some(&packet.meta.session_token) || packet.meta.sequence <= self.sequence {
            return Err("Camera session ended or frame is out of order".into());
        }
        Ok(())
    }
    pub fn accepted(&mut self, packet: &Packet) {
        self.sequence = packet.meta.sequence;
        self.deadline = Some(packet.received + Duration::from_secs_f32(packet.meta.remaining_fresh_ms / 1000.0));
    }
    pub fn end(&mut self, token: &str) -> bool {
        if self.token.as_deref() != Some(token) {
            return false;
        }
        self.token = None;
        self.deadline = None;
        true
    }
    pub fn expired(&mut self, now: Instant) -> bool {
        if self.deadline.is_some_and(|deadline| now >= deadline) {
            self.deadline = None;
            return true;
        }
        false
    }
}

#[tauri::command]
pub async fn camera_begin(app: State<'_, App>) -> Result<String, String> {
    app.ask(bench::Cmd::PersonBegin)
}
#[tauri::command]
pub async fn camera_submit(request: tauri::ipc::Request<'_>, app: State<'_, App>) -> Result<u32, String> {
    let received = Instant::now();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Camera requires a binary packet".into());
    };
    let packet = Packet::parse(bytes, received)?;
    app.ask(|reply| bench::Cmd::PersonFrame(packet, reply))?
}
#[tauri::command]
pub async fn camera_end(session_token: String, app: State<'_, App>) -> Result<(), String> {
    app.ask(|reply| bench::Cmd::PersonEnd(session_token, reply))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(token: &str, seq: u32) -> Packet {
        let meta = serde_json::json!({"sessionToken":token,"sequence":seq,"sourceEpoch":0,"width":2,"height":1,"remainingFreshMs":100,"feedMix":0.3,"cameraOpacity":0.0,"outlineOpacity":0.65,"outlineWidth":0.85,"interpolationMs":65,"paths":[]});
        let json = serde_json::to_vec(&meta).unwrap();
        let mut bytes = b"CAM1".to_vec();
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(json);
        bytes.extend([0; 8]);
        Packet::parse(&bytes, Instant::now()).unwrap()
    }
    #[test]
    fn session_rejects_late_frames_and_old_end_and_expires_without_ending() {
        let mut s = Session::default();
        let old = s.begin();
        let p = packet(&old, 1);
        s.accepts(&p).unwrap();
        s.accepted(&p);
        assert!(s.accepts(&p).is_err());
        assert!(s.expired(p.received + Duration::from_millis(101)));
        assert!(s.accepts(&packet(&old, 2)).is_ok());
        let new = s.begin();
        assert!(!s.end(&old));
        assert!(s.accepts(&p).is_err());
        assert!(s.end(&new));
        assert!(s.accepts(&packet(&new, 1)).is_err());
    }
    #[test]
    fn rejects_malformed_unbounded_and_wrong_image_packets() {
        for bytes in [vec![], b"CAM1\xff\xff\xff\xff".to_vec(), vec![0; 2 * 1024 * 1024 + 1]] {
            assert!(Packet::parse(&bytes, Instant::now()).is_err());
        }
        let p = packet("1", 1);
        assert_eq!(p.rgba.len(), 8);
        let meta = serde_json::json!({"sessionToken":"1","sequence":1,"sourceEpoch":0,"width":641,"height":1,"remainingFreshMs":100,"feedMix":0.3,"cameraOpacity":0,"outlineOpacity":0.65,"outlineWidth":0.85,"interpolationMs":65,"paths":[]});
        let json = serde_json::to_vec(&meta).unwrap();
        let mut bytes = b"CAM1".to_vec();
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(json);
        bytes.extend([0; 8]);
        assert!(Packet::parse(&bytes, Instant::now()).is_err());
    }
}
