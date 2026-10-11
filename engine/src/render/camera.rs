//! Opt-in external RGBA imagery, injected inside the recursive feedback.
use super::gpu::{begin, bind, pipeline};
use super::{Renderer, FORMAT};

pub(super) struct Camera {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    pipeline: wgpu::RenderPipeline,
    mix: f32,
}

impl Renderer {
    /// Upload top-to-bottom, tightly packed RGBA8. Alpha is ignored. Mix is the
    /// fresh image's share per preset step (0..=1). No GPU resources or passes
    /// are added until this is called; `None` is the ordinary MilkDrop path.
    pub fn set_camera_frame(&mut self, width: u32, height: u32, rgba: &[u8], mix: f32) -> Result<(), &'static str> {
        if width == 0 || height == 0 || width > 1920 || height > 1080 || rgba.len() != width as usize * height as usize * 4 || !mix.is_finite() || !(0.0..=1.0).contains(&mix) {
            return Err("camera expects RGBA8 up to 1920x1080 and a finite mix in 0..=1");
        }
        if self.camera.as_ref().is_none_or(|c| c.texture.width() != width || c.texture.height() != height) {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("camera input"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            // Keep the input row order through injection. The preset comp and
            // final presentation establish the displayed orientation together.
            let shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("camera injection"), source: wgpu::ShaderSource::Wgsl(super::output::CARRY.into()) });
            let blend = wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Constant, dst_factor: wgpu::BlendFactor::OneMinusConstant, operation: wgpu::BlendOperation::Add };
            let pipeline = pipeline(
                &self.device,
                Some("camera injection"),
                (&shader, "vs", &[]),
                wgpu::PrimitiveTopology::TriangleStrip,
                (&shader, "fs"),
                wgpu::ColorTargetState { format: FORMAT, blend: Some(wgpu::BlendState { color: blend, alpha: wgpu::BlendComponent::REPLACE }), write_mask: wgpu::ColorWrites::ALL },
            );
            self.camera = Some(Camera { texture, view, pipeline, mix });
        }
        let camera = self.camera.as_mut().unwrap();
        camera.mix = mix;
        self.queue.write_texture(
            camera.texture.as_image_copy(),
            rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        Ok(())
    }

    /// Release the external source. Its existing trails remain until `clear`.
    pub fn clear_camera(&mut self) {
        self.camera = None;
    }

    pub(super) fn inject_camera(&self, encoder: &mut wgpu::CommandEncoder, into: &wgpu::TextureView, fraction: f32) {
        let Some(camera) = &self.camera else { return };
        let k = (camera.mix * fraction) as f64;
        if k == 0.0 {
            return;
        }
        let group = bind(&self.device, &camera.pipeline, &[wgpu::BindingResource::TextureView(&camera.view), wgpu::BindingResource::Sampler(&self.samplers.linear_clamp)]);
        let mut pass = begin(encoder, into, false);
        pass.set_pipeline(&camera.pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.set_blend_constant(wgpu::Color { r: k, g: k, b: k, a: k });
        pass.draw(0..4, 0..1);
    }
}
