use super::Frame;
use crate::audio::Audio;

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

#[cfg(test)]
mod tests {
    use super::*;

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
