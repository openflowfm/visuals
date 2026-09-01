# The engine, and where it runs

`client/render/*`, `electron/main.ts`. Why the show is drawn by WebGL2 inside a Chromium
renderer, what that costs, and what would have to be true before it stopped being the right
answer.

This exists because "Electron is heavy" is true and is not, on its own, an argument. The
weight is real; the question is whether any of it lands on the frame.

## Where the frame time actually goes

A wall frame, from `client/render/compositor.ts`:

```
<= 8 track passes   only playing tracks; opacity below 0.002 is skipped entirely
 1 flow pass        the whole graph, one compiled fragment shader
 1 output pass      keystone, shoulder, master gain
```

**About ten draw calls.** That is the point of the design — [the renderer](render.md)
collapsed a pass per layer and a pass per effect into one expression, because a colour is a
function of a point. What is left is fill rate: roughly two million fragment invocations at
1080p against a work budget the compiler caps at 64 units, and the cap is tight enough that
four direct cloud samples fill it and a nine-tap bloom over one is refused.

So the engine is **ALU- and fill-rate-bound in a single fragment shader**. It is not
draw-call bound, not CPU bound, and not bound by the graphics API's per-call overhead.

That one measurement decides most of what follows, because *the same math costs the same
under WebGL2, Metal and Vulkan*. Chromium's WebGL2 reaches the GPU through ANGLE onto Metal,
which is the path a native Metal app takes too. Porting this pipeline as it stands to a
native API would move ten draw calls' worth of overhead — microseconds — and leave the
milliseconds exactly where they are.

## Three decisions, and the order between them

They get discussed as one and they are not one.

| | the change | what it costs | effect on the frame |
|---|---|---|---|
| **the shell** | Electron to Tauri | ~600 lines, plus a Node sidecar and the whole signing chain again | **negative on macOS** |
| **the engine** | WebGL2 in the renderer to a native GPU engine | ~6,000 lines of `client/render/`, plus a picture path back into the webview | ~0 today; raises a ceiling |
| **the language** | GLSL to SPIR-V or WGSL | a codegen retarget | ~0 |

**The shell alone is the one combination that pays and loses.** Tauri's macOS webview is
WKWebView; there is no Chromium option there and the decision is deferred to its v3 at the
earliest. The show renderer would move into a webview with fewer levers, and
`electron/main.ts` would lose the three anti-throttling switches whose comment records what
happens without them — bringing the console to the front drops the projector to a stutter.
That is 275 MB of disk traded for a projector that can stall, and it is why the shell is not
the thing to change first.

**If the engine ever goes native, the shell question answers itself.** A webview drawing
only the console does not care which engine it is, so Tauri stops having a downside the
moment it stops drawing the show. Native engine first, shell second, or neither.

## What Electron actually costs

Ranked by whether it lands on a frame:

1. **Frame-time predictability.** The real one. Chromium's compositor sits between the canvas
   and the display: an extra copy, and a scheduler this app does not own. For a show the
   ninety-ninth percentile frame matters far more than the mean, and a browser will not
   promise you one. **This has not been measured** — see below.
2. **No compute shaders.** WebGL2 has none. Algorithms wanting workgroup memory and atomics —
   neighbour search, SPH fluids, flocking with real queries — are not slow here, they are
   awkward to the point of not being worth writing. A ceiling rather than a tax.
3. **The video path.** `client/render/video.ts` decodes through a `<video>` element and uploads
   to a texture. Native would hand VideoToolbox's output to Metal with no copy. Small at
   1080p, growing with resolution.
4. **Disk and memory.** A 291 MB bundle, and a few hundred MB resident across main, GPU and
   two renderers. Next to Live on a 32 GB machine this is tidiness, not correctness.

## What Electron is buying

