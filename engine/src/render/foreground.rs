//! Nonrecursive camera foreground, shared by every presentation surface.
use super::{drawing, gpu, Renderer, Target, FORMAT};
use crate::contours::{Contours, Point};
use crate::draw::{Blend, DrawList, Topology};
use std::collections::HashMap;

/// An atomic external camera update. Pixels are straight-alpha RGBA, top row first.
pub struct CameraLayers {
    pub contours: Contours,
    pub rgba: Vec<u8>,
    pub camera_opacity: f32,
    pub outline_opacity: f32,
    pub outline_width: f32,
    pub interpolation_ms: f32,
    pub source_epoch: u32,
}

pub(super) struct Foreground {
    image: Target,
    composite: Target,
    outgoing: Target,
    pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    motion: Motion,
    opacity: f32,
    width: f32,
    epoch: u32,
    list: DrawList,
    vertices: Option<(wgpu::Buffer, usize)>,
    prepared: bool,
}

/// Target topology is authoritative. Each target vertex starts from a nearby
/// segment of the currently displayed shape; path order has no significance.
struct Motion {
    from: Contours,
    target: Contours,
    age: f32,
    duration: f32,
}
impl Motion {
    fn new(target: Contours) -> Self {
        Self { from: target.clone(), target, age: 0.0, duration: 0.0 }
    }
    fn sample(&self) -> Contours {
        let mut result = self.target.clone();
        let t = if self.duration > 0.0 { (self.age / self.duration).clamp(0.0, 1.0) } else { 1.0 };
        let t = t * t * (3.0 - 2.0 * t);
        for (path, from) in result.paths.iter_mut().zip(&self.from.paths) {
            for (p, a) in path.points.iter_mut().zip(&from.points) {
                p.x = a.x + (p.x - a.x) * t;
                p.y = a.y + (p.y - a.y) * t;
            }
        }
        result
    }
    fn update(&mut self, target: Contours, duration: f32) {
        let shown = self.sample();
        let index = Segments::new(&shown);
        let mut from = target.clone();
        for path in &mut from.paths {
            for p in &mut path.points {
                if let Some((x, y)) = index.nearest(p) {
                    p.x = x;
                    p.y = y;
                }
            }
        }
        *self = Self { from, target, age: 0.0, duration };
    }
}

/// Fixed 6px correspondence radius, 64 candidates per cell and 8192 segments.
/// Segment sampling bounds both construction and lookup even for long diagonals.
struct Segments {
    segments: Vec<(Point, Point)>,
    cells: HashMap<(i32, i32), Vec<usize>>,
}
impl Segments {
    fn new(contours: &Contours) -> Self {
        let mut out = Self { segments: vec![], cells: HashMap::new() };
        for path in &contours.paths {
            let n = path.points.len();
            for i in 0..n.saturating_sub(1) + usize::from(path.closed) {
                let a = path.points[i % n].clone();
                let b = path.points[(i + 1) % n].clone();
                let id = out.segments.len();
                let steps = ((b.x - a.x).abs().max((b.y - a.y).abs()) / 6.0).ceil() as usize;
                for step in 0..=steps {
                    let t = step as f32 / steps.max(1) as f32;
                    let x = ((a.x + (b.x - a.x) * t) / 6.0).floor() as i32;
                    let y = ((a.y + (b.y - a.y) * t) / 6.0).floor() as i32;
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let ids = out.cells.entry((x + dx, y + dy)).or_default();
                            if ids.len() < 64 && ids.last() != Some(&id) {
                                ids.push(id);
                            }
                        }
                    }
                }
                out.segments.push((a, b));
            }
        }
        out
    }
    fn nearest(&self, p: &Point) -> Option<(f32, f32)> {
        let ids = self.cells.get(&((p.x / 6.0).floor() as i32, (p.y / 6.0).floor() as i32))?;
        let mut best = 36.0;
        let mut found = None;
        for &id in ids {
            let (a, b) = &self.segments[id];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy).max(0.00001)).clamp(0.0, 1.0);
            let x = a.x + t * dx;
            let y = a.y + t * dy;
            let d = (p.x - x).powi(2) + (p.y - y).powi(2);
            if d < best {
                best = d;
                found = Some((x, y));
            }
        }
        found
    }
}

const PHOTO: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
 let p=vec2f(f32(i&1u)*2.0-1.0,f32(i>>1u)*2.0-1.0);
 var o:Out;o.pos=vec4f(p,0.0,1.0);o.uv=p*0.5+0.5;return o;
}
@group(0) @binding(0) var tex:texture_2d<f32>;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var<uniform> opacity:vec4f;
@fragment fn fs(o:Out)->@location(0) vec4f {let c=textureSample(tex,smp,o.uv);return vec4f(c.rgb,c.a*opacity.x);}";

