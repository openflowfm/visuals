# The renderer

`src/render/`. WebGL2, one full-screen pass per layer.

## The frame

```
clear black
for each layer, bottom to top:
  ease its opacity toward the target; below 0.002 -> skip entirely
  no effects:   source -> screen, blended
  otherwise:    source -> offscreen, then each effect ping-ponging,
                the last one landing on the screen, blended
```

**Opacity is eased, not set.** Energy moves the floor gate and the floor gate moves
opacity, so a chorus arriving would otherwise pop three layers into existence on one frame.
The glide is ~200ms expressed against `dt`, so it looks the same at 60 Hz and 144 Hz, and a
layer whose clip stopped fades out on its way rather than vanishing.

That is the whole thing. There is no scene graph and no accumulator buffer, and both
absences are deliberate.

**Blending is fixed-function.** Every shader writes *premultiplied* alpha, which means the
four modes are one `blendFunc` each and the compositor never has to read back what it has
already drawn:

| blend | `blendFunc` |
|---|---|
| `over` | `ONE, ONE_MINUS_SRC_ALPHA` |
| `add` | `ONE, ONE` |
| `screen` | `ONE, ONE_MINUS_SRC_COLOR` |
| `multiply` | `DST_COLOR, ONE_MINUS_SRC_ALPHA` |

`OUT(rgb, a)` in the shader preamble is the one way to leave a fragment shader, and it does
the premultiply and applies the layer's fader. An effect pass sets `uOpacity` back to 1
before it runs, because it is sampling a picture the fader has already been applied to and
must not apply it twice.

**A layer with nothing playing draws nothing** — not the last thing it played. A layer that
held its previous clip after the scene changed is the failure that looks most like the
renderer having crashed. Its target goes to zero rather than being skipped outright, so it
fades rather than cutting.

**An effect mixes against its own input** by `uAmount`, which is what lets energy dial one
in instead of switching it on. It samples an already-premultiplied picture, so `uOpacity` is
bound to 1 for an effect pass — the fader was applied when the source drew, and applying it
again would square it at every step of the chain.

**A layer names its effects by id, and the scheme says what an id is.** So the compositor
takes the scheme every frame alongside the show: an id is either six lines of handwritten
GLSL or a canvas full of nodes, and resolving that on the server would mean shipping a
shader down the wire on every edit. `uParams` is an eight-float bank an effect's own knobs
ride in — a bank rather than a named uniform each, because a [circuit](circuit.md)'s knobs
are discovered from its nodes and cannot be declared ahead of time, and because a value in
a uniform is one that can be turned without rebuilding a shader.

## What there is to look at

Eleven sources and twelve built-in effects, plus whatever [circuits](circuit.md) have been
wired. They are deliberately unlike each other rather than variations on a theme — a stack
of five layers all drawing soft noise is one picture, however many layers it has.

| source | |
|---|---|
| `solid` | the song's colour, breathing on the bar. Something has to be opaque at the bottom |
| `bars` | a bar of music as columns, with the playhead sweeping them |
| `rings` | rings launched on the beat, expanding out |
| `noise` | a drifting field that thickens with the sound. Weather, not a metronome |
| `strobe` | whole-frame flashes on the division energy chose |
| `grid` | cells lighting on their own beats. Structure rather than motion |
| `tunnel` | a corridor rushing toward you. Depth is `1/r`, which is what makes it perspective rather than rings |
| `plasma` | four crossed sines. The full-frame wash, in a colourway and its complement |
| `spiral` | arms winding out and turning on the beat. The only one with a direction |
| `scan` | lines, with a bar's sweep passing down them. The one that looks like a machine |
| `sparks` | a cell per spark, each firing on its own beat and drifting as it dies |

| effect | |
|---|---|
| `mirror` | a fold, at an angle. Rotating in and out is what turns one mirror into every mirror |
| `kaleido` | folded in polar space, turning with the beat. Energy adds segments |
| `shift` | channel separation that opens with the level, so it bites on transients |
| `pixelate` | blocks that resolve across the bar |
| `ripple` | a wave leaving the centre on each beat. The most frenetic of them |
| `smear` | a short radial blur. The opposite of ripple |
| `bloom` | eight taps on a ring, and only what is bright is added back |
| `slice` | rows thrown sideways, re-diced on each beat division. Wrapped, not clamped |
| `edge` | difference across a pixel. The one effect that makes a busy frame *less* busy |
| `posterize` | colour quantised to a handful of steps |
| `twist` | rotation growing with radius. Where kaleido folds, this wrings |
| `invert` | on the beat and off again. The only one that is a switch rather than a shape |

Adding one is a shader and a row in `BUILTIN_PARAMS`, and nothing else — the scheme
registers built-ins by id from `server/scheme.ts`, and `merge` puts new ones into every
existing file. The parameter bank is positional: index 0 in the list is `uParams[0]` in
that shader, so a parameter is appended rather than inserted.

