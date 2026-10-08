use super::gpu::{bind, quad_pass};
use super::Renderer;
use crate::runtime::{Runner, Size};

pub(super) const BLUR_RATIOS: [[f64; 2]; 3] = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]];

/// Butterchurn's two blur passes, as WGSL. A full-screen quad from the vertex index.
pub(super) const BLUR: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0);
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}
struct H { texsize: vec4f, ws: vec4f, ds: vec4f, scale: f32, bias: f32, wdiv: f32, _pad: f32 }
@group(0) @binding(0) var<uniform> h: H;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@fragment fn horizontal(in: Out) -> @location(0) vec4f {
  let uv = in.uv;
  let t = h.texsize.z;
  var blur = (textureSample(tex, smp, uv + vec2f( h.ds[0] * t, 0.0)).xyz + textureSample(tex, smp, uv + vec2f(-h.ds[0] * t, 0.0)).xyz) * h.ws[0]
           + (textureSample(tex, smp, uv + vec2f( h.ds[1] * t, 0.0)).xyz + textureSample(tex, smp, uv + vec2f(-h.ds[1] * t, 0.0)).xyz) * h.ws[1]
           + (textureSample(tex, smp, uv + vec2f( h.ds[2] * t, 0.0)).xyz + textureSample(tex, smp, uv + vec2f(-h.ds[2] * t, 0.0)).xyz) * h.ws[2]
           + (textureSample(tex, smp, uv + vec2f( h.ds[3] * t, 0.0)).xyz + textureSample(tex, smp, uv + vec2f(-h.ds[3] * t, 0.0)).xyz) * h.ws[3];
  blur = blur * h.wdiv;
  blur = blur * h.scale + h.bias;
  return vec4f(blur, 1.0);
}
struct V { texsize: vec4f, wds: vec4f, ed1: f32, ed2: f32, ed3: f32, wdiv: f32 }
@group(0) @binding(0) var<uniform> v: V;
@fragment fn vertical(in: Out) -> @location(0) vec4f {
  let uv = in.uv;
  let t = v.texsize.w;
  var blur = (textureSample(tex, smp, uv + vec2f(0.0,  v.wds[2] * t)).xyz + textureSample(tex, smp, uv + vec2f(0.0, -v.wds[2] * t)).xyz) * v.wds[0]
           + (textureSample(tex, smp, uv + vec2f(0.0,  v.wds[3] * t)).xyz + textureSample(tex, smp, uv + vec2f(0.0, -v.wds[3] * t)).xyz) * v.wds[1];
  blur = blur * v.wdiv;
  var e = min(min(uv.x, uv.y), 1.0 - max(uv.x, uv.y));
  e = sqrt(e);
  e = v.ed1 + v.ed2 * clamp(e * v.ed3, 0.0, 1.0);
  return vec4f(blur * e, 1.0);
}";

pub(super) fn blur_size(size: &Size, ratio: f64) -> (u32, u32) {
    let x = (size.texsize_x * ratio).max(16.0);
    let y = (size.texsize_y * ratio).max(16.0);
    ((((x + 3.0) / 16.0).floor() * 16.0) as u32, (((y + 3.0) / 4.0).floor() * 4.0) as u32)
}

impl Renderer {
    /// Butterchurn's `getBlurValues`: each level's range within the one before
    /// (as adjusted), and at least 0.1 wide. Butterchurn's quirk is kept: a range
    /// too narrow becomes `avg - 0.05` at both ends, not `avg ± 0.05`.
    pub(super) fn blur_values(r: &Runner) -> ([f64; 3], [f64; 3]) {
        let min = 0.1;
        let (mut mins, mut maxs) = ([0f64; 3], [0f64; 3]);
        for (i, (n_name, x_name)) in [("b1n", "b1x"), ("b2n", "b2x"), ("b3n", "b3x")].into_iter().enumerate() {
            let (mut n, mut x) = (r.get(n_name), r.get(x_name));
            if i > 0 {
                x = maxs[i - 1].min(x);
                n = mins[i - 1].max(n);
            }
            if x - n < min {
                let avg = (n + x) * 0.5;
                n = avg - min * 0.5;
                x = avg - min * 0.5;
            }
            (mins[i], maxs[i]) = (n, x);
        }
        (mins, maxs)
    }

