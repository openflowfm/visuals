//! Where the presets come from: the starter set bundled with the app, and the
//! full pack downloaded into the presets folder ([`engine::preset::pack_dir`]).
//!
//! The starter set mirrors the pack's layout (`cream-of-the-crop/<Style>/…`), so
//! a starter preset and the same one downloaded have the same folder-relative
//! path: playlists follow it into the pack, and nothing is listed twice. The
//! full pack is our own bundle ([`BUNDLE`], see `docs/pack.md`): the presets with
//! their `index.json` and `thumbnails/`, kept in the openflowfm/visual-presets
//! repo and downloaded as its archive at a pinned commit, so the library arrives
//! grouped and with pictures. When it can't be reached, projectM's bare pack is
//! fetched instead
//! ([`PROJECTM`]). The download unpacks as it arrives, each file written beside
//! its place and then renamed into it, so the library fills in as it goes and a
//! retry only fetches what is missing. The presets folder is watched, and the
//! page told when it changes ([`CHANGED`]).

use crate::App;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The event the download's progress goes out on, a [`PackStatus`] each time.
pub const PROGRESS: &str = "pack-progress";

/// The event that says the presets folder changed (no payload).
pub const CHANGED: &str = "presets-changed";

/// Where the full pack can be downloaded from, and its size in bytes: the size
/// shown until the server answers, and while it doesn't say (GitHub sends large
/// archives without a `Content-Length`). Only for the progress bar, so it may be
/// an estimate; nothing checks a download against it.
#[derive(Debug, Clone, Copy)]
struct Source {
    url: &'static str,
    size: u64,
}

/// The full pack: our bundle of projectM's cream-of-the-crop with its index and
/// thumbnails, the openflowfm/visual-presets repo's archive at a pinned commit
/// (`docs/pack.md` builds it). The archive's top folder is
/// `visual-presets-<commit>/`, left out like any top folder ([`extract`]). A
/// new bundle is a new commit there, pinned here with its archive's size.
const BUNDLE: Source = Source { url: "https://github.com/openflowfm/visual-presets/archive/fd71ac21887144e20cacbbe120cac681664847a8.tar.gz", size: 53_005_539 };
/// The fallback: projectM's bare pack, pinned to the commit the bundle is made
/// from. Same presets, no index or thumbnails.
const PROJECTM: Source = Source { url: "https://github.com/projectM-visualizer/presets-cream-of-the-crop/archive/0180df21f5e0bd39b9060cc5de420ed2f1f9e509.tar.gz", size: 10_847_153 };
/// Tried in order; the next only when one can't be reached.
const SOURCES: [Source; 2] = [BUNDLE, PROJECTM];

/// Where the app downloads the pack from: [`SOURCES`]. In a debug build
/// `VISUALS_PACK_URL=<url>` puts that bundle in [`BUNDLE`]'s place (one served
/// locally, to try a new bundle in the app before pushing it; `docs/pack.md`).
fn sources() -> Vec<Source> {
    #[cfg(debug_assertions)]
    return sources_with(std::env::var("VISUALS_PACK_URL").ok().filter(|u| !u.is_empty()));
    #[cfg(not(debug_assertions))]
    return sources_with(None);
}

/// [`SOURCES`], with `bundle` (when given) in [`BUNDLE`]'s place.
fn sources_with(bundle: Option<String>) -> Vec<Source> {
    match bundle {
        Some(url) => vec![Source { url: url.leak(), size: 0 }, PROJECTM],
        None => SOURCES.to_vec(),
    }
}
/// How many presets the full pack has.
const TOTAL: usize = 9795;
/// The pack's folder inside the presets folder (and inside the starter set).
const FOLDER: &str = "cream-of-the-crop";
/// The pack's index, at the top of its folder (`crate::catalog` reads it).
const INDEX: &str = "index.json";
/// The folder of the index's thumbnails, beside it.
const THUMBNAILS: &str = "thumbnails";
/// The file in the pack's folder naming the archive last unpacked there whole
/// (its URL, with the commit in it), so a new pinned [`BUNDLE`] is noticed
/// ([`stale`]).
const RECORD: &str = ".bundle";
/// The most a file in a download may be (the full pack's `index.json`, its
/// largest, is a few MB).
const FILE_MAX: u64 = 64 << 20;

/// The folders presets are listed from: the presets folder, and the bundled
/// starter set while the presets folder doesn't have all of it.
pub fn folders(app: &AppHandle) -> Vec<PathBuf> {
    let presets = app.state::<App>().library.clone();
    let starter = starter(app).filter(|s| !covers(&presets, s));
    let mut folders = vec![presets];
    folders.extend(starter);
    folders
}

/// Whether `presets` has every preset of `starter`, at the same relative path.
fn covers(presets: &Path, starter: &Path) -> bool {
    engine::preset::milk_files(starter).iter().all(|p| p.strip_prefix(starter).is_ok_and(|rel| presets.join(rel).is_file()))
}

/// Every preset in `folders`, in order: what the library lists, and what live
/// actions (random, next, auto-advance) choose from. A preset at a relative path
/// an earlier folder already has is left out.
pub fn milk_files_in(folders: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for folder in folders {
        for p in engine::preset::milk_files(folder) {
            if seen.insert(p.strip_prefix(folder).unwrap_or(&p).to_path_buf()) {
                out.push(p);
            }
        }
    }
    out
}

/// Every preset the library lists.
pub fn milk_files(app: &AppHandle) -> Vec<PathBuf> {
    milk_files_in(&folders(app))
}

/// Where a folder-relative preset path is: in the first of `folders` that has
/// it, else in the first folder (the presets folder).
pub fn resolve_in(folders: &[PathBuf], rel: &Path) -> PathBuf {
    folders.iter().map(|f| f.join(rel)).find(|p| p.exists()).unwrap_or_else(|| folders.first().map(|f| f.join(rel)).unwrap_or_else(|| rel.to_path_buf()))
}

/// The bundled starter set's folder, when it is there.
pub fn starter(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("presets").join("starter")).filter(|d| d.is_dir())
}

/// Where the full pack's download is.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Idle,
    Downloading,
    Failed,
}

#[derive(Serialize, Clone, Debug)]
pub struct PackStatus {
    /// `.milk` files in the bundled starter set.
    starter: usize,
    /// `.milk` files in the presets folder.
    installed: usize,
    /// Presets in the full pack.
    total: usize,
    /// The full pack's download, in bytes: the server's own figure once it has
    /// answered.
    size: u64,
    state: State,
    /// Bytes downloaded so far.
    received: u64,
    /// Why the last download failed.
    error: Option<String>,
}

/// The download as it goes, shared by [`pack_download`] and [`pack_status`].
struct Download {
    state: State,
    received: u64,
    error: Option<String>,
    /// `.milk` files in the presets folder so far, while downloading.
    installed: usize,
    /// The download's size in bytes.
    size: u64,
}

static DOWNLOAD: Mutex<Download> = Mutex::new(Download { state: State::Idle, received: 0, error: None, installed: 0, size: BUNDLE.size });

fn status(d: &Download, starter: usize, installed: usize) -> PackStatus {
    PackStatus { starter, installed, total: TOTAL, size: d.size, state: d.state, received: d.received, error: d.error.clone() }
}

fn starter_count(handle: &AppHandle) -> usize {
    starter(handle).map_or(0, |d| engine::preset::milk_files(&d).len())
}

/// How many presets there are and where the full pack's download is.
#[tauri::command]
pub fn pack_status(handle: AppHandle, app: tauri::State<App>) -> PackStatus {
    let d = DOWNLOAD.lock().unwrap();
    let installed = if d.state == State::Downloading { d.installed } else { engine::preset::milk_files(&app.library).len() };
    status(&d, starter_count(&handle), installed)
}

/// Download the full pack into the presets folder, telling the page how it goes
/// on [`PROGRESS`]. Resolves when it ends; a call while one runs returns at once.
#[tauri::command]
pub async fn pack_download(handle: AppHandle) -> Result<(), String> {
    if !begin(None) {
        return Ok(());
    }
    let thread = std::thread::spawn(move || download(&handle, &sources(), false));
    tauri::async_runtime::spawn_blocking(move || thread.join()).await.map_err(|e| e.to_string())?.unwrap_or_else(|_| Err("the download stopped unexpectedly".into()))
}

/// Mark a download as running, unless one already is (then false). The status
/// says `installed` presets meanwhile when given, else the count so far.
fn begin(installed: Option<usize>) -> bool {
    let mut d = DOWNLOAD.lock().unwrap();
    if d.state == State::Downloading {
        return false;
    }
    *d = Download { state: State::Downloading, received: 0, error: None, installed: installed.unwrap_or(d.installed), size: d.size };
    true
}

