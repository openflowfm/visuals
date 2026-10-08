//! Everything MilkDrop draws into the feedback loop after the warp: motion
//! vectors, custom shapes, custom waves, the basic waveform, the darkened centre
//! and the two borders. A port of Butterchurn's `motionVectors`, `customShape`,
//! `customWaveform`, `basicWaveform`, `darkenCenter` and `border`, producing one
//! [`DrawList`] the renderer draws in a single pass.
//!
//! Positions are in WebGL clip space, as Butterchurn computes them; the vertex
//! shader turns them the renderer's way up.

use crate::audio::Audio;
use crate::runtime::{Runner, Size};
use std::f64::consts::PI;

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub pos: [f32; 2],
    pub color: [f32; 4],
    pub uv: [f32; 2],
    /// 1 when a shape samples the previous frame, 0 for a flat colour.
    pub textured: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Topology {
    Triangles,
    Lines,
    LineStrip,
    Points,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Blend {
    Alpha,
    Additive,
}

/// Which stage drew a command — so an editor can show each stage's drawing alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Source {
    #[default]
    Motion,
    Shape(usize),
    Wave(usize),
    Basic,
    Darken,
    Border,
}

#[derive(Debug, Clone, Copy)]
pub struct Cmd {
    pub topology: Topology,
    pub blend: Blend,
    pub first: u32,
    pub count: u32,
    pub source: Source,
}

#[derive(Debug, Default)]
pub struct DrawList {
    pub vertices: Vec<Vertex>,
    pub cmds: Vec<Cmd>,
    /// The stage whose commands are being pushed.
    source: Source,
}

impl DrawList {
    fn push(&mut self, topology: Topology, blend: Blend, vertices: impl IntoIterator<Item = Vertex>) {
        let first = self.vertices.len() as u32;
        self.vertices.extend(vertices);
        let count = self.vertices.len() as u32 - first;
        if count > 0 {
            self.cmds.push(Cmd { topology, blend, first, count, source: self.source });
        }
    }

    pub fn clear(&mut self) {
        self.vertices.clear();
        self.cmds.clear();
    }
}

fn flat(x: f64, y: f64, color: [f64; 4]) -> Vertex {
    Vertex { pos: [x as f32, y as f32], color: color.map(|c| c as f32), uv: [0.0; 2], textured: 0.0 }
}

/// Butterchurn's four thick-line offsets: none, right, up, both — two pixels.
fn thick_offsets(size: &Size, thick: bool) -> Vec<(f64, f64)> {
    let (ox, oy) = (2.0 / size.texsize_x, 2.0 / size.texsize_y);
    if thick { vec![(0.0, 0.0), (ox, 0.0), (0.0, oy), (ox, oy)] } else { vec![(0.0, 0.0)] }
}

/// Lines or points along `points`, drawn once per thick offset. Points larger
/// than a pixel become squares, since a GPU point is one pixel.
fn strokes(list: &mut DrawList, points: &[Vertex], dots: Option<f64>, thick: bool, blend: Blend, size: &Size) {
    for (dx, dy) in thick_offsets(size, thick) {
        let moved = points.iter().map(|v| Vertex { pos: [v.pos[0] + dx as f32, v.pos[1] + dy as f32], ..*v });
        match dots {
            None => list.push(Topology::LineStrip, blend, moved),
            Some(px) if px <= 1.0 => list.push(Topology::Points, blend, moved),
            Some(px) => {
                let (hx, hy) = ((px / size.texsize_x) as f32, (px / size.texsize_y) as f32);
                let quads: Vec<Vertex> = moved
                    .flat_map(|v| {
                        let c = |sx: f32, sy: f32| Vertex { pos: [v.pos[0] + sx * hx, v.pos[1] + sy * hy], ..v };
                        [c(-1., -1.), c(1., -1.), c(1., 1.), c(-1., -1.), c(1., 1.), c(-1., 1.)]
                    })
                    .collect();
                list.push(Topology::Triangles, blend, quads);
            }
        }
    }
}

