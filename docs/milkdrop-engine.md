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

## Where it is: the proof of concept

`engine/` is a Rust crate that reads `.milk` files and draws them on wgpu — Metal on a
Mac — with no Butterchurn and no browser in the path.

```sh
cd engine
cargo test --lib                                    # unit tests, including one GPU render
cargo run --release --bin play -- [folder|files] [--input BlackHole] [--channels 1,2] [--every 30]
cargo run --release --bin snapshot -- preset.milk 240 out.png 1280x720
cargo run --release --bin check                     # every preset: equations and shaders compile
cargo run --release --bin gpucheck                  # every preset: loads and draws on the GPU
cargo run --release --bin explain -- preset.milk comp   # why one shader does not compile
```

`play` opens a window, listens to any input — BlackHole is one — and plays the library:
→/space next, ← previous, R random, F fullscreen.

### The editor app

```sh
npm run app          # cargo tauri dev in app/src-tauri; the page's vite on $PORT, or a free port
```

`app/` is the Tauri shell. The page (`app/src`, React and the widgets' `Graph`) is the
editor: the library on the left, the preset as MilkDrop's stage graph, and the selected
stage's EEL/HLSL and numbers on the right. Every edit reloads the preset on the bench
within a quarter second, and problems come back per stage and line — a broken equation
leaves the last good preset drawing, a broken shader draws MilkDrop's default.

**Playlists and live actions.** A playlist is a named, ordered list of presets, kept in
`~/.openflow/visuals/playlists.json` (`OPENFLOW_VISUALS_PLAYLISTS` overrides) with paths
relative to the library, so the library can move (`playlists.rs`). The page's
*playlists* tab beside the library creates, renames, deletes and edits them; `+` on a
library row adds to the selected one. Playing a playlist makes it active: ← → and random
step through it instead of the library, and auto-advance moves on every N seconds.

Everything that changes what plays live goes through one layer, `actions.rs`: an
`Action` enum — `next`, `previous`, `random`, `go {index}`, `load {playlist, index}`
(playlists by their position in the file), `unload`, `auto {on}` (null toggles),
`seconds {seconds}` — and `actions::dispatch(&AppHandle, Action)`, callable from any
thread. It moves the live state (the pure `decide`), opens the preset on the bench and
emits a `live` event (`{deck, opened, path, error}`) that the page follows, whoever sent
the action: the page (`act` command), the auto-advance thread, or a controller. A MIDI or
CC mapping only translates messages into actions and calls `dispatch`. Without an active
playlist, `next`/`previous` step through the whole library; the page's own ← → keep
stepping through its search results.

The bench is not drawn by the page. `app/src-tauri/src/bench.rs` puts a native `NSView`
under the webview's content, makes a wgpu surface on it and draws on its own thread,
paced by the display; the page leaves a transparent hole and reports its rectangle
(`place_bench`). The engine and the app share one Cargo workspace at the repository
root, so the engine's tests also run from there as `cargo test -p visuals-engine`.

| module | is |
|---|---|
| `preset` | the `.milk` reader, code kept as written |
| `shader` | MilkDrop HLSL → glslang → SPIR-V → naga, with the rewrites below |
| `eel` | the equation language: MilkDrop's grammar, Butterchurn's arithmetic |
| `runtime` | Butterchurn's equation runner — which variables carry, which reset — the clock and the warp mesh |
| `audio`, `noise` | Butterchurn's FFT and levels, and its noise textures, quirks included |
| `draw` | motion vectors, shapes, waves, the basic waveform, darken centre, borders |
| `render` | the frame: warp, blur pyramid, draw, comp, blit |

**On the whole Cream of the Crop pack (9,795 presets), 9,744 (99.48%) load and draw on
Metal with their own shaders** (`gpucheck`). Metal accepted every module naga validated.
The rest are punted for now: 45 draw with MilkDrop's default for one shader — vector-size
mismatches D3D9 truncated silently, user functions called with the wrong vector size,
functions missing a `return`, one naga bug in a helper — and 6 have equations too garbled
to parse (an undefined `_aboeq()`, `0 = …`, stray prose).

Not yet: blending from one preset to the next, mipmaps on the feedback and blur textures
(Butterchurn samples them mipmapped), the song-title text, per-pass GPU timings, and the
side-by-side harness.

## Performance: 60 fps at 4K

4K is 8.3 megapixels, and MilkDrop touches each of them several times a frame: the warp
pass reads the previous frame, the blur pyramid reads it again, the comp shader reads all
of it, and Butterchurn regenerates mipmaps of the 4K feedback buffer every frame. So at
4K the frame is **GPU bound**, and the language the CPU half is written in is not what
decides 60 fps. What decides it is how many full-resolution passes there are and what
each one costs.

### A native Tauri app, rendering on Metal

**No WebGL anywhere in the product.** visual[flow] becomes a Tauri app — the shape the
BlackHole visualizer already has — with the engine as a Rust crate drawing on Metal.

- **`wgpu` on its Metal backend**, not raw Metal. MilkDrop is about twenty passes a frame,
  so `wgpu`'s overhead over hand-written Metal is noise against a 4K fill-rate budget; what
  it buys is a safe API, `naga` for shader translation, and compute. If a Metal-only
  feature is ever worth it, `wgpu`'s hal interop reaches the raw `MTLDevice` without a
  rewrite.
- **Native surfaces, webview controls.** The wall is a borderless `tao` window per
  display with its own Metal surface — no browser in the path, no throttling, real frame
  pacing. The console's large preview is a Metal surface under a transparent webview
  that draws the controls. Node pictures are rendered small by the engine and sent to the
  webview as raw bytes, the way the BlackHole visualizer sends audio.
- **Audio through CPAL**, the capture code the BlackHole visualizer already has: any Core
  Audio input, any two channels, a lock-free history the renderer reads each frame.
- **Shaders translated once, on import.** MilkDrop's HLSL → SPIR-V (glslang's HLSL front
  end) → `naga` → MSL, with the original text kept. That replaces the Emscripten converter
  `server/hlsl.ts` works around.
