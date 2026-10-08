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
cargo run --release --bin gpucheck                  # a 250-preset sample loads and draws on the GPU (--all: every one)
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

**Live mode and the output.** The page's switch is *editor | compare | live* (the compare
view's own switch still has only the first two). Live mode is the show: entering it
opens the output, leaving it closes it — there is no output while editing. In live mode
the editor isn't rendered (no graph, no inspector) and stage previews are off
(`set_previews(false)`); the page shows a small preview of the bench, what's playing and
what's next in the playing playlist, previous / random / next (all through
`actions::act`, as a controller would), the playlists panel with play/stop and
auto-advance, the audio input, and the output's display picker and status. Keys: ← ↑
previous, → ↓ next, R random. Esc does nothing, so a stray key never stops the show;
⌘⇧L (or the switch) leaves live mode.

The output (`output.rs`) is a borderless native `NSWindow` with no webview, the size of
the chosen display (`NSScreen`), at the status window level so neither the menu bar nor
the Dock covers it. Its content is black with a layer-hosting view on a `CAMetalLayer`
placed at the preset's 16:9 fitted into the display (`output::fit`), so the bars are the
window's own black, and its surface is that rectangle in the display's pixels. The bench's
render thread presents every frame to both surfaces (`bench::Cmd::Output`): while the
output is open it presents with vsync and paces the loop, and the bench is reconfigured to
present without waiting (`AutoNoVsync`), so the picture is drawn at every refresh of the
output's display (see "The preset clock"). A bench hole of zero size hides the bench and it
isn't presented at all. The display is chosen in live mode and remembered in
`~/.openflow/visuals/output.json` (by id, then by name); with nothing chosen it is the first
display without the menu bar, else the main one. A display reconfiguration
(`CGDisplayRegisterReconfigurationCallback`) refits the output, or closes it cleanly when
its display has gone; the page shows "not showing" with a button to show it again.

