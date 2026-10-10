//! The dev bridge (`npm run dev`, the `dev-bridge` feature, never in a release):
//! the page in a normal browser, talking to this app running headless.
//!
//! A small HTTP server on 127.0.0.1 (`VISUALS_BRIDGE=127.0.0.1:<port>`; vite
//! proxies `/__bridge` to it, so the page sees it on its own origin). Every
//! request carries `VISUALS_BRIDGE_TOKEN` (the `x-bridge-token` header, or
//! `token=` where the browser can't set a header). It answers:
//!
//! - `POST /__bridge/invoke` `{cmd, args}`: the command, dispatched through
//!   Tauri's own IPC entry ([`tauri::WebviewWindow::on_message`]) as if the
//!   main window's page had sent it, so it reaches exactly the handlers
//!   `main.rs` lists, with their state and ACL, and no list here can drift.
//!   200 with the answer (JSON, or bytes for a raw one), or with the error as
//!   [`ERROR_TYPE`] (the command rejected).
//! - `POST /__bridge/listen` `{event}`: relay that event from now on.
//! - `GET /__bridge/events`: the relayed events, as server-sent events
//!   (`{"event": name, "payload": …}`).
//! - `GET /__bridge/frame`: the bench's latest picture, as WebP; 204 before it draws.
//! - `GET /__bridge/thumb/…`: a library thumbnail (`thumb://localhost/…` in the app).
//!
//! The main window's own page is put away (`about:blank`) so only the browser's
//! page drives the app.

use crate::{bench, catalog, App};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Listener, Manager};

/// Where the page's requests appear to come from: the app's own origin, so they count as local.
const ORIGIN: &str = "tauri://localhost/";
/// How long a command may take before the page is told it failed.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
/// Quality of the streamed frames (WebP, 0–100).
const FRAME_QUALITY: f32 = 70.0;
/// The content type of a command's error (`app/src/dev/bridge.ts` reads it).
const ERROR_TYPE: &str = "application/x-bridge-error+json";

/// Start the bridge when `VISUALS_BRIDGE` names a loopback address; otherwise the app runs as usual.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let Ok(addr) = std::env::var("VISUALS_BRIDGE") else { return Ok(()) };
    let addr: SocketAddr = addr.parse().map_err(|e| format!("VISUALS_BRIDGE={addr}: {e}"))?;
    if !addr.ip().is_loopback() {
        return Err(format!("VISUALS_BRIDGE={addr}: the bridge only listens on 127.0.0.1"));
    }
    let token = std::env::var("VISUALS_BRIDGE_TOKEN").ok().filter(|t| t.len() >= 16).unwrap_or_else(fresh_token);
    let listener = TcpListener::bind(addr).map_err(|e| format!("the bridge couldn't listen on {addr}: {e}"))?;
    if let Some(window) = app.get_webview_window("main") {
        // The browser's page is the page now: the window's own would drive the app too.
        let _ = window.navigate("about:blank".parse().expect("a URL"));
    }
    eprintln!("visual[flow] dev bridge on http://{addr} (token {token})");
    let bridge = Arc::new(Bridge { app: app.clone(), token, clients: Mutex::new(Vec::new()), relayed: Mutex::new(HashSet::new()) });
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let bridge = bridge.clone();
            std::thread::spawn(move || bridge.serve(stream));
        }
    });
    Ok(())
}

/// 128 random bits in hex, from the system's generator.
fn fresh_token() -> String {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct Bridge {
    app: AppHandle,
    token: String,
    /// The pages following events: each gets every relayed event as one JSON line.
    clients: Mutex<Vec<Sender<String>>>,
    /// The events relayed so far.
    relayed: Mutex<HashSet<String>>,
}

/// A request as the bridge reads it.
#[derive(Debug, PartialEq)]
struct Request {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    fn param(&self, name: &str) -> Option<&str> {
        self.query.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    /// The token it carries, in its header or its query.
    fn token(&self) -> Option<&str> {
        self.header("x-bridge-token").or_else(|| self.param("token"))
    }
}

/// Read one HTTP/1.1 request: its line, headers and a `Content-Length` body.
fn read_request(reader: &mut impl BufRead) -> Option<Request> {
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query = query.split('&').filter(|p| !p.is_empty()).map(|p| p.split_once('=').unwrap_or((p, ""))).map(|(k, v)| (decode(k), decode(v))).collect();
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 {
            return None;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        let (k, v) = h.split_once(':')?;
        headers.push((k.trim().to_string(), v.trim().to_string()));
    }
    let mut request = Request { method, path: path.to_string(), query, headers, body: Vec::new() };
    let length: usize = request.header("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
    request.body = vec![0; length];
    reader.read_exact(&mut request.body).ok()?;
    Some(request)
}

/// Percent-decoding, `+` as a space.
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let escaped = (b[i] == b'%').then(|| s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())).flatten();
        match b[i] {
            _ if escaped.is_some() => {
                out.push(escaped.unwrap());
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8]) {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body));
}

