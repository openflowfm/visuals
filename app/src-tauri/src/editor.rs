//! The editor page's commands: the preset library, opening and applying a
//! preset on the bench with what failed to compile, single values, the stage
//! previews and the bench's place in the window.

use crate::{bench, App};
use engine::preset::Preset;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::State;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Serialize)]
pub struct Entry {
    path: String,
    name: String,
    /// The folders between the library and the file.
    group: String,
}

/// Where a preset stopped compiling, by the stage the editor shows it in.
#[derive(Serialize, Clone)]
pub struct Problem {
    stage: String,
    message: String,
    /// 1-based, within that stage's code.
    line: Option<usize>,
}

#[derive(Serialize, Default, Clone)]
pub struct Report {
    /// Equations that would not compile. The bench keeps drawing the last preset.
    equations: Vec<Problem>,
    /// Shaders that would not compile and draw MilkDrop's default instead.
    shaders: Vec<Problem>,
}

#[derive(Serialize, Clone)]
pub struct Opened {
    preset: Preset,
    report: Report,
}

#[tauri::command]
pub fn presets(app: State<App>) -> Vec<Entry> {
    engine::preset::milk_files(&app.library)
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
    let seed = app.seed.load(Ordering::Relaxed);
    let problems = equation_problems(&preset);
    match app.ask(|tx| bench::Cmd::Load(Box::new(preset), seed, tx))? {
        Ok(loaded) => {
            Ok(Report { equations: Vec::new(), shaders: loaded.fell_back.into_iter().map(|(kind, message)| Problem { stage: format!("{kind:?}").to_lowercase(), line: None, message }).collect() })
        }
        Err(message) => Ok(Report { equations: if problems.is_empty() { vec![Problem { stage: "equations".into(), message, line: None }] } else { problems }, shaders: Vec::new() }),
    }
}

/// Read `path` and put it on the bench with a new seed.
pub fn open_path(app: &App, path: &str) -> Result<Opened, String> {
    let text = engine::preset::decode(&std::fs::read(path).map_err(|e| e.to_string())?);
    let preset = engine::preset::parse(&text);
    app.seed.store(std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1), Ordering::Relaxed);
    let report = load(app, preset.clone())?;
    Ok(Opened { preset, report })
}

#[tauri::command]
pub async fn open(path: String, app: State<'_, App>, deck: State<'_, crate::actions::Deck>) -> Result<Opened, String> {
    deck.opened(Path::new(&path));
    open_path(&app, &path)
}

#[tauri::command]
pub async fn apply(preset: Preset, app: State<'_, App>) -> Result<Report, String> {
    load(&app, preset)
}

/// The page's hole for the bench, in CSS pixels from the window's top left.
#[tauri::command]
pub fn place_bench(x: f64, y: f64, width: f64, height: f64, handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let inner = handle.clone();
        handle
            .run_on_main_thread(move || {
                if let Some((w, h)) = bench::view::place(x, y, width, height) {
                    inner.state::<App>().send(bench::Cmd::Resize(w, h));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Change one value of the running preset. Returns false when it needs a reload
/// (a wave or shape turned on or off); the page applies the whole preset then.
#[tauri::command]
pub async fn set_value(owner: engine::runtime::Owner, key: String, value: f64, app: State<'_, App>) -> Result<bool, String> {
    app.ask(|tx| bench::Cmd::Set(owner, key, value, tx))
}

#[tauri::command]
pub fn set_previews(on: bool, app: State<App>) {
    app.send(bench::Cmd::Previews(on));
}

/// The latest stage pictures as raw bytes: `engine::render::PREVIEWS` in order,
/// each `PREVIEW` sized RGBA. Empty until there are some.
#[tauri::command]
pub fn previews(app: State<App>) -> tauri::ipc::Response {
    let bytes = app.bench.lock().unwrap().as_ref().and_then(|b| b.previews.lock().unwrap().clone()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

/// MilkDrop's default `warp` or `comp` shader as code for `preset`, its values
/// written in as numbers (`engine::shader::written_default`).
#[tauri::command]
pub fn default_shader(preset: Preset, which: engine::shader::Kind) -> String {
    engine::shader::written_default(which, &preset)
}

#[tauri::command]
pub fn stats(app: State<App>) -> bench::Stats {
    app.bench.lock().unwrap().as_ref().map(|b| *b.stats.lock().unwrap()).unwrap_or_default()
}