- **EEL compiled to a register-VM bytecode in Rust**, tested against Butterchurn's
  results for the same inputs; per-vertex and per-point equations that qualify are
  compiled to shader code instead (see below).
- **Link and the Live bridge move to Rust later** — `abl_link` bindings and a WebSocket
  client. The MVP needs neither: it listens to an audio input.

Why native rather than staying on WebGL 2: compute shaders for the blur and the wave
points; explicit passes with no automatic mipmap regeneration of a 4K feedback buffer;
frame pacing a browser does not give; and a shader path that is not broken.

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

## Measured so far

**Butterchurn at 4K on the target machine** (M1 Max, 32-core GPU; `npm run
harness:profile`). Measured through Chromium, because Butterchurn is a WebGL engine, so
the totals are distorted by Chromium's GPU process — its throughput reading is less than
its own comp pass. The stage shares are the useful part: **comp** is the largest cost
(~2.8 ms median at 4K), then **blur** (~0.8), then the feedback buffer's **mipmaps**
(~0.45); presets with many shape instances add up to 9 ms of CPU. No sampled preset came
near 16.6 ms. The native engine reads Metal's GPU timestamps per pass instead.

**The spike's target is 1080p.** 4K returns once the native engine is measured, with
the feedback loop below output resolution and an upscaler as the likely route.

**MilkDrop HLSL → SPIR-V → MSL works.** On 400 presets spread across Cream of the Crop
(662 shaders): glslang's HLSL front end then `naga` produced valid Metal for **635
(95.9%)**, against roughly one in ten that the Emscripten converter produced unpatched.
It takes five rewrites before glslang, each of which becomes a unit test in the engine's
translation module:

1. **MilkDrop's preamble** — its samplers, uniforms, `q1–q32`, `GetBlur1–3`, `lum` —
   declared the way MilkDrop declared them.
2. **Uniforms become mutable.** D3DX9 let a shader assign to a uniform; HLSL now does not.
   The uniforms live in a buffer under other names, with `static` copies under the real
   ones assigned at the top of `main`. A preset's own top-level variables are made
   `static` for the same reason.
3. **Samplers are split.** `naga` does not read DX9's combined `sampler2D`, so each is a
   `Texture2D` and a `SamplerState`, and `tex2D(s, uv)` becomes `s_tex.Sample(s_smp, uv)`.
   A preset declaring a sampler the preamble already has is not declared twice.
4. **Matrices are stored 4×4** in the buffer and cast to MilkDrop's `float4x3`, or the
   buffer's layout overlaps.
5. **Bindings are assigned automatically** (`--auto-map-bindings`), since every DX9
   resource otherwise lands on register 0.

What is left: `double` (to be rewritten as `float`) and a handful of presets with real
syntax errors, which MilkDrop's compiler tolerated and these do not.

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

- **Live mode.** One window, two pictures: Butterchurn and visual[flow], fed **the same
  audio frames** from one CPAL input, on the same preset. Butterchurn is the BlackHole
  visualizer's engine running in the harness's webview — the one place WebGL remains,
  as the thing being compared against, never as the product. Split, side by side, wipe,
  and a difference view. Next and previous preset, search, and an **approve / reject /
  note** per preset that is saved.
- **Recorded mode.** A fixed audio file, fixed frame times and seeded randomness —
  Butterchurn's `rand()` and `rand_frame` patched to the same seed — rendered offline to
  frame sequences by both engines: Butterchurn in headless Chromium on the GPU, ours
  natively. Comparable frame for frame, repeatable, and what CI runs.
- **The internal target.** Recorded mode scores every preset with the structural metrics
  this repo already has (`frameMetrics.ts`, `structuralMetrics.ts`). The score is how work
  knows it is close; the approvals are what says it is done.

### Recorded mode, as built

    npm run compare                          # 30 presets spread over the pack's folders
    npm run compare -- --sample 60 --frames 300 --captures 4 --size 960x540
    npm run compare -- cream-of-the-crop/Geometric/Cube  path/to/one.milk
    npm run compare -- --serve               # reopen the last report to approve

