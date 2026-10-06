# The MilkDrop engine

A plan, not a record. It replaces the colour-at-a-point engine described in
[flows](flows.md) and [render](render.md); neither is preserved. See [MilkDrop](milkdrop.md)
for what ships today, which is Butterchurn drawing inside the old compositor.

## The north star

**The node library is MilkDrop complete.** Anything a `.milk` preset can say, a flow can
say. Then the Cream of the Crop pack is imported as flows, and each one draws what the
same preset draws in the BlackHole visualizer — on our engine, not Butterchurn's.

- **Identical is Ryan's call.** The engine targets a similarity score internally, so work
  can tell when it is getting close; a preset is *done* when Ryan approves its side by
  side in the harness. The approval is recorded per preset.
- **The reference is Butterchurn 2.6.7**, because that is what the BlackHole visualizer
  is. Where Butterchurn is wrong — the shaders that fall back to its default — the
  harness says so, and Ryan decides which one is right.
- **Export to `.milk` is out of scope.** Imports keep the original text so it stays
  possible.
- **The old engine and its flows are abandoned**, not migrated. Versions of them may be
  rebuilt on the new nodes later.
- **Audio is a node.** The MVP source is an audio interface or BlackHole. The Live bridge
  stays, as a node that provides sound and set facts; identical output needs the same
  samples, so a signal synthesised from meters can never be the reference.

## Performance: 60 fps at 4K

4K is 8.3 megapixels, and MilkDrop touches each of them several times a frame: the warp
pass reads the previous frame, the blur pyramid reads it again, the comp shader reads all
of it, and Butterchurn regenerates mipmaps of the 4K feedback buffer every frame. So at
4K the frame is **GPU bound**, and the language the CPU half is written in is not what
decides 60 fps. What decides it is how many full-resolution passes there are and what
each one costs.

### Rust, and where it runs

**Recommendation: write the engine in Rust on `wgpu`, and run the same crate two ways.**

- **In the app**, compiled to WebAssembly and drawing through WebGPU inside the existing
  Electron windows. The wall, the keystone, the display list, the console's node pictures
  and the harness all keep working, and there is one renderer, not one per window type.
- **Natively**, as a `winit` window on Metal, from the same code. Built from the start
  and benchmarked against the WebGPU build, so if Chromium's overhead turns out to matter
  at 4K, moving the wall to a native window is a deployment change rather than a rewrite.

Why Rust and `wgpu` rather than staying on WebGL 2:

- **Compute shaders.** The blur pyramid, wave points and per-vertex warp can run as
  compute work. WebGL 2 has none.
- **Control over the frame.** Explicit render passes, persistent mapped buffers, no
  automatic mipmap regeneration of the feedback buffer, and real frame pacing.
- **A shader path that is not broken.** MilkDrop's HLSL goes HLSL → SPIR-V (glslang's
  HLSL front end) → `naga` → MSL / WGSL, offline, when a preset is imported. That replaces
  the Emscripten converter whose bugs `server/hlsl.ts` exists to work around. Translation
  happens once on import, so nothing native has to run inside WebAssembly.
- **The EEL equations** compile to a compact bytecode run by a register VM in Rust, or to
  WebAssembly functions in the WebAssembly build. Both are tested against the same EEL
  semantics.

The risk is that this is a rewrite. That is why phase 1 is a measured spike, not the
engine.

### What moves to the GPU, node by node

| node | MilkDrop runs it | here |
|---|---|---|
| per-frame equations | CPU, once a frame | CPU. Scalar and tiny. |
| per-vertex equations | CPU, per mesh vertex | **GPU**, as a vertex/compute shader generated from the EEL — unless the preset writes `regNN` or `megabuf` across vertices, which is sequential and stays on the CPU. Decided per preset at import. |
| custom waves, per point | CPU, up to 512 points × 4 | **GPU compute** when the points do not carry state from one to the next; CPU otherwise. |
| custom shapes | CPU per instance, up to 1024 | per-instance equations on the CPU, **instanced** in one draw. |
| warp shader | GPU, mesh at feedback resolution | GPU. |
| blur 1–3 | GPU, six passes | **compute**, separable, at the reduced sizes MilkDrop itself uses. |
| comp shader | GPU, full resolution | GPU. The only full-resolution pass that must stay one. |
| audio analysis (FFT, `bass`/`mid`/`treb`, `_att`) | CPU | CPU, ported exactly — every preset reads it. |

## The graph is MilkDrop's pipeline

Nodes are MilkDrop's stages, not arithmetic. Equation and shader nodes hold code, kept
as written; their ports are the variables MilkDrop already names.

- **Sources:** audio input, the Live bridge, time.
- **Equations:** per-frame init, per-frame, per-vertex — EEL code, with `q1–q32` and the
  motion variables as ports, so a Live meter can be wired into `q5` or `zoom`.
- **Picture stages:** warp mesh + warp shader, waves ×4, built-in wave, shapes ×4, motion
  vectors, borders, darken centre, video echo, blur, comp shader, gamma and the output
  switches.
- **Resources:** the preset's own textures, and the fallback Butterchurn uses when a
  texture is missing — matching it means doing the same.

"MilkDrop complete" means what Butterchurn supports: MilkDrop 2 presets with shaders and
MilkDrop 1 presets without them, custom textures, and the title animation. The blend from
one preset to the next belongs to the wheel, not to a flow.

Breaking EEL and HLSL into arithmetic nodes is deliberately not the plan. A Cream preset
would become hundreds of nodes nobody could read, and matching Butterchurn would get
harder rather than easier.

## The harness

The tool for approving side by sides, built first because every later phase is measured
by it.

- **Live mode.** One window, two pictures: Butterchurn (the BlackHole visualizer's engine,
  vendored) and visual[flow], fed **the same audio frames** from one input, on the same
  preset. Split, side by side, wipe, and a difference view. Next and previous preset,
  search, and an **approve / reject / note** per preset that is saved.
- **Recorded mode.** A fixed audio file, fixed frame times and seeded randomness —
  Butterchurn's `rand()` and `rand_frame` patched to the same seed — rendered offline to
  frame sequences by both engines. Comparable frame for frame, repeatable, and what CI
  runs.
- **The internal target.** Recorded mode scores every preset with the structural metrics
  this repo already has (`frameMetrics.ts`, `structuralMetrics.ts`). The score is how work
  knows it is close; the approvals are what says it is done.

## Phases

0. **Harness and baseline.** Recorded mode with Butterchurn alone: render the pack, and
   profile where Butterchurn's frame goes at 4K on Ryan's machine — equations, mesh, each
   pass, mipmaps. The numbers that decide what to optimise.
1. **Spike.** The Rust crate draws one shader preset — warp, comp, feedback, blur — through
   WebGPU in Electron and through a native window, at 4K. Measured against phase 0.
   **Decision point:** confirm Rust/`wgpu`, and WebGPU versus native for the wall.
2. **Engine.** Every stage, the EEL VM, exact audio analysis, the import-time shader
   translation. Live mode in the harness.
3. **Importer.** `.milk` → flow JSON over the whole pack, recorded scores for all of it.
4. **Conformance.** Drive the score up, then Ryan's approvals.
5. **Editor**, then the Live bridge as a sound node and set facts as ports.

## Questions still open

- **Which machine is the 4K/60 target?** Phase 0 measures on it.
- **Is a native wall window acceptable** if it wins phase 1 — a separate window from the
  console, not drawn by Electron?
- **The Live bridge's sound.** It carries meters today, not audio. "A node that provides
  sound" means the bridge device sending PCM, which is bridge work in another repo.
