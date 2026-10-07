//! visual[flow]: the editor in a webview, the bench drawn natively under it, and
//! in live mode the output full screen on a display of its own.

mod actions;
mod bench;
mod compare;
mod fx;
mod listen;
mod playlists;
mod output;

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
#[derive(Serialize, Clone)]
struct Problem {
    stage: String,
    message: String,
    /// 1-based, within that stage's code.
    line: Option<usize>,
}

#[derive(Serialize, Default, Clone)]
struct Report {
    /// Equations that would not compile. The bench keeps drawing the last preset.
    equations: Vec<Problem>,
    /// Shaders that would not compile and draw MilkDrop's default instead.
    shaders: Vec<Problem>,
}

#[derive(Serialize, Clone)]
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

/// Read `path` and put it on the bench with a new seed.
fn open_path(app: &App, path: &str) -> Result<Opened, String> {
    let text = engine::preset::decode(&std::fs::read(path).map_err(|e| e.to_string())?);
    let preset = engine::preset::parse(&text);
    app.seed.store(std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1), Ordering::Relaxed);
    let report = load(app, preset.clone())?;
    Ok(Opened { preset, report })
}

#[tauri::command]
async fn open(path: String, app: State<'_, App>, deck: State<'_, actions::Deck>) -> Result<Opened, String> {
    deck.opened(Path::new(&path));
    open_path(&app, &path)
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
fn listen_to(name: Option<String>, size: Option<usize>, left: Option<usize>, right: Option<usize>, app: State<App>) -> Result<String, String> {
    let l = listen_on(&app, name.as_deref(), size, left, right)?;
    listen::save(&l);
    Ok(l.name)
}

/// Open an input and make it what the bench hears. Channels count from 1. The
/// new input opens before the old one closes, so a switch that fails leaves the
/// bench hearing what it heard.
fn listen_on(app: &App, name: Option<&str>, size: Option<usize>, left: Option<usize>, right: Option<usize>) -> Result<listen::Choice, String> {
    let channels = (left.unwrap_or(1).max(1) - 1, right.unwrap_or(2).max(1) - 1);
    let mut listening = app.listening.lock().unwrap();
    let l = listen::listen(name, size, channels, app.ring.clone())?;
    if let Some(b) = app.bench.lock().unwrap().as_ref() {
        let _ = b.commands.send(bench::Cmd::SampleRate(l.rate));
    }
    let choice = l.choice();
    eprintln!("listening to {} on channels {} and {} of {}, at {} Hz", choice.name, choice.left, choice.right, l.channels, l.rate);
    *listening = Some(l);
    Ok(choice)
}

#[derive(Serialize)]
struct Heard {
    /// The input and the two channels heard, from 1; absent when nothing is open.
    choice: Option<listen::Choice>,
    /// How many channels the input has.
    channels: usize,
}

/// What the bench is listening to.
#[tauri::command]
fn listening(app: State<App>) -> Heard {
    let l = app.listening.lock().unwrap();
    Heard { choice: l.as_ref().map(|l| l.choice()), channels: l.as_ref().map_or(0, |l| l.channels) }
}

/// The loudest sample in the left and right channels' latest windows, for a meter.
#[tauri::command]
fn levels(app: State<App>) -> (f32, f32) {
    listen::peaks(&app.ring)
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
    let deck = actions::Deck::new(playlists::Store::open(playlists::default_file(), library.clone()));
    tauri::Builder::default()
        .manage(App { bench: Mutex::new(None), ring: listen::ring(), listening: Mutex::new(None), library, seed: AtomicU64::new(1) })
        .manage(deck)
        .setup(|app| {
            actions::start_auto(app.handle().clone());
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").expect("main window");
                let instance = wgpu::Instance::default();
                let surface = unsafe { bench::view::create(window.ns_window()?, &instance) };
                let state = app.state::<App>();
                output::init(app.handle().clone(), instance.clone());
                let effects = app.state::<actions::Deck>().fx.clone();
                // Development: `VISUALS_FX='[{"kind": "mirror", "mode": "quad"}, …]'` sends
                // those live actions once the page is up (after `VISUALS_FX_AFTER` seconds, 5
                // by default), for checking effects in a capture.
                if let Some(text) = std::env::var_os("VISUALS_FX") {
                    match serde_json::from_str::<Vec<actions::Action>>(&text.to_string_lossy()) {
                        Ok(list) => {
                            let after = std::env::var("VISUALS_FX_AFTER").ok().and_then(|s| s.parse().ok()).unwrap_or(5.0);
                            let handle = app.handle().clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_secs_f64(after));
                                for action in list {
                                    if let Err(e) = actions::dispatch(&handle, action) {
                                        eprintln!("VISUALS_FX: {e}");
                                    }
                                }
                                eprintln!("VISUALS_FX: sent");
                            });
                        }
                        Err(e) => eprintln!("VISUALS_FX: {e}"),
                    }
                }
                let thread = bench::start(instance, surface, (1, 1), state.ring.clone(), effects);
                *state.bench.lock().unwrap() = Some(thread);
                // Come back listening to what was chosen last; the system input
                // when that is gone or nothing was chosen.
                let saved = listen::saved();
                let heard = saved
                    .as_ref()
                    .and_then(|c| listen_on(&state, Some(&c.name), Some(c.size), Some(c.left), Some(c.right)).ok())
                    .map(Ok)
                    .unwrap_or_else(|| listen_on(&state, None, None, None, None));
                if let Err(e) = heard {
                    eprintln!("no audio input: {e}");
                }
                // Development: write what the window (and the live output) show to PNGs, after a pause.
                let window = std::env::var_os("VISUALS_CAPTURE").map(PathBuf::from);
                let output = std::env::var_os("VISUALS_CAPTURE_OUTPUT").map(PathBuf::from);
                if window.is_some() || output.is_some() {
                    let after = std::env::var("VISUALS_CAPTURE_AFTER").ok().and_then(|s| s.parse().ok()).unwrap_or(8.0);
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs_f64(after));
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
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            presets,
            open,
            apply,
            set_value,
            set_previews,
            previews,
            place_bench,
            inputs,
            listen_to,
            listening,
            levels,
            stats,
            actions::act,
            actions::fx_state,
            actions::playlists,
            actions::playlist_create,
            actions::playlist_rename,
            actions::playlist_delete,
            actions::playlist_add,
            actions::playlist_remove,
            actions::playlist_move_item,
            actions::playlist_move,
            compare::compare_presets,
            compare::compare_approvals,
            compare::compare_judge,
            compare::compare_open,
            compare::compare_audio,
            compare::compare_source,
            compare::compare_cached,
            compare::compare_cache,
            compare::compare_start,
            output::live_start,
            output::displays,
            output::output_open,
            output::output_close,
            output::output_status,
        ])
        .run(tauri::generate_context!())
        .expect("visual[flow]");
}