Commands: `displays`, `output_open {id | null}`, `output_close`, `output_status`, and the
`output` event; `live_start` reads `VISUALS_LIVE`. Development: `VISUALS_LIVE=1` starts in
live mode (with `VISUALS_PRESET`, on that preset), `VISUALS_DISPLAY=<n>` sends the output
to display `n` (from 0, the system's order), and `VISUALS_CAPTURE_OUTPUT=<png>` saves the
output window beside `VISUALS_CAPTURE`'s main window.

**Link and the one.** `link.rs` is an Ableton Link peer (the `rusty_link` crate: the
official Link SDK through its C wrapper, built with cmake), the port of the old engine's
clock (`server/link.ts`, [the clock](clock.md), [the wheel](wheel.md)) with its rules kept.
**Visuals follow; they never drive**: the session state is only captured, never committed,
so nothing can set the tempo, the beat or the transport. Link is on at startup
(`VISUALS_LINK=0` starts it off) with start/stop sync listening, quantum 4. Bars are counted
from **the one**, a Link beat the app holds (Link's beat has no bar 1): *set one* takes the
nearest bar line by Link's *phase* (the coming one past half a bar), *nudge* moves it a beat
either way, *reset* puts it back on Link's own lines (beat 0). A Link transport start takes
the one from the bar line the music starts on (at or after the start time, as `show.ts`
waits for the phase to drop); the first read never counts, because a peer joining a session
already playing is not told so, and `playing` reads false until the next start or stop.

Preset changes on the beat: every 1 or 2 beats or 1–32 bars from the one, through
`actions::dispatch(Next)` (the playing playlist's next, or the library's). The scheduler
turns the next boundary's beat into Link's host time (`time_at_beat`) and sleeps to it, so a
change lands on the line; a boundary missed (a long load, the machine asleep) is skipped,
never made late. With no peers Link runs its own timeline at the last tempo, and the changes
carry on at that; Link off only leaves the network. Turning changes on turns time-based
auto-advance off. Not yet: the next preset is loaded *at* the boundary, so a slow compile
shows late — preloading it a beat early is the follow-up.

Commands: `link_state`, `link_enable {on}`, `link_set_one`, `link_nudge {beats}`,
`link_reset_one`, `link_sync {every, unit: "bars" | "beats"}` (0 is off), each returning the
frame; the `link` event carries it ten times a second (tempo, peers, playing, beat, phase,
one, bar, beatInBar, barPhase, every, next, at). The page's panel is `app/src/LinkPanel.tsx`.
Development: `VISUALS_LINK_EVERY=<bars>` starts with changes on, `VISUALS_LINK_LOG=1` prints
the frame every second and each change's beat.

Not yet: one output only (no mirroring to several displays); the presets still draw at
`bench::DRAW` (1920×1080) and are scaled to the display, so a 4K projector gets an
upscaled picture; on a single display the output covers the editor window, and only the
keys (⌘⇧L) get back out. The mouse cursor is hidden while it is over the output (a check
ten times a second on the main thread, as the output never becomes the key window; macOS
only hides it while the app is the active one).

**Live effects.** In live mode the page is a performance panel: big hits, a tempo, and
controls for the picture and time. Every effect is an `actions::Action` like `next`, sent
through `act` and `actions::dispatch`, so a MIDI mapping reaches them the same way; `on:
null` toggles, and momentary hits are `on: true` while held and `on: false` on release.
The state is `fx.rs` (`Fx`), shared with the render thread and sent to the page as the
`fx` event (`fx_state` to start). Values are clamped; nothing but the tempo is kept across
restarts (`~/.openflow/visuals/tempo.json`). Leaving live mode puts every picture and time
effect back to normal (`fx_reset`), keeping the tempo, sensitivity and settings.

| action | does | key |
|---|---|---|
| `speed {speed}` | a scale on the preset clock, ¼×–4× (a log slider, 1× at its centre): the preset makes 30 × speed steps a second, its motion, decay and `time` with them, while the picture is still drawn at every refresh | |
| `freeze {on}` | no frames are made, the picture holds; let go, it comes back up to speed over 0.4 s | F (hold), ⇧F latches |
| `transition {seconds}` | while the output is open, a new preset crossfades from a snapshot of the last one's picture over 0–10 s (2 by default; 0 cuts) | |
| `strobe {on}`, `strobe_rate {rate}`, `strobe_intensity {value}`, `strobe_style {style}` | flashes on the beat, 0.25–4 a beat: `white` over the picture, or `black` between flashes so the picture itself strobes | S (hold), ⇧S latches |
| `sync {source}` | what strobe and punch-on-beat follow: `tempo` or `audio` (beats heard in the bass: `bass` over 1.3 and 15% over `bass_att`, rising, at least 0.22 s apart) | |
| `blackout {on}`, `blackout_fade {seconds}` | to black and back, at once or over 0–10 s; a fade turned round mid-way goes back from where it is | B |
| `punch {on}`, `punch_on_beat {on}` | a kick: 12% zoom and 35% brighter, held while pressed and dying away over 0.15 s; on every beat too | P (hold) |
| `brightness {value}`, `hue {value}`, `invert {on}`, `mirror {mode}` | 0–2 ×; a hue turn 0–1; invert; `off`, `x`, `y`, `quad` (null steps through) | I, M |
| `trails {value}` | an echo on the finished picture: max(new, before × k), k 0.75–0.98 per 1/60 s of preset time (so the same at any refresh rate), kept in half floats | |
| `sensitivity {value}` | a gain of ¼×–4× (a log slider, 1× at its centre) on the samples the presets hear (waves and spectrum; `bass`/`mid`/`treb` are relative to their own average and settle back). At 1× a waveform is the size Butterchurn draws for the same input: samples become bytes as a browser's `AnalyserNode` makes them (`audio::to_byte`) | |
| `tap`, `bpm {bpm}` | the tempo: the mean gap of the last taps (a 2 s pause starts afresh), the beat on the last tap; or typed, 40–240 | T |
| `hold {on}` | locks the preset: next, previous, random, go, load and auto-advance do nothing (the page says so) | H |
| `bars {bars}` | auto-advance every N bars of four beats at the tempo instead of its seconds; 0 off | |
| `fx_reset` | everything above back to normal but the tempo, sensitivity, transition and strobe settings | 0 |

The engine draws them (`engine/src/fx.rs`): one **master pass** replaces the blit to the
window, so the bench and the output show the same thing. In order: mirror, punch zoom,
the outgoing snapshot by the transition's share, hue, invert, brightness and punch, flash
to white, then black. With nothing on it is a plain blit. Trails are a pass after comp,
only while on. Speed and freeze are the preset clock's (`bench.rs` passes the time × the
speed to `Renderer::render`); frozen, the clock stands still and the thread still
listens, so beats keep driving the strobe. Development: `VISUALS_FX='[{"kind":"mirror","mode":"quad"}, …]'` sends
those actions 5 s after start (`VISUALS_FX_AFTER`), for checking effects in a capture.

Not yet: auto-advance by bars is not aligned to the downbeat (it counts from the last
change); a transition started during another snapshots the incoming preset alone, not the
mix on screen; trails are an echo of the picture, not a change to the preset's own decay
(most presets' warp shaders never read `decay`).

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

Not yet: MilkDrop's own blend patterns from one preset to the next (live mode crossfades,
see "Live effects"), mipmaps on the feedback and blur textures
(Butterchurn samples them mipmapped), the song-title text, and per-pass GPU timings. The side-by-side harness is the app's
compare view (below, "Live mode, as built").

## The preset clock

MilkDrop presets move by a fixed amount per *frame*: zoom, rotation, the warp mesh, decay
and the feedback itself compound once a frame, so the frame rate is a preset's speed.
Winamp's MilkDrop 2 caps it at **30** by default (`m_max_fps_fs`, `m_max_fps_dm`,
`m_max_fps_w` in `vis_milk2/pluginshell.cpp`), which is the pace the presets were written
and are remembered at. The engine used to pin presets to 60, so everything ran twice that,
and slowing it down meant making fewer frames and mixing the last two.