/// `WaveUtils.smoothWave`: each segment gains a midpoint from a four-tap curve.
fn smooth(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let n = points.len();
    if n < 2 {
        return points.to_vec();
    }
    let (c1, c2, c3, c4) = (-0.15, 1.15, 1.15, -0.15);
    let inv = 1.0 / (c1 + c2 + c3 + c4);
    let mut out = Vec::with_capacity(n * 2 - 1);
    let (mut below, mut above2) = (0usize, 1usize);
    for i in 0..n - 1 {
        let above = above2;
        above2 = (i + 2).min(n - 1);
        out.push(points[i]);
        let mid = |k: usize| (c1 * points[below][k] + c2 * points[i][k] + c3 * points[above][k] + c4 * points[above2][k]) * inv;
        out.push([mid(0), mid(1)]);
        below = i;
    }
    out.push(points[n - 1]);
    out
}

pub fn motion_vectors(r: &Runner, uvs: &[[f32; 2]], size: &Size, list: &mut DrawList) {
    let alpha = r.get("mv_a");
    let (mut nx, mut ny) = (r.get("mv_x").floor() as i64, r.get("mv_y").floor() as i64);
    if alpha <= 0.001 || nx <= 0 || ny <= 0 {
        return;
    }
    let mut dx = r.get("mv_x") - nx as f64;
    let mut dy = r.get("mv_y") - ny as f64;
    if nx > 64 {
        nx = 64;
        dx = 0.0;
    }
    if ny > 48 {
        ny = 48;
        dy = 0.0;
    }
    let (dx2, dy2, len_mult) = (r.get("mv_dx"), r.get("mv_dy"), r.get("mv_l"));
    let min_len = 1.0 / size.texsize_x;
    let (mw, mh) = (size.mesh_width, size.mesh_height);
    let motion = |fx: f64, fy: f64| {
        let y0 = (fy * mh as f64).floor() as usize;
        let ddy = fy * mh as f64 - y0 as f64;
        let x0 = (fx * mw as f64).floor() as usize;
        let ddx = fx * mw as f64 - x0 as f64;
        let w = mw + 1;
        let at = |x: usize, y: usize| uvs.get(y * w + x).copied().unwrap_or([0.0; 2]);
        let mut u = at(x0, y0)[0] as f64 * (1.0 - ddx) * (1.0 - ddy);
        let mut v = at(x0, y0)[1] as f64 * (1.0 - ddx) * (1.0 - ddy);
        u += at(x0 + 1, y0)[0] as f64 * ddx * (1.0 - ddy);
        v += at(x0 + 1, y0)[1] as f64 * ddx * (1.0 - ddy);
        u += at(x0, y0 + 1)[0] as f64 * (1.0 - ddx) * ddy;
        v += at(x0, y0 + 1)[1] as f64 * (1.0 - ddx) * ddy;
        u += at(x0 + 1, y0 + 1)[0] as f64 * ddx * ddy;
        v += at(x0 + 1, y0 + 1)[1] as f64 * ddx * ddy;
        (u, 1.0 - v)
    };
    let color = [r.get("mv_r"), r.get("mv_g"), r.get("mv_b"), alpha];
    let mut lines = Vec::new();
    for j in 0..ny {
        let fy = (j as f64 + 0.25) / (ny as f64 + dy + 0.25 - 1.0) - dy2;
        if !(fy > 0.0001 && fy < 0.9999) {
            continue;
        }
        for i in 0..nx {
            let fx = (i as f64 + 0.25) / (nx as f64 + dx + 0.25 - 1.0) + dx2;
            if !(fx > 0.0001 && fx < 0.9999) {
                continue;
            }
            let (fx2, fy2) = motion(fx, fy);
            let (mut dxi, mut dyi) = ((fx2 - fx) * len_mult, (fy2 - fy) * len_mult);
            let dist = (dxi * dxi + dyi * dyi).sqrt();
            if dist < min_len && dist > 0.00000001 {
                let k = min_len / dist;
                dxi *= k;
                dyi *= k;
            } else {
                // Butterchurn sets `dxi` twice here and never `dyi`; so does this.
                dxi = min_len;
            }
            let (ex, ey) = (fx + dxi, fy + dyi);
            lines.push(flat(2.0 * fx - 1.0, 2.0 * fy - 1.0, color));
            lines.push(flat(2.0 * ex - 1.0, 2.0 * ey - 1.0, color));
        }
    }
    list.push(Topology::Lines, Blend::Alpha, lines);
}

