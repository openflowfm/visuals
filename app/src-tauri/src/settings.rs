//! The small files the app keeps its choices in between runs (the audio input,
//! the output's display, the tempo, whether the first run is done, where the
//! show was), in `~/.openflow/visuals` (under `OPENFLOW_HOME`).
//!
//! Each file carries a `"version"` ([`SPECS`]): a file from before versions
//! (version 0) or an older one is moved up to the current version as it is read,
//! and written back so. A file that holds a list rather than an object (`played.json`)
//! is kept as `{"version": 1, "value": [...]}`; the code that uses these files never
//! sees the version.
//!
//! Failing to read or write one is not worth stopping the show for, but it is
//! not swallowed either: only a missing file reads as nothing kept quietly. One
//! that can't be read is left alone and reads as nothing kept; one that is
//! damaged, doesn't hold what it should, or is of a newer version is moved aside
//! (`tempo.json.bad`, `.bad.1`, …, as `crate::userlib` does) and reads as nothing
//! kept. Each of these, and a failed write, becomes a [`Problem`] in plain words
//! the page shows ([`settings_problems`], and the [`PROBLEMS`] event), as does a
//! version 1 `playlists.json` whose backup couldn't be written (`crate::playlists`).

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// `~/.openflow/visuals`, or `$OPENFLOW_HOME/visuals`.
pub fn dir() -> PathBuf {
    dir_from(std::env::var_os("OPENFLOW_HOME"), std::env::var_os("HOME"))
}

fn dir_from(openflow_home: Option<OsString>, home: Option<OsString>) -> PathBuf {
    let home = openflow_home.map(PathBuf::from).unwrap_or_else(|| PathBuf::from(home.unwrap_or_default()).join(".openflow"));
    home.join("visuals")
}

/// One settings file: its name, its current version, what it holds in plain
/// words, whether it holds a list (kept under `"value"`), and how to move it up
/// from an older version.
struct Spec {
    name: &'static str,
    version: u64,
    what: &'static str,
    wrapped: bool,
    /// Moves a file from version `from` (0: before versions) to [`Spec::version`].
    migrate: fn(from: u64, value: &mut Value),
}

/// Where the first run is marked done, in [`dir`].
const FIRST_RUN: &str = "first_run.json";

/// Every settings file this module knows. Any other name is version 1, with nothing to move up.
const SPECS: &[Spec] = &[
    Spec { name: "audio.json", version: 1, what: "audio input setting", wrapped: false, migrate: audio_from },
    Spec { name: "output.json", version: 1, what: "output display setting", wrapped: false, migrate: nothing },
    Spec { name: "tempo.json", version: 1, what: "tempo", wrapped: false, migrate: nothing },
    Spec { name: FIRST_RUN, version: 1, what: "first-run setting", wrapped: false, migrate: nothing },
    Spec { name: "played.json", version: 1, what: "recently played list", wrapped: true, migrate: nothing },
    Spec { name: "resume.json", version: 1, what: "place in the show", wrapped: false, migrate: nothing },
    Spec { name: "failed.json", version: 1, what: "list of presets that failed", wrapped: false, migrate: nothing },
];

fn spec(name: &str) -> &'static Spec {
    static OTHER: Spec = Spec { name: "", version: 1, what: "setting", wrapped: false, migrate: nothing };
    SPECS.iter().find(|s| s.name == name).unwrap_or(&OTHER)
}

fn nothing(_: u64, _: &mut Value) {}

/// `audio.json` from 0.2 named an input (`{"name", "size", "left", "right"}`);
/// version 1 names a source (`{"source": {"kind": "device", …}, "left", "right"}`).
fn audio_from(from: u64, value: &mut Value) {
    let Some(o) = value.as_object_mut().filter(|o| from < 1 && !o.contains_key("source")) else { return };
    let Some(name) = o.remove("name") else { return };
    let size = o.remove("size").unwrap_or(Value::from(0));
    o.insert("source".into(), serde_json::json!({ "kind": "device", "name": name, "size": size }));
}

/// A settings file that couldn't be read or kept, in plain words.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Problem {
    /// The file's name (`tempo.json`).
    pub file: String,
    pub message: String,
}

/// Whether a problem came from reading or writing: a good write clears only
/// a failed write, so a reset the user hasn't seen yet isn't cleared by the save that follows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Read,
    Write,
}

