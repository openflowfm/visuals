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

## The last pass, and the projector

`render/keystone.ts`. A projector is never square to the wall, and moving the stand is not
an option when the stand is where it has to be. An angled throw lands a **trapezoid**, so
the correction is the inverse trapezoid: draw the picture into the shape that arrives as a
rectangle.

It is a **homography**, not a scale. The four corners move independently, lines stay
straight, and the spacing *along* them does not — which is the whole point, because an
angled throw makes the far edge of the image larger and the correction has to shrink it by
an amount that varies across the frame. Two keystone sliders cannot express that, which is
why the ones built into cheap projectors never quite line up.

```
layers -> the output target -> one pass through the inverse homography -> the screen
```

`squareToQuad` is Heckbert's closed form — worth using over an 8×8 solve, because the
square's corners are known constants and most of the general solution collapses. The shader
gets it **inverted**: a fragment shader is asked what colour *this output pixel* is and has
to answer by reading the input, and mapping forwards would leave holes wherever the warp
stretched. Sampling outside the source is black rather than clamped, or the projector paints
a bright fringe exactly where you are trying to find the edge of the frame.

**Square corners skip the pass entirely.** Everyone whose projector is pointed at the wall
pays nothing for this existing — the layers draw straight to the screen exactly as they did
before. The one exception is while the align overlay is up, because the test grid is drawn
*by* that pass, and someone about to line a projector up needs to see the frame's edges
before they have moved anything.

The grid is computed in **source** space, so it arrives on the wall already warped: line it
up until it is square where the picture is going, and the picture is square too. Its line
widths come off `fwidth`, so a line stays one pixel wide where the warp has squeezed the
grid rather than thinning out of existence.

**It is not in the scheme, and must not be.** The scheme is a file you commit and carry to
the gig laptop; a show that looked different there would be a bug. A keystone is the exact
opposite — it describes one projector at one angle in one room, so one that travelled would
be wrong everywhere except where it was set. It lives in the browser's `localStorage`, which
is the correct scope: this machine, surviving a restart, going nowhere.

`k` opens it. Drag a corner or arrow it, hold shift for a single pixel.

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
