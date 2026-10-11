//! Raw measurements of what each preset draws, for fitting tags (Red, Busy,
//! Tunnel, Reactive…) against hand labels: `features.json`, written by the
//! `features` bin (`engine/src/bin/features.rs`), next to a folder of clips.
//!
//! Each preset is drawn at [`SIZE`], one step a frame, for [`STEPS`] steps
//! under four [`Condition`]s with the same seed: to the measuring bins'
//! synthetic music, in silence, and to the music with its waves, then its
//! shapes, left out. The [`Collector`] measures those pictures into the
//! features [`NAMES`] lists, each described there and in the file; a feature
//! that can't be measured (a grey picture has no hue shares, a still one no
//! motion coherence) is `null`.

use crate::analyse::{self, field, palette::Palette, series, texture};
use crate::draw::Hide;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

/// The schema version of `features.json`; a file with another starts afresh.
pub const VERSION: u32 = 1;
/// The version of the drawing and measuring. Bump it when either changes what
/// a feature or a clip comes out as; the next run redraws every row.
pub const ANALYSIS: u32 = 1;
/// The size presets are drawn at.
pub const SIZE: (u32, u32) = (384, 288);
/// Pictures shrunk to this for colour, motion, symmetry and the clip.
pub const SMALL: (usize, usize) = (192, 144);
/// How long each condition is drawn, in seconds, and so in steps (30 a second).
pub const SECONDS: u32 = 10;
pub const STEPS: u32 = SECONDS * 30;
/// The first step measured: the first second, while a preset settles out of
/// black, is left out.
pub const FROM: u32 = 31;
/// Every this many steps a picture's colour, detail and symmetry are measured…
const SPATIAL: u32 = 10;
/// …and its block motion, and the other conditions compared with the music's.
const SPARSE: u32 = 3;
/// Steps per beat of [`analyse::music`] (120 bpm at 30 steps a second).
pub const BEAT: usize = 15;
/// The seed every condition loads with.
pub const SEED: u64 = 1;

/// The clip: a horizontal sprite sheet of `frames` pictures `size`, `fps` a
/// second, from the music run starting at step [`CLIP_FROM`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clip {
    pub frames: u32,
    pub fps: u32,
    pub size: [u32; 2],
}
pub const CLIP: Clip = Clip { frames: 24, fps: 12, size: [192, 144] };
pub const CLIP_FROM: u32 = 90;
/// The clip's WebP quality, 0–100.
pub const CLIP_QUALITY: f32 = 75.0;

/// The steps the clip's frames show: [`CLIP_FROM`], then every 1/fps second.
pub fn clip_steps() -> Vec<u32> {
    (0..CLIP.frames).map(|i| CLIP_FROM + (i as f64 * 30.0 / CLIP.fps as f64).floor() as u32).collect()
}

/// The clip's file name for a preset with this hash.
pub fn clip_name(hash: &str) -> String {
    format!("{}.webp", &hash[..hash.len().min(16)])
}

/// What a preset is drawn under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Condition {
    Music,
    Silence,
    NoWaves,
    NoShapes,
}

impl Condition {
    /// In the order they're drawn: the music first, which the others are compared with.
    pub const ALL: [Condition; 4] = [Condition::Music, Condition::Silence, Condition::NoWaves, Condition::NoShapes];

    pub fn name(self) -> &'static str {
        match self {
            Condition::Music => "music",
            Condition::Silence => "silence",
            Condition::NoWaves => "no_waves",
            Condition::NoShapes => "no_shapes",
        }
    }

    /// Whether it hears the music (otherwise silence).
    pub fn hears(self) -> bool {
        self != Condition::Silence
    }

    pub fn hide(self) -> Hide {
        Hide { waves: self == Condition::NoWaves, shapes: self == Condition::NoShapes }
    }
}

