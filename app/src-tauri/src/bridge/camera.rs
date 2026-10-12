//! Experimental local camera transport, compiled only with dev-bridge.
use super::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    preset: Option<usize>,
    preset_id: Option<String>,
    resolution: Option<Resolution>,
    speed: f64,
    persistence: f32,
}

const PRESETS: [&str; 3] = [include_str!("echo-tunnel.milk"), include_str!("mirror-cathedral.milk"), include_str!("liquid-wire.milk")];

#[derive(serde::Deserialize, Clone, Copy)]
enum Resolution {
    #[serde(rename = "360p")]
    Low,
    #[serde(rename = "720p")]
    Hd,
    #[serde(rename = "1080p")]
    FullHd,
}
impl Resolution {
    fn size(self) -> (u32, u32) {
        match self {
            Self::Low => (640, 360),
            Self::Hd => (1280, 720),
            Self::FullHd => (1920, 1080),
        }
    }
}

fn preset_source(id: &str, rows: &[crate::catalog::Row]) -> Result<String, String> {
    if let Some(index) = id.strip_prefix("camera:").and_then(|n| n.parse::<usize>().ok()) {
        return PRESETS.get(index).map(|s| s.to_string()).ok_or_else(|| "unknown camera preset".into());
    }
    let row = rows.iter().find(|row| row.key == id).ok_or("unknown catalog preset")?;
    std::fs::read_to_string(&row.path).map_err(|e| e.to_string())
}

fn audio_samples(request: &Request) -> Result<(Vec<f32>, f32), &'static str> {
    let rate = request.param("rate").and_then(|v| v.parse::<f32>().ok()).unwrap_or(f32::NAN);
    let gain = request.param("gain").and_then(|v| v.parse::<f32>().ok()).unwrap_or(f32::NAN);
    if !rate.is_finite() || !(8000.0..=192000.0).contains(&rate) || !gain.is_finite() || !(0.0..=4.0).contains(&gain) || ![512 * 4, 1024 * 4].contains(&request.body.len()) {
        return Err("expected 512 or 1024 mono float32 LE samples, rate 8000..192000 and gain 0..4");
    }
    let mut samples = Vec::with_capacity(request.body.len() / 4);
    for bytes in request.body.chunks_exact(4) {
        let sample = f32::from_le_bytes(bytes.try_into().unwrap());
        if !sample.is_finite() || !(-1.0..=1.0).contains(&sample) {
            return Err("audio samples must be finite and -1..1");
        }
        samples.push((sample * gain).clamp(-1.0, 1.0));
    }
    Ok((samples, rate))
}

/// The timing includes waiting for the render thread, GPU readback, and packing.
/// Socket transfer is measured by the caller: it cannot appear in prior headers.
fn output_header(w: u32, h: u32, bytes: usize, snapshot_ms: f64, sequence: u64) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {bytes}\r\nCache-Control: no-store\r\nX-Bridge: 1\r\nX-Frame-Width: {w}\r\nX-Frame-Height: {h}\r\nX-Frame-Sequence: {sequence}\r\nX-Snapshot-Ms: {snapshot_ms:.3}\r\nServer-Timing: snapshot;dur={snapshot_ms:.3}\r\nConnection: close\r\n\r\n"
    )
}

fn dimensions(request: &Request) -> Result<(u32, u32, f32), &'static str> {
    let w = request.param("w").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let h = request.param("h").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let mix = request.param("mix").and_then(|v| v.parse::<f32>().ok()).unwrap_or(f32::NAN);
    if w == 0 || h == 0 || w > 640 || h > 360 || request.body.len() != w as usize * h as usize * 4 || !mix.is_finite() || !(0.0..=1.0).contains(&mix) {
        return Err("expected tightly packed RGBA8 up to 640x360, w, h and mix 0..1");
    }
    Ok((w, h, mix))
}

