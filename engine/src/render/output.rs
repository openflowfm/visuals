use super::gpu::{bind, buffer, quad, quad_pass, Target};
use super::{Renderer, FORMAT};
use crate::runtime::PRESET_RATE;
use std::borrow::Cow;

/// The trails echo: kept in half floats, so a small echo per refresh still
/// fades at 120 Hz (in 8 bits, `x × 0.995` rounds back to `x`).
pub(super) struct Trails {
    echo: wgpu::RenderPipeline,
    copy: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    kept: [Target; 2],
    at: usize,
}

/// The finished picture to the window, the right way up.
pub(super) const BLIT: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0);
  var o: Out;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(in: Out) -> @location(0) vec4f { return vec4f(textureSample(tex, smp, in.uv).rgb, 1.0); }";

impl Renderer {
    /// The trails echo: the brighter of comp and the picture before faded by
    /// [`Renderer::set_trails`]'s amount — `k` per 1/60 s of preset time, so the
    /// same at any refresh rate — per channel, kept in half floats and copied
    /// back to comp. The picture before is the last one shown, echo included,
    /// so the echo accumulates; turned on, it starts from comp alone.
    pub(super) fn echo(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if self.trails_pass.is_none() {
            let shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("trails"), source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(crate::fx::TRAILS)) });
            let half = wgpu::TextureFormat::Rgba16Float;
            let (echo, copy) = (quad(&self.device, "trails", &shader, "fs", half), quad(&self.device, "trails", &shader, "copy", FORMAT));
            let uniform = buffer(&self.device, &[0u8; 16], wgpu::BufferUsages::UNIFORM);
            let kept = [Target::of(&self.device, self.comp.size, "trails a", half), Target::of(&self.device, self.comp.size, "trails b", half)];
            self.trails_pass = Some(Trails { echo, copy, uniform, kept, at: 0 });
        }
        let k = if self.trails_on { self.trails.powf((self.advanced / PRESET_RATE * 60.0) as f32) } else { 0.0 };
        let t = self.trails_pass.as_mut().unwrap();
        let (before, after) = (t.at, t.at ^ 1);
        t.at = after;
        let t = self.trails_pass.as_ref().unwrap();
        self.queue.write_buffer(&t.uniform, 0, bytemuck::cast_slice(&[k, 0.0, 0.0, 0.0]));
        let view = wgpu::BindingResource::TextureView;
        let echo = bind(&self.device, &t.echo, &[view(&self.comp.view), view(&t.kept[before].view), t.uniform.as_entire_binding()]);
        let copy = bind(&self.device, &t.copy, &[view(&t.kept[after].view)]);
        quad_pass(encoder, &t.kept[after].view, &t.echo, &echo);
        quad_pass(encoder, &self.comp.view, &t.copy, &copy);
    }

    pub(super) fn preview(&self, encoder: &mut wgpu::CommandEncoder, which: usize, source: &wgpu::TextureView) {
        if let Some(previews) = &self.previews {
            self.blit(encoder, source, &previews[which].view, FORMAT);
        }
    }

    pub(super) fn blit_pipeline(&mut self, format: wgpu::TextureFormat) {
        if !self.blits.contains_key(&format) {
            self.blits.insert(format, quad(&self.device, "blit", &self.blit_shader, "fs", format));
        }
    }

    /// Draw `source` scaled into `target`, picture side up. The pipeline for
    /// `format` must already exist ([`Renderer::blit_pipeline`]).
    fn blit(&self, encoder: &mut wgpu::CommandEncoder, source: &wgpu::TextureView, target: &wgpu::TextureView, format: wgpu::TextureFormat) {
        let pipeline = &self.blits[&format];
        let group = bind(&self.device, pipeline, &[wgpu::BindingResource::TextureView(source), wgpu::BindingResource::Sampler(&self.samplers.linear_clamp)]);
        quad_pass(encoder, target, pipeline, &group);
    }
}