Now the preset's clock and the picture's are separate (`runtime::PRESET_RATE`,
`Renderer::render(audio, seconds)`):

- **A step is MilkDrop's frame.** The preset advances `speed × 30 × dt` steps a refresh,
  fractional. Each whole step runs the per-frame and per-vertex equations once (their
  state accumulates per step, as in MilkDrop), the clock ticks 1/30 s of preset time (the
  preset's `time`, `frame` and `fps`, which reads 30), the audio levels move on once, and
  the feedback is fed back once: warp, blur, motion vectors, shapes, waves, borders. That
  loop never sees the refresh rate, so **a second of a preset is the same picture, to the
  bit, at 30, 60, 120 or 144 Hz**, and speed is a plain scale on it
  (`render::tests::a_second_is_thirty_steps_at_any_refresh_rate`,
  `speed_scales_the_preset_clock`). Decay, trails' density and brightness, zoom and
  rotation per second are the step loop's, so none of them depends on the display.
- **The picture is drawn at every refresh.** A refresh between steps draws, and never
  feeds back, the last step's feedback carried `f` of the way into the next step (`show`):
  1. the next step's warp mesh at fraction `f` (`runtime::Mesh::uvs`): each vertex's
     zoom and stretch to the power `f`, its rotation, translation and warp wobble times
     `f`, so the parts compose back to the whole — two half steps land within a quarter
     pixel of a whole one at 512 px on a preset that moves ~10 px a step
     (`runtime::tests::parts_of_a_step_compose_to_the_whole`);
  2. the preset's warp shader on that mesh, mixed over the plainly moved picture by `f`
     (a blend constant), so its colour work (decay, sharpening, `ret -= 0.004`…) comes in
     in proportion;
  3. its own blur of that picture, then the next step's drawing with its alpha × `f`;
  4. comp, at the next step's uniforms.

  Each part reaches the step's own picture as `f` reaches 1, so motion is continuous and
  a step lands without a jump (`between_steps_the_picture_moves_on_without_a_jump`).
- **The latency is one step at most.** To draw towards the next step its equations run at
  the first refresh after the step before, with the audio then. At a refresh landing on a
  step (30 Hz, or the harness) that is exactly MilkDrop's order; at 120 Hz a step's
  equations hear the audio up to 1/30 s × 1/speed before it is fed back.
- **Why not feed back every refresh, a fraction at a time?** Tried on paper and rejected:
  the feedback is 8-bit, as Butterchurn's is, and a fractional decay rounds back to where
  it was (`x × 0.98^¼` loses under half a level below `x ≈ 100`), so trails would stop
  fading at 120 Hz; every pass also resamples the picture bilinearly, so four passes a
  step blur it four times; and a warp shader's own colour work compounds per pass in ways
  a fraction can't undo. Feeding back once a step keeps all of that MilkDrop's.

What can't be split exactly, so is approximate between steps only (the steps themselves
are exact):