/// The event the whole list of [`Problem`]s goes out on when it changes.
pub const PROBLEMS: &str = "settings-problems";

static KNOWN: Mutex<BTreeMap<(String, Kind), String>> = Mutex::new(BTreeMap::new());
static HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Tell the page about problems from now on (`crate::resume::start` calls it at setup).
pub fn install(handle: &AppHandle) {
    let _ = HANDLE.set(handle.clone());
}

/// Keep `problem` as `name`'s problem of `kind`, or clear it; tell the page when that changed.
fn report(name: &str, kind: Kind, problem: Option<String>) {
    let changed = {
        let mut known = KNOWN.lock().unwrap();
        let key = (name.to_string(), kind);
        match problem {
            Some(message) => {
                eprintln!("settings: {message}");
                known.insert(key, message.clone()).as_ref() != Some(&message)
            }
            None => known.remove(&key).is_some(),
        }
    };
    if changed {
        if let Some(h) = HANDLE.get() {
            let _ = h.emit(PROBLEMS, problems());
        }
    }
}

/// Every problem this run, then the playlists' backup's.
fn problems() -> Vec<Problem> {
    let mut all: Vec<Problem> = KNOWN.lock().unwrap().iter().map(|((file, _), message)| Problem { file: file.clone(), message: message.clone() }).collect();
    all.extend(backup_problem(&crate::playlists::default_file()));
    all
}

/// The settings files that couldn't be read or kept this run, in plain words.
#[tauri::command]
pub fn settings_problems() -> Vec<Problem> {
    problems()
}

/// A `playlists.json` still at version 1 once it has been opened means its
/// backup (`playlists.json.v1`) couldn't be written, so version 2 wasn't either
/// (`crate::playlists::Store::open`).
fn backup_problem(file: &Path) -> Option<Problem> {
    let value: Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    let version = value.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version >= crate::playlists::VERSION as u64 {
        return None;
    }
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    let folder = file.parent().map(|d| d.display().to_string()).unwrap_or_default();
    Some(Problem {
        file: name.to_string(),
        message: format!("Your playlists from before couldn't be backed up as {name}.v1, so they haven't been upgraded on disk yet. They still play; check that {folder} can be written to."),
    })
}

/// The JSON kept in `name`, if it is there and reads as a `T`. See the module's docs for what happens when it isn't.
pub fn load<T: DeserializeOwned>(name: &str) -> Option<T> {
    let (value, problems) = load_at(&dir().join(name));
    report(name, Kind::Read, problems.read);
    if problems.write.is_some() {
        report(name, Kind::Write, problems.write);
    }
    value
}

/// Keep `contents` (JSON text) in `name`, versioned, making the folder if need be.
pub fn save(name: &str, contents: impl AsRef<[u8]>) {
    report(name, Kind::Write, save_at(&dir().join(name), contents.as_ref()).err());
}

/// Keep `value` in `name` as pretty JSON, versioned.
pub fn save_json(name: &str, value: &impl Serialize) {
    report(name, Kind::Write, save_json_at(&dir().join(name), value).err());
}

/// What went wrong reading a file: reading it, and writing it back moved up.
#[derive(Default, Debug)]
struct Problems {
    read: Option<String>,
    write: Option<String>,
}

fn spec_of(path: &Path) -> &'static Spec {
    spec(&path.file_name().unwrap_or_default().to_string_lossy())
}

/// Move `path` aside as damaged, and say so: `why` is how it is wrong.
fn set_aside(path: &Path, what: &str, why: &str) -> String {
    let aside = crate::userlib::aside(path);
    match std::fs::rename(path, &aside) {
        Ok(()) => format!("Your {what} {why}, so it was reset; the old file is kept as {}.", aside.file_name().unwrap_or_default().to_string_lossy()),
        Err(e) => format!("Your {what} {why}, and it couldn't be moved aside ({e}); it is ignored for now."),
    }
}

