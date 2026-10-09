//! What the user keeps about presets: ★, their own tags, hidden ("never play"),
//! and overrides of the automatic groups the index gives a preset
//! ([`crate::catalog`]). Kept per preset by its key (folder-relative path,
//! `cream-of-the-crop/Dancer/…/x.milk`), for the presets the user has touched
//! only.
//!
//! The file is `~/.openflow/visuals/library.json` (`OPENFLOW_VISUALS_LIBRARY`
//! overrides), versioned:
//!
//! ```json
//! { "version": 1,
//!   "presets": {
//!     "cream-of-the-crop/Dancer/Whirl/ORB - Xenon.milk": {
//!       "hash": "<SHA-256 of the file, hex>",
//!       "star": true, "tags": ["warm up"], "hidden": false,
//!       "overrides": { "style": "Hypnotic", "speed": "low" } } } }
//! ```
//!
//! Every field of a preset but the key may be left out (false, empty, none).
//! `hash` lets a preset that moved be found again by its content. The file is
//! written through a temporary file and renamed into place; one that won't
//! parse is moved aside (`library.json.bad`) rather than overwritten, as
//! `playlists.rs` does; so is one of a newer version than this app knows. Each
//! change goes out to the page as [`CHANGED`].
//!
//! A preset whose key is gone (the user reorganised the folder) is found again
//! by its hash among the presets no data is kept for, by the hashes the packs'
//! `index.json` give (the file's own, for one no index lists): its data moves
//! to the new key, and so do playlist items naming the old one. This is done
//! the first time the data is asked for and again after the presets change
//! ([`crate::pack::CHANGED`]).
//!
//! Hidden presets are kept out of random and auto-advance ([`playable`]); a
//! playlist the user built still plays them.

use crate::playlists::Playlist;
use engine::index::{Index, Level};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};
use tauri::{AppHandle, Emitter, Listener, Manager, State};

/// The event a change goes out on, the whole [`LibraryData`] each time.
pub const CHANGED: &str = "library-changed";

/// The file format's version.
pub const VERSION: u32 = 1;

/// The user's own values for a preset's automatic groups; `None` keeps the index's.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Overrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Hues in degrees, the strongest first (the colour group).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hues: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intensity: Option<Level>,
}

impl Overrides {
    fn is_empty(&self) -> bool {
        *self == Overrides::default()
    }

    /// Takes each value `other` sets.
    fn merge(&mut self, other: Overrides) {
        fn take<T>(into: &mut Option<T>, from: Option<T>) {
            if from.is_some() {
                *into = from;
            }
        }
        take(&mut self.style, other.style);
        take(&mut self.sub_style, other.sub_style);
        take(&mut self.authors, other.authors);
        take(&mut self.title, other.title);
        take(&mut self.hues, other.hues);
        take(&mut self.brightness, other.brightness);
        take(&mut self.speed, other.speed);
        take(&mut self.intensity, other.intensity);
    }
}

/// What the user keeps about one preset.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Mine {
    /// The file's content hash when last touched, to find it again if it moves.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub star: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Never played by random or auto-advance, and shown only when asked for.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Overrides::is_empty")]
    pub overrides: Overrides,
}

impl Mine {
    fn is_empty(&self) -> bool {
        !self.star && !self.hidden && self.tags.is_empty() && self.overrides.is_empty()
    }
}

/// `library.json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LibraryData {
    pub version: u32,
    /// By key; only presets the user has touched.
    pub presets: BTreeMap<String, Mine>,
}

impl Default for LibraryData {
    fn default() -> Self {
        LibraryData { version: VERSION, presets: BTreeMap::new() }
    }
}

/// One change, made to each preset [`library_set`] is given. A field left out
/// changes nothing.
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Change {
    pub star: Option<bool>,
    pub hidden: Option<bool>,
    /// Tags to add (once each) and to take off.
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    /// Drop the preset's overrides before `overrides` is applied.
    pub clear_overrides: bool,
    /// Values to set; the ones left out stay as they are.
    pub overrides: Option<Overrides>,
}

/// Applies `change` to the presets at `keys`. A preset left with nothing kept is dropped.
pub fn apply(data: &mut LibraryData, keys: &[String], change: &Change) {
    for key in keys {
        let mine = data.presets.entry(key.clone()).or_default();
        if let Some(star) = change.star {
            mine.star = star;
        }
        if let Some(hidden) = change.hidden {
            mine.hidden = hidden;
        }
        mine.tags.retain(|t| !change.remove_tags.contains(t));
        for t in &change.add_tags {
            if !mine.tags.contains(t) {
                mine.tags.push(t.clone());
            }
        }
        if change.clear_overrides {
            mine.overrides = Overrides::default();
        }
        if let Some(o) = &change.overrides {
            mine.overrides.merge(o.clone());
        }
        if mine.is_empty() {
            data.presets.remove(key);
        }
    }
}