impl Bridge {
    fn serve(self: Arc<Self>, mut stream: TcpStream) {
        let Ok(read) = stream.try_clone() else { return };
        let Some(request) = read_request(&mut BufReader::new(read)) else { return };
        if request.token() != Some(self.token.as_str()) {
            return respond(&mut stream, "403 Forbidden", "text/plain", b"the dev bridge wants its token");
        }
        match (request.method.as_str(), request.path.as_str()) {
            ("POST", "/__bridge/invoke") => self.invoke(&mut stream, &request.body),
            ("POST", "/__bridge/listen") => self.listen(&mut stream, &request.body),
            ("GET", "/__bridge/events") => self.events(stream),
            ("GET", "/__bridge/frame") => self.frame(&mut stream),
            ("GET", path) if path.starts_with("/__bridge/thumb/") => self.thumb(&mut stream, &path["/__bridge/thumb".len()..]),
            _ => respond(&mut stream, "404 Not Found", "text/plain", b"no such bridge route"),
        }
    }

    fn invoke(&self, stream: &mut TcpStream, body: &[u8]) {
        #[derive(serde::Deserialize)]
        struct Call {
            cmd: String,
            #[serde(default)]
            args: serde_json::Value,
        }
        let call: Call = match serde_json::from_slice(body) {
            Ok(c) => c,
            Err(e) => return respond(stream, "400 Bad Request", "text/plain", e.to_string().as_bytes()),
        };
        match self.dispatch(call.cmd, call.args) {
            Ok(InvokeResponse::Ok(InvokeResponseBody::Json(json))) => respond(stream, "200 OK", "application/json", json.as_bytes()),
            Ok(InvokeResponse::Ok(InvokeResponseBody::Raw(bytes))) => respond(stream, "200 OK", "application/octet-stream", &bytes),
            // 200 too, told apart by its type: the browser logs any other status as a failed load.
            Ok(InvokeResponse::Err(e)) => respond(stream, "200 OK", ERROR_TYPE, e.0.to_string().as_bytes()),
            Err(e) => respond(stream, "200 OK", ERROR_TYPE, serde_json::Value::String(e).to_string().as_bytes()),
        }
    }