const SHAPE_RESET: &[&str] = &[
    "x", "y", "rad", "ang", "r", "g", "b", "a", "r2", "g2", "b2", "a2", "border_r", "border_g", "border_b", "border_a",
    "thickoutline", "textured", "tex_zoom", "tex_ang", "additive",
];

pub fn shapes(r: &mut Runner, globals: &[f64; 15], size: &Size, list: &mut DrawList) {
    let q = r.q_after_frame();
    let regs = r.regs.clone();
    let (ax, ay) = (size.aspect_x(), size.aspect_y());
    let _ = ax;
    for (slot, scope) in r.shapes.iter_mut().enumerate().filter_map(|(i, s)| s.as_mut().map(|s| (i, s))) {
        list.source = Source::Shape(slot);
        let mut vars = scope.run_frame_prelude(globals, &q, &regs);
        let start = vars.clone();
        let instances = scope.get(&vars, "num_inst").clamp(1.0, 1024.0) as usize;
        let reset: Vec<usize> = SHAPE_RESET.iter().map(|n| scope.slot(n)).collect();
        let instance = scope.slot("instance");
        for j in 0..instances {
            vars[instance] = j as f64;
            for &s in &reset {
                vars[s] = start[s];
            }
            scope.rerun_frame(&mut vars);
            let g = |n: &str| scope.get(&vars, n);
            let sides = g("sides").clamp(3.0, 100.0).floor() as usize;
            let (rad, ang) = (g("rad"), g("ang"));
            let (x, y) = (g("x") * 2.0 - 1.0, g("y") * -2.0 + 1.0);
            let center = [g("r"), g("g"), g("b"), g("a")];
            let edge = [g("r2"), g("g2"), g("b2"), g("a2")];
            let border = [g("border_r"), g("border_g"), g("border_b"), g("border_a")];
            let textured = g("textured").abs() >= 1.0;
            let thick = g("thickoutline").abs() >= 1.0;
            let blend = if g("additive").abs() >= 1.0 { Blend::Additive } else { Blend::Alpha };
            let (tex_zoom, tex_ang) = (g("tex_zoom"), g("tex_ang"));
            let quarter = PI * 0.25;
            let tex = if textured { 1.0 } else { 0.0 };
            let middle = Vertex { pos: [x as f32, y as f32], color: center.map(|c| c as f32), uv: [0.5, 0.5], textured: tex };
            let rim: Vec<Vertex> = (1..=sides + 1)
                .map(|k| {
                    let p = (k - 1) as f64 / sides as f64 * 2.0 * PI;
                    let a = p + ang + quarter;
                    let ta = p + tex_ang + quarter;
                    Vertex {
                        pos: [(x + rad * a.cos() * ay) as f32, (y + rad * a.sin()) as f32],
                        color: edge.map(|c| c as f32),
                        uv: [(0.5 + 0.5 * ta.cos() / tex_zoom * ay) as f32, (0.5 + 0.5 * ta.sin() / tex_zoom) as f32],
                        textured: tex,
                    }
                })
                .collect();
            // A fan, as triangles.
            let fan: Vec<Vertex> = (0..sides).flat_map(|k| [middle, rim[k], rim[k + 1]]).collect();
            list.push(Topology::Triangles, blend, fan);
            if border[3] > 0.0 {
                let outline: Vec<Vertex> = rim.iter().map(|v| Vertex { color: border.map(|c| c as f32), textured: 0.0, ..*v }).collect();
                strokes(list, &outline, None, thick, Blend::Alpha, size);
            }
        }
        scope.keep(&vars);
    }
}

