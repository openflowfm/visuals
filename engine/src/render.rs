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
//!
//! **The preset clock.** A preset moves in *steps*, MilkDrop's frames, at
//! [`PRESET_RATE`] a second times the speed; the picture is drawn at every
//! display refresh ([`Renderer::render`]). Each step runs the equations once and
//! feeds back once — warp, blur, waves and shapes into the feedback — exactly
//! as MilkDrop draws a frame, so the feedback after a second is the same at any
//! refresh rate. A refresh between steps draws a picture that is not fed back:
//! the last step's feedback carried that far into the next step (the next step's
//! warp mesh at that fraction, its warp shader mixed in by it, its waves and
//! shapes slid that far from where the last step drew them, every shader
//! uniform that far from the last step's value to the next's), then blur and
//! comp. See "The preset clock" in docs/milkdrop-engine.md.

use crate::audio::Audio;
use crate::draw::{Blend, DrawList, Topology, Vertex};
use crate::fx::Master;
use crate::runtime::{Clock, Mesh, Runner, Size, PRESET_RATE};
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
    fn new(device: &wgpu::Device, size: (u32, u32), label: &str) -> Self {
        Self::of(device, size, label, FORMAT)
    }

    fn of(device: &wgpu::Device, (w, h): (u32, u32), label: &str, format: wgpu::TextureFormat) -> Self {
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
}

/// One of the preset's two shaders, compiled into a pipeline, with what its
/// uniforms and textures are called.
struct Stage {
    pipeline: wgpu::RenderPipeline,
    /// The warp's pipeline for a refresh between steps: the same shader, mixed
    /// over what is under it by the blend constant (the step's fraction).
    mixed: Option<wgpu::RenderPipeline>,
    uniform: wgpu::Buffer,
    /// Byte offset of each uniform, by name without the `_u_` prefix.
    offsets: HashMap<String, u32>,
    span: usize,
    /// Every binding the entry point uses, and what it names.
    bindings: Vec<(u32, Binding)>,
}

/// The trails echo: kept in half floats, so a small echo per refresh still
/// fades at 120 Hz (in 8 bits, `x × 0.995` rounds back to `x`).
struct Trails {
    echo: wgpu::RenderPipeline,
    copy: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    kept: [Target; 2],
    at: usize,
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
    /// A refresh between steps: the feedback carried part of the way into the
    /// next step, never fed back; and its blur.
    display: Target,
    display_blur: Vec<(Target, Target)>,
    display_uvs: wgpu::Buffer,
    /// The previous picture moved by the mesh alone, under the warp shader's mix.
    transport: wgpu::RenderPipeline,
    /// The last step's warp before its drawing ([`CARRY`]), the picture carried
    /// from it and the feedback, and the pass that makes it.
    bare: Target,
    carried: Target,
    carry: wgpu::RenderPipeline,
    carry_uniform: wgpu::Buffer,
    /// The drawing in the feedback, the drawing between it and the next step's
    /// ([`crate::draw::between`]), and the latter's vertex buffer.
    shown_list: DrawList,
    between_list: DrawList,
    between_buffer: Option<(wgpu::Buffer, usize)>,
    /// The pending step's motion, for drawing a part of it.
    mesh: Mesh,
    /// Where the preset clock is, in steps since the preset loaded; how many
    /// steps are in the feedback; whether the next one's equations have run;
    /// and how far the last refresh moved the clock.
    position: f64,
    step: u64,
    pending: bool,
    advanced: f64,
    /// The shaders' uniforms at the step in the feedback and at the next one,
    /// mixed by the fraction between them ([`Renderer::values_at`]).
    shown_values: Vec<(&'static str, Vec<f32>)>,
    next_values: Vec<(&'static str, Vec<f32>)>,
    /// The outgoing preset's snapshot that [`Master::fade`] mixes in, black until
    /// [`Renderer::keep_outgoing`] keeps one.
    outgoing: Target,
    /// The master pass's pipeline for each format it has presented to.
    masters: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    master_shader: wgpu::ShaderModule,
    master_uniform: wgpu::Buffer,
    master: Master,
    /// How much of the picture before echoes into each new one, per 1/60 s of
    /// preset time; 0 is off.
    trails: f32,
    /// The trails passes — made the first time trails are on — and whether the
    /// last refresh had them on.
    trails_pass: Option<Trails>,
    trails_on: bool,
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
    /// Small copies of each stage's picture, when an editor wants them.
    previews: Option<Vec<Target>>,
}

/// The size of a stage's preview picture.
pub const PREVIEW: (u32, u32) = (192, 108);
/// The stages that have a picture, in the order [`Renderer::read_previews`] packs them:
/// the warp's output, the feedback after waves and shapes, blur 1 and comp; then what
/// each drawing stage drew this frame, alone on black.
pub const PREVIEWS: [&str; 15] = [
    "warp", "feedback", "blur", "comp", "wave0", "wave1", "wave2", "wave3", "shape0", "shape1", "shape2", "shape3", "wave",
    "motion", "border",
];

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

/// The last step's picture moved by the warp mesh and nothing else: what a
/// refresh between steps mixes the preset's warp shader over.
const TRANSPORT: &str = "
struct In { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) uv_orig: vec2f, @location(2) color: vec4f }
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(i: In) -> @location(0) vec4f { return vec4f(textureSample(tex, smp, i.uv).rgb, 1.0); }";

/// The picture a refresh between steps carries on from: the last step's warp
/// before its waves and shapes, mixed with the feedback by `k.x` — so the last
/// step's drawing, which the refresh draws again on its way to the next step's,
/// fades into the trail it leaves rather than showing twice.
const CARRY: &str = "
struct Out { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  var o: Out;
  o.pos = vec4f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
@group(0) @binding(0) var bare: texture_2d<f32>;
@group(0) @binding(1) var fed: texture_2d<f32>;
@group(0) @binding(2) var<uniform> k: vec4f;
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let p = vec2i(o.pos.xy);
  return mix(textureLoad(bare, p, 0), textureLoad(fed, p, 0), k.x);
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

static WARP_ATTRIBUTES: [[wgpu::VertexAttribute; 1]; 3] = [
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0, shader_location: 0 }],
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0, shader_location: 1 }],
    [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 2 }],
];