1. **One engine draws the wall, the bench and the ten node faces.** `client/render/preview.ts`
   runs all of them through a single GL context, and its argument for doing so is that a face
   is only worth having because it is fed exactly what the bench is fed. A native engine has
   to hand pictures back into the webview for those. It is not hard — ten 128-pixel thumbnails
   is well under a megabyte a frame, and an `IOSurface` share avoids even that — but it is work
   a shell swap never has to do, and getting it wrong costs the panel its whole reason to exist.
2. **`ELECTRON_RUN_AS_NODE` runs the server child with no system Node**, and the N-API Ableton
   Link addon loads under it unchanged. See [the desktop app](desktop.md) for why that was
   checked rather than assumed. Tauri needs a Node or Bun sidecar to stand in.
3. **Signing, notarisation, the hardened-runtime entitlements and the local-network prompt**
   are solved in `electron-builder.yml`, and all of it is redone from scratch on any other
   shell.

## Vulkan is not the target

This repo is macOS only, and not incidentally: signing, notarisation, Link, and a
`process.platform !== 'darwin'` guard in four tools. **Vulkan on macOS is MoltenVK
translating to Metal**, so targeting it on a Mac show rig adds a translation layer rather
than removing one.

If the engine ever does go native, the target is **wgpu** — Metal now, Vulkan and DX12 free
if a Linux or Windows show machine ever appears. And the GLSL is likelier to survive than to
be rewritten: wgpu accepts WGSL, SPIR-V *and* GLSL, because naga has a GLSL frontend. That
turns the engine question from "rewrite the renderer" into "re-host a codegen", which is a
materially smaller thing than it sounds like from the line count.

## Particles do not need any of this

The claim that a particle system needs compute is **wrong**, and it is written down here
because it nearly bought a rewrite.

WebGL2 has two established routes. **Transform feedback** is core, and exists for exactly
this. **State textures** are the other: position and velocity in an `RGBA32F` texture,
advanced by a fullscreen fragment pass, read in the *vertex* shader through `texelFetch` on
`gl_VertexID` to place point sprites. The second one is the near fit here, because the
compositor already ping-pongs `out` and `prev` and already publishes the result as
`uLastTex` behind the `last` node. Frame-to-frame state is something this renderer does.

What compute would genuinely add is neighbour queries and back-to-front sorting. **Sorting
is close to a non-problem** on this rig: `add` and `screen` are order-independent and are
already two of the four blend modes, and they are the look anyway. A fixed pool that
respawns dead slots in place needs no stream compaction, which is how most particle systems
are built regardless.

**The interesting constraint is architectural, not an API's.** Particles scatter, and a
fragment shader can only gather; particles persist, and an expression does not. So a
particle node cannot be an expression and has to be a pass — which is the shape
[the renderer](render.md) already carved out for `tracks`, the one node that could not be an
expression either. Render into a target, let the flow expression sample it. The second
exception follows the first rather than inventing anything.

## The meter

`client/render/meter.ts`, read in the panel as the **frames** row.

Three clocks, because they fail differently and the difference names the culprit.
**Interval** is wall time between presented frames and is the one that matters — if it is
clean the show is smooth whatever else says. **CPU** is time inside `frame()`, and climbing
there is our JavaScript. **GPU** is what the driver reports, and climbing there is fill rate,
which is the shader and the resolution and nothing else. Interval alone cannot tell a heavy
shader from a stalled tab, and CPU alone cannot see a shader at all.

Everything reported is a percentile and a late count. A mean of 6ms with a 40ms spike every
eight bars looks excellent in a readout and looks broken on a wall, so there is no mean here
to hide behind. **Late is measured against the window's own median**, at one and a half times
it, rather than against a millisecond budget — this rig runs at 60, 120 and 144Hz depending
on what it is plugged into, and a fixed 16.7ms budget would call every frame on a 144Hz
projector early and every frame on a 30Hz capture card late.

**The wall measures and the console reads.** Nobody reads a readout off a projector, and a
wall re-rendering to draw one is spending the frames it would be reporting on — so the wall
posts its window over the `BroadcastChannel` that already carries the keystone, once a
second, and the panel says which of the two windows it is showing. With a wall up the
console is drawing a quarter-size preview whose frame time describes that preview, so the
label is not decoration.