impl Renderer {
    /// Accept photo and waveform geometry together; neither opacity controls feed strength.
    pub fn set_camera_layers(&mut self, frame: CameraLayers) -> Result<(), &'static str> {
        frame.contours.validate()?;
        let unit = |v: f32| v.is_finite() && (0.0..=1.0).contains(&v);
        if frame.rgba.len() != frame.contours.width as usize * frame.contours.height as usize * 4
            || !unit(frame.camera_opacity)
            || !unit(frame.outline_opacity)
            || !frame.outline_width.is_finite()
            || !(0.25..=4.0).contains(&frame.outline_width)
            || !frame.interpolation_ms.is_finite()
            || !(0.0..=100.0).contains(&frame.interpolation_ms)
        {
            return Err("invalid camera layers");
        }
        let size = (frame.contours.width, frame.contours.height);
        let reset = self.foreground.as_ref().is_none_or(|f| f.image.size != size || f.epoch != frame.source_epoch);
        if reset {
            self.clear_camera();
            let shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("camera foreground"), source: wgpu::ShaderSource::Wgsl(PHOTO.into()) });
            let pipeline = gpu::pipeline(
                &self.device,
                Some("camera foreground"),
                (&shader, "vs", &[]),
                wgpu::PrimitiveTopology::TriangleStrip,
                (&shader, "fs"),
                wgpu::ColorTargetState { format: FORMAT, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL },
            );
            self.foreground = Some(Foreground {
                image: Target::new(&self.device, size, "person image"),
                composite: Target::new(&self.device, self.comp.size, "person composite"),
                outgoing: Target::new(&self.device, self.comp.size, "person outgoing"),
                pipeline,
                uniform: gpu::buffer(&self.device, &[0; 16], wgpu::BufferUsages::UNIFORM),
                motion: Motion::new(frame.contours.clone()),
                opacity: frame.outline_opacity,
                width: frame.outline_width,
                epoch: frame.source_epoch,
                list: DrawList::default(),
                vertices: None,
                prepared: false,
            });
        }
        let f = self.foreground.as_mut().unwrap();
        if !reset {
            f.motion.update(frame.contours.clone(), frame.interpolation_ms / 1000.0);
        }
        f.prepared = false;
        f.opacity = frame.outline_opacity;
        f.width = frame.outline_width;
        self.queue.write_texture(
            f.image.texture.as_image_copy(),
            &frame.rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size.0 * 4), rows_per_image: Some(size.1) },
            wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
        );
        self.queue.write_buffer(&f.uniform, 0, bytemuck::cast_slice(&[frame.camera_opacity, 0.0, 0.0, 0.0]));
        self.set_contours(frame.contours)?;
        Ok(())
    }
    /// Advance once per real display tick, independent of preset speed and how
    /// many windows present. Caller supplies real seconds, not preset seconds.
    pub fn advance_camera(&mut self, seconds: f32) {
        let Some(mut f) = self.foreground.take() else { return };
        f.motion.age += (if seconds.is_finite() { seconds.max(0.0) } else { 0.0 }).min(0.25);
        let mut contour = f.motion.sample();
        contour.mix = f.opacity;
        f.list.clear();
        contour.draw_width(&self.size, 1.0, &mut f.list, Some(f.width));
        // Comp is stored upside down until the master pass. Feedback geometry
        // has its own preset comp transform; foreground bypasses that transform.
        for v in &mut f.list.vertices {
            v.pos[1] = -v.pos[1];
        }
        for cmd in &mut f.list.cmds {
            cmd.blend = Blend::Alpha;
        }
        drawing::upload(&self.device, &self.queue, &f.list, &mut f.vertices);
        self.draw_pipeline(Topology::Triangles, Blend::Alpha);
        f.prepared = true;
        self.foreground = Some(f);
    }
    /// Stop emission/foreground while retaining external waveform mode and trails.
    pub fn expire_camera_layers(&mut self) {
        self.foreground = None;
        if let Some(mut contours) = self.contours.take() {
            contours.paths.clear();
            let _ = self.set_contours(contours);
        }
    }
    /// Release only the camera; preset audio, timing, effects and feedback survive.
    pub fn clear_camera_layers(&mut self) {
        self.foreground = None;
        self.clear_camera();
    }
    pub(super) fn composite_camera(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if self.foreground.as_ref().is_some_and(|f| !f.prepared) {
            self.advance_camera(0.0);
        }
        let Some(mut f) = self.foreground.take() else { return };
        if f.composite.size != self.comp.size {
            f.composite = Target::new(&self.device, self.comp.size, "person composite");
            f.outgoing = Target::new(&self.device, self.comp.size, "person outgoing");
        }
        let group =
            gpu::bind(&self.device, &f.pipeline, &[wgpu::BindingResource::TextureView(&f.image.view), wgpu::BindingResource::Sampler(&self.samplers.linear_clamp), f.uniform.as_entire_binding()]);
        for (i, (source, target)) in [(&self.comp, &f.composite), (&self.outgoing, &f.outgoing)].into_iter().enumerate() {
            if i == 1 && self.master.fade == 0.0 {
                continue;
            }
            source.copy_to(encoder, target);
            {
                let mut pass = gpu::begin(encoder, &target.view, false);
                pass.set_pipeline(&f.pipeline);
                pass.set_bind_group(0, &group, &[]);
                pass.draw(0..4, 0..1);
            }
            self.draw(encoder, &f.list, f.vertices.as_ref(), &target.view, &source.view, false, false);
        }
        self.foreground = Some(f);
    }
    pub(super) fn presented_sources(&self) -> (&wgpu::TextureView, &wgpu::TextureView) {
        match &self.foreground {
            Some(f) => (&f.composite.view, &f.outgoing.view),
            None => (&self.comp.view, &self.outgoing.view),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(y: f32) -> Contours {
        Contours {
            width: 100,
            height: 100,
            mix: 1.0,
            color: None,
            paths: vec![crate::contours::Path { closed: false, points: vec![Point { x: 10.0, y, color: None }, Point { x: 20.0, y, color: None }] }],
        }
    }
    #[test]
    fn spatial_interpolation_is_bounded_and_ignores_path_order() {
        let mut m = Motion::new(line(10.0));
        m.update(line(14.0), 0.08);
        assert_eq!(m.sample().paths[0].points[0].y, 10.0);
        m.age = 0.04;
        assert!((m.sample().paths[0].points[0].y - 12.0).abs() < 0.001);
        m.update(line(50.0), 0.08);
        assert_eq!(m.sample().paths[0].points[0].y, 50.0);
        let mut empty = line(0.0);
        empty.paths.clear();
        m.update(empty, 0.08);
        assert!(m.sample().paths.is_empty());
    }
}
