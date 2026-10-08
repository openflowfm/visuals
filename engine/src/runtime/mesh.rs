use super::{gather, Runner, Size};
use crate::eel::Symbols;

impl Runner {
    /// `runPixelEquations`: the warp mesh's texture coordinates, one per vertex,
    /// `(mesh_width + 1) × (mesh_height + 1)` of them — the whole step's motion.
    pub fn warp_mesh(&mut self, time: f64, size: &Size, uvs: &mut Vec<[f32; 2]>) {
        let mut mesh = Mesh::default();
        self.warp_motion(time, size, &mut mesh);
        mesh.uvs(1.0, uvs);
    }

    /// The per-vertex equations, once: what each vertex's motion is this step,
    /// kept in `mesh` so the step can be drawn at any fraction ([`Mesh::uvs`]).
    pub fn warp_motion(&mut self, time: f64, size: &Size, mesh: &mut Mesh) {
        let (gx, gy) = (size.mesh_width, size.mesh_height);
        let get = |name: &str, vars: &[f64], symbols: &Symbols| symbols.get(name).map_or(0.0, |s| vars[s]);
        let fv = &self.frame_vars;
        let warp_time = time * get("warpanimspeed", fv, &self.symbols);
        let warp_scale_inv = 1.0 / get("warpscale", fv, &self.symbols);
        let f0 = 11.68 + 4.0 * (warp_time * 1.413 + 10.0).cos();
        let f1 = 8.77 + 3.0 * (warp_time * 1.113 + 7.0).cos();
        let f2 = 10.54 + 3.0 * (warp_time * 1.233 + 3.0).cos();
        let f3 = 11.49 + 4.0 * (warp_time * 0.933 + 5.0).cos();
        let (ax, ay) = (size.aspect_x(), size.aspect_y());
        mesh.width = gx;
        mesh.height = gy;
        mesh.aspect = (ax, ay);
        mesh.warp_time = warp_time;
        mesh.warp_scale_inv = warp_scale_inv;
        mesh.f = [f0, f1, f2, f3];
        mesh.motion.clear();
        // One copy for the whole mesh: per-vertex variables carry from one
        // vertex to the next, as they do in MilkDrop and Butterchurn.
        let mut v = self.frame_vars.clone();
        let s = |n: &str| self.symbols.get(n).unwrap();
        let motion = ["zoom", "zoomexp", "rot", "warp", "cx", "cy", "dx", "dy", "sx", "sy"].map(|n| (s(n), fv[s(n)]));
        let (sx_, sy_, srad, sang) = (s("x"), s("y"), s("rad"), s("ang"));
        for iz in 0..=gy {
            for ix in 0..=gx {
                let x = ix as f64 / gx as f64 * 2.0 - 1.0;
                let y = iz as f64 / gy as f64 * 2.0 - 1.0;
                let rad = (x * x * ax * ax + y * y * ay * ay).sqrt();
                if self.has_vertex {
                    let ang = if iz * 2 == gy && ix * 2 == gx { 0.0 } else { (y * ay).atan2(x * ax) };
                    v[sx_] = x * 0.5 * ax + 0.5;
                    v[sy_] = y * -0.5 * ay + 0.5;
                    v[srad] = rad;
                    v[sang] = ang;
                    for &(slot, value) in &motion {
                        v[slot] = value;
                    }
                    self.vertex.run(&mut v, &mut self.memory);
                }
                let [zoom, zoom_exp, rot, warp, cx, cy, dx, dy, sx, sy] = motion.map(|(slot, _)| v[slot]);
                let zoom2 = zoom.powf(zoom_exp.powf(rad * 2.0 - 1.0));
                mesh.motion.push([zoom2, rot, warp, cx, cy, dx, dy, sx, sy]);
            }
        }
        // `regVars` come back from the last vertex.
        self.regs = gather(&v, &self.reg_slots);
    }
}

