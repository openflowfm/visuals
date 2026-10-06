//! MilkDrop's noise textures, generated as Butterchurn generates them — quirks
//! included: values are stored in bytes and wrap past 255 as a `Uint8Array` does.
//!
//! Random numbers come from a seed, so recorded runs repeat.

use crate::eel::Memory;

/// A JavaScript `Uint8Array` store: truncate, then wrap modulo 256.
fn byte(v: f64) -> u8 {
    (v.trunc() as i64).rem_euclid(256) as u8
}

fn cubic(y0: f64, y1: f64, y2: f64, y3: f64, t: f64) -> f64 {
    let (t2, t3) = (t * t, t * t * t);
    let a0 = y3 - y2 - y0 + y1;
    let a1 = y0 - y1 - a0;
    let a2 = y2 - y0;
    a0 * t3 + a1 * t2 + a2 * t + y1
}

fn interpolate(y0: [u8; 4], y1: [u8; 4], y2: [u8; 4], y3: [u8; 4], t: f64) -> [u8; 4] {
    let mut out = [0u8; 4];
    for i in 0..4 {
        let f = cubic(y0[i] as f64 / 255.0, y1[i] as f64 / 255.0, y2[i] as f64 / 255.0, y3[i] as f64 / 255.0, t).clamp(0.0, 1.0);
        out[i] = byte(f * 255.0);
    }
    out
}

fn texel(data: &[u8], at: usize) -> [u8; 4] {
    [data[at], data[at + 1], data[at + 2], data[at + 3]]
}

fn random_fill(n: usize, zoom: usize, rng: &mut Memory) -> Vec<u8> {
    let range = if zoom > 1 { 216.0 } else { 256.0 };
    (0..n * 4).map(|_| byte((rng.random() * range + range * 0.5).floor())).collect()
}

/// `size`×`size` RGBA noise, smoothed by cubic interpolation every `zoom` texels.
pub fn texture_2d(size: usize, zoom: usize, rng: &mut Memory) -> Vec<u8> {
    let mut tex = random_fill(size * size, zoom, rng);
    if zoom > 1 {
        for y in (0..size).step_by(zoom) {
            for x in 0..size {
                if x % zoom != 0 {
                    let base_x = x / zoom * zoom + size;
                    let base_y = y * size;
                    let at = |k: usize| base_y * 4 + (k % size) * 4;
                    let r = interpolate(
                        texel(&tex, at(base_x - zoom)),
                        texel(&tex, at(base_x)),
                        texel(&tex, at(base_x + zoom)),
                        texel(&tex, at(base_x + zoom * 2)),
                        (x % zoom) as f64 / zoom as f64,
                    );
                    tex[y * size * 4 + x * 4..][..4].copy_from_slice(&r);
                }
            }
        }
        for x in 0..size {
            for y in 0..size {
                if y % zoom != 0 {
                    let base_y = y / zoom * zoom + size;
                    let at = |k: usize| (k % size) * size * 4 + x * 4;
                    let r = interpolate(
                        texel(&tex, at(base_y - zoom)),
                        texel(&tex, at(base_y)),
                        texel(&tex, at(base_y + zoom)),
                        texel(&tex, at(base_y + zoom * 2)),
                        (y % zoom) as f64 / zoom as f64,
                    );
                    tex[y * size * 4 + x * 4..][..4].copy_from_slice(&r);
                }
            }
        }
    }
    tex
}

/// `size`³ RGBA noise, likewise — including Butterchurn's third pass, which takes
/// its interpolation weight from `y` rather than `z`.
pub fn texture_3d(size: usize, zoom: usize, rng: &mut Memory) -> Vec<u8> {
    let mut tex = random_fill(size * size * size, zoom, rng);
    let (slice, line) = (size * size, size);
    if zoom > 1 {
        for z in (0..size).step_by(zoom) {
            for y in (0..size).step_by(zoom) {
                for x in 0..size {
                    if x % zoom != 0 {
                        let base_x = x / zoom * zoom + size;
                        let base_y = z * slice + y * line;
                        let at = |k: usize| base_y * 4 + (k % size) * 4;
                        let r = interpolate(
                            texel(&tex, at(base_x - zoom)),
                            texel(&tex, at(base_x)),
                            texel(&tex, at(base_x + zoom)),
                            texel(&tex, at(base_x + zoom * 2)),
                            (x % zoom) as f64 / zoom as f64,
                        );
                        tex[z * slice * 4 + y * line * 4 + x * 4..][..4].copy_from_slice(&r);
                    }
                }
            }
        }
        for z in (0..size).step_by(zoom) {
            for x in 0..size {
                for y in 0..size {
                    if y % zoom != 0 {
                        let base_y = y / zoom * zoom + size;
                        let base_z = z * slice;
                        let at = |k: usize| (k % size) * line * 4 + x * 4 + base_z * 4;
                        let r = interpolate(
                            texel(&tex, at(base_y - zoom)),
                            texel(&tex, at(base_y)),
                            texel(&tex, at(base_y + zoom)),
                            texel(&tex, at(base_y + zoom * 2)),
                            (y % zoom) as f64 / zoom as f64,
                        );
                        tex[y * line * 4 + x * 4 + base_z * 4..][..4].copy_from_slice(&r);
                    }
                }
            }
        }
        for x in 0..size {
            for y in 0..size {
                for z in 0..size {
                    if z % zoom != 0 {
                        let base_y = y * line;
                        let base_z = z / zoom * zoom + size;
                        let at = |k: usize| (k % size) * slice * 4 + x * 4 + base_y * 4;
                        let r = interpolate(
                            texel(&tex, at(base_z - zoom)),
                            texel(&tex, at(base_z)),
                            texel(&tex, at(base_z + zoom)),
                            texel(&tex, at(base_z + zoom * 2)),
                            (y % zoom) as f64 / zoom as f64,
                        );
                        tex[z * slice * 4 + x * 4 + base_y * 4..][..4].copy_from_slice(&r);
                    }
                }
            }
        }
    }
    tex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_repeatability() {
        let a = texture_2d(256, 4, &mut Memory::new(7));
        let b = texture_2d(256, 4, &mut Memory::new(7));
        assert_eq!(a.len(), 256 * 256 * 4);
        assert_eq!(a, b);
        assert_eq!(texture_3d(32, 4, &mut Memory::new(1)).len(), 32 * 32 * 32 * 4);
    }

    #[test]
    fn bytes_wrap_like_a_uint8array() {
        assert_eq!(byte(300.0), 44);
        assert_eq!(byte(255.9), 255);
    }
}
