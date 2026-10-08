use super::Renderer;

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

/// MilkDrop's six noise textures, as RGBA with their names, sizes and depths,
/// all drawn from one rng seeded `0x5eed`, in this order; and that rng, to go on
/// with (`rand_frame`).
pub(super) fn noise_data() -> (Vec<(&'static str, Vec<u8>, u32, u32)>, crate::eel::Memory) {
    let mut rng = crate::eel::Memory::new(0x5eed);
    let noise = vec![
        ("noise_lq", crate::noise::texture_2d(256, 1, &mut rng), 256, 1),
        ("noise_lq_lite", crate::noise::texture_2d(32, 1, &mut rng), 32, 1),
        ("noise_mq", crate::noise::texture_2d(256, 4, &mut rng), 256, 1),
        ("noise_hq", crate::noise::texture_2d(256, 8, &mut rng), 256, 1),
        ("noisevol_lq", crate::noise::texture_3d(32, 1, &mut rng), 32, 32),
        ("noisevol_hq", crate::noise::texture_3d(32, 4, &mut rng), 32, 32),
    ];
    (noise, rng)
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
            "noise_lq" | "pw_noise_lq" => &self.textures["noise_lq"],
            "noise_lq_lite" => &self.textures["noise_lq_lite"],
            "noise_mq" => &self.textures["noise_mq"],
            "noise_hq" => &self.textures["noise_hq"],
            "noisevol_lq" => &self.textures["noisevol_lq"],
            "noisevol_hq" => &self.textures["noisevol_hq"],
            _ => &self.textures["image"],
        }
    }
}