`harness/compare.ts` renders each preset twice from the same inputs: Butterchurn 2.6.7 in
headless Chromium on the GPU (a fresh page per preset; `.milk` converted as the app
converts it, through `server/presetWorker.ts` and its cache), and ours through
`engine/src/bin/compare.rs`, which reads the plan and audio the harness writes and
renders every preset on one device. Both run at once.

- **Audio.** A synthetic track (kick at 120 bpm, a chord, seeded hiss; left and right
  differ) turned into the three 1024-byte windows Butterchurn reads per frame. Butterchurn
  gets them through `render({audioLevels})`, ours through `Audio::update_bytes`: the same
  bytes, frame for frame.
- **Time.** A fixed 1/60 s step from a fresh renderer, so both clocks and fps estimates
  start equal.
- **Randomness.** The page's `Math.random` is the engine's xorshift64*. It is seeded with
  the engine's noise seed (`0x5eed`) before the visualizer is made, so the noise textures
  come from the same stream, and with the preset seed as the preset loads, so
  `rand_start`, `rand_preset` and the init equations start from the same numbers (the page
  checks `rand_start` and notes it if not).
- **Captures** at evenly spaced frames (default 80, 160, 240 of 240 at 640×360), read in the
  same task as the draw and flipped to top-down. Orientation was checked on
  `Wire Flat/fiShbRaiN - wave rider` and `Geiss - Game of Life`: the waveform rises to the
  right and the life clusters sit in the same places in both, with the same colours.
- **Score**, 0–100 per frame on a ≤320-wide copy, then the mean per preset: pixels 30%
  (`differenceOf`), silhouette IoU 20% and contour distance 20% (`structuralDifference`),
  regional colour 15% (`materialStructureDifference`), luma and coverage 15% (`metricsOf`).
- **Output.** `harness/out/compare/`: frame PNGs (Butterchurn, ours, |difference| × 2),
  `report.json` and `index.html` — worst first, sortable, filtered by score, verdict or
  name. The command serves it on a free port when run in a terminal (`--no-serve` skips);
  the server stops with the command.
- **Approvals** are `~/.openflow/visuals/compare/approvals.json` (under `OPENFLOW_HOME`),
  keyed by the preset's path in the pack, with the verdict, a note and the score it was
  given at. The page saves each click there; opened as a file it keeps them in the page
  and offers a download instead.

What cannot match, and so is noise in the score rather than an engine bug:

- **`rand_frame` and later `rand()`.** Butterchurn draws everything from one global stream
  — the blend pattern, `rand_frame` each pass, shapes', waves' and every frame's `rand()` —
  where the engine has a stream per preset, per shape, per wave and one for `rand_frame`.
  They agree up to the init equations and part after that.
- **`rand(n)` itself.** Butterchurn returns `Math.random() * floor(n)`, not floored; the
  engine floors. Presets that use it differ until the engine copies the quirk.
- **Shaders Butterchurn cannot link.** It draws black where MilkDrop draws its default; the
  bench compares with the default and says so on the preset, for Ryan to judge.
- **Unknown textures.** Butterchurn samples its `clouds2` image for any sampler it has no
  picture for. The bench waits for that image to load, as the app would have.
- **Chaotic feedback.** A preset that feeds back strongly turns float-level differences
  between WebGL and wgpu into different pictures within seconds; its first capture is
  the one to read.

Live mode is next: a CPAL input feeding the same byte windows to Butterchurn in the app's
webview and to the engine, one window with split, wipe and difference views, next and
previous, search, and the same approvals file through the same `/approvals` shape.

## Phases

0. **Harness and baseline.** Recorded mode with Butterchurn alone: render the pack, and
   profile where Butterchurn's frame goes at 4K on Ryan's machine — equations, mesh, each
   pass, mipmaps. The numbers that decide what to optimise.
1. **Spike.** A Tauri app whose Rust crate draws one shader preset — warp, comp, feedback,
   blur — on Metal at 4K, from a CPAL input. Measured against phase 0. **Decision point:**
   confirm `wgpu` over raw Metal, and the frame budget per pass.
2. **Engine.** Every stage, the EEL VM, exact audio analysis, the import-time shader
   translation. Live mode in the harness.
3. **Importer.** `.milk` → flow JSON over the whole pack, recorded scores for all of it.
4. **Conformance.** Drive the score up, then Ryan's approvals.
5. **Editor**, then the Live bridge as a sound node and set facts as ports.

## Questions still open

- **Which machine is the 4K/60 target?** Phase 0 measures on it.
- **The Live bridge's sound.** It carries meters today, not audio. "A node that provides
  sound" means the bridge device sending PCM, which is bridge work in another repo.

## Where it lives

In this repository, beside what it replaces until it can draw: `engine/` (the Rust
crate), `app/` (the Tauri shell and its webview UI) and `harness/`. The Electron app, the
Node server and the old engine are deleted in one change once the new app draws presets —
confirmed with Ryan before it happens.
