//! The quality setting: render scale and mesh size, at three levels or picked
//! for the machine (`auto`) (#101). The levels and auto's pick are the engine's
//! (`engine::quality`); this keeps the choice between launches
//! (`~/.openflow/visuals/quality.json`), hands the bench's renderer the level
//! in effect — the one renderer the app runs, which draws both the preview and
//! the live output — and picks auto's level again whenever the size it draws
//! at changes (the output opened on a display rotated to portrait, say).

use crate::bench;
use engine::quality::{self as eq, Machine, Setting};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Listener, Manager};

/// A quality level; `auto` picks one of the others for the machine.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    #[default]
    Auto,
    Low,
    Medium,
    High,
}

impl Level {
    fn setting(self) -> Setting {
        match self {
            Level::Auto => Setting::Auto,
            Level::Low => Setting::Low,
            Level::Medium => Setting::Medium,
            Level::High => Setting::High,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Level::Auto => "auto",
            Level::Low => "low",
            Level::Medium => "medium",
            Level::High => "high",
        }
    }
}

impl From<eq::Level> for Level {
    fn from(level: eq::Level) -> Self {
        match level {
            eq::Level::Low => Level::Low,
            eq::Level::Medium => Level::Medium,
            eq::Level::High => Level::High,
        }
    }
}

/// The level the user chose, the one drawn at (never `auto`), and one line on
/// why: what auto went by, or what auto would pick when a level is chosen.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Quality {
    pub chosen: Level,
    pub effective: Level,
    pub reason: String,
}

/// Where the choice is kept, in `settings::dir`.
const FILE: &str = "quality.json";

#[derive(Serialize, Deserialize, Default)]
struct Kept {
    chosen: Level,
}

/// What this module holds between calls: the choice, the size the renderer
/// draws at, and the level last handed to it.
struct State {
    chosen: Level,
    drawn: (u32, u32),
    applied: Option<eq::Level>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State { chosen: load(&crate::settings::dir()), drawn: bench::DRAW, applied: None }))
}

/// This machine, read once (it runs `sysctl` and `ioreg`).
fn machine() -> &'static Machine {
    static MACHINE: OnceLock<Machine> = OnceLock::new();
    MACHINE.get_or_init(Machine::detect)
}

/// The choice kept in `dir`; auto when there is none, or it doesn't read.
fn load(dir: &Path) -> Level {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|text| serde_json::from_str::<Kept>(&text).ok()).map(|k| k.chosen).unwrap_or_default()
}

/// Keep `chosen` in `dir`, making the folder if need be. A failure is not worth stopping for.
fn save(dir: &Path, chosen: Level) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(text) = serde_json::to_string_pretty(&Kept { chosen }) {
        let _ = std::fs::write(dir.join(FILE), text);
    }
}

/// The machine in a few words: "Apple M1 Max, 32 graphics cores, 64 GB".
fn describe(machine: &Machine) -> String {
    let mut parts = vec![machine.chip.clone().unwrap_or_else(|| "this Mac".into())];
    if let Some(cores) = machine.gpu_cores {
        parts.push(format!("{cores} graphics cores"));
    }
    if let Some(bytes) = machine.memory_bytes {
        parts.push(format!("{} GB", bytes >> 30));
    }
    parts.join(", ")
}

/// The quality `chosen` comes to on `machine`, drawing `drawn` pixels, with
/// the line saying why.
fn resolve(chosen: Level, machine: &Machine, drawn: (u32, u32)) -> Quality {
    let auto = eq::auto(machine, drawn);
    let effective: Level = chosen.setting().level(machine, drawn).into();
    let picked = Level::from(auto).name();
    let reason = if chosen != Level::Auto {
        format!("Chosen by you; auto would pick {picked} here.")
    } else if machine.gpu_score().is_none() {
        format!("Auto picked {picked}: couldn't tell how fast this Mac's graphics are.")
    } else {
        let ms = eq::estimate_ms(machine, auto, drawn).unwrap_or(0.0);
        let budget = match machine.memory_bytes {
            Some(m) if m < eq::ENOUGH_MEMORY => eq::LOW_MEMORY_BUDGET_MS,
            _ => eq::BUDGET_MS,
        };
        let fits = if ms <= budget { "within" } else { "over" };
        format!("Auto picked {picked} for {}: about {ms:.1} ms a frame at {}×{}, {fits} the {budget} ms it allows.", describe(machine), drawn.0, drawn.1)
    };
    Quality { chosen, effective, reason }
}

/// The size the renderer draws at for the `output` event's payload: the
/// output's display decides it while open (`bench::draw_size`), otherwise
/// `bench::DRAW`. `None` for a payload that doesn't read.
fn drawn_for(payload: &str) -> Option<(u32, u32)> {
    #[derive(Deserialize)]
    struct Shown {
        display: Option<Size>,
    }
    #[derive(Deserialize)]
    struct Size {
        width: u32,
        height: u32,
    }
    let shown: Shown = serde_json::from_str(payload).ok()?;
    Some(shown.display.map_or(bench::DRAW, |d| bench::draw_size((d.width, d.height))))
}

