//! The player's preset library: the presets in every folder the app knows
//! ([`crate::pack::folders`]), and opening one on the bench with what failed to
//! compile.

use crate::{bench, App};
use engine::preset::Preset;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::State;

#[derive(Serialize)]
pub struct Entry {
    path: String,
    name: String,
    /// The folders between the preset's own folder and the file.
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

/// Every `.milk` file in the folders the app knows, the starter set and the pack.
#[tauri::command]
pub fn presets(handle: tauri::AppHandle) -> Vec<Entry> {
    crate::pack::folders(&handle)
        .into_iter()
        .flat_map(|folder| {
            engine::preset::milk_files(&folder).into_iter().map(move |p| Entry {
                name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                group: p.parent().and_then(|d| d.strip_prefix(&folder).ok()).map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                path: p.to_string_lossy().into_owned(),
            })
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

/// Put `preset` on the bench with the open preset's seed, and say what failed.
pub fn load(app: &App, preset: Preset) -> Result<Report, String> {
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
