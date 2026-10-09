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
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

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
struct Root {
    label: &'static str,
    dir: PathBuf,
}

/// The folders the library lists, labelled: `presets` and maybe `starter`.
fn roots(app: &AppHandle) -> Vec<Root> {
    let starter = crate::pack::starter(app);
    crate::pack::folders(app).into_iter().map(|dir| Root { label: if Some(&dir) == starter.as_ref() { "starter" } else { "presets" }, dir }).collect()
}

/// Every preset the library lists, with what its index says of it.
#[tauri::command]
pub async fn library_index(handle: AppHandle) -> Vec<Row> {
    rows_in(&roots(&handle))
}

/// The rows for `roots`, in order: a preset at a key an earlier root already
/// has is left out. Sorted by key.
fn rows_in(roots: &[Root]) -> Vec<Row> {
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
                let thumbnail = r.thumbnail.map(|t| url(root.label, &pack, &t));
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
    rows.sort_by(|a, b| a.key.cmp(&b.key));
    rows
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
    let mut roots = roots(app);
    if !roots.iter().any(|r| r.label == "presets") {
        roots.push(Root { label: "presets", dir: app.state::<App>().library.clone() });
    }
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
        let rows = rows_in(&[Root { label: "presets", dir: presets.clone() }, Root { label: "starter", dir: starter.clone() }]);
        let _ = std::fs::remove_dir_all(&root);

        let keys: Vec<_> = rows.iter().map(|r| (r.key.as_str(), r.starter)).collect();
        assert_eq!(keys, [("loose.milk", false), ("pack/Dancer/Whirl/ORB - Xenon.milk", false), ("pack/Fractal/a - b.milk", true), ("pack/Sparkle/Geiss - Hand Added.milk", false)]);
        let xenon = &rows[1];
        assert_eq!(xenon.path, presets.join("pack/Dancer/Whirl/ORB - Xenon.milk").to_string_lossy());
        assert_eq!((xenon.style.as_str(), xenon.sub_style.as_deref()), ("Dancer", Some("Whirl")));
        assert_eq!(xenon.thumbnail.as_deref(), Some(url("presets", "pack", "29.webp").as_str()));
        assert_eq!(rows[2].thumbnail.as_deref(), Some(url("starter", "pack", "18.webp").as_str()));
        let added = &rows[3];
        assert_eq!((added.style.as_str(), added.hash.as_str(), added.thumbnail.is_none()), ("Sparkle", "", true));
        assert_eq!(added.authors, ["geiss"]);
        assert_eq!(rows[0].style, "");
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
