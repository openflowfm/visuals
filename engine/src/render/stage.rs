use super::gpu::{buffer, pipeline};
use super::{Renderer, COMP_GRID, FORMAT};
use crate::shader::{self, Kind};
use std::borrow::Cow;
use std::collections::HashMap;

/// One of the preset's two shaders, compiled into a pipeline, with what its
/// uniforms and textures are called.
pub(super) struct Stage {
    pub(super) pipeline: wgpu::RenderPipeline,
    /// The warp's pipeline for a refresh between steps: the same shader, mixed
    /// over what is under it by the blend constant (the step's fraction).
    pub(super) mixed: Option<wgpu::RenderPipeline>,
    uniform: wgpu::Buffer,
    /// Byte offset of each uniform, by name without the `_u_` prefix.
    offsets: HashMap<String, u32>,
    span: usize,
    /// Every binding the entry point uses, and what it names.
    bindings: Vec<(u32, Binding)>,
}

#[derive(Debug, Clone)]
enum Binding {
    Uniform,
    Texture(String),
    Sampler(String),
}

pub(super) const WARP_VS: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) uv_orig: vec2f, @location(2) color: vec4f }
@vertex fn main(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) c: vec4f) -> Out {
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.uv = uv;
  o.uv_orig = p * 0.5 + 0.5;
  o.color = c;
  return o;
}";

pub(super) const COMP_VS: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f }
@vertex fn main(@location(0) p: vec2f, @location(1) c: vec4f) -> Out {
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  o.color = c;
  return o;
}";

static WARP_ATTRIBUTES: [[wgpu::VertexAttribute; 1]; 3] = [
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0, shader_location: 0 }],
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0, shader_location: 1 }],
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 2 }],
];

/// The warp mesh's vertex buffers: positions, texture coordinates, colours.
pub(super) fn warp_layout() -> [Option<wgpu::VertexBufferLayout<'static>>; 3] {
    let layout = |stride: u64, i: usize| Some(wgpu::VertexBufferLayout { array_stride: stride, step_mode: wgpu::VertexStepMode::Vertex, attributes: &WARP_ATTRIBUTES[i] });
    [layout(8, 0), layout(8, 1), layout(16, 2)]
}

