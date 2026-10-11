//! A preset's own speed and sensitivity (`library.json`'s `tune`,
//! [`crate::userlib::PresetTune`]): while a preset plays, the picture moves at
//! the playlist's or live speed × the preset's own, and hears at the
//! sensitivity × the preset's own. Leaving the preset goes back to the
//! playlist's or live values; changing the preset's own while it plays applies
//! at once.
//!
//! The 0.5 contract's stub for the "apply" lane, which fills in this file (and
//! how [`crate::fx`] and [`crate::bench`] take the multipliers): today nothing
//! changes how a preset plays. Its two hooks are already called:
//!
//! - [`apply_preset_tune`] from `crate::resume::open_reported`, every time a
//!   preset file loads on the bench (the deck's steps, a playlist, the library's
//!   grid, the start preset, a drop): every open goes through there.
//! - [`retune`] from `crate::userlib::library_set`, after a change that sets or
//!   clears a preset's tune is kept.
//!
//! [`crate::userlib::tune_of`] gives a preset's tune by its path.

use std::path::Path;
use tauri::AppHandle;

/// The preset at `path` just loaded on the bench: take its tune
/// ([`crate::userlib::tune_of`]), as made when it has none. A stub: nothing yet.
pub fn apply_preset_tune(handle: &AppHandle, path: &Path) {
    let _ = (handle, path);
}

/// Some preset's tune changed: take the playing preset's again, in case it was
/// that one. A stub: nothing yet.
pub fn retune(handle: &AppHandle) {
    let _ = handle;
}