/// Read `path`: its value at the current version, and whether it was moved up from an older one.
fn read_at(path: &Path) -> Result<Option<(Value, bool)>, String> {
    let spec = spec_of(path);
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Couldn't read your {} ({e}), so it is ignored for now.", spec.what)),
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else { return Err(set_aside(path, spec.what, "was damaged")) };
    let version = match value.get("version") {
        None => 0,
        Some(v) => v.as_u64().ok_or_else(|| set_aside(path, spec.what, "was damaged"))?,
    };
    if version > spec.version {
        return Err(set_aside(path, spec.what, "was saved by a newer version of visual[flow]"));
    }
    if spec.wrapped && version > 0 {
        value = value.get_mut("value").map(Value::take).ok_or_else(|| set_aside(path, spec.what, "was damaged"))?;
    } else if let Some(o) = value.as_object_mut() {
        o.remove("version");
    }
    if version < spec.version {
        (spec.migrate)(version, &mut value);
    }
    Ok(Some((value, version < spec.version)))
}

/// [`read_at`] as a `T`; one that doesn't hold a `T` is moved aside. A file moved up
/// is written back at the current version.
fn load_at<T: DeserializeOwned>(path: &Path) -> (Option<T>, Problems) {
    let mut problems = Problems::default();
    let (value, migrated) = match read_at(path) {
        Ok(Some(read)) => read,
        Ok(None) => return (None, problems),
        Err(message) => {
            problems.read = Some(message);
            return (None, problems);
        }
    };
    match T::deserialize(&value) {
        Ok(t) => {
            if migrated {
                problems.write = save_value_at(path, value).err();
            }
            (Some(t), problems)
        }
        Err(_) => {
            problems.read = Some(set_aside(path, spec_of(path).what, "didn't hold what it should"));
            (None, problems)
        }
    }
}

/// `contents` with the file's version in: a list wrapped, an object's text given a
/// `"version"` first (its own formatting kept, as the tempo's two decimals are).
fn versioned(spec: &Spec, contents: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(contents).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(text).map_err(|e| format!("it isn't JSON ({e})"))?;
    if spec.wrapped {
        return Ok(pretty(&serde_json::json!({ "version": spec.version, "value": value }))?.into_bytes());
    }
    let Some(o) = value.as_object() else { return Ok(contents.to_vec()) };
    if o.contains_key("version") {
        return Ok(contents.to_vec());
    }
    let open = text.find('{').expect("an object starts with {");
    let rest = text[open + 1..].trim_start();
    let comma = if o.is_empty() { "" } else { ", " };
    Ok(format!("{}{{\"version\": {}{comma}{rest}", &text[..open], spec.version).into_bytes())
}

fn pretty(value: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(value).map(|t| t + "\n").map_err(|e| e.to_string())
}

/// `value` (at the current version, without its `"version"`) kept at `path`.
fn save_value_at(path: &Path, value: Value) -> Result<(), String> {
    let spec = spec_of(path);
    let text = match value {
        Value::Object(mut o) if !spec.wrapped => {
            o.insert("version".into(), Value::from(spec.version));
            pretty(&Value::Object(o))
        }
        other if spec.wrapped => pretty(&serde_json::json!({ "version": spec.version, "value": other })),
        other => pretty(&other),
    };
    write_at(path, text.map_err(|e| failed(spec, &e))?.as_bytes()).map_err(|e| failed(spec, &e))
}

fn save_json_at(path: &Path, value: &impl Serialize) -> Result<(), String> {
    save_value_at(path, serde_json::to_value(value).map_err(|e| failed(spec_of(path), &e.to_string()))?)
}

fn save_at(path: &Path, contents: &[u8]) -> Result<(), String> {
    let spec = spec_of(path);
    write_at(path, &versioned(spec, contents).map_err(|e| failed(spec, &e))?).map_err(|e| failed(spec, &e))
}

fn failed(spec: &Spec, why: &str) -> String {
    format!("Couldn't save your {} ({why}); it will be back to before next time.", spec.what)
}

/// Write `contents` to `path` through a temporary file renamed into place, so
/// a crash never leaves half of one.
fn write_at(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    let temp = path.with_file_name(name);
    std::fs::write(&temp, contents).and_then(|_| std::fs::rename(&temp, path)).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })
}

#[derive(Serialize, serde::Deserialize)]
struct FirstRun {
    done: bool,
}

/// Whether this is the first run: true until the page says it is done.
#[tauri::command]
pub fn first_run() -> bool {
    load::<FirstRun>(FIRST_RUN).is_none_or(|f| !f.done)
}