    /// Hand `cmd` to the main window's IPC entry, on the main thread as the
    /// webview's own messages arrive, and wait for its answer.
    fn dispatch(&self, cmd: String, args: serde_json::Value) -> Result<InvokeResponse, String> {
        let window = self.app.get_webview_window("main").ok_or("the main window is gone")?;
        let args = if args.is_null() { serde_json::Value::Object(Default::default()) } else { args };
        let request = InvokeRequest {
            cmd,
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: ORIGIN.parse().expect("a URL"),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: self.app.invoke_key().to_string(),
        };
        let (tx, rx) = mpsc::channel();
        self.app
            .run_on_main_thread(move || {
                window.on_message(
                    request,
                    Box::new(move |_, _, response, _, _| {
                        let _ = tx.send(response);
                    }),
                )
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(COMMAND_TIMEOUT).map_err(|_| "the command didn't answer".to_string())
    }

    fn listen(self: &Arc<Self>, stream: &mut TcpStream, body: &[u8]) {
        #[derive(serde::Deserialize)]
        struct Listen {
            event: String,
        }
        let Ok(Listen { event }) = serde_json::from_slice(body) else { return respond(stream, "400 Bad Request", "text/plain", b"{event} expected") };
        if self.relayed.lock().unwrap().insert(event.clone()) {
            let bridge = Arc::downgrade(self);
            let name = event.clone();
            self.app.listen_any(event, move |e| {
                if let Some(bridge) = bridge.upgrade() {
                    bridge.broadcast(event_line(&name, e.payload()));
                }
            });
        }
        respond(stream, "200 OK", "application/json", b"null");
    }

    fn broadcast(&self, line: String) {
        self.clients.lock().unwrap().retain(|c| c.send(line.clone()).is_ok());
    }

    /// Server-sent events until the page goes away; a comment every 15 s finds out when it has.
    fn events(&self, mut stream: TcpStream) {
        let (tx, rx) = mpsc::channel::<String>();
        self.clients.lock().unwrap().push(tx);
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n: relaying\n\n";
        if stream.write_all(head.as_bytes()).is_err() {
            return;
        }
        loop {
            let chunk = match rx.recv_timeout(Duration::from_secs(15)) {
                Ok(line) => format!("data: {line}\n\n"),
                Err(mpsc::RecvTimeoutError::Timeout) => ": still here\n\n".to_string(),
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            };
            if stream.write_all(chunk.as_bytes()).and_then(|_| stream.flush()).is_err() {
                return;
            }
        }
    }

    fn frame(&self, stream: &mut TcpStream) {
        let picture = self.app.state::<App>().ask(|reply| bench::Cmd::Snapshot(false, reply)).ok().flatten();
        match picture {
            Some((w, h, rgba)) if w > 0 && h > 0 => {
                let webp = webp::Encoder::from_rgba(&rgba, w, h).encode(FRAME_QUALITY);
                respond(stream, "200 OK", "image/webp", &webp);
            }
            _ => respond(stream, "204 No Content", "image/webp", b""),
        }
    }

    fn thumb(&self, stream: &mut TcpStream, rest: &str) {
        let Ok(request) = tauri::http::Request::builder().uri(format!("thumb://localhost{rest}")).body(Vec::new()) else {
            return respond(stream, "400 Bad Request", "text/plain", b"not a thumbnail");
        };
        let response = catalog::serve(&self.app, &request);
        let status = response.status();
        let kind = response.headers().get("Content-Type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
        respond(stream, &format!("{} {}", status.as_u16(), status.canonical_reason().unwrap_or("")), &kind, response.body());
    }
}

/// One relayed event as the page reads it; an event without a payload has `null`.
fn event_line(event: &str, payload: &str) -> String {
    let payload = if payload.trim().is_empty() { "null" } else { payload };
    format!("{{\"event\":{},\"payload\":{payload}}}", serde_json::Value::String(event.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_request_with_its_body_and_token() {
        let raw = b"POST /__bridge/invoke?token=abc%20d HTTP/1.1\r\nHost: x\r\nX-Bridge-Token: t0k\r\nContent-Length: 13\r\n\r\n{\"cmd\":\"x\"}  extra";
        let r = read_request(&mut BufReader::new(&raw[..])).unwrap();
        assert_eq!(r.method, "POST");
        assert_eq!(r.path, "/__bridge/invoke");
        assert_eq!(r.param("token"), Some("abc d"));
        assert_eq!(r.token(), Some("t0k"), "the header wins over the query");
        assert_eq!(r.body, b"{\"cmd\":\"x\"}  ");
    }

    #[test]
    fn takes_the_token_from_the_query_without_a_header() {
        let r = read_request(&mut BufReader::new(&b"GET /__bridge/frame?token=s3cret HTTP/1.1\r\n\r\n"[..])).unwrap();
        assert_eq!(r.token(), Some("s3cret"));
        assert!(read_request(&mut BufReader::new(&b"GET /x HTTP/1.1\r\nHost: x\r\n"[..])).is_none(), "a request cut short is dropped");
    }

    #[test]
    fn writes_events_as_json_lines() {
        assert_eq!(event_line("live", "{\"a\":1}"), "{\"event\":\"live\",\"payload\":{\"a\":1}}");
        assert_eq!(event_line("output-escape", ""), "{\"event\":\"output-escape\",\"payload\":null}");
        let parsed: serde_json::Value = serde_json::from_str(&event_line("a\"b", "[1]")).unwrap();
        assert_eq!(parsed["event"], "a\"b");
    }

    #[test]
    fn fresh_tokens_are_long_and_differ() {
        let (a, b) = (fresh_token(), fresh_token());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn decodes_percent_and_plus() {
        assert_eq!(decode("a%2Fb+c"), "a/b c");
        assert_eq!(decode("100%"), "100%");
    }
}