pub fn custom_waves(r: &mut Runner, audio: &Audio, globals: &[f64; 15], size: &Size, list: &mut DrawList) {
    let q = r.q_after_frame();
    let regs = r.regs.clone();
    let wave_scale = r.base_value("wave_scale");
    let (iax, iay) = (1.0 / size.aspect_x(), 1.0 / size.aspect_y());
    const MAX: usize = 512;
    for (slot, scope) in r.waves.iter_mut().enumerate().filter_map(|(i, s)| s.as_mut().map(|s| (i, s))) {
        list.source = Source::Wave(slot);
        let mut vars = scope.run_frame(globals, &q, &regs);
        let g = |vars: &[f64], n: &str| scope.get(vars, n);
        let mut samples = (g(&vars, "samples").min(MAX as f64)).floor() as i64;
        let sep = g(&vars, "sep").floor() as i64;
        let (scaling, spectrum, smoothing, usedots) = (g(&vars, "scaling"), g(&vars, "spectrum"), g(&vars, "smoothing"), g(&vars, "usedots"));
        let frame_color = [g(&vars, "r"), g(&vars, "g"), g(&vars, "b"), g(&vars, "a")];
        let (thick, additive) = (g(&vars, "thick") != 0.0, g(&vars, "additive") != 0.0);
        samples -= sep;
        let dots = usedots != 0.0;
        if !(samples >= 2 || (dots && samples >= 1)) {
            scope.keep(&vars);
            continue;
        }
        let n = samples as usize;
        let use_spectrum = spectrum != 0.0;
        let scale = (if use_spectrum { 0.15 } else { 0.004 }) * scaling * wave_scale;
        let (left, right): (&[f32], &[f32]) = if use_spectrum { (&audio.freq_l, &audio.freq_r) } else { (&audio.time_l, &audio.time_r) };
        let j0 = if use_spectrum { 0.0 } else { ((MAX as f64 - n as f64) / 2.0 - sep as f64 / 2.0).floor() };
        let j1 = if use_spectrum { 0.0 } else { ((MAX as f64 - n as f64) / 2.0 + sep as f64 / 2.0).floor() };
        let t = if use_spectrum { (MAX as f64 - sep as f64) / n as f64 } else { 1.0 };
        let mix1 = (smoothing * 0.98).powf(0.5);
        let mix2 = 1.0 - mix1;
        let at = |data: &[f32], i: f64| data.get(i.floor().max(0.0) as usize).copied().unwrap_or(0.0) as f64;
        let mut pl = vec![0f64; n];
        let mut pr = vec![0f64; n];
        pl[0] = at(left, j0);
        pr[0] = at(right, j1);
        for j in 1..n {
            pl[j] = at(left, j as f64 * t + j0) * mix2 + pl[j - 1] * mix1;
            pr[j] = at(right, j as f64 * t + j1) * mix2 + pr[j - 1] * mix1;
        }
        for j in (0..n.saturating_sub(1)).rev() {
            pl[j] = pl[j] * mix2 + pl[j + 1] * mix1;
            pr[j] = pr[j] * mix2 + pr[j + 1] * mix1;
        }
        let slots = ["sample", "value1", "value2", "x", "y", "r", "g", "b", "a"].map(|s| scope.slot(s));
        let mut points = Vec::with_capacity(n);
        for j in 0..n {
            let (v1, v2) = (pl[j] * scale, pr[j] * scale);
            let values = [j as f64 / (n as f64 - 1.0), v1, v2, 0.5 + v1, 0.5 + v2, frame_color[0], frame_color[1], frame_color[2], frame_color[3]];
            for (s, v) in slots.iter().zip(values) {
                vars[*s] = v;
            }
            if !scope.point.is_empty() {
                scope.run_point(&mut vars);
            }
            let x = (vars[slots[3]] * 2.0 - 1.0) * iax;
            let y = (vars[slots[4]] * -2.0 + 1.0) * iay;
            points.push(flat(x, y, [vars[slots[5]], vars[slots[6]], vars[slots[7]], vars[slots[8]]]));
        }
        scope.keep(&vars);
        let blend = if additive { Blend::Additive } else { Blend::Alpha };
        if dots {
            let px = if thick { 2.0 } else { 1.0 } + if size.texsize_x >= 1024.0 { 1.0 } else { 0.0 };
            strokes(list, &points, Some(px), false, blend, size);
        } else {
            // `smoothWaveAndColor`: midpoints take the colour of the point before.
            let xy: Vec<[f64; 2]> = points.iter().map(|v| [v.pos[0] as f64, v.pos[1] as f64]).collect();
            let smoothed: Vec<Vertex> = smooth(&xy)
                .into_iter()
                .enumerate()
                .map(|(k, p)| Vertex { pos: [p[0] as f32, p[1] as f32], ..points[(k / 2).min(n - 1)] })
                .collect();
            strokes(list, &smoothed, None, thick, blend, size);
        }
    }
}