/// Reads `file`: a missing one is no data; one that won't parse, or is of a
/// newer version, is moved aside (`library.json.bad`) and reads as no data.
pub fn load(file: &Path) -> LibraryData {
    let Ok(bytes) = std::fs::read(file) else { return LibraryData::default() };
    let problem = match serde_json::from_slice::<LibraryData>(&bytes) {
        Ok(data) if data.version <= VERSION => return LibraryData { version: VERSION, ..data },
        Ok(data) => format!("is version {}, newer than {VERSION}", data.version),
        Err(e) => format!("does not parse ({e})"),
    };
    let aside = aside(file);
    eprintln!("library: {} {problem}; moved to {}", file.display(), aside.display());
    let _ = std::fs::rename(file, &aside);
    LibraryData::default()
}

/// Where an unreadable `file` is moved: `library.json.bad`.
fn aside(file: &Path) -> PathBuf {
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(".bad");
    file.with_file_name(name)
}

/// Writes `data` to `file` through a temporary file renamed into place, so a
/// crash never leaves half of one.
pub fn save(file: &Path, data: &LibraryData) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    let mut tmp = file.file_name().unwrap_or_default().to_os_string();
    tmp.push(".tmp");
    let tmp = file.with_file_name(tmp);
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// The user's library data, managed by Tauri beside `crate::App`.
pub struct Store {
    file: PathBuf,
    data: Mutex<LibraryData>,
    /// Whether moved presets have been looked for since the presets last changed.
    matched: AtomicBool,
    listening: Once,
}

impl Store {
    /// The data kept in `file` ([`load`]).
    pub fn open(file: PathBuf) -> Store {
        let data = load(&file);
        Store { file, data: Mutex::new(data), matched: AtomicBool::new(false), listening: Once::new() }
    }
}

/// Where the library data lives unless `OPENFLOW_VISUALS_LIBRARY` says otherwise.
pub fn default_file() -> PathBuf {
    std::env::var_os("OPENFLOW_VISUALS_LIBRARY").map(PathBuf::from).unwrap_or_else(|| crate::settings::dir().join("library.json"))
}

/// A preset's key: its path relative to the first of `folders` it is in, `/`-separated.
fn key_in(folders: &[PathBuf], path: &Path) -> Option<String> {
    let rel = folders.iter().find_map(|f| path.strip_prefix(f).ok())?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}

/// `all` but the presets `data` hides, keyed against `folders`.
fn playable_in(folders: &[PathBuf], data: &LibraryData, all: Vec<PathBuf>) -> Vec<PathBuf> {
    let hidden: HashSet<&str> = data.presets.iter().filter(|(_, m)| m.hidden).map(|(k, _)| k.as_str()).collect();
    if hidden.is_empty() {
        return all;
    }
    all.into_iter().filter(|p| key_in(folders, p).is_none_or(|k| !hidden.contains(k.as_str()))).collect()
}

/// The presets random and auto-advance may choose from the library's `all`:
/// all but the hidden ones.
pub fn playable(handle: &AppHandle, all: Vec<PathBuf>) -> Vec<PathBuf> {
    let store = handle.state::<Store>();
    rematch_once(handle, &store);
    let data = store.data.lock().unwrap();
    playable_in(&crate::pack::folders(handle), &data, all)
}

/// Every preset in `folders` by key (the first folder's wins), with the hashes
/// their packs' `index.json` give.
fn presets_in(folders: &[PathBuf]) -> (BTreeMap<String, PathBuf>, HashMap<String, String>) {
    let mut existing = BTreeMap::new();
    for file in crate::pack::milk_files_in(folders) {
        if let Some(key) = key_in(folders, &file) {
            existing.entry(key).or_insert(file);
        }
    }
    let mut indexed = HashMap::new();
    for folder in folders {
        for pack in std::fs::read_dir(folder).into_iter().flatten().flatten().filter(|e| e.path().is_dir()) {
            let name = pack.file_name().to_string_lossy().into_owned();
            for row in Index::load(&pack.path().join("index.json")).map(|i| i.rows).unwrap_or_default() {
                indexed.entry(format!("{name}/{}", row.path)).or_insert(row.hash);
            }
        }
    }
    (existing, indexed)
}

