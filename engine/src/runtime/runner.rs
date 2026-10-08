use super::{
    base_values, equation_name, gather, q_names, reg_names, scatter, slots, Frame, Globals, LoadError, Owner, Size, Slots, BASE_DEFAULTS, GLOBALS,
    SHAPE_DEFAULTS, WAVE_DEFAULTS,
};
use crate::eel::{self, Memory, Program, Symbols};
use crate::preset::Preset;
use std::collections::{BTreeMap, HashSet};

/// One preset, loaded: equations compiled, state initialised, ready to run frames.
pub struct Runner {
    pub preset: Preset,
    pub symbols: Symbols,
    frame_eqs: Program,
    pub(super) vertex: Program,
    pub has_vertex: bool,
    pub(super) memory: Memory,
    /// `mdVS`: the base values and the base globals, by slot. Everything a frame starts from.
    base: Vec<f64>,
    q_slots: Slots,
    pub(super) reg_slots: Slots,
    global_slots: Slots,
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
    pub fn globals(frame: &Frame, size: &Size) -> Globals {
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

    /// The qs after this frame's equations — what waves and shapes start from.
    pub fn q_after_frame(&self) -> Vec<f64> {
        gather(&self.frame_vars, &self.q_slots)
    }

    pub fn new(preset: Preset, frame: &Frame, size: &Size, seed: u64) -> Result<Self, LoadError> {
        let mut symbols = Symbols::default();
        let values = base_values(&preset.values, BASE_DEFAULTS);
        // Every name the runner itself moves gets a slot before the equations add theirs.
        for name in values.keys().map(String::as_str).chain(GLOBALS.iter().copied()) {
            symbols.slot(name);
        }
        for name in q_names().chain(reg_names()).chain(["x", "y", "rad", "ang"].map(String::from)) {
            symbols.slot(&name);
        }
        let init = eel::compile(&preset.init, &mut symbols)?;
        let frame_eqs = eel::compile(&preset.frame, &mut symbols)?;
        let vertex = eel::compile(&preset.vertex, &mut symbols)?;
        let mut memory = Memory::new(seed);
        let rand_start = [0; 4].map(|_| memory.random() as f32);
        let rand_preset = [0; 4].map(|_| memory.random() as f32);

        let value_slots = slots(&symbols, values.keys());
        let global_slots = slots(&symbols, GLOBALS);
        let q_slots = slots(&symbols, q_names());
        let reg_slots = slots(&symbols, reg_names());
        let mut base = vec![0.0; symbols.len()];
        scatter(&mut base, &value_slots, &values.values().copied().collect::<Vec<_>>());
        scatter(&mut base, &global_slots, &Self::globals(frame, size));
        let non_user: HashSet<usize> = q_slots.iter().chain(&reg_slots).chain(&value_slots).chain(&global_slots).copied().collect();

        // Init: on a copy of the base. Its qs become every frame's starting qs.
        let mut vars = base.clone();
        init.run(&mut vars, &mut memory);
        let q_init = gather(&vars, &q_slots);
        let regs = gather(&vars, &reg_slots);
        // User variables are those init or the first frame wrote; in slots, the
        // names neither the base nor q/reg own, that the programs mention.
        let mentioned = |s: usize| !non_user.contains(&s) && !["x", "y", "rad", "ang"].iter().any(|n| symbols.get(n) == Some(s));
        let init_user: Vec<(usize, f64)> = (0..symbols.len()).filter(|&s| mentioned(s) && vars[s] != 0.0).map(|s| (s, vars[s])).collect();

        // The first frame runs once at load, to find which variables carry over.
        let mut first = base.clone();
        scatter(&mut first, &q_slots, &q_init);
        scatter(&mut first, &reg_slots, &regs);
        for &(s, v) in &init_user {
            first[s] = v;
        }
        frame_eqs.run(&mut first, &mut memory);
        let user_slots: Slots = (0..symbols.len()).filter(|&s| mentioned(s)).collect();
        let user_values = gather(&first, &user_slots);
        let mut regs = gather(&first, &reg_slots);

        // Waves, then shapes, each from the first frame's qs. An init that
        // writes regs hands them on to the next.
        let q_after = gather(&first, &q_slots);
        let mut scope = |kind: &Kind, i: usize, values: &BTreeMap<String, f64>, code: [&str; 3]| {
            Scope::build(kind, values, code, (frame, size, &q_after, &mut regs), seed ^ (kind.seed + i as u64))
        };
        let waves = preset.waves.iter().enumerate().map(|(i, w)| scope(&WAVE, i, &w.values, [&w.init, &w.frame, &w.point])).collect::<Result<_, _>>()?;
        let shapes = preset.shapes.iter().enumerate().map(|(i, s)| scope(&SHAPE, i, &s.values, [&s.init, &s.frame, ""])).collect::<Result<_, _>>()?;

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
            global_slots,
            q_init,
            regs,
            user_slots,
            user_values,
            frame_vars: first,
            rand_start,
            rand_preset,
        })
    }

    /// `runFrameEquations`: the base, the init qs, the carried user variables
    /// and this frame's globals, then the per-frame equations.
    pub fn run_frame(&mut self, frame: &Frame, size: &Size) {
        let mut vars = self.base.clone();
        scatter(&mut vars, &self.q_slots, &self.q_init);
        scatter(&mut vars, &self.user_slots, &self.user_values);
        scatter(&mut vars, &self.global_slots, &Self::globals(frame, size));
        scatter(&mut vars, &self.reg_slots, &self.regs);
        self.frame_eqs.run(&mut vars, &mut self.memory);
        self.user_values = gather(&vars, &self.user_slots);
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
        for (o, &s) in out.iter_mut().zip(&self.q_slots) {
            *o = self.frame_vars[s] as f32;
        }
        out
    }
}