    /// Butterchurn's blur pyramid: per level, a horizontal pass into a narrower
    /// texture and a vertical pass into a shorter one — of `picture`, into the
    /// step's blur or, `between` steps, the picture between's own.
    pub(super) fn blur(&self, encoder: &mut wgpu::CommandEncoder, picture: &wgpu::TextureView, between: bool) {
        if self.blur_passes == 0 {
            return;
        }
        let targets = if between { &self.display_blur } else { &self.blur };
        let r = self.runner.as_ref().unwrap();
        let (mins, maxs) = Self::blur_values(r);
        let w = [4.0f32, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3];
        let (w1, w2, w3, w4) = (w[0] + w[1], w[2] + w[3], w[4] + w[5], w[6] + w[7]);
        let ds = [2.0 * w[1] / w1, 2.0 + 2.0 * w[3] / w2, 4.0 + 2.0 * w[5] / w3, 6.0 + 2.0 * w[7] / w4];
        let wdiv_h = 0.5 / (w1 + w2 + w3 + w4);
        let (v1, v2) = (w[0] + w[1] + w[2] + w[3], w[4] + w[5] + w[6] + w[7]);
        let wds = [v1, v2, 2.0 * ((w[2] + w[3]) / v1), 2.0 + 2.0 * ((w[6] + w[7]) / v2)];
        let wdiv_v = 1.0 / ((v1 + v2) * 2.0);
        // `getScaleAndBias`.
        let mut scale = [1f64; 3];
        let mut bias = [0f64; 3];
        scale[0] = 1.0 / (maxs[0] - mins[0]);
        bias[0] = -mins[0] * scale[0];
        let (lo, hi) = ((mins[1] - mins[0]) / (maxs[0] - mins[0]), (maxs[1] - mins[0]) / (maxs[0] - mins[0]));
        scale[1] = 1.0 / (hi - lo);
        bias[1] = -lo * scale[1];
        let (lo, hi) = ((mins[2] - mins[1]) / (maxs[1] - mins[1]), (maxs[2] - mins[1]) / (maxs[1] - mins[1]));
        scale[2] = 1.0 / (hi - lo);
        bias[2] = -lo * scale[2];
        let b1ed = r.get("b1ed") as f32;
        for level in 0..self.blur_passes {
            let source: &wgpu::TextureView = if level == 0 { picture } else { &targets[level - 1].1.view };
            let src_ratio = if level > 0 { BLUR_RATIOS[level - 1][1] } else { 1.0 };
            let src = blur_size(&self.size, src_ratio);
            let (h_target, v_target) = &targets[level];
            let (h_uniform, v_uniform) = &self.blur_uniforms[level];
            let mut h: Vec<f32> = vec![src.0 as f32, src.1 as f32, 1.0 / src.0 as f32, 1.0 / src.1 as f32];
            h.extend([w1, w2, w3, w4]);
            h.extend(ds);
            h.extend([scale[level] as f32, bias[level] as f32, wdiv_h, 0.0]);
            self.queue.write_buffer(h_uniform, 0, bytemuck::cast_slice(&h));
            let hs = h_target.size;
            let ed = if level == 0 { b1ed } else { 0.0 };
            let mut v: Vec<f32> = vec![hs.0 as f32, hs.1 as f32, 1.0 / hs.0 as f32, 1.0 / hs.1 as f32];
            v.extend(wds);
            v.extend([1.0 - ed, ed, 5.0, wdiv_v]);
            self.queue.write_buffer(v_uniform, 0, bytemuck::cast_slice(&v));
            for (pipeline, uniform, input, output) in [(&self.blur_h, h_uniform, source, &h_target.view), (&self.blur_v, v_uniform, &h_target.view, &v_target.view)] {
                let group = bind(&self.device, pipeline, &[uniform.as_entire_binding(), wgpu::BindingResource::TextureView(input), wgpu::BindingResource::Sampler(&self.samplers.linear_clamp)]);
                quad_pass(encoder, output, pipeline, &group);
            }
        }
    }
}
