//! How much work a picture costs: the render scale (the size presets draw at,
//! relative to the size asked for, scaled up when presented) and the warp mesh's
//! size. Three named levels, and auto, which picks one by machine and output
//! size. See "Quality"
//! in docs/milkdrop-engine.md for the levels, the cut points and what each costs.

use serde::{Deserialize, Serialize};

/// What a renderer draws at ([`crate::render::Renderer::set_quality`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quality {
    /// The size presets draw at, as a fraction of the size asked for, per side;
    /// the picture is scaled up to it when presented. [`SCALE_RANGE`] bounds it.
    pub scale: f32,
    /// The warp mesh, in cells across and down: MilkDrop's "mesh size" option.
    /// The per-vertex equations run once per vertex, `(w + 1) × (h + 1)` a step.
    pub mesh: (usize, usize),
}

/// The render scales a renderer accepts; others are clamped into it.
pub const SCALE_RANGE: (f32, f32) = (0.25, 1.0);
/// The mesh sizes a renderer accepts, per side; others are clamped into it.
/// MilkDrop's own option goes from 8×6 to 192×144.
pub const MESH_RANGE: (usize, usize) = (8, 192);

impl Default for Quality {
    /// Full size and MilkDrop's default 48×36 mesh: [`Level::High`].
    fn default() -> Self {
        Level::High.quality()
    }
}

impl Quality {
    /// This quality with its scale and mesh clamped into [`SCALE_RANGE`] and
    /// [`MESH_RANGE`]; a scale that is not a number is full size.
    pub fn clamped(self) -> Self {
        let scale = if self.scale.is_finite() { self.scale.clamp(SCALE_RANGE.0, SCALE_RANGE.1) } else { SCALE_RANGE.1 };
        let side = |n: usize| n.clamp(MESH_RANGE.0, MESH_RANGE.1);
        Self { scale, mesh: (side(self.mesh.0), side(self.mesh.1)) }
    }

    /// The size presets draw at when `size` is asked for: each side times the
    /// scale, rounded, at least 1. The aspect is kept to within a pixel.
    pub fn scaled(&self, size: (u32, u32)) -> (u32, u32) {
        let scale = self.clamped().scale as f64;
        let side = |n: u32| ((n.max(1) as f64 * scale).round() as u32).max(1);
        (side(size.0), side(size.1))
    }
}

/// The named levels, cheapest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Half size per side (a quarter of the pixels) and a 32×24 mesh.
    Low,
    /// Three quarters per side (56% of the pixels) and the default 48×36 mesh.
    Medium,
    /// Full size and the default 48×36 mesh: the picture as MilkDrop and
    /// Butterchurn draw it.
    High,
}

impl Level {
    pub const ALL: [Level; 3] = [Level::Low, Level::Medium, Level::High];

    pub fn quality(self) -> Quality {
        match self {
            Level::Low => Quality { scale: 0.5, mesh: (32, 24) },
            Level::Medium => Quality { scale: 0.75, mesh: (48, 36) },
            Level::High => Quality { scale: 1.0, mesh: (48, 36) },
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Level::Low => "low",
            Level::Medium => "medium",
            Level::High => "high",
        }
    }
}

impl std::str::FromStr for Level {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        Level::ALL.into_iter().find(|l| l.name() == s).ok_or_else(|| format!("no quality level {s:?}: low, medium or high"))
    }
}

/// What a person chooses: a level, or auto ([`Setting::level`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Setting {
    #[default]
    Auto,
    Low,
    Medium,
    High,
}

impl Setting {
    /// The level this setting draws at on `machine`, for an output `output`
    /// pixels big.
    pub fn level(self, machine: &Machine, output: (u32, u32)) -> Level {
        match self {
            Setting::Auto => auto(machine, output),
            Setting::Low => Level::Low,
            Setting::Medium => Level::Medium,
            Setting::High => Level::High,
        }
    }
}

