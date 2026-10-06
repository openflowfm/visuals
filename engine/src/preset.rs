//! A `.milk` file, read into its parts.
//!
//! MilkDrop's format is an INI section of `key=value` lines. Most keys are numbers
//! (`fDecay=0.98`); code is spread over numbered lines (`per_frame_1=…`,
//! `per_frame_2=…`) that are joined back together here; shader lines carry a
//! leading backtick (`` warp_1=`shader_body ``). Waves and shapes are numbered
//! 0–3, with settings under `wavecode_N_` / `shapecode_N_` and code under `wave_N_`
//! / `shape_N_`.
//!
//! Nothing is interpreted beyond that: values keep the names the file gives them,
//! and code is kept as written, because the engine translates it and an editor
//! will one day write it back.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SLOTS: usize = 4;

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preset {
    /// Every numeric `key=value`, by the key as the file spells it.
    pub values: BTreeMap<String, f64>,
    /// `per_frame_init_N`.
    pub init: String,
    /// `per_frame_N`.
    pub frame: String,
    /// `per_pixel_N` — MilkDrop's name for the per-vertex equations.
    pub vertex: String,
    pub waves: [Wave; SLOTS],
    pub shapes: [Shape; SLOTS],
    /// `warp_N`, backticks removed. Empty when the preset has no warp shader.
    pub warp: String,
    /// `comp_N`, likewise.
    pub comp: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wave {
    /// `wavecode_N_*`, by the part after the prefix.
    pub values: BTreeMap<String, f64>,
    pub init: String,
    pub frame: String,
    pub point: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    /// `shapecode_N_*`, by the part after the prefix.
    pub values: BTreeMap<String, f64>,
    pub init: String,
    pub frame: String,
}

/// Numbered lines of one block of code, gathered before they are joined in order.
#[derive(Default)]
struct Lines(BTreeMap<u32, String>);

impl Lines {
    fn put(&mut self, n: u32, line: &str) {
        self.0.insert(n, line.to_owned());
    }
    fn joined(self) -> String {
        self.0.into_values().collect::<Vec<_>>().join("\n")
    }
}

/// Split `name123` into `name` and `123`.
fn numbered(key: &str) -> Option<(&str, u32)> {
    let digits = key.len() - key.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 {
        return None;
    }
    let (name, n) = key.split_at(key.len() - digits);
    Some((name, n.parse().ok()?))
}

/// `wave_2_per_frame` → `(2, "per_frame")`.
fn slot<'a>(key: &'a str, prefix: &str) -> Option<(usize, &'a str)> {
    let rest = key.strip_prefix(prefix)?;
    let (n, tail) = rest.split_once('_')?;
    let n: usize = n.parse().ok()?;
    (n < SLOTS).then_some((n, tail))
}

