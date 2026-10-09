//! Playlists: named lists of presets, each with its own settings, kept in one
//! JSON file.
//!
//! The file is `~/.openflow/visuals/playlists.json` (`OPENFLOW_VISUALS_PLAYLISTS`
//! overrides). Presets inside the library are stored relative to it, with `/`
//! between folders, so the library can move; anything outside it is stored whole.
//! A playlist's position in the file is its number, which is how live control
//! (`actions::Action::Load`) picks one.
//!
//! Version 2 (this one):
//!
//! ```json
//! { "version": 2,
//!   "playlists": [
//!     { "id": "18f…", "name": "Warm up", "kind": "manual",
//!       "settings": { "change": { "unit": "seconds", "every": 30 }, "order": "in_order",
//!                     "transition": 2, "speed": 1, "trails": 0, "hue": 0 },
//!       "presets": [ { "path": "cream-of-the-crop/Dancer/x.milk", "hash": "<SHA-256>", "size": 1234 } ] },
//!     { "id": "18g…", "name": "Calm", "kind": "smart",
//!       "query": { "groups": { "speed": ["low"] }, "text": "" }, "settings": { … } } ] }
//! ```
//!
//! A manual playlist lists its presets; a smart one keeps a library filter
//! ([`LibraryQuery`]) and is worked out when it loads, never playing a hidden
//! preset. Each item keeps its file's content hash, so it is found again when
//! the folder is reorganised (`crate::userlib` looks for it). Version 1 (items
//! as plain paths, no settings) is read and moved to version 2 on open, the
//! old file kept beside it as `playlists.json.v1`. A file that won't parse, or
//! of a newer version, is moved aside (`.bad`, `.bad.1`, …) as
//! `crate::userlib` does; only a missing file reads as no playlists.

use crate::query::LibraryQuery;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The file format's version.
pub const VERSION: u32 = 2;

/// When a playlist moves on to its next preset.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "unit", rename_all = "snake_case")]
pub enum Change {
    /// Every this many seconds (auto-advance), 1 to 3600.
    Seconds { every: f64 },
    /// Every this many bars on Link's bar lines, 1 to 64.
    Bars { every: u32 },
}

/// The order a playlist plays in.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Order {
    #[default]
    InOrder,
    Shuffle,
}

/// What a playlist sets on the deck when it loads. A live tweak lasts until the
/// next playlist loads.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub change: Change,
    pub order: Order,
    /// The crossfade between presets, in seconds (0 to 10).
    pub transition: f64,
    /// The preset clock's speed (0.25 to 4).
    pub speed: f64,
    /// 0 to 1.
    pub trails: f64,
    /// The hue turn, 0 to 1.
    pub hue: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { change: Change::Seconds { every: 30.0 }, order: Order::InOrder, transition: 2.0, speed: 1.0, trails: 0.0, hue: 0.0 }
    }
}

impl Settings {
    /// These settings within their limits, or why not (a value that is no number).
    pub fn checked(self) -> Result<Settings, String> {
        use crate::fx::clamped;
        let change = match self.change {
            Change::Seconds { every } => Change::Seconds { every: clamped(every, 1.0, 3600.0, "seconds")? },
            Change::Bars { every } => Change::Bars { every: every.clamp(1, 64) },
        };
        Ok(Settings {
            change,
            order: self.order,
            transition: clamped(self.transition, 0.0, 10.0, "transition")?,
            speed: clamped(self.speed, 0.25, 4.0, "speed")?,
            trails: clamped(self.trails, 0.0, 1.0, "trails")?,
            hue: clamped(self.hue, 0.0, 1.0, "hue")?,
        })
    }
}

/// Whether a playlist lists its presets or picks them with a filter.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    #[default]
    Manual,
    Smart,
}

