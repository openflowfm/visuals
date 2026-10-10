//! Playlists: named lists of presets, each with its own settings, kept in one
//! JSON file.
//!
//! The file is `playlists.json` in the settings folder (`~/.openflow/visuals`,
//! or `$OPENFLOW_HOME/visuals`; `OPENFLOW_VISUALS_PLAYLISTS` overrides). Presets inside the library are stored relative to it, with `/`
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
//!     { "id": "18g…", "name": "Calm", "kind": "smart", "starter": "calm",
//!       "query": { "groups": { "speed": ["low"] }, "text": "" }, "settings": { … } } ] }
//! ```
//!
//! A manual playlist lists its presets; a smart one keeps a library filter
//! ([`LibraryQuery`]) and is worked out when it loads, never playing a hidden
//! preset. Each item keeps its file's content hash, so it is found again when
//! the folder is reorganised (`crate::userlib` looks for it). Version 1 (items
//! as plain paths, no settings) is read and moved to version 2 on open, its
//! playlists getting the default settings with auto-advance off
//! (written `"change": { "unit": "seconds", "every": 30, "auto": false }`, which
//! older builds read as seconds; `"unit": "off"` is read too) so they play as they did in 0.2, the
//! old file kept beside it as `playlists.json.v1` (numbered, `.v1.1`…, when that
//! is taken; until the backup is written, version 2 isn't). A file that won't parse, or
//! of a newer version, is moved aside (`.bad`, `.bad.1`, …) as
//! `crate::userlib` does; only a missing file reads as no playlists.

use crate::query::LibraryQuery;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The file format's version.
pub const VERSION: u32 = 2;

/// When a playlist moves on to its next preset. The page sees `off` as its own
/// unit; files (`playlists.json` and shared playlists) write it as
/// `{ "unit": "seconds", "every": …, "auto": false }` ([`stored`]), which builds
/// from before `off` read as seconds (they ignore `auto`) rather than failing on.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "unit", rename_all = "snake_case", from = "ChangeIn")]
pub enum Change {
    /// Every this many seconds (auto-advance), 1 to 3600.
    Seconds { every: f64 },
    /// Every this many bars on Link's bar lines, 1 to 64.
    Bars { every: u32 },
    /// Never by itself: auto-advance off, as a playlist from 0.2 (version 1) plays.
    /// `every` is the seconds it goes back to when turned on (1 to 3600).
    Off { every: f64 },
}

/// [`Change`] as read: seconds with `"auto": false` is off.
#[derive(Deserialize)]
#[serde(tag = "unit", rename_all = "snake_case")]
enum ChangeIn {
    Seconds {
        every: f64,
        #[serde(default = "yes")]
        auto: bool,
    },
    Bars {
        every: u32,
    },
    Off {
        every: f64,
    },
}

fn yes() -> bool {
    true
}

impl From<ChangeIn> for Change {
    fn from(c: ChangeIn) -> Self {
        match c {
            ChangeIn::Seconds { every, auto: true } => Change::Seconds { every },
            ChangeIn::Seconds { every, auto: false } | ChangeIn::Off { every } => Change::Off { every },
            ChangeIn::Bars { every } => Change::Bars { every },
        }
    }
}

