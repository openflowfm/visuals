//! visual[flow]: the editor in a webview, the bench drawn natively under it.

mod bench;
mod listen;

use engine::preset::Preset;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

struct App {
    bench: Mutex<Option<bench::Thread>>,
    ring: listen::Ring,
    listening: Mutex<Option<listen::Listening>>,
    library: PathBuf,
    /// The open preset's seed, kept so an edit reruns it with the same randomness.
    seed: AtomicU64,
}

#[derive(Serialize)]
struct Entry {
    path: String,
    name: String,
    /// The folders between the library and the file.
    group: String,
}

/// Where a preset stopped compiling, by the stage the editor shows it in.
#[derive(Serialize)]
struct Problem {
    stage: String,
    message: String,
    /// 1-based, within that stage's code.
    line: Option<usize>,
}

#[derive(Serialize, Default)]
struct Report {
    /// Equations that would not compile. The bench keeps drawing the last preset.
    equations: Vec<Problem>,
    /// Shaders that would not compile and draw MilkDrop's default instead.
    shaders: Vec<Problem>,
}

#[derive(Serialize)]
struct Opened {
    preset: Preset,
    report: Report,
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("milk")) {
            out.push(path);
        }
    }
}

#[tauri::command]
fn presets(app: State<App>) -> Vec<Entry> {
    let mut files = Vec::new();
    walk(&app.library, &mut files);
    files.sort();
    files
        .into_iter()
        .map(|p| Entry {
            name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            group: p.parent().and_then(|d| d.strip_prefix(&app.library).ok()).map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
            path: p.to_string_lossy().into_owned(),
        })
        .collect()
}

/// Which stage's equations fail, compiled one at a time.
fn equation_problems(p: &Preset) -> Vec<Problem> {
    let mut stages: Vec<(String, &str)> = vec![("init".into(), &p.init), ("frame".into(), &p.frame), ("vertex".into(), &p.vertex)];
    for (i, w) in p.waves.iter().enumerate() {
        stages.extend([(format!("wave{i}.init"), w.init.as_str()), (format!("wave{i}.frame"), &w.frame), (format!("wave{i}.point"), &w.point)]);
    }
    for (i, s) in p.shapes.iter().enumerate() {
        stages.extend([(format!("shape{i}.init"), s.init.as_str()), (format!("shape{i}.frame"), &s.frame)]);
    }
    stages
        .into_iter()
        .filter_map(|(stage, code)| {
            let e = engine::eel::compile(code, &mut Default::default()).err()?;
            let line = code.get(..e.at.min(code.len())).map(|s| s.lines().count().max(1));
            Some(Problem { stage, message: e.message, line })
        })
        .collect()
}

fn load(app: &App, preset: Preset) -> Result<Report, String> {
    let commands = app.bench.lock().unwrap().as_ref().ok_or("the bench has not started")?.commands.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let seed = app.seed.load(Ordering::Relaxed);
    let problems = equation_problems(&preset);
    commands.send(bench::Cmd::Load(Box::new(preset), seed, tx)).map_err(|e| e.to_string())?;
    match rx.recv().map_err(|e| e.to_string())? {
        Ok(loaded) => Ok(Report {
            equations: Vec::new(),
            shaders: loaded
                .fell_back
                .into_iter()
                .map(|(kind, message)| Problem { stage: format!("{kind:?}").to_lowercase(), line: None, message })
                .collect(),
        }),
        Err(message) => Ok(Report {
            equations: if problems.is_empty() { vec![Problem { stage: "equations".into(), message, line: None }] } else { problems },
            shaders: Vec::new(),
        }),
    }
}

#[tauri::command]
async fn open(path: String, app: State<'_, App>) -> Result<Opened, String> {
    let text = engine::preset::decode(&std::fs::read(&path).map_err(|e| e.to_string())?);
    let preset = engine::preset::parse(&text);
    app.seed.store(std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1), Ordering::Relaxed);
    let report = load(&app, preset.clone())?;
    Ok(Opened { preset, report })
}

