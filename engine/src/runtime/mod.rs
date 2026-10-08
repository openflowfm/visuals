//! A preset, running: its values, its equations, and the warp mesh they move.
//!
//! A port of Butterchurn's `PresetEquationRunner` and the parts of its
//! `Renderer` that are not drawing — the clock, the frame rate estimate, the
//! per-vertex mesh. Which variables carry from one frame to the next, and which
//! are reset, follows Butterchurn exactly, because presets depend on it.

mod clock;
mod mesh;
mod runner;

pub use clock::{Clock, Pacer, PRESET_RATE};
pub use mesh::Mesh;
pub use runner::{Runner, Scope};

use crate::eel::{self, Symbols};
use crate::preset;
use std::collections::BTreeMap;

/// MilkDrop's `.milk` names to the names equations use. Anything not listed is
/// its own name, lowercased.
const NAMES: &[(&str, &str)] = &[
    ("frating", "rating"), ("fgammaadj", "gammaadj"), ("fdecay", "decay"),
    ("fvideoechozoom", "echo_zoom"), ("fvideoechoalpha", "echo_alpha"), ("nvideoechoorientation", "echo_orient"),
    ("nwavemode", "wave_mode"), ("badditivewaves", "additivewave"), ("bwavedots", "wave_dots"),
    ("bwavethick", "wave_thick"), ("bmodwavealphabyvolume", "modwavealphabyvolume"),
    ("bmaximizewavecolor", "wave_brighten"), ("btexwrap", "wrap"), ("bdarkencenter", "darken_center"),
    ("bredbluestereo", "red_blue"), ("bbrighten", "brighten"), ("bdarken", "darken"), ("bsolarize", "solarize"),
    ("binvert", "invert"), ("fwavealpha", "wave_a"), ("fwavescale", "wave_scale"),
    ("fwavesmoothing", "wave_smoothing"), ("fwaveparam", "wave_mystery"),
    ("fmodwavealphastart", "modwavealphastart"), ("fmodwavealphaend", "modwavealphaend"),
    ("fwarpanimspeed", "warpanimspeed"), ("fwarpscale", "warpscale"), ("fzoomexponent", "zoomexp"),
    ("fshader", "fshader"), ("nmotionvectorsx", "mv_x"), ("nmotionvectorsy", "mv_y"),
    // waves and shapes
    ("thick", "thickoutline"), ("instances", "num_inst"), ("num_instances", "num_inst"),
    ("badditive", "additive"), ("busedots", "usedots"), ("bspectrum", "spectrum"), ("bdrawthick", "thick"),
];

pub const BASE_DEFAULTS: &[(&str, f64)] = &[
    ("decay", 0.98), ("gammaadj", 2.0), ("echo_zoom", 2.0), ("echo_alpha", 0.0), ("echo_orient", 0.0),
    ("red_blue", 0.0), ("brighten", 0.0), ("darken", 0.0), ("wrap", 1.0), ("darken_center", 0.0),
    ("solarize", 0.0), ("invert", 0.0), ("fshader", 0.0), ("b1n", 0.0), ("b2n", 0.0), ("b3n", 0.0),
    ("b1x", 1.0), ("b2x", 1.0), ("b3x", 1.0), ("b1ed", 0.25), ("wave_mode", 0.0), ("additivewave", 0.0),
    ("wave_dots", 0.0), ("wave_thick", 0.0), ("wave_a", 0.8), ("wave_scale", 1.0), ("wave_smoothing", 0.75),
    ("wave_mystery", 0.0), ("modwavealphabyvolume", 0.0), ("modwavealphastart", 0.75), ("modwavealphaend", 0.95),
    ("wave_r", 1.0), ("wave_g", 1.0), ("wave_b", 1.0), ("wave_x", 0.5), ("wave_y", 0.5), ("wave_brighten", 1.0),
    ("mv_x", 12.0), ("mv_y", 9.0), ("mv_dx", 0.0), ("mv_dy", 0.0), ("mv_l", 0.9), ("mv_r", 1.0), ("mv_g", 1.0),
    ("mv_b", 1.0), ("mv_a", 1.0), ("warpanimspeed", 1.0), ("warpscale", 1.0), ("zoomexp", 1.0), ("zoom", 1.0),
    ("rot", 0.0), ("cx", 0.5), ("cy", 0.5), ("dx", 0.0), ("dy", 0.0), ("warp", 1.0), ("sx", 1.0), ("sy", 1.0),
    ("ob_size", 0.01), ("ob_r", 0.0), ("ob_g", 0.0), ("ob_b", 0.0), ("ob_a", 0.0), ("ib_size", 0.01),
    ("ib_r", 0.25), ("ib_g", 0.25), ("ib_b", 0.25), ("ib_a", 0.0),
];

pub const WAVE_DEFAULTS: &[(&str, f64)] = &[
    ("enabled", 0.0), ("samples", 512.0), ("sep", 0.0), ("scaling", 1.0), ("smoothing", 0.5), ("r", 1.0),
    ("g", 1.0), ("b", 1.0), ("a", 1.0), ("spectrum", 0.0), ("usedots", 0.0), ("thick", 0.0), ("additive", 0.0),
];

