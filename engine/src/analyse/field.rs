//! Block motion as a field of vectors, one per block: where each [`BLOCK`] px
//! block of one picture went in the next (the block matching [`super::flow`]
//! sums up), and what the field says about how a picture moves — whether
//! neighbouring blocks agree (coherence), and how much of the motion is towards
//! or away from the centre (a tunnel, a zoom) or around it (a spiral).

use super::{BLOCK, SEARCH};

/// What became of one block.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Block {
    /// Too flat to be found again.
    Flat,
    /// Textured, but not found again distinctly within [`SEARCH`].
    Lost,
    /// Found again this far off, in pixels (x right, y down), to a tenth of a pixel.
    Found(f32, f32),
}

/// The blocks of a picture `w`×`h`, row by row, as [`field`] matched them.
#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub cols: usize,
    pub rows: usize,
    pub blocks: Vec<Block>,
    /// The picture's size.
    pub size: (usize, usize),
}

/// Where the block of `a` at `bx`, `by` (its top left, at least [`SEARCH`]
/// from every edge) went in `b`; both [`super::luma`] pictures `w` wide.
pub fn match_block(a: &[f32], b: &[f32], w: usize, bx: usize, by: usize) -> Block {
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
    if var < 16.0 {
        return Block::Flat;
    }
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
    if !(min < 0.5 * avg && ix > 0 && iy > 0 && ix < n as i32 - 1 && iy < n as i32 - 1) {
        return Block::Lost;
    }
    let at = |x: i32, y: i32| sad[y as usize * n + x as usize];
    let part = |l: f32, c: f32, r: f32| {
        let d = l - 2.0 * c + r;
        if d > 0.0 { (0.5 * (l - r) / d).clamp(-0.5, 0.5) } else { 0.0 }
    };
    let fx = (ix - SEARCH) as f32 + part(at(ix - 1, iy), min, at(ix + 1, iy));
    let fy = (iy - SEARCH) as f32 + part(at(ix, iy - 1), min, at(ix, iy + 1));
    Block::Found(fx, fy)
}

/// Every block of `a` matched in `b` (both [`super::luma`] pictures `w`×`h`),
/// on the grid [`super::flow`] uses: [`BLOCK`] px apart, [`SEARCH`] px in from the edges.
pub fn field(a: &[f32], b: &[f32], w: usize, h: usize) -> Field {
    let r = SEARCH as usize;
    let mut blocks = Vec::new();
    let (mut cols, mut rows) = (0, 0);
    let mut by = r;
    while by + BLOCK + r <= h {
        let mut bx = r;
        cols = 0;
        while bx + BLOCK + r <= w {
            blocks.push(match_block(a, b, w, bx, by));
            cols += 1;
            bx += BLOCK;
        }
        rows += 1;
        by += BLOCK;
    }
    Field { cols, rows, blocks, size: (w, h) }
}

/// Below this many pixels a vector has no direction worth comparing.
const STILL: f32 = 0.25;

