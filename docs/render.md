# The renderer

`src/render/`. WebGL2, two passes and an output stage.

Shader source is split by responsibility under `src/render/glsl/`: `common.ts`
owns the uniforms and shared coordinate/clock helpers, `sources.ts` owns the
lightweight generators, `fields.ts` owns fixed-work procedural fields,
`fractal.ts` owns bounded iterative pictures, `light.ts` owns fixed-work 2D
lights built on the field lattice,
`effects.ts` owns single-read image operations, and `circuit.ts` owns helpers
used only by graph expressions. `src/render/shaders.ts` is the assembly boundary
for full flow and per-track fragment shaders; `src/render/circuit.ts` compiles a
graph against that boundary. The final projector pass stays in
`src/render/output.ts`, because it is a separate program with separate uniforms.

## The frame

```
the set's picture (only if the flow asked for it)
  clear transparent
  for each playing Live track:
    ease its opacity toward the target; below 0.002 -> skip entirely
    draw its picture, blended, into one target

the flow
  one full-screen pass, one compiled fragment shader
  reading that target wherever a `tracks` node appears
  up to two persistent decoded-video textures where `video` nodes appear,
  and up to four persistent still textures where `image` nodes appear

the output stage
  keystone, shoulder, master gain -> the screen
```

**There used to be a pass per layer and a pass per effect on it**, ping-ponged through two
targets. That is gone, because [a colour is a function of a point](flows.md): a whole flow —
however many sources, effects and nested flows it contains — compiles to one shader, and
composition happens in the expression rather than in a buffer.

**The set is the one thing that cannot be an expression.** A `tracks` node draws the same
picture once per playing Live track, with a different colour, meter and fader each time, and
a fragment shader cannot loop over a varying number of those cheaply. So it stays a pass, and
it is the last surviving piece of the compositor this replaced.

**Opacity is eased, not set.** Without it, a scene change would pop tracks into existence on
one frame. The glide is ~200ms expressed against `dt`, so it flows the same at 60 Hz and
144 Hz, and a track whose clip stopped fades out on its way rather than vanishing.

**A track with nothing playing draws nothing** — not the last thing it played. A track that
held its previous clip after the scene changed is the failure that flows most like the
renderer having crashed.

**Blending in that pass is fixed-function.** Every track shader writes *premultiplied* alpha,
which means the four modes are one `blendFunc` each and the compositor never has to read back
what it has already drawn:

| blend | `blendFunc` |
|---|---|
| `over` | `ONE, ONE_MINUS_SRC_ALPHA` |
| `add` | `ONE, ONE` |
| `screen` | `ONE, ONE_MINUS_SRC_COLOR` |
| `multiply` | `DST_COLOR, ONE_MINUS_SRC_ALPHA` |

`over` at the bottom because something has to be opaque, and `screen` above it because it
saturates at white rather than climbing past it — an even pick over the four puts a quarter
of a tall stack on `add`, and a quarter is enough to white out the frame before the tracks
that were meant to be seen have drawn.

**The `blend` node is written from that same table**, as GLSL rather than as a `blendFunc`,
and it has to stay that way: two answers to how two pictures combine is the thing the graph
exists to have one of. It is also why `multiply` is not a multiply — on premultiplied colour
`a * b` multiplies the coverages as well, which took the base out entirely whenever the top
was less than opaque and made an unwired `top` a black frame. See [flows](flows.md).

It is a **fixed rule rather than a bound one**, and that is the trade this change makes:
per-track blend was a field on a binding that no longer exists. If it needs to vary, it
varies inside the graph — a `blend` node is right there.

**The flow reads the scheme every frame**, because a flow is a graph and what a graph
compiles to is the scheme's to say. Resolving that on the server would mean shipping a shader
down the wire on every edit; doing it here means a flow recompiles the moment its wiring
changes and never when only a number moved. The cache signature walks the **expanded** graph,
so editing a flow changes the signature of every flow that contains it.

`uParams` is the bank the numbers ride in — a `value` node's amount and every number set on an
inlet — and it is **declared at the size the graph needs**, since the shader is generated.
Giving an inlet a number for the first time is a change to the shader's shape and recompiles
once; every turn of it after that recompiles nothing, which is the whole reason a set number
is a uniform. `uTracks` is a second bank, of eight, filled only for a flow that **named** a
track — and filled on the CPU, both because a name has to be resolved against the set and because a
`track` node's `smooth` is an envelope follower, which has to remember what it saw last
frame. There used to be a third bank for those; `track` and `energy` are one node now, so
what goes in a slot is that node's business and the shader reads a number without learning
which.

