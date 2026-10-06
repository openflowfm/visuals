//! The frame, drawn: warp, blur, comp — on wgpu, which is Metal on a Mac.
//!
//! A port of Butterchurn's `Renderer.render` and the shaders it drives. The
//! preset's own warp and comp shaders come from [`crate::shader`] as naga modules;
//! everything around them — the meshes, the blur, the blit to the window — is
//! WGSL written here.
//!
//! **Orientation.** Butterchurn is WebGL, where texture row 0 is the bottom of the
//! picture. Every vertex shader here negates y, so a texture drawn here has row 0
//! at the bottom too, and all of Butterchurn's texture-coordinate arithmetic ports
//! unchanged. Only the blit to the window turns the picture the right way up.

use crate::audio::Audio;
use crate::draw::{Blend, DrawList, Topology, Vertex};
use crate::runtime::{Clock, Runner, Size};
use crate::shader::{self, Kind};
use std::borrow::Cow;
use std::collections::HashMap;

/// What the feedback loop is stored in. Butterchurn's targets are 8-bit RGBA.
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const BLUR_RATIOS: [[f64; 2]; 3] = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]];
const COMP_GRID: (usize, usize) = (32, 24);

struct Target {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    size: (u32, u32),
}

impl Target {
    fn new(device: &wgpu::Device, (w, h): (u32, u32), label: &str) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self { texture, view, size: (w, h) }
    }
}

/// One of the preset's two shaders, compiled into a pipeline, with what its
/// uniforms and textures are called.
struct Stage {
    pipeline: wgpu::RenderPipeline,
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

/// What loading a preset did, for the caller to say.
#[derive(Debug, Default)]
pub struct Loaded {
    /// Shaders that would not compile and draw MilkDrop's default instead.
    pub fell_back: Vec<(Kind, String)>,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    size: Size,
    feedback: [Target; 2],
    current: usize,
    comp: Target,
    blur: Vec<(Target, Target)>,
    textures: HashMap<&'static str, wgpu::TextureView>,
    samplers: HashMap<&'static str, wgpu::Sampler>,
    warp_vs: wgpu::ShaderModule,
    comp_vs: wgpu::ShaderModule,
    warp_positions: wgpu::Buffer,
    warp_uvs: wgpu::Buffer,
    warp_colors: wgpu::Buffer,
    warp_indices: (wgpu::Buffer, u32),
    comp_positions: wgpu::Buffer,
    comp_colors: wgpu::Buffer,
    comp_indices: (wgpu::Buffer, u32),
    blur_h: wgpu::RenderPipeline,
    blur_v: wgpu::RenderPipeline,
    blur_uniforms: Vec<(wgpu::Buffer, wgpu::Buffer)>,
    blits: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    blit_shader: wgpu::ShaderModule,
    draw_shader: wgpu::ShaderModule,
    draw_pipelines: HashMap<(Topology, Blend), wgpu::RenderPipeline>,
    draw_buffer: Option<(wgpu::Buffer, usize)>,
    draw_list: DrawList,
    warp: Option<Stage>,
    comp_stage: Option<Stage>,
    blur_passes: usize,
    pub runner: Option<Runner>,
    pub clock: Clock,
    uvs: Vec<[f32; 2]>,
    rng: crate::eel::Memory,
}

const WARP_VS: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) uv_orig: vec2f, @location(2) color: vec4f }
@vertex fn main(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) c: vec4f) -> Out {
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.uv = uv;
  o.uv_orig = p * 0.5 + 0.5;
  o.color = c;
  return o;
}";

const COMP_VS: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f }
@vertex fn main(@location(0) p: vec2f, @location(1) c: vec4f) -> Out {
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  o.color = c;
  return o;
}";

/// Butterchurn's two blur passes, as WGSL. A full-screen quad from the vertex index.
const BLUR: &str = "
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

/// Waves, shapes, borders: flat colour, or a textured shape sampling last frame.
const DRAW: &str = "
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

