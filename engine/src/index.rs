//! The preset library's index: one [`Row`] per preset, saved as `index.json`
//! next to a folder of thumbnails. The `index` bin writes it (see
//! `engine/src/bin/index.rs`); the library reads it.
//!
//! A row holds what can be read from the file — its path, content hash, style
//! and sub-style (its folders), authors and title (its name, see [`authors`]) —
//! and, once the preset has been drawn, its [`Look`]: dominant hues, brightness,
//! speed and intensity, each of the last three also as a [`Level`].

pub mod authors;

pub use authors::{Name, UNKNOWN, parse_name};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The schema version written to `index.json`; a file with another is rebuilt.
pub const VERSION: u32 = 1;

/// The thumbnail size, in pixels.
pub const THUMBNAIL: (u32, u32) = (192, 144);

/// Low, mid or high, against a measure's [`Cuts`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Low,
    Mid,
    High,
}

/// Where a measure turns from low to mid and from mid to high: a value below
/// `.0` is low, below `.1` mid, otherwise high.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cuts(pub f32, pub f32);

impl Cuts {
    pub fn level(&self, v: f32) -> Level {
        if v < self.0 {
            Level::Low
        } else if v < self.1 {
            Level::Mid
        } else {
            Level::High
        }
    }

    /// The cuts splitting `values` into thirds; `None` for fewer than three.
    pub fn terciles(values: &[f32]) -> Option<Cuts> {
        let mut v: Vec<f32> = values.iter().copied().filter(|v| v.is_finite()).collect();
        if v.len() < 3 {
            return None;
        }
        v.sort_by(f32::total_cmp);
        Some(Cuts(v[v.len() / 3], v[2 * v.len() / 3]))
    }
}

// The cut points are the terciles of the full cream-of-the-crop pack (9,789
// presets drawn), as the `index` bin prints them; see "The preset index" in
// `docs/milkdrop-engine.md`. Levels are recomputed on every run, so changing
// these needs no redraw.

/// Brightness cut points: mean picture luma, 0–1.
pub const BRIGHTNESS: Cuts = Cuts(0.186, 0.434);
/// Speed cut points: mean block motion per step, in thumbnail pixels.
pub const SPEED: Cuts = Cuts(1.92, 4.81);
/// Intensity cut points: mean frame difference per step, luma 0–255.
pub const INTENSITY: Cuts = Cuts(6.97, 20.34);

/// What a preset looks like, measured from the pictures it draws.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Look {
    /// Dominant hues in degrees, the strongest first; empty when it's grey.
    pub hues: Vec<u16>,
    /// Mean luma, 0–1.
    pub brightness: f32,
    /// Mean block motion per step, in thumbnail pixels; `None` when there was
    /// nothing to follow (flat colour, noise or soft glows) — its level is then
    /// its intensity's.
    pub speed: Option<f32>,
    /// Mean frame difference per step, luma 0–255.
    pub intensity: f32,
    pub brightness_level: Level,
    pub speed_level: Level,
    pub intensity_level: Level,
}

impl Look {
    /// A look from its measures, levelled against the current cuts.
    pub fn new(hues: Vec<u16>, brightness: f32, speed: Option<f32>, intensity: f32) -> Look {
        let mut look = Look { hues, brightness, speed, intensity, brightness_level: Level::Low, speed_level: Level::Low, intensity_level: Level::Low };
        look.relevel();
        look
    }

    /// Sets the levels from the measures and the current cuts.
    pub fn relevel(&mut self) {
        self.brightness_level = BRIGHTNESS.level(self.brightness);
        self.intensity_level = INTENSITY.level(self.intensity);
        self.speed_level = self.speed.map_or(self.intensity_level, |s| SPEED.level(s));
    }
}

/// One preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Row {
    /// Relative to the indexed folder, `/`-separated.
    pub path: String,
    /// SHA-256 of the file's bytes, in hex.
    pub hash: String,
    /// Its first folder, and its second when it has one.
    pub style: String,
    pub sub_style: Option<String>,
    /// Canonical, case-folded, originals first then remixers and editors;
    /// [`UNKNOWN`] in place of an original the name doesn't credit.
    pub authors: Vec<String>,
    pub title: String,
    /// The thumbnail's file name in the thumbnail folder; `None` when it
    /// couldn't be drawn (see [`Index::skipped`]).
    pub thumbnail: Option<String>,
    /// `None` when it couldn't be drawn.
    pub look: Option<Look>,
}

/// A preset that couldn't be drawn, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skipped {
    pub path: String,
    pub hash: String,
    /// `timed out`, `failed: …`, `panicked` or `crashed`.
    pub why: String,
}

/// `index.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub version: u32,
    /// The thumbnails' size and the step they show.
    pub thumbnail: (u32, u32),
    pub frame: u32,
    /// Sorted by path.
    pub rows: Vec<Row>,
    /// Sorted by path.
    pub skipped: Vec<Skipped>,
}

impl Index {
    pub fn new(frame: u32) -> Index {
        Index { version: VERSION, thumbnail: THUMBNAIL, frame, rows: Vec::new(), skipped: Vec::new() }
    }

    /// Reads `index.json`; `None` when it's missing, unreadable or of another version.
    pub fn load(file: &Path) -> Option<Index> {
        let index: Index = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
        (index.version == VERSION).then_some(index)
    }

