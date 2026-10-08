//! A preset, running: its values, its equations, and the warp mesh they move.
//!
//! A port of Butterchurn's `PresetEquationRunner` and the parts of its
//! `Renderer` that are not drawing — the clock, the frame rate estimate, the
//! per-vertex mesh. Which variables carry from one frame to the next, and which
//! are reset, follows Butterchurn exactly, because presets depend on it.

use crate::audio::Audio;
use crate::eel::{self, Memory, Program, Symbols};
use crate::preset::{self, Preset};
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

fn qs() -> impl Iterator<Item = String> {
    (1..=32).map(|i| format!("q{i}"))
}
fn regs() -> impl Iterator<Item = String> {
    (0..100).map(|i| format!("reg{i:02}"))
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

/// One preset, loaded: equations compiled, state initialised, ready to run frames.
pub struct Runner {
    pub preset: Preset,
    pub symbols: Symbols,
    frame_eqs: Program,
    vertex: Program,
    pub has_vertex: bool,
    memory: Memory,
    /// `mdVS`: the base values and the base globals, by slot. Everything a frame starts from.
    base: Vec<f64>,
    q_slots: Slots,
    reg_slots: Slots,
    /// `mdVSQInit`, `mdVSRegs`, the carried user variables.
    q_init: Vec<f64>,
    pub regs: Vec<f64>,
    user_slots: Slots,
    user_values: Vec<f64>,
    /// `mdVSFrame` after the last frame's equations.
    pub frame_vars: Vec<f64>,
    pub rand_start: [f32; 4],
    pub rand_preset: [f32; 4],
    pub waves: Vec<Option<Scope>>,
    pub shapes: Vec<Option<Scope>>,
}

impl Runner {
    /// The globals a wave or shape reads this frame, as Butterchurn's `globalVars`.
    pub fn globals(frame: &Frame, size: &Size) -> [f64; 15] {
        Self::globals_of(frame, size)
    }

    /// The qs after this frame's equations — what waves and shapes start from.
    pub fn q_after_frame(&self) -> Vec<f64> {
        self.q_slots.iter().map(|&s| self.frame_vars[s]).collect()
    }

    pub fn new(preset: Preset, frame: &Frame, size: &Size, seed: u64) -> Result<Self, LoadError> {
        let mut symbols = Symbols::default();
        let values = base_values(&preset.values, BASE_DEFAULTS);
        // Every name the runner itself moves gets a slot before the equations add theirs.
        for name in values.keys().map(String::as_str).chain(GLOBALS.iter().copied()) {
            symbols.slot(name);
        }
        for name in qs().chain(regs()).chain(["x", "y", "rad", "ang"].map(String::from)) {
            symbols.slot(&name);
        }
        let init = eel::compile(&preset.init, &mut symbols)?;
        let frame_eqs = eel::compile(&preset.frame, &mut symbols)?;
        let vertex = eel::compile(&preset.vertex, &mut symbols)?;
        let mut memory = Memory::new(seed);
        let rand_start = [0; 4].map(|_| memory.random() as f32);
        let rand_preset = [0; 4].map(|_| memory.random() as f32);

        let slot = |s: &Symbols, n: &str| s.get(n).expect("registered");
        let mut base = vec![0.0; symbols.len()];
        let mut base_slots = Vec::new();
        for (name, value) in &values {
            let s = slot(&symbols, name);
            base[s] = *value;
            base_slots.push(s);
        }
        let globals = Self::globals_of(frame, size);
        for (name, value) in GLOBALS.iter().zip(globals) {
            let s = slot(&symbols, name);
            base[s] = value;
            base_slots.push(s);
        }
        let q_slots: Slots = qs().map(|n| slot(&symbols, &n)).collect();
        let reg_slots: Slots = regs().map(|n| slot(&symbols, &n)).collect();
        let non_user: std::collections::HashSet<usize> =
            q_slots.iter().chain(&reg_slots).chain(&base_slots).copied().collect();

        // Init: on a copy of the base. Its qs become every frame's starting qs.
        let mut vars = base.clone();
        init.run(&mut vars, &mut memory);
        let q_init: Vec<f64> = q_slots.iter().map(|&s| vars[s]).collect();
        let regs: Vec<f64> = reg_slots.iter().map(|&s| vars[s]).collect();
        // User variables are those init or the first frame wrote; in slots, the
        // names neither the base nor q/reg own, that the programs mention.
        let mentioned = |s: usize| !non_user.contains(&s) && !["x", "y", "rad", "ang"].iter().any(|n| symbols.get(n) == Some(s));
        let init_user: Vec<(usize, f64)> = (0..symbols.len()).filter(|&s| mentioned(s) && vars[s] != 0.0).map(|s| (s, vars[s])).collect();

        // The first frame runs once at load, to find which variables carry over.
        let mut first = base.clone();
        for (i, &s) in q_slots.iter().enumerate() {
            first[s] = q_init[i];
        }
        for (i, &s) in reg_slots.iter().enumerate() {
            first[s] = regs[i];
        }
        for &(s, v) in &init_user {
            first[s] = v;
        }
        frame_eqs.run(&mut first, &mut memory);
        let user_slots: Slots = (0..symbols.len()).filter(|&s| mentioned(s)).collect();
        let user_values = user_slots.iter().map(|&s| first[s]).collect();
        let mut regs: Vec<f64> = reg_slots.iter().map(|&s| first[s]).collect();

        // Waves, then shapes, each from the first frame's qs. An init that
        // writes regs hands them on to the next.
        let q_after: Vec<f64> = q_slots.iter().map(|&s| first[s]).collect();
        let mut waves = Vec::new();
        for (i, w) in preset.waves.iter().enumerate() {
            let enabled = base_values(&w.values, WAVE_DEFAULTS)["enabled"] != 0.0;
            waves.push(if enabled {
                Some(Scope::new(
                    &w.values,
                    WAVE_DEFAULTS,
                    [&w.init, &w.frame, &w.point],
                    (frame, size, &q_after, &mut regs),
                    seed ^ (0x100 + i as u64),
                    &["sample", "value1", "value2", "x", "y"],
                )?)
            } else {
                None
            });
        }
        let mut shapes = Vec::new();
        for (i, s) in preset.shapes.iter().enumerate() {
            let enabled = base_values(&s.values, SHAPE_DEFAULTS)["enabled"] != 0.0;
            shapes.push(if enabled {
                Some(Scope::new(
                    &s.values,
                    SHAPE_DEFAULTS,
                    [&s.init, &s.frame, ""],
                    (frame, size, &q_after, &mut regs),
                    seed ^ (0x200 + i as u64),
                    &["instance"],
                )?)
            } else {
                None
            });
        }

        Ok(Self {
            waves,
            shapes,
            has_vertex: !vertex.is_empty(),
            preset,
            symbols,
            frame_eqs,
            vertex,
            memory,
            base,
            q_slots,
            reg_slots,
            q_init,
            regs,
            user_slots,
            user_values,
            frame_vars: first,
            rand_start,
            rand_preset,
        })
    }

    fn globals_of(frame: &Frame, size: &Size) -> [f64; 15] {
        [
            frame.frame as f64,
            frame.time,
            frame.fps,
            frame.bass,
            frame.bass_att,
            frame.mid,
            frame.mid_att,
            frame.treb,
            frame.treb_att,
            size.mesh_width as f64,
            size.mesh_height as f64,
            1.0 / size.aspect_x(),
            1.0 / size.aspect_y(),
            size.texsize_x,
            size.texsize_y,
        ]
    }

    /// `runFrameEquations`: the base, the init qs, the carried user variables
    /// and this frame's globals, then the per-frame equations.
    pub fn run_frame(&mut self, frame: &Frame, size: &Size) {
        let mut vars = self.base.clone();
        for (i, &s) in self.q_slots.iter().enumerate() {
            vars[s] = self.q_init[i];
        }
        for (i, &s) in self.user_slots.iter().enumerate() {
            vars[s] = self.user_values[i];
        }
        for (name, value) in GLOBALS.iter().zip(Self::globals_of(frame, size)) {
            vars[self.symbols.get(name).unwrap()] = value;
        }
        for (i, &s) in self.reg_slots.iter().enumerate() {
            vars[s] = self.regs[i];
        }
        self.frame_eqs.run(&mut vars, &mut self.memory);
        for (i, &s) in self.user_slots.iter().enumerate() {
            self.user_values[i] = vars[s];
        }
        self.frame_vars = vars;
    }

    pub fn get(&self, name: &str) -> f64 {
        self.symbols.get(name).map_or(0.0, |s| self.frame_vars[s])
    }

    /// Change one of the preset's values while it runs, as if the file had said
    /// it: equations keep their state, and the next frame starts from it.
    /// Returns false when the change needs a reload — turning a wave or shape on
    /// or off, which builds or drops its equations.
    pub fn set_value(&mut self, owner: Owner, key: &str, value: f64) -> bool {
        let name = equation_name(key);
        match owner {
            Owner::Base => {
                self.preset.values.insert(key.to_owned(), value);
                if let Some(s) = self.symbols.get(&name) {
                    self.base[s] = value;
                }
                true
            }
            Owner::Waves(i) | Owner::Shapes(i) => {
                let (values, scope) = match owner {
                    Owner::Waves(_) => (&mut self.preset.waves[i].values, &mut self.waves[i]),
                    _ => (&mut self.preset.shapes[i].values, &mut self.shapes[i]),
                };
                values.insert(key.to_owned(), value);
                if name == "enabled" {
                    return false;
                }
                if let Some(scope) = scope {
                    scope.set_value(&name, value);
                }
                true
            }
        }
    }

    /// A value as the preset set it, before any equation — Butterchurn's `mdVS`.
    pub fn base_value(&self, name: &str) -> f64 {
        self.symbols.get(name).map_or(0.0, |s| self.base[s])
    }

    pub fn q(&self) -> [f32; 32] {
        let mut out = [0f32; 32];
        for (i, &s) in self.q_slots.iter().enumerate() {
            out[i] = self.frame_vars[s] as f32;
        }
        out
    }

    /// `runPixelEquations`: the warp mesh's texture coordinates, one per vertex,
    /// `(mesh_width + 1) × (mesh_height + 1)` of them — the whole step's motion.
    pub fn warp_mesh(&mut self, time: f64, size: &Size, uvs: &mut Vec<[f32; 2]>) {
        let mut mesh = Mesh::default();
        self.warp_motion(time, size, &mut mesh);
        mesh.uvs(1.0, uvs);
    }

    /// The per-vertex equations, once: what each vertex's motion is this step,
    /// kept in `mesh` so the step can be drawn at any fraction ([`Mesh::uvs`]).
    pub fn warp_motion(&mut self, time: f64, size: &Size, mesh: &mut Mesh) {
        let (gx, gy) = (size.mesh_width, size.mesh_height);
        let get = |name: &str, vars: &[f64], symbols: &Symbols| symbols.get(name).map_or(0.0, |s| vars[s]);
        let fv = &self.frame_vars;
        let warp_time = time * get("warpanimspeed", fv, &self.symbols);
        let warp_scale_inv = 1.0 / get("warpscale", fv, &self.symbols);
        let f0 = 11.68 + 4.0 * (warp_time * 1.413 + 10.0).cos();
        let f1 = 8.77 + 3.0 * (warp_time * 1.113 + 7.0).cos();
        let f2 = 10.54 + 3.0 * (warp_time * 1.233 + 3.0).cos();
        let f3 = 11.49 + 4.0 * (warp_time * 0.933 + 5.0).cos();
        let (ax, ay) = (size.aspect_x(), size.aspect_y());
        mesh.width = gx;
        mesh.height = gy;
        mesh.aspect = (ax, ay);
        mesh.warp_time = warp_time;
        mesh.warp_scale_inv = warp_scale_inv;
        mesh.f = [f0, f1, f2, f3];
        mesh.motion.clear();
        // One copy for the whole mesh: per-vertex variables carry from one
        // vertex to the next, as they do in MilkDrop and Butterchurn.
        let mut v = self.frame_vars.clone();
        let s = |n: &str| self.symbols.get(n).unwrap();
        let motion = ["zoom", "zoomexp", "rot", "warp", "cx", "cy", "dx", "dy", "sx", "sy"].map(|n| (s(n), fv[s(n)]));
        let (sx_, sy_, srad, sang) = (s("x"), s("y"), s("rad"), s("ang"));
        for iz in 0..=gy {
            for ix in 0..=gx {
                let x = ix as f64 / gx as f64 * 2.0 - 1.0;
                let y = iz as f64 / gy as f64 * 2.0 - 1.0;
                let rad = (x * x * ax * ax + y * y * ay * ay).sqrt();
                if self.has_vertex {
                    let ang = if iz * 2 == gy && ix * 2 == gx { 0.0 } else { (y * ay).atan2(x * ax) };
                    v[sx_] = x * 0.5 * ax + 0.5;
                    v[sy_] = y * -0.5 * ay + 0.5;
                    v[srad] = rad;
                    v[sang] = ang;
                    for &(slot, value) in &motion {
                        v[slot] = value;
                    }
                    self.vertex.run(&mut v, &mut self.memory);
                }
                let [zoom, zoom_exp, rot, warp, cx, cy, dx, dy, sx, sy] = motion.map(|(slot, _)| v[slot]);
                let zoom2 = zoom.powf(zoom_exp.powf(rad * 2.0 - 1.0));
                mesh.motion.push([zoom2, rot, warp, cx, cy, dx, dy, sx, sy]);
            }
        }
        // `regVars` come back from the last vertex.
        for (i, &slot) in self.reg_slots.iter().enumerate() {
            self.regs[i] = v[slot];
        }
    }
}

/// One step's warp: each vertex's motion as the per-vertex equations left it —
/// zoom, rotation, the warp's wobble, the stretch and the translation — which
/// [`Mesh::uvs`] turns into texture coordinates for the whole step or a part of it.
#[derive(Debug, Clone, Default)]
pub struct Mesh {
    width: usize,
    height: usize,
    aspect: (f64, f64),
    warp_time: f64,
    warp_scale_inv: f64,
    f: [f64; 4],
    /// Per vertex, row by row: zoom (after `zoomexp`), rot, warp, cx, cy, dx, dy, sx, sy.
    motion: Vec<[f64; 9]>,
}

/// `fraction` of a scale applied once a step: its power, so that two halves
/// make the whole. A scale that is not positive (a mirror) can't be split that
/// way and is moved toward linearly instead.
fn part_of(scale: f64, fraction: f64) -> f64 {
    if fraction == 1.0 {
        scale
    } else if scale > 0.0 {
        scale.powf(fraction)
    } else {
        1.0 + (scale - 1.0) * fraction
    }
}

impl Mesh {
    /// The texture coordinates for `fraction` of the step: 1 is MilkDrop's map
    /// exactly (Butterchurn's `runPixelEquations`), 0 the identity. In between,
    /// each part of the motion is split so that it composes back to the whole:
    /// zoom and stretch by their powers, rotation, translation and the warp's
    /// wobble in proportion. Those parts commute only approximately (they turn
    /// about different centres), so `uvs(½)` twice is close to `uvs(1)`, not equal.
    pub fn uvs(&self, fraction: f64, uvs: &mut Vec<[f32; 2]>) {
        let (gx, gy) = (self.width, self.height);
        let (ax, ay) = self.aspect;
        let [f0, f1, f2, f3] = self.f;
        let (warp_time, warp_scale_inv) = (self.warp_time, self.warp_scale_inv);
        uvs.clear();
        for (i, m) in self.motion.iter().enumerate() {
            let (ix, iz) = (i % (gx + 1), i / (gx + 1));
            let x = ix as f64 / gx as f64 * 2.0 - 1.0;
            let y = iz as f64 / gy as f64 * 2.0 - 1.0;
            let [zoom2, rot, warp, cx, cy, dx, dy, sx, sy] = *m;
            let zoom2_inv = 1.0 / part_of(zoom2, fraction);
            let (sx, sy) = (part_of(sx, fraction), part_of(sy, fraction));
            let (rot, warp, dx, dy) = (rot * fraction, warp * fraction, dx * fraction, dy * fraction);
            let mut u = x * 0.5 * ax * zoom2_inv + 0.5;
            let mut w = -y * 0.5 * ay * zoom2_inv + 0.5;
            u = (u - cx) / sx + cx;
            w = (w - cy) / sy + cy;
            if warp != 0.0 {
                u += warp * 0.0035 * (warp_time * 0.333 + warp_scale_inv * (x * f0 - y * f3)).sin();
                w += warp * 0.0035 * (warp_time * 0.375 - warp_scale_inv * (x * f2 + y * f1)).cos();
                u += warp * 0.0035 * (warp_time * 0.753 - warp_scale_inv * (x * f1 - y * f2)).cos();
                w += warp * 0.0035 * (warp_time * 0.825 + warp_scale_inv * (x * f0 + y * f3)).sin();
            }
            let (u2, w2) = (u - cx, w - cy);
            let (c, sn) = (rot.cos(), rot.sin());
            u = u2 * c - w2 * sn + cx;
            w = u2 * sn + w2 * c + cy;
            u -= dx;
            w -= dy;
            u = (u - 0.5) / ax + 0.5;
            w = (w - 0.5) / ay + 0.5;
            uvs.push([u as f32, w as f32]);
        }
    }

    /// The two sets of texture coordinates a refresh `fraction` of the way
    /// through the step draws with: `moved` for the plainly moved picture and
    /// `shaded` for the warp shader mixed over it by the fraction.
    ///
    /// Where the step's map is a flow — each vertex moved about as far, and the
    /// same way, as its neighbours: zoom, rotation, translation, the warp's
    /// wobble — both are [`Mesh::uvs`] at the fraction, so the picture slides.
    /// Where it tears or folds the picture instead — neighbours sent far apart, a
    /// kaleidoscope's mirror (`dx = x - ox`), a jump to another place — there is
    /// no motion to take a part of: a part of a fold is a smear. There `moved`
    /// stays where it is and `shaded` is the whole step, so the refresh
    /// cross-fades to exactly what the next step draws. How far a vertex is from
    /// a flow is how much the step stretches the grid around it: a change in
    /// displacement under a quarter of the distance between neighbours slides,
    /// over a half cross-fades, and in between mixes the two.
    pub fn between(&self, fraction: f64, moved: &mut Vec<[f32; 2]>, shaded: &mut Vec<[f32; 2]>) {
        let (mut none, mut whole) = (Vec::new(), Vec::new());
        self.uvs(0.0, &mut none);
        self.uvs(fraction, moved);
        self.uvs(1.0, &mut whole);
        shaded.clear();
        shaded.extend_from_slice(moved);
        let (gx, gy) = (self.width + 1, self.height + 1);
        let d = |i: usize| [whole[i][0] - none[i][0], whole[i][1] - none[i][1]];
        let apart = |a: [f32; 2], b: [f32; 2]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        for i in 0..moved.len() {
            let (ix, iz) = (i % gx, i / gx);
            let mut stretch = 0f32;
            for (ok, j) in [(ix > 0, i.wrapping_sub(1)), (ix + 1 < gx, i + 1), (iz > 0, i.wrapping_sub(gx)), (iz + 1 < gy, i + gx)] {
                if ok {
                    stretch = stretch.max(apart(d(i), d(j)) / apart(none[i], none[j]).max(1e-6));
                }
            }
            let k = ((stretch - 0.25) / 0.25).clamp(0.0, 1.0);
            if k > 0.0 {
                let mix = |a: [f32; 2], b: [f32; 2]| [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
                shaded[i] = mix(moved[i], whole[i]);
                moved[i] = mix(moved[i], none[i]);
            }
        }
    }
}

/// A custom wave's or shape's own variables: Butterchurn gives each its own
/// object, seeded from the preset's `q`s and `reg`s, with `t1`–`t8` reset to their
/// init values every frame and the variables its equations made up carried over.
pub struct Scope {
    pub symbols: Symbols,
    pub values: BTreeMap<String, f64>,
    frame: Program,
    pub point: Program,
    base: Vec<f64>,
    base_value_slots: Vec<(usize, f64)>,
    t_slots: Slots,
    t_init: Vec<f64>,
    q_slots: Slots,
    reg_slots: Slots,
    user_slots: Slots,
    user_values: Vec<f64>,
    pub memory: Memory,
}

impl Scope {
    fn new(
        raw: &BTreeMap<String, f64>,
        defaults: &[(&str, f64)],
        code: [&str; 3],
        start: (&Frame, &Size, &[f64], &mut Vec<f64>),
        seed: u64,
        point_names: &[&str],
    ) -> Result<Self, LoadError> {
        let (frame, size, q_after_frame, regs) = start;
        let values = base_values(raw, defaults);
        let mut symbols = Symbols::default();
        for name in values.keys().map(String::as_str).chain(GLOBALS.iter().copied()).chain(point_names.iter().copied()) {
            symbols.slot(name);
        }
        let ts: Vec<String> = (1..=8).map(|i| format!("t{i}")).collect();
        for name in qs().chain(regs_names()).chain(ts.iter().cloned()) {
            symbols.slot(&name);
        }
        let init = eel::compile(code[0], &mut symbols)?;
        let frame_eqs = eel::compile(code[1], &mut symbols)?;
        let point = eel::compile(code[2], &mut symbols)?;
        let get = |n: &str| symbols.get(n).unwrap();
        let q_slots: Slots = qs().map(|n| get(&n)).collect();
        let reg_slots: Slots = regs_names().map(|n| get(&n)).collect();
        let t_slots: Slots = ts.iter().map(|n| get(n)).collect();
        let base_value_slots: Vec<(usize, f64)> = values.iter().map(|(n, v)| (get(n), *v)).collect();
        let global_slots: Slots = GLOBALS.iter().map(|n| get(n)).collect();
        let mut vars = vec![0.0; symbols.len()];
        for &(s, v) in &base_value_slots {
            vars[s] = v;
        }
        for (s, v) in global_slots.iter().zip(Runner::globals_of(frame, size)) {
            vars[*s] = v;
        }
        for (i, &s) in q_slots.iter().enumerate() {
            vars[s] = q_after_frame[i];
        }
        for (i, &s) in reg_slots.iter().enumerate() {
            vars[s] = regs[i];
        }
        let mut memory = Memory::new(seed);
        if !init.is_empty() {
            init.run(&mut vars, &mut memory);
            // Init's regs are everyone's regs from here.
            for (i, &s) in reg_slots.iter().enumerate() {
                regs[i] = vars[s];
            }
            for &(s, v) in &base_value_slots {
                vars[s] = v;
            }
        }
        let t_init = t_slots.iter().map(|&s| vars[s]).collect();
        let non_user: std::collections::HashSet<usize> = q_slots
            .iter()
            .chain(&reg_slots)
            .chain(&t_slots)
            .chain(&global_slots)
            .copied()
            .chain(base_value_slots.iter().map(|(s, _)| *s))
            .collect();
        let point_slots: std::collections::HashSet<usize> = point_names.iter().map(|n| get(n)).collect();
        let user_slots: Slots = (0..symbols.len()).filter(|s| !non_user.contains(s) && !point_slots.contains(s)).collect();
        let user_values = user_slots.iter().map(|&s| vars[s]).collect();
        Ok(Self { symbols, values, frame: frame_eqs, point, base: vars, base_value_slots, t_slots, t_init, q_slots, reg_slots, user_slots, user_values, memory })
    }

    /// The variables a frame starts from, after the frame equations.
    pub fn run_frame(&mut self, globals: &[f64; 15], q: &[f64], regs: &[f64]) -> Vec<f64> {
        let mut vars = self.run_frame_prelude(globals, q, regs);
        self.frame.run(&mut vars, &mut self.memory);
        vars
    }

    /// The variables a frame starts from, before any equations run — what a
    /// shape resets each instance's values from.
    pub fn run_frame_prelude(&mut self, globals: &[f64; 15], q: &[f64], regs: &[f64]) -> Vec<f64> {
        let mut vars = self.base.clone();
        for (i, &s) in self.user_slots.iter().enumerate() {
            vars[s] = self.user_values[i];
        }
        for (i, &s) in self.q_slots.iter().enumerate() {
            vars[s] = q[i];
        }
        for (i, &s) in self.t_slots.iter().enumerate() {
            vars[s] = self.t_init[i];
        }
        for (name, value) in GLOBALS.iter().zip(globals) {
            vars[self.symbols.get(name).unwrap()] = *value;
        }
        for (i, &s) in self.reg_slots.iter().enumerate() {
            vars[s] = regs[i];
        }
        vars
    }

    /// Change a base value while it runs (`name` as equations spell it).
    pub fn set_value(&mut self, name: &str, value: f64) {
        self.values.insert(name.to_owned(), value);
        if let Some(s) = self.symbols.get(name) {
            self.base[s] = value;
            match self.base_value_slots.iter_mut().find(|(slot, _)| *slot == s) {
                Some(entry) => entry.1 = value,
                None => self.base_value_slots.push((s, value)),
            }
        }
    }

    /// Run the frame equations again on `vars`, as each shape instance does.
    pub fn rerun_frame(&mut self, vars: &mut [f64]) {
        self.frame.run(vars, &mut self.memory);
    }

    pub fn run_point(&mut self, vars: &mut [f64]) {
        self.point.run(vars, &mut self.memory);
    }

    /// The base values as they were at the start of the frame, for resetting.
    pub fn base_value(&self, slot: usize) -> f64 {
        self.base_value_slots.iter().find(|(s, _)| *s == slot).map_or(0.0, |(_, v)| *v)
    }

    /// Carry the made-up variables to next frame.
    pub fn keep(&mut self, vars: &[f64]) {
        for (i, &s) in self.user_slots.iter().enumerate() {
            self.user_values[i] = vars[s];
        }
    }

    pub fn get(&self, vars: &[f64], name: &str) -> f64 {
        self.symbols.get(name).map_or(0.0, |s| vars[s])
    }

    pub fn slot(&self, name: &str) -> usize {
        self.symbols.get(name).expect("registered")
    }
}

fn regs_names() -> impl Iterator<Item = String> {
    regs()
}

/// The preset clock: how many steps a second a preset makes at 1× speed,
/// whatever the display refreshes at.
///
/// MilkDrop presets move by a fixed amount per *frame* — zoom, rotation, decay
/// and the feedback itself compound once a frame — so the frame rate is their
/// speed. Winamp's MilkDrop 2 caps them at 30 by default (`m_max_fps_fs`,
/// `m_max_fps_dm` and `m_max_fps_w` in `vis_milk2/pluginshell.cpp`), which is
/// the pace presets were written and remembered at. Here a step is that frame;
/// the picture is drawn at every display refresh in between
/// ([`crate::render::Renderer::render`]).
pub const PRESET_RATE: f64 = 30.0;

/// Butterchurn's clock: time advances by one over the estimated frame rate, and
/// the estimate follows the real frame times with damping.
pub struct Clock {
    pub time: f64,
    pub fps: f64,
    pub frame: u64,
    history: std::collections::VecDeque<f64>,
}

impl Default for Clock {
    fn default() -> Self {
        Self { time: 0.0, fps: 30.0, frame: 0, history: [0.0].into() }
    }
}

impl Clock {
    /// One frame of `elapsed` seconds. Returns nothing; read `time`, `fps`, `frame`.
    pub fn tick(&mut self, elapsed: f64) {
        self.frame += 1;
        self.time += 1.0 / self.fps;
        let newest = self.history.back().copied().unwrap_or(0.0) + elapsed;
        self.history.push_back(newest);
        if self.history.len() > 120 {
            self.history.pop_front();
        }
        let estimate = self.history.len() as f64 / (newest - self.history[0]);
        if (estimate - self.fps).abs() > 3.0 && self.frame > 120 {
            self.fps = estimate;
        } else {
            self.fps = 0.93 * self.fps + 0.07 * estimate;
        }
    }

    pub fn frame_vars(&self, audio: &Audio) -> Frame {
        Frame {
            frame: self.frame,
            time: self.time,
            fps: self.fps,
            bass: audio.bass(),
            bass_att: audio.bass_att(),
            mid: audio.mid(),
            mid_att: audio.mid_att(),
            treb: audio.treb(),
            treb_att: audio.treb_att(),
        }
    }
}

/// A display loop's time between refreshes, evened out. A loop paced by the
/// display wakes a little early or late each refresh (0.6–0.7 ms sd, 15% of a
/// refresh at the 99th percentile, measured on the bench at 60 Hz), but the
/// pictures reach the screen exactly a refresh apart, so moving the preset clock
/// by the raw time would move it that unevenly. This gives whole refreshes of the
/// display's period instead — learnt from the loop, a dropped refresh counted as
/// two — and pays back what that differs from the real time a little at a time,
/// so over a second it adds up to the real time. A loop that isn't keeping to
/// whole refreshes (off screen, or changing rate) gets its raw time.
#[derive(Debug, Default)]
pub struct Pacer {
    period: f64,
    owed: f64,
    /// A refresh time that isn't the period, and how many in a row agreed with it.
    candidate: (f64, u32),
}

impl Pacer {
    /// The time to move the clock by for a refresh `elapsed` seconds after the last.
    pub fn tick(&mut self, elapsed: f64) -> f64 {
        if !(elapsed > 0.0 && elapsed.is_finite()) {
            return 0.0;
        }
        // A display refreshes between 20 and 500 times a second; a loop's first
        // round, or one after a stall, says nothing about its period.
        let plausible = (1.0 / 500.0..=1.0 / 20.0).contains(&elapsed);
        if self.period <= 0.0 {
            if plausible {
                self.period = elapsed;
            }
            self.owed = 0.0;
            return elapsed;
        }
        let n = (elapsed / self.period).round().max(1.0);
        let fits = n <= 4.0 && (elapsed / (n * self.period) - 1.0).abs() <= 0.4;
        if fits && n == 1.0 {
            self.candidate = (0.0, 0);
        } else if plausible {
            // A refresh that isn't one period: a hitch, or the rate changed. Only
            // several in a row that agree with each other change the period.
            let (c, k) = self.candidate;
            self.candidate = if k > 0 && (elapsed / c - 1.0).abs() < 0.2 { (c + (elapsed - c) / (k + 1) as f64, k + 1) } else { (elapsed, 1) };
            if self.candidate.1 >= 3 {
                self.period = self.candidate.0;
                self.candidate = (0.0, 0);
                self.owed = 0.0;
                return elapsed;
            }
        }
        if !fits {
            self.owed = 0.0;
            return elapsed;
        }
        // Only a single refresh refines the period; a late one says little about it.
        if n == 1.0 {
            self.period += 0.05 * (elapsed - self.period);
        }
        let even = n * self.period;
        self.owed += elapsed - even;
        let back = (0.05 * self.owed).clamp(-0.02 * even, 0.02 * even);
        self.owed -= back;
        even + back
    }
}

/// Read and load a `.milk` file.
pub fn load(text: &str, frame: &Frame, size: &Size, seed: u64) -> Result<Runner, LoadError> {
    Runner::new(preset::parse(text), frame, size, seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Frame {
        Frame { frame: 1, time: 1.0, fps: 60.0, bass: 1.0, bass_att: 1.0, mid: 1.0, mid_att: 1.0, treb: 1.0, treb_att: 1.0 }
    }
    const SIZE: Size = Size { texsize_x: 1920.0, texsize_y: 1080.0, mesh_width: 48, mesh_height: 36 };

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

    #[test]
    fn user_variables_carry_and_motion_resets() {
        let text = "[preset00]\nzoom=1.0\nper_frame_init_1=q1 = 5;\nper_frame_1=count = count + 1; zoom = zoom + 0.1; q2 = q1;";
        let mut r = load(text, &frame(), &SIZE, 1).unwrap();
        r.run_frame(&frame(), &SIZE);
        r.run_frame(&frame(), &SIZE);
        // The load ran the frame once; two more make three.
        assert_eq!(r.get("count"), 3.0);
        assert!((r.get("zoom") - 1.1).abs() < 1e-12, "zoom starts from the base value every frame");
        assert_eq!(r.get("q2"), 5.0, "every frame starts from init's qs");
    }

    #[test]
    fn an_identity_mesh_samples_where_it_draws() {
        let text = "[preset00]\nzoom=1\nrot=0\nwarp=0\ndx=0\ndy=0\nsx=1\nsy=1\ncx=0.5\ncy=0.5";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 4, mesh_height: 4 };
        let mut r = load(text, &frame(), &size, 1).unwrap();
        r.run_frame(&frame(), &size);
        let mut uvs = Vec::new();
        r.warp_mesh(1.0, &size, &mut uvs);
        assert_eq!(uvs.len(), 25);
        assert_eq!(uvs[0], [0.0, 1.0]);
        assert_eq!(uvs[24], [1.0, 0.0]);
    }

    #[test]
    fn per_vertex_equations_move_the_mesh() {
        let text = "[preset00]\nwarp=0\nper_pixel_1=dx = 0.1;";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 2, mesh_height: 2 };
        let mut r = load(text, &frame(), &size, 1).unwrap();
        r.run_frame(&frame(), &size);
        let mut uvs = Vec::new();
        r.warp_mesh(1.0, &size, &mut uvs);
        assert!((uvs[4][0] - 0.4).abs() < 1e-6, "{:?}", uvs[4]);
    }

    /// A preset that zooms, turns, stretches and drifts, every step.
    fn moving() -> (Runner, Size) {
        let text = "[preset00]\nzoom=1.04\nrot=0.03\nwarp=0\ndx=0.004\ndy=-0.002\nsx=1.01\nsy=0.99\ncx=0.5\ncy=0.5";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 8, mesh_height: 8 };
        let mut r = load(text, &frame(), &size, 1).unwrap();
        r.run_frame(&frame(), &size);
        (r, size)
    }

    #[test]
    fn a_whole_step_is_milkdrops_map_and_none_is_the_identity() {
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut whole, mut via) = (Vec::new(), Vec::new());
        mesh.uvs(1.0, &mut whole);
        r.warp_mesh(1.0, &size, &mut via);
        assert_eq!(whole, via);
        let mut none = Vec::new();
        mesh.uvs(0.0, &mut none);
        for (i, uv) in none.iter().enumerate() {
            let (ix, iz) = (i % 9, i / 9);
            let (u, v) = (ix as f32 / 8.0, 1.0 - iz as f32 / 8.0);
            assert!((uv[0] - u).abs() < 1e-6 && (uv[1] - v).abs() < 1e-6, "{i}: {uv:?}");
        }
    }

    /// Where a map sends a point, read from the mesh by bilinear interpolation,
    /// in texture coordinates (`u` right, `v` up).
    fn sample(uvs: &[[f32; 2]], n: usize, u: f64, v: f64) -> (f64, f64) {
        let (fx, fz) = (u * n as f64, (1.0 - v) * n as f64);
        let (ix, iz) = ((fx.floor() as usize).min(n - 1), (fz.floor() as usize).min(n - 1));
        let (tx, tz) = (fx - ix as f64, fz - iz as f64);
        let at = |x: usize, z: usize| uvs[z * (n + 1) + x].map(f64::from);
        let lerp = |a: [f64; 2], b: [f64; 2], t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let p = lerp(lerp(at(ix, iz), at(ix + 1, iz), tx), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), tx), tz);
        (p[0], p[1])
    }

    #[test]
    fn parts_of_a_step_compose_to_the_whole() {
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let mut whole = Vec::new();
        mesh.uvs(1.0, &mut whole);
        // The picture after n parts samples the first through every part's map in
        // turn: compose them, and compare with one whole step, in pixels at 512.
        for parts in [2usize, 4] {
            let mut part = Vec::new();
            mesh.uvs(1.0 / parts as f64, &mut part);
            let mut worst = 0f64;
            for i in 0..=16 {
                for j in 0..=16 {
                    let (mut u, mut v) = (0.25 + i as f64 / 32.0, 0.25 + j as f64 / 32.0);
                    for _ in 0..parts {
                        (u, v) = sample(&part, 8, u, v);
                    }
                    let (wu, wv) = sample(&whole, 8, 0.25 + i as f64 / 32.0, 0.25 + j as f64 / 32.0);
                    worst = worst.max(((u - wu).powi(2) + (v - wv).powi(2)).sqrt() * 512.0);
                }
            }
            // A whole step moves these points by up to ~10 px.
            assert!(worst < 0.25, "{parts} parts land {worst:.3} px from a whole step");
        }
    }

    #[test]
    fn between_steps_a_flow_slides_and_a_fold_cross_fades() {
        // A flow (zoom, rotation, a shift, a stretch): both maps are the part.
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut part, mut moved, mut shaded) = (Vec::new(), Vec::new(), Vec::new());
        mesh.uvs(0.5, &mut part);
        mesh.between(0.5, &mut moved, &mut shaded);
        assert!(moved == part && shaded == part, "a flow slides");
        // A kaleidoscope's fold: the right half is the left half mirrored.
        let text = "[preset00]\nzoom=1\nrot=0\nwarp=0\nper_pixel_1=dx = above(x, 0.5) * (2*x - 1);";
        let mut r = load(text, &frame(), &size, 1).unwrap();
        r.run_frame(&frame(), &size);
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut none, mut whole) = (Vec::new(), Vec::new());
        mesh.uvs(0.0, &mut none);
        mesh.uvs(1.0, &mut whole);
        mesh.between(0.5, &mut moved, &mut shaded);
        let n = (size.mesh_width + 1) * (size.mesh_height + 1);
        let (mut slid, mut faded) = (0, 0);
        for i in 0..n {
            let x = (i % (size.mesh_width + 1)) as f64 / size.mesh_width as f64;
            if x < 0.4 {
                // Left of the fold nothing moves.
                assert_eq!((moved[i], shaded[i]), (none[i], none[i]));
                slid += 1;
            } else if x > 0.6 {
                // Mirrored: the moved picture stays put, the shader's is the whole step.
                assert_eq!((moved[i], shaded[i]), (none[i], whole[i]), "vertex {i}");
                faded += 1;
            }
        }
        assert!(slid > 0 && faded > 0);
    }

    #[test]
    fn the_pacer_evens_out_a_display_loop() {
        for hz in [60.0, 120.0] {
            let mut pacer = Pacer::default();
            // The bench's first round after a load is a few microseconds.
            pacer.tick(0.000006);
            let mut seed = 7u64;
            let (mut real, mut paced, mut worst, mut stall) = (0.0, 0.0, 0.0f64, 0.0);
            for i in 0..1200 {
                // A stall of 0.76 s half way, as a slow load makes.
                if i == 600 {
                    stall = 0.76;
                }
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                // The loop wakes up to ±1.5 ms off each refresh; the bench's does by 0.6 ms sd.
                let jitter = ((seed >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) * 0.0015;
                let wake = (i + 1) as f64 / hz + jitter + stall;
                let elapsed = wake - real;
                real = wake;
                let dt = pacer.tick(elapsed);
                paced += dt;
                if i >= 120 && i != 600 {
                    worst = worst.max((dt * hz - 1.0).abs());
                }
            }
            assert!(worst < 0.03, "{hz} Hz: a refresh moves the clock {:.1}% off even", worst * 100.0);
            assert!((paced - real).abs() < 1.0 / hz, "{hz} Hz: over 1200 refreshes the paced time keeps to the real time");
        }
        // A dropped refresh is two refreshes' time; a loop off its rhythm gets its own time.
        let mut pacer = Pacer::default();
        for _ in 0..60 {
            pacer.tick(1.0 / 60.0);
        }
        assert!((pacer.tick(2.0 / 60.0) * 60.0 - 2.0).abs() < 0.03);
        assert_eq!(pacer.tick(0.0071), 0.0071);
        assert_eq!(pacer.tick(f64::NAN), 0.0);
    }

    #[test]
    fn a_lone_hitch_keeps_the_period_and_a_new_rate_is_learnt() {
        for hitch in [1.45, 1.5, 2.0, 10.0] {
            let mut pacer = Pacer::default();
            for _ in 0..60 {
                pacer.tick(1.0 / 60.0);
            }
            pacer.tick(hitch / 60.0);
            assert!((pacer.period * 60.0 - 1.0).abs() < 1e-9, "a {hitch}x hitch changed the period");
            for _ in 0..30 {
                let dt = pacer.tick(1.0 / 60.0);
                assert!((dt * 60.0 - 1.0).abs() < 0.03, "after a {hitch}x hitch a refresh moves the clock {dt}");
            }
        }
        for (a, b) in [(60.0, 120.0), (120.0, 60.0), (60.0, 144.0), (144.0, 50.0)] {
            let mut pacer = Pacer::default();
            for _ in 0..60 {
                pacer.tick(1.0 / a);
            }
            for _ in 0..4 {
                pacer.tick(1.0 / b);
            }
            assert!((pacer.period * b - 1.0).abs() < 0.01, "{a}->{b} Hz: period {}", pacer.period);
            for _ in 0..10 {
                assert!((pacer.tick(1.0 / b) * b - 1.0).abs() < 0.03);
            }
        }
    }

    #[test]
    fn the_clock_follows_the_frame_rate() {
        let mut c = Clock::default();
        for _ in 0..300 {
            c.tick(1.0 / 60.0);
        }
        assert!((c.fps - 60.0).abs() < 1.0, "{}", c.fps);
    }
}
