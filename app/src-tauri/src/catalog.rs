//! The library's index as the page browses it: one [`Row`] per preset, from the
//! `index.json` the `index` bin writes (`engine::index`), with its thumbnail
//! served to the page over the `thumb:` scheme ([`serve`]).
//!
//! Each folder the app knows ([`crate::pack::folders`]: the presets folder, and
//! the bundled starter set while the presets folder doesn't have all of it)
//! holds packs in sub-folders (`cream-of-the-crop/`), and each pack its own
//! `index.json` and `thumbnails/` beside its style folders. A preset no index
//! lists (a file added by hand, a pack not indexed yet) still gets a row, with
//! its style and name read from its path and no look or thumbnail.

use crate::App;
use engine::index::{Index, Look};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Once};
use tauri::{AppHandle, Listener, Manager};

/// The URI scheme thumbnails are served on (`main.rs` registers it).
pub const SCHEME: &str = "thumb";

/// A pack's thumbnails, beside its `index.json`.
const THUMBNAILS: &str = "thumbnails";

/// One preset in the library.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Row {
    /// Relative to its folder, `/`-separated (`cream-of-the-crop/Dancer/…/x.milk`):
    /// the same for a starter preset and the same one downloaded, so what the
    /// user keeps about a preset (`userlib`) is keyed by it.
    pub key: String,
    /// The file, to open.
    pub path: String,
    /// SHA-256 of the file in hex, as the index has it; empty when no index lists it.
    pub hash: String,
    pub style: String,
    pub sub_style: Option<String>,
    pub authors: Vec<String>,
    pub title: String,
    /// The thumbnail's URL for an `<img>`; `None` when there's none.
    pub thumbnail: Option<String>,
    /// `None` when it hasn't been drawn.
    pub look: Option<Look>,
    /// From the bundled starter set rather than the presets folder.
    pub starter: bool,
}

/// A folder of packs, and the name its thumbnails are served under.
#[derive(Clone)]
struct Root {
    label: &'static str,
    dir: PathBuf,
}

/// The folders the library lists, labelled: `presets` and maybe `starter`.
fn roots(app: &AppHandle) -> Vec<Root> {
    let starter = crate::pack::starter(app);
    crate::pack::folders(app).into_iter().map(|dir| Root { label: if Some(&dir) == starter.as_ref() { "starter" } else { "presets" }, dir }).collect()
}

/// [`roots`] as last worked out, for [`serve`]: working them out walks the
/// starter files, too slow for every thumbnail. Cleared on [`crate::pack::CHANGED`].
static CACHED: Mutex<Option<Vec<Root>>> = Mutex::new(None);
static LISTENING: Once = Once::new();

fn cached_roots(app: &AppHandle) -> Vec<Root> {
    LISTENING.call_once(|| {
        app.listen_any(crate::pack::CHANGED, |_| *CACHED.lock().unwrap() = None);
    });
    let mut cached = CACHED.lock().unwrap();
    cached.get_or_insert_with(|| roots(app)).clone()
}

/// Every preset the library lists, with what its index says of it.
#[tauri::command]
pub async fn library_index(handle: AppHandle) -> Vec<Row> {
    rows(&handle)
}

/// The rows [`library_index`] gives, worked out now; refreshes the roots
/// [`serve`] uses and the rows [`cached_rows`] gives.
pub fn rows(app: &AppHandle) -> Vec<Row> {
    listen(app);
    let generation = GENERATION.load(Ordering::SeqCst);
    let roots = roots(app);
    *CACHED.lock().unwrap() = Some(roots.clone());
    let rows = rows_in(&roots, &dropped_starter(app, &roots));
    let mut cached = ROWS.lock().unwrap();
    // Kept only when nothing changed while they were being worked out.
    if GENERATION.load(Ordering::SeqCst) == generation {
        *cached = Some(Arc::new(rows.clone()));
    }
    rows
}