/// Whether the pack in `dest` should be brought up to `bundle` (its URL): it is
/// a full pack, and [`RECORD`] names another archive or is missing (a pack
/// downloaded before the record was kept). A pack that is there whole has its
/// `index.json` (placed last, once the whole bundle is in) or every preset (the
/// fallback's bare pack); a first download cut off part-way is neither, and is
/// left to the button.
fn stale(dest: &Path, bundle: &str) -> bool {
    let record = std::fs::read_to_string(dest.join(RECORD)).ok();
    if record.as_deref().map(str::trim) == Some(bundle) {
        return false;
    }
    record.is_some() || dest.join(INDEX).is_file() || engine::preset::milk_files(dest).len() >= TOTAL
}

/// Bring an existing full pack up to the pinned bundle when it is [`stale`]:
/// the download the button starts, from the bundle alone (not the fallback),
/// quietly. It doesn't run while another download does. A failure leaves the
/// pack as it is, and the next launch tries again.
fn update(handle: &AppHandle) {
    let library = handle.state::<App>().library.clone();
    let dest = library.join(FOLDER);
    let Some(&bundle) = sources().first() else { return };
    if !stale(&dest, bundle.url) {
        return;
    }
    // Shown as already in: the page keeps the pack bar away.
    if !begin(Some(quiet_count(engine::preset::milk_files(&library).len()))) {
        return;
    }
    eprintln!("pack: bringing the pack up to {}", bundle.url);
    let _ = download(handle, &[bundle], true);
}

/// The count of presets a quiet update reports while it runs: at least
/// [`TOTAL`], which the page reads as the pack being in, so it shows no pack bar
/// (even after presets were deleted, or when a build raises `TOTAL`).
fn quiet_count(installed: usize) -> usize {
    installed.max(TOTAL)
}

/// Whether the quiet update runs at start: not in headless runs (agents' captures
/// against the owner's library) nor in debug builds, unless a debug build is
/// given `VISUALS_PACK_UPDATE=1`.
fn updates(headless: bool, debug: bool, asked: bool) -> bool {
    if debug { asked } else { !headless }
}

/// The download itself, on its own thread: [`fetch`] from `sources` with
/// progress going out on [`PROGRESS`] at most every 100 ms, and a last status
/// when it ends. A `quiet` one ([`update`]) leaves the count of presets as it
/// was until it ends, and a failure is only logged, not shown.
fn download(handle: &AppHandle, sources: &[Source], quiet: bool) -> Result<(), String> {
    let library = handle.state::<App>().library.clone();
    let dest = library.join(FOLDER);
    let starter = starter_count(handle);
    let others = engine::preset::milk_files(&library).iter().filter(|p| !p.starts_with(&dest)).count();
    let mut last: Option<Instant> = None;
    let result = crate::crash::catch(std::panic::AssertUnwindSafe(|| {
        let sized = |size| DOWNLOAD.lock().unwrap().size = size;
        fetch(sources, &dest, sized, |received, files| {
            let mut d = DOWNLOAD.lock().unwrap();
            d.received = received;
            if !quiet {
                d.installed = others + files;
            }
            if last.is_none_or(|t| t.elapsed() >= Duration::from_millis(100)) {
                last = Some(Instant::now());
                let _ = handle.emit(PROGRESS, status(&d, starter, d.installed));
            }
        })
    }))
    .unwrap_or_else(|_| Err("the download stopped unexpectedly".into()));
    let installed = engine::preset::milk_files(&library).len();
    let mut d = DOWNLOAD.lock().unwrap();
    d.installed = installed;
    match &result {
        Ok(_) => (d.state, d.error) = (State::Idle, None),
        Err(e) if quiet => {
            eprintln!("pack: couldn't bring the pack up to date, trying again next launch: {e}");
            (d.state, d.error) = (State::Idle, None);
        }
        Err(e) => (d.state, d.error) = (State::Failed, Some(e.clone())),
    }
    let _ = handle.emit(PROGRESS, status(&d, starter, installed));
    result.map(|_| ())
}

/// Counts the bytes read through it, and notes when the download broke off
/// (rather than the archive being bad): reading it failed or stalled, or it
/// ended short of the `length` the server gave.
struct Counted<'a, R> {
    inner: R,
    length: Option<u64>,
    count: &'a Cell<u64>,
    broke: &'a Cell<bool>,
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf).inspect_err(|_| self.broke.set(true))?;
        self.count.set(self.count.get() + n as u64);
        if n == 0 && !buf.is_empty() && self.length.is_some_and(|l| self.count.get() < l) {
            self.broke.set(true);
        }
        Ok(n)
    }
}

/// Download the pack's tar.gz from the first of `sources` that answers, and
/// unpack it into `dest` as it arrives ([`extract`]). `sized` hears the
/// download's size once a server has answered (its `Content-Length`, else the
/// source's own figure); `progress` the bytes received and the presets placed
/// so far. A source that answers with something that isn't a whole tar.gz of
/// presets (it won't gunzip or untar, or has no presets) counts as one that
/// can't be had, and the next is tried. A download that breaks off isn't taken
/// up from the next source: a retry carries on from the same one. Once a whole
/// archive is in, its URL (naming its commit) is noted in [`RECORD`]. Returns
/// how many presets the pack has.
fn fetch(sources: &[Source], dest: &Path, mut sized: impl FnMut(u64), mut progress: impl FnMut(u64, usize)) -> Result<usize, String> {
    let client = client()?;
    let mut failed = Vec::new();
    for source in sources {
        let response = match open(&client, source.url) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("pack: {e} ({})", source.url);
                failed.push(e);
                continue;
            }
        };
        let length = response.content_length();
        sized(length.unwrap_or(source.size));
        let (received, broke) = (Cell::new(0), Cell::new(false));
        match extract(Counted { inner: response, length, count: &received, broke: &broke }, dest, |files| progress(received.get(), files)) {
            Ok(files) => {
                progress(received.get(), files);
                if let Err(e) = std::fs::write(dest.join(RECORD), format!("{}\n", source.url)) {
                    // Only costs a download: the next launch brings it up to date again.
                    eprintln!("pack: couldn't note which bundle is in: {e}");
                }
                return Ok(files);
            }
            Err(Failed::Archive(e)) if broke.get() => return Err(format!("the download broke off: {e}")),
            Err(Failed::Archive(e)) => {
                let e = format!("the pack's archive is damaged: {e}");
                eprintln!("pack: {e} ({})", source.url);
                failed.push(e);
            }
            Err(Failed::Local(e)) => return Err(e),
        }
    }
    Err(if failed.is_empty() { "nowhere to download the pack from".into() } else { failed.join("; ") })
}

