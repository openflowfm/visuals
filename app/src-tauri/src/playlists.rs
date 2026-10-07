//! Playlists: named, ordered lists of presets, kept in one JSON file.
//!
//! The file is `~/.openflow/visuals/playlists.json` (`OPENFLOW_VISUALS_PLAYLISTS`
//! overrides). Presets inside the library are stored relative to it, with `/`
//! between folders, so the library can move; anything outside it is stored whole.
//! A playlist's position in the file is its number, which is how live control
//! (`actions::Action::Load`) picks one.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Playlist {
    /// Stable across renames and reorders; what the page names a playlist by.
    pub id: String,
    pub name: String,
    /// Library-relative paths (or absolute ones outside the library), in order.
    /// The same preset may appear more than once.
    pub presets: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    version: u32,
    playlists: Vec<Playlist>,
}

pub struct Store {
    file: PathBuf,
    library: PathBuf,
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
}

#[derive(Serialize, Clone, Debug)]
pub struct View {
    pub id: String,
    pub name: String,
    pub items: Vec<Item>,
}

/// Where playlists live unless `OPENFLOW_VISUALS_PLAYLISTS` says otherwise.
pub fn default_file() -> PathBuf {
    std::env::var_os("OPENFLOW_VISUALS_PLAYLISTS")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/playlists.json"))
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

impl Store {
    /// Read the file; a missing one is an empty store. A file that will not parse is
    /// moved aside (`.bad`) rather than overwritten by the next save.
    pub fn open(file: PathBuf, library: PathBuf) -> Store {
        let lists = match std::fs::read(&file) {
            Ok(bytes) => match serde_json::from_slice::<File>(&bytes) {
                Ok(f) => f.playlists,
                Err(e) => {
                    let aside = file.with_extension("json.bad");
                    eprintln!("playlists: {} does not parse ({e}); moved to {}", file.display(), aside.display());
                    let _ = std::fs::rename(&file, &aside);
                    Vec::new()
                }
            },
            Err(_) => Vec::new(),
        };
        Store { file, library, lists }
    }

    /// Write the whole file, through a temporary file so a crash never leaves half of one.
    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(&File { version: 1, playlists: self.lists.clone() }).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }

    /// How a preset is written in the file.
    pub fn relative(&self, path: &Path) -> String {
        match path.strip_prefix(&self.library) {
            Ok(rel) => rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"),
            Err(_) => path.to_string_lossy().into_owned(),
        }
    }

    /// Where a preset written in the file is now.
    pub fn resolve(&self, stored: &str) -> PathBuf {
        let p = Path::new(stored);
        if p.is_absolute() { p.to_path_buf() } else { self.library.join(p) }
    }

    pub fn position(&self, id: &str) -> Option<usize> {
        self.lists.iter().position(|l| l.id == id)
    }

    fn get(&mut self, id: &str) -> Result<&mut Playlist, String> {
        self.lists.iter_mut().find(|l| l.id == id).ok_or_else(|| format!("no playlist {id}"))
    }

    pub fn create(&mut self, name: &str) -> Result<String, String> {
        let id = new_id();
        self.lists.push(Playlist { id: id.clone(), name: clean_name(name)?, presets: Vec::new() });
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

    /// Put `path` into playlist `id` at `at` (the end when absent or past it).
    pub fn add(&mut self, id: &str, path: &Path, at: Option<usize>) -> Result<(), String> {
        let stored = self.relative(path);
        let list = self.get(id)?;
        let at = at.unwrap_or(list.presets.len()).min(list.presets.len());
        list.presets.insert(at, stored);
        Ok(())
    }

    pub fn remove(&mut self, id: &str, index: usize) -> Result<(), String> {
        let list = self.get(id)?;
        if index >= list.presets.len() {
            return Err(format!("{} has no item {index}", list.name));
        }
        list.presets.remove(index);
        Ok(())
    }

    /// Move item `from` of playlist `id` so it ends up at `to`.
    pub fn move_item(&mut self, id: &str, from: usize, to: usize) -> Result<(), String> {
        let list = self.get(id)?;
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

    /// Playlist `id`'s items as files.
    pub fn paths(&self, id: &str) -> Vec<PathBuf> {
        self.lists.iter().find(|l| l.id == id).map(|l| l.presets.iter().map(|s| self.resolve(s)).collect()).unwrap_or_default()
    }

    pub fn views(&self) -> Vec<View> {
        self.lists
            .iter()
            .map(|l| View {
                id: l.id.clone(),
                name: l.name.clone(),
                items: l
                    .presets
                    .iter()
                    .map(|s| {
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
                        }
                    })
                    .collect(),
            })
            .collect()
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
    fn round_trips_with_library_relative_paths() {
        let dir = temp();
        let mut s = Store::open(dir.join("playlists.json"), dir.join("lib"));
        assert!(s.lists.is_empty());
        let id = s.create(" Set one ").unwrap();
        s.add(&id, &dir.join("lib/a/one.milk"), None).unwrap();
        s.add(&id, Path::new("/elsewhere/two.milk"), None).unwrap();
        s.save().unwrap();

        let text = std::fs::read_to_string(dir.join("playlists.json")).unwrap();
        assert!(text.contains("\"a/one.milk\""), "{text}");

        // The library moved: the relative item follows it, the outside one stays.
        std::fs::rename(dir.join("lib"), dir.join("moved")).unwrap();
        let s = Store::open(dir.join("playlists.json"), dir.join("moved"));
        assert_eq!(s.lists[0].name, "Set one");
        let views = s.views();
        assert_eq!(views[0].items[0].path, dir.join("moved/a/one.milk").to_string_lossy());
        assert_eq!(views[0].items[0].name, "one");
        assert_eq!(views[0].items[0].group, "a");
        assert!(!views[0].items[0].missing);
        assert_eq!(views[0].items[1].path, "/elsewhere/two.milk");
        assert!(views[0].items[1].missing);
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
    fn a_broken_file_is_moved_aside_not_lost() {
        let dir = temp();
        std::fs::write(dir.join("p.json"), "{ not json").unwrap();
        let s = Store::open(dir.join("p.json"), dir.join("lib"));
        assert!(s.lists.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("p.json.bad")).unwrap(), "{ not json");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
