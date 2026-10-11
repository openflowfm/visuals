//! What one picture's brightness is like up close and as a whole: its detail
//! (gradients and edges), fine-scale grain, soft glow, local contrast, and how
//! alike it is to itself mirrored or turned. All on [`super::luma`] pictures
//! (0–255).

/// A gradient (Sobel magnitude, luma per pixel) at least this steep is an edge.
const EDGE: f32 = 64.0;
/// A pixel this bright (luma) on a gradient this gentle is glowing.
const GLOW_LUMA: f32 = 153.0;
const GLOW_GRADIENT: f32 = 24.0;

/// A picture's gradients.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Detail {
    /// The mean Sobel gradient magnitude, divided by 255 (a hard black-to-white
    /// edge is about 4).
    pub gradient: f64,
    /// The share of pixels on an edge.
    pub edges: f64,
    /// The share of pixels bright and soft: a glow rather than a line.
    pub glow: f64,
}

/// [`Detail`] of a picture `w`×`h`, over its pixels not on the border.
pub fn detail(l: &[f32], w: usize, h: usize) -> Detail {
    let (mut sum, mut edges, mut glow, mut n) = (0.0f64, 0usize, 0usize, 0usize);
    for y in 1..h.saturating_sub(1) {
        for x in 1..w - 1 {
            let p = |dx: isize, dy: isize| l[(y as isize + dy) as usize * w + (x as isize + dx) as usize];
            let gx = p(1, -1) + 2.0 * p(1, 0) + p(1, 1) - p(-1, -1) - 2.0 * p(-1, 0) - p(-1, 1);
            let gy = p(-1, 1) + 2.0 * p(0, 1) + p(1, 1) - p(-1, -1) - 2.0 * p(0, -1) - p(1, -1);
            let g = gx.hypot(gy);
            sum += g as f64;
            edges += (g >= EDGE) as usize;
            glow += (l[y * w + x] >= GLOW_LUMA && g < GLOW_GRADIENT) as usize;
            n += 1;
        }
    }
    let n = n.max(1) as f64;
    Detail { gradient: sum / n / 255.0, edges: edges as f64 / n, glow: glow as f64 / n }
}

/// Fine-scale energy: the mean distance of each pixel from the mean of its
/// 3×3 neighbourhood, divided by 255. Noise and grain at the pixel scale
/// raise it most.
pub fn fine(l: &[f32], w: usize, h: usize) -> f64 {
    let (mut sum, mut n) = (0.0f64, 0usize);
    for y in 1..h.saturating_sub(1) {
        for x in 1..w - 1 {
            let mut around = 0.0;
            for dy in 0..3 {
                for dx in 0..3 {
                    around += l[(y + dy - 1) * w + x + dx - 1];
                }
            }
            sum += (l[y * w + x] - around / 9.0).abs() as f64;
            n += 1;
        }
    }
    sum / n.max(1) as f64 / 255.0
}

/// Local contrast: the mean standard deviation of brightness within each 8×8
/// block, divided by 255.
pub fn local_contrast(l: &[f32], w: usize, h: usize) -> f64 {
    const B: usize = 8;
    let (mut sum, mut n) = (0.0f64, 0usize);
    for by in (0..h / B).map(|i| i * B) {
        for bx in (0..w / B).map(|i| i * B) {
            let (mut s, mut q) = (0.0f64, 0.0f64);
            for y in by..by + B {
                for &v in &l[y * w + bx..y * w + bx + B] {
                    s += v as f64;
                    q += (v as f64).powi(2);
                }
            }
            let k = (B * B) as f64;
            sum += (q / k - (s / k).powi(2)).max(0.0).sqrt();
            n += 1;
        }
    }
    sum / n.max(1) as f64 / 255.0
}

/// The Pearson correlation of two pictures, pixel for pixel; `None` when
/// either is flat (standard deviation under 2 luma).
pub fn pearson(a: &[f32], b: &[f32]) -> Option<f64> {
    let n = a.len().min(b.len());
    if n == 0 {
        return None;
    }
    let (ma, mb) = (a[..n].iter().map(|&v| v as f64).sum::<f64>() / n as f64, b[..n].iter().map(|&v| v as f64).sum::<f64>() / n as f64);
    let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for (&x, &y) in a.iter().zip(b) {
        let (x, y) = (x as f64 - ma, y as f64 - mb);
        ab += x * y;
        aa += x * x;
        bb += y * y;
    }
    let floor = 4.0 * n as f64;
    (aa >= floor && bb >= floor).then(|| ab / (aa * bb).sqrt())
}

/// How alike a picture is to itself mirrored and turned, each the
/// [`pearson`] correlation of the picture with the transformed picture: 1 for
/// perfect symmetry, about 0 for none.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Symmetry {
    /// Mirrored left to right.
    pub left_right: Option<f64>,
    /// Mirrored top to bottom.
    pub up_down: Option<f64>,
    /// Turned half way round.
    pub half_turn: Option<f64>,
    /// The central square turned a quarter: four-fold, as a kaleidoscope.
    pub quarter_turn: Option<f64>,
}

