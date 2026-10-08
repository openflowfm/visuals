use super::gpu::{begin, bind, pipeline};
use super::{Renderer, FORMAT};
use crate::audio::Audio;
use crate::draw::{Blend, DrawList, Topology, Vertex};
use crate::runtime::Runner;
use std::collections::HashMap;

/// Which preview a drawing stage's commands go to, if it has one.
fn preview_of(source: crate::draw::Source) -> Option<usize> {
    use crate::draw::Source;
    match source {
        Source::Wave(i) => Some(4 + i),
        Source::Shape(i) => Some(8 + i),
        Source::Basic => Some(12),
        Source::Motion => Some(13),
        Source::Border(_) => Some(14),
        Source::Darken => None,
    }
}

/// Waves, shapes, borders: flat colour, or a textured shape sampling last frame.
pub(super) const DRAW: &str = "
struct In { @location(0) pos: vec2f, @location(1) color: vec4f, @location(2) uv: vec2f, @location(3) textured: f32 }
struct Out { @builtin(position) pos: vec4f, @location(0) color: vec4f, @location(1) uv: vec2f, @location(2) textured: f32 }
@vertex fn vs(v: In) -> Out {
  var o: Out;
  o.pos = vec4f(v.pos.x, -v.pos.y, 0.0, 1.0);
  o.color = v.color;
  o.uv = v.uv;
  o.textured = v.textured;
  return o;
}
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(i: Out) -> @location(0) vec4f {
  let sampled = textureSample(tex, smp, i.uv) * i.color;
  return select(i.color, sampled, i.textured > 0.5);
}";

impl Renderer {
    pub(super) fn draw_pipeline(&mut self, topology: Topology, blend: Blend) -> &wgpu::RenderPipeline {
        let device = &self.device;
        let shader = &self.draw_shader;
        self.draw_pipelines.entry((topology, blend)).or_insert_with(|| {
            let component = wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: match blend {
                    Blend::Alpha => wgpu::BlendFactor::OneMinusSrcAlpha,
                    Blend::Additive => wgpu::BlendFactor::One,
                },
                operation: wgpu::BlendOperation::Add,
            };
            let attributes = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4, 2 => Float32x2, 3 => Float32];
            let buffers = [Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &attributes })];
            let topology = match topology {
                Topology::Triangles => wgpu::PrimitiveTopology::TriangleList,
                Topology::Lines => wgpu::PrimitiveTopology::LineList,
                Topology::LineStrip => wgpu::PrimitiveTopology::LineStrip,
                Topology::Points => wgpu::PrimitiveTopology::PointList,
            };
            let target = wgpu::ColorTargetState { format: FORMAT, blend: Some(wgpu::BlendState { color: component, alpha: component }), write_mask: wgpu::ColorWrites::ALL };
            pipeline(device, Some("draw"), (shader, "vs", &buffers), topology, (shader, "fs"), target)
        })
    }

    /// The step's waves, shapes and the rest, with their equations run once,
    /// uploaded for every [`Renderer::draw`] until the next step.
    pub(super) fn build_draw(&mut self, frame: &crate::runtime::Frame, audio: &Audio) {
        let size = self.size;
        let globals = Runner::globals(frame, &size);
        // The drawing in the feedback becomes the one the refreshes before this step start from.
        std::mem::swap(&mut self.shown_list, &mut self.draw_list);
        let mut list = std::mem::take(&mut self.draw_list);
        crate::draw::frame(self.runner.as_mut().unwrap(), audio, &self.uvs, &globals, &size, &mut list);
        upload(&self.device, &self.queue, &list, &mut self.draw_buffer);
        for cmd in &list.cmds {
            self.draw_pipeline(cmd.topology, cmd.blend);
        }
        self.draw_list = list;
    }

    /// Draw `list`, uploaded to `vertices`, into `target` over what is there,
    /// textured shapes sampling `previous`. With `previews`, each drawing stage's
    /// own preview too.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn draw(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        list: &DrawList,
        vertices: Option<&(wgpu::Buffer, usize)>,
        target: &wgpu::TextureView,
        previous: &wgpu::TextureView,
        wrap: bool,
        previews: bool,
    ) {
        // Every drawing stage's preview starts black: one that drew nothing this
        // step shows nothing, not what it drew last.
        if let (true, Some(previews)) = (previews, &self.previews) {
            for p in &previews[4..] {
                drop(begin(encoder, &p.view, true));
            }
        }
        let Some((vertices, _)) = vertices.filter(|_| !list.cmds.is_empty()) else { return };
        let sampler = self.samplers.linear(wrap);
        let mut groups = HashMap::new();
        for cmd in &list.cmds {
            let pipeline = &self.draw_pipelines[&(cmd.topology, cmd.blend)];
            groups
                .entry((cmd.topology, cmd.blend))
                .or_insert_with(|| bind(&self.device, pipeline, &[wgpu::BindingResource::TextureView(previous), wgpu::BindingResource::Sampler(sampler)]));
        }
        {
            let mut pass = begin(encoder, target, false);
            pass.set_vertex_buffer(0, vertices.slice(..));
            for cmd in &list.cmds {
                pass.set_pipeline(&self.draw_pipelines[&(cmd.topology, cmd.blend)]);
                pass.set_bind_group(0, &groups[&(cmd.topology, cmd.blend)], &[]);
                pass.draw(cmd.first..cmd.first + cmd.count, 0..1);
            }
        }
        // Each drawing stage again, alone, into its own preview. The vertices are in
        // clip space, so they land the same in a small target as in the big one.
        if let (true, Some(previews)) = (previews, &self.previews) {
            for (which, target) in previews.iter().enumerate().skip(4) {
                let mine: Vec<&crate::draw::Cmd> = list.cmds.iter().filter(|c| preview_of(c.source) == Some(which)).collect();
                if mine.is_empty() {
                    continue;
                }
                let mut pass = begin(encoder, &target.view, false);
                pass.set_vertex_buffer(0, vertices.slice(..));
                for cmd in mine {
                    pass.set_pipeline(&self.draw_pipelines[&(cmd.topology, cmd.blend)]);
                    pass.set_bind_group(0, &groups[&(cmd.topology, cmd.blend)], &[]);
                    pass.draw(cmd.first..cmd.first + cmd.count, 0..1);
                }
            }
        }
    }
}

/// `list`'s vertices into `buffer`, grown to fit.
pub(super) fn upload(device: &wgpu::Device, queue: &wgpu::Queue, list: &DrawList, buffer: &mut Option<(wgpu::Buffer, usize)>) {
    if list.cmds.is_empty() {
        return;
    }
    let bytes: &[u8] = bytemuck::cast_slice(&list.vertices);
    if buffer.as_ref().is_none_or(|(_, cap)| *cap < bytes.len()) {
        let capacity = bytes.len().next_power_of_two().max(4096);
        let made = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("draw"),
            size: capacity as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        *buffer = Some((made, capacity));
    }
    queue.write_buffer(&buffer.as_ref().unwrap().0, 0, bytes);
}