/// Every feature, and what it is.
pub const NAMES: [(&str, &str); 51] = [
    ("hue_red", "share of the coloured weight (saturation × value) at hues 345–15°; null when grey"),
    ("hue_orange", "share of the coloured weight at hues 15–45°; null when grey"),
    ("hue_yellow", "share of the coloured weight at hues 45–75°; null when grey"),
    ("hue_chartreuse", "share of the coloured weight at hues 75–105°; null when grey"),
    ("hue_green", "share of the coloured weight at hues 105–135°; null when grey"),
    ("hue_spring", "share of the coloured weight at hues 135–165°; null when grey"),
    ("hue_cyan", "share of the coloured weight at hues 165–195°; null when grey"),
    ("hue_azure", "share of the coloured weight at hues 195–225°; null when grey"),
    ("hue_blue", "share of the coloured weight at hues 225–255°; null when grey"),
    ("hue_violet", "share of the coloured weight at hues 255–285°; null when grey"),
    ("hue_magenta", "share of the coloured weight at hues 285–315°; null when grey"),
    ("hue_rose", "share of the coloured weight at hues 315–345°; null when grey"),
    ("colour_weight", "mean saturation × value of the coloured pixels per pixel (saturation ≥ 0.25, value ≥ 0.2), 0 grey to 1"),
    ("colourfulness", "Hasler–Süsstrunk colourfulness / 100: 0 grey, ~0.3 moderate, ≥1 extreme"),
    ("hue_temperature", "weighted mean cosine of each hue from orange (30°): 1 warm, −1 cold (azure); null when grey"),
    ("hue_spread", "1 − length of the weighted mean hue vector: 0 one hue, 1 every hue or opposites; null when grey"),
    ("pale_bright", "share of pixels bright and nearly grey (value > 0.6, saturation < 0.2): white, silver, chrome"),
    ("brightness", "mean luma 0–1 over every measured step"),
    ("brightness_p05", "5th percentile of pixel luma 0–1"),
    ("brightness_p95", "95th percentile of pixel luma 0–1"),
    ("dark_share", "share of pixels nearly black (value < 0.08)"),
    ("centre_vs_edge", "mean luma of the middle half (each way) minus the rest, −1–1: positive bright centre"),
    ("local_contrast", "mean standard deviation of luma in 8×8 blocks at 384×288, / 255"),
    ("detail", "mean Sobel gradient magnitude at 384×288, / 255 (high-frequency energy)"),
    ("edge_density", "share of pixels on an edge (Sobel ≥ 64 luma) at 384×288"),
    ("grain", "fine-scale energy: mean |luma − its 3×3 mean| at 384×288, / 255"),
    ("grain_ratio", "fine-scale energy at 384×288 over that at 192×144: above 1 pixel-scale noise, below smooth or bold; null when both are tiny"),
    ("glow", "share of pixels bright (luma ≥ 0.6) on a gentle gradient (Sobel < 24): soft light rather than lines"),
    ("speed", "mean block motion per step at 192×144, px (16 px blocks, ±8 px; textured but lost counts 8); null with too little to follow"),
    ("speed_p90", "90th percentile of the found blocks' motion per step at 192×144, px; null with under 20 found"),
    ("motion_found", "share of textured blocks found again in the next step (low: noise, chaos or motion past 8 px); null when nothing is textured"),
    ("motion_coherence", "mean cosine between neighbouring blocks' motion vectors (1 all one way, 0 unrelated); null when still"),
    ("motion_radial", "mean motion away from the centre per step, px: positive zooming in or down a tunnel, negative out"),
    ("motion_swirl", "mean motion around the centre per step, px: positive anticlockwise, negative clockwise"),
    ("difference", "mean frame difference per step, luma 0–255 at 192×144"),
    ("difference_variation", "standard deviation over the mean of the per-step frame difference; null when nearly still"),
    ("correlation", "mean Pearson correlation of each picture with the step before (1 barely changes, 0 a new picture each step); null when flat"),
    ("correlation_1s", "mean Pearson correlation of pictures one second apart; null when flat"),
    ("flash_rate", "flashes a second: steps where ≥ 25% of the picture brightens, or darkens, by ≥ 0.2 luma"),
    ("brightness_variation", "standard deviation over the steps of the mean luma (0–1)"),
    ("mirror_lr", "Pearson correlation of the picture with itself mirrored left to right (1 symmetric); null when flat"),
    ("mirror_ud", "Pearson correlation of the picture with itself mirrored top to bottom; null when flat"),
    ("rotate_180", "Pearson correlation of the picture with itself turned half way; null when flat"),
    ("rotate_90", "Pearson correlation of the central square with itself turned a quarter (four-fold, kaleidoscope); null when flat"),
    ("reactivity", "mean difference between the pictures with music and in silence, luma 0–255"),
    ("reactivity_motion", "frame difference with music minus in silence, luma 0–255: how much more it moves to sound"),
    ("silence_difference", "mean frame difference per step in silence, luma 0–255: how much it moves on its own"),
    ("pulse_brightness", "share of the mean luma's variance that repeats with the beat (every 15 steps), whatever its delay; noise ~0.06; null when steady"),
    ("pulse_motion", "share of the frame difference's variance that repeats with the beat; noise ~0.06; null when steady"),
    ("waves_difference", "mean difference between the pictures with and without the waves (custom and basic), luma 0–255"),
    ("shapes_difference", "mean difference between the pictures with and without the custom shapes, luma 0–255"),
];