/// Mark the first run done, so the app starts straight on the show next time.
#[tauri::command]
pub fn first_run_done() {
    save_json(FIRST_RUN, &FirstRun { done: true });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, empty folder for one test.
    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("visuals-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn lives_under_openflow_home_or_home() {
        assert_eq!(dir_from(Some("/x/of".into()), Some("/home/me".into())), PathBuf::from("/x/of/visuals"));
        assert_eq!(dir_from(None, Some("/home/me".into())), PathBuf::from("/home/me/.openflow/visuals"));
    }

    #[test]
    fn saves_versioned_and_loads_making_the_folder() {
        let root = scratch("save");
        let path = root.join("deeper").join("tempo.json");
        save_at(&path, b"{\"bpm\": 99.50}\n").unwrap();
        // The tempo's own formatting is kept, with the version first.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"version\": 1, \"bpm\": 99.50}\n");
        let (v, p) = load_at::<Value>(&path);
        assert_eq!(v.unwrap()["bpm"].as_f64(), Some(99.5));
        assert!(p.read.is_none() && p.write.is_none());
        assert!(!root.join("deeper").join("tempo.json.tmp").exists());
        // Missing reads as nothing, quietly.
        let (v, p) = load_at::<Value>(&root.join("missing.json"));
        assert!(v.is_none() && p.read.is_none());
        // An empty object gets a version too.
        save_at(&root.join("output.json"), b"{}").unwrap();
        assert_eq!(read(&root.join("output.json")), serde_json::json!({ "version": 1 }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn files_from_before_versions_are_moved_up_and_written_back() {
        let root = scratch("migrate");
        for (name, before) in [("tempo.json", r#"{"bpm": 128.00}"#), ("output.json", r#"{"id": 5, "name": "Projector"}"#), (FIRST_RUN, r#"{"done": true}"#)] {
            std::fs::write(root.join(name), before).unwrap();
            let (v, p) = load_at::<Value>(&root.join(name));
            let mut expected: Value = serde_json::from_str(before).unwrap();
            assert_eq!(v.unwrap(), expected, "{name} reads as it did");
            assert!(p.read.is_none() && p.write.is_none());
            expected["version"] = 1.into();
            assert_eq!(read(&root.join(name)), expected, "{name} is kept at version 1");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn audio_from_0_2_names_its_input_as_a_source() {
        let root = scratch("audio");
        let path = root.join("audio.json");
        std::fs::write(&path, r#"{"name": "Scarlett 2i2", "size": 2, "left": 1, "right": 2}"#).unwrap();
        let (v, _) = load_at::<Value>(&path);
        let now = serde_json::json!({ "source": { "kind": "device", "name": "Scarlett 2i2", "size": 2 }, "left": 1, "right": 2 });
        assert_eq!(v.unwrap(), now);
        let mut kept = now.clone();
        kept["version"] = 1.into();
        assert_eq!(read(&path), kept);
        // Read again at version 1, it is the same.
        assert_eq!(load_at::<Value>(&path).0.unwrap(), now);
        // A file that already names a source is left as it is.
        let app = serde_json::json!({ "source": { "kind": "app", "bundle": "com.apple.Music" }, "left": 1, "right": 2 });
        std::fs::write(&path, app.to_string()).unwrap();
        assert_eq!(load_at::<Value>(&path).0.unwrap(), app);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_list_is_kept_wrapped_with_its_version() {
        let root = scratch("wrapped");
        let path = root.join("played.json");
        // Before versions: a bare list.
        std::fs::write(&path, r#"["/a.milk", "/b.milk"]"#).unwrap();
        assert_eq!(load_at::<Vec<String>>(&path).0.unwrap(), vec!["/a.milk", "/b.milk"]);
        assert_eq!(read(&path), serde_json::json!({ "version": 1, "value": ["/a.milk", "/b.milk"] }));
        save_json_at(&path, &vec!["/c.milk"]).unwrap();
        assert_eq!(read(&path), serde_json::json!({ "version": 1, "value": ["/c.milk"] }));
        assert_eq!(load_at::<Vec<String>>(&path).0.unwrap(), vec!["/c.milk"]);
        save_at(&path, br#"["/d.milk"]"#).unwrap();
        assert_eq!(load_at::<Vec<String>>(&path).0.unwrap(), vec!["/d.milk"]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn damaged_wrong_or_newer_files_are_moved_aside_and_said() {
        let root = scratch("bad");
        let path = root.join("tempo.json");
        std::fs::write(&path, "not json").unwrap();
        let (v, p) = load_at::<Value>(&path);
        assert!(v.is_none());
        assert_eq!(p.read.as_deref(), Some("Your tempo was damaged, so it was reset; the old file is kept as tempo.json.bad."));
        assert_eq!(std::fs::read_to_string(root.join("tempo.json.bad")).unwrap(), "not json");
        assert!(!path.exists());

        // Newer: moved aside, numbered so the first isn't lost.
        std::fs::write(&path, r#"{"version": 9, "bpm": 100}"#).unwrap();
        let (v, p) = load_at::<Value>(&path);
        assert!(v.is_none());
        assert!(p.read.unwrap().contains("newer version of visual[flow]"));
        assert!(root.join("tempo.json.bad.1").exists());

        // JSON, but not what the file should hold.
        let first = root.join(FIRST_RUN);
        std::fs::write(&first, r#"{"done": "yes"}"#).unwrap();
        let (v, p) = load_at::<FirstRun>(&first);
        assert!(v.is_none());
        assert!(p.read.unwrap().starts_with("Your first-run setting didn't hold what it should"));
        assert!(root.join("first_run.json.bad").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn read_and_write_failures_are_said_not_swallowed() {
        let root = scratch("fail");
        // A folder where the file should be can't be read, and is left alone.
        let path = root.join("output.json");
        std::fs::create_dir_all(&path).unwrap();
        let (v, p) = load_at::<Value>(&path);
        assert!(v.is_none());
        assert!(p.read.unwrap().starts_with("Couldn't read your output display setting ("));
        assert!(path.is_dir());
        // Nor written over.
        let e = save_json_at(&path, &serde_json::json!({ "id": 1, "name": "x" })).unwrap_err();
        assert!(e.starts_with("Couldn't save your output display setting ("), "{e}");
        // Not JSON to save.
        assert!(save_at(&root.join("tempo.json"), b"bpm=120").unwrap_err().contains("isn't JSON"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn problems_are_kept_by_file_and_kind_until_cleared() {
        let name = "test-problems.json";
        report(name, Kind::Read, Some("reset".into()));
        report(name, Kind::Write, Some("not saved".into()));
        let mine = || problems().into_iter().filter(|p| p.file == name).map(|p| p.message).collect::<Vec<_>>();
        assert_eq!(mine(), vec!["reset", "not saved"]);
        // A good save clears the failed write, not the reset the user hasn't seen.
        report(name, Kind::Write, None);
        assert_eq!(mine(), vec!["reset"]);
        report(name, Kind::Read, None);
        assert!(mine().is_empty());
    }

    #[test]
    fn a_playlists_file_left_at_version_1_says_its_backup_failed() {
        let root = scratch("backup");
        let file = root.join("playlists.json");
        assert!(backup_problem(&file).is_none(), "no file");
        std::fs::write(&file, r#"{"playlists": [{"name": "Warm up", "presets": []}]}"#).unwrap();
        let p = backup_problem(&file).unwrap();
        assert_eq!(p.file, "playlists.json");
        assert!(p.message.starts_with("Your playlists from before couldn't be backed up as playlists.json.v1"), "{}", p.message);
        std::fs::write(&file, r#"{"version": 1, "playlists": []}"#).unwrap();
        assert!(backup_problem(&file).is_some());
        std::fs::write(&file, r#"{"version": 2, "playlists": []}"#).unwrap();
        assert!(backup_problem(&file).is_none(), "upgraded");
        std::fs::write(&file, "not json").unwrap();
        assert!(backup_problem(&file).is_none(), "a damaged file is the playlists' own to move aside");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn first_run_until_marked_done() {
        let root = scratch("first-run");
        let path = root.join(FIRST_RUN);
        let first = || load_at::<FirstRun>(&path).0.is_none_or(|f| !f.done);
        assert!(first());
        save_json_at(&path, &FirstRun { done: true }).unwrap();
        assert!(!first());
        assert_eq!(read(&path), serde_json::json!({ "version": 1, "done": true }));
        std::fs::write(&path, r#"{"done": false}"#).unwrap();
        assert!(first());
        std::fs::write(&path, "not json").unwrap();
        assert!(first());
        let _ = std::fs::remove_dir_all(root);
    }
}