impl Field {
    /// The vectors found, as `(x, y)` pixels.
    pub fn found(&self) -> impl Iterator<Item = (f32, f32)> + '_ {
        self.blocks.iter().filter_map(|b| match *b {
            Block::Found(x, y) => Some((x, y)),
            _ => None,
        })
    }

    /// The blocks with enough texture to follow.
    pub fn textured(&self) -> usize {
        self.blocks.iter().filter(|b| **b != Block::Flat).count()
    }

    /// How much neighbouring blocks agree on where they went: the mean cosine
    /// between each moving block's vector and its right and lower neighbours'
    /// (1 all one way, 0 unrelated, −1 opposed). `None` with fewer than 8 such
    /// pairs (a still or flat picture).
    pub fn coherence(&self) -> Option<f64> {
        let at = |c: usize, r: usize| match self.blocks[r * self.cols + c] {
            Block::Found(x, y) if x.hypot(y) >= STILL => Some((x, y)),
            _ => None,
        };
        let (mut sum, mut pairs) = (0.0, 0usize);
        for r in 0..self.rows {
            for c in 0..self.cols {
                let Some(a) = at(c, r) else { continue };
                for b in [(c + 1 < self.cols).then(|| at(c + 1, r)).flatten(), (r + 1 < self.rows).then(|| at(c, r + 1)).flatten()].into_iter().flatten() {
                    sum += ((a.0 * b.0 + a.1 * b.1) / (a.0.hypot(a.1) * b.0.hypot(b.1))) as f64;
                    pairs += 1;
                }
            }
        }
        (pairs >= 8).then(|| sum / pairs as f64)
    }

    /// The mean part of the found vectors pointing away from the picture's
    /// centre (positive: outwards, as when zooming in or flying down a tunnel)
    /// and around it (positive: anticlockwise as seen), in pixels; blocks within
    /// a block of the centre are left out. `None` with fewer than 4 vectors.
    pub fn radial_and_swirl(&self) -> Option<(f64, f64)> {
        let r = SEARCH as usize;
        let (cx, cy) = (self.size.0 as f32 / 2.0, self.size.1 as f32 / 2.0);
        let (mut radial, mut swirl, mut n) = (0.0, 0.0, 0usize);
        for (i, b) in self.blocks.iter().enumerate() {
            let Block::Found(vx, vy) = *b else { continue };
            let (col, row) = (i % self.cols, i / self.cols);
            // Up is positive here, so anticlockwise is anticlockwise on screen.
            let px = (r + col * BLOCK + BLOCK / 2) as f32 - cx;
            let py = cy - (r + row * BLOCK + BLOCK / 2) as f32;
            let d = px.hypot(py);
            if d < BLOCK as f32 {
                continue;
            }
            let (vx, vy) = (vx, -vy);
            radial += ((px * vx + py * vy) / d) as f64;
            swirl += ((px * vy - py * vx) / d) as f64;
            n += 1;
        }
        (n >= 4).then(|| (radial / n as f64, swirl / n as f64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: usize = 192;
    const H: usize = 144;

    /// A smooth, textured picture: `f(x, y)` sampled through a pattern.
    fn picture(f: impl Fn(f32, f32) -> (f32, f32)) -> Vec<f32> {
        (0..W * H)
            .map(|i| {
                let (x, y) = f((i % W) as f32, (i / W) as f32);
                128.0 + 100.0 * ((x * 0.7).sin() * (y * 0.45).cos() + 0.3 * (x * 0.13 + y * 0.29).sin()).clamp(-1.0, 1.0)
            })
            .collect()
    }

    /// The pattern, and it transformed about the centre: `b` at p shows `a` at `back(p)`.
    fn moved(back: impl Fn(f32, f32) -> (f32, f32)) -> Field {
        let (cx, cy) = (W as f32 / 2.0, H as f32 / 2.0);
        let a = picture(|x, y| (x, y));
        let b = picture(|x, y| {
            let (u, v) = back(x - cx, y - cy);
            (u + cx, v + cy)
        });
        field(&a, &b, W, H)
    }

    #[test]
    fn a_shift_is_coherent_and_neither_radial_nor_swirling() {
        let f = moved(|x, y| (x - 3.0, y));
        assert!(f.found().count() > f.blocks.len() / 2, "{f:?}");
        assert!(f.coherence().unwrap() > 0.95);
        let (radial, swirl) = f.radial_and_swirl().unwrap();
        assert!(radial.abs() < 0.3 && swirl.abs() < 0.3, "{radial} {swirl}");
    }

    #[test]
    fn a_zoom_moves_outwards() {
        // Zooming in 5%: what was at p/1.05 is now at p.
        let f = moved(|x, y| (x / 1.05, y / 1.05));
        let (radial, swirl) = f.radial_and_swirl().unwrap();
        assert!(radial > 1.0 && swirl.abs() < 0.3 * radial, "{radial} {swirl}");
    }

    #[test]
    fn a_turn_swirls_anticlockwise() {
        // Turned 3° anticlockwise as seen (y down): what is at p came from p turned back.
        let a = 3f32.to_radians();
        let f = moved(|x, y| (x * a.cos() - y * a.sin(), x * a.sin() + y * a.cos()));
        let (radial, swirl) = f.radial_and_swirl().unwrap();
        assert!(swirl > 1.0 && radial.abs() < 0.3 * swirl, "{radial} {swirl}");
    }

    #[test]
    fn a_still_or_flat_picture_has_no_coherence() {
        let a = picture(|x, y| (x, y));
        assert_eq!(field(&a, &a, W, H).coherence(), None, "nothing moved");
        let flat = vec![50.0; W * H];
        let f = field(&flat, &flat, W, H);
        assert_eq!((f.textured(), f.coherence(), f.radial_and_swirl()), (0, None, None));
    }
}