/// A large luma step: 0.2 of the range.
const FLASH_STEP: f32 = 51.0;
/// The share of the picture that must take one for a flash.
const FLASH_SHARE: f64 = 0.25;

/// Gathers the four runs' pictures into features. Feed it the music run first
/// ([`Collector::add`] each step [`Collector::wants`]), then the others.
#[derive(Default)]
pub struct Collector {
    // The music run, per step from FROM.
    before: Option<Vec<f32>>,
    brightness: Vec<f64>,
    differences: Vec<f64>,
    correlations: Vec<f64>,
    flashes: usize,
    // Block motion, every SPARSE steps.
    flows: usize,
    speeds: Vec<f64>,
    moved: Vec<f64>,
    found: usize,
    textured: usize,
    coherence: Vec<f64>,
    radial: Vec<f64>,
    swirl: Vec<f64>,
    // Each picture every SPATIAL steps.
    palette: Palette,
    histogram: Vec<u64>,
    centre: Vec<f64>,
    contrast: Vec<f64>,
    gradient: Vec<f64>,
    edges: Vec<f64>,
    glow: Vec<f64>,
    fine: Vec<f64>,
    fine_small: Vec<f64>,
    symmetry: [Vec<f64>; 4],
    second: Vec<f64>,
    spatial: HashMap<u32, Vec<f32>>,
    /// The music's pictures the other conditions are compared with, by step.
    music: HashMap<u32, Vec<f32>>,
    // Silence.
    silent_before: Option<Vec<f32>>,
    silent_differences: Vec<f64>,
    /// Per condition after the music: the differences from the music's pictures.
    apart: HashMap<&'static str, Vec<f64>>,
}

impl Collector {
    pub fn new() -> Collector {
        Collector { histogram: vec![0; 256], ..Default::default() }
    }

    /// Whether `step` of `condition` is measured, so needs reading back.
    pub fn wants(condition: Condition, step: u32) -> bool {
        match condition {
            Condition::Music | Condition::Silence => step + 1 >= FROM,
            Condition::NoWaves | Condition::NoShapes => step >= FROM && (step - FROM) % SPARSE == 0,
        }
    }

    /// The picture `rgba` ([`SIZE`]) drawn at `step` of `condition`; `small`
    /// is it shrunk to [`SMALL`] ([`analyse::shrink`]).
    pub fn add(&mut self, condition: Condition, step: u32, rgba: &[u8], small: &[u8]) {
        if !Self::wants(condition, step) {
            return;
        }
        let luma = analyse::luma(small);
        let compared = step >= FROM && (step - FROM) % SPARSE == 0;
        match condition {
            Condition::Music => {
                if step >= FROM {
                    self.music_step(step, rgba, small, &luma);
                }
                if compared {
                    self.music.insert(step, luma.clone());
                }
                self.before = Some(luma);
            }
            Condition::Silence => {
                if let Some(before) = self.silent_before.as_ref().filter(|_| step >= FROM) {
                    self.silent_differences.push(analyse::difference(before, &luma));
                }
                if compared {
                    self.compare(condition, step, &luma);
                }
                self.silent_before = Some(luma);
            }
            Condition::NoWaves | Condition::NoShapes => self.compare(condition, step, &luma),
        }
    }

    fn compare(&mut self, condition: Condition, step: u32, luma: &[f32]) {
        if let Some(music) = self.music.get(&step) {
            self.apart.entry(condition.name()).or_default().push(analyse::difference(music, luma));
        }
    }