/// `BasicWaveform.processWaveform`: scale and one-pole smoothing.
fn process(time: &[f32], scale: f64, smooth: f64) -> Vec<f64> {
    let s = scale / 128.0;
    let s2 = s * (1.0 - smooth);
    let mut out = Vec::with_capacity(time.len());
    out.push(time[0] as f64 * s);
    for i in 1..time.len() {
        let prev = out[i - 1];
        out.push(time[i] as f64 * s2 + prev * smooth);
    }
    out
}

pub fn basic_wave(r: &Runner, audio: &Audio, size: &Size, list: &mut DrawList) {
    let g = |n: &str| r.get(n);
    let mut alpha = g("wave_a");
    let vol = (g("bass") + g("mid") + g("treb")) / 3.0;
    if !(vol > -0.01 && alpha > 0.001) {
        return;
    }
    let wl = process(&audio.time_l, g("wave_scale"), g("wave_smoothing"));
    let wr = process(&audio.time_r, g("wave_scale"), g("wave_smoothing"));
    let mode = (g("wave_mode").floor() as i64).rem_euclid(8);
    let (px, py) = (g("wave_x") * 2.0 - 1.0, g("wave_y") * 2.0 - 1.0);
    let (ax, ay) = (size.aspect_x(), size.aspect_y());
    let time = g("time");
    let mut param = g("wave_mystery");
    if matches!(mode, 0 | 1 | 4) && !(-1.0..=1.0).contains(&param) {
        param = param * 0.5 + 0.5;
        param -= param.floor();
        param = param.abs() * 2.0 - 1.0;
    }
    let by_volume = |a: f64| {
        if g("modwavealphabyvolume") > 0.0 {
            a * (vol - g("modwavealphastart")) / (g("modwavealphaend") - g("modwavealphastart"))
        } else {
            a
        }
    };
    let size_alpha = |small: f64, mid: f64, large: f64| {
        if size.texsize_x < 1024.0 {
            small
        } else if size.texsize_x < 2048.0 {
            mid
        } else {
            large
        }
    };
    let len = wl.len();
    let mut pos: Vec<[f64; 2]> = Vec::new();
    let mut pos2: Vec<[f64; 2]> = Vec::new();
    match mode {
        0 => {
            alpha = by_volume(alpha).clamp(0.0, 1.0);
            let n = len / 2 + 1;
            let inv = 1.0 / (n as f64 - 1.0);
            let offset = (len - n) / 2;
            for i in 0..n - 1 {
                let mut rad = 0.5 + 0.4 * wr[i + offset] + param;
                let ang = i as f64 * inv * 2.0 * PI + time * 0.2;
                if (i as f64) < n as f64 / 10.0 {
                    let mut mix = i as f64 / (n as f64 * 0.1);
                    mix = 0.5 - 0.5 * (mix * PI).cos();
                    let rad2 = 0.5 + 0.4 * wr.get(i + n + offset).copied().unwrap_or(0.0) + param;
                    rad = (1.0 - mix) * rad2 + rad * mix;
                }
                pos.push([rad * ang.cos() * ay + px, rad * ang.sin() * ax + py]);
            }
            pos.push(pos[0]);
        }
        1 => {
            alpha = by_volume(alpha * 1.25).clamp(0.0, 1.0);
            for i in 0..len / 2 {
                let rad = 0.53 + 0.43 * wr[i] + param;
                let ang = wl[i + 32] * 0.5 * PI + time * 2.3;
                pos.push([rad * ang.cos() * ay + px, rad * ang.sin() * ax + py]);
            }
        }
        2 | 3 => {
            alpha *= if mode == 2 { size_alpha(0.09, 0.11, 0.13) } else { size_alpha(0.15, 0.22, 0.33) * 1.3 * g("treb") * g("treb") };
            alpha = by_volume(alpha).clamp(0.0, 1.0);
            for i in 0..len {
                pos.push([wr[i] * ay + px, wl[(i + 32) % len] * ax + py]);
            }
        }
        4 => {
            alpha = by_volume(alpha).clamp(0.0, 1.0);
            let n = len.min((size.texsize_x / 3.0).floor() as usize);
            let inv = 1.0 / n as f64;
            let offset = (len - n) / 2;
            let w1 = 0.45 + 0.5 * (param * 0.5 + 0.5);
            let w2 = 1.0 - w1;
            for i in 0..n {
                let mut x = 2.0 * i as f64 * inv + (px - 1.0) + wr[(i + 25 + offset) % len] * 0.44;
                let mut y = wl[i + offset] * 0.47 + py;
                if i > 1 {
                    x = x * w2 + w1 * (pos[i - 1][0] * 2.0 - pos[i - 2][0]);
                    y = y * w2 + w1 * (pos[i - 1][1] * 2.0 - pos[i - 2][1]);
                }
                pos.push([x, y]);
            }
        }
        5 => {
            alpha = by_volume(alpha * size_alpha(0.09, 0.11, 0.13)).clamp(0.0, 1.0);
            let (c, s) = ((time * 0.3).cos(), (time * 0.3).sin());
            for i in 0..len {
                let o = (i + 32) % len;
                let x0 = wr[i] * wl[o] + wl[i] * wr[o];
                let y0 = wr[i] * wr[i] - wl[o] * wl[o];
                pos.push([(x0 * c - y0 * s) * (ay + px), (x0 * s + y0 * c) * (ax + py)]);
            }
        }
        _ => {
            alpha = by_volume(alpha).clamp(0.0, 1.0);
            let n = (len / 2).min((size.texsize_x / 3.0).floor() as usize);
            let offset = (len - n) / 2;
            let ang = PI * 0.5 * param;
            let (mut dx, mut dy) = (ang.cos(), ang.sin());
            let mut ex = [px * (ang + PI * 0.5).cos() - dx * 3.0, px * (ang + PI * 0.5).cos() + dx * 3.0];
            let mut ey = [px * (ang + PI * 0.5).sin() - dy * 3.0, px * (ang + PI * 0.5).sin() + dy * 3.0];
            for i in 0..2 {
                for j in 0..4 {
                    let t = match j {
                        0 if ex[i] > 1.1 => Some((1.1 - ex[1 - i]) / (ex[i] - ex[1 - i])),
                        1 if ex[i] < -1.1 => Some((-1.1 - ex[1 - i]) / (ex[i] - ex[1 - i])),
                        2 if ey[i] > 1.1 => Some((1.1 - ey[1 - i]) / (ey[i] - ey[1 - i])),
                        3 if ey[i] < -1.1 => Some((-1.1 - ey[1 - i]) / (ey[i] - ey[1 - i])),
                        _ => None,
                    };
                    if let Some(t) = t {
                        let (dxi, dyi) = (ex[i] - ex[1 - i], ey[i] - ey[1 - i]);
                        ex[i] = ex[1 - i] + dxi * t;
                        ey[i] = ey[1 - i] + dyi * t;
                    }
                }
            }
            dx = (ex[1] - ex[0]) / n as f64;
            dy = (ey[1] - ey[0]) / n as f64;
            let a2 = dy.atan2(dx);
            let (perp_x, perp_y) = ((a2 + PI * 0.5).cos(), (a2 + PI * 0.5).sin());
            if mode == 6 {
                for i in 0..n {
                    let s = wl[i + offset];
                    pos.push([ex[0] + dx * i as f64 + perp_x * 0.25 * s, ey[0] + dy * i as f64 + perp_y * 0.25 * s]);
                }
            } else {
                let sep = (py * 0.5 + 0.5).powi(2);
                for i in 0..n {
                    let s = wl[i + offset];
                    pos.push([ex[0] + dx * i as f64 + perp_x * (0.25 * s + sep), ey[0] + dy * i as f64 + perp_y * (0.25 * s + sep)]);
                }
                for i in 0..n {
                    let s = wr[i + offset];
                    pos2.push([ex[0] + dx * i as f64 + perp_x * (0.25 * s - sep), ey[0] + dy * i as f64 + perp_y * (0.25 * s - sep)]);
                }
            }
        }
    }
    let (mut cr, mut cg, mut cb) = (g("wave_r").clamp(0.0, 1.0), g("wave_g").clamp(0.0, 1.0), g("wave_b").clamp(0.0, 1.0));
    if g("wave_brighten") != 0.0 {
        let m = cr.max(cg).max(cb);
        if m > 0.01 {
            cr /= m;
            cg /= m;
            cb /= m;
        }
    }
    let color = [cr, cg, cb, alpha];
    let blend = if g("additivewave") != 0.0 { Blend::Additive } else { Blend::Alpha };
    let thick = g("wave_thick") != 0.0 || g("wave_dots") != 0.0;
    let dots = if g("wave_dots") != 0.0 { Some(1.0) } else { None };
    for line in [pos, pos2] {
        if line.is_empty() {
            continue;
        }
        // Butterchurn flips y before smoothing.
        let flipped: Vec<[f64; 2]> = line.iter().map(|p| [p[0], -p[1]]).collect();
        let vertices: Vec<Vertex> = smooth(&flipped).into_iter().map(|p| flat(p[0], p[1], color)).collect();
        strokes(list, &vertices, dots, thick, blend, size);
    }
}