fn client() -> Result<reqwest::blocking::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::blocking::Client::builder()
        .user_agent(concat!("visual[flow]/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        // No limit on the whole download, so a slow connection can finish it;
        // only a stall ends it. (The blocking client's `timeout` is per call: on
        // the response, each `read` waits at most this long for bytes.)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("couldn't start the download: {e}"))
}

/// Ask for `url`: the response, once the server has said yes.
fn open(client: &reqwest::blocking::Client, url: &str) -> Result<reqwest::blocking::Response, String> {
    let response = client.get(url).send().map_err(|e| format!("couldn't reach the pack: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("the pack's server said {}", response.status()));
    }
    Ok(response)
}

/// What [`extract`] takes from the archive: a file to place, or the index.
#[derive(Debug, PartialEq)]
enum Kind {
    Preset,
    /// A `.md` beside the presets, or a thumbnail in `thumbnails/`.
    Other,
    Index,
}

/// What to do with the archive's file at `rel` (its top folder left out).
fn kind(rel: &Path) -> Option<Kind> {
    let name = rel.file_name()?.to_str()?;
    // macOS's tar adds `._name` beside a file for its extended attributes.
    if name.starts_with("._") {
        return None;
    }
    let parts: Vec<_> = rel.components().collect();
    if parts.len() == 1 && name == INDEX {
        return Some(Kind::Index);
    }
    if parts.len() == 2 && parts[0].as_os_str() == THUMBNAILS {
        return has_ext(rel, "webp").then_some(Kind::Other);
    }
    if has_ext(rel, "milk") { Some(Kind::Preset) } else { has_ext(rel, "md").then_some(Kind::Other) }
}

/// Why [`extract`] stopped.
#[derive(Debug)]
enum Failed {
    /// Reading the archive went wrong: it isn't a whole tar.gz of presets, or
    /// the download under it broke off ([`fetch`] tells which).
    Archive(String),
    /// Writing into the presets folder went wrong.
    Local(String),
}

/// What the `index.json` already in the pack's folder says was downloaded: each
/// file's content hash by its path (`/`-separated, in the pack's folder), and
/// the thumbnails' names. Empty when there's none, or it can't be read.
#[derive(Default)]
struct Downloaded {
    hashes: std::collections::HashMap<String, String>,
    /// The same, by the path in lower case.
    folded: std::collections::HashMap<String, String>,
    thumbnails: HashSet<String>,
}

impl Downloaded {
    /// Read from `index` loosely, whatever its version: only its rows' and
    /// skips' paths, hashes and thumbnails, which every version has.
    fn read(index: &Path) -> Downloaded {
        #[derive(Deserialize, Default)]
        struct Old {
            #[serde(default)]
            rows: Vec<Row>,
            #[serde(default)]
            skipped: Vec<Row>,
        }
        #[derive(Deserialize)]
        struct Row {
            path: String,
            hash: String,
            #[serde(default)]
            thumbnail: Option<String>,
        }
        let old: Old = std::fs::read(index).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let thumbnails = old.rows.iter().filter_map(|r| r.thumbnail.clone()).collect();
        let hashes: std::collections::HashMap<String, String> = old.rows.into_iter().chain(old.skipped).map(|r| (r.path, r.hash)).collect();
        let folded = hashes.iter().map(|(k, h)| (k.to_lowercase(), h.clone())).collect();
        Downloaded { hashes, folded, thumbnails }
    }

    /// Whether the file at `key` is still as it was downloaded: there, and its
    /// content's hash the one the index has for it. A path the index has only in
    /// another case is the same file on a case-insensitive volume (macOS's
    /// usually are), so a preset the new bundle renames only in case is
    /// replaced like any other.
    fn untouched(&self, key: &str, there: &[u8]) -> bool {
        self.hashes.get(key).or_else(|| self.folded.get(&key.to_lowercase())).is_some_and(|h| *h == engine::index::hash(there))
    }
}

/// Unpack a tar.gz of the pack into `dest`, leaving out its top folder: its
/// `.milk` and `.md` files, its `index.json` and the `.webp` files in its
/// `thumbnails/`, never anything outside `dest`. Each file is written to a
/// `.part` beside its place and renamed into it. A file already there is kept,
/// unless the pack's old `index.json` (the one in `dest`) has its hash, so it
/// is still as downloaded: then a changed one replaces it. With no old index,
/// nothing is replaced. The index itself is always replaced, and only once the
/// whole archive has arrived, so the library groups the pack once its presets
/// and thumbnails are all in. Then, when the archive has an index (our bundle,
/// not projectM's bare pack), what the old index listed and the archive
/// doesn't have is removed: presets still as downloaded (a takedown), never
/// ones edited, and thumbnails. `placed` hears how many presets are in place
/// so far. Returns how many presets the archive has.
fn extract(reader: impl Read, dest: &Path, mut placed: impl FnMut(usize)) -> Result<usize, Failed> {
    let bad = |e: std::io::Error| Failed::Archive(e.to_string());
    let old = Downloaded::read(&dest.join(INDEX));
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(reader));
    let mut files = 0;
    let mut index = None;
    let mut seen = HashSet::new();
    for entry in archive.entries().map_err(bad)? {
        let mut entry = entry.map_err(bad)?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry.path().map_err(bad)?.into_owned();
        let Some(rel) = inside(&path) else { continue };
        let Some(kind) = kind(&rel) else { continue };
        if entry.size() > FILE_MAX {
            return Err(Failed::Archive(format!("its {} is too big ({} bytes)", rel.display(), entry.size())));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(bad)?;
        if kind == Kind::Index {
            index = Some(bytes);
            continue;
        }
        let key = index_path(&rel);
        let target = dest.join(&rel);
        // A file already there is replaced only while it's as downloaded: the
        // user may have edited it. A cut-off write never leaves one (it lands
        // in the `.part` first).
        let write = match std::fs::read(&target) {
            Ok(there) => there != bytes && old.untouched(&key, &there),
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        };
        if write {
            place(&target, &bytes).map_err(Failed::Local)?;
        }
        seen.insert(key);
        if kind == Kind::Preset {
            files += 1;
            placed(files);
        }
    }
    // Read the gzip stream to its end, so a cut-off download is an error.
    let mut rest = archive.into_inner();
    std::io::copy(&mut rest, &mut std::io::sink()).map_err(bad)?;
    std::io::copy(&mut rest.into_inner(), &mut std::io::sink()).map_err(bad)?;
    if files == 0 {
        return Err(Failed::Archive("it has no presets in it".into()));
    }
    if let Some(bytes) = index {
        remove_dropped(dest, &old, &seen);
        place(&dest.join(INDEX), &bytes).map_err(Failed::Local)?;
    }
    Ok(files)
}

/// Write `bytes` to a `.part` beside `target`, then rename it into place.
fn place(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("couldn't make {}: {e}", dir.display()))?;
    }
    let mut part = target.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    std::fs::write(&part, bytes).and_then(|_| std::fs::rename(&part, target)).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("couldn't write {}: {e}", target.display())
    })
}

/// Remove from `dest` what `old` listed and the new archive doesn't have
/// (`seen`): presets still as downloaded, and thumbnails. An edited preset is
/// kept. A folder left empty goes too. A file that can't be removed is only
/// logged: it stays listed nowhere, and the download still counts.
///
/// A path the archive has only in another case (a rename like `A/Foo.milk` to
/// `A/foo.milk`) is the same file on a case-insensitive volume, as macOS's
/// usually are: it is renamed to the new case, never removed. On a
/// case-sensitive volume the two are different files, and the old one goes
/// like any dropped file.
fn remove_dropped(dest: &Path, old: &Downloaded, seen: &HashSet<String>) {
    let folded: std::collections::HashMap<String, &String> = seen.iter().map(|k| (k.to_lowercase(), k)).collect();
    let thumbnails = old.thumbnails.iter().map(|t| format!("{THUMBNAILS}/{t}"));
    let dropped = old.hashes.keys().cloned().chain(thumbnails).filter(|k| !seen.contains(k));
    for key in dropped {
        // Only plain names inside `dest`: the index is data, not a path to trust.
        if !Path::new(&key).components().all(|c| matches!(c, Component::Normal(_))) {
            continue;
        }
        let target = dest.join(&key);
        if let Some(new) = folded.get(&key.to_lowercase()) {
            let renamed = dest.join(new);
            if same_file(&target, &renamed) {
                // Only the case differs: the archive's file is this one.
                if let Err(e) = std::fs::rename(&target, &renamed) {
                    eprintln!("pack: couldn't rename {} to {}: {e}", target.display(), renamed.display());
                }
                continue;
            }
        }
        let Ok(there) = std::fs::read(&target) else { continue };
        if old.hashes.contains_key(&key) && !old.untouched(&key, &there) {
            continue;
        }
        if let Err(e) = std::fs::remove_file(&target) {
            eprintln!("pack: couldn't remove {}: {e}", target.display());
            continue;
        }
        // Folders left empty, up to the pack's own (`remove_dir` fails on one that isn't).
        let mut dir = target.parent();
        while let Some(d) = dir.filter(|d| *d != dest && d.starts_with(dest)) {
            if std::fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
    }
}

/// Whether `a` and `b` are the same file on disk (one path in two cases on a
/// case-insensitive volume). False when either isn't there.
#[cfg(unix)]
fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(a), Ok(b)) => (a.dev(), a.ino()) == (b.dev(), b.ino()),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_file(_: &Path, _: &Path) -> bool {
    false
}

/// `rel` as the index writes paths: `/`-separated.
fn index_path(rel: &Path) -> String {
    rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// An archive path without its top folder, when every part is a plain name.
fn inside(path: &Path) -> Option<PathBuf> {
    let mut parts = path.components();
    matches!(parts.next(), Some(Component::Normal(_))).then_some(())?;
    let rel = parts.as_path();
    (rel.components().next().is_some() && rel.components().all(|c| matches!(c, Component::Normal(_)))).then(|| rel.to_path_buf())
}

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// The starter set's playlists file (`playlists.json` beside its presets).
#[derive(Deserialize)]
struct Seed {
    playlists: Vec<SeedList>,
}

#[derive(Deserialize)]
struct SeedList {
    name: String,
    presets: Vec<String>,
}

/// Make the starter set's playlists when the playlists file is new (`fresh`),
/// and save them. Their presets are stored folder-relative, so they play from the
/// starter set and from the pack once it is in. Returns how many it made.
pub fn seed_playlists(store: &mut crate::playlists::Store, starter: &Path, fresh: bool) -> Result<usize, String> {
    if !fresh {
        return Ok(0);
    }
    let file = starter.join("playlists.json");
    let seed: Seed = serde_json::from_slice(&std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?).map_err(|e| format!("{}: {e}", file.display()))?;
    if store.relative(&starter.join("x")) != "x" {
        store.add_folder(starter.to_path_buf());
    }
    for list in &seed.playlists {
        let id = store.create(&list.name)?;
        for p in &list.presets {
            store.add(&id, &starter.join(p), None)?;
        }
    }
    store.save()?;
    Ok(seed.playlists.len())
}

/// Presets added by the page: a dropped file or folder (`path`), or a file of a
/// folder picked in the page, by its name in that folder and its text.
#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum Added {
    Path { path: String },
    File { name: String, text: String },
}