## What there is to look at

Thirteen lightweight sources, three bounded procedural fields, four bounded 2D lights, one
bounded fractal node and
nineteen ways to work on a picture, all of them **node modes** rather than parallel registries
of their own. They are deliberately unlike each other rather than variations on a theme —
five sources all drawing soft noise is one picture, however many of them there are.

| source | |
|---|---|
| `solid` | the colourway's colour, breathing on the bar. Something has to be opaque at the bottom |
| `bars` | a bar of music as columns, with the playhead sweeping them |
| `rings` | rings launched on the beat, expanding out |
| `noise` | a drifting field that thickens with the sound. Weather, not a metronome |
| `strobe` | whole-frame flashes on the division energy chose |
| `grid` | cells lighting on their own beats. Structure rather than motion |
| `tunnel` | a corridor rushing toward you. Depth is `1/r`, which is what makes it perspective rather than rings |
| `plasma` | four crossed sines. The full-frame wash, in a colour and its complement |
| `spiral` | arms winding out and turning on the beat. The only one with a direction |
| `scan` | lines, with a bar's sweep passing down them. The one that looks like a machine |
| `sparks` | a cell per spark, each firing on its own beat and drifting as it dies |
| `checker` | square-lattice parity, drifting sideways on a musical division |
| `rays` | alternating angular sectors turning around an explicitly empty centre |

| `field` — published procedural algorithms with charged fixed work | work |
|---|---:|
| `cells` | jittered cellular F1: nine neighbouring feature checks |
| `clouds` | four octaves of gradient noise: sixteen lattice-corner visits |
| `metaballs` | two to seven summed Gaussian densities: seven visits at the hard ceiling |

