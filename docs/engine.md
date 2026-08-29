# The engine, and where it runs

`src/render/*`, `electron/main.ts`. Why the show is drawn by WebGL2 inside a Chromium
renderer, what that costs, and what would have to be true before it stopped being the right
answer.

This exists because "Electron is heavy" is true and is not, on its own, an argument. The
weight is real; the question is whether any of it lands on the frame.

## Where the frame time actually goes

A wall frame, from `src/render/compositor.ts`:

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
| **the engine** | WebGL2 in the renderer to a native GPU engine | ~6,000 lines of `src/render/`, plus a picture path back into the webview | ~0 today; raises a ceiling |
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
3. **The video path.** `src/render/video.ts` decodes through a `<video>` element and uploads
   to a texture. Native would hand VideoToolbox's output to Metal with no copy. Small at
   1080p, growing with resolution.
4. **Disk and memory.** A 291 MB bundle, and a few hundred MB resident across main, GPU and
   two renderers. Next to Live on a 32 GB machine this is tidiness, not correctness.

## What Electron is buying

1. **One engine draws the wall, the bench and the ten node faces.** `src/render/preview.ts`
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

`src/render/meter.ts`, read in the panel as the **frames** row.

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

## What would actually settle it

Nothing above establishes there is a problem today, because the number that decides it has
not been taken: **the ninety-ninth percentile frame time on the wall, at show resolution,
with the console in front, running the heaviest flow in the scheme.** The meter above is
there to take it; nobody has run it against a real show yet.

If that is clean, this whole question is about a 275 MB download. If it spikes, it points at
one of the four costs above and says which — and a profile is a far better reason to rewrite
an engine than a dislike of the one you have.

Building particles in WebGL2 first is the cheap way to ask. It loads the fragment path
harder than anything currently in the scheme, so it produces that measurement as a
by-product, and a state-texture particle pass maps onto wgpu close to one for one if the
answer ever comes back the other way.