pub fn darken_center(r: &Runner, size: &Size, list: &mut DrawList) {
    if r.get("darken_center") == 0.0 {
        return;
    }
    let h = 0.05;
    let ay = size.aspect_y();
    let centre = flat(0.0, 0.0, [0.0, 0.0, 0.0, 3.0 / 32.0]);
    let rim = [(-h * ay, 0.0), (0.0, -h), (h * ay, 0.0), (0.0, h), (-h * ay, 0.0)].map(|(x, y)| flat(x, y, [0.0; 4]));
    let fan: Vec<Vertex> = (0..4).flat_map(|k| [centre, rim[k], rim[k + 1]]).collect();
    list.push(Topology::Triangles, Blend::Alpha, fan);
}

/// `Border.generateBorder`: four quads inset from the edges.
fn border(color: [f64; 4], size: f64, prev: f64, list: &mut DrawList) {
    if !(size > 0.0 && color[3] > 0.0) {
        return;
    }
    let (pw, w) = (prev / 2.0 * 2.0, (size / 2.0 + prev / 2.0) * 2.0);
    let v = |x: f64, y: f64| flat(x, y, color);
    let tri = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| [v(a.0, a.1), v(b.0, b.1), v(c.0, c.1)];
    let mut out = Vec::new();
    let (p1, p2, p3, p4) = ((-1.0 + pw, -1.0 + w), (-1.0 + pw, 1.0 - w), (-1.0 + w, 1.0 - w), (-1.0 + w, -1.0 + w));
    out.extend(tri(p4, p2, p1));
    out.extend(tri(p4, p3, p2));
    let (p1, p2, p3, p4) = ((1.0 - pw, -1.0 + w), (1.0 - pw, 1.0 - w), (1.0 - w, 1.0 - w), (1.0 - w, -1.0 + w));
    out.extend(tri(p1, p2, p4));
    out.extend(tri(p2, p3, p4));
    let (p1, p2, p3, p4) = ((-1.0 + pw, -1.0 + pw), (-1.0 + pw, w - 1.0), (1.0 - pw, w - 1.0), (1.0 - pw, -1.0 + pw));
    out.extend(tri(p4, p2, p1));
    out.extend(tri(p4, p3, p2));
    let (p1, p2, p3, p4) = ((-1.0 + pw, 1.0 - pw), (-1.0 + pw, 1.0 - w), (1.0 - pw, 1.0 - w), (1.0 - pw, 1.0 - pw));
    out.extend(tri(p1, p2, p4));
    out.extend(tri(p2, p3, p4));
    list.push(Topology::Triangles, Blend::Alpha, out);
}