These names are algorithm contracts rather than visual approximations. `cells` is the bounded
one-feature-per-cell GPU form of [Worley F1](https://doi.org/10.1145/237170.237267);
`clouds` follows the fixed octave construction in
[Perlin's image synthesizer](https://doi.org/10.1145/325334.325247), with lacunarity two and
gain one half; and `metaballs` uses the summed Gaussian densities from
[Blinn's implicit surfaces](https://www.microsoft.com/en-us/research/publication/a-generalization-of-algebraic-surface-drawing/).
Pure TypeScript reference kernels pin deterministic probes and mathematical invariants for all
five new pictures. The GLSL independently implements the same definitions, while registry tests
ensure every mode reaches the graph compiler and every genuinely lightweight source reaches the
per-track shader path.

Metaballs expose `balls`, which selects two through seven active fields, and `apart`. The
latter starts as loose independently sized and directed orbits, then widens into an evenly
spaced elliptical ring at its maximum. The kernels tighten only through that last part of the
range, so all seven complete bodies can be visibly separate without losing their soft merging
through the rest of the control. Their Gaussian fields are summed before the implicit threshold
rather than averaged, so adding a ball does not dim every ball.

The `field` split is a GPU boundary. A `source` may run once per playing track, so only the
constant-work checker and rays belong there. A field is never offered as a per-track picture,
and its 9/16/7 work charge is counted every time a graph samples it. Four direct cloud samples
exactly fill the 64-unit graph ceiling; a nine-tap bloom over one is refused before the shader
reaches the driver. A seven-ball metaball bloom costs 63, so that specific showcase retains its
full bloom with one unit to spare.

| `video` — disk-backed decoded frames | |
|---|---|
| `loop` | play continuously and return to the first frame at the end |
| `once` | play once and hold the final frame until the flow leaves the renderer |

Video is not put through the procedural source path. The server discovers safe relative
assets and serves HTTP ranges; the browser's `<video>` decoder updates one persistent WebGL
texture only when a decoded frame arrives. A 120 Hz render loop therefore does not upload a
30 fps file four times. The texture is sampled through the same point expression as every
other colour node, with aspect-correct cover framing, so all ordinary lenses and effects
compose over it. Two reachable video nodes are the hard per-flow ceiling; parked nodes own no
decoder, leaving a flow releases its decoder, and audio is always muted.
The tiny per-node face renderer binds video transparent because one shared context cycles
through as many as ten different probe graphs each frame; starting decoders for those would
thrash. Promoting the node into the large bench uses the full compositor and plays it.

| `image` — disk-backed still textures | |
|---|---|
| `cover` | fill the frame without distortion, cropping the long source edges |
| `contain` | preserve the complete image, leaving the uncovered frame transparent |

Still images use the same safe relative media ids as video, but have no frame loop. A selected
PNG, JPEG, WebP, or AVIF is fetched and uploaded once, resampled before upload when its longest
edge exceeds 4096 pixels or the GPU's own lower limit. The texture persists while that flow is
active; changing the asset or leaving the flow aborts an in-flight fetch and releases it. Only
reachable nodes reserve slots, and four is the hard per-flow ceiling. Tiny node-face probes bind
transparent rather than repeatedly replacing a shared context's still textures; the bench and
wall use the real image.

| `fractal` — one iterative node, two modes | |
|---|---|
| `mandelbrot` | the classic connected escape-time set; its main cardioid and large bulb skip the orbit loop entirely |
| `julia` | the related family, with `shape` moving its seed around a bounded useful region |

| `light` — one node, four fixed-work 2D lights | |
|---|---|
| `lamp` | a hot Gaussian core over an inverse-square halo, windowed to a finite reach so it composes |
| `beam` | a soft-edged spotlight cone swung about straight down, two gradient-noise octaves of dust inside it |
| `shafts` | crepuscular rays: one fBm read over the angle around a hanging point, its seam parked behind the fan window |
| `caustics` | sunlight through water: two counter-drifting Worley layers, bright where either nears a feature and flashing where both do |

Each light hangs where its `from` inlet says — wire a `place` to move it — except
`caustics`, which is a surface the frame is under rather than a point in it. Their motion
rides `uTime` on purpose: haze, dust and water are the things that should not dance in
tempo, so `energy` drives brightness alone and the physics never wobbles with the beat.

Both modes share one orbit implementation with a hard ceiling of thirty-two steps and no
supersampling. `detail` chooses a lower stopping point from eight to thirty-two; `zoom` is
logarithmic but stops at 1/64 scale, where a WebGL `highp` float can still tell the truth.
The beat turns the palette rather than adding work. The node is deliberately **not** a
`source` mode: every source is also a possible per-track draw, and an iterative shader once
per playing track is the GPU failure this boundary prevents.

| `lens` — eleven functions of a point | |
|---|---|
| `zoom` | in or out. A half is life size |
| `swirl` | rotation growing with radius |
| `fold` | mirrored into wedges around the centre |
| `wobble` | displaced on a sine that runs on the beat |
| `tile` | the frame repeated in a grid |
| `mirror` | a fold, at an angle. Rotating in and out is what turns one mirror into every mirror |
| `kaleido` | the same wedge fold as `fold`, turning with the beat. Energy adds segments |
| `twist` | the same rotation as `swirl`, swaying. Where kaleido folds, this wrings |
| `ripple` | a wave leaving the centre on each beat. The most frenetic of them |
| `slice` | rows thrown sideways, re-diced on each beat division. Wrapped, not clamped |
| `pixelate` | blocks that resolve across the bar |

| `grade` — the colour where it is | |
|---|---|
| `levels` | contrast and brightness. A half of each is neutral |
| `hue` | rotation about the grey axis, undone and redone around the premultiply |
| `posterize` | colour quantised to a handful of steps |
| `invert` | on the beat and off again. The only one that is a switch rather than a shape |

| `spread` — reads its input several times | |
|---|---|
| `bloom` | eight taps on a ring, and only what is bright is added back |
| `smear` | six taps toward the centre. A short radial blur, and the opposite of ripple |
| `edge` | four taps, a fraction of the frame apart. The one that makes a busy frame *less* busy |
| `shift` | three taps, one per channel, opening with the level so it bites on transients |

Adding a node starts with a `src/nodes/<kind>/node.ts` folder descriptor; the generated
manifest makes that folder the source of truth for its kind, family, and browser placement.
See [flows](flows.md). Adding a lightweight picture mode is a typed body in
`glsl/sources.ts`'s `GENERATOR_BODIES`
and a literal name in `SOURCES`:
the same body serves the `source` node and the track pass, so what a built-in draws and what
a node draws cannot drift, and TypeScript refuses a name without a body or description. Anything
with a fixed loop or repeated samples belongs in a dedicated kind with an explicit work cost, as
`field`, `light` and `fractal` do, so the compiler can see cost that GLSL line counting
cannot.

Adding a *way to work on one* means picking which of the three it is, and that choice is now
the node it goes in rather than a shape hidden inside a twelve-entry table. A `lens` mode is
a row in `LENS_VALUES` and a one-line function of a point in `LENS_POINT`. A `grade` is the
same, one line of colour. A `spread` needs the compiler's `readAt`, which is exactly what
makes it the family that can run out of budget.

Nothing has to be registered in a scheme, because a mode is not a flow.

## The clock is a uniform, and so is energy

Nothing in a shader reads a wall clock or counts frames. `uBeat` and `uPhase` come from
Link, so a shape that grows over a bar grows over a *musical* bar and stays with the music
when the tempo moves. That is the difference between this and a screensaver.

`uTime` exists and is barely used, on purpose: it is for drift and shimmer — things that
should specifically *not* be in time. The noise source's weather moves on `uTime`; its
density moves on `uLevel`.

`lfo` is the explicit exception that offers both clocks to a flow author. With `sync` on it
uses `uBeat` and quantizes `rate` to straight note periods from `4/1` through `1/32`; with
`sync` off it uses `uTime` at an exponential 0.05–20 Hz. Its `phase` inlet is added after the
clock and offsets one complete cycle. The GLSL expression and the display/CPU evaluator share
the same TypeScript reference contract, so an LFO driving a shader number and one driving
video pace cannot disagree about the waveform or clock. Sample-and-hold hashes the complete
cycle plus node identity and the pass seed, producing one stable value per cycle without CPU
state or a frame counter.

`beatPulse(division, energy)` in the preamble is 1 on the beat decaying to 0 across it, and
everything reactive is built from it so that "on the beat" means one thing everywhere.

**Energy is an argument, not a uniform.** It used to be the one number the whole show agreed
about — an archetype set it, a cascade biased it, and every shader read `uEnergy` without
being asked. That made "energy" mean exactly one thing forever, where in practice it means
whatever you decide and the useful one is often a particular track's.

So `rate`, `beatPulse`, `charge` and every generator take it as a parameter, and every
mode that reads one has an `energy` inlet. `uEnergy` survives as **the room's** energy
— a smoothed master meter — which is what an unwired inlet falls back to. A default, not a
level. See [flows](flows.md).

Two things about those that were wrong for a while, and are worth stating because both
failed in the same direction — *everything at once*:

**`rate()` is a ladder, and three things choose the rung.** The rungs are musical divisions
— once every two bars, once a bar, every two beats, every beat, eighths, triplets — because
a rate *between* an eighth and a triplet is in time with nothing.

| chooses it | why |
|---|---|
| **energy** | moves the whole section up the ladder. This is most of what a section *is* |
| **a hash of the pass's seed** | spreads things a couple of rungs either side. One number alone put everything on the same division, and twenty-odd tracks pulsing together is one flash however many are drawing it |
| **`uPace`** | a whole-rung shift over everything, from `Scheme.defaults.pace`. For a room that wants the show slower or quicker than the ladder assumes |

The bottom two rungs — a bar, and two bars — matter more than they sound. The old floor was
one event every two beats, which meant even a quiet passage never really *drifted*, and that
bottom end turns out to be most of what makes something feel calm.

Pictures with a motion of their own — `tunnel`'s rush, `plasma`'s drift, `twist`'s sway — are
on the ladder too, so they inherit the seed spread and the pace trim rather than running at
rates of their own. `noise` is the exception and stays on `uTime`: its drift is weather, and
weather is the one thing here that should specifically not be in time.

**`charge()` is a contrast about a pivot, not a squared multiply.** The old shape scaled the
colour and then squared it, which at a chorus put a white pixel at 1.9 — meaning everything
above 0.66 came out flat white *before a single layer had been composited*. A chorus was not
brighter than a verse; it was clipped. It now pushes the darks down as it lifts, which is
what contrast actually is, and leaves a little headroom for the shoulder to work with rather
than handing it a frame that has already lost the top.

The same reasoning caps `solid`: it is the one picture that fills the frame at full alpha, so
it is the one that can hide everything under it, and its brightness has to stay well short
of white.

## The output stage

`render/output.ts`. One pass, after everything is drawn, doing the three things that belong
to **the projector and the room** rather than to the show: a shoulder, a master brightness,
and a keystone.

### The shoulder

Layers composite with fixed-function blending, most of them additively, so a frame with five
bright layers in it lands well past what a projector can show. Clipping that is what made a
chorus look like a white rectangle — every layer arrived at 1.0 and none of them had any
shape left.

So the last thing that happens is **linear below a knee, asymptotic above it**. Everything
under the knee is untouched, which is what makes it not a dimmer: it only takes the top off,
where the picture had already stopped carrying information. It is per channel, so a highlight
that has run away in one of them desaturates toward white the way film does rather than
shifting hue on its way to being clipped. There is no setting for it, because there is no
setting that is right in one room and wrong in another.

### Brightness

One number, stored per machine, in front of the shoulder. A hall with the lights up wants a
different one from a black box, and it is the control to reach for when the answer is "still
too much" — everything else in this file is about the picture having *shape*, and this is
about how much of it there is.

### Corner pinning

A projector is never square to the wall, and moving the stand is not
an option when the stand is where it has to be. An angled throw lands a **trapezoid**, so
the correction is the inverse trapezoid: draw the picture into the shape that arrives as a
rectangle.

It is a **homography**, not a scale. The four corners move independently, lines stay
straight, and the spacing *along* them does not — which is the whole point, because an
angled throw makes the far edge of the image larger and the correction has to shrink it by
an amount that varies across the frame. Two keystone sliders cannot express that, which is
why the ones built into cheap projectors never quite line up.

```
layers -> the output target -> gain, shoulder, homography, grid -> the screen
```

`squareToQuad` is Heckbert's closed form — worth using over an 8×8 solve, because the
square's corners are known constants and most of the general solution collapses. The shader
gets it **inverted**: a fragment shader is asked what colour *this output pixel* is and has
to answer by reading the input, and mapping forwards would leave holes wherever the warp
stretched. Sampling outside the source is black rather than clamped, or the projector paints
a bright fringe exactly where you are trying to find the edge of the frame.

The pass **always runs**. It used to be skipped while the corners were square, which was
right when all it did was a keystone; it does the shoulder now, and that is wanted on every
rig whether or not its projector is straight. The cost is one full-screen read and write,
against the dozen passes the layers themselves already cost.

The grid is computed in **source** space, so it arrives on the wall already warped: line it
up until it is square where the picture is going, and the picture is square too. Its line
widths come off `fwidth`, so a line stays one pixel wide where the warp has squeezed the
grid rather than thinning out of existence.

**It is not in the scheme, and must not be.** The scheme is a file you commit and carry to
the gig laptop; a show that looked different there would be a bug. A keystone is the exact
opposite — it describes one projector at one angle in one room, so one that travelled would
be wrong everywhere except where it was set. It lives in the browser's `localStorage`, which
is the correct scope: this machine, surviving a restart, going nowhere.

`k` opens it. Drag a corner or arrow it, hold shift for a single pixel; the brightness sits
on the same bar.

## The wall is a window, because an output is not a thing

Nothing renders to an HDMI port. The port is a **display**, and the only way pixels reach it
is a window on that desktop — so the question was never whether this rig has a second window,
it is whether anybody has to *touch* one. Dragging a browser onto a projector and
fullscreening it is a thing you do in the dark with a band waiting, every single time.

`state/useWall.ts` opens it instead. Chrome's window management API lets a page enumerate the
displays and open a window on the one it names, so `w` puts a chrome-less window on the
projector and the console keeps the panel, the editor and the picture it already had. Which
display it went to is remembered per machine, for the same reason the keystone is.

**The wall is an ordinary second client** — rule 5 in [`AGENTS.md`](../../AGENTS.md). It opens
its own socket, asks for a snapshot and extrapolates its own clock exactly as a second machine
would, which is what makes one machine and two the same code. Both windows read the show from
the server and the beat from Link, so they agree about the flow, the colourway and the bar.
They do not agree about `uTime`, which is seconds since *that page* loaded — so `noise`'s
weather drifts differently in the two and nothing that is in time does.

**What the two ends have to agree about does not go through the server.** The keystone, the
master gain and whether the test grid is up all describe this projector in this room, which is
the one class of thing the scheme is deliberately not told. They ride a `BroadcastChannel`
between the windows instead: the console says what it just changed, the wall applies it and
answers nothing — a receiver that went back through those setters would be two windows
agreeing with each other forever — and a wall that opens later asks and is told. So dragging a
corner moves the picture on the wall while you are looking at the wall, which is the only way
a keystone was ever set.

**The console keeps its own output stage** rather than dropping it while a wall is up. There
is one projector, so there is one keystone and one gain, and a preview that disagreed with the
wall in either direction is the thing this file spends the rest of its length avoiding.

**The first `w` of a browser's life may take two presses.** Enumerating displays needs the
window-management permission and asking for it needs a gesture, so the first press spends its
gesture on the prompt and the next one opens the window; every press after that is one press.
Where the permission is refused, or the browser has no such API, `w` opens a plain popup you
place yourself — worse than the automatic one and better than the alternative, which is
nothing.

`?wall` in the URL is what makes a page the wall, read once and fixed for its lifetime. A
query rather than a route because the dev server and the built server both serve it with no
help, and because it is the same idiom as `?maxEdge`.

## Fill rate is the only performance number

Cost is `pixels × passes × 60`, and there are far fewer passes than there were: one per
playing track plus one for the flow, where it used to be up to three per track. What
replaced them is **instruction count inside one shader**, which is cheaper per pixel but no
longer free to grow — a multi-tap effect over a deep graph is the way to make a single pass
expensive, and `MAX_LINES` is the backstop. Iterative nodes also declare worst-case work:
`fractal` costs its full thirty-two-step ceiling at every point it is read, which allows two
direct fractals but refuses one under a multi-tap `spread` before WebGL sees the shader.

Resolution is still the decision that matters. Left to the display it is ruinous: a Retina
laptop reports `devicePixelRatio` 2, which on an ordinary window asks for **3728×2006** —
7.5 megapixels, sixty times a second. So the drawing buffer is capped at **1920 on its
longest edge**, overridable with `?maxEdge=`. The output of this is a projector and a
projector is 1080p; a preview on a 5K panel is very slightly soft in exchange for the frame
rate that actually matters.

**A second window is a second render, and there is no way for it not to be.** A GL context
belongs to one document, so nothing can be drawn once and shown twice — the browser has no
way to hand a finished frame to another window that is cheaper than drawing it again, and
reading one back to send it would cost half a gigabyte a second. What there is instead is the
cap, which is per window: the moment a wall opens, the console stops being a destination and
drops to **960**, a quarter of the pixels. So the pair costs a little over one 1080p render
rather than two, and the one that is being projected is the one drawn at full size.

Two smaller choices in the same direction. The full-screen pass is **one oversized triangle,
not two**, so there is no diagonal seam where interpolation is discontinuous. And a track
that is silent or faded out is skipped before its shader is ever bound, which is why an
eight-track set with two clips playing costs two passes and not eight. A flow with no
`tracks` node in it skips the whole set pass.

## Programs are compiled on demand and kept

The wheel changes which flow is up on a musical boundary, and compiling a shader mid-set is
a dropped frame at the worst possible moment. So each flow compiles the first time it is
asked for and is held for the life of the page.

A flow is held against a **signature** of what it was built from — the node kinds, modes and
cords of the **expanded** graph, sub-flows included. Node positions and set numbers are
deliberately absent, or dragging a node would rebuild a shader sixty times a second.
Expanding first is what makes a nested edit visible: signing only the top graph would leave
an edit to a flow-inside-a-flow invisible until something else forced a rebuild.

A build that fails is remembered as a failure, for the same reason: retrying it every frame
calls the driver's compiler sixty times a second for as long as it stays broken, which is a
stall rather than an error message. That holds for **all three** kinds of failure — a flow's
shader, a probe shader on a node face, and the output stage's amplifier, which was the one
left out and would have retried per frame forever on a driver that refused it.

**A graph that cannot be built at all is a fourth**, and it is not the same failure. A node
`kind` nothing can draw — a hand edit, an MCP typo — makes `flatten` throw before there is
any shader to compile, which is *outside* the GL try, on the frame path. There is no
signature to remember it by, because computing one means flattening it, so the scheme object
is the key: a broken flow draws nothing, says so in the panel, and is not tried again until
the scheme itself moves. Retrying costs an edit rather than a frame. `merge` refuses an
unknown kind at both doors as well — this is the floor under that, not a substitute for it.

## A lost context is not a broken one

A GPU reset — a driver crash, a laptop switching graphics, a display waking up — takes the
WebGL context with it, and **every GL call afterwards is a silent no-op**. Nothing throws,
nothing logs, the wall simply stays black; the failure looks exactly like a bug in the flow
that happened to be up.

`compositor.ts` listens for both halves on the canvas. `webglcontextlost` calls
`preventDefault` — without it the browser never offers a restore at all — marks the
compositor dead so `frame` stops, and releases everything *there*, while the context is
lost and every call is a harmless no-op. Doing it on the restore instead would mean passing
handles from the old context to the new one, which is an `INVALID_OPERATION` apiece. What
the release actually reclaims is the half that is not on the GPU: the video elements the
bank keeps open.

`webglcontextrestored` makes it all again — feed, banks, targets — and clears the flow
cache, which is the point of a cache here: it is what knows a flow existed, so emptying it
is what makes the next frame rebuild exactly the flow that was up. Nothing is restored,
because nothing survived.

`free()` ends with `WEBGL_lose_context.loseContext()`, in the compositor and in the node
faces' `preview.ts` both. Deleting what a context holds does not give the context back: a
browser keeps about sixteen per origin and evicts the oldest, so opening and closing the
console enough times would silently take out the wall's own — the risk `NodePictures.tsx`
already documents from the other side.

`src/render/flow.ts` holds what both the stage and the node faces need — the shader, the
banks, the signature. **The bench is not in that list**, because the bench is a whole
`Compositor` on its own canvas rather than a second renderer. There used to be one and it
was a standing risk: a bench that could disagree with the stage about brightness or blend is
worse than no bench.

## One list of uniforms, because two of them drifted

`src/render/feed.ts` is what a flow is *fed*: the clock, the set's own pass, every uniform a
compiled flow reads, and the output stage. The stage and the node faces both call it.

It was two lists, in two files, and they had drifted apart in fourteen places — the faces
drew the set as one grid shader in a hardcoded orange, banked every meter at a half, ran the
tempo and the section off constants, never set the song's key at all, and skipped the
shoulder. None of that was a decision anybody made, and the effect was that clicking a node
face to see it bigger gave you a different picture and no way to know why.

**What a front end still decides is the destination.** A wall gets a keystone and a master
gain; a node face gets neither. Everything above that line is one list.

The banks are re-read **every frame** rather than kept beside the program, and that is what
`banksOf` is for. Two of the three change without the shader changing: a number set on an
inlet is a
uniform, and so is a `track` node's `smooth` — which, held from compile time, left that
one control doing nothing until something else forced a rebuild.

## An effect must not measure itself in pixels

`edge` did. Its tap was a count of output pixels, which is what an edge detector normally
wants and is wrong here: a flow is authored on a 320-pixel node face, judged on an
800-pixel bench and projected at 1920, and one output pixel is three different thicknesses
in those three places. The one node you could not trust a preview of was the one whose whole
job is a line.

It is a fraction of the frame's height now, so the bench predicts the wall exactly and a face
is the same picture with less of it. Every other effect was already in plane units — the
`uRes` in `shift` and in the source shaders is aspect correction, which is a different thing
and is right.

**A `place` is the same rule from the other end.** It is the one node whose whole output is a
coordinate — two 0–1 numbers into a point — and it builds one through `recentred`, so 0 and 1
are the frame's own edges in both axes on any window.

The plane is `vUv - 0.5` with the x scaled by the aspect, so a 16:9 frame runs ±0.5 up and
down and about ±0.89 across. A hand-written `(n - 0.5) * 2.0` therefore overshoots — the
whole picture is in the middle *half* of the control's travel vertically and the middle 89% of
it horizontally, and those two are not the same fraction, so the same turn of `x` and of `y`
moves a different distance. `recentred` is the helper that already knows the frame's shape,
and using it means the ends of the travel are the ends of the picture. See [flows](flows.md).

## What is not built

- **Beat-locked video.** `pace` changes ordinary playback rate; it does not seek on every frame.
  A transport-locked mode needs its own discontinuity and resynchronisation rules.
- **One track's picture as another's input.** A flow reaches a track's *meter* and not its
  *frame*. That needs a render target per track, which this does not keep.
- **A `tracks` texture per mode.** Two `tracks` nodes with different modes in one flow share
  the first one's, because a target per mode is a target per node and the win is small.
- **More than one output.** Corner pinning is one quad over the whole frame. Resolume slices
  a composition across several projectors with a warp each, which is the same maths repeated
  and a much larger question about what a slice *is*.
- **Edge blending**, for overlapping two projectors.
- **A master fader.** `Show.master` is on the wire and unused. Live's Master volume is the
  obvious source for a global brightness.