/// The warp mesh's vertex buffers: positions, texture coordinates, colours.
fn warp_layout() -> [Option<wgpu::VertexBufferLayout<'static>>; 3] {
    let layout = |stride: u64, i: usize| Some(wgpu::VertexBufferLayout { array_stride: stride, step_mode: wgpu::VertexStepMode::Vertex, attributes: &WARP_ATTRIBUTES[i] });
    [layout(8, 0), layout(8, 1), layout(16, 2)]
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

/// Butterchurn's `clouds2` image, as RGBA.
fn clouds() -> Vec<u8> {
    let mut decoder = jpeg_decoder::Decoder::new(&include_bytes!("../assets/clouds2.jpg")[..]);
    let rgb = decoder.decode().expect("clouds2.jpg decodes");
    rgb.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect()
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
        // Butterchurn's stand-in for any texture a preset names and it does not
        // have: a 128×128 photograph of clouds, shipped inside Butterchurn (MIT).
        textures.insert("image", texture(&device, &queue, &clouds(), 128, 1));
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
        let blurs = || -> Vec<(Target, Target)> {
            (0..3)
                .map(|i| {
                    let ratios = BLUR_RATIOS[i];
                    (Target::new(&device, blur_size(&size, ratios[0]), "blur h"), Target::new(&device, blur_size(&size, ratios[1]), "blur v"))
                })
                .collect()
        };
        let (blur, display_blur) = (blurs(), blurs());
        let display_uvs = buffer(&device, bytemuck::cast_slice(&vec![[0f32; 2]; warp_grid.len()]), vertex);
        let transport_fs = wgsl(TRANSPORT);
        let transport = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("transport"),
            layout: None,
            vertex: wgpu::VertexState { module: &warp_vs, entry_point: Some("main"), compilation_options: Default::default(), buffers: &warp_layout() },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState { module: &transport_fs, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[Some(FORMAT.into())] }),
            multiview_mask: None,
            cache: None,
        });
        let carry_shader = wgsl(CARRY);
        let carry = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("carry"),
            layout: None,
            vertex: wgpu::VertexState { module: &carry_shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &carry_shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(FORMAT.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let carry_uniform = buffer(&device, &[0u8; 16], wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
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
            display: Target::new(&device, full, "between steps"),
            display_blur,
            display_uvs,
            transport,
            bare: Target::new(&device, full, "warp before drawing"),
            carried: Target::new(&device, full, "carried between steps"),
            carry,
            carry_uniform,
            shown_list: DrawList::default(),
            between_list: DrawList::default(),
            between_buffer: None,
            mesh: Mesh::default(),
            position: 0.0,
            step: 0,
            pending: false,
            advanced: 0.0,
            shown_values: Vec::new(),
            next_values: Vec::new(),
            outgoing: Target::new(&device, full, "outgoing"),
            masters: HashMap::new(),
            master_shader: wgsl(crate::fx::MASTER),
            master_uniform: buffer(&device, &[0u8; 48], wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST),
            master: Master::default(),
            trails: 0.0,
            trails_pass: None,
            trails_on: false,
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
            previews: None,
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

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
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
            self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
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
                    targets: &[Some(wgpu::ColorTargetState { format: FORMAT, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                multiview_mask: None,
                cache: None,
            })
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

    /// Load a preset. A shader that will not compile draws MilkDrop's default.
    pub fn load(&mut self, text: &str, seed: u64) -> Result<Loaded, crate::runtime::LoadError> {
        self.load_preset(crate::preset::parse(text), seed)
    }

    /// Load a preset already read into its parts — what an editor holds. Nothing
    /// changes when its equations do not compile: the last preset keeps drawing.
    pub fn load_preset(&mut self, preset: crate::preset::Preset, seed: u64) -> Result<Loaded, crate::runtime::LoadError> {
        let frame = Clock::default().frame_vars(&Audio::default());
        let runner = Runner::new(preset, &frame, &self.size, seed)?;
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
        // The new preset's first step starts here, from the picture as it is.
        (self.position, self.step, self.pending) = (0.0, 0, false);
        (self.shown_values, self.next_values) = (Vec::new(), Vec::new());
        self.shown_list.clear();
        self.draw_list.clear();
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
    fn uniforms(&mut self) -> Vec<(&'static str, Vec<f32>)> {
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
    /// `between` picks the blur of the picture between steps over the step's own.
    fn texture_for<'a>(&'a self, name: &str, previous: &'a wgpu::TextureView, between: bool) -> &'a wgpu::TextureView {
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

    fn bind_group(&self, stage: &Stage, pipeline: &wgpu::RenderPipeline, previous: &wgpu::TextureView, wrap: bool, between: bool) -> wgpu::BindGroup {
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

    /// One display refresh. The preset clock moves on by `seconds` of preset
    /// time — the real time since the last refresh × the speed — which is
    /// `seconds ×` [`PRESET_RATE`] steps, and the picture is drawn where the clock
    /// now is. The finished picture is in the comp target; [`Renderer::present`]
    /// draws it.
    ///
    /// Every whole step the clock passes runs the preset's equations once and
    /// feeds back once, exactly as MilkDrop draws a frame. A step's equations run
    /// at the first refresh that needs them, with the audio given to it: at a
    /// refresh landing on a step (30 Hz, or a harness), the step that follows
    /// hears the next refresh's audio, as in MilkDrop; between steps, a step is
    /// heard up to one step before it is fed back, the price of drawing towards it.
    pub fn render(&mut self, audio: &mut Audio, seconds: f64) {
        if self.runner.is_none() {
            return;
        }
        let steps = if seconds.is_finite() { seconds.max(0.0) * PRESET_RATE } else { 0.0 };
        let mut to = self.position + steps;
        // A refresh that lands within a hair of a step is on it.
        if (to - to.round()).abs() < 1e-6 {
            to = to.round();
        }
        self.advanced = to - self.position;
        while (self.step + 1) as f64 <= to {
            if !self.pending {
                self.equations(audio);
            }
            self.feed_back();
            self.step += 1;
            self.pending = false;
        }
        self.position = to;
        let fraction = (to - self.step as f64) as f32;
        // A preset's first drawn refresh has run its equations, frozen or not:
        // its stages' uniforms are unwritten until then.
        if (fraction > 0.0 || self.step == 0) && !self.pending {
            self.equations(audio);
        }
        self.show(fraction);
    }

    /// How many steps of the running preset are in the picture.
    pub fn steps(&self) -> u64 {
        self.step
    }

    /// The next step's equations: per frame, per vertex, then waves and shapes,
    /// with everything they set uploaded for [`Renderer::feed_back`] and the
    /// refreshes before it.
    fn equations(&mut self, audio: &mut Audio) {
        self.clock.tick(1.0 / PRESET_RATE);
        audio.update_levels(self.clock.fps, self.clock.frame);
        let frame = self.clock.frame_vars(audio);
        let size = self.size;
        {
            let runner = self.runner.as_mut().unwrap();
            runner.run_frame(&frame, &size);
            runner.warp_motion(frame.time, &size, &mut self.mesh);
            let mut uvs = std::mem::take(&mut self.uvs);
            self.mesh.uvs(1.0, &mut uvs);
            self.queue.write_buffer(&self.warp_uvs, 0, bytemuck::cast_slice(&uvs));
            self.uvs = uvs;
        }
        self.build_draw(&frame, audio);
        self.next_values = self.uniforms();
        if self.shown_values.is_empty() {
            self.shown_values = self.next_values.clone();
        }
        self.write_uniforms(self.warp.as_ref().unwrap(), &self.next_values);
        self.pending = true;
    }

    /// The shaders' uniforms `fraction` of the way from the step in the feedback
    /// to the next: each value mixed linearly, so `time`, the audio levels, the
    /// `q`s and the rest move on at every refresh rather than all at once at the
    /// first refresh after a step. `rand_frame` is the next step's: it is noise,
    /// and MilkDrop draws it afresh each frame.
    fn values_at(&self, fraction: f32) -> Vec<(&'static str, Vec<f32>)> {
        if fraction <= 0.0 {
            return self.shown_values.clone();
        }
        // Both lists are [`Renderer::uniforms`]'s, name for name.
        self.shown_values
            .iter()
            .zip(&self.next_values)
            .map(|((_, shown), (name, next))| {
                let value = if *name == "rand_frame" { next.clone() } else { shown.iter().zip(next).map(|(a, b)| a + (b - a) * fraction).collect() };
                (*name, value)
            })
            .collect()
    }

    fn wrap(&self) -> bool {
        self.runner.as_ref().is_some_and(|r| r.get("wrap") != 0.0)
    }

    /// The warp mesh with `uvs` as its texture coordinates, into an open pass.
    fn mesh_draw(&self, pass: &mut wgpu::RenderPass, uvs: &wgpu::Buffer) {
        pass.set_vertex_buffer(0, self.warp_positions.slice(..));
        pass.set_vertex_buffer(1, uvs.slice(..));
        pass.set_vertex_buffer(2, self.warp_colors.slice(..));
        pass.set_index_buffer(self.warp_indices.0.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..self.warp_indices.1, 0, 0..1);
    }

    /// A whole step into the feedback, as MilkDrop draws a frame: the warp, the
    /// blur of its picture, then motion vectors, shapes, waves and borders.
    fn feed_back(&mut self) {
        let wrap = self.wrap();
        // A refresh between steps leaves the warp a mix of two steps' uniforms.
        self.write_uniforms(self.warp.as_ref().unwrap(), &self.next_values);
        self.shown_values = self.next_values.clone();
        self.current ^= 1;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let (target, previous) = (&self.feedback[self.current], &self.feedback[self.current ^ 1]);
            let warp = self.warp.as_ref().unwrap();
            let group = self.bind_group(warp, &warp.pipeline, &previous.view, wrap, false);
            let mut pass = begin(&mut encoder, &target.view, true);
            pass.set_pipeline(&warp.pipeline);
            pass.set_bind_group(0, &group, &[]);
            self.mesh_draw(&mut pass, &self.warp_uvs);
        }
        self.preview(&mut encoder, 0, &self.feedback[self.current].view);
        self.blur(&mut encoder, &self.feedback[self.current].view, false);
        if self.blur_passes > 0 {
            self.preview(&mut encoder, 2, &self.blur[0].1.view);
        }
        if !self.draw_list.cmds.is_empty() {
            // Kept for the refreshes before the next step (`CARRY`).
            encoder.copy_texture_to_texture(
                self.feedback[self.current].texture.as_image_copy(),
                self.bare.texture.as_image_copy(),
                wgpu::Extent3d { width: self.bare.size.0, height: self.bare.size.1, depth_or_array_layers: 1 },
            );
        }
        let (target, previous) = (&self.feedback[self.current].view, &self.feedback[self.current ^ 1].view);
        self.draw(&mut encoder, &self.draw_list, self.draw_buffer.as_ref(), target, previous, wrap, true);
        self.preview(&mut encoder, 1, &self.feedback[self.current].view);
        self.queue.submit([encoder.finish()]);
    }

    /// The picture at `fraction` of the way into the next step, through comp.
    /// At 0 it is the feedback as it stands. Otherwise it is drawn, never fed
    /// back: the feedback, with the last step's drawing faded into it by the
    /// fraction ([`CARRY`]), carried by the next step's mesh at that fraction
    /// ([`Mesh::uvs`]) with the preset's warp shader mixed over it by the
    /// fraction, then its own blur, then the drawing between the two steps'
    /// ([`crate::draw::between`]), and comp, with every uniform between the two
    /// steps' ([`Renderer::values_at`]). Each of those is the step's own
    /// picture at a fraction of 1 and the last step's at 0, so the picture moves
    /// on without a jump, and in proportion to the fraction.
    fn show(&mut self, fraction: f32) {
        let wrap = self.wrap();
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let between = fraction > 0.0;
        let values = self.values_at(fraction);
        let time = values.iter().find(|(n, _)| *n == "time").map_or(0.0, |(_, v)| v[0] as f64);
        let rand_start = self.runner.as_ref().unwrap().rand_start;
        self.queue.write_buffer(&self.comp_colors, 0, bytemuck::cast_slice(&self.comp_colors(time, rand_start)));
        self.write_uniforms(self.comp_stage.as_ref().unwrap(), &values);
        if between {
            // Measured smoother than the next step's: the warp shader's noise and
            // motion follow `time` and the `q`s rather than holding a step's.
            self.write_uniforms(self.warp.as_ref().unwrap(), &values);
        }
        if between {
            let mut uvs = Vec::new();
            self.mesh.uvs(fraction as f64, &mut uvs);
            self.queue.write_buffer(&self.display_uvs, 0, bytemuck::cast_slice(&uvs));
            let mut list = std::mem::take(&mut self.between_list);
            crate::draw::between(&self.shown_list, &self.draw_list, fraction, &mut list);
            upload(&self.device, &self.queue, &list, &mut self.between_buffer);
            for cmd in &list.cmds {
                self.draw_pipeline(cmd.topology, cmd.blend);
            }
            self.between_list = list;
            let fed = &self.feedback[self.current].view;
            // The last step drew over its warp: carry on from its warp and its
            // drawing mixed by the fraction, as the drawing between is drawn again.
            let carrying = !self.shown_list.cmds.is_empty();
            if carrying {
                self.queue.write_buffer(&self.carry_uniform, 0, bytemuck::cast_slice(&[fraction, 0.0, 0.0, 0.0]));
                let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &self.carry.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.bare.view) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(fed) },
                        wgpu::BindGroupEntry { binding: 2, resource: self.carry_uniform.as_entire_binding() },
                    ],
                });
                let mut pass = begin(&mut encoder, &self.carried.view, true);
                pass.set_pipeline(&self.carry);
                pass.set_bind_group(0, &group, &[]);
                pass.draw(0..4, 0..1);
            }
            let previous = if carrying { &self.carried.view } else { fed };
            {
                let warp = self.warp.as_ref().unwrap();
                let mixed = warp.mixed.as_ref().unwrap();
                let moved = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &self.transport.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(previous) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(self.sampler_for("sampler_main", wrap)) },
                    ],
                });
                let shaded = self.bind_group(warp, mixed, previous, wrap, false);
                let mut pass = begin(&mut encoder, &self.display.view, true);
                pass.set_pipeline(&self.transport);
                pass.set_bind_group(0, &moved, &[]);
                self.mesh_draw(&mut pass, &self.display_uvs);
                let f = fraction as f64;
                pass.set_blend_constant(wgpu::Color { r: f, g: f, b: f, a: f });
                pass.set_pipeline(mixed);
                pass.set_bind_group(0, &shaded, &[]);
                self.mesh_draw(&mut pass, &self.display_uvs);
            }
            self.blur(&mut encoder, &self.display.view, true);
            self.draw(&mut encoder, &self.between_list, self.between_buffer.as_ref(), &self.display.view, fed, wrap, false);
        }
        let source = if between { &self.display.view } else { &self.feedback[self.current].view };
        let comp = self.comp_stage.as_ref().unwrap();
        let comp_group = self.bind_group(comp, &comp.pipeline, source, wrap, between);
        {
            let mut pass = begin(&mut encoder, &self.comp.view, true);
            pass.set_pipeline(&comp.pipeline);
            pass.set_bind_group(0, &comp_group, &[]);
            pass.set_vertex_buffer(0, self.comp_positions.slice(..));
            pass.set_vertex_buffer(1, self.comp_colors.slice(..));
            pass.set_index_buffer(self.comp_indices.0.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.comp_indices.1, 0, 0..1);
        }
        let on = self.trails > 0.0;
        if on {
            self.echo(&mut encoder);
        }
        self.trails_on = on;
        self.preview(&mut encoder, 3, &self.comp.view);
        self.queue.submit([encoder.finish()]);
    }

    /// The trails echo: the brighter of comp and the picture before faded by
    /// [`Renderer::set_trails`]'s amount — `k` per 1/60 s of preset time, so the
    /// same at any refresh rate — per channel, kept in half floats and copied
    /// back to comp. The picture before is the last one shown, echo included,
    /// so the echo accumulates; turned on, it starts from comp alone.
    fn echo(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if self.trails_pass.is_none() {
            let shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("trails"),
                source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(crate::fx::TRAILS)),
            });
            let pipeline = |entry: &str, format: wgpu::TextureFormat| {
                self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("trails"),
                    layout: None,
                    vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                    primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                    depth_stencil: None,
                    multisample: Default::default(),
                    fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some(entry), compilation_options: Default::default(), targets: &[Some(format.into())] }),
                    multiview_mask: None,
                    cache: None,
                })
            };
            let half = wgpu::TextureFormat::Rgba16Float;
            let (echo, copy) = (pipeline("fs", half), pipeline("copy", FORMAT));
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
        let group = |pipeline: &wgpu::RenderPipeline, entries: &[wgpu::BindGroupEntry]| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipeline.get_bind_group_layout(0), entries })
        };
        let echo = group(
            &t.echo,
            &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.comp.view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&t.kept[before].view) },
                wgpu::BindGroupEntry { binding: 2, resource: t.uniform.as_entire_binding() },
            ],
        );
        let copy = group(&t.copy, &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&t.kept[after].view) }]);
        for (pipeline, bind, target) in [(&t.echo, &echo, &t.kept[after].view), (&t.copy, &copy, &self.comp.view)] {
            let mut pass = begin(encoder, target, true);
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind, &[]);
            pass.draw(0..4, 0..1);
        }
    }

    /// Echo each picture shown into the next: `k` per 1/60 s of preset time of
    /// the one before stays wherever it is brighter than what was drawn, so
    /// moving things leave long trails that never get brighter than they were.
    /// Clamped to 0..0.98; 0 is off.
    pub fn set_trails(&mut self, k: f32) {
        self.trails = if k.is_finite() { k.clamp(0.0, 0.98) } else { 0.0 };
    }

    /// What the master pass does each time the picture is presented.
    pub fn set_master(&mut self, m: Master) {
        self.master = m;
    }

    pub fn master(&self) -> Master {
        self.master
    }

    /// Keep the finished picture as the outgoing snapshot that [`Master::fade`]
    /// mixes in — taken just before a new preset takes over.
    pub fn keep_outgoing(&mut self) {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_texture(
            self.comp.texture.as_image_copy(),
            self.outgoing.texture.as_image_copy(),
            wgpu::Extent3d { width: self.comp.size.0, height: self.comp.size.1, depth_or_array_layers: 1 },
        );
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
    /// The step's waves, shapes and the rest, with their equations run once,
    /// uploaded for every [`Renderer::draw`] until the next step.
    fn build_draw(&mut self, frame: &crate::runtime::Frame, audio: &Audio) {
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
    fn draw(
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

    /// Butterchurn's blur pyramid: per level, a horizontal pass into a narrower
    /// texture and a vertical pass into a shorter one — of `picture`, into the
    /// step's blur or, `between` steps, the picture between's own.
    fn blur(&self, encoder: &mut wgpu::CommandEncoder, picture: &wgpu::TextureView, between: bool) {
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

    /// Change one of the running preset's values without reloading it. Returns
    /// false when the change needs a reload (a wave or shape turned on or off).
    pub fn set_value(&mut self, owner: crate::runtime::Owner, key: &str, value: f64) -> bool {
        self.runner.as_mut().is_some_and(|r| r.set_value(owner, key, value))
    }

    /// Keep small pictures of each stage, for [`Renderer::read_previews`].
    pub fn set_previews(&mut self, on: bool) {
        if on && self.previews.is_none() {
            self.blit_pipeline(FORMAT);
            self.previews = Some(PREVIEWS.iter().map(|name| Target::new(&self.device, PREVIEW, name)).collect());
        } else if !on {
            self.previews = None;
        }
    }

    fn preview(&self, encoder: &mut wgpu::CommandEncoder, which: usize, source: &wgpu::TextureView) {
        if let Some(previews) = &self.previews {
            self.blit(encoder, source, &previews[which].view, FORMAT);
        }
    }

    /// The stage pictures, RGBA rows top to bottom, one after another in
    /// [`PREVIEWS`] order. Waits for the GPU.
    pub fn read_previews(&self) -> Option<Vec<u8>> {
        let previews = self.previews.as_ref()?;
        let (w, h) = PREVIEW;
        let row = (w * 4).div_ceil(256) * 256;
        let each = (row * h) as u64;
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("previews"),
            size: each * previews.len() as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        for (i, p) in previews.iter().enumerate() {
            encoder.copy_texture_to_buffer(
                p.texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &staging,
                    layout: wgpu::TexelCopyBufferLayout { offset: each * i as u64, bytes_per_row: Some(row), rows_per_image: Some(h) },
                },
                wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
        }
        self.queue.submit([encoder.finish()]);
        let slice = staging.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device.poll(wgpu::PollType::wait_indefinitely()).ok();
        let data = slice.get_mapped_range().ok()?;
        let mut out = Vec::with_capacity((w * h * 4) as usize * previews.len());
        for i in 0..previews.len() {
            for y in 0..h {
                let at = (each * i as u64) as usize + (y * row) as usize;
                out.extend_from_slice(&data[at..at + (w * 4) as usize]);
            }
        }
        Some(out)
    }

    fn blit_pipeline(&mut self, format: wgpu::TextureFormat) {
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
    }

    /// Draw `source` scaled into `target`, picture side up. The pipeline for
    /// `format` must already exist ([`Renderer::blit_pipeline`]).
    fn blit(&self, encoder: &mut wgpu::CommandEncoder, source: &wgpu::TextureView, target: &wgpu::TextureView, format: wgpu::TextureFormat) {
        let pipeline = &self.blits[&format];
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(source) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.samplers["linear_clamp"]) },
            ],
        });
        let mut pass = begin(encoder, target, true);
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.draw(0..4, 0..1);
    }

    /// Draw the finished picture into `view`, a window's surface, scaled to fit,
    /// through the master pass, so the live effects ([`Renderer::set_master`])
    /// are on every picture presented.
    pub fn present(&mut self, view: &wgpu::TextureView, format: wgpu::TextureFormat) {
        if !self.masters.contains_key(&format) {
            let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("master"),
                layout: None,
                vertex: wgpu::VertexState { module: &self.master_shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.master_shader,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(format.into())],
                }),
                multiview_mask: None,
                cache: None,
            });
            self.masters.insert(format, pipeline);
        }
        self.queue.write_buffer(&self.master_uniform, 0, bytemuck::cast_slice(&crate::fx::uniforms(&self.master)));
        let pipeline = &self.masters[&format];
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.comp.view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&self.outgoing.view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.samplers["linear_clamp"]) },
                wgpu::BindGroupEntry { binding: 3, resource: self.master_uniform.as_entire_binding() },
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