/// Copy added presets into the presets folder ([`add`]). Returns how many files
/// were written.
#[tauri::command]
pub fn pack_add(items: Vec<Added>, app: tauri::State<App>) -> Result<usize, String> {
    add(&items, &app.library)
}

/// Copy added presets into `presets`: a `.milk` file to its name there, a
/// folder's `.milk` files under the folder's name, a picked file to its name.
/// Never overwrites: the same content is skipped, other content gets ` (2)`,
/// ` (3)`… Returns how many files were written.
fn add(items: &[Added], presets: &Path) -> Result<usize, String> {
    let mut found = 0;
    let mut written = 0;
    for item in items {
        match item {
            Added::Path { path } => {
                let path = Path::new(path);
                let Some(name) = path.file_name() else { continue };
                let files: Vec<(PathBuf, PathBuf)> = if path.is_dir() {
                    engine::preset::milk_files(path).into_iter().filter_map(|f| Some((Path::new(name).join(f.strip_prefix(path).ok()?), f))).collect()
                } else if has_ext(path, "milk") && path.is_file() {
                    vec![(PathBuf::from(name), path.to_path_buf())]
                } else {
                    Vec::new()
                };
                for (rel, file) in files {
                    found += 1;
                    let bytes = std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
                    written += put(presets, &rel, &bytes)? as usize;
                }
            }
            Added::File { name, text } => {
                let rel = Path::new(name);
                if has_ext(rel, "milk") && rel.components().all(|c| matches!(c, Component::Normal(_))) {
                    found += 1;
                    written += put(presets, rel, text.as_bytes())? as usize;
                }
            }
        }
    }
    if found == 0 {
        return Err("no .milk files in what was added".into());
    }
    Ok(written)
}

/// Write `bytes` at `rel` in `presets`, or beside it as `name (n).milk` when a
/// different file is there. False when the same content is already there.
fn put(presets: &Path, rel: &Path, bytes: &[u8]) -> Result<bool, String> {
    let target = presets.join(rel);
    let dir = target.parent().unwrap_or(presets);
    let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = target.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    for n in 1.. {
        let candidate = if n == 1 { target.clone() } else { dir.join(format!("{stem} ({n}).{ext}")) };
        match std::fs::read(&candidate) {
            Ok(there) if there == bytes => return Ok(false),
            Ok(_) => continue,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir_all(dir).map_err(|e| format!("couldn't make {}: {e}", dir.display()))?;
                std::fs::write(&candidate, bytes).map_err(|e| format!("couldn't write {}: {e}", candidate.display()))?;
                return Ok(true);
            }
            Err(e) => return Err(format!("{}: {e}", candidate.display())),
        }
    }
    unreachable!()
}

/// Seed the starter playlists on a first run, bring a full pack up to the
/// pinned bundle in the background ([`update`]), and watch the presets folder,
/// sending [`CHANGED`] when it changes.
pub fn start(handle: &AppHandle) {
    let fresh = !crate::playlists::default_file().exists();
    if let Some(starter) = starter(handle) {
        let deck = handle.state::<crate::actions::Deck>();
        if let Err(e) = seed_playlists(&mut deck.store.lock().unwrap(), &starter, fresh) {
            eprintln!("playlists: couldn't make the starter ones: {e}");
        }
    }
    let library = handle.state::<App>().library.clone();
    if let Err(e) = std::fs::create_dir_all(&library) {
        eprintln!("presets: couldn't make {}: {e}", library.display());
    }
    // A debug build downloads the pack at start with `VISUALS_PACK_DOWNLOAD=1`,
    // to try a bundle in a headless run (with `VISUALS_PACK_URL`; docs/pack.md).
    #[cfg(debug_assertions)]
    if std::env::var_os("VISUALS_PACK_DOWNLOAD").is_some_and(|v| v == "1") {
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = pack_download(handle).await {
                eprintln!("pack: {e}");
            }
        });
    }
    let headless = std::env::var_os("VISUALS_HEADLESS").is_some();
    let asked = std::env::var_os("VISUALS_PACK_UPDATE").is_some_and(|v| v == "1");
    if updates(headless, cfg!(debug_assertions), asked) {
        let handle = handle.clone();
        std::thread::spawn(move || update(&handle));
    }
    let handle = handle.clone();
    std::thread::spawn(move || watch(&handle, &library));
}

/// Whether a watcher event changes the folder: create, modify or remove. Not an
/// access, so reading the presets after [`CHANGED`] doesn't fire it again.
fn changes(kind: &notify::EventKind) -> bool {
    use notify::EventKind::*;
    matches!(kind, Create(_) | Modify(_) | Remove(_))
}

fn watch(handle: &AppHandle, dir: &Path) {
    use notify::Watcher;
    let (tx, rx) = std::sync::mpsc::channel();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok_and(|e| changes(&e.kind)) {
            let _ = tx.send(());
        }
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => return eprintln!("presets: can't watch {}: {e}", dir.display()),
    };
    if let Err(e) = watcher.watch(dir, notify::RecursiveMode::Recursive) {
        return eprintln!("presets: can't watch {}: {e}", dir.display());
    }
    let mut debounce = Debounce::default();
    loop {
        let got = match debounce.due() {
            None => rx.recv().is_ok(),
            Some(at) => match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                Ok(()) => true,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => false,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            },
        };
        let now = Instant::now();
        if got {
            debounce.change(now);
        }
        if debounce.fire(now) {
            let _ = handle.emit(CHANGED, ());
        }
    }
}

/// When to tell the page about changes: once they have stopped for [`QUIET`],
/// and at least every [`EVERY`] while they keep coming.
#[derive(Default)]
struct Debounce {
    /// The first change not told yet, and the latest.
    pending: Option<(Instant, Instant)>,
}

const QUIET: Duration = Duration::from_millis(300);
const EVERY: Duration = Duration::from_secs(1);

impl Debounce {
    fn change(&mut self, now: Instant) {
        let first = self.pending.map_or(now, |(first, _)| first);
        self.pending = Some((first, now));
    }

    /// When the pending changes are due to be told, if there are any.
    fn due(&self) -> Option<Instant> {
        self.pending.map(|(first, last)| (last + QUIET).min(first + EVERY))
    }