The GPU clock is the one that is often missing. `EXT_disjoint_timer_query_webgl2` leaks a
high-resolution clock, browsers have withdrawn it before and may again, and a **disjoint**
result means the GPU was preempted mid-measure and the number means nothing. Absent and
disjoint are both reported as absent rather than as zero, because a zero in a p99 is worse
than a gap.

## The benchmark

`npm run benchmark` — `tools/benchmark.ts` and `../bench.ts`. Every flow in the scheme,
drawn as fast as this machine can draw it.

```sh
npm run benchmark                      # throughput: how much work fits in a second
npm run benchmark -- --paced           # headroom: what one frame costs at 60Hz
npm run benchmark -- --bars=2          # the same ranking, a quarter of the time
npm run benchmark -- --sweep           # 1280, 1920, 2560, 3840
npm run benchmark -- --edges=3840      # whatever you name
```

## Looking at a frame

`npm run frames` — the benchmark's sibling, and the question it answers is what a flow looks
like rather than how fast it draws.

```sh
npm run frames -- --flows=halo,cage --at=0,1,2,3 --size=1920x1080
npm run frames -- --flows=comet --at=1.5 --scheme=xenon --out=/tmp/look
npm run frames -- --scheme=/tmp/scratch.json --flows=halo --at=0,1,2,3
```

It builds `visuals/frames.html` with vite, runs it in a hidden, non-focusable Electron window,
and writes one PNG per flow and beat into `visuals/frames-out/`, with a `stats.json` and
equal-phase HTML index beside them. Unlike the paced benchmark, this harness drives every
frame directly instead of waiting for `requestAnimationFrame`, so hiding it does not change
its rendering path or stall its clock and an analysis run never has to steal the desktop.

The requested `--size` is also the compositor's longest-edge cap. That is load-bearing on a
Retina screen: sizing only the CSS canvas lets `devicePixelRatio` make a larger backing
buffer, and copying that buffer into a requested-size analysis canvas crops its right and
bottom instead of sampling the whole wall. The final copy names both target dimensions as a
second guard, so a frame keeps the same composition at every display density.

For a directory of reference loops, `npm run footage:frames -- --in=/path/to/loops` samples
the same number of equal phase steps from each file through ffmpeg and writes strips, an HTML
index and `stats.json`. The footage and graph reports share `frameMetrics.ts`: luma, tolerant
dark coverage, hot-white coverage, chroma, edge density, brightness centroid and spread,
horizontal and vertical symmetry, terrace length, and cyclic RGB motion. Reference video
compression therefore does not get mistaken for a non-black background, and motion means
the mean change between the same equal phase steps on both sides of a comparison.

Global measurements are rejection tests, not a claim that two pictures share a construction.
For one reconstruction target, `node tools/structure-compare.ts
--reference=/path/to/loop.mp4 --graph=/path/to/frames-output --flow=weave` normalizes each
frame by its own bright material, removes isolated acquisition noise, and compares the
luminous silhouette and contour skeleton over every cyclic phase alignment in both playback
directions. It reports bidirectional contour distance and silhouette overlap separately from
the topology: enclosed regions, curve endpoints and junction clusters. That distinction is
load-bearing for compound forms — one bright cube and twelve woven loops can have the same
coverage and centroid, but they cannot have the same skeleton.

A preview file may contain the seamless loop repeated more than once. Pass `--cycles=2` when
two copies occupy the container (or the corresponding positive integer): the tool samples one
fundamental period while still taking the same number of graph and footage poses. Otherwise a
graph cycle is compared with duplicated target poses and the alignment score describes the
container edit rather than the motion being reconstructed.

**Every shortcut around this has produced a wrong answer.** The obvious way to look at a flow
is to compile its shader, set its uniforms by hand, and render it in a page — it is quick to
write, and it is wrong in ways that do not announce themselves:

- It fed `uLevel` where a `track` node reads `uTracks[]`, so every flow whose dynamics come
  from the music measured as a still image, and a whole round of tuning went into fixing
  "static" flows that were never static.
- It drew the flow shader straight to the canvas, skipping the **output stage** — which is
  where the shoulder is, and therefore where the picture is actually finished. Everything it
  reported about brightness was about a frame nobody would ever see.
- It was looked at through a screenshot, which is downscaled and JPEG-compressed. Banding does
  not survive a JPEG. Neither does a specular highlight two pixels wide.

So this drives the real `Compositor` through a real `Show`, at the real resolution, and writes
a lossless file. Reading that file is how the two defects below were found, both of which had
been in every frame the app had ever drawn.

### Eight bits was not enough, in two separate ways

`createTarget` made every intermediate buffer `RGBA8`. Three of them sit between a flow and
the screen — the set's pass, the flow's own picture, and the feedback history — and eight bits
in that position cost two things that both looked like the flows being at fault.

**Light above white was discarded before the shoulder could use it.** The renderer carries
colour past one on purpose, and the output stage's shoulder is asymptotic: it maps 1.0 to
0.908 and only approaches 1.0 for inputs well above it. Quantised to eight bits first,
everything above one clamped to one *before* the shoulder saw it, so the brightest pixel the
app could produce was 232 of 255. Every white on every wall was a grey, by construction, and
no flow could have fixed it.

**And a gradient had nowhere to be smooth.** A halo falling off across a few hundred pixels
crosses far fewer than 256 levels, so it arrived at the output stage already stepped. They are
`RGBA16F` now where the driver allows it, which is what the `EXT_color_buffer_float` check is
for.

A dither at the final write finishes the job: triangular noise of one level, spatial rather
than temporal, because a per-frame seed dithers better on paper and puts a crawling shimmer
across every flat area of a projected image. `stats.json` reports a **terrace** figure — the
mean length of a run of identical values inside a gradient, which is what a band physically
is. The flows measured 4.3 and 7.6 before and 2.9 after; the footage this vocabulary was
built to match measures between 3.9 and 7.1.

### A gain stage inside a feedback loop

Worth knowing because the eight-bit buffer was hiding it. A flow that reads `last`, composites
the new frame with it and then runs the result through `spread/bloom` has put an amplifier
inside a loop: each pass adds light to a picture that already contains the previous pass's
addition. Loop gain above one means the frame runs to white, and it did — in under a second,
on a float buffer. Clamping at eight bits had been holding two shipped flows up.

The fix is wiring rather than a control: bloom the light being emitted *now* and composite
that over the fading ghost, so the loop gain is the fade and nothing else. `bloom` and `comet`
both do it that way.

## Throughput is not headroom

**The most useful thing this has found, and it invalidated the first table it printed.**

The unpaced run draws as fast as the machine will go, which means several frames are inside
the GPU pipeline at once. Vortex comes out at about 1090fps that way. Divide by 60 and it
looks like eighteen times a 60Hz budget, which is what the table used to say.

The GPU's own timer disagrees, and it is right. One Vortex frame takes **3.2ms**, unpaced and
paced alike — the two modes agree on the cost of a frame to within a few percent. The 1090fps
is throughput with the pipeline full; 3.2ms is *latency*, the time from starting a frame to
finishing it.

A show cannot use the throughput. It presents one frame per refresh, so there is nothing to
overlap it with, and what its budget buys is one frame's latency. Against a 16.7ms budget
that is **two and a half times headroom, not eighteen.**

So the two modes answer two questions and only one of them is about frame budget:

| | what it answers | what it cannot say |
|---|---|---|
| default | how much work per second the GPU will chew | whether a frame fits in a refresh |
| `--paced` | what one frame costs at the display's rate, and what got dropped | how much room is left over |

`--paced` needs a **visible** window: a hidden or occluded one gets no `requestAnimationFrame`
at all, and the run simply never advances.