/// `list`'s vertices into `buffer`, grown to fit.
fn upload(device: &wgpu::Device, queue: &wgpu::Queue, list: &DrawList, buffer: &mut Option<(wgpu::Buffer, usize)>) {
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
    use crate::fx::Mirror;

    /// A target's pixels, RGBA rows top to bottom (row 0 of a presented target
    /// is the top of the picture).
    fn read_target(r: &Renderer, target: &Target) -> Vec<u8> {
        let (w, h) = target.size;
        let padded = (w * 4).div_ceil(256) * 256;
        let staging = r.device().create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut e = r.device().create_command_encoder(&Default::default());
        e.copy_texture_to_buffer(
            target.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        r.queue().submit([e.finish()]);
        staging.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        r.device().poll(wgpu::PollType::wait_indefinitely()).ok();
        let data = staging.slice(..).get_mapped_range().unwrap();
        (0..h).flat_map(|y| data[(y * padded) as usize..(y * padded + w * 4) as usize].to_vec()).collect()
    }

    const W: u32 = 64;
    const H: u32 = 36;

    /// The Spiral fixture at 64×36, with `frames` frames made.
    fn spiral(frames: usize) -> Option<(Renderer, Audio)> {
        let (device, queue) = headless()?;
        let mut r = Renderer::new(device, queue, W, H);
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/milk/Fixture - Spiral Test.milk")).unwrap();
        r.load(&text, 1).unwrap();
        let mut audio = Audio::default();
        for _ in 0..frames {
            frame(&mut r, &mut audio);
        }
        Some((r, audio))
    }

    fn frame(r: &mut Renderer, audio: &mut Audio) {
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.05).sin() * 0.8).collect();
        audio.update(&tone, &tone);
        r.render(audio, 1.0 / 60.0);
    }

    /// The picture presented through the master pass with `m`.
    fn presented(r: &mut Renderer, m: Master) -> Vec<u8> {
        let target = Target::new(r.device(), (W, H), "shown");
        r.set_master(m);
        r.present(&target.view, FORMAT);
        read_target(r, &target)
    }

    fn within(a: &[u8], b: &[u8], by: i32) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(&x, &y)| (x as i32 - y as i32).abs() <= by)
    }

    #[test]
    fn a_preset_loaded_while_frozen_draws_after_its_equations() {
        let Some((mut r, mut audio)) = spiral(0) else { return };
        assert!(!r.pending);
        r.render(&mut audio, 0.0);
        assert!(r.pending, "the first frozen draw has run the equations");
        let frame = r.clock.frame;
        r.render(&mut audio, 0.0);
        assert_eq!(r.clock.frame, frame, "frozen, they run once");
    }

    #[test]
    fn the_default_master_is_a_plain_blit() {
        let Some((mut r, _)) = spiral(20) else { return };
        let drawn = r.read_back();
        assert!(drawn.chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0), "the spiral draws something");
        assert_eq!(r.master(), Master::default());
        assert!(within(&presented(&mut r, Master::default()), &drawn, 1));
    }

    #[test]
    fn master_colour_effects() {
        let Some((mut r, _)) = spiral(20) else { return };
        let drawn = r.read_back();
        let inverted = presented(&mut r, Master { invert: 1.0, ..Default::default() });
        let ok = inverted.chunks(4).zip(drawn.chunks(4)).all(|(i, d)| (0..3).all(|c| (i[c] as i32 - (255 - d[c] as i32)).abs() <= 2));
        assert!(ok, "invert = 1 is 255 − x");
        let zero = |p: &[u8]| p.chunks(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0);
        assert!(zero(&presented(&mut r, Master { black: 1.0, flash: 1.0, ..Default::default() })), "black = 1 is black, even over a flash");
        assert!(zero(&presented(&mut r, Master { brightness: 0.0, ..Default::default() })), "brightness 0 is black");
        let hue0 = presented(&mut r, Master::default());
        let hue1 = presented(&mut r, Master { hue: 1.0, ..Default::default() });
        assert!(within(&hue0, &hue1, 2), "a whole turn of hue is the identity");
        let half = presented(&mut r, Master { hue: 0.5, ..Default::default() });
        assert!(!within(&hue0, &half, 2), "half a turn changes the colours");
        let white = presented(&mut r, Master { flash: 1.0, ..Default::default() });
        assert!(white.chunks(4).all(|p| p[..3] == [255, 255, 255]), "flash = 1 is white");
    }

    #[test]
    fn master_mirrors() {
        let Some((mut r, _)) = spiral(20) else { return };
        let (w, h) = (W as usize, H as usize);
        let at = |p: &[u8], x: usize, y: usize| p[(y * w + x) * 4..(y * w + x) * 4 + 3].to_vec();
        let symmetric_x = |p: &[u8]| (0..h).all(|y| (0..w).all(|x| within(&at(p, x, y), &at(p, w - 1 - x, y), 1)));
        let symmetric_y = |p: &[u8]| (0..h).all(|y| (0..w).all(|x| within(&at(p, x, y), &at(p, x, h - 1 - y), 1)));
        let plain = presented(&mut r, Master::default());
        assert!(!symmetric_x(&plain), "the spiral is not symmetric to begin with");
        let x = presented(&mut r, Master { mirror: Mirror::X, ..Default::default() });
        assert!(symmetric_x(&x));
        let quad = presented(&mut r, Master { mirror: Mirror::Quad, punch: 0.5, ..Default::default() });
        assert!(symmetric_x(&quad) && symmetric_y(&quad));
    }

    #[test]
    fn fade_shows_the_outgoing_snapshot() {
        let Some((mut r, mut audio)) = spiral(20) else { return };
        assert!(presented(&mut r, Master { fade: 1.0, ..Default::default() }).chunks(4).all(|p| p[..3] == [0, 0, 0]), "black before any snapshot");
        let kept = r.read_back();
        r.keep_outgoing();
        for _ in 0..10 {
            frame(&mut r, &mut audio);
        }
        assert!(!within(&r.read_back(), &kept, 1), "the picture has moved on");
        assert!(within(&presented(&mut r, Master { fade: 1.0, ..Default::default() }), &kept, 1));
    }

    #[test]
    fn trails_echo_without_brightening() {
        let Some((mut r, mut audio)) = spiral(20) else { return };
        r.set_trails(0.9);
        frame(&mut r, &mut audio);
        let mut previous = r.read_back();
        for _ in 0..8 {
            frame(&mut r, &mut audio);
            let now = r.read_back();
            let ok = now.chunks(4).zip(previous.chunks(4)).all(|(n, p)| (0..3).all(|c| n[c] as i32 >= (p[c] as f32 * 0.9).floor() as i32 - 2));
            assert!(ok, "every pixel keeps at least 0.9 of the frame before");
            previous = now;
        }
        r.set_trails(5.0);
        assert_eq!(r.trails, 0.98);
    }

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

    /// The Spiral fixture at 64×36, run for `seconds` of real time at `hz`
    /// refreshes a second and `speed`, hearing the same tone throughout.
    fn run_at(hz: f64, speed: f64, seconds: f64) -> Option<Renderer> {
        run_with(hz, speed, seconds).map(|(r, _)| r)
    }

    /// [`run_at`], and the audio it heard, to carry on with.
    fn run_with(hz: f64, speed: f64, seconds: f64) -> Option<(Renderer, Audio)> {
        let (device, queue) = headless()?;
        let mut r = Renderer::new(device, queue, W, H);
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/milk/Fixture - Spiral Test.milk")).unwrap();
        r.load(&text, 1).unwrap();
        let mut audio = Audio::default();
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.05).sin() * 0.8).collect();
        for _ in 0..(seconds * hz).round() as usize {
            audio.update(&tone, &tone);
            r.render(&mut audio, speed / hz);
        }
        Some((r, audio))
    }

    fn mean_difference(a: &[u8], b: &[u8]) -> f64 {
        a.iter().zip(b).map(|(&x, &y)| (x as f64 - y as f64).abs()).sum::<f64>() / a.len() as f64
    }

    #[test]
    fn a_second_is_thirty_steps_at_any_refresh_rate() {
        let Some(at30) = run_at(30.0, 1.0, 1.0) else { return };
        assert_eq!((at30.steps(), at30.clock.frame), (30, 30), "the equations run once a step, 30 times a second");
        let picture = at30.read_back();
        for hz in [60.0, 120.0, 144.0] {
            let r = run_at(hz, 1.0, 1.0).unwrap();
            assert_eq!((r.steps(), r.clock.frame), (30, 30), "{hz} Hz");
            // Motion, decay, waves and shapes are fed back once a step whatever the
            // display does in between: the same picture, to the bit.
            assert!(r.read_back() == picture, "{hz} Hz draws a different picture after a second");
        }
    }

    #[test]
    fn speed_scales_the_preset_clock() {
        let Some(half) = run_at(120.0, 0.5, 2.0) else { return };
        assert_eq!(half.steps(), 30, "half speed: 30 steps in 2 s");
        let at30 = run_at(30.0, 1.0, 1.0).unwrap();
        let time = |r: &Renderer| r.runner.as_ref().unwrap().get("time");
        assert_eq!(time(&half), time(&at30), "the preset's time ran at half speed");
        assert!(half.read_back() == at30.read_back(), "the same steps, so the same picture");
        let double = run_at(60.0, 2.0, 0.5).unwrap();
        assert_eq!(double.steps(), 30);
        assert!(double.read_back() == half.read_back());
    }

    #[test]
    fn between_steps_the_picture_moves_on_without_a_jump() {
        let Some(on) = run_at(30.0, 1.0, 1.0) else { return };
        let step = on.read_back();
        // 29 steps and nearly all of the 30th, at 120 Hz.
        let (mut r, mut audio) = run_with(120.0, 1.0, 29.0 / 30.0).unwrap();
        let mut at = |r: &mut Renderer, steps: f64| {
            r.render(&mut audio, steps / PRESET_RATE);
            r.read_back()
        };
        let quarter = at(&mut r, 0.25);
        let nearly = at(&mut r, 0.74);
        assert_eq!(r.steps(), 29);
        assert!(mean_difference(&nearly, &step) < 1.5, "just short of a step is nearly that step: {}", mean_difference(&nearly, &step));
        assert!(mean_difference(&quarter, &step) > mean_difference(&nearly, &step), "a quarter of the way is further from it");
        let landed = at(&mut r, 0.01);
        assert_eq!(r.steps(), 30);
        assert!(landed == step, "landing on the step is the step");
    }

    /// A white square sliding right at a steady 1.5 widths a second of preset
    /// time, on black: its warp shader draws black, so it leaves no trail.
    const SLIDE: &str = "[preset00]
