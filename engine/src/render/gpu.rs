use super::FORMAT;

pub(super) struct Target {
    texture: wgpu::Texture,
    pub(super) view: wgpu::TextureView,
    pub(super) size: (u32, u32),
}

impl Target {
    pub(super) fn new(device: &wgpu::Device, size: (u32, u32), label: &str) -> Self {
        Self::of(device, size, label, FORMAT)
    }

    pub(super) fn of(device: &wgpu::Device, (w, h): (u32, u32), label: &str, format: wgpu::TextureFormat) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self { texture, view, size: (w, h) }
    }

    /// This whole picture into `to`, which is the same size.
    pub(super) fn copy_to(&self, encoder: &mut wgpu::CommandEncoder, to: &Target) {
        let (width, height) = self.size;
        encoder.copy_texture_to_texture(self.texture.as_image_copy(), to.texture.as_image_copy(), wgpu::Extent3d { width, height, depth_or_array_layers: 1 });
    }
}

/// `targets`' pixels as RGBA rows, one picture after another, through one staging
/// buffer; every target is the size of the first. Rows come top to bottom of the
/// texture, or bottom to top with `flip`. None when the buffer will not map. Waits
/// for the GPU.
pub(super) fn read_targets(device: &wgpu::Device, queue: &wgpu::Queue, targets: &[&Target], flip: bool) -> Option<Vec<u8>> {
    let (w, h) = targets.first()?.size;
    let row = (w * 4).div_ceil(256) * 256;
    let each = (row * h) as u64;
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("read back"),
        size: each * targets.len() as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    for (i, t) in targets.iter().enumerate() {
        encoder.copy_texture_to_buffer(
            t.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &staging,
                layout: wgpu::TexelCopyBufferLayout { offset: each * i as u64, bytes_per_row: Some(row), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
    }
    queue.submit([encoder.finish()]);
    let slice = staging.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::PollType::wait_indefinitely()).ok();
    let data = slice.get_mapped_range().ok()?;
    let mut out = Vec::with_capacity((w * h * 4) as usize * targets.len());
    for i in 0..targets.len() {
        for y in 0..h {
            let y = if flip { h - 1 - y } else { y };
            let at = (each * i as u64) as usize + (y * row) as usize;
            out.extend_from_slice(&data[at..at + (w * 4) as usize]);
        }
    }
    Some(out)
}

/// A grid of `(gx+1) × (gy+1)` vertices over clip space, as Butterchurn's
/// `buildPositions`: `(x, -y)`, and two triangles per cell.
pub(super) fn grid(gx: usize, gy: usize) -> (Vec<[f32; 2]>, Vec<u32>) {
    let mut vertices = Vec::new();
    for iy in 0..=gy {
        let y = iy as f32 * 2.0 / gy as f32 - 1.0;
        for ix in 0..=gx {
            let x = ix as f32 * 2.0 / gx as f32 - 1.0;
            vertices.push([x, -y]);
        }
    }
    let mut indices = Vec::new();
    let w = (gx + 1) as u32;
    for iy in 0..gy as u32 {
        for ix in 0..gx as u32 {
            let (a, b, c, d) = (ix + w * iy, ix + w * (iy + 1), ix + 1 + w * (iy + 1), ix + 1 + w * iy);
            indices.extend([a, b, d, b, c, d]);
        }
    }
    (vertices, indices)
}

/// The four samplers MilkDrop's names pick from: filtered or point-sampled,
/// wrapping or clamped.
pub(super) struct Samplers {
    pub(super) linear_wrap: wgpu::Sampler,
    pub(super) linear_clamp: wgpu::Sampler,
    pub(super) point_wrap: wgpu::Sampler,
    pub(super) point_clamp: wgpu::Sampler,
}

impl Samplers {
    pub(super) fn new(device: &wgpu::Device) -> Self {
        let sampler = |linear: bool, wrap: bool| {
            let filter = if linear { wgpu::FilterMode::Linear } else { wgpu::FilterMode::Nearest };
            let address = if wrap { wgpu::AddressMode::Repeat } else { wgpu::AddressMode::ClampToEdge };
            device.create_sampler(&wgpu::SamplerDescriptor {
                address_mode_u: address,
                address_mode_v: address,
                address_mode_w: address,
                mag_filter: filter,
                min_filter: filter,
                ..Default::default()
            })
        };
        Self { linear_wrap: sampler(true, true), linear_clamp: sampler(true, false), point_wrap: sampler(false, true), point_clamp: sampler(false, false) }
    }

    /// The filtered sampler, wrapping or clamped.
    pub(super) fn linear(&self, wrap: bool) -> &wgpu::Sampler {
        if wrap {
            &self.linear_wrap
        } else {
            &self.linear_clamp
        }
    }
}

/// A render pipeline with wgpu's automatic layout (bind group 0 as the shaders
/// use it): `vertex`'s entry point and buffers, `topology`, and `fragment`'s
/// entry point drawing into `target`.
pub(super) fn pipeline(
    device: &wgpu::Device,
    label: Option<&str>,
    (vs, vs_entry, buffers): (&wgpu::ShaderModule, &str, &[Option<wgpu::VertexBufferLayout>]),
    topology: wgpu::PrimitiveTopology,
    (fs, fs_entry): (&wgpu::ShaderModule, &str),
    target: wgpu::ColorTargetState,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label,
        layout: None,
        vertex: wgpu::VertexState { module: vs, entry_point: Some(vs_entry), compilation_options: Default::default(), buffers },
        primitive: wgpu::PrimitiveState { topology, ..Default::default() },
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState { module: fs, entry_point: Some(fs_entry), compilation_options: Default::default(), targets: &[Some(target)] }),
        multiview_mask: None,
        cache: None,
    })
}

/// A full-screen quad's pipeline: `shader`'s `vs` draws a four-vertex strip from
/// the vertex index, and `entry` fills it into `format`, unblended.
pub(super) fn quad(device: &wgpu::Device, label: &str, shader: &wgpu::ShaderModule, entry: &str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
    pipeline(device, Some(label), (shader, "vs", &[]), wgpu::PrimitiveTopology::TriangleStrip, (shader, entry), format.into())
}

/// A bind group for `pipeline`'s group 0, with `resources` at bindings 0, 1, 2…
pub(super) fn bind(device: &wgpu::Device, pipeline: &wgpu::RenderPipeline, resources: &[wgpu::BindingResource]) -> wgpu::BindGroup {
    let entries: Vec<wgpu::BindGroupEntry> = resources.iter().enumerate().map(|(i, r)| wgpu::BindGroupEntry { binding: i as u32, resource: r.clone() }).collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipeline.get_bind_group_layout(0), entries: &entries })
}

/// A [`quad`] pipeline's pass: `target` cleared to black, then the quad drawn
/// into it with `group`.
pub(super) fn quad_pass(encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, pipeline: &wgpu::RenderPipeline, group: &wgpu::BindGroup) {
    let mut pass = begin(encoder, target, true);
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, group, &[]);
    pass.draw(0..4, 0..1);
}

pub(super) fn buffer(device: &wgpu::Device, contents: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    use wgpu::util::DeviceExt;
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents, usage: usage | wgpu::BufferUsages::COPY_DST })
}

pub(super) fn begin<'a>(encoder: &'a mut wgpu::CommandEncoder, view: &'a wgpu::TextureView, clear: bool) -> wgpu::RenderPass<'a> {
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations {
                load: if clear { wgpu::LoadOp::Clear(wgpu::Color::BLACK) } else { wgpu::LoadOp::Load },
                store: wgpu::StoreOp::Store,
            },
        })],
        ..Default::default()
    })
}