- **A warp shader that moves the picture itself** (`uv += …`, sampling at an offset) moves
  it the whole way at every refresh, mixed in by `f`: between steps that reads as a
  cross-fade to the next position rather than a slide. The mesh's own motion slides.
- **Colour work is mixed linearly**: a decay `d` shows as `1 − f(1 − d)` between steps
  rather than `d^f` (at `d = 0.98`, `f = ½`: 0.9900 against 0.98995).
- **Waves, shapes and motion vectors** are drawn where the next step puts them, faded in
  by `f`, not slid there: their equations run once a step and their points can't be
  interpolated in general. They change position 30 times a second, as in Winamp.
- **Comp's blur** between steps is of the picture between; the warp shader still reads the
  last step's blur, as the next step's warp will.
- **Speed above 1× on a slow display** makes several steps in one refresh, each fed back;
  only the last is shown.

Measured with the harness (below) on its default 30 presets, 240 frames: before, both
engines at 60 frames a second, the mean score was 75.9; now, Butterchurn at 30 and ours at
`--refresh 30`, `60` and `120`, it is **74.5 at all three, preset for preset** — the
captures land on steps, and the steps don't depend on the refresh rate, so the pace is
Butterchurn's at any display rate. The 1.4 points against before are the clock, not the
drawing: at 30 the same 240 frames cover 8 s of the track instead of 4, and the
strongly chaotic presets move both ways (±12). The harness can't score the pictures between
steps, which have no reference; the unit tests bound them.

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
    npm run compare -- --refresh 120         # ours drawn at 120 Hz, four pictures a step
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
- **Time.** A fresh renderer on both, so both clocks and fps estimates start equal.
  Butterchurn makes one frame per preset step, 1/30 s apart ("The preset clock"), and
  the audio moves on 1470 samples a step. Ours draws `--refresh` pictures a second (60
  by default; 30 is one per step, as Butterchurn draws), feeding back once a step, and is
  captured at the refreshes that land on Butterchurn's frames. A step's equations hear
  the window of Butterchurn's frame for that step.
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

### Live mode, as built: the app's compare view

    VISUALS_COMPARE=1 npm run app                                  # start in it
    VISUALS_COMPARE=1 VISUALS_PRESET="cream-of-the-crop/Geometric/Cube Fly/x.milk" npm run app

The app's header switches between *editor* and *compare*. The compare view is three
things: the pack's presets on the left (search, filter by verdict — all, not judged,
approved, rejected, with a note — each row marked ✓ ✗ or • for a note), the two pictures
side by side at the same size, and the verdict under them.

- **Butterchurn** (left) is 2.6.7 on a WebGL canvas in the page, drawing at 1920×1080 as
  the engine does. It is imported only when the view opens (it touches `window` at
  import), and `Math.random` is the engine's generator while it is open, seeded as
  recorded mode seeds it (`0x5eed`, then the preset seed as each preset loads). `.milk`
  is converted in a Web Worker (`app/src/compare/convert.worker.ts`: the converter with
  `server/hlsl.ts`'s repairs, as `server/presetWorker.ts` runs it), cached in the same
  `<pack>/.converted/…` files as the server and recorded mode. A shader Butterchurn cannot
  link is left black, as BlackHole shows it, and labelled on its picture; so is a preset
  the converter fails on.
- **Ours** (right) is the native bench, moved under the right picture's hole. Presets
  picked here open with seed 1 on both sides (`compare_open`), so `rand_start`,
  `rand_preset` and the init equations agree, as in recorded mode.
- **Audio.** Both hear the bench's CPAL input. The page asks for `compare_audio` once an
  animation frame: the input's sample rate, then the mono, left and right 1024-byte
  windows `Audio::update` would make from the same ring, given to Butterchurn's
  `render({audioLevels})`; its FFT bands are tuned to the rate as the old app did.
- **Verdicts** go to the recorded bench's file and shape (`compare.rs`): `approvals.json`
  under `OPENFLOW_HOME`, keyed by path in the pack, sorted, one-space indented. A verdict
  given here keeps the recorded score already there. A file that will not parse is never
  written over.

Keys: ↑ ↓ previous / next in the list, R random from it, A approve, X reject (again to
clear), N write a note (Esc or ⌘↩ leaves and saves), S swap the sides, F one picture full
size and Space the other one. Auto-advance and controllers still move the bench; the
view follows them, with that preset's own seed.

Not there yet: wipe and difference views, and a score in the live view.

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