/// What tells a custom wave's scope from a custom shape's: its defaults, the
/// variables its per-point (or per-instance) code is handed, and the seed its
/// memory starts from, offset by its index.
struct Kind {
    defaults: &'static [(&'static str, f64)],
    point_names: &'static [&'static str],
    seed: u64,
}

const WAVE: Kind = Kind { defaults: WAVE_DEFAULTS, point_names: &["sample", "value1", "value2", "x", "y"], seed: 0x100 };
const SHAPE: Kind = Kind { defaults: SHAPE_DEFAULTS, point_names: &["instance"], seed: 0x200 };

/// What a scope starts from: this frame, the output size, the qs after the
/// preset's first frame, and the regs, which an init may change for the next scope.
type Start<'a> = (&'a Frame, &'a Size, &'a [f64], &'a mut Vec<f64>);

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
    global_slots: Slots,
    user_slots: Slots,
    user_values: Vec<f64>,
    pub memory: Memory,
}

impl Scope {
    /// A wave's or shape's scope from its `.milk` values and code, or none when
    /// it isn't enabled.
    fn build(kind: &Kind, raw: &BTreeMap<String, f64>, code: [&str; 3], start: Start, seed: u64) -> Result<Option<Self>, LoadError> {
        let values = base_values(raw, kind.defaults);
        Ok(if values["enabled"] != 0.0 { Some(Self::new(values, code, start, seed, kind.point_names)?) } else { None })
    }