/// One step's warp: each vertex's motion as the per-vertex equations left it —
/// zoom, rotation, the warp's wobble, the stretch and the translation — which
/// [`Mesh::uvs`] turns into texture coordinates for the whole step or a part of it.
#[derive(Debug, Clone, Default)]
pub struct Mesh {
    width: usize,
    height: usize,
    aspect: (f64, f64),
    warp_time: f64,
    warp_scale_inv: f64,
    f: [f64; 4],
    /// Per vertex, row by row: zoom (after `zoomexp`), rot, warp, cx, cy, dx, dy, sx, sy.
    motion: Vec<[f64; 9]>,
}

/// `fraction` of a scale applied once a step: its power, so that two halves
/// make the whole. A scale that is not positive (a mirror) can't be split that
/// way and is moved toward linearly instead.
fn part_of(scale: f64, fraction: f64) -> f64 {
    if fraction == 1.0 {
        scale
    } else if scale > 0.0 {
        scale.powf(fraction)
    } else {
        1.0 + (scale - 1.0) * fraction
    }
}

impl Mesh {
    /// The texture coordinates for `fraction` of the step: 1 is MilkDrop's map
    /// exactly (Butterchurn's `runPixelEquations`), 0 the identity. In between,
    /// each part of the motion is split so that it composes back to the whole:
    /// zoom and stretch by their powers, rotation, translation and the warp's
    /// wobble in proportion. Those parts commute only approximately (they turn
    /// about different centres), so `uvs(½)` twice is close to `uvs(1)`, not equal.
    pub fn uvs(&self, fraction: f64, uvs: &mut Vec<[f32; 2]>) {
        let (gx, gy) = (self.width, self.height);
        let (ax, ay) = self.aspect;
        let [f0, f1, f2, f3] = self.f;
        let (warp_time, warp_scale_inv) = (self.warp_time, self.warp_scale_inv);
        uvs.clear();
        for (i, m) in self.motion.iter().enumerate() {
            let (ix, iz) = (i % (gx + 1), i / (gx + 1));
            let x = ix as f64 / gx as f64 * 2.0 - 1.0;
            let y = iz as f64 / gy as f64 * 2.0 - 1.0;
            let [zoom2, rot, warp, cx, cy, dx, dy, sx, sy] = *m;
            let zoom2_inv = 1.0 / part_of(zoom2, fraction);
            let (sx, sy) = (part_of(sx, fraction), part_of(sy, fraction));
            let (rot, warp, dx, dy) = (rot * fraction, warp * fraction, dx * fraction, dy * fraction);
            let mut u = x * 0.5 * ax * zoom2_inv + 0.5;
            let mut w = -y * 0.5 * ay * zoom2_inv + 0.5;
            u = (u - cx) / sx + cx;
            w = (w - cy) / sy + cy;
            if warp != 0.0 {
                u += warp * 0.0035 * (warp_time * 0.333 + warp_scale_inv * (x * f0 - y * f3)).sin();
                w += warp * 0.0035 * (warp_time * 0.375 - warp_scale_inv * (x * f2 + y * f1)).cos();
                u += warp * 0.0035 * (warp_time * 0.753 - warp_scale_inv * (x * f1 - y * f2)).cos();
                w += warp * 0.0035 * (warp_time * 0.825 + warp_scale_inv * (x * f0 + y * f3)).sin();
            }
            let (u2, w2) = (u - cx, w - cy);
            let (c, sn) = (rot.cos(), rot.sin());
            u = u2 * c - w2 * sn + cx;
            w = u2 * sn + w2 * c + cy;
            u -= dx;
            w -= dy;
            u = (u - 0.5) / ax + 0.5;
            w = (w - 0.5) / ay + 0.5;
            uvs.push([u as f32, w as f32]);
        }
    }

