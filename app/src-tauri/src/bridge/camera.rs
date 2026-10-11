//! Experimental local camera transport, compiled only with dev-bridge.
use super::*;

#[derive(serde::Deserialize)]
struct Settings {
    preset: Option<usize>,
    speed: f64,
    persistence: f32,
}

const PRESETS: [&str; 3] = [
    include_str!("../../presets/starter/cream-of-the-crop/Reaction/Liquid Gradient/Rovastar - Harlequin's Liquid Dragon.milk"),
    include_str!("../../presets/starter/cream-of-the-crop/Reaction/Liquid Gradient/Krash and Fvese - Molten Indecision (Fvese Remix).milk"),
    include_str!("../../presets/starter/cream-of-the-crop/Drawing/Liquid/Pithlit - Psychotrip (Spinning colours mix) - orthorotate recursive helicities3.milk"),
];

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
        if let Some(index) = settings.preset {
            let preset = engine::preset::parse(PRESETS[index]);
            match app.ask(|reply| bench::Cmd::Load(Box::new(preset), 1, None, reply)).and_then(|r| r) {
                Ok(loaded) if loaded.fell_back.is_empty() => (),
                Ok(_) => return respond(stream, "422 Unprocessable Content", "text/plain", b"preset shader fell back"),
                Err(e) => return respond(stream, "503 Service Unavailable", "text/plain", e.as_bytes()),
            }
        }
        app.send(bench::Cmd::CameraSettings(settings.speed, settings.persistence));
        // Fixed bounded readback, independent of browser layout and display scale.
        app.send(bench::Cmd::Resize(960, 540));
        respond(stream, "200 OK", "application/json", b"null");
    }

    pub(super) fn camera_stop(&self, stream: &mut TcpStream) {
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