Eight bars at 128bpm is fifteen seconds a flow, so a whole scheme is about seven minutes and
a `--sweep` is most of an hour. `--bars` is the flag to reach for when that is too long.

**It cannot use `requestAnimationFrame`, and that is the whole design.** A browser paces rAF
to the display, so a machine capable of 300fps and one barely holding 60 both report 60
through it — which is the one answer a *ceiling* measurement must not give. The page runs
free instead.

**It fixes the music and counts the frames**, rather than fixing the frames and timing them.

The inverse is what this was first, and it is subtly the wrong question. With a frame count,
frames land every half-millisecond, so the musical clock has to advance *per frame* to keep
moving — which runs the show at about thirty times speed. Everything the renderer does
against real elapsed time is then wrong in the same direction: a video decoder delivers four
frames where a show would see four hundred, and its per-frame upload cost disappears from the
table; an envelope follower sees a bar go by in a few milliseconds. The picture being priced
stops being a picture anyone will ever see.

Here the beat comes off the wall clock. Musical time advances at the rate it advances on a
stage, every decoder and follower runs at the rate it will run on the night, and the only
thing free to vary is how many frames get drawn — which is the thing being measured.

**Two hard constraints shape the timing, and both cost an afternoon to find.**

*The clock is too coarse to time one frame.* `performance.now()` is clamped to 100µs in a
page that is not cross-origin isolated, and a 1080p flow on an M1 Max lands near that. Timed
a frame at a time, every flow at every resolution reported 0.0 or 0.1ms — 4K and 540p alike,
which is a clock reading its own floor rather than a renderer being fast. Measuring against a
window sidesteps it entirely.

*And a per-frame GPU barrier does not exist.* `gl.finish()` is the obvious one and in a
browser it does not do the job: Chromium runs WebGL over a command buffer, and `finish`
returns when *that* has drained rather than when the GPU is done. A one-pixel `readPixels`
is a real barrier and was no better, because it stalls the pipeline it is timing.

So frames are issued in chunks of about sixteen milliseconds, each closed with one
`readPixels`. That keeps the CPU/GPU overlap a real frame has *within* a chunk, and bounds
the frames that could be counted but not yet drawn to one chunk's worth. It also makes the
run watchable, because a yield is what lets a frame reach the screen — fifteen seconds of
unbroken JavaScript is a page the browser calls unresponsive and a window the runner cannot
ask anything of. The yield is a `MessageChannel` rather than a `setTimeout(0)`, which is
clamped to 4ms and would spend a fifth of every chunk waiting.

Draining every chunk is work a show never does, so **these are ceilings a real show should
beat.** The check that they are honest is that cost scales with pixels: the same flow at
3840 costs about four times what it costs at 1920.

The context comes from the canvas rather than from the compositor: `getContext` returns the
same object for the same canvas, so the bench forces its barrier without the renderer growing
a method that exists for one caller.

The barrier reads a scratch 1×1 attachment rather than the default framebuffer. Commands in
one context complete in order, so a read anywhere drains the whole queue equally — but
reading the default framebuffer is reading the buffer the compositor is trying to present,
which puts the barrier inside the presentation path it is not supposed to be measuring.

**The measuring is the compositor's own meter**, in both modes, rather than one of the
bench's. A second meter on the same context was two `TIME_ELAPSED` queries fighting over one
target — every frame threw `INVALID_OPERATION` and the GPU numbers were nonsense. Using the
compositor's also means the benchmark and the panel's live readout are the same instrument,
so a number here and a number on a show night cannot quietly diverge.

**The window shows the picture, and says what size it really is.** The canvas has to carry a
CSS box of `edge / devicePixelRatio` for the drawing buffer to land on the target exactly —
960 CSS pixels for a 1920 pass on a two-times display, 1920 for a 4K one. That box is
*smaller* than the window as often as it is larger, so the fit scales in both directions and
is not clamped at 1: 1920 fills a 1440-wide window at `scale(1.5)`, 3840 fills the same
window at `0.75`, and both draw the resolution they claim. Fitting width alone crops a 16:9
box at the bottom, and clamping at 1 leaves the common case as a preview of a preview.