/// [`rows`] as last worked out, for smart playlists and mood chips resolved in
/// Rust ([`crate::query`]): working them out walks the library and reads every
/// `index.json`. Forgotten when the presets change ([`crate::pack::CHANGED`])
/// or what the user keeps about them does ([`crate::userlib::CHANGED`]).
pub fn cached_rows(app: &AppHandle) -> Arc<Vec<Row>> {
    listen(app);
    if let Some(rows) = ROWS.lock().unwrap().clone() {
        return rows;
    }
    Arc::new(rows(app))
}

static ROWS: Mutex<Option<Arc<Vec<Row>>>> = Mutex::new(None);
/// Counts the changes that forget [`ROWS`], so rows worked out across one are not kept.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static LISTENING_ROWS: Once = Once::new();

fn listen(app: &AppHandle) {
    LISTENING_ROWS.call_once(|| {
        for event in [crate::pack::CHANGED, crate::userlib::CHANGED] {
            app.listen_any(event, |_| {
                GENERATION.fetch_add(1, Ordering::SeqCst);
                *ROWS.lock().unwrap() = None;
            });
        }
    });
}

/// The starter set as a root when it isn't one of `roots`: still the source of
/// thumbnails and looks for its presets downloaded but not yet indexed.
fn dropped_starter(app: &AppHandle, roots: &[Root]) -> Vec<Root> {
    crate::pack::starter(app).filter(|_| !roots.iter().any(|r| r.label == "starter")).map(|dir| Root { label: "starter", dir }).into_iter().collect()
}

/// What an index says of a key, and where its thumbnail lives.
struct Known {
    label: &'static str,
    pack: String,
    row: engine::index::Row,
}

/// The rows for `roots`, in order: a preset at a key an earlier root already
/// has is left out, but a copy no index lists takes what any root's index says
/// of its key (its look, and that root's thumbnail). Sorted curated picks
/// first, then by key (so by pack, then style): a curated pick is one of the
/// starter set's presets, from it or found again in the presets folder at a key
/// or with a content hash the starter set's index has, so it stays first once
/// the full pack is downloaded and the starter set drops out of the list.
/// `also` are folders only looked up for index data (the starter set once it
/// drops out of the list), never listed.
fn rows_in(roots: &[Root], also: &[Root]) -> Vec<Row> {
    let mut known: HashMap<String, Known> = HashMap::new();
    // The starter set's keys and content hashes: what makes a row curated.
    let mut starter_keys = HashSet::new();
    let mut starter_hashes = HashSet::new();
    for root in roots.iter().chain(also) {
        for (pack, index) in packs(&root.dir) {
            for r in index.rows {
                if root.label == "starter" {
                    starter_keys.insert(format!("{pack}/{}", r.path));
                    if !r.hash.is_empty() {
                        starter_hashes.insert(r.hash.clone());
                    }
                }
                known.entry(format!("{pack}/{}", r.path)).or_insert(Known { label: root.label, pack: pack.clone(), row: r });
            }
        }
    }
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for root in roots {
        let starter = root.label == "starter";
        let mut indexed = HashSet::new();
        for (pack, index) in packs(&root.dir) {
            for r in index.rows {
                let key = format!("{pack}/{}", r.path);
                let file = root.dir.join(&pack).join(&r.path);
                indexed.insert(file.clone());
                if !file.is_file() || !seen.insert(key.clone()) {
                    continue;
                }
                let thumbnail = thumbnail(root, &pack, r.thumbnail.as_deref());
                rows.push(Row {
                    key,
                    path: file.to_string_lossy().into_owned(),
                    hash: r.hash,
                    style: r.style,
                    sub_style: r.sub_style,
                    authors: r.authors,
                    title: r.title,
                    thumbnail,
                    look: r.look,
                    starter,
                });
            }
        }
        for file in engine::preset::milk_files(&root.dir) {
            let Ok(rel) = file.strip_prefix(&root.dir) else { continue };
            let key = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            if indexed.contains(&file) || !seen.insert(key.clone()) {
                continue;
            }
            if let Some(k) = known.get(&key) {
                let r = k.row.clone();
                let from = roots.iter().chain(also).find(|x| x.label == k.label).unwrap_or(root);
                rows.push(Row {
                    key,
                    path: file.to_string_lossy().into_owned(),
                    hash: r.hash,
                    style: r.style,
                    sub_style: r.sub_style,
                    authors: r.authors,
                    title: r.title,
                    thumbnail: thumbnail(from, &k.pack, r.thumbnail.as_deref()),
                    look: r.look,
                    starter,
                });
                continue;
            }
            // Within a pack, the style is the folder under the pack's.
            let mut parts = rel.components();
            let within = if rel.components().count() > 2 {
                parts.next();
                parts.as_path()
            } else {
                rel
            };
            let r = engine::index::row(within, String::new());
            rows.push(Row {
                key,
                path: file.to_string_lossy().into_owned(),
                hash: r.hash,
                style: r.style,
                sub_style: r.sub_style,
                authors: r.authors,
                title: r.title,
                thumbnail: None,
                look: None,
                starter,
            });
        }
    }
    let curated = |r: &Row| r.starter || starter_keys.contains(&r.key) || (!r.hash.is_empty() && starter_hashes.contains(&r.hash));
    rows.sort_by_cached_key(|r| (!curated(r), r.key.clone()));
    rows
}