/// One item of a manual playlist: where the preset is, and its content then.
/// Reads a version 1 item (a plain path) too.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(from = "Stored")]
pub struct Entry {
    /// Library-relative (or absolute outside the library).
    pub path: String,
    /// SHA-256 of the file in hex, when it was there to read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// The file's size in bytes then, so only files of that size are hashed when looking for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

impl PartialEq<&str> for Entry {
    fn eq(&self, other: &&str) -> bool {
        self.path == *other
    }
}

impl From<&str> for Entry {
    fn from(path: &str) -> Entry {
        Entry { path: path.to_string(), hash: None, size: None }
    }
}

impl Playlist {
    /// A manual playlist of `presets` with the default settings.
    pub fn manual(id: &str, name: &str, presets: Vec<Entry>) -> Playlist {
        Playlist { id: id.into(), name: name.into(), kind: Kind::Manual, query: None, settings: Settings::default(), presets }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Stored {
    Path(String),
    Item { path: String, hash: Option<String>, size: Option<u64> },
}

impl From<Stored> for Entry {
    fn from(s: Stored) -> Entry {
        match s {
            Stored::Path(path) => Entry { path, hash: None, size: None },
            Stored::Item { path, hash, size } => Entry { path, hash, size },
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Playlist {
    /// Stable across renames and reorders; what the page names a playlist by.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: Kind,
    /// A smart playlist's filter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<LibraryQuery>,
    #[serde(default)]
    pub settings: Settings,
    /// A manual playlist's items, in order. The same preset may appear more than once.
    #[serde(default)]
    pub presets: Vec<Entry>,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    #[serde(default)]
    version: u32,
    playlists: Vec<Playlist>,
}

pub struct Store {
    file: PathBuf,
    /// The folders presets are relative to: the presets folder first, then the starter set.
    folders: Vec<PathBuf>,
    pub lists: Vec<Playlist>,
}

/// One playlist item as the page shows it.
#[derive(Serialize, Clone, Debug)]
pub struct Item {
    pub path: String,
    pub name: String,
    pub group: String,
    /// The file is not there (any more).
    pub missing: bool,
    pub hash: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct View {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub query: Option<LibraryQuery>,
    pub settings: Settings,
    /// A manual playlist's items; empty for a smart one (worked out when it loads).
    pub items: Vec<Item>,
}

/// A playlist as a file to share: its presets by path (library-relative) and
/// content hash, so it plays on another Mac with the same presets anywhere.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Shared {
    /// Always [`SHARED_FORMAT`].
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<LibraryQuery>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub items: Vec<SharedItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SharedItem {
    pub path: String,
    #[serde(default)]
    pub hash: Option<String>,
}

/// What a shared playlist file says it is.
pub const SHARED_FORMAT: &str = "visualflow-playlist";

/// An exported playlist: a file name to suggest, and the file's text.
#[derive(Serialize, Clone, Debug)]
pub struct Exported {
    pub file_name: String,
    pub text: String,
}

/// Where playlists live unless `OPENFLOW_VISUALS_PLAYLISTS` says otherwise.
pub fn default_file() -> PathBuf {
    std::env::var_os("OPENFLOW_VISUALS_PLAYLISTS").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/playlists.json"))
}

fn new_id() -> String {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let now = std::time::UNIX_EPOCH.elapsed().map(|d| d.as_millis() as u64).unwrap_or(0);
    format!("{now:x}{:x}", COUNT.fetch_add(1, Ordering::Relaxed))
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() { Err("a playlist needs a name".into()) } else { Ok(name.to_string()) }
}

/// A file's content hash and size, when it can be read.
fn hash_file(path: &Path) -> (Option<String>, Option<u64>) {
    match std::fs::read(path) {
        Ok(bytes) => (Some(engine::index::hash(&bytes)), Some(bytes.len() as u64)),
        Err(_) => (None, None),
    }
}

impl Store {
    /// Read the file (see the module's docs): version 1 is moved to version 2,
    /// hashing the items whose files are there.
    pub fn open(file: PathBuf, library: PathBuf) -> Store {
        let mut store = Store { file, folders: vec![library], lists: Vec::new() };
        let bytes = match std::fs::read(&store.file) {
            Ok(bytes) => bytes,
            Err(_) => return store,
        };
        let problem = match serde_json::from_slice::<File>(&bytes) {
            Ok(f) if f.version == VERSION => {
                store.lists = f.playlists;
                return store;
            }
            Ok(f) if f.version < VERSION => {
                store.lists = f.playlists;
                store.migrate(&bytes);
                return store;
            }
            Ok(f) => format!("is version {}, newer than {VERSION}", f.version),
            Err(e) => format!("does not parse ({e})"),
        };
        let aside = crate::userlib::aside(&store.file);
        eprintln!("playlists: {} {problem}; moved to {}", store.file.display(), aside.display());
        let _ = std::fs::rename(&store.file, &aside);
        store
    }

    /// From version 1: hash each item whose file is there, keep the old file as
    /// `.v1`, and write version 2.
    fn migrate(&mut self, old: &[u8]) {
        for i in 0..self.lists.len() {
            for j in 0..self.lists[i].presets.len() {
                let path = self.resolve(&self.lists[i].presets[j].path);
                let (hash, size) = hash_file(&path);
                let entry = &mut self.lists[i].presets[j];
                entry.hash = entry.hash.take().or(hash);
                entry.size = entry.size.or(size);
            }
        }
        let mut kept = self.file.file_name().unwrap_or_default().to_os_string();
        kept.push(".v1");
        let _ = std::fs::write(self.file.with_file_name(kept), old);
        if let Err(e) = self.save() {
            eprintln!("playlists: saving {} as version {VERSION} failed: {e}", self.file.display());
        }
    }

    /// Write the whole file, through a temporary file so a crash never leaves half of one.
    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(&File { version: VERSION, playlists: self.lists.clone() }).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }

    /// Also resolve presets against `folder` (the bundled starter set).
    pub fn add_folder(&mut self, folder: PathBuf) {
        self.folders.push(folder);
    }

    /// How a preset is written in the file.
    pub fn relative(&self, path: &Path) -> String {
        match self.folders.iter().find_map(|f| path.strip_prefix(f).ok()) {
            Some(rel) => rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"),
            None => path.to_string_lossy().into_owned(),
        }
    }

    /// Where a preset written in the file is now.
    pub fn resolve(&self, stored: &str) -> PathBuf {
        let p = Path::new(stored);
        if p.is_absolute() { p.to_path_buf() } else { crate::pack::resolve_in(&self.folders, p) }
    }

    pub fn position(&self, id: &str) -> Option<usize> {
        self.lists.iter().position(|l| l.id == id)
    }

    pub fn find(&self, id: &str) -> Option<&Playlist> {
        self.lists.iter().find(|l| l.id == id)
    }

    fn get(&mut self, id: &str) -> Result<&mut Playlist, String> {
        self.lists.iter_mut().find(|l| l.id == id).ok_or_else(|| format!("no playlist {id}"))
    }

    /// A manual playlist, for an edit of its items; a smart one has none to edit.
    fn manual(&mut self, id: &str) -> Result<&mut Playlist, String> {
        let list = self.get(id)?;
        if list.kind == Kind::Smart {
            return Err(format!("{} is a smart playlist: it picks its own presets", list.name));
        }
        Ok(list)
    }

    pub fn create(&mut self, name: &str) -> Result<String, String> {
        let id = new_id();
        self.lists.push(Playlist::manual(&id, &clean_name(name)?, Vec::new()));
        Ok(id)
    }

    /// A smart playlist named `name` picking the presets `query` matches.
    pub fn create_smart(&mut self, name: &str, query: LibraryQuery) -> Result<String, String> {
        let id = new_id();
        self.lists.push(Playlist { id: id.clone(), name: clean_name(name)?, kind: Kind::Smart, query: Some(query), settings: Settings::default(), presets: Vec::new() });
        Ok(id)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        self.get(id)?.name = name;
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let at = self.position(id).ok_or_else(|| format!("no playlist {id}"))?;
        self.lists.remove(at);
        Ok(())
    }

    /// Change playlist `id`'s settings ([`Settings::checked`]).
    pub fn set_settings(&mut self, id: &str, settings: Settings) -> Result<(), String> {
        let settings = settings.checked()?;
        self.get(id)?.settings = settings;
        Ok(())
    }

    /// Change smart playlist `id`'s filter.
    pub fn set_query(&mut self, id: &str, query: LibraryQuery) -> Result<(), String> {
        let list = self.get(id)?;
        if list.kind != Kind::Smart {
            return Err(format!("{} is not a smart playlist", list.name));
        }
        list.query = Some(query);
        Ok(())
    }

    /// Put `path` into playlist `id` at `at` (the end when absent or past it), with its content hash.
    pub fn add(&mut self, id: &str, path: &Path, at: Option<usize>) -> Result<(), String> {
        let stored = self.relative(path);
        let (hash, size) = hash_file(path);
        let list = self.manual(id)?;
        let at = at.unwrap_or(list.presets.len()).min(list.presets.len());
        list.presets.insert(at, Entry { path: stored, hash, size });
        Ok(())
    }

    pub fn remove(&mut self, id: &str, index: usize) -> Result<(), String> {
        let list = self.manual(id)?;
        if index >= list.presets.len() {
            return Err(format!("{} has no item {index}", list.name));
        }
        list.presets.remove(index);
        Ok(())
    }

    /// Move item `from` of playlist `id` so it ends up at `to`.
    pub fn move_item(&mut self, id: &str, from: usize, to: usize) -> Result<(), String> {
        let list = self.manual(id)?;
        let n = list.presets.len();
        if from >= n || to >= n {
            return Err(format!("{} has {n} items", list.name));
        }
        let item = list.presets.remove(from);
        list.presets.insert(to, item);
        Ok(())
    }

    /// Move playlist `id` so it ends up at position `to` (its number for live control).
    pub fn move_list(&mut self, id: &str, to: usize) -> Result<(), String> {
        let from = self.position(id).ok_or_else(|| format!("no playlist {id}"))?;
        if to >= self.lists.len() {
            return Err(format!("there are {} playlists", self.lists.len()));
        }
        let list = self.lists.remove(from);
        self.lists.insert(to, list);
        Ok(())
    }

    /// Manual playlist `id`'s items as files; none for a smart one.
    pub fn paths(&self, id: &str) -> Vec<PathBuf> {
        self.find(id).map(|l| l.presets.iter().map(|e| self.resolve(&e.path)).collect()).unwrap_or_default()
    }

    /// Whether some item is stored as `stored`.
    pub fn names(&self, stored: &str) -> bool {
        self.lists.iter().flat_map(|l| &l.presets).any(|e| e.path == stored)
    }

    /// Every item with a hash, once each: (as stored, hash, size), for finding moved presets again.
    pub fn hashed(&self) -> Vec<(String, String, Option<u64>)> {
        let mut out: Vec<(String, String, Option<u64>)> = Vec::new();
        for e in self.lists.iter().flat_map(|l| &l.presets) {
            if let Some(hash) = &e.hash {
                if !out.iter().any(|(p, _, _)| *p == e.path) {
                    out.push((e.path.clone(), hash.clone(), e.size));
                }
            }
        }
        out
    }

    pub fn views(&self) -> Vec<View> {
        self.lists
            .iter()
            .map(|l| View {
                id: l.id.clone(),
                name: l.name.clone(),
                kind: l.kind,
                query: l.query.clone(),
                settings: l.settings,
                items: l
                    .presets
                    .iter()
                    .map(|e| {
                        let s = &e.path;
                        let path = self.resolve(s);
                        let group = match s.rsplit_once('/') {
                            Some((dir, _)) if !Path::new(s).is_absolute() => dir.to_string(),
                            _ => path.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                        };
                        Item {
                            name: path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                            group,
                            missing: !path.is_file(),
                            path: path.to_string_lossy().into_owned(),
                            hash: e.hash.clone(),
                        }
                    })
                    .collect(),
            })
            .collect()
    }

    /// Playlist `id` as a file to share ([`Shared`]).
    pub fn export(&self, id: &str) -> Result<Exported, String> {
        let l = self.find(id).ok_or_else(|| format!("no playlist {id}"))?;
        let shared = Shared {
            format: SHARED_FORMAT.into(),
            version: 1,
            name: l.name.clone(),
            kind: l.kind,
            query: l.query.clone(),
            settings: l.settings,
            items: l.presets.iter().map(|e| SharedItem { path: e.path.clone(), hash: e.hash.clone() }).collect(),
        };
        let safe: String = l.name.chars().map(|c| if c.is_alphanumeric() || " -_".contains(c) { c } else { '_' }).collect();
        Ok(Exported { file_name: format!("{}.visualflow.json", safe.trim()), text: serde_json::to_string_pretty(&shared).map_err(|e| e.to_string())? })
    }

    /// Add the playlist a shared file's `text` holds, as a new playlist; returns its id.
    /// Items whose file isn't where it says are kept, to be found again by their hash.
    pub fn import(&mut self, text: &str) -> Result<String, String> {
        let shared: Shared = serde_json::from_str(text).map_err(|e| format!("not a playlist file ({e})"))?;
        if shared.format != SHARED_FORMAT {
            return Err("not a visual[flow] playlist file".into());
        }
        if shared.version > 1 {
            return Err(format!("this playlist file is version {}, newer than this app reads", shared.version));
        }
        if shared.kind == Kind::Smart && shared.query.is_none() {
            return Err("a smart playlist file with no filter".into());
        }
        let name = clean_name(&shared.name)?;
        let settings = shared.settings.checked()?;
        let presets = shared
            .items
            .into_iter()
            .map(|i| {
                // The size is kept only when the file here is the one the hash names.
                let size = match (&i.hash, hash_file(&self.resolve(&i.path))) {
                    (Some(want), (Some(have), size)) if *want == have => size,
                    _ => None,
                };
                Entry { path: i.path, hash: i.hash, size }
            })
            .collect();
        let query = if shared.kind == Kind::Smart { shared.query } else { None };
        let id = new_id();
        self.lists.push(Playlist { id: id.clone(), name, kind: shared.kind, query, settings, presets });
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("visuals-playlists-{}", new_id()));
        std::fs::create_dir_all(dir.join("lib/a")).unwrap();
        std::fs::write(dir.join("lib/a/one.milk"), "").unwrap();
        dir
    }

    #[test]
    fn round_trips_with_library_relative_paths_and_hashes() {
        let dir = temp();
        let mut s = Store::open(dir.join("playlists.json"), dir.join("lib"));
        assert!(s.lists.is_empty());
        let id = s.create(" Set one ").unwrap();
        s.add(&id, &dir.join("lib/a/one.milk"), None).unwrap();
        s.add(&id, Path::new("/elsewhere/two.milk"), None).unwrap();
        s.save().unwrap();

        let text = std::fs::read_to_string(dir.join("playlists.json")).unwrap();
        assert!(text.contains("\"a/one.milk\""), "{text}");
        assert!(text.contains("\"version\": 2"), "{text}");
        assert!(text.contains(&engine::index::hash(b"")), "the item's hash is kept: {text}");

        // The library moved: the relative item follows it, the outside one stays.
        std::fs::rename(dir.join("lib"), dir.join("moved")).unwrap();
        let s = Store::open(dir.join("playlists.json"), dir.join("moved"));
        assert_eq!(s.lists[0].name, "Set one");
        assert_eq!(s.lists[0].settings, Settings::default());
        let views = s.views();
        assert_eq!(views[0].items[0].path, dir.join("moved/a/one.milk").to_string_lossy());
        assert_eq!(views[0].items[0].name, "one");
        assert_eq!(views[0].items[0].group, "a");
        assert_eq!(views[0].items[0].hash.as_deref(), Some(engine::index::hash(b"").as_str()));
        assert!(!views[0].items[0].missing);
        assert_eq!(views[0].items[1].path, "/elsewhere/two.milk");
        assert!(views[0].items[1].missing);
        assert_eq!(views[0].items[1].hash, None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn version_1_moves_to_version_2_keeping_the_old_file() {
        let dir = temp();
        std::fs::write(dir.join("lib/a/two.milk"), "[preset00]\n").unwrap();
        let v1 = r#"{"version":1,"playlists":[{"id":"1","name":"Set","presets":["a/one.milk","a/two.milk","gone.milk"]}]}"#;
        std::fs::write(dir.join("p.json"), v1).unwrap();
        let s = Store::open(dir.join("p.json"), dir.join("lib"));
        let l = &s.lists[0];
        assert_eq!((l.id.as_str(), l.name.as_str(), l.kind, l.settings), ("1", "Set", Kind::Manual, Settings::default()));
        assert_eq!(l.presets, ["a/one.milk", "a/two.milk", "gone.milk"]);
        assert_eq!(l.presets[1].hash.as_deref(), Some(engine::index::hash(b"[preset00]\n").as_str()));
        assert_eq!(l.presets[1].size, Some(11));
        assert_eq!(l.presets[2].hash, None, "a missing file has no hash to keep");
        assert_eq!(std::fs::read_to_string(dir.join("p.json.v1")).unwrap(), v1);
        // Written as version 2 straight away, and read back the same.
        let again = Store::open(dir.join("p.json"), dir.join("lib"));
        assert!(std::fs::read_to_string(dir.join("p.json")).unwrap().contains("\"version\": 2"));
        assert_eq!(again.lists, s.lists);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn edits() {
        let dir = temp();
        let lib = dir.join("lib");
        let mut s = Store::open(dir.join("p.json"), lib.clone());
        let a = s.create("a").unwrap();
        let b = s.create("b").unwrap();
        assert_ne!(a, b);
        assert!(s.create("  ").is_err());
        for n in ["x", "y", "z"] {
            s.add(&a, &lib.join(format!("{n}.milk")), None).unwrap();
        }
        s.add(&a, &lib.join("w.milk"), Some(0)).unwrap();
        assert_eq!(s.lists[0].presets, ["w.milk", "x.milk", "y.milk", "z.milk"]);
        s.move_item(&a, 0, 3).unwrap();
        assert_eq!(s.lists[0].presets, ["x.milk", "y.milk", "z.milk", "w.milk"]);
        s.move_item(&a, 2, 0).unwrap();
        assert_eq!(s.lists[0].presets, ["z.milk", "x.milk", "y.milk", "w.milk"]);
        assert!(s.move_item(&a, 0, 4).is_err());
        s.remove(&a, 1).unwrap();
        assert_eq!(s.lists[0].presets, ["z.milk", "y.milk", "w.milk"]);
        assert!(s.remove(&a, 3).is_err());
        s.rename(&b, "bee").unwrap();
        s.move_list(&b, 0).unwrap();
        assert_eq!(s.lists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["bee", "a"]);
        s.delete(&b).unwrap();
        assert_eq!(s.lists.len(), 1);
        assert!(s.delete(&b).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_are_kept_within_limits_and_smart_playlists_keep_their_filter() {
        let dir = temp();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        let a = s.create("a").unwrap();
        let wild = Settings { change: Change::Bars { every: 500 }, order: Order::Shuffle, transition: 99.0, speed: 0.0, trails: 0.5, hue: 2.0 };
        s.set_settings(&a, wild).unwrap();
        assert_eq!(s.lists[0].settings, Settings { change: Change::Bars { every: 64 }, order: Order::Shuffle, transition: 10.0, speed: 0.25, trails: 0.5, hue: 1.0 });
        assert!(s.set_settings(&a, Settings { speed: f64::NAN, ..Settings::default() }).is_err());
        let query = LibraryQuery { text: "warm".into(), ..Default::default() };
        let smart = s.create_smart("Calm", query.clone()).unwrap();
        assert!(s.add(&smart, &dir.join("lib/a/one.milk"), None).is_err(), "a smart playlist picks its own");
        assert!(s.set_query(&a, query.clone()).is_err());
        s.set_query(&smart, LibraryQuery { text: "cool".into(), ..Default::default() }).unwrap();
        s.save().unwrap();
        let s = Store::open(dir.join("p.json"), dir.join("lib"));
        assert_eq!(s.lists[1].kind, Kind::Smart);
        assert_eq!(s.lists[1].query.as_ref().unwrap().text, "cool");
        assert_eq!(s.lists[0].settings.change, Change::Bars { every: 64 });
        assert!(s.views()[1].items.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn export_and_import_carry_paths_hashes_and_settings() {
        let dir = temp();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        let a = s.create("Warm / up").unwrap();
        s.add(&a, &dir.join("lib/a/one.milk"), None).unwrap();
        s.set_settings(&a, Settings { order: Order::Shuffle, ..Settings::default() }).unwrap();
        let out = s.export(&a).unwrap();
        assert_eq!(out.file_name, "Warm _ up.visualflow.json");
        let shared: Shared = serde_json::from_str(&out.text).unwrap();
        assert_eq!(shared.items, [SharedItem { path: "a/one.milk".into(), hash: Some(engine::index::hash(b"")) }]);
        let b = s.import(&out.text).unwrap();
        let (one, two) = (&s.lists[0], s.find(&b).unwrap());
        assert_eq!((two.name.as_str(), two.settings.order, &two.presets), (one.name.as_str(), Order::Shuffle, &one.presets));
        assert!(s.import("{}").is_err());
        assert!(s.import(&out.text.replace(SHARED_FORMAT, "other")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_broken_or_newer_file_is_moved_aside_not_lost() {
        let dir = temp();
        std::fs::write(dir.join("p.json"), "{ not json").unwrap();
        let s = Store::open(dir.join("p.json"), dir.join("lib"));
        assert!(s.lists.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("p.json.bad")).unwrap(), "{ not json");
        let newer = r#"{"version":3,"playlists":[]}"#;
        std::fs::write(dir.join("p.json"), newer).unwrap();
        assert!(Store::open(dir.join("p.json"), dir.join("lib")).lists.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("p.json.bad.1")).unwrap(), newer);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