    /// Writes `index.json`, through a temporary file so a reader never sees half of it.
    pub fn save(&self, file: &Path) -> std::io::Result<()> {
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?)?;
        std::fs::rename(tmp, file)
    }
}

/// SHA-256 of `bytes`, in hex.
pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// The thumbnail file name for a preset with this hash.
pub fn thumbnail_name(hash: &str) -> String {
    format!("{}.webp", &hash[..hash.len().min(16)])
}

/// A row for the preset at `rel` (relative to the indexed folder) with
/// content `hash`, not yet drawn.
pub fn row(rel: &Path, hash: String) -> Row {
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let folders = &parts[..parts.len().saturating_sub(1)];
    let stem = rel.file_stem().unwrap_or_default().to_string_lossy();
    let Name { authors, title } = parse_name(&stem);
    Row { path: parts.join("/"), hash, style: folders.first().cloned().unwrap_or_default(), sub_style: folders.get(1).cloned(), authors, title, thumbnail: None, look: None }
}

/// `n` of `files` (sorted), evenly spaced: the same ones every time, spread
/// over the folders. All of them when there are no more than `n`.
pub fn sample(files: Vec<PathBuf>, n: usize) -> Vec<PathBuf> {
    if n >= files.len() {
        return files;
    }
    (0..n).map(|i| files[i * files.len() / n].clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_split_at_the_cuts() {
        let c = Cuts(1.0, 2.0);
        assert_eq!(c.level(0.5), Level::Low);
        assert_eq!(c.level(1.0), Level::Mid);
        assert_eq!(c.level(1.99), Level::Mid);
        assert_eq!(c.level(2.0), Level::High);
        assert_eq!(c.level(f32::NAN), Level::High);
    }

    #[test]
    fn terciles_split_into_thirds() {
        let v: Vec<f32> = (0..9).map(|i| i as f32).collect();
        let c = Cuts::terciles(&v).unwrap();
        assert_eq!(c, Cuts(3.0, 6.0));
        let levels: Vec<Level> = v.iter().map(|&x| c.level(x)).collect();
        for l in [Level::Low, Level::Mid, Level::High] {
            assert_eq!(levels.iter().filter(|&&x| x == l).count(), 3);
        }
        assert_eq!(Cuts::terciles(&[1.0, f32::NAN]), None);
    }

    #[test]
    fn speed_without_motion_takes_the_intensity_level() {
        let calm = Look::new(vec![], 0.5, None, 0.0);
        assert_eq!(calm.speed_level, Level::Low);
        let wild = Look::new(vec![], 0.5, None, 1000.0);
        assert_eq!(wild.speed_level, Level::High);
        assert_eq!(Look::new(vec![], 0.5, Some(1000.0), 0.0).speed_level, Level::High);
    }

    #[test]
    fn rows_take_style_and_name_from_the_path() {
        let r = row(Path::new("Dancer/Whirl Mirror/ORB - Xenon.milk"), "ab".repeat(32));
        assert_eq!(r.path, "Dancer/Whirl Mirror/ORB - Xenon.milk");
        assert_eq!((r.style.as_str(), r.sub_style.as_deref()), ("Dancer", Some("Whirl Mirror")));
        assert_eq!(r.title, parse_name("ORB - Xenon").title);
        let top = row(Path::new("! Transition/x.milk"), String::new());
        assert_eq!((top.style.as_str(), top.sub_style), ("! Transition", None));
    }

    #[test]
    fn hashes_and_thumbnail_names() {
        let h = hash(b"abc");
        assert_eq!(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(thumbnail_name(&h), "ba7816bf8f01cfea.webp");
    }

    #[test]
    fn the_schema_round_trips() {
        let mut index = Index::new(90);
        let mut r = row(Path::new("Fractal/Spiral/Geiss + Rovastar - Thing --- Isosceles edit.milk"), hash(b"x"));
        r.thumbnail = Some(thumbnail_name(&r.hash));
        r.look = Some(Look::new(vec![200, 30], 0.42, Some((SPEED.0 + SPEED.1) / 2.0), 6.25));
        index.rows.push(r.clone());
        let mut hung = row(Path::new("Waveform/Hang/a - b.milk"), hash(b"y"));
        hung.look = None;
        index.rows.push(hung.clone());
        index.skipped.push(Skipped { path: hung.path.clone(), hash: hung.hash.clone(), why: "timed out".into() });
        let json = serde_json::to_string(&index).unwrap();
        assert!(json.contains("\"speed_level\":\"mid\""), "{json}");
        let back: Index = serde_json::from_str(&json).unwrap();
        assert_eq!(back, index);

        let dir = std::env::temp_dir().join(format!("visuals-index-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("index.json");
        index.save(&file).unwrap();
        assert_eq!(Index::load(&file), Some(index.clone()));
        let mut old = index;
        old.version = VERSION + 1;
        old.save(&file).unwrap();
        assert_eq!(Index::load(&file), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn samples_are_spread_and_stable() {
        let files: Vec<PathBuf> = (0..10).map(|i| PathBuf::from(format!("{i}"))).collect();
        let s = sample(files.clone(), 3);
        assert_eq!(s, vec![PathBuf::from("0"), PathBuf::from("3"), PathBuf::from("6")]);
        assert_eq!(sample(files.clone(), 20), files);
    }
}
