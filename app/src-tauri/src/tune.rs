//! A preset's own speed and sensitivity (`library.json`'s `tune`,
//! [`crate::userlib::PresetTune`]): while a preset plays, the picture moves at
//! the playlist's or live speed × the preset's own, and hears at the
//! sensitivity × the preset's own ([`crate::fx::Fx::tune`], which
//! [`crate::fx::Fx::speed_now`] and [`crate::fx::Fx::gain`] multiply in). The
//! playlist's and live values are never written: the next preset to load takes
//! its own tune (1 when it has none), so leaving a preset goes back to them.
//! Changing the playing preset's own applies at once.
//!
//! Two hooks:
//!
//! - [`apply_preset_tune`] from `crate::resume::open_reported`, every time a
//!   preset file loads on the bench (the deck's steps, a playlist, the library's
//!   grid, the start preset, a drop, the lab editor's open): every open goes
//!   through there. A preset that fails to load leaves the last one playing, and
//!   its tune with it. The lab editor's reloads of an edited preset don't come
//!   here, so an edit keeps the tune of the preset it opened.
//! - [`retune`] from `crate::userlib::library_set`, after a change that sets or
//!   clears a preset's tune is kept.
//!
//! In the show, a new preset crossfades from the last one's picture, and the
//! engine moves both on one clock: the incoming preset's tune applies as the
//! fade starts, since it's the one the viewer is left watching.
//!
//! [`crate::userlib::tune_of`] gives a preset's tune by its path.

use crate::fx::{Fx, Tune};
use crate::userlib::PresetTune;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The preset playing now, by the path it was opened from: what [`retune`] looks up.
static PLAYING: Mutex<Playing> = Mutex::new(Playing { path: None });

/// The preset at `path` just loaded on the bench: take its tune
/// ([`crate::userlib::tune_of`]), as made when it has none.
pub fn apply_preset_tune(handle: &AppHandle, path: &Path) {
    let fx = handle.state::<crate::actions::Deck>().fx.clone();
    PLAYING.lock().unwrap().open(path, |p| crate::userlib::tune_of(handle, p), &fx);
}

/// Some preset's tune changed: take the playing preset's again, in case it was
/// that one.
pub fn retune(handle: &AppHandle) {
    let fx = handle.state::<crate::actions::Deck>().fx.clone();
    PLAYING.lock().unwrap().retune(|p| crate::userlib::tune_of(handle, p), &fx);
}

/// What is playing. Its lock is held while the tune is looked up and set, so an
/// open and a retune at once can't leave the last preset's tune on the new one.
/// Called without `userlib::Store`'s data held (`tune_of` takes it).
struct Playing {
    path: Option<PathBuf>,
}

impl Playing {
    /// `path` is playing now: its tune, by `tune_of`, goes on `fx`.
    fn open(&mut self, path: &Path, tune_of: impl Fn(&Path) -> PresetTune, fx: &Mutex<Fx>) {
        self.path = Some(path.to_path_buf());
        set(fx, tune_of(path));
    }

    /// The playing preset's tune again, if one is playing.
    fn retune(&self, tune_of: impl Fn(&Path) -> PresetTune, fx: &Mutex<Fx>) {
        if let Some(path) = &self.path {
            set(fx, tune_of(path));
        }
    }
}

fn set(fx: &Mutex<Fx>, tune: PresetTune) {
    fx.lock().unwrap().tune = Tune { speed: tune.speed(), sensitivity: tune.sensitivity() };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::FxAction;
    use std::collections::HashMap;
    use std::time::Instant;

    fn tunes(list: &[(&str, f64, f64)]) -> HashMap<PathBuf, PresetTune> {
        list.iter().map(|&(p, speed, sensitivity)| (PathBuf::from(p), PresetTune { speed: Some(speed), sensitivity: Some(sensitivity) })).collect()
    }

    fn lookup(map: &HashMap<PathBuf, PresetTune>) -> impl Fn(&Path) -> PresetTune + '_ {
        |p| map.get(p).copied().unwrap_or_default()
    }

    /// The effects with the playlist's speed 2 and sensitivity 1.5.
    fn playlist() -> Mutex<Fx> {
        let now = Instant::now();
        let mut fx = Fx::new(now);
        fx.apply(&FxAction::Speed { speed: 2.0 }, now).unwrap();
        fx.apply(&FxAction::Sensitivity { value: 1.5 }, now).unwrap();
        Mutex::new(fx)
    }

    fn effective(fx: &Mutex<Fx>) -> (f64, f64) {
        let fx = fx.lock().unwrap();
        (fx.speed_now(Instant::now()), fx.gain())
    }

    #[test]
    fn a_tuned_preset_plays_at_the_playlists_values_times_its_own() {
        let (fx, map) = (playlist(), tunes(&[("/p/a.milk", 0.5, 2.0)]));
        let mut playing = Playing { path: None };
        playing.open(Path::new("/p/a.milk"), lookup(&map), &fx);
        assert_eq!(effective(&fx), (1.0, 3.0));
        let fx = fx.lock().unwrap();
        assert_eq!((fx.settings.speed, fx.settings.sensitivity), (2.0, 1.5), "the playlist's values are kept");
    }

    #[test]
    fn a_preset_without_a_tune_plays_at_the_playlists_values() {
        let (fx, map) = (playlist(), tunes(&[]));
        let mut playing = Playing { path: None };
        playing.open(Path::new("/p/plain.milk"), lookup(&map), &fx);
        assert_eq!(effective(&fx), (2.0, 1.5));
    }

    #[test]
    fn switching_presets_takes_the_next_ones_tune_or_none() {
        let (fx, map) = (playlist(), tunes(&[("/p/a.milk", 0.5, 2.0), ("/p/b.milk", 4.0, 0.25)]));
        let mut playing = Playing { path: None };
        playing.open(Path::new("/p/a.milk"), lookup(&map), &fx);
        playing.open(Path::new("/p/b.milk"), lookup(&map), &fx);
        assert_eq!(effective(&fx), (8.0, 0.375));
        playing.open(Path::new("/p/plain.milk"), lookup(&map), &fx);
        assert_eq!(effective(&fx), (2.0, 1.5), "back to the playlist's values");
    }

    #[test]
    fn retune_takes_the_playing_presets_new_tune_at_once() {
        let fx = playlist();
        let mut map = tunes(&[("/p/a.milk", 0.5, 2.0)]);
        let mut playing = Playing { path: None };
        playing.retune(lookup(&map), &fx);
        assert_eq!(effective(&fx), (2.0, 1.5), "nothing playing: nothing to tune");
        playing.open(Path::new("/p/a.milk"), lookup(&map), &fx);
        map = tunes(&[("/p/a.milk", 0.25, 1.0), ("/p/other.milk", 4.0, 4.0)]);
        playing.retune(lookup(&map), &fx);
        assert_eq!(effective(&fx), (0.5, 1.5));
        map.remove(Path::new("/p/a.milk"));
        playing.retune(lookup(&map), &fx);
        assert_eq!(effective(&fx), (2.0, 1.5), "its tune cleared: as made");
    }
}