    /// Whether to tell the page now; clears the pending changes if so.
    fn fire(&mut self, now: Instant) -> bool {
        let due = self.due().is_some_and(|at| at <= now);
        if due {
            self.pending = None;
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("visuals-pack-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A tar.gz of `(path, contents)`, paths written as they are (even `..`).
    fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
        for (path, data) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            header.as_old_mut().name[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    /// Bytes that don't compress, so a cut gzip stream is cut mid-file.
    fn noise(seed: u64, len: usize) -> Vec<u8> {
        let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (0..len)
            .map(|_| {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (x >> 56) as u8
            })
            .collect()
    }

    fn parts(dir: &Path) -> Vec<PathBuf> {
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out)
                } else if has_ext(&p, "part") {
                    out.push(p)
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, &mut out);
        out
    }

    #[test]
    fn extract_strips_the_top_folder_keeps_presets_and_stays_inside() {
        let dir = temp();
        let dest = dir.join("presets/cream-of-the-crop");
        let gz = tar_gz(&[("top/README.md", b"read me"), ("top/A/one.milk", b"one"), ("top/A/B/two.MILK", b"two"), ("top/A/notes.txt", b"no"), ("top/../x.milk", b"escape"), ("../y.milk", b"escape")]);
        let mut seen = Vec::new();
        assert_eq!(extract(&gz[..], &dest, |n| seen.push(n)).unwrap(), 2);
        assert_eq!(seen, [1, 2]);
        assert_eq!(std::fs::read(dest.join("README.md")).unwrap(), b"read me");
        assert_eq!(std::fs::read(dest.join("A/one.milk")).unwrap(), b"one");
        assert_eq!(std::fs::read(dest.join("A/B/two.MILK")).unwrap(), b"two");
        assert!(!dest.join("A/notes.txt").exists());
        assert!(!dir.join("presets/x.milk").exists() && !dir.join("x.milk").exists() && !dest.join("x.milk").exists());
        assert!(!dest.join("y.milk").exists() && !dir.join("presets/y.milk").exists());
        assert!(parts(&dir).is_empty());

        // A second run keeps what is there, edited or not, and writes nothing.
        std::fs::write(dest.join("A/one.milk"), b"ONE").unwrap();
        std::fs::write(dest.join("A/B/two.MILK"), b"edited, and longer").unwrap();
        assert_eq!(extract(&gz[..], &dest, |_| {}).unwrap(), 2);
        assert_eq!(std::fs::read(dest.join("A/one.milk")).unwrap(), b"ONE");
        assert_eq!(std::fs::read(dest.join("A/B/two.MILK")).unwrap(), b"edited, and longer");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_creating_changing_or_removing_counts_as_a_folder_change() {
        use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind};
        use notify::EventKind;
        assert!(changes(&EventKind::Create(CreateKind::File)));
        assert!(changes(&EventKind::Modify(ModifyKind::Any)));
        assert!(changes(&EventKind::Remove(RemoveKind::Folder)));
        assert!(!changes(&EventKind::Access(AccessKind::Open(AccessMode::Read))));
        assert!(!changes(&EventKind::Access(AccessKind::Close(AccessMode::Read))));
        assert!(!changes(&EventKind::Any) && !changes(&EventKind::Other));
    }

    /// Serve `response` once on a local port; the URL to ask for it.
    fn serve(response: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/pack.tar.gz", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0; 1024];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => request.extend_from_slice(&buf[..n]),
                }
            }
            let _ = stream.write_all(&response);
        });
        url
    }

    fn ok(body: &[u8]) -> Vec<u8> {
        let mut r = format!("HTTP/1.1 200 OK\r\nContent-Type: application/x-gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
        r.extend_from_slice(body);
        r
    }

    fn not_found() -> Vec<u8> {
        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
    }

    /// A source at `url` whose own size figure is `size`.
    fn at(url: String, size: u64) -> Source {
        Source { url: Box::leak(url.into_boxed_str()), size }
    }

    /// Nothing listens on port 1: a source that can't be reached.
    fn nowhere() -> Source {
        at("http://127.0.0.1:1/pack.tar.gz".into(), 7)
    }

    #[test]
    fn extract_takes_the_index_and_its_thumbnails_and_places_the_index_last() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let bundle = |index: &'static [u8]| {
            tar_gz(&[
                ("top/index.json", index),
                ("top/thumbnails/ab.webp", b"RIFF"),
                ("top/thumbnails/cd.png", b"no"),
                ("top/thumbnails/deep/ef.webp", b"no"),
                ("top/A/index.json", b"no"),
                ("top/A/._one.milk", b"apple double"),
                ("top/A/one.milk", b"one"),
                ("top/._index.json", b"apple double"),
            ])
        };
        let gz = bundle(br#"{"v":1}"#);
        // Cut off: no index yet, however early in the archive it came.
        assert!(extract(&gz[..gz.len() - 10], &dest, |_| {}).is_err());
        assert!(!dest.join("index.json").exists());
        assert_eq!(extract(&gz[..], &dest, |_| {}).unwrap(), 1);
        assert_eq!(std::fs::read(dest.join("index.json")).unwrap(), br#"{"v":1}"#);
        assert_eq!(std::fs::read(dest.join("thumbnails/ab.webp")).unwrap(), b"RIFF");
        assert_eq!(std::fs::read(dest.join("A/one.milk")).unwrap(), b"one");
        for no in ["thumbnails/cd.png", "thumbnails/deep/ef.webp", "A/index.json", "A/._one.milk", "._index.json"] {
            assert!(!dest.join(no).exists(), "{no}");
        }
        // A newer bundle's index replaces the one there; presets edited are kept.
        std::fs::write(dest.join("A/one.milk"), b"mine").unwrap();
        assert_eq!(extract(&bundle(br#"{"v":2}"#)[..], &dest, |_| {}).unwrap(), 1);
        assert_eq!(std::fs::read(dest.join("index.json")).unwrap(), br#"{"v":2}"#);
        assert_eq!(std::fs::read(dest.join("A/one.milk")).unwrap(), b"mine");
        assert!(parts(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// An `index.json` (the engine's own format) listing `presets` by their
    /// content, with a thumbnail each, and `skipped` without one.
    fn index_of(presets: &[(&str, &[u8])], skipped: &[(&str, &[u8])]) -> Vec<u8> {
        use engine::index::{hash, row, thumbnail_name, Index, Skipped};
        let mut index = Index::new(90);
        for (path, data) in presets {
            let mut r = row(Path::new(path), hash(data));
            r.thumbnail = Some(thumbnail_name(&r.hash));
            index.rows.push(r);
        }
        for (path, data) in skipped {
            index.rows.push(row(Path::new(path), hash(data)));
            index.skipped.push(Skipped { path: path.to_string(), hash: hash(data), why: "timed out".into() });
        }
        serde_json::to_vec(&index).unwrap()
    }

    fn thumb(data: &[u8]) -> String {
        format!("top/thumbnails/{}", engine::index::thumbnail_name(&engine::index::hash(data)))
    }

    #[test]
    fn a_new_bundle_replaces_and_removes_only_presets_still_as_downloaded() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let read = |p: &str| std::fs::read(dest.join(p)).ok();
        // The first bundle: five presets, one of them skipped by the index.
        let v1: [(&str, &[u8]); 5] = [("A/same.milk", b"same"), ("A/changed.milk", b"old"), ("A/edited.milk", b"old e"), ("B/dropped.milk", b"drop"), ("C/dropped-edited.milk", b"drop e")];
        let index1 = index_of(&v1[..4], &v1[4..]);
        let mut files1: Vec<(String, &[u8])> = v1.iter().map(|(p, d)| (format!("top/{p}"), *d)).collect();
        files1.extend(v1[..4].iter().map(|(_, d)| (thumb(d), &b"RIFF"[..])));
        files1.push(("top/index.json".into(), &index1[..]));
        let gz1 = tar_gz(&files1.iter().map(|(p, d)| (p.as_str(), *d)).collect::<Vec<_>>());
        assert_eq!(extract(&gz1[..], &dest, |_| {}).unwrap(), 5);
        let dropped_thumb = thumb(b"drop").trim_start_matches("top/").to_string();
        assert!(dest.join(&dropped_thumb).is_file());

        // The user edits two; then a new bundle changes two and drops two.
        std::fs::write(dest.join("A/edited.milk"), b"mine").unwrap();
        std::fs::write(dest.join("C/dropped-edited.milk"), b"mine too").unwrap();
        std::fs::write(dest.join("A/mine.milk"), b"not the pack's").unwrap();
        let v2: [(&str, &[u8]); 3] = [("A/same.milk", b"same"), ("A/changed.milk", b"new"), ("A/edited.milk", b"new e")];
        let index2 = index_of(&v2, &[]);
        let mut files2: Vec<(String, &[u8])> = v2.iter().map(|(p, d)| (format!("top/{p}"), *d)).collect();
        files2.push(("top/index.json".into(), &index2[..]));
        let gz2 = tar_gz(&files2.iter().map(|(p, d)| (p.as_str(), *d)).collect::<Vec<_>>());
        // Cut off, nothing is removed and the old index stays.
        assert!(extract(&gz2[..gz2.len() - 10], &dest, |_| {}).is_err());
        assert_eq!(read("B/dropped.milk").as_deref(), Some(&b"drop"[..]));
        assert_eq!(read("index.json"), Some(index1.clone()));

        assert_eq!(extract(&gz2[..], &dest, |_| {}).unwrap(), 3);
        assert_eq!(read("A/same.milk").as_deref(), Some(&b"same"[..]));
        assert_eq!(read("A/changed.milk").as_deref(), Some(&b"new"[..]), "overwritten: untouched");
        assert_eq!(read("A/edited.milk").as_deref(), Some(&b"mine"[..]), "kept: edited");
        assert_eq!(read("B/dropped.milk"), None, "removed: dropped and untouched");
        assert!(!dest.join("B").exists(), "its folder left empty goes too");
        assert_eq!(read("C/dropped-edited.milk").as_deref(), Some(&b"mine too"[..]), "kept: dropped but edited");
        assert_eq!(read("A/mine.milk").as_deref(), Some(&b"not the pack's"[..]));
        assert!(!dest.join(&dropped_thumb).exists(), "a thumbnail the new index doesn't have goes");
        assert_eq!(read("index.json"), Some(index2));
        assert!(parts(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_pack_without_an_index_removes_nothing_and_replaces_only_untouched_presets() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let index = index_of(&[("A/a.milk", b"a"), ("A/b.milk", b"b")], &[]);
        let thumbnail = thumb(b"b");
        let gz = tar_gz(&[("top/A/a.milk", b"a"), ("top/A/b.milk", b"b"), ("top/index.json", &index[..]), (&thumbnail, b"RIFF")]);
        assert_eq!(extract(&gz[..], &dest, |_| {}).unwrap(), 2);
        // projectM's bare pack: no index, `b` changed, `a` gone.
        assert_eq!(extract(&tar_gz(&[("top/A/b.milk", b"b2")])[..], &dest, |_| {}).unwrap(), 1);
        assert_eq!(std::fs::read(dest.join("A/a.milk")).unwrap(), b"a");
        assert_eq!(std::fs::read(dest.join("A/b.milk")).unwrap(), b"b2");
        assert!(dest.join(thumb(b"b").trim_start_matches("top/")).is_file());
        assert_eq!(std::fs::read(dest.join("index.json")).unwrap(), index);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fetch_falls_back_when_the_bundle_isnt_a_tar_gz_of_presets() {
        let dir = temp();
        let gz = tar_gz(&[("top/S/a.milk", b"a")]);
        let not_tar = {
            let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(&noise(9, 4000)).unwrap();
            e.finish().unwrap()
        };
        let empty = tar_gz(&[("top/README.md", b"no presets")]);
        // Sent whole, with its own length, but the archive itself is cut short.
        let short = tar_gz(&[("top/S/b.milk", &noise(4, 30_000))])[..10_000].to_vec();
        for bad in [b"<html>not gzip</html>".to_vec(), not_tar, empty, short] {
            let mut sizes = Vec::new();
            assert_eq!(fetch(&[at(serve(ok(&bad)), 1), at(serve(ok(&gz)), 2)], &dir, |s| sizes.push(s), |_, _| {}).unwrap(), 1);
            assert_eq!(sizes, [bad.len() as u64, gz.len() as u64]);
            assert!(dir.join("S/a.milk").is_file());
            std::fs::remove_file(dir.join("S/a.milk")).unwrap();
        }
        let err = fetch(&[at(serve(ok(b"garbage")), 1)], &dir, |_| {}, |_, _| {}).unwrap_err();
        assert!(err.contains("damaged"), "{err}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fetch_downloads_and_unpacks_counting_the_bytes() {
        let dir = temp();
        let a = noise(1, 20_000);
        let b = noise(2, 20_000);
        let gz = tar_gz(&[("top/LICENSE.md", b"license"), ("top/S/a.milk", &a), ("top/S/b.milk", &b)]);
        let (mut last, mut size) = ((0, 0), 0);
        assert_eq!(fetch(&[at(serve(ok(&gz)), 1)], &dir, |s| size = s, |r, n| last = (r, n)).unwrap(), 2);
        assert_eq!(last, (gz.len() as u64, 2));
        assert_eq!(size, gz.len() as u64, "the server's own size");
        assert_eq!(std::fs::read(dir.join("S/a.milk")).unwrap(), a);
        assert_eq!(std::fs::read(dir.join("S/b.milk")).unwrap(), b);
        assert!(dir.join("LICENSE.md").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// `body` sent chunked, with no `Content-Length`, as GitHub sends a large archive.
    fn chunked(body: &[u8]) -> Vec<u8> {
        let mut r = b"HTTP/1.1 200 OK\r\nContent-Type: application/x-gzip\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
        for chunk in body.chunks(4096) {
            r.extend_from_slice(format!("{:x}\r\n", chunk.len()).as_bytes());
            r.extend_from_slice(chunk);
            r.extend_from_slice(b"\r\n");
        }
        r.extend_from_slice(b"0\r\n\r\n");
        r
    }

    #[test]
    fn fetch_unpacks_a_github_archive_sent_without_a_length() {
        // As `git archive` makes it: a pax global header naming the commit, then
        // the repo's files under `visual-presets-<commit>/`, folders included.
        let top = "visual-presets-fd71ac21887144e20cacbbe120cac681664847a8";
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
        let comment = format!("52 comment={}\n", &top["visual-presets-".len()..]);
        let mut header = tar::Header::new_ustar();
        header.set_entry_type(tar::EntryType::XGlobalHeader);
        header.set_path("pax_global_header").unwrap();
        header.set_size(comment.len() as u64);
        header.set_mode(0o666);
        header.set_cksum();
        builder.append(&header, comment.as_bytes()).unwrap();
        for dir in ["", "! Transition/", "thumbnails/"] {
            let mut header = tar::Header::new_ustar();
            header.set_entry_type(tar::EntryType::Directory);
            header.set_path(format!("{top}/{dir}")).unwrap();
            header.set_size(0);
            header.set_mode(0o775);
            header.set_cksum();
            builder.append(&header, &[][..]).unwrap();
        }
        let preset = noise(3, 30_000);
        for (path, data) in [("README.md", &b"read me"[..]), ("LICENSE.md", b"licence"), ("! Transition/a.milk", &preset), ("index.json", br#"{"v":1}"#), ("thumbnails/ab.webp", b"RIFF")] {
            let mut header = tar::Header::new_ustar();
            header.set_path(format!("{top}/{path}")).unwrap();
            header.set_size(data.len() as u64);
            header.set_mode(0o664);
            header.set_cksum();
            builder.append(&header, data).unwrap();
        }
        let gz = builder.into_inner().unwrap().finish().unwrap();

        let dir = temp();
        let (mut last, mut size) = ((0, 0), 0);
        assert_eq!(fetch(&[at(serve(chunked(&gz)), 12_345)], &dir, |s| size = s, |r, n| last = (r, n)).unwrap(), 1);
        assert_eq!(size, 12_345, "no length from the server: the source's own figure");
        assert_eq!(last, (gz.len() as u64, 1));
        assert_eq!(std::fs::read(dir.join("! Transition/a.milk")).unwrap(), preset);
        assert_eq!(std::fs::read(dir.join("index.json")).unwrap(), br#"{"v":1}"#);
        assert_eq!(std::fs::read(dir.join("thumbnails/ab.webp")).unwrap(), b"RIFF");
        assert!(dir.join("README.md").is_file() && dir.join("LICENSE.md").is_file());
        assert!(!dir.join(top).exists() && !dir.join("pax_global_header").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fetch_fails_on_a_server_error() {
        let dir = temp();
        let url = serve(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec());
        let err = fetch(&[at(url, 1)], &dir, |_| {}, |_, _| {}).unwrap_err();
        assert!(err.contains("500"), "{err}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fetch_falls_back_when_the_bundle_cant_be_had() {
        let dir = temp();
        let gz = tar_gz(&[("top/S/a.milk", b"a")]);
        let mut sizes = Vec::new();
        assert_eq!(fetch(&[at(serve(not_found()), 1), nowhere(), at(serve(ok(&gz)), 2)], &dir, |s| sizes.push(s), |_, _| {}).unwrap(), 1);
        assert_eq!(sizes, [gz.len() as u64], "only the source that answered is sized");
        assert!(dir.join("S/a.milk").is_file());

        let err = fetch(&[at(serve(not_found()), 1), nowhere()], &dir, |_| {}, |_, _| {}).unwrap_err();
        assert!(err.contains("404") && err.contains("couldn't reach"), "both reasons: {err}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_bundle_url_takes_the_bundles_place_and_keeps_the_fallback() {
        let urls = |s: Vec<Source>| s.iter().map(|s| s.url).collect::<Vec<_>>();
        assert_eq!(urls(sources_with(None)), [BUNDLE.url, PROJECTM.url]);
        let local = "http://127.0.0.1:8765/cream-of-the-crop.tar.gz";
        assert_eq!(urls(sources_with(Some(local.into()))), [local, PROJECTM.url]);
    }

    #[test]
    fn a_cut_off_download_fails_and_a_retry_finishes_it() {
        let dir = temp();
        let files: Vec<(String, Vec<u8>)> = (0..6).map(|i| (format!("top/S/{i}.milk"), noise(i, 30_000))).collect();
        let gz = tar_gz(&files.iter().map(|(p, d)| (p.as_str(), &d[..])).collect::<Vec<_>>());
        // Broken off part-way, it isn't taken up from the fallback (which can't be reached).
        // The connection drops half-way: fewer bytes than the length the server gave.
        let mut cut = ok(&gz);
        cut.truncate(cut.len() - gz.len() / 2);
        let err = fetch(&[at(serve(cut), 1), nowhere()], &dir, |_| {}, |_, _| {}).unwrap_err();
        assert!(err.contains("broke off"), "{err}");
        assert!(parts(&dir).is_empty());
        assert!(!dir.join("S/5.milk").exists());
        assert_eq!(fetch(&[at(serve(ok(&gz)), 1)], &dir, |_| {}, |_, _| {}).unwrap(), 6);
        for (i, (_, data)) in files.iter().enumerate() {
            assert_eq!(&std::fs::read(dir.join(format!("S/{i}.milk"))).unwrap(), data);
        }
        assert!(parts(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A bundle's tar.gz: `presets` with an index of them.
    fn bundle_of(presets: &[(&str, &[u8])]) -> Vec<u8> {
        let index = index_of(presets, &[]);
        let mut files: Vec<(String, &[u8])> = presets.iter().map(|(p, d)| (format!("top/{p}"), *d)).collect();
        files.push(("top/index.json".into(), &index[..]));
        tar_gz(&files.iter().map(|(p, d)| (p.as_str(), *d)).collect::<Vec<_>>())
    }

    #[test]
    fn a_full_pack_is_brought_up_to_a_new_bundle_once() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let read = |p: &str| std::fs::read(dest.join(p)).ok();
        assert!(!stale(&dest, "any"), "no pack: nothing to bring up to date");
        // A first download cut off part-way isn't a full pack: the button finishes it.
        std::fs::create_dir_all(dest.join("A")).unwrap();
        std::fs::write(dest.join("A/a.milk"), b"a1").unwrap();
        assert!(!stale(&dest, "any"));

        let v1 = at(serve(ok(&bundle_of(&[("A/a.milk", b"a1"), ("B/gone.milk", b"gone")]))), 1);
        assert_eq!(fetch(&[v1], &dest, |_| {}, |_, _| {}).unwrap(), 2);
        assert_eq!(read(RECORD), Some(format!("{}\n", v1.url).into_bytes()), "the bundle unpacked is noted");
        assert!(!stale(&dest, v1.url), "the same commit: nothing to do");
        assert!(stale(&dest, "https://example.com/other.tar.gz"), "another commit: update");
        std::fs::remove_file(dest.join(RECORD)).unwrap();
        assert!(stale(&dest, v1.url), "no record (downloaded before it was kept): update");

        // The update: the download from the new bundle alone, as `update` does it.
        let v2 = at(serve(ok(&bundle_of(&[("A/a.milk", b"a2")]))), 1);
        assert!(stale(&dest, v2.url));
        assert_eq!(fetch(&[v2], &dest, |_| {}, |_, _| {}).unwrap(), 1);
        assert_eq!(read("A/a.milk").as_deref(), Some(&b"a2"[..]), "changed and untouched: replaced");
        assert_eq!(read("B/gone.milk"), None, "taken down: removed");
        assert!(!stale(&dest, v2.url), "done once");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_update_leaves_the_pack_as_it_is_to_try_again() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let v1 = at(serve(ok(&bundle_of(&[("A/a.milk", b"a1"), ("B/gone.milk", b"gone")]))), 1);
        fetch(&[v1], &dest, |_| {}, |_, _| {}).unwrap();
        let before = |p: &str| std::fs::read(dest.join(p)).unwrap();
        let (a, gone, index, record) = (before("A/a.milk"), before("B/gone.milk"), before(INDEX), before(RECORD));

        // The server says no.
        let v2 = at(serve(not_found()), 1);
        assert!(fetch(&[v2], &dest, |_| {}, |_, _| {}).is_err());
        assert_eq!((before("A/a.milk"), before("B/gone.milk"), before(INDEX), before(RECORD)), (a, gone.clone(), index.clone(), record.clone()), "nothing changed");
        // The download breaks off part-way through a bundle that drops a preset.
        let gz = bundle_of(&[("A/a.milk", &noise(5, 30_000)[..]), ("C/new.milk", &noise(6, 30_000)[..])]);
        let mut cut = ok(&gz);
        cut.truncate(cut.len() - gz.len() / 2);
        let v3 = at(serve(cut), 1);
        assert!(fetch(&[v3], &dest, |_| {}, |_, _| {}).is_err());

        assert_eq!(before("B/gone.milk"), gone, "nothing removed");
        assert_eq!(before(INDEX), index);
        assert_eq!(before(RECORD), record, "still the old bundle's, so the next launch tries again");
        assert!(stale(&dest, v3.url));
        assert!(parts(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_update_doesnt_start_while_a_download_runs() {
        assert!(begin(None), "nothing running: it starts");
        assert!(!begin(Some(9795)), "a first download runs: the update waits for the next launch");
        DOWNLOAD.lock().unwrap().state = State::Idle;
    }

    #[test]
    fn a_quiet_update_reads_as_installed_so_no_pack_bar_shows() {
        let d = Download { state: State::Downloading, received: 0, error: None, installed: quiet_count(120), size: 1 };
        let s = status(&d, 0, d.installed);
        assert!(s.installed >= s.total, "deleted presets: still shown as in");
        assert_eq!(quiet_count(TOTAL + 5), TOTAL + 5);
    }

    #[test]
    fn the_quiet_update_skips_headless_and_debug_runs() {
        assert!(updates(false, false, false), "a release build updates");
        assert!(!updates(true, false, false), "headless: no update");
        assert!(!updates(false, true, false), "debug: no update");
        assert!(updates(true, true, true), "debug with VISUALS_PACK_UPDATE=1: updates");
    }

    #[test]
    fn a_rename_that_only_changes_case_keeps_the_preset() {
        let dir = temp();
        let dest = dir.join("cream-of-the-crop");
        let milks = |d: &Path| std::fs::read_dir(d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".milk")).collect::<Vec<_>>();
        assert_eq!(extract(&bundle_of(&[("A/Foo.milk", b"foo"), ("A/Bar.milk", b"bar")])[..], &dest, |_| {}).unwrap(), 2);
        // Renamed only in case, one as it was and one changed too.
        assert_eq!(extract(&bundle_of(&[("A/foo.milk", b"foo"), ("A/bar.milk", b"bar 2")])[..], &dest, |_| {}).unwrap(), 2);
        let mut names = milks(&dest.join("A"));
        names.sort();
        assert_eq!(names, ["bar.milk", "foo.milk"], "each kept once, under its new name");
        assert_eq!(std::fs::read(dest.join("A/foo.milk")).unwrap(), b"foo");
        assert_eq!(std::fs::read(dest.join("A/bar.milk")).unwrap(), b"bar 2");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The real download of [`BUNDLE`], over the network: `cargo test -p visuals-app
    /// the_real_pack -- --ignored`. `VISUALS_PACK_URL=<url>` downloads a bundle from
    /// elsewhere instead (a local server, to try one before it's pushed; its size
    /// isn't checked against [`BUNDLE`]'s). `VISUALS_PACK_INTO=<presets folder>`
    /// keeps it there (in `cream-of-the-crop/`), to start the app on; otherwise
    /// it's removed.
    #[test]
    #[ignore]
    fn the_real_pack_downloads_whole_with_its_index_and_thumbnails() {
        let url = std::env::var("VISUALS_PACK_URL").ok();
        let source = url.clone().map_or(BUNDLE, |u| at(u, 0));
        let keep = std::env::var_os("VISUALS_PACK_INTO").map(PathBuf::from);
        let presets = keep.clone().unwrap_or_else(temp);
        let (mut received, mut size) = (0, 0);
        assert_eq!(fetch(&[source], &presets.join(FOLDER), |s| size = s, |r, _| received = r).unwrap(), TOTAL);
        eprintln!("received {received} bytes; size shown {size}");
        if url.is_none() {
            // GitHub may not say the archive's length, so the bar runs on
            // BUNDLE.size: it should be close enough to fill it.
            assert!(received.abs_diff(BUNDLE.size) < BUNDLE.size / 20, "BUNDLE.size {} is within 5% of the archive's {received} bytes", BUNDLE.size);
        }
        assert_eq!(engine::preset::milk_files(&presets).len(), TOTAL);
        assert!(covers(&presets, &Path::new(env!("CARGO_MANIFEST_DIR")).join("presets/starter")));
        let pack = presets.join(FOLDER);
        let index = engine::index::Index::load(&pack.join(INDEX)).expect("an index.json of this version");
        assert_eq!(index.rows.len(), TOTAL);
        let thumbnails: Vec<&String> = index.rows.iter().filter_map(|r| r.thumbnail.as_ref()).collect();
        assert!(thumbnails.len() > TOTAL * 99 / 100, "{} of {TOTAL} have thumbnails", thumbnails.len());
        for t in thumbnails {
            assert!(pack.join(THUMBNAILS).join(t).is_file(), "{t}");
        }
        if keep.is_none() {
            std::fs::remove_dir_all(&presets).unwrap();
        }
    }

    /// The same for the fallback, [`PROJECTM`]: `cargo test -p visuals-app
    /// the_fallback_pack -- --ignored`.
    #[test]
    #[ignore]
    fn the_fallback_pack_downloads_whole() {
        let presets = temp();
        let (mut received, mut size) = (0, 0);
        assert_eq!(fetch(&[PROJECTM], &presets.join(FOLDER), |s| size = s, |r, _| received = r).unwrap(), TOTAL);
        assert_eq!((received, size), (PROJECTM.size, PROJECTM.size));
        assert_eq!(engine::preset::milk_files(&presets).len(), TOTAL);
        std::fs::remove_dir_all(&presets).unwrap();
    }

    #[test]
    fn an_empty_presets_folder_still_lists_and_resolves_the_starter_set() {
        let dir = temp();
        let presets = dir.join("presets");
        let starter = dir.join("starter");
        std::fs::create_dir_all(&presets).unwrap();
        std::fs::create_dir_all(starter.join("a")).unwrap();
        std::fs::write(starter.join("a/one.milk"), "").unwrap();
        let folders = vec![presets.clone(), starter.clone()];
        assert_eq!(milk_files_in(&folders), vec![starter.join("a/one.milk")]);
        assert_eq!(resolve_in(&folders, Path::new("a/one.milk")), starter.join("a/one.milk"));
        assert_eq!(resolve_in(&folders, Path::new("b.milk")), presets.join("b.milk"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_preset_in_both_folders_is_listed_once_and_the_starter_set_drops_out_when_covered() {
        let dir = temp();
        let presets = dir.join("presets");
        let starter = dir.join("starter");
        for f in ["a/one.milk", "a/two.milk"] {
            std::fs::create_dir_all(starter.join(f).parent().unwrap()).unwrap();
            std::fs::write(starter.join(f), "").unwrap();
        }
        std::fs::create_dir_all(presets.join("a")).unwrap();
        std::fs::write(presets.join("a/one.milk"), "").unwrap();
        std::fs::write(presets.join("mine.milk"), "").unwrap();
        let folders = vec![presets.clone(), starter.clone()];
        let mut listed = milk_files_in(&folders);
        listed.sort();
        assert_eq!(listed, vec![presets.join("a/one.milk"), presets.join("mine.milk"), starter.join("a/two.milk")]);
        assert!(!covers(&presets, &starter));
        std::fs::write(presets.join("a/two.milk"), "").unwrap();
        assert!(covers(&presets, &starter));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn starter_playlists_are_made_only_on_a_fresh_file_and_follow_the_pack() {
        let dir = temp();
        let presets = dir.join("presets");
        let starter = dir.join("starter");
        std::fs::create_dir_all(starter.join("cream-of-the-crop/A")).unwrap();
        std::fs::write(starter.join("cream-of-the-crop/A/one.milk"), "").unwrap();
        std::fs::write(starter.join("playlists.json"), r#"{"version":1,"playlists":[{"name":"Chill","presets":["cream-of-the-crop/A/one.milk"]},{"name":"Peak time","presets":[]}]}"#).unwrap();
        let file = dir.join("playlists.json");

        let mut store = crate::playlists::Store::open(file.clone(), presets.clone());
        assert_eq!(seed_playlists(&mut store, &starter, false).unwrap(), 0);
        assert!(store.lists.is_empty() && !file.exists());

        assert_eq!(seed_playlists(&mut store, &starter, true).unwrap(), 2);
        let mut store = crate::playlists::Store::open(file.clone(), presets.clone());
        store.add_folder(starter.clone());
        assert_eq!(store.lists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["Chill", "Peak time"]);
        assert_eq!(store.lists[0].presets, ["cream-of-the-crop/A/one.milk"]);
        let id = store.lists[0].id.clone();
        assert_eq!(store.paths(&id), [starter.join("cream-of-the-crop/A/one.milk")]);
        std::fs::create_dir_all(presets.join("cream-of-the-crop/A")).unwrap();
        std::fs::write(presets.join("cream-of-the-crop/A/one.milk"), "").unwrap();
        assert_eq!(store.paths(&id), [presets.join("cream-of-the-crop/A/one.milk")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn adding_copies_presets_without_overwriting() {
        let dir = temp();
        let presets = dir.join("presets");
        let drop = dir.join("drop");
        std::fs::create_dir_all(drop.join("Mine/sub")).unwrap();
        std::fs::write(drop.join("solo.milk"), "solo").unwrap();
        std::fs::write(drop.join("Mine/a.milk"), "a").unwrap();
        std::fs::write(drop.join("Mine/sub/b.milk"), "b").unwrap();
        std::fs::write(drop.join("Mine/notes.txt"), "no").unwrap();
        std::fs::write(drop.join("other.txt"), "no").unwrap();
        let path = |p: &Path| Added::Path { path: p.to_string_lossy().into_owned() };
        let file = |name: &str, text: &str| Added::File { name: name.into(), text: text.into() };

        let items = [path(&drop.join("solo.milk")), path(&drop.join("Mine")), path(&drop.join("other.txt")), file("Picked/sub/c.milk", "c"), file("Picked/x.txt", "x")];
        assert_eq!(add(&items, &presets).unwrap(), 4);
        assert_eq!(std::fs::read_to_string(presets.join("solo.milk")).unwrap(), "solo");
        assert_eq!(std::fs::read_to_string(presets.join("Mine/a.milk")).unwrap(), "a");
        assert_eq!(std::fs::read_to_string(presets.join("Mine/sub/b.milk")).unwrap(), "b");
        assert_eq!(std::fs::read_to_string(presets.join("Picked/sub/c.milk")).unwrap(), "c");
        assert!(!presets.join("Mine/notes.txt").exists() && !presets.join("other.txt").exists() && !presets.join("Picked/x.txt").exists());

        // The same again: nothing new. Different content: a numbered copy.
        assert_eq!(add(&items, &presets).unwrap(), 0);
        assert_eq!(add(&[file("solo.milk", "another")], &presets).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(presets.join("solo.milk")).unwrap(), "solo");
        assert_eq!(std::fs::read_to_string(presets.join("solo (2).milk")).unwrap(), "another");
        assert_eq!(add(&[file("solo.milk", "third")], &presets).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(presets.join("solo (3).milk")).unwrap(), "third");
        assert_eq!(add(&[file("solo.milk", "another")], &presets).unwrap(), 0);

        // Names that climb out are ignored; nothing to add is an error.
        assert!(add(&[file("../out.milk", "x"), file("/abs.milk", "x")], &presets).is_err());
        assert!(!dir.join("out.milk").exists());
        assert!(add(&[path(&drop.join("other.txt"))], &presets).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn added_items_read_from_the_page() {
        let items: Vec<Added> = serde_json::from_str(r#"[{"path":"/a/b.milk"},{"name":"F/c.milk","text":"t"}]"#).unwrap();
        assert!(matches!(&items[0], Added::Path { path } if path == "/a/b.milk"));
        assert!(matches!(&items[1], Added::File { name, text } if name == "F/c.milk" && text == "t"));
    }

    #[test]
    fn changes_are_told_once_quiet_and_at_least_every_second() {
        let t = Instant::now();
        let ms = |n| t + Duration::from_millis(n);
        let mut d = Debounce::default();
        assert_eq!(d.due(), None);
        assert!(!d.fire(ms(5000)));
        d.change(ms(0));
        d.change(ms(100));
        assert_eq!(d.due(), Some(ms(400)));
        assert!(!d.fire(ms(399)));
        assert!(d.fire(ms(400)));
        assert!(!d.fire(ms(401)));
        // A steady stream of changes is still told every second.
        for n in (1000..2500).step_by(100) {
            d.change(ms(n));
            if n == 2000 {
                assert!(d.fire(ms(n)));
            } else {
                assert!(!d.fire(ms(n)), "{n}");
            }
        }
        assert_eq!(d.due(), Some(ms(2700)));
    }

    #[test]
    fn the_bundled_starter_set_mirrors_the_pack() {
        let starter = Path::new(env!("CARGO_MANIFEST_DIR")).join("presets/starter");
        let pack = starter.join(FOLDER);
        assert_eq!(engine::preset::milk_files(&starter).len(), 250);
        for style in ["Dancer", "Drawing", "Fractal", "Geometric", "Hypnotic", "Particles", "Reaction", "Sparkle", "Supernova", "Waveform"] {
            assert_eq!(engine::preset::milk_files(&pack.join(style)).len(), 25, "{style}");
        }
        assert!(engine::preset::milk_files(&pack.join("! Transition")).is_empty());
        assert!(pack.join("README.md").is_file() && pack.join("LICENSE.md").is_file());
        let seed: Seed = serde_json::from_slice(&std::fs::read(starter.join("playlists.json")).unwrap()).unwrap();
        assert_eq!(seed.playlists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["Chill", "Warm up", "Peak time"]);
        for p in seed.playlists.iter().flat_map(|l| &l.presets) {
            assert!(p.starts_with("cream-of-the-crop/") && starter.join(p).is_file(), "{p}");
        }
    }
}