## The clock is a uniform, and so is energy

Nothing in a shader reads a wall clock or counts frames. `uBeat` and `uPhase` come from
Link, so a shape that grows over a bar grows over a *musical* bar and stays with the music
when the tempo moves. That is the difference between this and a screensaver.

`uTime` exists and is barely used, on purpose: it is for drift and shimmer — things that
should specifically *not* be in time. The noise source's weather moves on `uTime`; its
density moves on `uLevel`.

`beatPulse(division)` in the preamble is 1 on the beat decaying to 0 across it, and
everything reactive is built from it so that "on the beat" means one thing everywhere.

`uEnergy` is the other one, and it is why a section is not a different shader. `rate()`
turns it into a musical division — quantised, because a rate between an eighth and a
triplet is in time with nothing — and `charge()` turns it into brightness and contrast,
applied by `OUT` so no source can forget it. The same source is coarse and calm in a verse
and dense and hard-edged in a chorus. See [the cascade](mapping.md).

Two things about those that were wrong for a while, and are worth stating because both
failed in the same direction — *everything at once*:

**`rate()` is per layer as well as per energy.** Energy alone put every layer on the same
division, so a chorus was twenty-odd layers flashing in unison — which is one flash, however
many things are drawing it, and it reads as a strobe rather than as a picture. The offset is
a hash of the layer's seed, so it is stable and still a musical division: one layer lands on
the bar while another lands on eighths, and both are in time. The top of the ladder came
down from four events per beat to three at the same time.

**`charge()` is a contrast about a pivot, not a squared multiply.** The old shape scaled the
colour and then squared it, which at a chorus put a white pixel at 1.9 — meaning everything
above 0.66 came out flat white *before a single layer had been composited*. A chorus was not
brighter than a verse; it was clipped. It now pushes the darks down as it lifts, which is
what contrast actually is, and leaves a little headroom for the shoulder to work with rather
than handing it a frame that has already lost the top.

The same reasoning caps `solid`: it is the one source that fills the frame at full alpha, so
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

## Fill rate is the only performance number

Every layer is a full-screen pass, so cost is `pixels × layers × 60`, and the resolution is
therefore the single decision that matters. Left to the display it is ruinous: a Retina
laptop reports `devicePixelRatio` 2, which on an ordinary window asks for **3728×2006** —
7.5 megapixels, times five layers, times sixty a second.

So the drawing buffer is capped at **1920 on its longest edge**, overridable with
`?maxEdge=`. The output of this is a projector and a projector is 1080p; a preview on a 5K
panel is very slightly soft in exchange for the frame rate that actually matters. Measured
at 1080p with five layers on an M-series laptop: **a steady 60**.

Two smaller choices in the same direction. The full-screen pass is **one oversized triangle,
not two**, so there is no diagonal seam where interpolation is discontinuous. And a layer
that is silent or faded out is skipped before its shader is ever bound, which is why an
eight-track set with two clips playing costs two passes and not eight.

## Programs are compiled on demand and kept

A show changes which source a layer draws whenever a clip fires, and compiling a shader
mid-set is a dropped frame at the worst possible moment. So each kind compiles the first
time it is asked for and is held for the life of the page.

An effect is held against a **signature** of what it was built from — its built-in name, or
a circuit's node kinds, modes and cords. Node positions and knob values are deliberately
absent from it, or dragging a node would rebuild a shader sixty times a second.

A build that fails is remembered as a failure, for the same reason: retrying it every frame
calls the driver's compiler sixty times a second for as long as it stays broken, which is a
stall rather than an error message. `error` is what the panel and the effects pane show, and
a broken effect drops out of its layer's chain rather than taking the layer with it.

`src/render/effect.ts` holds the three things both the compositor and the effect bench need
from an `EffectDef` — the shader, the parameter bank, the signature. The bench draws on its
own canvas with its own context (`src/render/preview.ts`), and sharing that file is what
stops it from being a second, subtly different renderer.

## What is not built

- **Custom sources.** A [circuit](circuit.md) that paints without sampling is already a
  generator, but a layer's `source` slot still only offers the six built-in ones.
- **Video clips.** Every source is procedural. A `<video>` texture is one more source kind
  and no change to the pipeline, but it brings a whole question about where files live that
  the derived mapping has no answer for yet.
- **Layer transforms** — position, scale, rotation. Resolume has them per layer; here a
  source fills the frame.
- **More than one output.** Corner pinning is one quad over the whole frame. Resolume slices
  a composition across several projectors with a warp each, which is the same maths repeated
  and a much larger question about what a slice *is*.
- **Edge blending**, for overlapping two projectors.
- **A master fader.** `Show.master` is on the wire and unused. Live's Master volume is the
  obvious source for a global brightness.
