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
//! warp mesh at that fraction — cross-faded where it folds the picture — its
//! warp shader mixed in by it, its waves and
//! shapes slid that far from where the last step drew them, every shader
//! uniform that far from the last step's value to the next's), then blur and
//! comp. See "The preset clock" in docs/milkdrop-engine.md.

mod blur;
mod drawing;
mod gpu;
mod output;
mod stage;
mod textures;

use crate::audio::Audio;
use crate::draw::{Blend, DrawList, Topology};
use crate::fx::Master;
use crate::runtime::{Clock, Mesh, Runner, Size, PRESET_RATE};
use crate::shader::{self, Kind};
use blur::{blur_size, BLUR, BLUR_RATIOS};
use drawing::{upload, DRAW};
use gpu::{begin, bind, buffer, grid, pipeline, quad, quad_pass, read_targets, Samplers, Target};
use output::{Trails, BLIT};
use stage::{warp_layout, Stage, COMP_VS, WARP_VS};
use std::borrow::Cow;
use std::collections::HashMap;
use textures::{clouds, noise_data, texture};

/// What the feedback loop is stored in. Butterchurn's targets are 8-bit RGBA.
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const COMP_GRID: (usize, usize) = (32, 24);

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
    /// The mesh between steps: for the moved picture and for the warp shader
    /// mixed over it ([`Mesh::between`]).
    display_uvs: wgpu::Buffer,
    display_shaded_uvs: wgpu::Buffer,
    /// The previous picture moved by the mesh alone, under the warp shader's mix.
    transport: wgpu::RenderPipeline,
    /// The last step's warp before its drawing: what a refresh between steps
    /// moves on, under the drawing between ([`Renderer::show`]).
    bare: Target,
    /// What textured shapes sample between steps ([`MIX`]), made the first time
    /// one is drawn there; its pass and fraction.
    textured_source: Option<Target>,
    mix: wgpu::RenderPipeline,
    mix_uniform: wgpu::Buffer,
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
    samplers: Samplers,
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
    /// Small copies of the stages' pictures an editor asked for, by [`PREVIEWS`]
    /// index (`None` where not asked for); empty when it asked for none.
    previews: Vec<Option<Target>>,
}

/// The base size of a stage's preview picture: what a node shows at 1×, and
/// the size [`Renderer::set_previews`] is usually asked for.
pub const PREVIEW: (u32, u32) = (192, 108);
/// The largest preview picture [`Renderer::set_previews`] keeps (4× [`PREVIEW`]):
/// a node at the graph's full zoom on a 2× display, about. A larger ask is
/// clamped to it, so a read stays at most 1.3 MB a picture.
pub const PREVIEW_MAX: (u32, u32) = (768, 432);
/// The stages that have a picture, in the order [`Renderer::read_previews`] packs them:
/// the warp's output, the feedback after waves and shapes, blur 1 and comp; then what
/// each drawing stage drew this frame, alone on black.
pub const PREVIEWS: [&str; 15] = [
    "warp", "feedback", "blur", "comp", "wave0", "wave1", "wave2", "wave3", "shape0", "shape1", "shape2", "shape3", "wave",
    "motion", "border",
];

/// The last step's picture moved by the warp mesh and nothing else: what a
/// refresh between steps mixes the preset's warp shader over.
const TRANSPORT: &str = "
struct In { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) uv_orig: vec2f, @location(2) color: vec4f }
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(i: In) -> @location(0) vec4f { return vec4f(textureSample(tex, smp, i.uv).rgb, 1.0); }";