#[tauri::command]
async fn apply(preset: Preset, app: State<'_, App>) -> Result<Report, String> {
    load(&app, preset)
}

/// The page's hole for the bench, in CSS pixels from the window's top left.
#[tauri::command]
fn place_bench(x: f64, y: f64, width: f64, height: f64, handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let inner = handle.clone();
        handle
            .run_on_main_thread(move || {
                if let Some((w, h)) = bench::view::place(x, y, width, height) {
                    if let Some(b) = inner.state::<App>().bench.lock().unwrap().as_ref() {
                        let _ = b.commands.send(bench::Cmd::Resize(w, h));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn inputs() -> Vec<listen::Input> {
    listen::inputs()
}

/// Listen to `name` (the system input when absent), channels `left` and `right`
/// counted from 1. Returns the input's name.
#[tauri::command]
fn listen_to(name: Option<String>, left: Option<usize>, right: Option<usize>, app: State<App>) -> Result<String, String> {
    let channels = (left.unwrap_or(1).max(1) - 1, right.unwrap_or(2).max(1) - 1);
    let mut listening = app.listening.lock().unwrap();
    *listening = None;
    let l = listen::listen(name.as_deref(), channels, app.ring.clone())?;
    if let Some(b) = app.bench.lock().unwrap().as_ref() {
        let _ = b.commands.send(bench::Cmd::SampleRate(l.rate));
    }
    let name = l.name.clone();
    *listening = Some(l);
    Ok(name)
}

/// Change one value of the running preset. Returns false when it needs a reload
/// (a wave or shape turned on or off); the page applies the whole preset then.
#[tauri::command]
async fn set_value(owner: engine::runtime::Owner, key: String, value: f64, app: State<'_, App>) -> Result<bool, String> {
    let commands = app.bench.lock().unwrap().as_ref().ok_or("the bench has not started")?.commands.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    commands.send(bench::Cmd::Set(owner, key, value, tx)).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_previews(on: bool, app: State<App>) {
    if let Some(b) = app.bench.lock().unwrap().as_ref() {
        let _ = b.commands.send(bench::Cmd::Previews(on));
    }
}

/// The latest stage pictures as raw bytes: `engine::render::PREVIEWS` in order,
/// each `PREVIEW` sized RGBA. Empty until there are some.
#[tauri::command]
fn previews(app: State<App>) -> tauri::ipc::Response {
    let bytes = app.bench.lock().unwrap().as_ref().and_then(|b| b.previews.lock().unwrap().clone()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

#[tauri::command]
fn stats(app: State<App>) -> bench::Stats {
    app.bench.lock().unwrap().as_ref().map(|b| *b.stats.lock().unwrap()).unwrap_or_default()
}

fn main() {
    let library = std::env::var_os("OPENFLOW_VISUALS_PRESETS")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets"));
    tauri::Builder::default()
        .manage(App { bench: Mutex::new(None), ring: listen::ring(), listening: Mutex::new(None), library, seed: AtomicU64::new(1) })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").expect("main window");
                let instance = wgpu::Instance::default();
                let surface = unsafe { bench::view::create(window.ns_window()?, &instance) };
                let state = app.state::<App>();
                let thread = bench::start(instance, surface, (1, 1), state.ring.clone());
                *state.bench.lock().unwrap() = Some(thread);
                // Development: write what the window shows to a PNG, after a pause.
                if let Some(path) = std::env::var_os("VISUALS_CAPTURE").map(PathBuf::from) {
                    let after = std::env::var("VISUALS_CAPTURE_AFTER").ok().and_then(|s| s.parse().ok()).unwrap_or(8.0);
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs_f64(after));
                        let _ = handle.run_on_main_thread(move || match bench::view::capture(&path) {
                            Ok(()) => eprintln!("captured the window to {}", path.display()),
                            Err(e) => eprintln!("capture failed: {e}"),
                        });
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![presets, open, apply, set_value, set_previews, previews, place_bench, inputs, listen_to, stats])
        .run(tauri::generate_context!())
        .expect("visual[flow]");
}
