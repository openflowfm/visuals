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
    presets_in(&crate::pack::folders(&handle))
}

/// Every preset in `folders`, once each: a preset at a relative path an earlier
/// folder already has (a starter preset already downloaded) is left out.
fn presets_in(folders: &[std::path::PathBuf]) -> Vec<Entry> {
    crate::pack::milk_files_in(folders)
        .into_iter()
        .map(|p| {
            let folder = folders.iter().find(|f| p.starts_with(f));
            Entry {
                name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                group: p.parent().and_then(|d| d.strip_prefix(folder?).ok()).map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                path: p.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_downloaded_starter_preset_is_listed_once() {
        let root = std::env::temp_dir().join(format!("visuals-library-{}", std::process::id()));
        let (presets, starter) = (root.join("presets"), root.join("starter"));
        for (dir, rel) in [(&presets, "Geiss/a.milk"), (&starter, "Geiss/a.milk"), (&starter, "Geiss/b.milk")] {
            std::fs::create_dir_all(dir.join(rel).parent().unwrap()).unwrap();
            std::fs::write(dir.join(rel), "[preset00]\n").unwrap();
        }
        let mut listed: Vec<_> = presets_in(&[presets.clone(), starter.clone()]).into_iter().map(|e| (e.path, e.group)).collect();
        listed.sort();
        let _ = std::fs::remove_dir_all(&root);
        let at = |d: &std::path::PathBuf, r: &str| d.join(r).to_string_lossy().into_owned();
        assert_eq!(listed, vec![(at(&presets, "Geiss/a.milk"), "Geiss".into()), (at(&starter, "Geiss/b.milk"), "Geiss".into())]);
    }

    #[test]
    fn only_regular_files_of_a_preset_s_size_are_read() {
        let root = std::env::temp_dir().join(format!("visuals-read-preset-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.milk"), "[preset00]\n").unwrap();
        std::fs::write(root.join("big.milk"), vec![b'x'; MAX_PRESET as usize + 1]).unwrap();
        let fifo = root.join("fifo.milk");
        let made = std::process::Command::new("mkfifo").arg(&fifo).status().is_ok_and(|s| s.success());
        let read = |name: &str| read_preset(&root.join(name));
        assert_eq!(read("a.milk").unwrap(), b"[preset00]\n");
        assert!(read("big.milk").is_err());
        assert!(read("").is_err(), "a folder");
        assert!(read("gone.milk").is_err());
        assert!(read_preset(Path::new("/dev/zero")).is_err());
        if made {
            assert!(read("fifo.milk").is_err(), "a FIFO is refused, not waited on");
        }
        let _ = std::fs::remove_dir_all(&root);
    }
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
#[cfg_attr(not(feature = "lab"), allow(dead_code))]
pub fn load(app: &App, preset: Preset) -> Result<Report, String> {
    load_from(app, preset, None)
}

/// [`load`] the preset read from `path`, which the bench names when it draws or
/// panics (`bench::on_drawing`).
fn load_from(app: &App, preset: Preset, path: Option<&Path>) -> Result<Report, String> {
    let seed = app.seed.load(Ordering::Relaxed);
    let problems = equation_problems(&preset);
    match app.ask(|tx| bench::Cmd::Load(Box::new(preset), seed, path.map(Path::to_path_buf), tx))? {
        Ok(loaded) => {
            Ok(Report { equations: Vec::new(), shaders: loaded.fell_back.into_iter().map(|(kind, message)| Problem { stage: format!("{kind:?}").to_lowercase(), line: None, message }).collect() })
        }
        Err(message) => Ok(Report { equations: if problems.is_empty() { vec![Problem { stage: "equations".into(), message, line: None }] } else { problems }, shaders: Vec::new() }),
    }
}

/// The most a preset file may hold. A `.milk` is at most a few hundred KB; a
/// path that names anything bigger is not one.
pub const MAX_PRESET: u64 = 4 << 20;

/// Read the preset file at `path`: only a regular file (never a device such as
/// `/dev/zero`, a FIFO or a folder, which could block or never end) of at most
/// [`MAX_PRESET`] bytes.
pub fn read_preset(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let not_preset = |why: &str| format!("{} {why}", path.display());
    let meta = std::fs::metadata(path).map_err(|e| not_preset(&format!("can't be read ({e})")))?;
    if !meta.is_file() {
        return Err(not_preset("is not a file"));
    }
    if meta.len() > MAX_PRESET {
        return Err(not_preset(&format!("is too big for a preset ({} bytes)", meta.len())));
    }
    let file = std::fs::File::open(path).map_err(|e| not_preset(&format!("can't be read ({e})")))?;
    // Swapped for something else since the look above.
    if !file.metadata().is_ok_and(|m| m.is_file()) {
        return Err(not_preset("is not a file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_PRESET + 1).read_to_end(&mut bytes).map_err(|e| not_preset(&format!("can't be read ({e})")))?;
    if bytes.len() as u64 > MAX_PRESET {
        return Err(not_preset("is too big for a preset"));
    }
    Ok(bytes)
}

/// Read `path` ([`read_preset`]) and put it on the bench with a new seed.
pub fn open_path(app: &App, path: &str) -> Result<Opened, String> {
    let text = engine::preset::decode(&read_preset(Path::new(path))?);
    let preset = engine::preset::parse(&text);
    app.seed.store(std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(1), Ordering::Relaxed);
    let report = load_from(app, preset.clone(), Some(Path::new(path)))?;
    Ok(Opened { preset, report })
}

impl Opened {
    /// An empty preset that opened without a problem, for tests.
    #[cfg(test)]
    pub fn blank() -> Opened {
        Opened { preset: engine::preset::parse(""), report: Report::default() }
    }
}

/// The page opens `path` (the library's grid, the start preset, a drop, the lab):
/// the bench's answer with its report, and the preset marked failed or not as
/// the deck's opens are (`crate::resume::open_reported`).
#[tauri::command]
pub async fn open(path: String, handle: tauri::AppHandle, app: State<'_, App>, deck: State<'_, crate::actions::Deck>) -> Result<Opened, String> {
    deck.opened(Path::new(&path));
    crate::resume::open_reported(&handle, &app, Path::new(&path))
}
