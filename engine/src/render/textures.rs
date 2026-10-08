use super::Renderer;
use std::sync::OnceLock;

pub(super) fn texture(device: &wgpu::Device, queue: &wgpu::Queue, data: &[u8], size: u32, depth: u32) -> wgpu::TextureView {
    let dimension = if depth > 1 { wgpu::TextureDimension::D3 } else { wgpu::TextureDimension::D2 };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("noise"),
        size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: depth },
        mip_level_count: 1,
        sample_count: 1,
        dimension,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        texture.as_image_copy(),
        data,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size * 4), rows_per_image: Some(size) },
        wgpu::Extent3d { width: size, height: size, depth_or_array_layers: depth },
    );
    texture.create_view(&Default::default())
}

/// MilkDrop's six noise textures: name, side, zoom (how many texels each random
/// value spans) and whether it is a volume (as deep as it is wide). All are drawn
/// from one rng, in this order.
pub(super) const NOISE: [(&str, u32, usize, bool); 6] = [
    ("noise_lq", 256, 1, false),
    ("noise_lq_lite", 32, 1, false),
    ("noise_mq", 256, 4, false),
    ("noise_hq", 256, 8, false),
    ("noisevol_lq", 32, 1, true),
    ("noisevol_hq", 32, 4, true),
];

/// The [`NOISE`] textures, as RGBA with their names, sides and depths, all drawn
/// from one rng seeded `0x5eed`; and that rng, to go on with (`rand_frame`).
pub(super) fn noise_data() -> (Vec<(&'static str, Vec<u8>, u32, u32)>, crate::eel::Memory) {
    let mut rng = crate::eel::Memory::new(0x5eed);
    let noise = NOISE
        .iter()
        .map(|&(name, side, zoom, volume)| match volume {
            false => (name, crate::noise::texture_2d(side as usize, zoom, &mut rng), side, 1),
            true => (name, crate::noise::texture_3d(side as usize, zoom, &mut rng), side, side),
        })
        .collect();
    (noise, rng)
}

/// The `texsize_noise*` uniforms: each [`NOISE`] texture's side, and its inverse.
pub(super) fn noise_texsizes() -> impl Iterator<Item = (&'static str, Vec<f32>)> {
    static NAMES: OnceLock<Vec<String>> = OnceLock::new();
    let names = NAMES.get_or_init(|| NOISE.iter().map(|(name, ..)| format!("texsize_{name}")).collect());
    names.iter().zip(NOISE).map(|(uniform, (_, side, ..))| {
        let side = side as f32;
        (uniform.as_str(), vec![side, side, 1.0 / side, 1.0 / side])
    })
}

/// Butterchurn's `clouds2` image, as RGBA.
pub(super) fn clouds() -> Vec<u8> {
    let mut decoder = jpeg_decoder::Decoder::new(&include_bytes!("../../assets/clouds2.jpg")[..]);
    let rgb = decoder.decode().expect("clouds2.jpg decodes");
    rgb.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect()
}

impl Renderer {
    /// The texture a preset shader's sampler name reads.
    /// `between` picks the blur of the picture between steps over the step's own.
    pub(super) fn texture_for<'a>(&'a self, name: &str, previous: &'a wgpu::TextureView, between: bool) -> &'a wgpu::TextureView {
        let short = name.trim_start_matches("sampler_");
        let blur = if between { &self.display_blur } else { &self.blur };
        match short {
            "main" | "fw_main" | "fc_main" | "pw_main" | "pc_main" => previous,
            "blur1" => &blur[0].1.view,
            "blur2" => &blur[1].1.view,
            "blur3" => &blur[2].1.view,
            "pw_noise_lq" => &self.textures["noise_lq"],
            noise if NOISE.iter().any(|&(name, ..)| name == noise) => &self.textures[noise],
            _ => &self.textures["image"],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::NOISE;
    use crate::shader::{TEXTURES_2D, TEXTURES_3D};

    #[test]
    fn every_noise_texture_is_a_sampler_shaders_can_read() {
        for (name, _, _, volume) in NOISE {
            let samplers = if volume { TEXTURES_3D } else { TEXTURES_2D };
            assert!(samplers.contains(&format!("sampler_{name}").as_str()), "{name}");
        }
    }
}