impl Bridge {
    pub(super) fn camera_presets(&self, stream: &mut TcpStream) {
        let mut presets: Vec<serde_json::Value> = ["Chromatic vortex", "Prism cult", "Acid tide"]
            .iter()
            .enumerate()
            .map(|(i, title)| serde_json::json!({"id":format!("camera:{i}"),"title":title,"authors":["Camera lab"],"thumbnail":null}))
            .collect();
        presets.extend(
            crate::catalog::cached_rows(&self.app)
                .iter()
                .map(|row| serde_json::json!({"id":row.key,"title":row.title,"authors":row.authors,"thumbnail":row.thumbnail.as_ref().map(|url| url.replace("thumb://localhost", "/__bridge/thumb"))})),
        );
        respond(stream, "200 OK", "application/json", &serde_json::to_vec(&presets).unwrap());
    }
    pub(super) fn camera_audio(&self, stream: &mut TcpStream, request: &Request) {
        let (samples, rate) = match audio_samples(request) {
            Ok(v) => v,
            Err(e) => return respond(stream, "400 Bad Request", "text/plain", e.as_bytes()),
        };
        match self.app.state::<App>().ask(|reply| bench::Cmd::CameraAudio(samples, rate, reply)) {
            Ok(()) => respond(stream, "200 OK", "application/json", b"null"),
            Err(e) => respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
        }
    }
    pub(super) fn camera_audio_stop(&self, stream: &mut TcpStream) {
        match self.app.state::<App>().ask(bench::Cmd::CameraAudioStop) {
            Ok(()) => respond(stream, "200 OK", "application/json", b"null"),
            Err(e) => respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
        }
    }