/// The URL of `file` in `root`'s `pack`, only when that thumbnail exists.
fn thumbnail(root: &Root, pack: &str, file: Option<&str>) -> Option<String> {
    let file = file?;
    root.dir.join(pack).join(THUMBNAILS).join(file).is_file().then(|| url(root.label, pack, file))
}

/// The packs in `dir` with an `index.json` of this version, by folder name.
fn packs(dir: &Path) -> Vec<(String, Index)> {
    let mut out: Vec<(String, Index)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.')).then_some(())?;
            Some((name, Index::load(&e.path().join("index.json"))?))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// The URL a thumbnail is served at: `thumb://localhost/<root>/<pack>/<file>`
/// (`http://thumb.localhost/…` on Windows, as Tauri's custom schemes are).
fn url(label: &str, pack: &str, file: &str) -> String {
    let base = if cfg!(windows) { format!("http://{SCHEME}.localhost") } else { format!("{SCHEME}://localhost") };
    format!("{base}/{label}/{}/{}", encode(pack), encode(file))
}

/// Percent-encodes everything but unreserved characters.
fn encode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The thumbnail file a request's path names, under one of `roots`: only a
/// `.webp` in a pack's `thumbnails/` folder, never anywhere else.
fn thumbnail_file(roots: &[Root], path: &str) -> Option<PathBuf> {
    let parts: Vec<String> = path.trim_start_matches('/').split('/').map(decode).collect::<Option<_>>()?;
    let [label, pack, file] = parts.as_slice() else { return None };
    let plain = |s: &str| !s.is_empty() && !s.starts_with('.') && matches!(Path::new(s).components().collect::<Vec<_>>().as_slice(), [Component::Normal(_)]);
    if !plain(pack) || !plain(file) || !file.ends_with(".webp") {
        return None;
    }
    let root = roots.iter().find(|r| r.label == label)?;
    Some(root.dir.join(pack).join(THUMBNAILS).join(file)).filter(|f| f.is_file())
}

/// Answers a `thumb:` request with the thumbnail, or 404.
pub fn serve(app: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    // The presets folder is always served, even once the starter set drops out of the list.
    let mut roots = cached_roots(app);
    if !roots.iter().any(|r| r.label == "presets") {
        roots.push(Root { label: "presets", dir: app.state::<App>().library.clone() });
    }
    let also = dropped_starter(app, &roots);
    roots.extend(also);
    let found = thumbnail_file(&roots, request.uri().path()).and_then(|f| std::fs::read(f).ok());
    let response = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    match found {
        // Named by content hash, so a thumbnail never changes.
        Some(bytes) => response.header("Content-Type", "image/webp").header("Cache-Control", "max-age=31536000, immutable").body(bytes),
        None => response.status(404).body(Vec::new()),
    }
    .expect("a thumbnail response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::index::row;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("visuals-catalog-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn put(file: &Path, contents: &[u8]) {
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, contents).unwrap();
    }

    /// A pack at `dir/pack` with `rels`, indexed with a thumbnail each.
    fn indexed(dir: &Path, rels: &[&str]) {
        let mut index = Index::new(90);
        for rel in rels {
            put(&dir.join("pack").join(rel), b"[preset00]\n");
            let mut r = row(Path::new(rel), format!("{:0>64}", rel.len()));
            r.thumbnail = Some(format!("{}.webp", rel.len()));
            put(&dir.join("pack/thumbnails").join(r.thumbnail.as_ref().unwrap()), b"RIFF");
            index.rows.push(r);
        }
        index.save(&dir.join("pack/index.json")).unwrap();
    }

    #[test]
    fn rows_come_from_the_indexes_once_each_and_unindexed_presets_still_show() {
        let root = temp("rows");
        let (presets, starter) = (root.join("presets"), root.join("starter"));
        indexed(&presets, &["Dancer/Whirl/ORB - Xenon.milk"]);
        indexed(&starter, &["Dancer/Whirl/ORB - Xenon.milk", "Fractal/a - b.milk"]);
        put(&presets.join("pack/Sparkle/Geiss - Hand Added.milk"), b"");
        put(&presets.join("loose.milk"), b"");
        let rows = rows_in(&[Root { label: "presets", dir: presets.clone() }, Root { label: "starter", dir: starter.clone() }], &[]);
        let _ = std::fs::remove_dir_all(&root);

        let keys: Vec<_> = rows.iter().map(|r| (r.key.as_str(), r.starter)).collect();
        // The starter set's two come first (Xenon from the presets folder), then the rest by key.
        assert_eq!(keys, [("pack/Dancer/Whirl/ORB - Xenon.milk", false), ("pack/Fractal/a - b.milk", true), ("loose.milk", false), ("pack/Sparkle/Geiss - Hand Added.milk", false)]);
        let xenon = &rows[0];
        assert_eq!(xenon.path, presets.join("pack/Dancer/Whirl/ORB - Xenon.milk").to_string_lossy());
        assert_eq!((xenon.style.as_str(), xenon.sub_style.as_deref()), ("Dancer", Some("Whirl")));
        assert_eq!(xenon.thumbnail.as_deref(), Some(url("presets", "pack", "29.webp").as_str()));
        assert_eq!(rows[1].thumbnail.as_deref(), Some(url("starter", "pack", "18.webp").as_str()));
        let added = &rows[3];
        assert_eq!((added.style.as_str(), added.hash.as_str(), added.thumbnail.is_none()), ("Sparkle", "", true));
        assert_eq!(added.authors, ["geiss"]);
        assert_eq!(rows[2].style, "");
    }

    /// A pack at `dir/pack` with each `(rel, hash)` written and indexed, no thumbnails.
    fn hashed(dir: &Path, presets: &[(&str, &str)]) {
        let mut index = Index::new(90);
        for (rel, hash) in presets {
            put(&dir.join("pack").join(rel), b"[preset00]\n");
            index.rows.push(row(Path::new(rel), hash.to_string()));
        }
        index.save(&dir.join("pack/index.json")).unwrap();
    }

    #[test]
    fn curated_picks_come_first_then_the_rest_by_key_even_once_the_starter_set_drops_out() {
        let root = temp("curated");
        let (presets, starter) = (root.join("presets"), root.join("starter"));
        let (h1, h2) = ("1".repeat(64), "2".repeat(64));
        hashed(&starter, &[("Fractal/s.milk", &h1), ("Waveform/k.milk", &h2), ("Zoom/only.milk", &"3".repeat(64))]);
        // The full pack: one starter preset found again by hash at another path, one at its key but not indexed.
        hashed(&presets, &[("Aaa/x.milk", &"4".repeat(64)), ("Moved/elsewhere.milk", &h1), ("Zed/y.milk", &"5".repeat(64))]);
        put(&presets.join("pack/Waveform/k.milk"), b"[preset00]\n");
        let p = Root { label: "presets", dir: presets.clone() };
        let s = Root { label: "starter", dir: starter.clone() };
        let listed = rows_in(&[p.clone(), s.clone()], &[]);
        let dropped = rows_in(std::slice::from_ref(&p), &[s]);
        let _ = std::fs::remove_dir_all(&root);

        let keys = |rows: &[Row]| rows.iter().map(|r| r.key.clone()).collect::<Vec<_>>();
        assert_eq!(keys(&listed), ["pack/Fractal/s.milk", "pack/Moved/elsewhere.milk", "pack/Waveform/k.milk", "pack/Zoom/only.milk", "pack/Aaa/x.milk", "pack/Zed/y.milk"]);
        assert_eq!(keys(&dropped), ["pack/Moved/elsewhere.milk", "pack/Waveform/k.milk", "pack/Aaa/x.milk", "pack/Zed/y.milk"]);
        assert!(dropped.iter().all(|r| !r.starter));
    }

    #[test]
    fn an_unindexed_copy_of_a_starter_preset_keeps_its_thumbnail_and_look() {
        let root = temp("unindexed-copy");
        let (presets, starter) = (root.join("presets"), root.join("starter"));
        let rel = "Dancer/Whirl/ORB - Xenon.milk";
        indexed(&starter, &[rel]);
        let mut index = Index::load(&starter.join("pack/index.json")).unwrap();
        index.rows[0].look = Some(Look::new(vec![30], 0.5, None, 10.0));
        index.save(&starter.join("pack/index.json")).unwrap();
        put(&presets.join("pack").join(rel), b"[preset00]\n");
        let p = Root { label: "presets", dir: presets.clone() };
        let s = Root { label: "starter", dir: starter.clone() };
        let listed = rows_in(&[p.clone(), s.clone()], &[]);
        let dropped = rows_in(std::slice::from_ref(&p), &[s]);
        let _ = std::fs::remove_dir_all(&root);

        for rows in [listed, dropped] {
            assert_eq!(rows.len(), 1);
            let r = &rows[0];
            assert_eq!(r.path, presets.join("pack").join(rel).to_string_lossy());
            assert!(!r.starter);
            assert_eq!(r.thumbnail.as_deref(), Some(url("starter", "pack", "29.webp").as_str()));
            assert_eq!(r.look, Some(Look::new(vec![30], 0.5, None, 10.0)));
        }
    }

    #[test]
    fn a_missing_thumbnail_file_gives_no_url() {
        let root = temp("missing-thumb");
        indexed(&root, &["a.milk"]);
        std::fs::remove_file(root.join("pack/thumbnails/6.webp")).unwrap();
        let rows = rows_in(&[Root { label: "presets", dir: root.clone() }], &[]);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(rows[0].thumbnail, None);
    }

    #[test]
    fn urls_round_trip_and_only_thumbnails_are_served() {
        let root = temp("serve");
        put(&root.join("my pack/thumbnails/ab.webp"), b"RIFF");
        put(&root.join("my pack/index.json"), b"{}");
        put(&root.join("secret.webp"), b"no");
        let roots = [Root { label: "presets", dir: root.clone() }];
        let path = |u: String| u.split_once("localhost").unwrap().1.to_string();
        assert_eq!(thumbnail_file(&roots, &path(url("presets", "my pack", "ab.webp"))), Some(root.join("my pack/thumbnails/ab.webp")));
        for bad in [
            "/presets/my%20pack/missing.webp",
            "/presets/my%20pack/index.json",
            "/presets/..%2F..%2Fx/ab.webp",
            "/presets/../secret.webp",
            "/presets/my%20pack/..%2F..%2Fsecret.webp",
            "/starter/my%20pack/ab.webp",
            "/presets/ab.webp",
        ] {
            assert_eq!(thumbnail_file(&roots, bad), None, "{bad}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