    /// The two sets of texture coordinates a refresh `fraction` of the way
    /// through the step draws with: `moved` for the plainly moved picture and
    /// `shaded` for the warp shader mixed over it by the fraction.
    ///
    /// Where the step's map is a flow — each vertex moved about as far, and the
    /// same way, as its neighbours: zoom, rotation, translation, the warp's
    /// wobble — both are [`Mesh::uvs`] at the fraction, so the picture slides.
    /// Where it tears or folds the picture instead — neighbours sent far apart, a
    /// kaleidoscope's mirror (`dx = x - ox`), a jump to another place — there is
    /// no motion to take a part of: a part of a fold is a smear. There `moved`
    /// stays where it is and `shaded` is the whole step, so the refresh
    /// cross-fades to exactly what the next step draws. How far a vertex is from
    /// a flow is how much the step stretches the grid around it: a change in
    /// displacement under a quarter of the distance between neighbours slides,
    /// over a half cross-fades, and in between mixes the two.
    pub fn between(&self, fraction: f64, moved: &mut Vec<[f32; 2]>, shaded: &mut Vec<[f32; 2]>) {
        let (mut none, mut whole) = (Vec::new(), Vec::new());
        self.uvs(0.0, &mut none);
        self.uvs(fraction, moved);
        self.uvs(1.0, &mut whole);
        shaded.clear();
        shaded.extend_from_slice(moved);
        let (gx, gy) = (self.width + 1, self.height + 1);
        let d = |i: usize| [whole[i][0] - none[i][0], whole[i][1] - none[i][1]];
        let apart = |a: [f32; 2], b: [f32; 2]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        for i in 0..moved.len() {
            let (ix, iz) = (i % gx, i / gx);
            let mut stretch = 0f32;
            for (ok, j) in [(ix > 0, i.wrapping_sub(1)), (ix + 1 < gx, i + 1), (iz > 0, i.wrapping_sub(gx)), (iz + 1 < gy, i + gx)] {
                if ok {
                    stretch = stretch.max(apart(d(i), d(j)) / apart(none[i], none[j]).max(1e-6));
                }
            }
            let k = ((stretch - 0.25) / 0.25).clamp(0.0, 1.0);
            if k > 0.0 {
                let mix = |a: [f32; 2], b: [f32; 2]| [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
                shaded[i] = mix(moved[i], whole[i]);
                moved[i] = mix(moved[i], none[i]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::tests::running;

    #[test]
    fn an_identity_mesh_samples_where_it_draws() {
        let text = "[preset00]\nzoom=1\nrot=0\nwarp=0\ndx=0\ndy=0\nsx=1\nsy=1\ncx=0.5\ncy=0.5";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 4, mesh_height: 4 };
        let mut r = running(text, &size);
        let mut uvs = Vec::new();
        r.warp_mesh(1.0, &size, &mut uvs);
        assert_eq!(uvs.len(), 25);
        assert_eq!(uvs[0], [0.0, 1.0]);
        assert_eq!(uvs[24], [1.0, 0.0]);
    }

    #[test]
    fn per_vertex_equations_move_the_mesh() {
        let text = "[preset00]\nwarp=0\nper_pixel_1=dx = 0.1;";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 2, mesh_height: 2 };
        let mut r = running(text, &size);
        let mut uvs = Vec::new();
        r.warp_mesh(1.0, &size, &mut uvs);
        assert!((uvs[4][0] - 0.4).abs() < 1e-6, "{:?}", uvs[4]);
    }

    /// A preset that zooms, turns, stretches and drifts, every step.
    fn moving() -> (Runner, Size) {
        let text = "[preset00]\nzoom=1.04\nrot=0.03\nwarp=0\ndx=0.004\ndy=-0.002\nsx=1.01\nsy=0.99\ncx=0.5\ncy=0.5";
        let size = Size { texsize_x: 512.0, texsize_y: 512.0, mesh_width: 8, mesh_height: 8 };
        (running(text, &size), size)
    }

    #[test]
    fn a_whole_step_is_milkdrops_map_and_none_is_the_identity() {
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut whole, mut via) = (Vec::new(), Vec::new());
        mesh.uvs(1.0, &mut whole);
        r.warp_mesh(1.0, &size, &mut via);
        assert_eq!(whole, via);
        let mut none = Vec::new();
        mesh.uvs(0.0, &mut none);
        for (i, uv) in none.iter().enumerate() {
            let (ix, iz) = (i % 9, i / 9);
            let (u, v) = (ix as f32 / 8.0, 1.0 - iz as f32 / 8.0);
            assert!((uv[0] - u).abs() < 1e-6 && (uv[1] - v).abs() < 1e-6, "{i}: {uv:?}");
        }
    }

    /// Where a map sends a point, read from the mesh by bilinear interpolation,
    /// in texture coordinates (`u` right, `v` up).
    fn sample(uvs: &[[f32; 2]], n: usize, u: f64, v: f64) -> (f64, f64) {
        let (fx, fz) = (u * n as f64, (1.0 - v) * n as f64);
        let (ix, iz) = ((fx.floor() as usize).min(n - 1), (fz.floor() as usize).min(n - 1));
        let (tx, tz) = (fx - ix as f64, fz - iz as f64);
        let at = |x: usize, z: usize| uvs[z * (n + 1) + x].map(f64::from);
        let lerp = |a: [f64; 2], b: [f64; 2], t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let p = lerp(lerp(at(ix, iz), at(ix + 1, iz), tx), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), tx), tz);
        (p[0], p[1])
    }