/// What auto picks by: the chip, its GPU cores and the memory, each `None`
/// when it couldn't be read.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Machine {
    /// The chip's name, for example "Apple M1 Max".
    pub chip: Option<String>,
    pub gpu_cores: Option<u32>,
    pub memory_bytes: Option<u64>,
}

const GB: u64 = 1 << 30;

/// The GPU's time a refresh, in ms per megapixel drawn, on a GPU of
/// [`Machine::gpu_score`] 1, for the slowest preset of the bench's starter
/// sample: 0.33 ms/MP measured on an M1 Max (score 32) between 6K and 8K,
/// where it is the GPU that limits it. See "Quality" in docs/milkdrop-engine.md.
pub const WORST_MS_PER_MP: f64 = 10.6;
/// The GPU time a refresh auto allows: well inside 60 fps's 16.7 ms, leaving
/// the rest to the equations, the app and the window server.
pub const BUDGET_MS: f64 = 10.0;
/// The budget under [`ENOUGH_MEMORY`]: the GPU shares the memory and its
/// bandwidth, and an 8 GB machine is the one the app must not crowd.
pub const LOW_MEMORY_BUDGET_MS: f64 = 7.5;
pub const ENOUGH_MEMORY: u64 = 16 * GB;

impl Machine {
    /// This machine, read from `sysctl` and the GPU's IORegistry entry on a Mac;
    /// nothing elsewhere.
    pub fn detect() -> Self {
        if !cfg!(target_os = "macos") {
            return Self::default();
        }
        let run = |cmd: &str, args: &[&str]| -> Option<String> {
            let out = std::process::Command::new(cmd).args(args).output().ok()?;
            out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
        };
        let chip = run("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"]).map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
        let memory_bytes = run("/usr/sbin/sysctl", &["-n", "hw.memsize"]).and_then(|s| s.trim().parse().ok());
        let gpu_cores = run("/usr/sbin/ioreg", &["-rc", "AGXAccelerator", "-d1"]).and_then(|s| gpu_core_count(&s));
        Self { chip, gpu_cores, memory_bytes }
    }

    /// Apple silicon's generation and tier from the chip's name: ("Apple M2
    /// Pro") → (2, "pro"); `None` for any other chip.
    pub fn apple(&self) -> Option<(u32, &'static str)> {
        let name = self.chip.as_deref()?.strip_prefix("Apple M")?;
        let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
        let generation = digits.parse().ok()?;
        let rest = name[digits.len()..].trim().to_ascii_lowercase();
        let tier = ["pro", "max", "ultra"].into_iter().find(|t| rest.starts_with(t)).unwrap_or("base");
        Some((generation, tier))
    }

    /// The GPU's speed in base-M1 GPU cores: its cores (or, unread, the fewest
    /// its tier ships with) × how much faster a core of its generation is than
    /// an M1's. `None` for a chip that isn't Apple silicon.
    pub fn gpu_score(&self) -> Option<f64> {
        let (generation, tier) = self.apple()?;
        let fewest = match tier {
            "pro" => 14,
            "max" => 24,
            "ultra" => 48,
            _ if generation == 1 => 7,
            _ => 8,
        };
        let per_core = match generation {
            0 | 1 => 1.0,
            2 => 1.2,
            3 => 1.35,
            4 => 1.5,
            _ => 1.7,
        };
        Some(self.gpu_cores.unwrap_or(fewest) as f64 * per_core)
    }
}

/// The `gpu-core-count` in `ioreg -rc AGXAccelerator` output.
fn gpu_core_count(ioreg: &str) -> Option<u32> {
    let line = ioreg.lines().find(|l| l.contains("\"gpu-core-count\""))?;
    line.split('=').nth(1)?.trim().parse().ok()
}

/// The GPU's time a refresh at `level` on `machine` for an output `output`
/// pixels big, in ms, for the slowest preset of the starter sample
/// ([`WORST_MS_PER_MP`]); `None` for a machine without a [`Machine::gpu_score`].
pub fn estimate_ms(machine: &Machine, level: Level, output: (u32, u32)) -> Option<f64> {
    let (w, h) = level.quality().scaled(output);
    Some(WORST_MS_PER_MP * (w as f64 * h as f64 / 1e6) / machine.gpu_score()?)
}