/// Moves the data of each preset whose key is no longer among `existing` to a
/// key that is, holds a file of the same hash, and has no data of its own (the
/// first such by key). `indexed` gives hashes by key; a preset it doesn't list
/// is hashed from its file. Data that finds no new home stays where it is (its
/// folder may only be away for now). Returns the moves, old key to new.
fn rematch(data: &mut LibraryData, existing: &BTreeMap<String, PathBuf>, indexed: &HashMap<String, String>) -> Vec<(String, String)> {
    let lost: Vec<(String, String)> = data.presets.iter().filter(|(k, _)| !existing.contains_key(*k)).filter_map(|(k, m)| Some((k.clone(), m.hash.clone()?))).collect();
    if lost.is_empty() {
        return Vec::new();
    }
    let wanted: HashSet<&str> = lost.iter().map(|(_, h)| h.as_str()).collect();
    let mut free: HashMap<String, Vec<String>> = HashMap::new();
    for (key, file) in existing {
        if data.presets.contains_key(key) {
            continue;
        }
        let hash = match indexed.get(key) {
            Some(h) if !h.is_empty() => h.clone(),
            _ => match std::fs::read(file) {
                Ok(bytes) => engine::index::hash(&bytes),
                Err(_) => continue,
            },
        };
        if wanted.contains(hash.as_str()) {
            free.entry(hash).or_default().push(key.clone());
        }
    }
    let mut moves = Vec::new();
    for (old, hash) in lost {
        let Some(keys) = free.get_mut(&hash) else { continue };
        if keys.is_empty() {
            continue;
        }
        let new = keys.remove(0);
        let mine = data.presets.remove(&old).expect("a lost key is in the data");
        data.presets.insert(new.clone(), mine);
        moves.push((old, new));
    }
    moves
}

/// Points playlist items at the keys presets moved to. Returns whether any changed.
fn follow(lists: &mut [Playlist], moves: &[(String, String)]) -> bool {
    let to: HashMap<&str, &str> = moves.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let mut changed = false;
    for item in lists.iter_mut().flat_map(|l| l.presets.iter_mut()) {
        if let Some(new) = to.get(item.as_str()) {
            *item = new.to_string();
            changed = true;
        }
    }
    changed
}

/// Looks for moved presets ([`rematch`]) unless done since the presets last
/// changed; keeps and announces what moved, and moves playlist items with them.
fn rematch_once(handle: &AppHandle, store: &Store) {
    store.listening.call_once(|| {
        let h = handle.clone();
        handle.listen_any(crate::pack::CHANGED, move |_| h.state::<Store>().matched.store(false, Ordering::SeqCst));
    });
    if store.matched.swap(true, Ordering::SeqCst) {
        return;
    }
    let (existing, indexed) = presets_in(&crate::pack::folders(handle));
    let (moves, data) = {
        let mut data = store.data.lock().unwrap();
        let moves = rematch(&mut data, &existing, &indexed);
        if !moves.is_empty() {
            if let Err(e) = save(&store.file, &data) {
                eprintln!("library: saving {} failed: {e}", store.file.display());
            }
        }
        (moves, data.clone())
    };
    if moves.is_empty() {
        return;
    }
    for (old, new) in &moves {
        eprintln!("library: {old} moved to {new}");
    }
    let _ = handle.emit(CHANGED, &data);
    if let Some(deck) = handle.try_state::<crate::actions::Deck>() {
        let mut lists = deck.store.lock().unwrap();
        if follow(&mut lists.lists, &moves) {
            if let Err(e) = lists.save() {
                eprintln!("library: saving playlists failed: {e}");
            }
            deck.live.lock().unwrap().resync(&lists);
        }
    }
}

/// Everything the user keeps about presets.
#[tauri::command]
pub fn library_data(store: State<Store>, handle: AppHandle) -> LibraryData {
    rematch_once(&handle, &store);
    store.data.lock().unwrap().clone()
}

/// Make `change` to each preset at `keys` (folder-relative, as
/// [`crate::catalog::Row::key`]), keep it, and tell the page ([`CHANGED`]).
/// Each preset's hash is taken from its file now, to find it again if it moves.
#[tauri::command]
pub fn library_set(keys: Vec<String>, change: Change, store: State<Store>, handle: AppHandle) -> Result<LibraryData, String> {
    rematch_once(&handle, &store);
    let folders = crate::pack::folders(&handle);
    let data = {
        let mut data = store.data.lock().unwrap();
        apply(&mut data, &keys, &change);
        stamp(&mut data, &keys, &folders);
        save(&store.file, &data)?;
        data.clone()
    };
    handle.emit(CHANGED, &data).map_err(|e| e.to_string())?;
    Ok(data)
}