impl Renderer {
    /// Compile one of a preset's shaders into a pipeline.
    pub(super) fn stage(&self, kind: Kind, text: &str) -> Result<Stage, shader::Error> {
        let (module, info) = shader::translate(kind, text)?.ok_or(shader::Error::NoBody)?;
        let used = info.get_entry_point(0);
        let mut offsets = HashMap::new();
        let mut span = 0;
        let mut bindings = Vec::new();
        for (handle, global) in module.global_variables.iter() {
            let Some(binding) = &global.binding else { continue };
            if used[handle].is_empty() {
                continue;
            }
            let name = global.name.clone().unwrap_or_default();
            match &module.types[global.ty].inner {
                naga::TypeInner::Struct { members, span: s } => {
                    span = *s as usize;
                    for m in members {
                        if let Some(n) = &m.name {
                            offsets.insert(n.trim_start_matches("_u_").to_owned(), m.offset);
                        }
                    }
                    bindings.push((binding.binding, Binding::Uniform));
                }
                naga::TypeInner::Image { .. } => bindings.push((binding.binding, Binding::Texture(name.trim_end_matches("_tex").to_owned()))),
                naga::TypeInner::Sampler { .. } => bindings.push((binding.binding, Binding::Sampler(name.trim_end_matches("_smp").to_owned()))),
                _ => {}
            }
        }
        let fragment = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(match kind {
                Kind::Warp => "warp",
                Kind::Comp => "comp",
            }),
            source: wgpu::ShaderSource::Naga(Cow::Owned(module)),
        });
        let c1 = [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 1 }];
        let warp_buffers = warp_layout();
        let comp_buffers = [
            warp_buffers[0].clone(),
            Some(wgpu::VertexBufferLayout { array_stride: 16, step_mode: wgpu::VertexStepMode::Vertex, attributes: &c1 }),
        ];
        let (vs, buffers): (&wgpu::ShaderModule, &[Option<wgpu::VertexBufferLayout>]) = match kind {
            Kind::Warp => (&self.warp_vs, &warp_buffers),
            Kind::Comp => (&self.comp_vs, &comp_buffers),
        };
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let make = |blend: Option<wgpu::BlendState>| {
            let target = wgpu::ColorTargetState { format: FORMAT, blend, write_mask: wgpu::ColorWrites::ALL };
            pipeline(&self.device, None, (vs, "main", buffers), wgpu::PrimitiveTopology::TriangleList, (&fragment, "_milkdrop_main"), target)
        };
        let pipeline = make(None);
        // Between steps: the shader's picture × the fraction + what is under it × the rest.
        let mix = wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Constant, dst_factor: wgpu::BlendFactor::OneMinusConstant, operation: wgpu::BlendOperation::Add };
        let mixed = matches!(kind, Kind::Warp).then(|| make(Some(wgpu::BlendState { color: mix, alpha: mix })));
        if let Some(error) = pollster::block_on(scope.pop()) {
            return Err(shader::Error::Invalid(error.to_string()));
        }
        let uniform = buffer(&self.device, &vec![0u8; span.max(16)], wgpu::BufferUsages::UNIFORM);
        Ok(Stage { pipeline, mixed, uniform, offsets, span: span.max(16), bindings })
    }

    /// The uniforms every preset shader reads, for this frame.
    pub(super) fn uniforms(&mut self) -> Vec<(&'static str, Vec<f32>)> {
        let r = self.runner.as_ref().unwrap();
        let s = self.size;
        let (ax, ay) = (s.aspect_x() as f32, s.aspect_y() as f32);
        let t = r.get("time");
        let (mins, maxs) = Self::blur_values(r);
        let q = r.q();
        let quad = |i: usize| q[i * 4..i * 4 + 4].to_vec();
        let roam = |speeds: [f64; 4], f: fn(f64) -> f64| speeds.map(|k| (0.5 + 0.5 * f(t * k)) as f32).to_vec();
        let rand_frame = [0; 4].map(|_| self.rng.random() as f32).to_vec();
        let (bass, mid, treb) = (r.get("bass"), r.get("mid"), r.get("treb"));
        let (ba, ma, ta) = (r.get("bass_att"), r.get("mid_att"), r.get("treb_att"));
        let f = |v: f64| vec![v as f32];
        vec![
            ("time", f(t)),
            ("fps", f(r.get("fps"))),
            ("frame", f(r.get("frame"))),
            ("bass", f(bass)),
            ("mid", f(mid)),
            ("treb", f(treb)),
            ("vol", f((bass + mid + treb) / 3.0)),
            ("bass_att", f(ba)),
            ("mid_att", f(ma)),
            ("treb_att", f(ta)),
            ("vol_att", f((ba + ma + ta) / 3.0)),
            ("aspect", vec![ax, ay, 1.0 / ax, 1.0 / ay]),
            ("texsize", vec![s.texsize_x as f32, s.texsize_y as f32, 1.0 / s.texsize_x as f32, 1.0 / s.texsize_y as f32]),
            ("texsize_noise_lq", vec![256.0, 256.0, 1.0 / 256.0, 1.0 / 256.0]),
            ("texsize_noise_mq", vec![256.0, 256.0, 1.0 / 256.0, 1.0 / 256.0]),
            ("texsize_noise_hq", vec![256.0, 256.0, 1.0 / 256.0, 1.0 / 256.0]),
            ("texsize_noise_lq_lite", vec![32.0, 32.0, 1.0 / 32.0, 1.0 / 32.0]),
            ("texsize_noisevol_lq", vec![32.0, 32.0, 1.0 / 32.0, 1.0 / 32.0]),
            ("texsize_noisevol_hq", vec![32.0, 32.0, 1.0 / 32.0, 1.0 / 32.0]),
            ("rand_frame", rand_frame),
            ("rand_preset", r.rand_preset.to_vec()),
            ("roam_cos", roam([0.3, 1.3, 5.0, 20.0], f64::cos)),
            ("roam_sin", roam([0.3, 1.3, 5.0, 20.0], f64::sin)),
            ("slow_roam_cos", roam([0.005, 0.008, 0.013, 0.022], f64::cos)),
            ("slow_roam_sin", roam([0.005, 0.008, 0.013, 0.022], f64::sin)),
            ("_qa", quad(0)),
            ("_qb", quad(1)),
            ("_qc", quad(2)),
            ("_qd", quad(3)),
            ("_qe", quad(4)),
            ("_qf", quad(5)),
            ("_qg", quad(6)),
            ("_qh", quad(7)),
            ("_c5", vec![(maxs[0] - mins[0]) as f32, mins[0] as f32, (maxs[1] - mins[1]) as f32, mins[1] as f32]),
            ("_c6", vec![(maxs[2] - mins[2]) as f32, mins[2] as f32, 0.0, 0.0]),
            ("blur1_min", f(mins[0])),
            ("blur1_max", f(maxs[0])),
            ("blur2_min", f(mins[1])),
            ("blur2_max", f(maxs[1])),
            ("blur3_min", f(mins[2])),
            ("blur3_max", f(maxs[2])),
            ("_d0", vec![r.get("decay") as f32, r.get("gammaadj") as f32, r.get("echo_zoom") as f32, r.get("echo_alpha") as f32]),
            ("_d1", vec![r.get("echo_orient") as f32, r.get("fshader") as f32, r.get("brighten") as f32, r.get("darken") as f32]),
            ("_d2", vec![r.get("solarize") as f32, r.get("invert") as f32, 0.0, 0.0]),
        ]
    }

    pub(super) fn write_uniforms(&self, stage: &Stage, values: &[(&'static str, Vec<f32>)]) {
        let mut bytes = vec![0u8; stage.span];
        for (name, value) in values {
            if let Some(&offset) = stage.offsets.get(*name) {
                let at = offset as usize;
                let raw: &[u8] = bytemuck::cast_slice(value);
                if at + raw.len() <= bytes.len() {
                    bytes[at..at + raw.len()].copy_from_slice(raw);
                }
            }
        }
        // MilkDrop's random rotations are the identity until they are generated.
        for i in 1..=4 {
            for kind in ["s", "d", "f", "vf", "uf", "rand"] {
                if let Some(&offset) = stage.offsets.get(&format!("rot_{kind}{i}")) {
                    let identity: [f32; 16] = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
                    let at = offset as usize;
                    if at + 64 <= bytes.len() {
                        bytes[at..at + 64].copy_from_slice(bytemuck::cast_slice(&identity));
                    }
                }
            }
        }
        self.queue.write_buffer(&stage.uniform, 0, &bytes);
    }

    /// The sampler, by MilkDrop's naming: `fw_` filtered and wrapping, `fc_`
    /// filtered and clamped, `pw_`/`pc_` point-sampled; `sampler_main` follows the
    /// preset's `wrap`.
    pub(super) fn sampler_for(&self, name: &str, wrap: bool) -> &wgpu::Sampler {
        let short = name.trim_start_matches("sampler_");
        let s = &self.samplers;
        if short == "main" {
            s.linear(wrap)
        } else if short.starts_with("fw_") {
            &s.linear_wrap
        } else if short.starts_with("fc_") || short.starts_with("blur") {
            &s.linear_clamp
        } else if short.starts_with("pw_") {
            &s.point_wrap
        } else if short.starts_with("pc_") {
            &s.point_clamp
        } else {
            &s.linear_wrap
        }
    }

    pub(super) fn bind_group(&self, stage: &Stage, pipeline: &wgpu::RenderPipeline, previous: &wgpu::TextureView, wrap: bool, between: bool) -> wgpu::BindGroup {
        let entries: Vec<wgpu::BindGroupEntry> = stage
            .bindings
            .iter()
            .map(|(binding, what)| wgpu::BindGroupEntry {
                binding: *binding,
                resource: match what {
                    Binding::Uniform => stage.uniform.as_entire_binding(),
                    Binding::Texture(name) => wgpu::BindingResource::TextureView(self.texture_for(name, previous, between)),
                    Binding::Sampler(name) => wgpu::BindingResource::Sampler(self.sampler_for(name, wrap)),
                },
            })
            .collect();
        self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipeline.get_bind_group_layout(0), entries: &entries })
    }

    /// Butterchurn's hue colours for the comp mesh's corners, blended across it.
    pub(super) fn comp_colors(&self, time: f64, rand_start: [f32; 4]) -> Vec<[f32; 4]> {
        let mut hue = [[1f64; 3]; 4];
        for (i, h) in hue.iter_mut().enumerate() {
            let i = i as f64;
            h[0] = 0.6 + 0.3 * (time * 30.0 * 0.0143 + 3.0 + i * 21.0 + rand_start[3] as f64).sin();
            h[1] = 0.6 + 0.3 * (time * 30.0 * 0.0107 + 1.0 + i * 13.0 + rand_start[1] as f64).sin();
            h[2] = 0.6 + 0.3 * (time * 30.0 * 0.0129 + 6.0 + i * 9.0 + rand_start[2] as f64).sin();
            let max = h[0].max(h[1]).max(h[2]);
            for c in h.iter_mut() {
                *c = 0.5 + 0.5 * (*c / max);
            }
        }
        let (gx, gy) = COMP_GRID;
        let mut out = Vec::with_capacity((gx + 1) * (gy + 1));
        for j in 0..=gy {
            for i in 0..=gx {
                let (x, y) = (i as f64 / gx as f64, j as f64 / gy as f64);
                let mut col = [0f32; 4];
                for c in 0..3 {
                    col[c] = (hue[0][c] * x * y + hue[1][c] * (1.0 - x) * y + hue[2][c] * x * (1.0 - y) + hue[3][c] * (1.0 - x) * (1.0 - y)) as f32;
                }
                col[3] = 1.0;
                out.push(col);
            }
        }
        out
    }

    /// The warp mesh with `uvs` as its texture coordinates, into an open pass.
    pub(super) fn mesh_draw(&self, pass: &mut wgpu::RenderPass, uvs: &wgpu::Buffer) {
        pass.set_vertex_buffer(0, self.warp_positions.slice(..));
        pass.set_vertex_buffer(1, uvs.slice(..));
        pass.set_vertex_buffer(2, self.warp_colors.slice(..));
        pass.set_index_buffer(self.warp_indices.0.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..self.warp_indices.1, 0, 0..1);
    }
}