    #[test]
    fn parts_of_a_step_compose_to_the_whole() {
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let mut whole = Vec::new();
        mesh.uvs(1.0, &mut whole);
        // The picture after n parts samples the first through every part's map in
        // turn: compose them, and compare with one whole step, in pixels at 512.
        for parts in [2usize, 4] {
            let mut part = Vec::new();
            mesh.uvs(1.0 / parts as f64, &mut part);
            let mut worst = 0f64;
            for i in 0..=16 {
                for j in 0..=16 {
                    let (mut u, mut v) = (0.25 + i as f64 / 32.0, 0.25 + j as f64 / 32.0);
                    for _ in 0..parts {
                        (u, v) = sample(&part, 8, u, v);
                    }
                    let (wu, wv) = sample(&whole, 8, 0.25 + i as f64 / 32.0, 0.25 + j as f64 / 32.0);
                    worst = worst.max(((u - wu).powi(2) + (v - wv).powi(2)).sqrt() * 512.0);
                }
            }
            // A whole step moves these points by up to ~10 px.
            assert!(worst < 0.25, "{parts} parts land {worst:.3} px from a whole step");
        }
    }

    #[test]
    fn between_steps_a_flow_slides_and_a_fold_cross_fades() {
        // A flow (zoom, rotation, a shift, a stretch): both maps are the part.
        let (mut r, size) = moving();
        let mut mesh = Mesh::default();
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut part, mut moved, mut shaded) = (Vec::new(), Vec::new(), Vec::new());
        mesh.uvs(0.5, &mut part);
        mesh.between(0.5, &mut moved, &mut shaded);
        assert!(moved == part && shaded == part, "a flow slides");
        // A kaleidoscope's fold: the right half is the left half mirrored.
        let text = "[preset00]\nzoom=1\nrot=0\nwarp=0\nper_pixel_1=dx = above(x, 0.5) * (2*x - 1);";
        let mut r = running(text, &size);
        r.warp_motion(1.0, &size, &mut mesh);
        let (mut none, mut whole) = (Vec::new(), Vec::new());
        mesh.uvs(0.0, &mut none);
        mesh.uvs(1.0, &mut whole);
        mesh.between(0.5, &mut moved, &mut shaded);
        let n = (size.mesh_width + 1) * (size.mesh_height + 1);
        let (mut slid, mut faded) = (0, 0);
        for i in 0..n {
            let x = (i % (size.mesh_width + 1)) as f64 / size.mesh_width as f64;
            if x < 0.4 {
                // Left of the fold nothing moves.
                assert_eq!((moved[i], shaded[i]), (none[i], none[i]));
                slid += 1;
            } else if x > 0.6 {
                // Mirrored: the moved picture stays put, the shader's is the whole step.
                assert_eq!((moved[i], shaded[i]), (none[i], whole[i]), "vertex {i}");
                faded += 1;
            }
        }
        assert!(slid > 0 && faded > 0);
    }
}