pub fn symmetry(l: &[f32], w: usize, h: usize) -> Symmetry {
    let map = |f: &dyn Fn(usize, usize) -> usize| (0..w * h).map(|i| l[f(i % w, i / w)]).collect::<Vec<f32>>();
    let lr = map(&|x, y| y * w + (w - 1 - x));
    let ud = map(&|x, y| (h - 1 - y) * w + x);
    let half = map(&|x, y| (h - 1 - y) * w + (w - 1 - x));
    // The central square, and it turned a quarter.
    let s = w.min(h);
    let (ox, oy) = ((w - s) / 2, (h - s) / 2);
    let square: Vec<f32> = (0..s * s).map(|i| l[(oy + i / s) * w + ox + i % s]).collect();
    let turned: Vec<f32> = (0..s * s).map(|i| square[(s - 1 - i % s) * s + i / s]).collect();
    Symmetry { left_right: pearson(l, &lr), up_down: pearson(l, &ud), half_turn: pearson(l, &half), quarter_turn: pearson(&square, &turned) }
}

/// The mean brightness of the middle of the picture (half its width and
/// height) less that of the rest, divided by 255: positive for a bright centre.
pub fn centre_vs_edge(l: &[f32], w: usize, h: usize) -> f64 {
    let (mut inner, mut ni, mut outer, mut no) = (0.0f64, 0usize, 0.0f64, 0usize);
    for y in 0..h {
        for x in 0..w {
            let v = l[y * w + x] as f64;
            if x >= w / 4 && x < w - w / 4 && y >= h / 4 && y < h - h / 4 {
                inner += v;
                ni += 1;
            } else {
                outer += v;
                no += 1;
            }
        }
    }
    (inner / ni.max(1) as f64 - outer / no.max(1) as f64) / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: usize = 64;
    const H: usize = 48;

    fn picture(f: impl Fn(usize, usize) -> f32) -> Vec<f32> {
        (0..W * H).map(|i| f(i % W, i / W)).collect()
    }

    /// A fixed pseudo-random value per pixel, 0–255.
    fn noise(x: usize, y: usize) -> f32 {
        let mut h = (x as u64 * 73_856_093) ^ (y as u64 * 19_349_663);
        h = h.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        (h >> 56) as f32
    }

    #[test]
    fn flat_pictures_have_no_detail_and_no_symmetry_to_measure() {
        let flat = picture(|_, _| 100.0);
        assert_eq!(detail(&flat, W, H), Detail { gradient: 0.0, edges: 0.0, glow: 0.0 });
        assert_eq!((fine(&flat, W, H), local_contrast(&flat, W, H)), (0.0, 0.0));
        assert_eq!(symmetry(&flat, W, H).left_right, None);
        let bright = picture(|_, _| 200.0);
        assert_eq!(detail(&bright, W, H).glow, 1.0, "bright and soft glows");
    }

    #[test]
    fn noise_is_fine_and_edges_are_not() {
        let grain = picture(noise);
        // Stripes 10 px wide: two columns on an edge at each of the 6 changes.
        let stripes = picture(|x, _| if (x / 10) % 2 == 0 { 0.0 } else { 255.0 });
        assert!(fine(&grain, W, H) > 2.0 * fine(&stripes, W, H));
        let d = detail(&stripes, W, H);
        assert!((d.edges - 12.0 / 62.0).abs() < 1e-9, "{d:?}");
        assert!(local_contrast(&stripes, W, H) > 0.2);
    }

    #[test]
    fn symmetry_finds_mirrors_and_turns() {
        let lr = picture(|x, y| noise(x.min(W - 1 - x), y));
        let s = symmetry(&lr, W, H);
        assert!((s.left_right.unwrap() - 1.0).abs() < 1e-9);
        assert!(s.up_down.unwrap().abs() < 0.3);
        // Four-fold about the centre of the square: the same at (x, y) and its quarter turns.
        let (ox, s4) = ((W - H) / 2, H);
        let four = picture(|x, y| {
            let (u, v) = (x as isize - ox as isize, y as isize);
            if u < 0 || u >= s4 as isize {
                return 0.0;
            }
            let (u, v) = (u as usize, v as usize);
            let (a, b) = (u.min(s4 - 1 - u), v.min(s4 - 1 - v));
            noise(a.min(b), a.max(b))
        });
        let s = symmetry(&four, W, H);
        assert!(s.quarter_turn.unwrap() > 0.99 && s.half_turn.unwrap() > 0.99, "{s:?}");
        let random = symmetry(&picture(noise), W, H);
        assert!(random.left_right.unwrap().abs() < 0.2 && random.quarter_turn.unwrap().abs() < 0.2, "{random:?}");
    }

    #[test]
    fn a_bright_centre_is_positive() {
        let centre = picture(|x, y| if (W / 4..W - W / 4).contains(&x) && (H / 4..H - H / 4).contains(&y) { 255.0 } else { 0.0 });
        assert_eq!(centre_vs_edge(&centre, W, H), 1.0);
        assert!(pearson(&[1.0, 2.0], &[]).is_none());
    }
}