/// Two same-sized pictures mixed by `k.x`, pixel for pixel: what a textured
/// shape samples between steps — the picture before the feedback, which the
/// last step's shapes sampled, mixed with the feedback, which the next step's
/// will — so its texture moves on with it rather than jumping at the first
/// refresh after a step.
const MIX: &str = "
struct Out { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  var o: Out;
  o.pos = vec4f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
@group(0) @binding(0) var a: texture_2d<f32>;
@group(0) @binding(1) var b: texture_2d<f32>;
@group(0) @binding(2) var<uniform> k: vec4f;
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let p = vec2i(o.pos.xy);
  return mix(textureLoad(a, p, 0), textureLoad(b, p, 0), k.x);
}";

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, width: u32, height: u32) -> Self {
        let size = Size { texsize_x: width as f64, texsize_y: height as f64, mesh_width: 48, mesh_height: 36 };
        let (noise, rng) = noise_data();
        let mut textures = HashMap::new();
        for (name, data, side, depth) in noise {
            textures.insert(name, texture(&device, &queue, &data, side, depth));
        }
        // Butterchurn's stand-in for any texture a preset names and it does not
        // have: a 128×128 photograph of clouds, shipped inside Butterchurn (MIT).
        textures.insert("image", texture(&device, &queue, &clouds(), 128, 1));
        let samplers = Samplers::new(&device);

        let wgsl = |source: &str| device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(Cow::Owned(source.to_owned())) });
        let warp_vs = wgsl(WARP_VS);
        let comp_vs = wgsl(COMP_VS);
        let blur_shader = wgsl(BLUR);
        let blit_shader = wgsl(BLIT);
        let draw_shader = wgsl(DRAW);
        let blur_h = quad(&device, "horizontal", &blur_shader, "horizontal", FORMAT);
        let blur_v = quad(&device, "vertical", &blur_shader, "vertical", FORMAT);

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
        let mix_shader = wgsl(MIX);
        let mix = quad(&device, "mix", &mix_shader, "fs", FORMAT);
        let mix_uniform = buffer(&device, &[0u8; 16], wgpu::BufferUsages::UNIFORM);
        let display_shaded_uvs = buffer(&device, bytemuck::cast_slice(&vec![[0f32; 2]; warp_grid.len()]), vertex);
        let transport_fs = wgsl(TRANSPORT);
        let transport = pipeline(&device, Some("transport"), (&warp_vs, "main", &warp_layout()), wgpu::PrimitiveTopology::TriangleList, (&transport_fs, "fs"), FORMAT.into());
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
            display_shaded_uvs,
            transport,
            bare: Target::new(&device, full, "warp before drawing"),
            textured_source: None,
            mix,
            mix_uniform,
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
            previews: Vec::new(),
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
        // The preset's shader, else (none, or one that will not compile) the default.
        let mut compile = |kind: Kind, text: &str, default: &str| {
            if text.trim().is_empty() {
                return self.stage(kind, default);
            }
            self.stage(kind, text).or_else(|e| {
                loaded.fell_back.push((kind, e.to_string()));
                self.stage(kind, default)
            })
        };
        let warp = compile(Kind::Warp, &warp_text, shader::DEFAULT_WARP);
        let comp = compile(Kind::Comp, &comp_text, shader::DEFAULT_COMP);
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
            // Kept for the refreshes before the next step (`show`).
            self.feedback[self.current].copy_to(&mut encoder, &self.bare);
        }
        let (target, previous) = (&self.feedback[self.current].view, &self.feedback[self.current ^ 1].view);
        self.draw(&mut encoder, &self.draw_list, self.draw_buffer.as_ref(), target, previous, wrap, true);
        self.preview(&mut encoder, 1, &self.feedback[self.current].view);
        self.queue.submit([encoder.finish()]);
    }

    /// The picture at `fraction` of the way into the next step, through comp.
    /// At 0 it is the feedback as it stands. Otherwise it is drawn, never fed
    /// back: the last step's warp before its drawing, moved by the next step's
    /// mesh at that fraction ([`Mesh::between`]), with the preset's warp shader
    /// on the feedback — drawing and all — mixed over it by the fraction, then
    /// its own blur, then the drawing between the two steps'
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
            let (mut moved, mut shaded) = (Vec::new(), Vec::new());
            self.mesh.between(fraction as f64, &mut moved, &mut shaded);
            self.queue.write_buffer(&self.display_uvs, 0, bytemuck::cast_slice(&moved));
            self.queue.write_buffer(&self.display_shaded_uvs, 0, bytemuck::cast_slice(&shaded));
            let mut list = std::mem::take(&mut self.between_list);
            crate::draw::between(&self.shown_list, &self.draw_list, fraction, &mut list);
            upload(&self.device, &self.queue, &list, &mut self.between_buffer);
            for cmd in &list.cmds {
                self.draw_pipeline(cmd.topology, cmd.blend);
            }
            self.between_list = list;
            let fed = &self.feedback[self.current].view;
            // Both ends are linear in the fraction: at 0 the last step's warp
            // with the drawing between (then the last step's own) over it, which
            // is the feedback; at 1 the next step's warp of the feedback, drawing
            // and all, with the next step's drawing over it. So the last step's
            // drawing fades into the trail it leaves as its copy moves on.
            let bare = if self.shown_list.cmds.is_empty() { fed } else { &self.bare.view };
            {
                let warp = self.warp.as_ref().unwrap();
                let mixed = warp.mixed.as_ref().unwrap();
                let moved = bind(&self.device, &self.transport, &[wgpu::BindingResource::TextureView(bare), wgpu::BindingResource::Sampler(self.samplers.linear(wrap))]);
                let shaded = self.bind_group(warp, mixed, fed, wrap, false);
                let mut pass = begin(&mut encoder, &self.display.view, true);
                pass.set_pipeline(&self.transport);
                pass.set_bind_group(0, &moved, &[]);
                self.mesh_draw(&mut pass, &self.display_uvs);
                let f = fraction as f64;
                pass.set_blend_constant(wgpu::Color { r: f, g: f, b: f, a: f });
                pass.set_pipeline(mixed);
                pass.set_bind_group(0, &shaded, &[]);
                self.mesh_draw(&mut pass, &self.display_shaded_uvs);
            }
            self.blur(&mut encoder, &self.display.view, true);
            let textured = self.between_list.vertices.iter().any(|v| v.textured > 0.5);
            if textured {
                let target = self.textured_source.get_or_insert_with(|| Target::new(&self.device, self.feedback[0].size, "textured between steps"));
                self.queue.write_buffer(&self.mix_uniform, 0, bytemuck::cast_slice(&[fraction, 0.0, 0.0, 0.0]));
                let view = wgpu::BindingResource::TextureView;
                let group = bind(&self.device, &self.mix, &[view(&self.feedback[self.current ^ 1].view), view(&self.feedback[self.current].view), self.mix_uniform.as_entire_binding()]);
                quad_pass(&mut encoder, &target.view, &self.mix, &group);
            }
            let sampled = if textured { &self.textured_source.as_ref().unwrap().view } else { &self.feedback[self.current].view };
            self.draw(&mut encoder, &self.between_list, self.between_buffer.as_ref(), &self.display.view, sampled, wrap, false);
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
        self.comp.copy_to(&mut encoder, &self.outgoing);
        self.queue.submit([encoder.finish()]);
    }

    /// Change one of the running preset's values without reloading it. Returns
    /// false when the change needs a reload (a wave or shape turned on or off).
    pub fn set_value(&mut self, owner: crate::runtime::Owner, key: &str, value: f64) -> bool {
        self.runner.as_mut().is_some_and(|r| r.set_value(owner, key, value))
    }

    /// Keep pictures of the stages `wanted` ([`PREVIEWS`] indices; others are
    /// ignored) at `size`, for [`Renderer::read_previews`]; none stops them.
    /// The size is clamped to 1×1..[`PREVIEW_MAX`]. Pictures already kept at
    /// that size are kept on; a new size makes them all afresh.
    pub fn set_previews(&mut self, wanted: &[usize], size: (u32, u32)) {
        let size = (size.0.clamp(1, PREVIEW_MAX.0), size.1.clamp(1, PREVIEW_MAX.1));
        if wanted.iter().all(|&w| w >= PREVIEWS.len()) {
            self.previews.clear();
            return;
        }
        self.blit_pipeline(FORMAT);
        let mut kept = std::mem::take(&mut self.previews);
        kept.resize_with(PREVIEWS.len(), || None);
        self.previews = kept
            .into_iter()
            .enumerate()
            .map(|(i, old)| {
                wanted.contains(&i).then(|| old.filter(|t| t.size == size).unwrap_or_else(|| Target::new(&self.device, size, PREVIEWS[i])))
            })
            .collect();
    }

    /// The stage pictures asked for ([`Renderer::set_previews`]): RGBA rows top
    /// to bottom, one after another in [`PREVIEWS`] order. Waits for the GPU.
    pub fn read_previews(&self) -> Option<Previews> {
        let kept: Vec<(usize, &Target)> = self.previews.iter().enumerate().filter_map(|(i, t)| Some((i, t.as_ref()?))).collect();
        let size = kept.first()?.1.size;
        let targets: Vec<&Target> = kept.iter().map(|(_, t)| *t).collect();
        // Blitted picture side up, so row 0 is already the top.
        let pixels = read_targets(&self.device, &self.queue, &targets, false)?;
        Some(Previews { size, which: kept.iter().map(|(i, _)| *i).collect(), pixels })
    }

    /// Draw the finished picture into `view`, a window's surface, scaled to fit,
    /// through the master pass, so the live effects ([`Renderer::set_master`])
    /// are on every picture presented.
    pub fn present(&mut self, view: &wgpu::TextureView, format: wgpu::TextureFormat) {
        if !self.masters.contains_key(&format) {
            self.masters.insert(format, quad(&self.device, "master", &self.master_shader, "fs", format));
        }
        self.queue.write_buffer(&self.master_uniform, 0, bytemuck::cast_slice(&crate::fx::uniforms(&self.master)));
        let pipeline = &self.masters[&format];
        let texture = wgpu::BindingResource::TextureView;
        let group = bind(
            &self.device,
            pipeline,
            &[texture(&self.comp.view), texture(&self.outgoing.view), wgpu::BindingResource::Sampler(&self.samplers.linear_clamp), self.master_uniform.as_entire_binding()],
        );
        let mut encoder = self.device.create_command_encoder(&Default::default());
        quad_pass(&mut encoder, view, pipeline, &group);
        self.queue.submit([encoder.finish()]);
    }

    /// The finished picture, read back as RGBA rows top to bottom — for tests and
    /// the harness.
    pub fn read_back(&self) -> Vec<u8> {
        // GL orientation: the last row is the top of the picture.
        read_targets(&self.device, &self.queue, &[&self.comp], true).expect("mapped")
    }
}

/// Stage pictures read back by [`Renderer::read_previews`].
pub struct Previews {
    /// Each picture's width and height.
    pub size: (u32, u32),
    /// Which stages, as [`PREVIEWS`] indices, ascending: the order of `pixels`.
    pub which: Vec<usize>,
    /// Each picture's RGBA rows, top to bottom, one picture after another.
    pub pixels: Vec<u8>,
}

/// A device for rendering without a window — tests and the harness.
pub fn headless() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).ok()?;
    pollster::block_on(adapter.request_device(&Default::default())).ok()
}

#[cfg(test)]
mod tests;
