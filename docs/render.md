# The renderer

`src/render/`. WebGL2, one full-screen pass per layer.

## The frame

```
clear black
for each layer, bottom to top:
  if nothing is playing in it, or its fader is down   -> skip entirely
  if it has an effect:  source -> offscreen -> effect -> screen, blended
  otherwise:            source -> screen, blended
```

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
renderer having crashed.

## The clock is a uniform

Nothing in a shader reads a wall clock or counts frames. `uBeat` and `uPhase` come from
Link, so a shape that grows over a bar grows over a *musical* bar and stays with the music
when the tempo moves. That is the difference between this and a screensaver.

`uTime` exists and is barely used, on purpose: it is for drift and shimmer — things that
should specifically *not* be in time. The noise source's weather moves on `uTime`; its
density moves on `uLevel`.

`beatPulse(division)` in the preamble is 1 on the beat decaying to 0 across it, and
everything reactive is built from it so that "on the beat" means one thing everywhere.

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
time it is asked for and is held for the life of the page. A shader that fails to compile
sets `error`, which the panel shows, and the layer is skipped rather than the frame being
abandoned.

## What is not built

- **Video clips.** Every source is procedural. A `<video>` texture is one more source kind
  and no change to the pipeline, but it brings a whole question about where files live that
  the derived mapping has no answer for yet.
- **Layer transforms** — position, scale, rotation. Resolume has them per layer; here a
  source fills the frame.
- **Effect chains.** One effect per layer. The pipeline ping-pongs naturally if a second
  target is added, and the ordering question is `Chain`'s, not the compositor's.
- **A master fader.** `Show.master` is on the wire and unused. Live's Master volume is the
  obvious source for a global brightness.
