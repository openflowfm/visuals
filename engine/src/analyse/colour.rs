//! A preset's colour: its dominant hues, gathered over several pictures.

/// Hue bins, 30° each.
const BINS: usize = 12;
/// A pixel counts towards a hue when at least this saturated and this bright.
const MIN_SATURATION: f32 = 0.25;
const MIN_VALUE: f32 = 0.2;
/// Below this share of coloured weight (per pixel) a picture is grey: no hue.
const MIN_COLOURED: f64 = 0.03;
/// A second hue is named when it carries at least this share of the first's weight.
const SECOND: f64 = 0.5;

/// Hue, saturation and value of an RGB pixel: hue in degrees `0..360`, the rest `0..=1`.
pub fn hsv(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let s = if max > 0.0 { d / max } else { 0.0 };
    let h = if d == 0.0 {
        0.0
    } else if max == r {
        60.0 * ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (h.rem_euclid(360.0), s, max)
}

/// Hues gathered from any number of RGBA pictures.
#[derive(Debug, Clone, Default)]
pub struct Hues {
    /// Per bin: saturation × value summed, and the weighted unit vector of the hues in it.
    weight: [f64; BINS],
    x: [f64; BINS],
    y: [f64; BINS],
    pixels: usize,
}

impl Hues {
    /// Adds a picture's pixels.
    pub fn add(&mut self, rgba: &[u8]) {
        for p in rgba.chunks_exact(4) {
            self.pixels += 1;
            let (h, s, v) = hsv(p[0], p[1], p[2]);
            if s < MIN_SATURATION || v < MIN_VALUE {
                continue;
            }
            let w = (s * v) as f64;
            let bin = (h as usize * BINS / 360) % BINS;
            let a = (h as f64).to_radians();
            self.weight[bin] += w;
            self.x[bin] += w * a.cos();
            self.y[bin] += w * a.sin();
        }
    }

    /// The dominant hues, in whole degrees, the strongest first: none for a grey
    /// picture, otherwise one, and a second when another colour, not next to
    /// the first, carries at least half its weight. Each is the mean hue of its
    /// bin and the bins either side.
    pub fn dominant(&self) -> Vec<u16> {
        let total: f64 = self.weight.iter().sum();
        if self.pixels == 0 || total / (self.pixels as f64) < MIN_COLOURED {
            return Vec::new();
        }
        // Weight of each bin with its neighbours, so a hue on a bin edge isn't split.
        let around = |i: usize| (0..3).map(move |k| (i + BINS - 1 + k) % BINS);
        let spread: Vec<f64> = (0..BINS).map(|i| around(i).map(|j| self.weight[j]).sum()).collect();
        let mut order: Vec<usize> = (0..BINS).collect();
        order.sort_by(|&a, &b| spread[b].total_cmp(&spread[a]).then(a.cmp(&b)));
        let first = order[0];
        let mut out = vec![first];
        let near = |a: usize, b: usize| {
            let d = (a as i32 - b as i32).rem_euclid(BINS as i32);
            d.min(BINS as i32 - d) <= 2
        };
        if let Some(&second) = order.iter().find(|&&i| !near(i, first)) {
            if spread[second] >= SECOND * spread[first] {
                out.push(second);
            }
        }
        out.into_iter()
            .map(|i| {
                let (x, y) = around(i).fold((0.0, 0.0), |(x, y), j| (x + self.x[j], y + self.y[j]));
                (y.atan2(x).to_degrees().rem_euclid(360.0).round() as u16) % 360
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(pixels: &[[u8; 3]]) -> Vec<u8> {
        pixels.iter().flat_map(|p| [p[0], p[1], p[2], 255]).collect()
    }

    #[test]
    fn hsv_of_primaries() {
        assert_eq!(hsv(255, 0, 0), (0.0, 1.0, 1.0));
        assert_eq!(hsv(0, 255, 0).0, 120.0);
        assert_eq!(hsv(0, 0, 255).0, 240.0);
        assert_eq!(hsv(128, 128, 128).1, 0.0);
    }

    #[test]
    fn one_colour_is_one_hue() {
        let mut h = Hues::default();
        h.add(&picture(&[[0, 0, 255]; 50]));
        assert_eq!(h.dominant(), vec![240]);
    }

    #[test]
    fn two_colours_are_two_hues_strongest_first() {
        let mut px = vec![[255, 0, 0]; 60];
        px.extend(vec![[0, 200, 0]; 40]);
        let mut h = Hues::default();
        h.add(&picture(&px));
        assert_eq!(h.dominant(), vec![0, 120]);
    }

    #[test]
    fn a_minor_colour_is_left_out() {
        let mut px = vec![[255, 0, 0]; 90];
        px.extend(vec![[0, 0, 255]; 10]);
        let mut h = Hues::default();
        h.add(&picture(&px));
        assert_eq!(h.dominant(), vec![0]);
    }

    #[test]
    fn grey_and_black_have_no_hue() {
        let mut h = Hues::default();
        h.add(&picture(&[[0, 0, 0]; 50]));
        h.add(&picture(&[[200, 200, 200]; 50]));
        assert_eq!(h.dominant(), Vec::<u16>::new());
        assert_eq!(Hues::default().dominant(), Vec::<u16>::new());
    }

    #[test]
    fn a_hue_across_zero_wraps() {
        // Magenta-red and orange-red: their mean is red, not cyan.
        let mut px = vec![[255, 0, 40]; 50];
        px.extend(vec![[255, 40, 0]; 50]);
        let mut h = Hues::default();
        h.add(&picture(&px));
        let d = h.dominant();
        assert_eq!(d.len(), 1);
        assert!(d[0] < 5 || d[0] > 355, "{d:?}");
    }
}