/// The finished picture to the window, the right way up.
const BLIT: &str = "
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

fn blur_size(size: &Size, ratio: f64) -> (u32, u32) {
    let x = (size.texsize_x * ratio).max(16.0);
    let y = (size.texsize_y * ratio).max(16.0);
    ((((x + 3.0) / 16.0).floor() * 16.0) as u32, (((y + 3.0) / 4.0).floor() * 4.0) as u32)
}

/// A grid of `(gx+1) × (gy+1)` vertices over clip space, as Butterchurn's
/// `buildPositions`: `(x, -y)`, and two triangles per cell.
fn grid(gx: usize, gy: usize) -> (Vec<[f32; 2]>, Vec<u32>) {
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

fn texture(device: &wgpu::Device, queue: &wgpu::Queue, data: &[u8], size: u32, depth: u32) -> wgpu::TextureView {
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

fn sampler(device: &wgpu::Device, linear: bool, wrap: bool) -> wgpu::Sampler {
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
}

fn buffer(device: &wgpu::Device, contents: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    use wgpu::util::DeviceExt;
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents, usage: usage | wgpu::BufferUsages::COPY_DST })
}

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, width: u32, height: u32) -> Self {
        let size = Size { texsize_x: width as f64, texsize_y: height as f64, mesh_width: 48, mesh_height: 36 };
        let mut rng = crate::eel::Memory::new(0x5eed);
        let mut textures = HashMap::new();
        textures.insert("noise_lq", texture(&device, &queue, &crate::noise::texture_2d(256, 1, &mut rng), 256, 1));
        textures.insert("noise_lq_lite", texture(&device, &queue, &crate::noise::texture_2d(32, 1, &mut rng), 32, 1));
        textures.insert("noise_mq", texture(&device, &queue, &crate::noise::texture_2d(256, 4, &mut rng), 256, 1));
        textures.insert("noise_hq", texture(&device, &queue, &crate::noise::texture_2d(256, 8, &mut rng), 256, 1));
        textures.insert("noisevol_lq", texture(&device, &queue, &crate::noise::texture_3d(32, 1, &mut rng), 32, 32));
        textures.insert("noisevol_hq", texture(&device, &queue, &crate::noise::texture_3d(32, 4, &mut rng), 32, 32));
        // Butterchurn's stand-in for a texture it does not have is a cloud
        // photograph; until that ships, smooth noise stands in for it.
        textures.insert("image", texture(&device, &queue, &crate::noise::texture_2d(256, 8, &mut rng), 256, 1));
        let mut samplers = HashMap::new();
        samplers.insert("linear_wrap", sampler(&device, true, true));
        samplers.insert("linear_clamp", sampler(&device, true, false));
        samplers.insert("point_wrap", sampler(&device, false, true));
        samplers.insert("point_clamp", sampler(&device, false, false));

        let wgsl = |source: &str| device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(Cow::Owned(source.to_owned())) });
        let warp_vs = wgsl(WARP_VS);
        let comp_vs = wgsl(COMP_VS);
        let blur_shader = wgsl(BLUR);
        let blit_shader = wgsl(BLIT);
        let draw_shader = wgsl(DRAW);
        let fullscreen = |entry: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: None,
                vertex: wgpu::VertexState { module: &blur_shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &blur_shader,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(FORMAT.into())],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let blur_h = fullscreen("horizontal");
        let blur_v = fullscreen("vertical");

        let (warp_grid, warp_index) = grid(size.mesh_width, size.mesh_height);
        let (comp_grid, comp_index) = grid(COMP_GRID.0, COMP_GRID.1);
        let vertex = wgpu::BufferUsages::VERTEX;
        let warp_positions = buffer(&device, bytemuck::cast_slice(&warp_grid), vertex);
        let warp_uvs = buffer(&device, bytemuck::cast_slice(&vec![[0f32; 2]; warp_grid.len()]), vertex);
        let warp_colors = buffer(&device, bytemuck::cast_slice(&vec![[1f32; 4]; warp_grid.len()]), vertex);
        let warp_indices = (buffer(&device, bytemuck::cast_slice(&warp_index), wgpu::BufferUsages::INDEX), warp_index.len() as u32);
        let comp_positions = buffer(&device, bytemuck::cast_slice(&comp_grid), vertex);
        let comp_colors = buffer(&device, bytemuck::cast_slice(&vec![[1f32; 4]; comp_grid.len()]), vertex);
        let comp_indices = (buffer(&device, bytemuck::cast_slice(&comp_index), wgpu::BufferUsages::INDEX), comp_index.len() as u32);

        let full = (width, height);
        let blur = (0..3)
            .map(|i| {
                let ratios = BLUR_RATIOS[i];
                (Target::new(&device, blur_size(&size, ratios[0]), "blur h"), Target::new(&device, blur_size(&size, ratios[1]), "blur v"))
            })
            .collect();
        let blur_uniforms = (0..3)
            .map(|_| {
                let u = wgpu::BufferUsages::UNIFORM;
                (buffer(&device, &[0u8; 64], u), buffer(&device, &[0u8; 48], u))
            })
            .collect();
        let mut renderer = Self {
            feedback: [Target::new(&device, full, "feedback a"), Target::new(&device, full, "feedback b")],
            current: 0,
            comp: Target::new(&device, full, "comp"),
            blur,
            textures,
            samplers,
            warp_vs,
            comp_vs,
            warp_positions,
            warp_uvs,
            warp_colors,
            warp_indices,
            comp_positions,
            comp_colors,
            comp_indices,
            blur_h,
            blur_v,
            blur_uniforms,
            blits: HashMap::new(),
            blit_shader,
            draw_shader,
            draw_pipelines: HashMap::new(),
            draw_buffer: None,
            draw_list: DrawList::default(),
            warp: None,
            comp_stage: None,
            blur_passes: 0,
            runner: None,
            clock: Clock::default(),
            uvs: Vec::new(),
            rng,
            size,
            device,
            queue,
        };
        renderer.warp = Some(renderer.stage(Kind::Warp, shader::DEFAULT_WARP).expect("default warp"));
        renderer.comp_stage = Some(renderer.stage(Kind::Comp, shader::DEFAULT_COMP).expect("default comp"));
        renderer
    }

    pub fn size(&self) -> Size {
        self.size
    }

    /// Compile one of a preset's shaders into a pipeline.
    fn stage(&self, kind: Kind, text: &str) -> Result<Stage, shader::Error> {
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
        let attr = |location: u32, format: wgpu::VertexFormat| [wgpu::VertexAttribute { format, offset: 0, shader_location: location }];
        let (a0, a1, a2) = (attr(0, wgpu::VertexFormat::Float32x2), attr(1, wgpu::VertexFormat::Float32x2), attr(2, wgpu::VertexFormat::Float32x4));
        let c1 = attr(1, wgpu::VertexFormat::Float32x4);
        let warp_buffers = [
            Some(wgpu::VertexBufferLayout { array_stride: 8, step_mode: wgpu::VertexStepMode::Vertex, attributes: &a0 }),
            Some(wgpu::VertexBufferLayout { array_stride: 8, step_mode: wgpu::VertexStepMode::Vertex, attributes: &a1 }),
            Some(wgpu::VertexBufferLayout { array_stride: 16, step_mode: wgpu::VertexStepMode::Vertex, attributes: &a2 }),
        ];
        let comp_buffers = [
            Some(wgpu::VertexBufferLayout { array_stride: 8, step_mode: wgpu::VertexStepMode::Vertex, attributes: &a0 }),
            Some(wgpu::VertexBufferLayout { array_stride: 16, step_mode: wgpu::VertexStepMode::Vertex, attributes: &c1 }),
        ];
        let (vs, buffers): (&wgpu::ShaderModule, &[Option<wgpu::VertexBufferLayout>]) = match kind {
            Kind::Warp => (&self.warp_vs, &warp_buffers),
            Kind::Comp => (&self.comp_vs, &comp_buffers),
        };
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgpu::VertexState { module: vs, entry_point: Some("main"), compilation_options: Default::default(), buffers },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &fragment,
                entry_point: Some("_milkdrop_main"),
                compilation_options: Default::default(),
                targets: &[Some(FORMAT.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        if let Some(error) = pollster::block_on(scope.pop()) {
            return Err(shader::Error::Invalid(error.to_string()));
        }
        let uniform = buffer(&self.device, &vec![0u8; span.max(16)], wgpu::BufferUsages::UNIFORM);
        Ok(Stage { pipeline, uniform, offsets, span: span.max(16), bindings })
    }

    /// Load a preset. A shader that will not compile draws MilkDrop's default.
    pub fn load(&mut self, text: &str, seed: u64) -> Result<Loaded, crate::runtime::LoadError> {
        let frame = Clock::default().frame_vars(&Audio::default());
        let runner = crate::runtime::load(text, &frame, &self.size, seed)?;
        let mut loaded = Loaded::default();
        let warp_text = runner.preset.warp.clone();
        let comp_text = runner.preset.comp.clone();
        let warp = if warp_text.trim().is_empty() {
            self.stage(Kind::Warp, shader::DEFAULT_WARP)
        } else {
            self.stage(Kind::Warp, &warp_text).or_else(|e| {
                loaded.fell_back.push((Kind::Warp, e.to_string()));
                self.stage(Kind::Warp, shader::DEFAULT_WARP)
            })
        };
        let comp = if comp_text.trim().is_empty() {
            self.stage(Kind::Comp, shader::DEFAULT_COMP)
        } else {
            self.stage(Kind::Comp, &comp_text).or_else(|e| {
                loaded.fell_back.push((Kind::Comp, e.to_string()));
                self.stage(Kind::Comp, shader::DEFAULT_COMP)
            })
        };
        self.warp = Some(warp.expect("default warp compiles"));
        self.comp_stage = Some(comp.expect("default comp compiles"));
        // Butterchurn's `getHighestBlur`, on the shader text.
        let highest = |t: &str| {
            if t.contains("blur3") || t.contains("GetBlur3") {
                3
            } else if t.contains("blur2") || t.contains("GetBlur2") {
                2
            } else if t.contains("blur1") || t.contains("GetBlur1") {
                1
            } else {
                0
            }
        };
        self.blur_passes = highest(&warp_text).max(highest(&comp_text));
        self.runner = Some(runner);
        Ok(loaded)
    }

    /// Butterchurn's `getBlurValues`.
    fn blur_values(r: &Runner) -> ([f64; 3], [f64; 3]) {
        let (mut n1, mut n2, mut n3) = (r.get("b1n"), r.get("b2n"), r.get("b3n"));
        let (mut x1, mut x2, mut x3) = (r.get("b1x"), r.get("b2x"), r.get("b3x"));
        let min = 0.1;
        if x1 - n1 < min {
            let avg = (n1 + x1) * 0.5;
            n1 = avg - min * 0.5;
            x1 = avg - min * 0.5;
        }
        x2 = x1.min(x2);
        n2 = n1.max(n2);
        if x2 - n2 < min {
            let avg = (n2 + x2) * 0.5;
            n2 = avg - min * 0.5;
            x2 = avg - min * 0.5;
        }
        x3 = x2.min(x3);
        n3 = n2.max(n3);
        if x3 - n3 < min {
            let avg = (n3 + x3) * 0.5;
            n3 = avg - min * 0.5;
            x3 = avg - min * 0.5;
        }
        ([n1, n2, n3], [x1, x2, x3])
    }

    /// The uniforms every preset shader reads, for this frame.
    fn uniforms(&mut self, stage_is_warp: bool) -> Vec<(&'static str, Vec<f32>)> {
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
        let _ = stage_is_warp;
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

    fn write_uniforms(&self, stage: &Stage, values: &[(&'static str, Vec<f32>)]) {
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

    /// The texture a preset shader's sampler name reads.
    fn texture_for<'a>(&'a self, name: &str, previous: &'a wgpu::TextureView) -> &'a wgpu::TextureView {
        let short = name.trim_start_matches("sampler_");
        match short {
            "main" | "fw_main" | "fc_main" | "pw_main" | "pc_main" => previous,
            "blur1" => &self.blur[0].1.view,
            "blur2" => &self.blur[1].1.view,
            "blur3" => &self.blur[2].1.view,
            "noise_lq" | "pw_noise_lq" => &self.textures["noise_lq"],
            "noise_lq_lite" => &self.textures["noise_lq_lite"],
            "noise_mq" => &self.textures["noise_mq"],
            "noise_hq" => &self.textures["noise_hq"],
            "noisevol_lq" => &self.textures["noisevol_lq"],
            "noisevol_hq" => &self.textures["noisevol_hq"],
            _ => &self.textures["image"],
        }
    }

    /// The sampler, by MilkDrop's naming: `fw_` filtered and wrapping, `fc_`
    /// filtered and clamped, `pw_`/`pc_` point-sampled; `sampler_main` follows the
    /// preset's `wrap`.
    fn sampler_for(&self, name: &str, wrap: bool) -> &wgpu::Sampler {
        let short = name.trim_start_matches("sampler_");
        let key = if short == "main" {
            if wrap { "linear_wrap" } else { "linear_clamp" }
        } else if short.starts_with("fw_") {
            "linear_wrap"
        } else if short.starts_with("fc_") || short.starts_with("blur") {
            "linear_clamp"
        } else if short.starts_with("pw_") {
            "point_wrap"
        } else if short.starts_with("pc_") {
            "point_clamp"
        } else {
            "linear_wrap"
        };
        &self.samplers[key]
    }

    fn bind_group(&self, stage: &Stage, previous: &wgpu::TextureView, wrap: bool) -> wgpu::BindGroup {
        let entries: Vec<wgpu::BindGroupEntry> = stage
            .bindings
            .iter()
            .map(|(binding, what)| wgpu::BindGroupEntry {
                binding: *binding,
                resource: match what {
                    Binding::Uniform => stage.uniform.as_entire_binding(),
                    Binding::Texture(name) => wgpu::BindingResource::TextureView(self.texture_for(name, previous)),
                    Binding::Sampler(name) => wgpu::BindingResource::Sampler(self.sampler_for(name, wrap)),
                },
            })
            .collect();
        self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &stage.pipeline.get_bind_group_layout(0), entries: &entries })
    }

    /// Butterchurn's hue colours for the comp mesh's corners, blended across it.
    fn comp_colors(&self, time: f64, rand_start: [f32; 4]) -> Vec<[f32; 4]> {
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

    /// One frame: equations, warp into the feedback target, blur, comp. The
    /// finished picture is in the comp target; [`Renderer::present`] draws it.
    pub fn render(&mut self, audio: &mut Audio, elapsed: f64) {
        if self.runner.is_none() {
            return;
        }
        self.clock.tick(elapsed);
        audio.update_levels(self.clock.fps, self.clock.frame);
        let frame = self.clock.frame_vars(audio);
        let size = self.size;
        {
            let runner = self.runner.as_mut().unwrap();
            runner.run_frame(&frame, &size);
            let mut uvs = std::mem::take(&mut self.uvs);
            runner.warp_mesh(frame.time, &size, &mut uvs);
            self.queue.write_buffer(&self.warp_uvs, 0, bytemuck::cast_slice(&uvs));
            self.uvs = uvs;
        }
        let (time, rand_start, wrap) = {
            let r = self.runner.as_ref().unwrap();
            (r.get("time"), r.rand_start, r.get("wrap") != 0.0)
        };
        let colors = self.comp_colors(time, rand_start);
        self.queue.write_buffer(&self.comp_colors, 0, bytemuck::cast_slice(&colors));

        // Swap: last frame becomes what the warp reads.
        self.current ^= 1;
        let values = self.uniforms(true);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let (target, previous) = (&self.feedback[self.current], &self.feedback[self.current ^ 1]);
            let warp = self.warp.as_ref().unwrap();
            self.write_uniforms(warp, &values);
            self.write_uniforms(self.comp_stage.as_ref().unwrap(), &values);
            let warp_group = self.bind_group(warp, &previous.view, wrap);
            let mut pass = begin(&mut encoder, &target.view, true);
            pass.set_pipeline(&warp.pipeline);
            pass.set_bind_group(0, &warp_group, &[]);
            pass.set_vertex_buffer(0, self.warp_positions.slice(..));
            pass.set_vertex_buffer(1, self.warp_uvs.slice(..));
            pass.set_vertex_buffer(2, self.warp_colors.slice(..));
            pass.set_index_buffer(self.warp_indices.0.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.warp_indices.1, 0, 0..1);
        }
        self.blur(&mut encoder);
        self.draw(&mut encoder, &frame, wrap, audio);
        // Comp reads this frame's warp output.
        let comp = self.comp_stage.as_ref().unwrap();
        let comp_group = self.bind_group(comp, &self.feedback[self.current].view, wrap);
        {
            let mut pass = begin(&mut encoder, &self.comp.view, true);
            pass.set_pipeline(&comp.pipeline);
            pass.set_bind_group(0, &comp_group, &[]);
            pass.set_vertex_buffer(0, self.comp_positions.slice(..));
            pass.set_vertex_buffer(1, self.comp_colors.slice(..));
            pass.set_index_buffer(self.comp_indices.0.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.comp_indices.1, 0, 0..1);
        }
        self.queue.submit([encoder.finish()]);
    }

    fn draw_pipeline(&mut self, topology: Topology, blend: Blend) -> &wgpu::RenderPipeline {
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
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("draw"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: shader,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Vertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &attributes,
                    })],
                },
                primitive: wgpu::PrimitiveState {
                    topology: match topology {
                        Topology::Triangles => wgpu::PrimitiveTopology::TriangleList,
                        Topology::Lines => wgpu::PrimitiveTopology::LineList,
                        Topology::LineStrip => wgpu::PrimitiveTopology::LineStrip,
                        Topology::Points => wgpu::PrimitiveTopology::PointList,
                    },
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: shader,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: FORMAT,
                        blend: Some(wgpu::BlendState { color: component, alpha: component }),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        })
    }

    /// Motion vectors, shapes, waves, darken centre and borders, blended into
    /// this frame's feedback target.
    fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, frame: &crate::runtime::Frame, wrap: bool, audio: &Audio) {
        let size = self.size;
        let globals = Runner::globals(frame, &size);
        let mut list = std::mem::take(&mut self.draw_list);
        crate::draw::frame(self.runner.as_mut().unwrap(), audio, &self.uvs, &globals, &size, &mut list);
        if list.cmds.is_empty() {
            self.draw_list = list;
            return;
        }
        let bytes: &[u8] = bytemuck::cast_slice(&list.vertices);
        let grow = self.draw_buffer.as_ref().is_none_or(|(_, cap)| *cap < bytes.len());
        if grow {
            let capacity = bytes.len().next_power_of_two().max(4096);
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("draw"),
                size: capacity as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.draw_buffer = Some((buffer, capacity));
        }
        self.queue.write_buffer(&self.draw_buffer.as_ref().unwrap().0, 0, bytes);
        for cmd in &list.cmds {
            self.draw_pipeline(cmd.topology, cmd.blend);
        }
        let previous = &self.feedback[self.current ^ 1].view;
        let sampler = &self.samplers[if wrap { "linear_wrap" } else { "linear_clamp" }];
        let mut groups = HashMap::new();
        for cmd in &list.cmds {
            let pipeline = &self.draw_pipelines[&(cmd.topology, cmd.blend)];
            groups.entry((cmd.topology, cmd.blend)).or_insert_with(|| {
                self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(previous) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
                    ],
                })
            });
        }
        {
            let mut pass = begin(encoder, &self.feedback[self.current].view, false);
            pass.set_vertex_buffer(0, self.draw_buffer.as_ref().unwrap().0.slice(..));
            for cmd in &list.cmds {
                pass.set_pipeline(&self.draw_pipelines[&(cmd.topology, cmd.blend)]);
                pass.set_bind_group(0, &groups[&(cmd.topology, cmd.blend)], &[]);
                pass.draw(cmd.first..cmd.first + cmd.count, 0..1);
            }
        }
        self.draw_list = list;
    }

    /// Butterchurn's blur pyramid: per level, a horizontal pass into a narrower
    /// texture and a vertical pass into a shorter one.
    fn blur(&self, encoder: &mut wgpu::CommandEncoder) {
        if self.blur_passes == 0 {
            return;
        }
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
            let source: &wgpu::TextureView = if level == 0 { &self.feedback[self.current].view } else { &self.blur[level - 1].1.view };
            let src_ratio = if level > 0 { BLUR_RATIOS[level - 1][1] } else { 1.0 };
            let src = blur_size(&self.size, src_ratio);
            let (h_target, v_target) = &self.blur[level];
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
                let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(input) },
                        wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.samplers["linear_clamp"]) },
                    ],
                });
                let mut pass = begin(encoder, output, true);
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &group, &[]);
                pass.draw(0..4, 0..1);
            }
        }
    }

    /// Draw the finished picture into `view`, a window's surface, scaled to fit.
    pub fn present(&mut self, view: &wgpu::TextureView, format: wgpu::TextureFormat) {
        if !self.blits.contains_key(&format) {
            let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("blit"),
                layout: None,
                vertex: wgpu::VertexState { module: &self.blit_shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.blit_shader,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(format.into())],
                }),
                multiview_mask: None,
                cache: None,
            });
            self.blits.insert(format, pipeline);
        }
        let pipeline = &self.blits[&format];
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.comp.view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.samplers["linear_clamp"]) },
            ],
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = begin(&mut encoder, view, true);
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.draw(0..4, 0..1);
        }
        self.queue.submit([encoder.finish()]);
    }

    /// The finished picture, read back as RGBA rows top to bottom — for tests and
    /// the harness.
    pub fn read_back(&self) -> Vec<u8> {
        let (w, h) = self.comp.size;
        let padded = (w * 4).div_ceil(256) * 256;
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            self.comp.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &staging,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit([encoder.finish()]);
        let slice = staging.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device.poll(wgpu::PollType::wait_indefinitely()).ok();
        let data = slice.get_mapped_range().expect("mapped");
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        // GL orientation: the last row is the top of the picture.
        for row in (0..h).rev() {
            let at = (row * padded) as usize;
            out.extend_from_slice(&data[at..at + (w * 4) as usize]);
        }
        out
    }
}

fn begin<'a>(encoder: &'a mut wgpu::CommandEncoder, view: &'a wgpu::TextureView, clear: bool) -> wgpu::RenderPass<'a> {
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

/// A device for rendering without a window — tests and the harness.
pub fn headless() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).ok()?;
    pollster::block_on(adapter.request_device(&Default::default())).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preset_draws_something() {
        let Some((device, queue)) = headless() else { return };
        let mut r = Renderer::new(device, queue, 256, 192);
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/milk/Fixture - Spiral Test.milk")).unwrap();
        let loaded = r.load(&text, 1).unwrap();
        assert!(loaded.fell_back.is_empty(), "{:?}", loaded.fell_back);
        let mut audio = Audio::default();
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.05).sin() * 0.8).collect();
        for _ in 0..30 {
            audio.update(&tone, &tone);
            r.render(&mut audio, 1.0 / 60.0);
        }
        let pixels = r.read_back();
        assert_eq!(pixels.len(), 256 * 192 * 4);
        assert!(pixels.chunks(4).all(|p| p[3] == 255), "comp writes opaque pixels");
    }
}