/// [`Settings`] as files write them: an off [`Change`] as seconds with
/// `"auto": false`, so an older build reads the file (and at worst auto-advances).
mod stored {
    use super::{Change, Settings};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(s: &Settings, ser: S) -> Result<S::Ok, S::Error> {
        let mut v = serde_json::to_value(s).map_err(serde::ser::Error::custom)?;
        if let Change::Off { every } = s.change {
            v["change"] = serde_json::json!({ "unit": "seconds", "every": every, "auto": false });
        }
        v.serialize(ser)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Settings, D::Error> {
        Settings::deserialize(d)
    }
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
    /// What a playlist moved from version 1 (0.2) gets: the defaults with
    /// auto-advance off, so it plays as it did in 0.2.
    pub fn from_v1() -> Self {
        Settings { change: Change::Off { every: 30.0 }, ..Settings::default() }
    }

    /// These settings within their limits, or why not (a value that is no number).
    pub fn checked(self) -> Result<Settings, String> {
        use crate::fx::clamped;
        let change = match self.change {
            Change::Seconds { every } => Change::Seconds { every: clamped(every, 1.0, 3600.0, "seconds")? },
            Change::Bars { every } => Change::Bars { every: every.clamp(1, 64) },
            Change::Off { every } => Change::Off { every: clamped(every, 1.0, 3600.0, "seconds")? },
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
        Playlist { id: id.into(), name: name.into(), kind: Kind::Manual, query: None, settings: Settings::default(), presets, starter: None }
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
    #[serde(default, with = "stored")]
    pub settings: Settings,
    /// A manual playlist's items, in order. The same preset may appear more than once.
    #[serde(default)]
    pub presets: Vec<Entry>,
    /// Which of the home's starter smart playlists this is (`calm`, `peak-time`,
    /// `recently-played`), when the home made it; never shown, never exported.
    /// Seeding repairs only playlists carrying one, never one the user named the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starter: Option<String>,
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
    /// A version 1 file not yet kept as a backup: until it is, nothing is
    /// written over it ([`Store::save`] tries the backup again first).
    pending_backup: Option<Vec<u8>>,
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
    /// The starter id ([`Playlist::starter`]), when the home made it.
    pub starter: Option<String>,
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
    #[serde(default, with = "stored")]
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
    file_from(std::env::var_os("OPENFLOW_VISUALS_PLAYLISTS"), &crate::settings::dir())
}

/// The playlists file: `set` if given, else `playlists.json` in `dir` (the settings folder).
fn file_from(set: Option<std::ffi::OsString>, dir: &Path) -> PathBuf {
    set.map(PathBuf::from).unwrap_or_else(|| dir.join("playlists.json"))
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

/// A preset file's content hash and size, when it is one that can be read
/// ([`crate::library::read_preset`]: a regular file of a preset's size).
fn hash_file(path: &Path) -> (Option<String>, Option<u64>) {
    match crate::library::read_preset(path) {
        Ok(bytes) => (Some(engine::index::hash(&bytes)), Some(bytes.len() as u64)),
        Err(_) => (None, None),
    }
}

/// A shared file's item path, when it is a plain path inside a library folder:
/// relative, of ordinary names only (no `..`, no root, no drive).
fn plain(path: &str) -> bool {
    use std::path::Component;
    !path.is_empty() && Path::new(path).components().all(|c| matches!(c, Component::Normal(_)))
}

/// `lists` with every playlist's settings within their limits ([`Settings::checked`]);
/// settings that can't be (no number) are the defaults.
fn checked(mut lists: Vec<Playlist>) -> Vec<Playlist> {
    for l in &mut lists {
        l.settings = l.settings.checked().unwrap_or_default();
    }
    lists
}

impl Store {
    /// Read the file (see the module's docs): version 1 is moved to version 2,
    /// hashing the items whose files are there. Settings out of their limits
    /// (a hand-edited file) are brought within them.
    pub fn open(file: PathBuf, library: PathBuf) -> Store {
        let mut store = Store { file, folders: vec![library], lists: Vec::new(), pending_backup: None };
        let bytes = match std::fs::read(&store.file) {
            Ok(bytes) => bytes,
            Err(_) => return store,
        };
        let problem = match serde_json::from_slice::<File>(&bytes) {
            Ok(f) if f.version == VERSION => {
                store.lists = checked(f.playlists);
                return store;
            }
            Ok(f) if f.version < VERSION => {
                // Version 1 had no settings: auto-advance stays off, as in 0.2.
                store.lists = f.playlists.into_iter().map(|l| Playlist { settings: Settings::from_v1(), ..l }).collect();
                if let Err(e) = store.migrate(bytes) {
                    eprintln!("playlists: {e}");
                }
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

    /// From version 1: hash each item whose file is there, keep the old file
    /// beside it (`.v1`, or `.v1.1`, `.v1.2`… when that is taken: a backup is
    /// never written over), and write version 2. When the backup can't be
    /// written, the old file stays as it is and the migrated playlists play
    /// from memory; every save tries the backup again first.
    fn migrate(&mut self, old: Vec<u8>) -> Result<(), String> {
        self.hash_missing();
        self.pending_backup = Some(old);
        self.save().map_err(|e| format!("{} stays at version 1 for now: {e}", self.file.display()))
    }

    /// Keep the version 1 file not yet backed up, under the first free name.
    fn back_up(&mut self) -> Result<(), String> {
        let Some(old) = &self.pending_backup else { return Ok(()) };
        let mut name = self.file.file_name().unwrap_or_default().to_os_string();
        name.push(".v1");
        for n in 0..1000 {
            let mut numbered = name.clone();
            if n > 0 {
                numbered.push(format!(".{n}"));
            }
            let path = self.file.with_file_name(numbered);
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    use std::io::Write;
                    if let Err(e) = f.write_all(old).and_then(|_| f.sync_all()) {
                        let _ = std::fs::remove_file(&path);
                        return Err(format!("keeping the version 1 file as {} failed: {e}", path.display()));
                    }
                    self.pending_backup = None;
                    return Ok(());
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("keeping the version 1 file as {} failed: {e}", path.display())),
            }
        }
        Err("keeping the version 1 file failed: every backup name is taken".into())
    }

    /// Hash the items that have no hash yet whose file is now there (an item
    /// whose file was missing when version 1 was moved to version 2, say).
    /// Returns whether any was.
    pub fn hash_missing(&mut self) -> bool {
        let mut any = false;
        for i in 0..self.lists.len() {
            for j in 0..self.lists[i].presets.len() {
                if self.lists[i].presets[j].hash.is_some() {
                    continue;
                }
                let path = self.resolve(&self.lists[i].presets[j].path);
                if let (Some(hash), size) = hash_file(&path) {
                    let entry = &mut self.lists[i].presets[j];
                    entry.hash = Some(hash);
                    entry.size = entry.size.or(size);
                    any = true;
                }
            }
        }
        any
    }

    /// Write the whole file, through a temporary file so a crash never leaves
    /// half of one. A version 1 file not yet backed up is kept first, or nothing
    /// is written.
    pub fn save(&mut self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        self.back_up()?;
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

    /// A smart playlist named `name` picking the presets `query` matches; `starter`
    /// marks one of the home's starters ([`Playlist::starter`]).
    pub fn create_smart(&mut self, name: &str, query: LibraryQuery, starter: Option<String>) -> Result<String, String> {
        let id = new_id();
        let starter = starter.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.lists.push(Playlist { id: id.clone(), name: clean_name(name)?, kind: Kind::Smart, query: Some(query), settings: Settings::default(), presets: Vec::new(), starter });
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
                starter: l.starter.clone(),
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
            // Outside the library, only the file's name: never where it is on this Mac
            // (the user's home). Its hash finds it again on import.
            items: l
                .presets
                .iter()
                .map(|e| {
                    let path = if Path::new(&e.path).is_absolute() { Path::new(&e.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() } else { e.path.clone() };
                    SharedItem { path, hash: e.hash.clone() }
                })
                .collect(),
        };
        let safe: String = l.name.chars().map(|c| if c.is_alphanumeric() || " -_".contains(c) { c } else { '_' }).collect();
        Ok(Exported { file_name: format!("{}.visualflow.json", safe.trim()), text: serde_json::to_string_pretty(&shared).map_err(|e| e.to_string())? })
    }

    /// Add the playlist a shared file's `text` holds, as a new playlist; returns its id.
    /// Items whose file isn't where it says are kept, to be found again by their hash.
    /// Item paths are only ever inside the library folders: a file naming an
    /// absolute path or one through `..` is refused. A smart playlist keeps no items.
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
        if let Some(bad) = shared.items.iter().find(|i| !plain(&i.path)) {
            return Err(format!("the playlist file names a preset outside the library ({})", bad.path));
        }
        let items = if shared.kind == Kind::Smart { Vec::new() } else { shared.items };
        let presets = items
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
        // Never a starter: an imported playlist is the user's own.
        self.lists.push(Playlist { id: id.clone(), name, kind: shared.kind, query, settings, presets, starter: None });
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_is_in_the_settings_folder_unless_set() {
        let dir = Path::new("/scratch/openflow/visuals");
        assert_eq!(file_from(None, dir), PathBuf::from("/scratch/openflow/visuals/playlists.json"));
        assert_eq!(file_from(Some("/elsewhere/p.json".into()), dir), PathBuf::from("/elsewhere/p.json"));
    }

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
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        let l = &s.lists[0];
        // Auto-advance off, as in 0.2; the rest the defaults.
        assert_eq!((l.id.as_str(), l.name.as_str(), l.kind, l.settings), ("1", "Set", Kind::Manual, Settings::from_v1()));
        assert_eq!(l.settings.change, Change::Off { every: 30.0 });
        assert_eq!(Settings { change: Change::Seconds { every: 30.0 }, ..l.settings }, Settings::default());
        assert_eq!(l.presets, ["a/one.milk", "a/two.milk", "gone.milk"]);
        assert_eq!(l.presets[1].hash.as_deref(), Some(engine::index::hash(b"[preset00]\n").as_str()));
        assert_eq!(l.presets[1].size, Some(11));
        assert_eq!(l.presets[2].hash, None, "a missing file has no hash to keep");
        assert_eq!(std::fs::read_to_string(dir.join("p.json.v1")).unwrap(), v1);
        // Written as version 2 straight away, and read back the same.
        let again = Store::open(dir.join("p.json"), dir.join("lib"));
        assert!(std::fs::read_to_string(dir.join("p.json")).unwrap().contains("\"version\": 2"));
        assert_eq!(again.lists, s.lists);
        assert!(std::fs::read_to_string(dir.join("p.json")).unwrap().contains("\"auto\": false"));
        // A playlist made now still changes every 30 s with a 2 s crossfade.
        let new = s.create("New").unwrap();
        let new = s.find(&new).unwrap().settings;
        assert_eq!((new.change, new.transition), (Change::Seconds { every: 30.0 }, 2.0));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_off_playlist_is_written_so_older_builds_read_it() {
        // `Change` as main (the 0.5 nightly) has it: no `off`.
        #[derive(Deserialize, Debug, PartialEq)]
        #[serde(tag = "unit", rename_all = "snake_case")]
        enum OldChange {
            Seconds { every: f64 },
            Bars { every: u32 },
        }
        #[derive(Deserialize)]
        struct OldSettings {
            change: OldChange,
        }
        #[derive(Deserialize)]
        struct OldPlaylist {
            settings: OldSettings,
        }
        #[derive(Deserialize)]
        struct OldFile {
            playlists: Vec<OldPlaylist>,
        }
        let mut l = Playlist::manual("1", "Set", Vec::new());
        l.settings = Settings::from_v1();
        let text = serde_json::to_string_pretty(&File { version: VERSION, playlists: vec![l.clone()] }).unwrap();
        let old: OldFile = serde_json::from_str(&text).unwrap();
        assert_eq!(old.playlists[0].settings.change, OldChange::Seconds { every: 30.0 });
        // Read back here, it is still off; and a file with `"unit": "off"` still reads.
        let back: File = serde_json::from_str(&text).unwrap();
        assert_eq!(back.playlists[0].settings.change, Change::Off { every: 30.0 });
        let written_off: Playlist = serde_json::from_str(r#"{"id":"1","name":"Set","settings":{"change":{"unit":"off","every":12}}}"#).unwrap();
        assert_eq!(written_off.settings.change, Change::Off { every: 12.0 });
        // The page still sees `off` as its own unit.
        assert_eq!(serde_json::to_value(Change::Off { every: 30.0 }).unwrap(), serde_json::json!({ "unit": "off", "every": 30.0 }));
    }

    #[test]
    fn off_is_kept_within_limits() {
        let off = Settings { change: Change::Off { every: 0.0 }, ..Settings::default() }.checked().unwrap();
        assert_eq!(off.change, Change::Off { every: 1.0 });
        assert!(Settings { change: Change::Off { every: f64::NAN }, ..Settings::default() }.checked().is_err());
    }

    #[test]
    fn a_starter_keeps_its_id_but_never_exports_it() {
        let dir = temp();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        let query = LibraryQuery { text: "calm".into(), ..Default::default() };
        let ours = s.create_smart("Calm", query.clone(), Some("calm".into())).unwrap();
        let theirs = s.create_smart("Calm", query.clone(), None).unwrap();
        let blank = s.create_smart("Blank", query, Some("  ".into())).unwrap();
        assert_eq!(s.find(&blank).unwrap().starter, None, "a blank starter id is none");
        s.rename(&ours, "Quiet").unwrap();
        s.save().unwrap();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        assert_eq!(s.find(&ours).unwrap().starter.as_deref(), Some("calm"), "kept through a rename and a save");
        assert_eq!(s.find(&theirs).unwrap().starter, None);
        let views = s.views();
        assert_eq!(views.iter().map(|v| v.starter.as_deref()).collect::<Vec<_>>(), [Some("calm"), None, None]);
        let shared = s.export(&ours).unwrap();
        assert!(!shared.text.contains("starter"), "{}", shared.text);
        let copy = s.import(&shared.text).unwrap();
        assert_eq!(s.find(&copy).unwrap().starter, None, "an imported copy is the user's own");
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
        let smart = s.create_smart("Calm", query.clone(), None).unwrap();
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
    fn a_v1_backup_is_never_written_over_and_v2_waits_for_it() {
        let dir = temp();
        let v1 = r#"{"version":1,"playlists":[{"id":"1","name":"Set","presets":["a/one.milk"]}]}"#;
        // An older backup is there already: it stays, the new one is numbered.
        std::fs::write(dir.join("p.json.v1"), "older").unwrap();
        std::fs::write(dir.join("p.json"), v1).unwrap();
        Store::open(dir.join("p.json"), dir.join("lib"));
        assert_eq!(std::fs::read_to_string(dir.join("p.json.v1")).unwrap(), "older");
        assert_eq!(std::fs::read_to_string(dir.join("p.json.v1.1")).unwrap(), v1);

        // The backup can't be written (a read-only folder): version 1 is left as it is,
        // the migrated playlists play from memory, and no save writes over it.
        let ro = dir.join("ro");
        std::fs::create_dir_all(&ro).unwrap();
        std::fs::write(ro.join("p.json"), v1).unwrap();
        let perms = |mode| {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(mode)).unwrap();
        };
        perms(0o555);
        let mut s = Store::open(ro.join("p.json"), dir.join("lib"));
        assert_eq!(s.lists[0].presets[0].hash.as_deref(), Some(engine::index::hash(b"").as_str()));
        assert!(s.save().is_err(), "no backup, no version 2");
        assert_eq!(std::fs::read_to_string(ro.join("p.json")).unwrap(), v1);
        assert!(!ro.join("p.json.v1").exists());
        // Once it can be, the next save keeps the backup, then writes version 2.
        perms(0o755);
        s.rename("1", "Renamed").unwrap();
        s.save().unwrap();
        assert_eq!(std::fs::read_to_string(ro.join("p.json.v1")).unwrap(), v1);
        assert!(std::fs::read_to_string(ro.join("p.json")).unwrap().contains("Renamed"));
        s.save().unwrap();
        assert!(!ro.join("p.json.v1.1").exists(), "kept once");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_item_missing_at_migration_is_hashed_when_its_file_appears() {
        let dir = temp();
        std::fs::write(dir.join("p.json"), r#"{"version":1,"playlists":[{"id":"1","name":"Set","presets":["a/later.milk"]}]}"#).unwrap();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        assert_eq!(s.lists[0].presets[0].hash, None);
        assert!(!s.hash_missing());
        std::fs::write(dir.join("lib/a/later.milk"), "[preset00]\n").unwrap();
        assert!(s.hash_missing());
        assert_eq!(s.lists[0].presets[0].hash.as_deref(), Some(engine::index::hash(b"[preset00]\n").as_str()));
        assert_eq!(s.lists[0].presets[0].size, Some(11));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn hand_edited_settings_are_brought_within_limits_on_open() {
        let dir = temp();
        let file = r#"{"version":2,"playlists":[{"id":"1","name":"S","kind":"manual",
            "settings":{"change":{"unit":"seconds","every":0},"speed":99,"transition":-1,"trails":2,"hue":-3},"presets":[]},
            {"id":"2","name":"B","settings":{"change":{"unit":"bars","every":0}}}]}"#;
        std::fs::write(dir.join("p.json"), file).unwrap();
        let s = Store::open(dir.join("p.json"), dir.join("lib"));
        let one = s.lists[0].settings;
        assert_eq!((one.change, one.speed, one.transition, one.trails, one.hue), (Change::Seconds { every: 1.0 }, 4.0, 0.0, 1.0, 0.0));
        assert_eq!(s.lists[1].settings.change, Change::Bars { every: 1 });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn import_refuses_paths_outside_the_library_and_export_never_names_the_home() {
        let dir = temp();
        let mut s = Store::open(dir.join("p.json"), dir.join("lib"));
        let file = |path: &str| format!(r#"{{"format":"{SHARED_FORMAT}","version":1,"name":"x","items":[{{"path":"a/one.milk"}},{{"path":{}}}]}}"#, serde_json::to_string(path).unwrap());
        for bad in ["/dev/zero", "/etc/passwd", "../outside.milk", "a/../../outside.milk", "./a/one.milk", ""] {
            assert!(s.import(&file(bad)).is_err(), "{bad}");
        }
        assert!(s.lists.is_empty());
        s.import(&file("a/b/fine.milk")).unwrap();
        assert_eq!(s.lists[0].presets, ["a/one.milk", "a/b/fine.milk"]);

        // A preset outside the library goes out by its name and hash only.
        let outside = dir.join("home/user/Secret/far.milk");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(&outside, "[preset00]\n").unwrap();
        let a = s.create("a").unwrap();
        s.add(&a, &outside, None).unwrap();
        let text = s.export(&a).unwrap().text;
        assert!(!text.contains("home/user"), "{text}");
        let shared: Shared = serde_json::from_str(&text).unwrap();
        assert_eq!(shared.items, [SharedItem { path: "far.milk".into(), hash: Some(engine::index::hash(b"[preset00]\n")) }]);
        // And comes back in as that, to be found by its hash.
        let b = s.import(&text).unwrap();
        assert_eq!(s.find(&b).unwrap().presets[0].hash, shared.items[0].hash);

        // A smart playlist's file keeps no items.
        let smart = format!(r#"{{"format":"{SHARED_FORMAT}","version":1,"name":"s","kind":"smart","query":{{"text":"warm"}},"items":[{{"path":"a/one.milk"}}]}}"#);
        let id = s.import(&smart).unwrap();
        assert!(s.find(&id).unwrap().presets.is_empty());
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