pub const SHAPE_DEFAULTS: &[(&str, f64)] = &[
    ("enabled", 0.0), ("sides", 4.0), ("additive", 0.0), ("thickoutline", 0.0), ("textured", 0.0),
    ("num_inst", 1.0), ("tex_zoom", 1.0), ("tex_ang", 0.0), ("x", 0.5), ("y", 0.5), ("rad", 0.1), ("ang", 0.0),
    ("r", 1.0), ("g", 0.0), ("b", 0.0), ("a", 1.0), ("r2", 0.0), ("g2", 1.0), ("b2", 0.0), ("a2", 0.0),
    ("border_r", 1.0), ("border_g", 1.0), ("border_b", 1.0), ("border_a", 0.1),
];

/// A `.milk` file's values under the names equations use, over Butterchurn's defaults.
pub fn base_values(raw: &BTreeMap<String, f64>, defaults: &[(&str, f64)]) -> BTreeMap<String, f64> {
    let mut out: BTreeMap<String, f64> = defaults.iter().map(|(k, v)| (k.to_string(), *v)).collect();
    for (key, value) in raw {
        out.insert(equation_name(key), *value);
    }
    out
}

/// The name equations use for a `.milk` key: `fDecay` is `decay`.
pub fn equation_name(key: &str) -> String {
    let lower = key.to_ascii_lowercase();
    NAMES.iter().find(|(from, _)| *from == lower).map_or(lower, |(_, to)| to.to_string())
}

/// Where a value lives: the preset's own, or one custom wave's or shape's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase", tag = "list", content = "index")]
pub enum Owner {
    Base,
    Waves(usize),
    Shapes(usize),
}

const GLOBALS: &[&str] = &[
    "frame", "time", "fps", "bass", "bass_att", "mid", "mid_att", "treb", "treb_att", "meshx", "meshy", "aspectx",
    "aspecty", "pixelsx", "pixelsy",
];

/// The values of [`GLOBALS`], in order: what equations read of the frame and
/// the output, as Butterchurn's `globalVars`.
pub type Globals = [f64; 15];

fn q_names() -> impl Iterator<Item = String> {
    (1..=32).map(|i| format!("q{i}"))
}
fn reg_names() -> impl Iterator<Item = String> {
    (0..100).map(|i| format!("reg{i:02}"))
}

/// The slots of `names`, each registered already.
fn slots<S: AsRef<str>>(symbols: &Symbols, names: impl IntoIterator<Item = S>) -> Slots {
    names.into_iter().map(|n| symbols.get(n.as_ref()).expect("registered")).collect()
}

/// Write `values` to `slots`, one for one.
fn scatter(vars: &mut [f64], slots: &[usize], values: &[f64]) {
    for (&s, &v) in slots.iter().zip(values) {
        vars[s] = v;
    }
}

/// The values in `slots`, in order.
fn gather(vars: &[f64], slots: &[usize]) -> Vec<f64> {
    slots.iter().map(|&s| vars[s]).collect()
}

/// The renderer's view of the world that equations read.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub frame: u64,
    pub time: f64,
    pub fps: f64,
    pub bass: f64,
    pub bass_att: f64,
    pub mid: f64,
    pub mid_att: f64,
    pub treb: f64,
    pub treb_att: f64,
}

/// The output size and mesh, as Butterchurn's `params`.
#[derive(Debug, Clone, Copy)]
pub struct Size {
    pub texsize_x: f64,
    pub texsize_y: f64,
    pub mesh_width: usize,
    pub mesh_height: usize,
}

impl Size {
    pub fn aspect_x(&self) -> f64 {
        if self.texsize_y > self.texsize_x { self.texsize_x / self.texsize_y } else { 1.0 }
    }
    pub fn aspect_y(&self) -> f64 {
        if self.texsize_x > self.texsize_y { self.texsize_y / self.texsize_x } else { 1.0 }
    }
}

/// A slot set: which variables an operation copies, by symbol slot.
type Slots = Vec<usize>;

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("equations: {0}")]
    Equations(#[from] eel::Error),
}

/// Read and load a `.milk` file.
pub fn load(text: &str, frame: &Frame, size: &Size, seed: u64) -> Result<Runner, LoadError> {
    Runner::new(preset::parse(text), frame, size, seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn frame() -> Frame {
        Frame { frame: 1, time: 1.0, fps: 60.0, bass: 1.0, bass_att: 1.0, mid: 1.0, mid_att: 1.0, treb: 1.0, treb_att: 1.0 }
    }
    pub(super) const SIZE: Size = Size { texsize_x: 1920.0, texsize_y: 1080.0, mesh_width: 48, mesh_height: 36 };

    /// `text` loaded at `size` and one frame run on it.
    pub(super) fn running(text: &str, size: &Size) -> Runner {
        let mut r = load(text, &frame(), size, 1).unwrap();
        r.run_frame(&frame(), size);
        r
    }

    #[test]
    fn names_map_and_defaults_fill() {
        let mut raw = BTreeMap::new();
        raw.insert("fDecay".into(), 0.9);
        raw.insert("nWaveMode".into(), 3.0);
        let v = base_values(&raw, BASE_DEFAULTS);
        assert_eq!(v["decay"], 0.9);
        assert_eq!(v["wave_mode"], 3.0);
        assert_eq!(v["gammaadj"], 2.0);
    }
}