    fn music_step(&mut self, step: u32, rgba: &[u8], small: &[u8], luma: &[f32]) {
        let (sw, sh) = SMALL;
        self.brightness.push(luma.iter().map(|&v| v as f64).sum::<f64>() / luma.len() as f64 / 255.0);
        if let Some(before) = self.before.take() {
            self.differences.push(analyse::difference(&before, luma));
            if let Some(c) = texture::pearson(&before, luma) {
                self.correlations.push(c);
            }
            let share = |up: bool| before.iter().zip(luma).filter(|&(b, a)| if up { a - b >= FLASH_STEP } else { b - a >= FLASH_STEP }).count() as f64 / luma.len() as f64;
            if share(true) >= FLASH_SHARE || share(false) >= FLASH_SHARE {
                self.flashes += 1;
            }
            if (step - FROM) % SPARSE == 0 {
                self.motion(&before, luma);
            }
        }
        if step % SPATIAL == 0 {
            let (w, h) = (SIZE.0 as usize, SIZE.1 as usize);
            let full = analyse::luma(rgba);
            self.palette.add(small);
            for &v in &full {
                self.histogram[(v.round() as usize).min(255)] += 1;
            }
            self.centre.push(texture::centre_vs_edge(&full, w, h));
            self.contrast.push(texture::local_contrast(&full, w, h));
            let d = texture::detail(&full, w, h);
            self.gradient.push(d.gradient);
            self.edges.push(d.edges);
            self.glow.push(d.glow);
            self.fine.push(texture::fine(&full, w, h));
            self.fine_small.push(texture::fine(luma, sw, sh));
            let s = texture::symmetry(luma, sw, sh);
            for (into, v) in self.symmetry.iter_mut().zip([s.left_right, s.up_down, s.half_turn, s.quarter_turn]) {
                into.extend(v);
            }
            if let Some(c) = step.checked_sub(30).and_then(|s| self.spatial.get(&s)).and_then(|old| texture::pearson(old, luma)) {
                self.second.push(c);
            }
            self.spatial.insert(step, luma.to_vec());
        }
    }

    fn motion(&mut self, before: &[f32], now: &[f32]) {
        let (w, h) = SMALL;
        let f = field::field(before, now, w, h);
        let flow = analyse::Flow::of(&f);
        self.flows += 1;
        match flow.measured() {
            Some(m) => self.speeds.push(m),
            // Textured, but not found again: moving faster than the search (as `index`).
            None if flow.textured * 10 >= flow.blocks => self.speeds.push(analyse::SEARCH as f64),
            None => {}
        }
        self.moved.extend(f.found().map(|(x, y)| x.hypot(y) as f64));
        self.found += flow.matched;
        self.textured += flow.textured;
        self.coherence.extend(f.coherence());
        if let Some((r, s)) = f.radial_and_swirl() {
            self.radial.push(r);
            self.swirl.push(s);
        }
    }

    /// The features, by name ([`NAMES`]), `None` where unmeasured.
    pub fn finish(&self) -> BTreeMap<String, Option<f32>> {
        let mut out: BTreeMap<String, Option<f64>> = BTreeMap::new();
        let mut put = |name: &str, v: Option<f64>| {
            debug_assert!(NAMES.iter().any(|(n, _)| *n == name), "{name} isn't in NAMES");
            out.insert(name.to_string(), v.filter(|v| v.is_finite()));
        };
        let mean = series::mean;
        let shares = self.palette.shares();
        for (i, hue) in analyse::palette::HUES.iter().enumerate() {
            put(&format!("hue_{hue}"), shares.map(|s| s[i]));
        }
        let spatial = !self.centre.is_empty();
        put("colour_weight", spatial.then(|| self.palette.coloured()));
        put("colourfulness", spatial.then(|| self.palette.colourfulness()));
        put("hue_temperature", self.palette.temperature());
        put("hue_spread", self.palette.spread());
        put("pale_bright", spatial.then(|| self.palette.pale()));
        put("brightness", mean(&self.brightness));
        let total: u64 = self.histogram.iter().sum();
        let at = |p: f64| {
            (total > 0).then(|| {
                let want = (p * total as f64).ceil().max(1.0) as u64;
                let mut seen = 0;
                self.histogram.iter().position(|&n| {
                    seen += n;
                    seen >= want
                })
                .unwrap_or(255) as f64
                    / 255.0
            })
        };
        put("brightness_p05", at(0.05));
        put("brightness_p95", at(0.95));
        put("dark_share", spatial.then(|| self.palette.dark()));
        put("centre_vs_edge", mean(&self.centre));
        put("local_contrast", mean(&self.contrast));
        put("detail", mean(&self.gradient));
        put("edge_density", mean(&self.edges));
        put("grain", mean(&self.fine));
        put("grain_ratio", mean(&self.fine).zip(mean(&self.fine_small)).filter(|&(_, s)| s >= 0.5 / 255.0).map(|(f, s)| f / s));
        put("glow", mean(&self.glow));
        // Speed needs motion followed on at least a third of the steps (as `index`).
        put("speed", (!self.speeds.is_empty() && self.speeds.len() * 3 >= self.flows).then(|| mean(&self.speeds)).flatten());
        put("speed_p90", (self.moved.len() >= 20).then(|| series::percentile(&self.moved, 0.9)).flatten());
        put("motion_found", (self.textured > 0).then(|| self.found as f64 / self.textured as f64));
        let enough = |v: &Vec<f64>| (v.len() * 5 >= self.flows && !v.is_empty()).then(|| mean(v)).flatten();
        put("motion_coherence", enough(&self.coherence));
        put("motion_radial", enough(&self.radial));
        put("motion_swirl", enough(&self.swirl));
        put("difference", mean(&self.differences));
        put("difference_variation", series::variation(&self.differences, 0.5));
        put("correlation", mean(&self.correlations));
        put("correlation_1s", mean(&self.second));
        let seconds = self.differences.len() as f64 / 30.0;
        put("flash_rate", (seconds > 0.0).then(|| self.flashes as f64 / seconds));
        put("brightness_variation", series::deviation(&self.brightness));
        for (name, v) in ["mirror_lr", "mirror_ud", "rotate_180", "rotate_90"].iter().zip(&self.symmetry) {
            put(name, mean(v));
        }
        let apart = |c: Condition| self.apart.get(c.name()).and_then(|v| mean(v));
        put("reactivity", apart(Condition::Silence));
        put("reactivity_motion", mean(&self.differences).zip(mean(&self.silent_differences)).map(|(m, s)| m - s));
        put("silence_difference", mean(&self.silent_differences));
        put("pulse_brightness", series::periodic(&self.brightness, BEAT, 0.002));
        put("pulse_motion", series::periodic(&self.differences, BEAT, 0.2));
        put("waves_difference", apart(Condition::NoWaves));
        put("shapes_difference", apart(Condition::NoShapes));
        out.into_iter().map(|(k, v)| (k, v.map(|v| v as f32))).collect()
    }
}