/// The level auto picks on `machine` for an output `output` pixels big: the
/// best whose [`estimate_ms`] fits the budget ([`BUDGET_MS`], or
/// [`LOW_MEMORY_BUDGET_MS`] under [`ENOUGH_MEMORY`]), else Low. A machine it
/// can't place (not Apple silicon, or the chip unread) gets Medium.
pub fn auto(machine: &Machine, output: (u32, u32)) -> Level {
    if machine.gpu_score().is_none() {
        return Level::Medium;
    }
    let budget = match machine.memory_bytes {
        Some(m) if m < ENOUGH_MEMORY => LOW_MEMORY_BUDGET_MS,
        _ => BUDGET_MS,
    };
    [Level::High, Level::Medium].into_iter().find(|&l| estimate_ms(machine, l, output).is_some_and(|ms| ms <= budget)).unwrap_or(Level::Low)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(chip: &str, cores: Option<u32>, gb: u64) -> Machine {
        Machine { chip: Some(chip.into()), gpu_cores: cores, memory_bytes: Some(gb * GB) }
    }

    #[test]
    fn scale_keeps_the_aspect_and_rounds() {
        assert_eq!(Level::High.quality().scaled((1920, 1080)), (1920, 1080));
        assert_eq!(Level::Medium.quality().scaled((1920, 1080)), (1440, 810));
        assert_eq!(Level::Low.quality().scaled((1920, 1080)), (960, 540));
        assert_eq!(Level::Low.quality().scaled((3840, 2160)), (1920, 1080));
        assert_eq!(Level::Medium.quality().scaled((1081, 1921)), (811, 1441));
        // Never below a pixel.
        assert_eq!(Level::Low.quality().scaled((1, 0)), (1, 1));
    }

    #[test]
    fn scale_and_mesh_are_clamped() {
        let q = Quality { scale: 3.0, mesh: (1, 1000) }.clamped();
        assert_eq!((q.scale, q.mesh), (1.0, (8, 192)));
        assert_eq!(Quality { scale: 0.01, mesh: (48, 36) }.scaled((1000, 400)), (250, 100));
        assert_eq!(Quality { scale: f32::NAN, mesh: (48, 36) }.scaled((640, 360)), (640, 360));
    }

    #[test]
    fn levels_get_cheaper_downwards() {
        for pair in Level::ALL.windows(2) {
            let (a, b) = (pair[0].quality(), pair[1].quality());
            assert!(a.scale <= b.scale && a.mesh.0 * a.mesh.1 <= b.mesh.0 * b.mesh.1 && a != b);
        }
        assert_eq!(Quality::default(), Quality { scale: 1.0, mesh: (48, 36) });
    }

    #[test]
    fn levels_and_settings_read_and_write_by_name() {
        for l in Level::ALL {
            assert_eq!(l.name().parse::<Level>(), Ok(l));
            assert_eq!(serde_json::to_string(&l).unwrap(), format!("\"{}\"", l.name()));
        }
        assert!("ultra".parse::<Level>().is_err());
        assert_eq!(serde_json::from_str::<Setting>("\"auto\"").unwrap(), Setting::Auto);
        assert_eq!(Setting::default(), Setting::Auto);
    }

    #[test]
    fn reads_the_chip() {
        assert_eq!(mac("Apple M1", None, 8).apple(), Some((1, "base")));
        assert_eq!(mac("Apple M2 Pro", None, 8).apple(), Some((2, "pro")));
        assert_eq!(mac("Apple M1 Max", None, 8).apple(), Some((1, "max")));
        assert_eq!(mac("Apple M10 Ultra", None, 8).apple(), Some((10, "ultra")));
        assert_eq!(mac("Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz", None, 8).apple(), None);
        assert_eq!(Machine::default().apple(), None);
        assert_eq!(gpu_core_count("  | {\n    \"gpu-core-count\" = 32\n  }"), Some(32));
        assert_eq!(gpu_core_count("nothing"), None);
    }

    #[test]
    fn scores_the_gpu() {
        assert_eq!(mac("Apple M1", Some(8), 8).gpu_score(), Some(8.0));
        // Cores unread: the fewest the tier ships with.
        assert_eq!(mac("Apple M1", None, 8).gpu_score(), Some(7.0));
        assert_eq!(mac("Apple M2 Pro", None, 16).gpu_score(), Some(14.0 * 1.2));
        assert_eq!(mac("Apple M1 Max", Some(32), 32).gpu_score(), Some(32.0));
        assert_eq!(Machine { chip: Some("AMD Ryzen".into()), gpu_cores: Some(64), memory_bytes: None }.gpu_score(), None);
    }

    #[test]
    fn estimates_scale_with_pixels_drawn_and_the_gpu() {
        let m1 = mac("Apple M1", Some(8), 8);
        let at = |l, size| estimate_ms(&m1, l, size).unwrap();
        // 4K at Low draws 1080p's pixels; Medium 56% of High's.
        assert!((at(Level::Low, (3840, 2160)) - at(Level::High, (1920, 1080))).abs() < 1e-9);
        assert!((at(Level::Medium, (3840, 2160)) / at(Level::High, (3840, 2160)) - 0.5625).abs() < 1e-9);
        // The slowest preset at 1080p on a base M1: about 2.7 ms of GPU.
        assert!((at(Level::High, (1920, 1080)) - 10.6 * 2.0736 / 8.0).abs() < 1e-9);
        // Four times the GPU, a quarter of the time.
        let max = mac("Apple M1 Max", Some(32), 32);
        assert!((estimate_ms(&max, Level::High, (1920, 1080)).unwrap() * 4.0 - at(Level::High, (1920, 1080))).abs() < 1e-9);
        assert_eq!(estimate_ms(&Machine::default(), Level::High, (1920, 1080)), None);
    }

    #[test]
    fn auto_picks_by_gpu_memory_and_size() {
        const HD: (u32, u32) = (1920, 1080);
        const UHD: (u32, u32) = (3840, 2160);
        // The base M1 with 8 GB, either GPU: High at 1080p, Medium at 4K.
        for cores in [Some(7), Some(8), None] {
            assert_eq!(auto(&mac("Apple M1", cores, 8), HD), Level::High);
            assert_eq!(auto(&mac("Apple M1", cores, 8), UHD), Level::Medium);
        }
        // This machine, and the other Pro and Max chips: High at 4K.
        assert_eq!(auto(&mac("Apple M1 Max", Some(32), 32), UHD), Level::High);
        assert_eq!(auto(&mac("Apple M1 Pro", Some(14), 16), UHD), Level::High);
        assert_eq!(auto(&mac("Apple M3 Pro", None, 18), UHD), Level::High);
        // An 8-core M2 is High at 4K with 16 GB, Medium with 8.
        assert_eq!(auto(&mac("Apple M2", Some(8), 16), UHD), Level::High);
        assert_eq!(auto(&mac("Apple M2", Some(8), 8), UHD), Level::Medium);
        // A GPU slower than any shipped (cores read wrong, say), or an output
        // too big for even Low: Low.
        assert_eq!(auto(&mac("Apple M1", Some(4), 16), UHD), Level::Low);
        assert_eq!(auto(&mac("Apple M1", Some(8), 8), (7680, 4320)), Level::Low);
        // Unplaceable: Medium.
        assert_eq!(auto(&Machine::default(), HD), Level::Medium);
        assert_eq!(auto(&mac("Intel(R) Core(TM) i9", Some(64), 64), UHD), Level::Medium);
    }

    #[test]
    fn a_setting_is_its_level_or_auto_s() {
        let m = mac("Apple M1", Some(8), 8);
        assert_eq!(Setting::Auto.level(&m, (3840, 2160)), auto(&m, (3840, 2160)));
        assert_eq!(Setting::Low.level(&m, (1920, 1080)), Level::Low);
        assert_eq!(Setting::High.level(&m, (3840, 2160)), Level::High);
    }
}