    pub(super) fn camera_output(&self, stream: &mut TcpStream) {
        let start = std::time::Instant::now();
        let picture = self.app.state::<App>().ask(bench::Cmd::CameraSnapshot).ok().flatten();
        match picture {
            Some(((w, h, rgba), sequence)) if w > 0 && h > 0 => {
                let head = output_header(w, h, rgba.len(), start.elapsed().as_secs_f64() * 1000.0, sequence);
                let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&rgba));
            }
            _ => respond(stream, "204 No Content", "application/octet-stream", b""),
        }
    }

    pub(super) fn camera_frame(&self, stream: &mut TcpStream, request: &Request) {
        let (w, h, mix) = match dimensions(request) {
            Ok(v) => v,
            Err(e) => return respond(stream, "400 Bad Request", "text/plain", e.as_bytes()),
        };
        // Acknowledged after upload: a cooperating client has at most one frame
        // in flight, and cannot queue an unbounded backlog of camera images.
        match self.app.state::<App>().ask(|reply| bench::Cmd::CameraFrame(w, h, request.body.clone(), mix, reply)).and_then(|r| r) {
            Ok(()) => respond(stream, "200 OK", "application/json", b"null"),
            Err(e) => respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
        }
    }

    pub(super) fn camera_settings(&self, stream: &mut TcpStream, body: &[u8]) {
        let settings: Settings = match serde_json::from_slice(body) {
            Ok(s) => s,
            Err(e) => return respond(stream, "400 Bad Request", "text/plain", e.to_string().as_bytes()),
        };
        if !settings.speed.is_finite()
            || !(0.1..=3.0).contains(&settings.speed)
            || !settings.persistence.is_finite()
            || !(0.0..=0.98).contains(&settings.persistence)
            || settings.preset.is_some_and(|p| p >= PRESETS.len())
        {
            return respond(stream, "400 Bad Request", "text/plain", b"invalid camera settings");
        }
        let app = self.app.state::<App>();
        let id = settings.preset_id.or_else(|| settings.preset.map(|i| format!("camera:{i}")));
        if let Some(id) = id {
            let source = match preset_source(&id, &crate::catalog::cached_rows(&self.app)) {
                Ok(source) => source,
                Err(e) => return respond(stream, "400 Bad Request", "text/plain", e.as_bytes()),
            };
            let preset = engine::preset::parse(&source);
            match app.ask(|reply| bench::Cmd::Load(Box::new(preset), 1, None, reply)).and_then(|r| r) {
                Ok(loaded) if loaded.fell_back.is_empty() => (),
                Ok(_) => return respond(stream, "422 Unprocessable Content", "text/plain", b"preset shader fell back"),
                Err(e) => return respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
            }
        }
        app.send(bench::Cmd::CameraSettings(settings.speed, settings.persistence));
        if let Some(resolution) = settings.resolution {
            let (w, h) = resolution.size();
            app.send(bench::Cmd::CameraResize(w, h));
        }
        respond(stream, "200 OK", "application/json", b"null");
    }

    pub(super) fn camera_stop(&self, stream: &mut TcpStream) {
        self.camera_video.stop();
        match self.app.state::<App>().ask(bench::Cmd::CameraStop) {
            Ok(()) => respond(stream, "200 OK", "application/json", b"null"),
            Err(e) => respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pcm_rejects_malformed_audio_and_clamps_gain() {
        let mut request =
            Request { method: "POST".into(), path: "".into(), query: vec![("rate".into(), "48000".into()), ("gain".into(), "4".into())], headers: vec![], body: 0.5f32.to_le_bytes().repeat(1024) };
        let (samples, rate) = audio_samples(&request).unwrap();
        assert_eq!(rate, 48000.0);
        assert_eq!(samples, vec![1.0; 1024]);
        request.body[..4].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(audio_samples(&request).is_err());
        request.body[..4].copy_from_slice(&2.0f32.to_le_bytes());
        assert!(audio_samples(&request).is_err());
        request.body[..4].copy_from_slice(&0.0f32.to_le_bytes());
        request.query[0].1 = "NaN".into();
        assert!(audio_samples(&request).is_err());
        request.query[0].1 = "48000".into();
        request.body.pop();
        assert!(audio_samples(&request).is_err());
    }
    #[test]
    fn settings_sizes_and_preset_ids_are_bounded() {
        assert_eq!(Resolution::Low.size(), (640, 360));
        assert_eq!(Resolution::Hd.size(), (1280, 720));
        assert_eq!(Resolution::FullHd.size(), (1920, 1080));
        assert!(serde_json::from_str::<Settings>(r#"{"speed":1,"persistence":0.5,"resolution":"4k"}"#).is_err());
        assert!(serde_json::from_str::<Settings>(r#"{"speed":1,"persistence":0.5,"preset":1}"#).is_ok());
        assert!(preset_source("camera:0", &[]).unwrap().contains("min(bass,2)"));
        assert!(preset_source("camera:3", &[]).is_err());
        assert!(preset_source("/etc/passwd", &[]).is_err());
        assert!(preset_source("../../secret.milk", &[]).is_err());
    }
    #[test]
    fn raw_output_describes_the_packed_frame_and_readback_cost() {
        let head = output_header(640, 360, 640 * 360 * 4, 2.125, 42);
        for field in [
            "Content-Type: application/octet-stream",
            "Content-Length: 921600",
            "X-Frame-Width: 640",
            "X-Frame-Height: 360",
            "X-Frame-Sequence: 42",
            "X-Snapshot-Ms: 2.125",
            "Server-Timing: snapshot;dur=2.125",
            "Cache-Control: no-store",
        ] {
            assert!(head.contains(field), "{field}");
        }
        assert!(head.ends_with("\r\n\r\n"));
    }

    #[test]
    fn camera_frames_are_bounded_and_exact() {
        let mut r =
            Request { method: "POST".into(), path: "".into(), query: vec![("w".into(), "2".into()), ("h".into(), "1".into()), ("mix".into(), "0.5".into())], headers: vec![], body: vec![0; 8] };
        assert_eq!(dimensions(&r), Ok((2, 1, 0.5)));
        r.body.pop();
        assert!(dimensions(&r).is_err());
        r.body.push(0);
        r.query[2].1 = "NaN".into();
        assert!(dimensions(&r).is_err());
        r.query[2].1 = "1".into();
        r.query[0].1 = "4294967295".into();
        assert!(dimensions(&r).is_err());
    }
}