/// Records the content hash of each of `keys` still kept, from its file in `folders`.
fn stamp(data: &mut LibraryData, keys: &[String], folders: &[PathBuf]) {
    for key in keys {
        let Some(mine) = data.presets.get_mut(key) else { continue };
        if let Ok(bytes) = std::fs::read(crate::pack::resolve_in(folders, Path::new(key))) {
            mine.hash = Some(engine::index::hash(&bytes));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_apply_to_each_key_and_untouched_presets_drop_out() {
        let mut data = LibraryData::default();
        let keys = ["a.milk".to_string(), "b.milk".to_string()];
        apply(&mut data, &keys, &Change { star: Some(true), add_tags: vec!["warm".into(), "warm".into()], ..Default::default() });
        assert_eq!(data.presets["a.milk"], Mine { star: true, tags: vec!["warm".into()], ..Default::default() });
        apply(&mut data, &keys[..1], &Change { overrides: Some(Overrides { speed: Some(Level::Low), ..Default::default() }), ..Default::default() });
        apply(&mut data, &keys[..1], &Change { overrides: Some(Overrides { style: Some("Hypnotic".into()), ..Default::default() }), ..Default::default() });
        assert_eq!(data.presets["a.milk"].overrides, Overrides { speed: Some(Level::Low), style: Some("Hypnotic".into()), ..Default::default() });
        apply(&mut data, &keys, &Change { star: Some(false), remove_tags: vec!["warm".into()], ..Default::default() });
        assert!(!data.presets.contains_key("b.milk"));
        apply(&mut data, &keys[..1], &Change { clear_overrides: true, ..Default::default() });
        assert!(data.presets.is_empty());
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("visuals-userlib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(file: &Path, contents: &[u8]) {
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, contents).unwrap();
    }

    #[test]
    fn data_saves_and_loads_through_a_temporary_file() {
        let dir = temp("save");
        let file = dir.join("nested/library.json");
        assert_eq!(load(&file), LibraryData::default());
        let mut data = LibraryData::default();
        apply(&mut data, &["p/a.milk".into()], &Change { hidden: Some(true), add_tags: vec!["warm up".into()], ..Default::default() });
        data.presets.get_mut("p/a.milk").unwrap().hash = Some("ab".into());
        save(&file, &data).unwrap();
        assert!(!dir.join("nested/library.json.tmp").exists());
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"version\": 1"), "{text}");
        assert_eq!(load(&file), data);
        // An older file without newer fields still reads, as this version.
        std::fs::write(&file, r#"{ "version": 0, "presets": { "x.milk": { "star": true } } }"#).unwrap();
        let old = load(&file);
        assert_eq!((old.version, old.presets["x.milk"].star), (VERSION, true));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_corrupt_or_newer_file_is_moved_aside_not_lost() {
        let dir = temp("corrupt");
        let file = dir.join("library.json");
        std::fs::write(&file, "{ not json").unwrap();
        assert_eq!(load(&file), LibraryData::default());
        assert!(!file.exists());
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad")).unwrap(), "{ not json");
        let newer = r#"{ "version": 99, "presets": {} }"#;
        std::fs::write(&file, newer).unwrap();
        assert_eq!(load(&file), LibraryData::default());
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad")).unwrap(), newer);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn overrides_merge_and_clear() {
        let mut data = LibraryData::default();
        let key = ["a.milk".to_string()];
        let set = |o: Overrides| Change { overrides: Some(o), ..Default::default() };
        apply(&mut data, &key, &set(Overrides { style: Some("Hypnotic".into()), hues: Some(vec![30, 200]), ..Default::default() }));
        apply(&mut data, &key, &set(Overrides { style: Some("Dancer".into()), intensity: Some(Level::High), ..Default::default() }));
        assert_eq!(data.presets["a.milk"].overrides, Overrides { style: Some("Dancer".into()), hues: Some(vec![30, 200]), intensity: Some(Level::High), ..Default::default() });
        // Clearing then setting leaves only what is set.
        apply(&mut data, &key, &Change { clear_overrides: true, overrides: Some(Overrides { title: Some("Mine".into()), ..Default::default() }), ..Default::default() });
        assert_eq!(data.presets["a.milk"].overrides, Overrides { title: Some("Mine".into()), ..Default::default() });
        apply(&mut data, &key, &Change { clear_overrides: true, ..Default::default() });
        assert!(data.presets.is_empty());
    }

    #[test]
    fn moved_presets_are_found_again_by_hash_and_playlists_follow() {
        let root = temp("rematch");
        let (presets, starter) = (root.join("presets"), root.join("starter"));
        // An indexed pack whose preset the user moved to another style folder.
        let moved = b"[preset00]\nzoom=1.01\n";
        put(&presets.join("pack/Sparkle/a.milk"), moved);
        let mut index = Index::new(90);
        index.rows.push(engine::index::row(Path::new("Sparkle/a.milk"), engine::index::hash(moved)));
        index.save(&presets.join("pack/index.json")).unwrap();
        // An unindexed one, moved out of its pack; and a twin that already has data.
        let loose = b"[preset00]\nzoom=0.9\n";
        put(&starter.join("loose.milk"), loose);
        put(&starter.join("twin.milk"), loose);
        let folders = vec![presets.clone(), starter.clone()];

        let mine = |hash: &[u8], star: bool| Mine { hash: Some(engine::index::hash(hash)), star, ..Default::default() };
        let mut data = LibraryData::default();
        data.presets.insert("pack/Dancer/a.milk".into(), mine(moved, true));
        data.presets.insert("old/loose.milk".into(), mine(loose, true));
        data.presets.insert("twin.milk".into(), mine(loose, false));
        data.presets.insert("away/gone.milk".into(), mine(b"nothing like it", true));
        data.presets.insert("away/unhashed.milk".into(), Mine { star: true, ..Default::default() });

        let (existing, indexed) = presets_in(&folders);
        let mut moves = rematch(&mut data, &existing, &indexed);
        moves.sort();
        assert_eq!(moves, [("old/loose.milk".to_string(), "loose.milk".to_string()), ("pack/Dancer/a.milk".to_string(), "pack/Sparkle/a.milk".to_string())]);
        assert!(data.presets["pack/Sparkle/a.milk"].star);
        assert!(data.presets["loose.milk"].star);
        assert!(!data.presets["twin.milk"].star);
        assert!(data.presets.contains_key("away/gone.milk") && data.presets.contains_key("away/unhashed.milk"));
        // Nothing more to move the second time.
        assert!(rematch(&mut data, &existing, &indexed).is_empty());

        let mut lists = vec![Playlist { id: "1".into(), name: "set".into(), presets: vec!["pack/Dancer/a.milk".into(), "twin.milk".into(), "pack/Dancer/a.milk".into()] }];
        assert!(follow(&mut lists, &moves));
        assert_eq!(lists[0].presets, ["pack/Sparkle/a.milk", "twin.milk", "pack/Sparkle/a.milk"]);
        assert!(!follow(&mut lists, &moves));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hidden_presets_are_not_playable_in_either_folder() {
        let (presets, starter) = (PathBuf::from("/lib/presets"), PathBuf::from("/app/starter"));
        let folders = vec![presets.clone(), starter.clone()];
        let all = vec![presets.join("pack/A/one.milk"), presets.join("pack/A/two.milk"), starter.join("pack/B/three.milk"), starter.join("pack/B/four.milk"), PathBuf::from("/elsewhere/five.milk")];
        let mut data = LibraryData::default();
        assert_eq!(playable_in(&folders, &data, all.clone()), all);
        apply(&mut data, &["pack/A/two.milk".into(), "pack/B/four.milk".into()], &Change { hidden: Some(true), ..Default::default() });
        apply(&mut data, &["pack/A/one.milk".into()], &Change { star: Some(true), ..Default::default() });
        assert_eq!(playable_in(&folders, &data, all.clone()), [all[0].clone(), all[2].clone(), all[4].clone()]);
    }

    #[test]
    fn the_file_format_reads_as_documented() {
        let text = r#"{ "version": 1, "presets": { "cream-of-the-crop/Dancer/x.milk": { "hash": "ab", "star": true, "tags": ["warm up"], "overrides": { "style": "Hypnotic", "speed": "low" } } } }"#;
        let data: LibraryData = serde_json::from_str(text).unwrap();
        let mine = &data.presets["cream-of-the-crop/Dancer/x.milk"];
        assert_eq!((mine.star, mine.hidden, mine.overrides.speed), (true, false, Some(Level::Low)));
        let back = serde_json::to_value(&data).unwrap();
        assert_eq!(back, serde_json::from_str::<serde_json::Value>(text).unwrap());
    }
}