pub fn borders(r: &Runner, list: &mut DrawList) {
    let g = |n: &str| r.get(n);
    border([g("ob_r"), g("ob_g"), g("ob_b"), g("ob_a")], g("ob_size"), 0.0, list);
    border([g("ib_r"), g("ib_g"), g("ib_b"), g("ib_a")], g("ib_size"), g("ob_size"), list);
}

/// What a refresh `f` of the way from one step's drawing to the next draws:
/// each of `to`'s commands that `from` drew too — the same stage, topology,
/// blend and number of vertices, in the same place in the list — with every
/// vertex's position, colour and texture coordinate mixed by `f`, so a wave or
/// shape slides from where it was to where it will be. A command only one of
/// them has (a shape whose sides changed, a wave turned on) fades: `from`'s out
/// by `1 − f`, `to`'s in by `f`.
pub fn between(from: &DrawList, to: &DrawList, f: f32, out: &mut DrawList) {
    out.clear();
    let mix = |a: f32, b: f32| a + (b - a) * f;
    let faded = |v: &Vertex, k: f32| Vertex { color: [v.color[0], v.color[1], v.color[2], v.color[3] * k], ..*v };
    for i in 0..from.cmds.len().max(to.cmds.len()) {
        let (a, b) = (from.cmds.get(i), to.cmds.get(i));
        match (a, b) {
            (Some(a), Some(b)) if (a.topology, a.blend, a.source, a.count) == (b.topology, b.blend, b.source, b.count) => {
                out.source = b.source;
                let (va, vb) = (&from.vertices[a.first as usize..][..a.count as usize], &to.vertices[b.first as usize..][..b.count as usize]);
                out.push(
                    b.topology,
                    b.blend,
                    va.iter().zip(vb).map(|(p, q)| Vertex {
                        pos: [mix(p.pos[0], q.pos[0]), mix(p.pos[1], q.pos[1])],
                        color: [0, 1, 2, 3].map(|c| mix(p.color[c], q.color[c])),
                        uv: [mix(p.uv[0], q.uv[0]), mix(p.uv[1], q.uv[1])],
                        textured: q.textured,
                    }),
                );
            }
            _ => {
                if let Some(a) = a {
                    out.source = a.source;
                    out.push(a.topology, a.blend, from.vertices[a.first as usize..][..a.count as usize].iter().map(|v| faded(v, 1.0 - f)));
                }
                if let Some(b) = b {
                    out.source = b.source;
                    out.push(b.topology, b.blend, to.vertices[b.first as usize..][..b.count as usize].iter().map(|v| faded(v, f)));
                }
            }
        }
    }
}