/// One preset in `features.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Row {
    /// Relative to the measured folder, `/`-separated.
    pub path: String,
    /// SHA-256 of the file's bytes, in hex.
    pub hash: String,
    /// Its first folder.
    pub style: String,
    pub features: BTreeMap<String, Option<f32>>,
    /// The clip's file name in `clips/`.
    pub clip: String,
}

/// A preset that couldn't be drawn, and why (`timed out`, `failed: …`, `panicked…`, `crashed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skipped {
    pub path: String,
    pub why: String,
}

/// `features.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Features {
    pub version: u32,
    pub analysis: u32,
    pub size: [u32; 2],
    pub seconds: u32,
    pub conditions: Vec<String>,
    pub clip: Clip,
    pub names: BTreeMap<String, String>,
    /// Sorted by path.
    pub rows: Vec<Row>,
    /// Sorted by path.
    pub skipped: Vec<Skipped>,
}

impl Default for Features {
    fn default() -> Features {
        Features {
            version: VERSION,
            analysis: ANALYSIS,
            size: [SIZE.0, SIZE.1],
            seconds: SECONDS,
            conditions: Condition::ALL.iter().map(|c| c.name().to_string()).collect(),
            clip: CLIP,
            names: NAMES.iter().map(|(n, d)| (n.to_string(), d.to_string())).collect(),
            rows: Vec::new(),
            skipped: Vec::new(),
        }
    }
}

impl Features {
    /// Reads `features.json`; `None` when it's missing, unreadable, or drawn or
    /// measured otherwise than now (version, analysis, size, length,
    /// conditions or clip), so the run starts afresh.
    pub fn load(file: &Path) -> Option<Features> {
        let f: Features = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
        let now = Features::default();
        (f.version == now.version && f.analysis == now.analysis && f.size == now.size && f.seconds == now.seconds && f.conditions == now.conditions && f.clip == now.clip).then_some(f)
    }

    /// Writes `features.json` sorted by path, through a temporary file so a reader never sees half of it.
    pub fn save(&self, file: &Path) -> std::io::Result<()> {
        let mut sorted = self.clone();
        sorted.rows.sort_by(|a, b| a.path.cmp(&b.path));
        sorted.skipped.sort_by(|a, b| a.path.cmp(&b.path));
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&sorted).map_err(std::io::Error::other)?)?;
        std::fs::rename(tmp, file)
    }
}

#[cfg(test)]
mod tests;
