//! Measures of what a preset draws, from the pictures it draws: how far and how
//! much it moves between pictures ([`flow`], [`difference`]) and its colour
//! ([`colour`]). Shared by the `motion` and `index` bins.

pub mod colour;

/// The sample rate of [`music`].
pub const RATE: f64 = 44_100.0;
/// The block matched by [`flow`], in pixels.
pub const BLOCK: usize = 16;
/// How far [`flow`] looks for a block in the next picture, in pixels each way.
pub const SEARCH: i32 = 8;

/// The synthetic music the measuring bins draw to — a kick on every beat at 120
/// bpm under a chord — at time `t`: the window of samples ending there
/// (usually [`crate::audio::FFT_SIZE`] of them).
pub fn music(t: f64, out: &mut [f32]) {
    let n = out.len();
    for (i, s) in out.iter_mut().enumerate() {
        let at = t - (n - i) as f64 / RATE;
        let since = at.rem_euclid(0.5);
        let tau = std::f64::consts::TAU;
        let kick = (tau * 55.0 * at).sin() * (-since * 12.0).exp();
        let chord = 0.25 * ((tau * 220.0 * at).sin() + (tau * 277.0 * at).sin() + (tau * 330.0 * at).sin());
        *s = (0.6 * kick + 0.3 * chord).clamp(-1.0, 1.0) as f32;
    }
}

/// The brightness of each RGBA pixel, 0–255 (Rec. 601 weights).
pub fn luma(rgba: &[u8]) -> Vec<f32> {
    rgba.chunks_exact(4).map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32).collect()
}

/// The mean absolute difference between two [`luma`] pictures, 0–255.
pub fn difference(a: &[f32], b: &[f32]) -> f64 {
    if b.is_empty() {
        return 0.0;
    }
    a.iter().zip(b).map(|(a, b)| (a - b).abs() as f64).sum::<f64>() / b.len() as f64
}

/// An RGBA picture `w`×`h` made `factor` times smaller each way, each pixel the
/// mean of the ones it covers. `w` and `h` should be multiples of `factor`.
pub fn shrink(rgba: &[u8], w: usize, h: usize, factor: usize) -> Vec<u8> {
    let f = factor.max(1);
    let (sw, sh) = (w / f, h / f);
    let mut out = vec![0u8; sw * sh * 4];
    for y in 0..sh {
        for x in 0..sw {
            for c in 0..4 {
                let mut sum = 0u32;
                for dy in 0..f {
                    for dx in 0..f {
                        sum += rgba[((y * f + dy) * w + x * f + dx) * 4 + c] as u32;
                    }
                }
                out[(y * sw + x) * 4 + c] = ((sum + (f * f / 2) as u32) / (f * f) as u32) as u8;
            }
        }
    }
    out
}

/// What [`flow`] found between two pictures.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Flow {
    /// The blocks looked at.
    pub blocks: usize,
    /// Those with enough texture to be found again.
    pub textured: usize,
    /// Those found again, distinctly, within [`SEARCH`].
    pub matched: usize,
    /// The mean distance the matched blocks moved, in pixels (NaN when none were).
    pub mean: f64,
}

impl Flow {
    /// The mean distance moved, when at least a tenth of the blocks were found
    /// again; otherwise `None` (noise, soft glows, or motion past [`SEARCH`]).
    pub fn measured(&self) -> Option<f64> {
        (self.matched * 10 >= self.blocks).then_some(self.mean)
    }
}