/// Read a `.milk` file. Lines that are not `key=value`, and values that are
/// neither a number nor a recognised code line, are ignored, as MilkDrop does.
pub fn parse(text: &str) -> Preset {
    let mut preset = Preset::default();
    let (mut init, mut frame, mut vertex, mut warp, mut comp) =
        (Lines::default(), Lines::default(), Lines::default(), Lines::default(), Lines::default());
    let mut waves: [[Lines; 3]; SLOTS] = Default::default();
    let mut shapes: [[Lines; 2]; SLOTS] = Default::default();

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();

        if let Some((name, n)) = numbered(key) {
            let code = match name {
                "per_frame_init_" => Some(&mut init),
                "per_frame_" => Some(&mut frame),
                "per_pixel_" => Some(&mut vertex),
                "warp_" => Some(&mut warp),
                "comp_" => Some(&mut comp),
                _ => None,
            };
            if let Some(lines) = code {
                lines.put(n, value.strip_prefix('`').unwrap_or(value));
                continue;
            }
            if let Some((i, part)) = slot(name, "wave_") {
                let at = match part {
                    "init" => Some(0),
                    "per_frame" => Some(1),
                    "per_point" => Some(2),
                    _ => None,
                };
                if let Some(at) = at {
                    waves[i][at].put(n, value);
                    continue;
                }
            }
            if let Some((i, part)) = slot(name, "shape_") {
                let at = match part {
                    "init" => Some(0),
                    "per_frame" => Some(1),
                    _ => None,
                };
                if let Some(at) = at {
                    shapes[i][at].put(n, value);
                    continue;
                }
            }
        }

        let Ok(number) = value.trim().parse::<f64>() else { continue };
        if let Some((i, part)) = slot(key, "wavecode_") {
            preset.waves[i].values.insert(part.to_owned(), number);
        } else if let Some((i, part)) = slot(key, "shapecode_") {
            preset.shapes[i].values.insert(part.to_owned(), number);
        } else {
            preset.values.insert(key.to_owned(), number);
        }
    }

    preset.init = init.joined();
    preset.frame = frame.joined();
    preset.vertex = vertex.joined();
    preset.warp = warp.joined();
    preset.comp = comp.joined();
    for (i, [a, b, c]) in waves.into_iter().enumerate() {
        preset.waves[i].init = a.joined();
        preset.waves[i].frame = b.joined();
        preset.waves[i].point = c.joined();
    }
    for (i, [a, b]) in shapes.into_iter().enumerate() {
        preset.shapes[i].init = a.joined();
        preset.shapes[i].frame = b.joined();
    }
    preset
}

/// `.milk` files are Windows-1252 text in practice. Every byte maps to a char, so
/// no file is refused for its encoding.
pub fn decode(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "[preset00]\r\nfDecay=0.950000\r\nzoom=1.01\r\n\
        per_frame_init_1=q8 = 0;\r\nper_frame_2=b = 2;\r\nper_frame_1=a = 1;\r\n\
        per_pixel_1=zoom = zoom + rad*0.02;\r\n\
        wavecode_0_enabled=1\r\nwavecode_0_samples=256\r\n\
        wave_0_init1=t1 = 0;\r\nwave_0_per_frame1=t1 = time;\r\nwave_0_per_point1=x = sample;\r\n\
        shapecode_3_sides=6\r\nshape_3_per_frame1=ang = time;\r\n\
        warp_1=`shader_body\r\nwarp_2=`{ ret = 1; }\r\ncomp_1=`shader_body { ret = 0; }\r\n";

    #[test]
    fn reads_values_and_code_in_line_order() {
        let p = parse(SAMPLE);
        assert_eq!(p.values["fDecay"], 0.95);
        assert_eq!(p.values["zoom"], 1.01);
        assert_eq!(p.init, "q8 = 0;");
        assert_eq!(p.frame, "a = 1;\nb = 2;", "numbered lines join in number order");
        assert_eq!(p.vertex, "zoom = zoom + rad*0.02;");
        assert_eq!(p.warp, "shader_body\n{ ret = 1; }", "backticks are removed");
        assert_eq!(p.comp, "shader_body { ret = 0; }");
    }

    #[test]
    fn reads_waves_and_shapes_by_slot() {
        let p = parse(SAMPLE);
        assert_eq!(p.waves[0].values["samples"], 256.0);
        assert_eq!(p.waves[0].init, "t1 = 0;");
        assert_eq!(p.waves[0].frame, "t1 = time;");
        assert_eq!(p.waves[0].point, "x = sample;");
        assert_eq!(p.shapes[3].values["sides"], 6.0);
        assert_eq!(p.shapes[3].frame, "ang = time;");
        assert!(p.shapes[0].frame.is_empty());
    }

    #[test]
    fn ignores_what_it_does_not_understand() {
        let p = parse("[preset00]\nname=not a number\nwave_9_per_point1=x=1;\nnonsense\n");
        assert!(p.values.is_empty());
        assert!(p.waves.iter().all(|w| w.point.is_empty()));
    }
}
