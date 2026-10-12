//! Latest-only, hardware encoded camera preview. Never opens a capture device.
use super::*;
#[cfg(target_os = "macos")]
mod hardware;

pub(super) struct Frame {
    pub sequence: u64,
    pub timestamp: u64,
    pub size: (u32, u32),
    pub snapshot_ms: f64,
    pub encode_ms: f64,
    pub codec: String,
    pub bytes: Vec<u8>,
}
struct State {
    started: bool,
    enabled: bool,
    epoch: u64,
    requested: Instant,
    latest: Option<Arc<Frame>>,
    error: Option<String>,
}
pub(super) struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}
#[derive(Clone)]
pub(super) struct Video(Arc<Shared>);
impl Default for Video {
    fn default() -> Self {
        Self(Arc::new(Shared { state: Mutex::new(State { started: false, enabled: false, epoch: 0, requested: Instant::now(), latest: None, error: None }), changed: Condvar::new() }))
    }
}
impl Video {
    pub fn stop(&self) {
        let mut state = self.0.state.lock().unwrap();
        state.enabled = false;
        state.epoch += 1;
        state.latest = None;
        state.error = None;
        self.0.changed.notify_all();
    }
    fn next(&self, app: AppHandle, after: u64) -> Result<Option<Arc<Frame>>, String> {
        let mut state = self.0.state.lock().unwrap();
        state.requested = Instant::now();
        state.enabled = true;
        if !state.started {
            let shared = self.0.clone();
            std::thread::Builder::new().name("camera video".into()).spawn(move || produce(shared, app)).map_err(|e| e.to_string())?;
            state.started = true;
        }
        self.0.changed.notify_all();
        let deadline = Instant::now() + Duration::from_millis(250);
        loop {
            if let Some(error) = &state.error {
                return Err(error.clone());
            }
            if let Some(frame) = &state.latest {
                if frame.sequence > after {
                    return Ok(Some(frame.clone()));
                }
            }
            if !state.enabled || Instant::now() >= deadline {
                return Ok(None);
            }
            let (next, _) = self.0.changed.wait_timeout(state, deadline.saturating_duration_since(Instant::now())).unwrap();
            state = next;
        }
    }
}

fn produce(shared: Arc<Shared>, app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let mut encoder: Option<hardware::Encoder> = None;
        let mut last_sequence = 0;
        let clock = Instant::now();
        loop {
            let started = Instant::now();
            let mut state = shared.state.lock().unwrap();
            if !state.enabled || state.requested.elapsed() > Duration::from_secs(2) {
                state.enabled = false;
                state.latest = None;
                state.epoch += 1;
                drop(state);
                encoder = None; // Complete pending callbacks before releasing session/context.
                state = shared.state.lock().unwrap();
                while !state.enabled {
                    state = shared.changed.wait(state).unwrap();
                }
            }
            let epoch = state.epoch;
            let failed = state.error.is_some();
            drop(state);
            if !failed && encoder.as_ref().is_none_or(|e| e.pending() < 2) {
                let begin = Instant::now();
                if let Ok(Some(((w, h, rgba), sequence))) = app.state::<App>().ask(bench::Cmd::CameraSnapshot) {
                    if sequence != last_sequence {
                        let snapshot_ms = begin.elapsed().as_secs_f64() * 1000.0;
                        let size = (w, h);
                        let result = (|| {
                            if encoder.as_ref().is_none_or(|e| e.size != size || e.epoch != epoch) {
                                encoder = None;
                                let mut state = shared.state.lock().unwrap();
                                if state.epoch != epoch || !state.enabled {
                                    return Ok(());
                                }
                                state.latest = None;
                                drop(state);
                                encoder = Some(hardware::Encoder::new(size, epoch, shared.clone())?);
                            }
                            encoder.as_mut().unwrap().submit(rgba, sequence, clock.elapsed().as_micros() as u64, snapshot_ms)?;
                            last_sequence = sequence;
                            Ok::<_, String>(())
                        })();
                        if let Err(error) = result {
                            let mut state = shared.state.lock().unwrap();
                            if state.epoch == epoch {
                                state.error = Some(error);
                                shared.changed.notify_all();
                            }
                            drop(state);
                            encoder = None;
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs_f64(1.0 / 60.0).saturating_sub(started.elapsed()));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let mut state = shared.state.lock().unwrap();
        state.error = Some("hardware camera encoding is available on macOS only".into());
        shared.changed.notify_all();
    }
}

impl Bridge {
    pub(super) fn camera_video(&self, stream: &mut TcpStream, request: &Request) {
        let after = match request.param("after").unwrap_or("0").parse::<u64>() {
            Ok(v) => v,
            Err(_) => return respond(stream, "400 Bad Request", "text/plain", b"after must be a frame sequence"),
        };
        match self.camera_video.next(self.app.clone(), after) {
            Ok(Some(frame)) => {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: video/h264\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Bridge: 1\r\nX-Frame-Sequence: {}\r\nX-Frame-Timestamp: {}\r\nX-Frame-Width: {}\r\nX-Frame-Height: {}\r\nX-Video-Codec: {}\r\nX-Snapshot-Ms: {:.3}\r\nX-Encode-Ms: {:.3}\r\nConnection: close\r\n\r\n",
                    frame.bytes.len(),
                    frame.sequence,
                    frame.timestamp,
                    frame.size.0,
                    frame.size.1,
                    frame.codec,
                    frame.snapshot_ms,
                    frame.encode_ms
                );
                let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&frame.bytes));
            }
            Ok(None) => respond(stream, "204 No Content", "video/h264", b""),
            Err(error) => respond(stream, "503 Service Unavailable", "text/plain", error.as_bytes()),
        }
    }
}