/// How far the textured blocks of `a` moved to in `b` (both [`luma`] pictures
/// `w`×`h`): [`BLOCK`] px blocks, each found again within ±[`SEARCH`] px, to a
/// tenth of a pixel.
pub fn flow(a: &[f32], b: &[f32], w: usize, h: usize) -> Flow {
    let r = SEARCH as usize;
    let mut total = 0.0;
    let (mut matched, mut textured, mut blocks) = (0usize, 0usize, 0usize);
    let mut by = r;
    while by + BLOCK + r <= h {
        let mut bx = r;
        while bx + BLOCK + r <= w {
            blocks += 1;
            let mut mean = 0.0;
            for y in 0..BLOCK {
                for x in 0..BLOCK {
                    mean += a[(by + y) * w + bx + x];
                }
            }
            mean /= (BLOCK * BLOCK) as f32;
            let mut var = 0.0;
            for y in 0..BLOCK {
                for x in 0..BLOCK {
                    let d = a[(by + y) * w + bx + x] - mean;
                    var += d * d;
                }
            }
            var /= (BLOCK * BLOCK) as f32;
            if var >= 16.0 {
                textured += 1;
                let n = (2 * SEARCH + 1) as usize;
                let mut sad = vec![0f32; n * n];
                for (k, cost) in sad.iter_mut().enumerate() {
                    let (dx, dy) = ((k % n) as i32 - SEARCH, (k / n) as i32 - SEARCH);
                    let mut s = 0.0;
                    for y in 0..BLOCK {
                        let ra = (by + y) * w + bx;
                        let rb = ((by + y) as i32 + dy) as usize * w + (bx as i32 + dx) as usize;
                        for x in 0..BLOCK {
                            s += (a[ra + x] - b[rb + x]).abs();
                        }
                    }
                    *cost = s;
                }
                let (best, &min) = sad.iter().enumerate().min_by(|x, y| x.1.total_cmp(y.1)).unwrap();
                let avg = sad.iter().sum::<f32>() / sad.len() as f32;
                let (ix, iy) = ((best % n) as i32, (best / n) as i32);
                // A distinct match, not at the edge of the search.
                if min < 0.5 * avg && ix > 0 && iy > 0 && ix < n as i32 - 1 && iy < n as i32 - 1 {
                    let at = |x: i32, y: i32| sad[y as usize * n + x as usize];
                    let part = |l: f32, c: f32, r: f32| {
                        let d = l - 2.0 * c + r;
                        if d > 0.0 { (0.5 * (l - r) / d).clamp(-0.5, 0.5) } else { 0.0 }
                    };
                    let fx = (ix - SEARCH) as f32 + part(at(ix - 1, iy), min, at(ix + 1, iy));
                    let fy = (iy - SEARCH) as f32 + part(at(ix, iy - 1), min, at(ix, iy + 1));
                    total += ((fx * fx + fy * fy) as f64).sqrt();
                    matched += 1;
                }
            }
            bx += BLOCK;
        }
        by += BLOCK;
    }
    Flow { blocks, textured, matched, mean: total / matched as f64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A textured picture: a pattern that varies at every pixel, shifted by `dx`.
    fn pattern(w: usize, h: usize, dx: usize) -> Vec<f32> {
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w + w - dx) as f32, (i / w) as f32);
                128.0 + 100.0 * ((x * 0.7).sin() * (y * 0.45).cos() + 0.3 * (x * 0.13 + y * 0.29).sin()).clamp(-1.0, 1.0)
            })
            .collect()
    }

    #[test]
    fn flow_finds_a_shift() {
        let (w, h) = (96, 64);
        let f = flow(&pattern(w, h, 0), &pattern(w, h, 3), w, h);
        assert!(f.blocks > 0 && f.textured == f.blocks, "{f:?}");
        let m = f.measured().expect("a textured shift is measured");
        assert!((m - 3.0).abs() < 0.3, "{m}");
    }

    #[test]
    fn flat_pictures_have_nothing_to_follow() {
        let flat = vec![40.0; 96 * 64];
        let f = flow(&flat, &flat, 96, 64);
        assert_eq!((f.textured, f.matched), (0, 0));
        assert_eq!(f.measured(), None);
    }

    #[test]
    fn difference_is_the_mean_change() {
        assert_eq!(difference(&[0.0, 10.0], &[10.0, 0.0]), 10.0);
        assert_eq!(difference(&[], &[]), 0.0);
    }

    #[test]
    fn shrink_averages() {
        // 2×2 → 1×1: the mean of each channel.
        let rgba = [0, 0, 0, 255, 100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 40, 255];
        assert_eq!(shrink(&rgba, 2, 2, 2), vec![25, 50, 10, 255]);
    }
}