The readout along the bottom prints `canvas.width` and `canvas.height` themselves rather
than the pass's nominal size. A benchmark drawing something you cannot see, at a size you
have to take on trust, invites exactly the doubt it exists to remove.

Thirty frames are discarded before timing. The first frame of a flow compiles a shader,
which is milliseconds of driver work charged to a frame that never pays it again — and
charged worst to the flows with the most in them, which are exactly the ones being ranked.

It runs in Electron rather than the Chrome in `tools/visuals.ts` for one reason: it is the
same Chromium the app ships, and a benchmark run on a different engine than the product is a
benchmark of the wrong thing. It warns when visual[flow], set[flow] or Live is already on the
GPU, because a contended run reports floors and nothing in the table would say so.

**`work` beside each flow is the compiler's own prediction** against its ceiling of 64, now
published on `Compiled`. Where the prediction and the measurement disagree, the cost model in
`client/render/circuit.ts` is what needs revisiting — a model nobody checks against a
measurement is a model that drifts.

## What the paced run found, and what it overturned

**The first reading from `--paced` contradicts the conclusion the rest of this document was
written around, and the paced number is the one to believe.**

At 1920×1080 with eight tracks playing, on an M1 Max with Ableton Live also on the GPU:

| flow | gpu p99 | share of a 60Hz budget | frames late |
|---|---:|---:|---:|
| Showcase — Metaball bloom | 15.78ms | **94.5%** | 0.46% |
| Showcase — Cloud chamber | 12.00ms | 71.9% | 0 |
| Vortex | 10.66ms | 63.8% | 0 |
| The lot | 9.47ms | 56.7% | 0 |
| … | | | |
| Chandelier | 0.86ms | 5.1% | 0 |

The heaviest flow in the scheme spends **almost a whole 60Hz frame** at the ninety-ninth
percentile and drops frames. Its median is 8.4ms, which is still half the budget. The
unpaced run priced the same flow at 195fps and the summary line divided that by 60 and called
it three times a budget. That was throughput read as headroom, and it was wrong by about
thirty times.

Three things follow, and none of them were visible before there was a paced mode:

- **There is no comfortable headroom at 1080p/60 on the heaviest flow.** There is a little,
  and it is contended: Live was running. A clean rerun is the first thing to do.
- **120Hz is out of reach for that flow**, at 8.3ms a frame, and probably for the three below
  it too.
- **The engine question is genuinely open again.** "Fill-rate bound in one fragment shader"
  is still true and still means a native port moves nothing on its own — but "there is
  plenty of room" was an artefact of measuring the wrong quantity. A particle pass added on
  top of Metaball bloom has nowhere to go.

The `work` column stays interesting for the same reason it always was: `The lot` charges 0
and sits fourth-worst at 56.7% of a budget, and `Orbit garden` charges 32 and sits at 11%.
The cost model is not tracking what the GPU actually does.

## What would actually settle it

Nothing above establishes there is a problem today, because the number that decides it has
not been taken: **the ninety-ninth percentile frame time on the wall, at show resolution,
with the console in front, running the heaviest flow in the scheme.** The meter is there to
take it; nobody has run it against a real show yet.

`--paced` is the closest thing to it that needs no projector and no band, and its first
reading is above. What it cannot tell you is what a *wall* does: a second window, a second
GL context, and a projector at whatever it refreshes at. Given how little room the paced run
found, that measurement now matters a great deal more than it did this morning.

If that is clean, this whole question is about a 275 MB download. If it spikes, it points at
one of the four costs above and says which — and a profile is a far better reason to rewrite
an engine than a dislike of the one you have.

Building particles in WebGL2 first is the cheap way to ask. It loads the fragment path
harder than anything currently in the scheme, so it produces that measurement as a
by-product, and a state-texture particle pass maps onto wgpu close to one for one if the
answer ever comes back the other way.