    fn new(values: BTreeMap<String, f64>, code: [&str; 3], start: Start, seed: u64, point_names: &[&str]) -> Result<Self, LoadError> {
        let (frame, size, q_after_frame, regs) = start;
        let mut symbols = Symbols::default();
        for name in values.keys().map(String::as_str).chain(GLOBALS.iter().copied()).chain(point_names.iter().copied()) {
            symbols.slot(name);
        }
        let ts: Vec<String> = (1..=8).map(|i| format!("t{i}")).collect();
        for name in q_names().chain(reg_names()).chain(ts.iter().cloned()) {
            symbols.slot(&name);
        }
        let init = eel::compile(code[0], &mut symbols)?;
        let frame_eqs = eel::compile(code[1], &mut symbols)?;
        let point = eel::compile(code[2], &mut symbols)?;
        let q_slots = slots(&symbols, q_names());
        let reg_slots = slots(&symbols, reg_names());
        let t_slots = slots(&symbols, &ts);
        let global_slots = slots(&symbols, GLOBALS);
        let base_value_slots: Vec<(usize, f64)> = slots(&symbols, values.keys()).into_iter().zip(values.values().copied()).collect();
        let mut vars = vec![0.0; symbols.len()];
        for &(s, v) in &base_value_slots {
            vars[s] = v;
        }
        scatter(&mut vars, &global_slots, &Runner::globals(frame, size));
        scatter(&mut vars, &q_slots, q_after_frame);
        scatter(&mut vars, &reg_slots, regs);
        let mut memory = Memory::new(seed);
        if !init.is_empty() {
            init.run(&mut vars, &mut memory);
            // Init's regs are everyone's regs from here.
            *regs = gather(&vars, &reg_slots);
            for &(s, v) in &base_value_slots {
                vars[s] = v;
            }
        }
        let t_init = gather(&vars, &t_slots);
        let non_user: HashSet<usize> = q_slots
            .iter()
            .chain(&reg_slots)
            .chain(&t_slots)
            .chain(&global_slots)
            .copied()
            .chain(base_value_slots.iter().map(|(s, _)| *s))
            .chain(slots(&symbols, point_names))
            .collect();
        let user_slots: Slots = (0..symbols.len()).filter(|s| !non_user.contains(s)).collect();
        let user_values = gather(&vars, &user_slots);
        Ok(Self {
            symbols,
            values,
            frame: frame_eqs,
            point,
            base: vars,
            base_value_slots,
            t_slots,
            t_init,
            q_slots,
            reg_slots,
            global_slots,
            user_slots,
            user_values,
            memory,
        })
    }

    /// The variables a frame starts from, after the frame equations.
    pub fn run_frame(&mut self, globals: &Globals, q: &[f64], regs: &[f64]) -> Vec<f64> {
        let mut vars = self.run_frame_prelude(globals, q, regs);
        self.frame.run(&mut vars, &mut self.memory);
        vars
    }

    /// The variables a frame starts from, before any equations run — what a
    /// shape resets each instance's values from.
    pub fn run_frame_prelude(&mut self, globals: &Globals, q: &[f64], regs: &[f64]) -> Vec<f64> {
        let mut vars = self.base.clone();
        scatter(&mut vars, &self.user_slots, &self.user_values);
        scatter(&mut vars, &self.q_slots, q);
        scatter(&mut vars, &self.t_slots, &self.t_init);
        scatter(&mut vars, &self.global_slots, globals);
        scatter(&mut vars, &self.reg_slots, regs);
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
        self.user_values = gather(vars, &self.user_slots);
    }

    pub fn get(&self, vars: &[f64], name: &str) -> f64 {
        self.symbols.get(name).map_or(0.0, |s| vars[s])
    }

    pub fn slot(&self, name: &str) -> usize {
        self.symbols.get(name).expect("registered")
    }
}

#[cfg(test)]
mod tests {
    use crate::runtime::tests::{frame, running, SIZE};

    #[test]
    fn user_variables_carry_and_motion_resets() {
        let text = "[preset00]\nzoom=1.0\nper_frame_init_1=q1 = 5;\nper_frame_1=count = count + 1; zoom = zoom + 0.1; q2 = q1;";
        let mut r = running(text, &SIZE);
        r.run_frame(&frame(), &SIZE);
        // The load ran the frame once; two more make three.
        assert_eq!(r.get("count"), 3.0);
        assert!((r.get("zoom") - 1.1).abs() < 1e-12, "zoom starts from the base value every frame");
        assert_eq!(r.get("q2"), 5.0, "every frame starts from init's qs");
    }
}