MILKDROP_PRESET_VERSION=201
PSVERSION=2
fGammaAdj=1.0
fWaveAlpha=0.0
zoom=1.0
rot=0.0
warp=0.0
mv_a=0.0
shapecode_0_enabled=1
shapecode_0_sides=4
shapecode_0_x=0.1
shapecode_0_y=0.5
shapecode_0_rad=0.04
shapecode_0_r=1
shapecode_0_g=1
shapecode_0_b=1
shapecode_0_a=1
shapecode_0_r2=1
shapecode_0_g2=1
shapecode_0_b2=1
shapecode_0_a2=1
shapecode_0_border_a=0
shape_0_per_frame1=x = 0.1 + time*1.5;
warp_1=`shader_body {
warp_2=`ret = 0;
warp_3=`}
";

    /// A comp shader that brightens the whole picture steadily with `time`.
    const RAMP: &str = "[preset00]
MILKDROP_PRESET_VERSION=201
PSVERSION=2
fDecay=0.0
fWaveAlpha=0.0
comp_1=`shader_body {
comp_2=`ret = float3(1,1,1) * saturate(0.05 + time);
comp_3=`}
";

    /// `text` drawn at 256×144, `hz` refreshes a second at `speed`: 3 steps, then
    /// each refresh over the next `steps`, measured by `measure`.
    fn each_refresh(text: &str, hz: f64, speed: f64, steps: f64, measure: impl Fn(&[u8]) -> f64) -> Option<Vec<f64>> {
        let (device, queue) = headless()?;
        let mut r = Renderer::new(device, queue, 256, 144);
        r.load(text, 1).unwrap();
        let mut audio = Audio::default();
        let per = speed / hz;
        let warm = (3.0 / PRESET_RATE / per).round() as usize;
        let mut out = Vec::new();
        for i in 0..warm + (steps / PRESET_RATE / per).round() as usize {
            r.render(&mut audio, per);
            if i >= warm {
                out.push(measure(&r.read_back()));
            }
        }
        Some(out)
    }

    /// How far each refresh's change is from the mean change: 0 for perfectly
    /// even motion.
    fn unevenness(values: &[f64]) -> f64 {
        let moves: Vec<f64> = values.windows(2).map(|w| w[1] - w[0]).collect();
        let mean = moves.iter().sum::<f64>() / moves.len() as f64;
        moves.iter().map(|m| (m - mean).abs()).fold(0.0, f64::max)
    }

    /// Where the bright pixels are across, in pixels: the square, not the faint
    /// picture of it a refresh between steps carries on from (the warp's black
    /// is mixed in by the fraction).
    fn across(pixels: &[u8]) -> f64 {
        let (mut sum, mut n) = (0.0f64, 0.0f64);
        for (i, p) in pixels.chunks(4).enumerate() {
            if p[0] as u32 + p[1] as u32 + p[2] as u32 > 3 * 160 {
                sum += (i % 256) as f64;
                n += 1.0;
            }
        }
        sum / n.max(1.0)
    }

    fn brightness(pixels: &[u8]) -> f64 {
        pixels.chunks(4).map(|p| p[0] as f64).sum::<f64>() / (pixels.len() / 4) as f64
    }

    #[test]
    fn between_steps_motion_is_even_at_every_refresh_rate_and_speed() {
        // A step moves the square 1.5 × 256 / 30 = 12.8 px and brightens the
        // ramp by 255 / 30 = 8.5 levels. Drawn as a jump at one refresh in the
        // step (or a cross-fade, which flips at half way), some refreshes would
        // move a whole step and the rest nothing: off the mean by most of a step.
        // Even, each refresh moves its share, off the mean by no more than the
        // rounding to whole pixels (the square's edges, ±½ px each end) and
        // 8-bit levels.
        for (hz, speed) in [(60.0, 1.0), (120.0, 1.0), (60.0, 0.25), (120.0, 0.25), (60.0, 4.0), (120.0, 4.0)] {
            let Some(xs) = each_refresh(SLIDE, hz, speed, 10.0, across) else { return };
            assert!((xs[xs.len() - 1] - xs[0]) > 60.0, "{hz} Hz at {speed}×: the square moved across");
            let off = unevenness(&xs);
            assert!(off < 1.5, "{hz} Hz at {speed}×: a refresh moves the square {off:.2} px off the mean");
            let levels = each_refresh(RAMP, hz, speed, 10.0, brightness).unwrap();
            assert!((levels[levels.len() - 1] - levels[0]) > 40.0, "{hz} Hz at {speed}×: the ramp brightened");
            let off = unevenness(&levels);
            assert!(off < 1.5, "{hz} Hz at {speed}×: a refresh brightens the ramp {off:.2} levels off the mean");
        }
    }

    #[test]
    fn stage_previews_and_live_values() {
        let Some((device, queue)) = headless() else { return };
        let mut r = Renderer::new(device, queue, 256, 192);
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/milk/Fixture - Spiral Test.milk")).unwrap();
        r.load(&text, 1).unwrap();
        assert!(r.read_previews().is_none(), "off until asked for");
        r.set_previews(true);
        let mut audio = Audio::default();
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.05).sin() * 0.8).collect();
        for _ in 0..30 {
            audio.update(&tone, &tone);
            r.render(&mut audio, 1.0 / 60.0);
        }
        let pixels = r.read_previews().unwrap();
        let each = (PREVIEW.0 * PREVIEW.1 * 4) as usize;
        assert_eq!(pixels.len(), each * PREVIEWS.len());
        let comp = &pixels[each * 3..];
        assert!(comp[..each].chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0), "comp's preview has a picture");
        let lit = |which: usize| pixels[each * which..each * (which + 1)].chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0);
        let drew: Vec<&str> = (4..PREVIEWS.len()).filter(|&w| lit(w)).map(|w| PREVIEWS[w]).collect();
        assert!(!drew.is_empty(), "some drawing stage's preview has its drawing");
        let off: Vec<&str> = (0..4).filter(|i| r.runner.as_ref().unwrap().waves[*i].is_none()).map(|i| PREVIEWS[4 + i]).collect();
        assert!(off.iter().all(|w| !drew.contains(w)), "a wave that is off draws nothing: {drew:?}");

        assert!(r.set_value(crate::runtime::Owner::Base, "fDecay", 0.5));
        r.render(&mut audio, 1.0 / 60.0);
        assert_eq!(r.runner.as_ref().unwrap().base_value("decay"), 0.5);
        assert_eq!(r.runner.as_ref().unwrap().preset.values["fDecay"], 0.5);
        assert!(!r.set_value(crate::runtime::Owner::Waves(0), "enabled", 1.0), "turning a wave on needs a reload");
    }
}
