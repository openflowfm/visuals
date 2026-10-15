//! Esc held to leave live: the live output fading toward black over the hold, so
//! leaving is never a sudden cut, and back quickly when Esc is let go early. The
//! page says when the hold starts and when it is cancelled (`output_leaving`);
//! the main window's own fade is the page's (StageLayout's veil). With motion
//! reduced there is no fade: the page shows the hint and its progress only.

use std::time::{Duration, Instant};

/// How long the fade takes to reach [`DEEPEST`]: the page's `LEAVE_HOLD_MS`.
pub const HOLD: Duration = Duration::from_millis(3000);

/// How long the fade takes to go back from [`DEEPEST`] when the hold is let go.
pub const BACK: Duration = Duration::from_millis(250);

/// How far toward black the picture gets at the end of the hold: toward black,
/// not black, so the show is still there right up to leaving.
pub const DEEPEST: f32 = 0.8;

/// The fade: where it was when it last changed direction, when, and which way it is going.
#[derive(Clone, Copy, Debug, Default)]
pub struct Leaving {
    from: f32,
    at: Option<Instant>,
    on: bool,
}

impl Leaving {
    /// The hold started (`on`) or was let go, at `now`: the fade turns from where it is.
    pub fn set(&mut self, on: bool, now: Instant) {
        if on == self.on {
            return;
        }
        self.from = self.level(now);
        self.at = Some(now);
        self.on = on;
    }

    /// How far toward black at `now`, 0..[`DEEPEST`]: rising over [`HOLD`] while held, falling over [`BACK`] after.
    pub fn level(&self, now: Instant) -> f32 {
        let Some(at) = self.at else { return 0.0 };
        let t = now.saturating_duration_since(at).as_secs_f32();
        if self.on { (self.from + DEEPEST * t / HOLD.as_secs_f32()).min(DEEPEST) } else { (self.from - DEEPEST * t / BACK.as_secs_f32()).max(0.0) }
    }

    /// The master pass's black mix with the fade over it (`black` is the effects' own).
    pub fn over(&self, black: f32, now: Instant) -> f32 {
        let level = self.level(now);
        1.0 - (1.0 - black) * (1.0 - level)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, secs: f32) -> Instant {
        start + Duration::from_secs_f32(secs)
    }

    #[test]
    fn nothing_until_held() {
        let now = Instant::now();
        assert_eq!(Leaving::default().level(now), 0.0);
        assert_eq!(Leaving::default().over(0.25, now), 0.25);
    }

    #[test]
    fn deepens_over_the_hold_then_stays() {
        let start = Instant::now();
        let mut l = Leaving::default();
        l.set(true, start);
        assert!((l.level(at(start, 1.5)) - DEEPEST / 2.0).abs() < 1e-3);
        assert_eq!(l.level(at(start, 3.0)), DEEPEST);
        assert_eq!(l.level(at(start, 10.0)), DEEPEST);
    }

    #[test]
    fn let_go_early_it_comes_back_quickly_from_where_it_was() {
        let start = Instant::now();
        let mut l = Leaving::default();
        l.set(true, start);
        l.set(false, at(start, 1.5));
        let half = DEEPEST / 2.0;
        assert!((l.level(at(start, 1.5)) - half).abs() < 1e-3);
        assert_eq!(l.level(at(start, 1.5 + BACK.as_secs_f32() / 2.0 + 0.001)), 0.0);
        // A repeat of the same news changes nothing.
        l.set(false, at(start, 2.0));
        assert_eq!(l.level(at(start, 2.0)), 0.0);
    }

    #[test]
    fn darkens_over_the_effects_black() {
        let start = Instant::now();
        let mut l = Leaving::default();
        l.set(true, start);
        let black = l.over(0.5, at(start, 3.0));
        assert!((black - (1.0 - 0.5 * (1.0 - DEEPEST))).abs() < 1e-5);
        assert_eq!(l.over(1.0, at(start, 3.0)), 1.0);
    }
}
