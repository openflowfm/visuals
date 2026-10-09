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
//! `hash` (and `size`, the file's bytes) lets a preset that moved be found
//! again by its content. The file is written through a temporary file and
//! renamed into place; one that won't parse is moved aside (`library.json.bad`,
//! then `.bad.1`, …) rather than overwritten, as `playlists.rs` does; so is one
//! of a newer version than this app knows. One that can't be read for another
//! reason is left alone: changes are then kept in memory only. Each change goes
//! out to the page as [`CHANGED`].
//!
//! A preset whose key has been gone a while ([`GRACE`]; the user reorganised
//! the folder) is found again by its hash among the presets no data is kept
//! for, by the hashes the packs' `index.json` give (the file's own, for one no
//! index lists): when exactly one preset has it, its data moves to that key,
//! and so do playlist items naming the old one. This runs on its own thread the
//! first time the data is asked for and again after the presets change
//! ([`crate::pack::CHANGED`]); a key looked for in vain isn't looked for again
//! until the presets change (`library.searched.json`).
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
use std::time::{Duration, Instant, SystemTime};
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
    /// The file's size in bytes then, so only files of that size are hashed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
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
/// newer version, is moved aside (`library.json.bad`, then `.bad.1`, …) and
/// reads as no data. Any other failure to read it is an error, and the file is
/// left alone.
pub fn load(file: &Path) -> Result<LibraryData, String> {
    let bytes = match std::fs::read(file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(LibraryData::default()),
        Err(e) => return Err(format!("couldn't read {}: {e}", file.display())),
    };
    let problem = match serde_json::from_slice::<LibraryData>(&bytes) {
        Ok(data) if data.version <= VERSION => return Ok(LibraryData { version: VERSION, ..data }),
        Ok(data) => format!("is version {}, newer than {VERSION}", data.version),
        Err(e) => format!("does not parse ({e})"),
    };
    let aside = aside(file);
    eprintln!("library: {} {problem}; moved to {}", file.display(), aside.display());
    let _ = std::fs::rename(file, &aside);
    Ok(LibraryData::default())
}

/// Where an unreadable `file` is moved: `library.json.bad`, or the first of
/// `library.json.bad.1`, `.bad.2`, … not taken, so no earlier one is lost.
fn aside(file: &Path) -> PathBuf {
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(".bad");
    let first = file.with_file_name(&name);
    if !first.exists() {
        return first;
    }
    (1..)
        .map(|n| {
            let mut numbered = name.clone();
            numbered.push(format!(".{n}"));
            file.with_file_name(numbered)
        })
        .find(|p| !p.exists())
        .expect("some number is free")
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
    /// Why the file couldn't be read, when it couldn't: the data is then kept in
    /// memory only, and nothing is saved over the file.
    broken: Option<String>,
    /// Looks for moved presets, on its own thread ([`rematch_once`]).
    matcher: Mutex<Matcher>,
    /// Whether moved presets have been looked for since the presets last changed.
    matched: AtomicBool,
    /// Whether a look is running.
    running: AtomicBool,
    listening: Once,
}

impl Store {
    /// The data kept in `file` ([`load`]).
    pub fn open(file: PathBuf) -> Store {
        let (data, broken) = match load(&file) {
            Ok(data) => (data, None),
            Err(e) => {
                eprintln!("library: {e}; keeping changes in memory only, not saving over it");
                (LibraryData::default(), Some(e))
            }
        };
        let matcher = Matcher::open(searched_file(&file));
        Store { file, data: Mutex::new(data), broken, matcher: Mutex::new(matcher), matched: AtomicBool::new(false), running: AtomicBool::new(false), listening: Once::new() }
    }

    /// Saves `data`, unless the file couldn't be read ([`Store::broken`]).
    fn save(&self, data: &LibraryData) -> Result<(), String> {
        match &self.broken {
            Some(e) => Err(format!("{e}; not saving over it")),
            None => save(&self.file, data),
        }
    }
}