/// Hand the renderer the level in effect, when it isn't the one it has.
fn apply(handle: &AppHandle) -> Quality {
    // Send while the lock is held, so commands reach the renderer in the
    // order they're recorded in `applied`.
    let mut s = state().lock().unwrap();
    let level = s.chosen.setting().level(machine(), s.drawn);
    if s.applied != Some(level) {
        s.applied = Some(level);
        handle.state::<crate::App>().send(bench::Cmd::Quality(level.quality()));
    }
    resolve(s.chosen, machine(), s.drawn)
}

/// What the bench's renderer starts at: the kept choice, at [`bench::DRAW`].
pub fn initial() -> eq::Quality {
    let mut s = state().lock().unwrap();
    let level = s.chosen.setting().level(machine(), s.drawn);
    s.applied = Some(level);
    level.quality()
}

/// The quality now.
#[tauri::command]
pub fn quality_get() -> Quality {
    let s = state().lock().unwrap();
    resolve(s.chosen, machine(), s.drawn)
}

/// Chooses the quality, keeps it for next launch, and draws at it from now on.
#[tauri::command]
pub fn quality_set(level: Level, handle: AppHandle) -> Result<Quality, String> {
    state().lock().unwrap().chosen = level;
    save(&crate::settings::dir(), level);
    Ok(apply(&handle))
}

/// Called once at setup: reads the machine off the main thread, and picks
/// auto's level again whenever the output opens, moves or closes.
pub fn start(handle: &AppHandle) {
    std::thread::spawn(|| {
        machine();
    });
    let h = handle.clone();
    handle.listen("output", move |event| {
        if let Some(drawn) = drawn_for(event.payload()) {
            state().lock().unwrap().drawn = drawn;
            apply(&h);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;
    fn mac(chip: &str, cores: u32, gb: u64) -> Machine {
        Machine { chip: Some(chip.into()), gpu_cores: Some(cores), memory_bytes: Some(gb * GB) }
    }

    #[test]
    fn levels_read_and_write_by_name() {
        assert_eq!(serde_json::from_str::<Level>(r#""medium""#).unwrap(), Level::Medium);
        assert_eq!(serde_json::to_string(&Level::Auto).unwrap(), r#""auto""#);
        assert_eq!(Level::default(), Level::Auto);
    }

    #[test]
    fn auto_says_what_it_picked_and_why() {
        let q = resolve(Level::Auto, &mac("Apple M1", 8, 8), (1920, 1080));
        assert_eq!((q.chosen, q.effective), (Level::Auto, Level::High));
        assert_eq!(q.reason, "Auto picked high for Apple M1, 8 graphics cores, 8 GB: about 2.7 ms a frame at 1920×1080, within the 7.5 ms it allows.");
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!((json["chosen"].as_str(), json["effective"].as_str()), (Some("auto"), Some("high")));
    }

    #[test]
    fn auto_on_a_mac_it_cant_place_is_medium() {
        let q = resolve(Level::Auto, &Machine::default(), (1920, 1080));
        assert_eq!(q.effective, Level::Medium);
        assert_eq!(q.reason, "Auto picked medium: couldn't tell how fast this Mac's graphics are.");
    }

    #[test]
    fn a_chosen_level_is_drawn_at_and_says_what_auto_would_pick() {
        let q = resolve(Level::Low, &mac("Apple M1 Max", 32, 64), (1920, 1080));
        assert_eq!((q.chosen, q.effective), (Level::Low, Level::Low));
        assert_eq!(q.reason, "Chosen by you; auto would pick high here.");
    }

    #[test]
    fn auto_picks_again_for_the_size_drawn() {
        // A GPU too slow for High at 1080p's pixels, but not at 720p's.
        let slow = mac("Apple M1", 2, 8);
        assert_eq!(resolve(Level::Auto, &slow, (1920, 1080)).effective, Level::Medium);
        assert_eq!(resolve(Level::Auto, &slow, (1280, 720)).effective, Level::High);
    }

    #[test]
    fn the_output_event_sets_the_size_drawn() {
        assert_eq!(drawn_for(r#"{"display":null,"size":null}"#), Some(bench::DRAW));
        let landscape = r#"{"display":{"id":1,"index":0,"name":"P","width":3840,"height":2160,"main":false},"size":[3840,2160]}"#;
        assert_eq!(drawn_for(landscape), Some(bench::DRAW));
        let portrait = r#"{"display":{"id":1,"index":0,"name":"P","width":1080,"height":1920,"main":false},"size":[1080,1920]}"#;
        assert_eq!(drawn_for(portrait), Some((1080, 1920)));
        assert_eq!(drawn_for("nope"), None);
    }

    #[test]
    fn the_choice_is_kept_between_launches() {
        let dir = std::env::temp_dir().join(format!("visuals-quality-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), Level::Auto);
        save(&dir, Level::Medium);
        assert_eq!(load(&dir), Level::Medium);
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert_eq!(load(&dir), Level::Auto);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