/// Everything after the warp, in Butterchurn's order.
pub fn frame(r: &mut Runner, audio: &Audio, uvs: &[[f32; 2]], globals: &[f64; 15], size: &Size, list: &mut DrawList) {
    list.clear();
    list.source = Source::Motion;
    motion_vectors(r, uvs, size, list);
    shapes(r, globals, size, list);
    custom_waves(r, audio, globals, size, list);
    list.source = Source::Basic;
    basic_wave(r, audio, size, list);
    list.source = Source::Darken;
    darken_center(r, size, list);
    list.source = Source::Border;
    borders(r, list);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f32, a: f32) -> Vertex {
        Vertex { pos: [x, 0.0], color: [1.0, 1.0, 1.0, a], uv: [x, 0.0], textured: 0.0 }
    }

    fn list(stages: &[(Source, Vec<Vertex>)]) -> DrawList {
        let mut l = DrawList::default();
        for (source, vertices) in stages {
            l.source = *source;
            l.push(Topology::LineStrip, Blend::Alpha, vertices.clone());
        }
        l
    }

    #[test]
    fn between_two_steps_drawing_slides_or_fades() {
        let from = list(&[(Source::Wave(0), vec![at(0.0, 1.0), at(0.2, 1.0)]), (Source::Shape(0), vec![at(0.5, 1.0); 3])]);
        let to = list(&[(Source::Wave(0), vec![at(0.4, 0.5), at(0.6, 0.5)]), (Source::Shape(0), vec![at(0.5, 1.0); 5])]);
        let mut out = DrawList::default();
        between(&from, &to, 0.25, &mut out);
        // The wave both drew slides a quarter of the way, colour and all.
        assert_eq!(out.vertices[..2].iter().map(|v| v.pos[0]).collect::<Vec<_>>(), [0.1, 0.3]);
        assert_eq!(out.vertices[0].color[3], 0.875);
        assert_eq!(out.vertices[1].uv[0], 0.3);
        // The shape changed its sides: the last step's fades out, the next one's in.
        assert_eq!(out.cmds.len(), 3);
        assert_eq!((out.cmds[1].count, out.vertices[2].color[3]), (3, 0.75));
        assert_eq!((out.cmds[2].count, out.vertices[5].color[3]), (5, 0.25));
        assert!(out.cmds.iter().skip(1).all(|c| c.source == Source::Shape(0)));
    }
}