/// Where the keys searched for in vain are kept, beside `file`: `library.searched.json`.
fn searched_file(file: &Path) -> PathBuf {
    file.with_extension("searched.json")
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

/// How long a kept preset must have been missing before its data is moved: a
/// file only briefly away (mid-download) keeps its data.
const GRACE: Duration = Duration::from_secs(5);

/// The kept presets with a hash whose file is in none of `folders`: a stat each,
/// no walk.
fn lost_in(data: &LibraryData, folders: &[PathBuf]) -> Vec<String> {
    data.presets.iter().filter(|(k, m)| m.hash.is_some() && !folders.iter().any(|f| f.join(k.as_str()).exists())).map(|(k, _)| k.clone()).collect()
}

/// Every preset in `folders` by key (the first folder's wins) with its file and
/// size, the hashes their packs' `index.json` give, and a signature of the lot
/// (every key and size), which changes when the presets do.
#[allow(clippy::type_complexity)]
fn presets_in(folders: &[PathBuf]) -> (BTreeMap<String, (PathBuf, u64)>, HashMap<String, String>, String) {
    let mut existing = BTreeMap::new();
    for file in crate::pack::milk_files_in(folders) {
        if let Some(key) = key_in(folders, &file) {
            let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            existing.entry(key).or_insert((file, size));
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
    let listing: String = existing.iter().map(|(k, (_, size))| format!("{k}\t{size}\n")).collect();
    (existing, indexed, engine::index::hash(listing.as_bytes()))
}

/// What one look for moved presets found.
#[derive(Default, Debug, PartialEq)]
struct Pass {
    /// Old key to new.
    moves: Vec<(String, String)>,
    /// Whether some missing preset is still in its [`GRACE`], so worth another look.
    again: bool,
}

/// Finds presets whose key is gone by their hash, remembering what it has
/// hashed (by path, size and modified time) and which keys it looked for in
/// vain (kept beside the library file, until the presets change).
#[derive(Default)]
struct Matcher {
    /// When each missing key was first seen missing.
    first_missing: HashMap<String, Instant>,
    hashes: HashMap<PathBuf, (u64, SystemTime, String)>,
    /// Key to the presets' signature when it was looked for and not found once.
    searched: BTreeMap<String, String>,
    file: Option<PathBuf>,
    /// Files hashed so far.
    hashed: usize,
}

impl Matcher {
    fn open(file: PathBuf) -> Matcher {
        let searched = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Matcher { searched, file: Some(file), ..Default::default() }
    }

    /// One look, at `now`: data whose key has been missing for at least
    /// [`GRACE`] moves to the one preset of the same hash that has no data of
    /// its own, when there is exactly one. Nothing is walked or hashed when no
    /// kept preset is missing.
    fn pass(&mut self, data: &LibraryData, folders: &[PathBuf], now: Instant) -> Pass {
        let lost = lost_in(data, folders);
        self.first_missing.retain(|k, _| lost.contains(k));
        let searched = self.searched.len();
        self.searched.retain(|k, _| lost.contains(k));
        if lost.is_empty() {
            self.keep_searched(searched);
            return Pass::default();
        }
        let (existing, indexed, signature) = presets_in(folders);
        let mut again = false;
        let mut ready = Vec::new();
        for key in lost {
            if self.searched.get(&key) == Some(&signature) {
                continue;
            }
            let first = *self.first_missing.entry(key.clone()).or_insert(now);
            if now.duration_since(first) >= GRACE {
                ready.push(key);
            } else {
                again = true;
            }
        }
        if ready.is_empty() {
            self.keep_searched(searched);
            return Pass { moves: Vec::new(), again };
        }
        let wanted: Vec<(&str, &str, Option<u64>)> = ready.iter().map(|k| (k.as_str(), data.presets[k].hash.as_deref().unwrap_or_default(), data.presets[k].size)).collect();
        let found = self.candidates(&wanted, data, &existing, &indexed);
        let mut per_hash: HashMap<&str, usize> = HashMap::new();
        for (_, hash, _) in &wanted {
            *per_hash.entry(hash).or_default() += 1;
        }
        let mut moves = Vec::new();
        for (key, hash, _) in &wanted {
            match found.get(*hash) {
                Some(keys) if keys.len() == 1 && per_hash[*hash] == 1 => {
                    self.first_missing.remove(*key);
                    moves.push((key.to_string(), keys[0].clone()));
                }
                _ => {
                    self.searched.insert(key.to_string(), signature.clone());
                }
            }
        }
        self.keep_searched(usize::MAX);
        Pass { moves, again }
    }

    /// The presets with no data of their own holding each hash `wanted` asks
    /// for, at most two each (two is already too many to choose from). Index
    /// hashes cost nothing; other files are hashed only when their size could
    /// match, and only until each hash has two or the files run out.
    fn candidates(&mut self, wanted: &[(&str, &str, Option<u64>)], data: &LibraryData, existing: &BTreeMap<String, (PathBuf, u64)>, indexed: &HashMap<String, String>) -> HashMap<String, Vec<String>> {
        let hashes: HashSet<&str> = wanted.iter().map(|(_, h, _)| *h).collect();
        let sizes: Option<HashSet<u64>> = wanted.iter().map(|(_, _, s)| *s).collect();
        let mut found: HashMap<String, Vec<String>> = HashMap::new();
        for (key, (file, size)) in existing {
            if hashes.iter().all(|h| found.get(*h).is_some_and(|v| v.len() >= 2)) {
                break;
            }
            if data.presets.contains_key(key) {
                continue;
            }
            let hash = match indexed.get(key) {
                Some(h) if !h.is_empty() => h.clone(),
                _ => {
                    if sizes.as_ref().is_some_and(|s| !s.contains(size)) {
                        continue;
                    }
                    let Some(h) = self.hash_of(file, *size) else { continue };
                    h
                }
            };
            if hashes.contains(hash.as_str()) {
                let keys = found.entry(hash).or_default();
                if keys.len() < 2 {
                    keys.push(key.clone());
                }
            }
        }
        found
    }

    /// `file`'s hash, from the cache while its size and modified time are as they were.
    fn hash_of(&mut self, file: &Path, size: u64) -> Option<String> {
        let modified = std::fs::metadata(file).and_then(|m| m.modified()).ok()?;
        if let Some((s, m, h)) = self.hashes.get(file) {
            if *s == size && *m == modified {
                return Some(h.clone());
            }
        }
        let bytes = std::fs::read(file).ok()?;
        self.hashed += 1;
        let hash = engine::index::hash(&bytes);
        self.hashes.insert(file.to_path_buf(), (size, modified, hash.clone()));
        Some(hash)
    }

    /// Writes the keys searched in vain when they changed from `before` entries.
    fn keep_searched(&self, before: usize) {
        if before == self.searched.len() && before != usize::MAX {
            return;
        }
        let Some(file) = &self.file else { return };
        let text = serde_json::to_string(&self.searched).unwrap_or_default();
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = std::fs::write(file, text) {
            eprintln!("library: saving {} failed: {e}", file.display());
        }
    }
}

/// Moves the data at each old key of `moves` to its new key.
fn move_data(data: &mut LibraryData, moves: &[(String, String)]) {
    for (old, new) in moves {
        if let Some(mine) = data.presets.remove(old) {
            data.presets.insert(new.clone(), mine);
        }
    }
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

/// Keeps `moves` that still hold: playlists first, so a crash between the two
/// saves leaves the library data at its old key, to be matched again, and
/// never playlists naming a key the data has left. Moves whose old key has
/// gone or whose new key has data since are dropped. Playlists that won't save
/// are put back and nothing moves. Returns the moves made and whether
/// playlists changed.
fn commit(store: &Store, lists: Option<&mut crate::playlists::Store>, moves: Vec<(String, String)>) -> Result<(Vec<(String, String)>, bool), String> {
    let mut data = store.data.lock().unwrap();
    let moves: Vec<_> = moves.into_iter().filter(|(old, new)| data.presets.contains_key(old) && !data.presets.contains_key(new)).collect();
    if moves.is_empty() {
        return Ok((moves, false));
    }
    let mut followed = false;
    if let Some(lists) = lists {
        let before = lists.lists.clone();
        if follow(&mut lists.lists, &moves) {
            if let Err(e) = lists.save() {
                lists.lists = before;
                return Err(format!("saving playlists failed: {e}"));
            }
            followed = true;
        }
    }
    let before = data.clone();
    move_data(&mut data, &moves);
    if let Err(e) = store.save(&data) {
        *data = before;
        return Err(format!("saving {} failed: {e}", store.file.display()));
    }
    Ok((moves, followed))
}

/// Starts a look for moved presets on its own thread unless one ran since the
/// presets last changed or one is running; never waits for it. What it finds
/// is kept and announced: [`CHANGED`], and the playlists that followed
/// ([`crate::actions::LISTS`]).
fn rematch_once(handle: &AppHandle, store: &Store) {
    store.listening.call_once(|| {
        let h = handle.clone();
        handle.listen_any(crate::pack::CHANGED, move |_| h.state::<Store>().matched.store(false, Ordering::SeqCst));
    });
    if store.running.swap(true, Ordering::SeqCst) {
        return;
    }
    if store.matched.swap(true, Ordering::SeqCst) {
        store.running.store(false, Ordering::SeqCst);
        return;
    }
    let handle = handle.clone();
    std::thread::spawn(move || {
        let store = handle.state::<Store>();
        let folders = crate::pack::folders(&handle);
        loop {
            let data = store.data.lock().unwrap().clone();
            let pass = store.matcher.lock().unwrap().pass(&data, &folders, Instant::now());
            if !pass.moves.is_empty() {
                announce(&handle, &store, pass.moves);
            }
            if !pass.again {
                break;
            }
            std::thread::sleep(GRACE);
        }
        store.running.store(false, Ordering::SeqCst);
    });
}

/// Keeps `moves` ([`commit`]) and tells the page.
fn announce(handle: &AppHandle, store: &Store, moves: Vec<(String, String)>) {
    let deck = handle.try_state::<crate::actions::Deck>();
    let result = match &deck {
        Some(deck) => {
            let mut lists = deck.store.lock().unwrap();
            let result = commit(store, Some(&mut lists), moves);
            if matches!(result, Ok((_, true))) {
                deck.live.lock().unwrap().resync(&lists);
            }
            result
        }
        None => commit(store, None, moves),
    };
    match result {
        Ok((moves, followed)) => {
            for (old, new) in &moves {
                eprintln!("library: {old} moved to {new}");
            }
            if !moves.is_empty() {
                let _ = handle.emit(CHANGED, &*store.data.lock().unwrap());
            }
            if let (true, Some(deck)) = (followed, deck) {
                let _ = deck.emit_lists(handle);
            }
        }
        Err(e) => eprintln!("library: {e}"),
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
    let data = set(&store, &keys, &change, &crate::pack::folders(&handle))?;
    handle.emit(CHANGED, &data).map_err(|e| e.to_string())?;
    Ok(data)
}

/// [`apply`]s `change` and saves it; one that won't save is undone, so memory
/// and the file agree.
fn set(store: &Store, keys: &[String], change: &Change, folders: &[PathBuf]) -> Result<LibraryData, String> {
    let mut data = store.data.lock().unwrap();
    let before = data.clone();
    apply(&mut data, keys, change);
    stamp(&mut data, keys, folders);
    if let Err(e) = store.save(&data) {
        *data = before;
        return Err(e);
    }
    Ok(data.clone())
}

/// Records the content hash and size of each of `keys` still kept, from its file in `folders`.
fn stamp(data: &mut LibraryData, keys: &[String], folders: &[PathBuf]) {
    for key in keys {
        let Some(mine) = data.presets.get_mut(key) else { continue };
        if let Ok(bytes) = std::fs::read(crate::pack::resolve_in(folders, Path::new(key))) {
            mine.hash = Some(engine::index::hash(&bytes));
            mine.size = Some(bytes.len() as u64);
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
        assert_eq!(load(&file).unwrap(), LibraryData::default());
        let mut data = LibraryData::default();
        apply(&mut data, &["p/a.milk".into()], &Change { hidden: Some(true), add_tags: vec!["warm up".into()], ..Default::default() });
        data.presets.get_mut("p/a.milk").unwrap().hash = Some("ab".into());
        save(&file, &data).unwrap();
        assert!(!dir.join("nested/library.json.tmp").exists());
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"version\": 1"), "{text}");
        assert_eq!(load(&file).unwrap(), data);
        // An older file without newer fields still reads, as this version.
        std::fs::write(&file, r#"{ "version": 0, "presets": { "x.milk": { "star": true } } }"#).unwrap();
        let old = load(&file).unwrap();
        assert_eq!((old.version, old.presets["x.milk"].star), (VERSION, true));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_corrupt_or_newer_file_is_moved_aside_not_lost() {
        let dir = temp("corrupt");
        let file = dir.join("library.json");
        std::fs::write(&file, "{ not json").unwrap();
        assert_eq!(load(&file).unwrap(), LibraryData::default());
        assert!(!file.exists());
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad")).unwrap(), "{ not json");
        let newer = r#"{ "version": 99, "presets": {} }"#;
        std::fs::write(&file, newer).unwrap();
        assert_eq!(load(&file).unwrap(), LibraryData::default());
        // The second bad file goes beside the first, not over it.
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad")).unwrap(), "{ not json");
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad.1")).unwrap(), newer);
        std::fs::write(&file, "[]").unwrap();
        load(&file).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("library.json.bad.2")).unwrap(), "[]");
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

    /// A matcher not keeping what it searched, and the moment `secs` after `t0`.
    fn at(t0: Instant, secs: u64) -> Instant {
        t0 + Duration::from_secs(secs)
    }

    #[test]
    fn moved_presets_are_found_again_by_hash_after_a_grace_and_playlists_follow() {
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

        let mine = |bytes: &[u8], star: bool| Mine { hash: Some(engine::index::hash(bytes)), size: Some(bytes.len() as u64), star, ..Default::default() };
        let mut data = LibraryData::default();
        data.presets.insert("pack/Dancer/a.milk".into(), mine(moved, true));
        data.presets.insert("old/loose.milk".into(), mine(loose, true));
        data.presets.insert("twin.milk".into(), mine(loose, false));
        data.presets.insert("away/gone.milk".into(), mine(b"nothing like it", true));
        data.presets.insert("away/unhashed.milk".into(), Mine { star: true, ..Default::default() });

        let mut matcher = Matcher::default();
        let t0 = Instant::now();
        // The first look only notes what is missing.
        assert_eq!(matcher.pass(&data, &folders, t0), Pass { moves: vec![], again: true });
        let mut pass = matcher.pass(&data, &folders, at(t0, 6));
        pass.moves.sort();
        assert_eq!(pass.moves, [("old/loose.milk".to_string(), "loose.milk".to_string()), ("pack/Dancer/a.milk".to_string(), "pack/Sparkle/a.milk".to_string())]);
        move_data(&mut data, &pass.moves);
        assert!(data.presets["pack/Sparkle/a.milk"].star);
        assert!(data.presets["loose.milk"].star);
        assert!(!data.presets["twin.milk"].star);
        assert!(data.presets.contains_key("away/gone.milk") && data.presets.contains_key("away/unhashed.milk"));
        // Nothing more to move the second time.
        assert!(matcher.pass(&data, &folders, at(t0, 12)).moves.is_empty());

        let mut lists = vec![Playlist { id: "1".into(), name: "set".into(), presets: vec!["pack/Dancer/a.milk".into(), "twin.milk".into(), "pack/Dancer/a.milk".into()] }];
        assert!(follow(&mut lists, &pass.moves));
        assert_eq!(lists[0].presets, ["pack/Sparkle/a.milk", "twin.milk", "pack/Sparkle/a.milk"]);
        assert!(!follow(&mut lists, &pass.moves));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_briefly_missing_preset_keeps_its_data_from_a_duplicate_elsewhere() {
        let root = temp("brief");
        let bytes = b"[preset00]\nzoom=1.2\n";
        let original = root.join("pack/A/x.milk");
        put(&root.join("pack/B/copy.milk"), bytes);
        let folders = vec![root.clone()];
        let mut data = LibraryData::default();
        data.presets.insert("pack/A/x.milk".into(), Mine { hash: Some(engine::index::hash(bytes)), size: Some(bytes.len() as u64), star: true, ..Default::default() });
        let mut matcher = Matcher::default();
        let t0 = Instant::now();
        // Missing mid-download: noted, nothing moves.
        assert!(matcher.pass(&data, &folders, t0).moves.is_empty());
        put(&original, bytes);
        assert_eq!(matcher.pass(&data, &folders, at(t0, 6)), Pass::default());
        // Missing again later starts a new grace rather than counting the old one.
        std::fs::remove_file(&original).unwrap();
        assert!(matcher.pass(&data, &folders, at(t0, 7)).moves.is_empty());
        // Two duplicates of it: neither is chosen.
        put(&root.join("pack/C/copy2.milk"), bytes);
        assert!(matcher.pass(&data, &folders, at(t0, 20)).moves.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_deleted_preset_is_searched_for_once_until_the_presets_change() {
        let root = temp("deleted");
        let file = root.join("lib/library.json");
        let folders = vec![root.join("presets")];
        put(&root.join("presets/pack/other.milk"), b"[preset00]\nzoom=0.5\n");
        put(&root.join("presets/pack/same-size.milk"), b"0123456789");
        let mut data = LibraryData::default();
        data.presets.insert("pack/gone.milk".into(), Mine { hash: Some(engine::index::hash(b"abcdefghij")), size: Some(10), star: true, ..Default::default() });
        // Nothing missing: nothing walked or hashed.
        let mut kept = data.clone();
        kept.presets.clear();
        kept.presets.insert("pack/other.milk".into(), Mine { hash: Some("x".into()), star: true, ..Default::default() });
        let mut matcher = Matcher::open(searched_file(&file));
        assert_eq!(matcher.pass(&kept, &folders, Instant::now()), Pass::default());
        assert_eq!(matcher.hashed, 0);

        let t0 = Instant::now();
        matcher.pass(&data, &folders, t0);
        assert!(matcher.pass(&data, &folders, at(t0, 6)).moves.is_empty());
        // Only the file of the right size was hashed.
        assert_eq!(matcher.hashed, 1);
        // The next launch doesn't look again…
        let mut next = Matcher::open(searched_file(&file));
        assert_eq!(next.pass(&data, &folders, t0), Pass::default());
        assert_eq!(next.pass(&data, &folders, at(t0, 6)), Pass::default());
        assert_eq!(next.hashed, 0);
        // …until the presets change, and then hashes only what changed.
        put(&root.join("presets/pack/new.milk"), b"abcdefghij");
        next.pass(&data, &folders, at(t0, 7));
        let pass = next.pass(&data, &folders, at(t0, 20));
        assert_eq!(pass.moves, [("pack/gone.milk".to_string(), "pack/new.milk".to_string())]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn playlists_are_saved_before_the_library_and_a_failed_save_moves_nothing() {
        let root = temp("commit");
        let store = Store::open(root.join("library.json"));
        store.data.lock().unwrap().presets.insert("old.milk".into(), Mine { star: true, ..Default::default() });
        let moves = vec![("old.milk".to_string(), "new.milk".to_string())];
        // Playlists that can't be saved (their file is a folder): nothing moves.
        std::fs::create_dir_all(root.join("bad.json")).unwrap();
        let mut bad = crate::playlists::Store::open(root.join("bad.json"), root.clone());
        bad.lists = vec![Playlist { id: "1".into(), name: "set".into(), presets: vec!["old.milk".into()] }];
        assert!(commit(&store, Some(&mut bad), moves.clone()).is_err());
        assert_eq!(bad.lists[0].presets, ["old.milk"]);
        assert!(store.data.lock().unwrap().presets.contains_key("old.milk"));
        assert!(!root.join("library.json").exists());

        let mut lists = crate::playlists::Store::open(root.join("playlists.json"), root.clone());
        lists.lists = bad.lists.clone();
        assert_eq!(commit(&store, Some(&mut lists), moves.clone()).unwrap(), (moves.clone(), true));
        assert!(std::fs::read_to_string(root.join("playlists.json")).unwrap().contains("new.milk"));
        assert!(load(&root.join("library.json")).unwrap().presets["new.milk"].star);
        // Already moved: nothing more.
        assert_eq!(commit(&store, Some(&mut lists), moves).unwrap(), (vec![], false));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_kept_and_changes_stay_in_memory_and_agree() {
        let root = temp("unreadable");
        // A file that can't be read (here a folder) is an error, not empty data.
        let file = root.join("library.json");
        std::fs::create_dir_all(&file).unwrap();
        assert!(load(&file).is_err());
        let store = Store::open(file.clone());
        assert!(store.broken.is_some());
        let keys = ["a.milk".to_string()];
        // The save is refused and memory rolls back to agree with the file.
        assert!(set(&store, &keys, &Change { star: Some(true), ..Default::default() }, &[root.clone()]).is_err());
        assert!(store.data.lock().unwrap().presets.is_empty());
        assert!(file.is_dir());
        // A readable one saves.
        let store = Store::open(root.join("ok.json"));
        let data = set(&store, &keys, &Change { star: Some(true), ..Default::default() }, &[root.clone()]).unwrap();
        assert_eq!(load(&root.join("ok.json")).unwrap(), data);
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
