# The renderer

`src/render/`. WebGL2, two passes and an output stage.

## The frame

```
the set's picture (only if the look asked for it)
  clear transparent
  for each playing Live track:
    ease its opacity toward the target; below 0.002 -> skip entirely
    draw its picture, blended, into one target

the look
  one full-screen pass, one compiled fragment shader
  reading that target wherever a `tracks` node appears

the output stage
  keystone, shoulder, master gain -> the screen
```

**There used to be a pass per layer and a pass per effect on it**, ping-ponged through two
targets. That is gone, because [a colour is a function of a point](looks.md): a whole look —
however many sources, effects and nested looks it contains — compiles to one shader, and
composition happens in the expression rather than in a buffer.

**The set is the one thing that cannot be an expression.** A `tracks` node draws the same
picture once per playing Live track, with a different colour, meter and fader each time, and
a fragment shader cannot loop over a varying number of those cheaply. So it stays a pass, and
it is the last surviving piece of the compositor this replaced.

**Opacity is eased, not set.** Without it, a scene change would pop tracks into existence on
one frame. The glide is ~200ms expressed against `dt`, so it looks the same at 60 Hz and
144 Hz, and a track whose clip stopped fades out on its way rather than vanishing.

**A track with nothing playing draws nothing** — not the last thing it played. A track that
held its previous clip after the scene changed is the failure that looks most like the
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
was less than opaque and made an unwired `top` a black frame. See [looks](looks.md).

It is a **fixed rule rather than a bound one**, and that is the trade this change makes:
per-track blend was a field on a binding that no longer exists. If it needs to vary, it
varies inside the graph — a `blend` node is right there.

**The look reads the scheme every frame**, because a look is a graph and what a graph
compiles to is the scheme's to say. Resolving that on the server would mean shipping a shader
down the wire on every edit; doing it here means a look recompiles the moment its wiring
changes and never when only a knob moved. The cache signature walks the **expanded** graph,
so editing a look changes the signature of every look that contains it.

`uParams` is the bank the knobs ride in — a `value` node's amount and every number set on an
inlet — and it is **declared at the size the graph needs**, since the shader is generated.
Giving an inlet a number for the first time is a change to the shader's shape and recompiles
once; every turn of it after that recompiles nothing, which is the whole reason a knob is a
uniform. `uTracks` is a second bank, of eight, filled only for a look that **named** a track.
`uEnergies` is a third, filled on the CPU because an envelope follower has to remember what
it saw last frame.

## What there is to look at

Eleven pictures and twelve effects, all of them **node modes** rather than a parallel
registry of their own. They are deliberately unlike each other rather than variations on a
theme — five sources all drawing soft noise is one picture, however many of them there are.

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

Adding a picture is a body in `GENERATOR_BODIES` and a name in `SOURCES`, and nothing else:
the same body serves the `source` node and the track pass, so what a built-in draws and what
a node draws cannot drift. Adding an effect is a row in `EFFECT_KNOBS` and a row in
`EFFECT_EMIT` — the second is a function of `(read at a point, energy, knobs)`, which is
where the three shapes an effect can have become visible. A **remap** reads once at a moved
point; a **colour** operation reads once where it was; a **tap** reads several times and is
the only thing here that can make a shader expensive.

Nothing has to be registered in a scheme, because a mode is not a look.

## The clock is a uniform, and so is energy

Nothing in a shader reads a wall clock or counts frames. `uBeat` and `uPhase` come from
Link, so a shape that grows over a bar grows over a *musical* bar and stays with the music
when the tempo moves. That is the difference between this and a screensaver.

`uTime` exists and is barely used, on purpose: it is for drift and shimmer — things that
should specifically *not* be in time. The noise source's weather moves on `uTime`; its
density moves on `uLevel`.

`beatPulse(division, energy)` in the preamble is 1 on the beat decaying to 0 across it, and
everything reactive is built from it so that "on the beat" means one thing everywhere.

**Energy is an argument, not a uniform.** It used to be the one number the whole show agreed
about — an archetype set it, a cascade biased it, and every shader read `uEnergy` without
being asked. That made "energy" mean exactly one thing forever, where in practice it means
whatever you decide and the useful one is often a particular track's.

So `rate`, `beatPulse`, `charge` and every generator take it as a parameter, and every
`source` and `effect` node has an `energy` inlet. `uEnergy` survives as **the room's** energy
— a smoothed master meter — which is what an unwired inlet falls back to. A default, not a
level. See [looks](looks.md).

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

## Fill rate is the only performance number

Cost is `pixels × passes × 60`, and there are far fewer passes than there were: one per
playing track plus one for the look, where it used to be up to three per track. What
replaced them is **instruction count inside one shader**, which is cheaper per pixel but no
longer free to grow — a multi-tap effect over a deep graph is the way to make a single pass
expensive, and `MAX_LINES` is the backstop.

Resolution is still the decision that matters. Left to the display it is ruinous: a Retina
laptop reports `devicePixelRatio` 2, which on an ordinary window asks for **3728×2006** —
7.5 megapixels, sixty times a second. So the drawing buffer is capped at **1920 on its
longest edge**, overridable with `?maxEdge=`. The output of this is a projector and a
projector is 1080p; a preview on a 5K panel is very slightly soft in exchange for the frame
rate that actually matters.

Two smaller choices in the same direction. The full-screen pass is **one oversized triangle,
not two**, so there is no diagonal seam where interpolation is discontinuous. And a track
that is silent or faded out is skipped before its shader is ever bound, which is why an
eight-track set with two clips playing costs two passes and not eight. A look with no
`tracks` node in it skips the whole set pass.

## Programs are compiled on demand and kept

The wheel changes which look is up on a musical boundary, and compiling a shader mid-set is
a dropped frame at the worst possible moment. So each look compiles the first time it is
asked for and is held for the life of the page.

A look is held against a **signature** of what it was built from — the node kinds, modes and
cords of the **expanded** graph, sub-looks included. Node positions and knob values are
deliberately absent, or dragging a node would rebuild a shader sixty times a second.
Expanding first is what makes a nested edit visible: signing only the top graph would leave
an edit to a look-inside-a-look invisible until something else forced a rebuild.

A build that fails is remembered as a failure, for the same reason: retrying it every frame
calls the driver's compiler sixty times a second for as long as it stays broken, which is a
stall rather than an error message.

`src/render/look.ts` holds what both the stage and the node faces need — the shader, the
banks, the signature. **The bench is not in that list**, because the bench is a whole
`Compositor` on its own canvas rather than a second renderer. There used to be one and it
was a standing risk: a bench that could disagree with the stage about brightness or blend is
worse than no bench.

## What is not built

- **Video clips.** Every picture is procedural. A `<video>` texture is one more `source` mode
  and no change to the pipeline, but it brings a whole question about where files live.
- **One track's picture as another's input.** A look reaches a track's *meter* and not its
  *frame*. That needs a render target per track, which this does not keep.
- **A `tracks` texture per mode.** Two `tracks` nodes with different modes in one look share
  the first one's, because a target per mode is a target per node and the win is small.
- **More than one output.** Corner pinning is one quad over the whole frame. Resolume slices
  a composition across several projectors with a warp each, which is the same maths repeated
  and a much larger question about what a slice *is*.
- **Edge blending**, for overlapping two projectors.
- **A master fader.** `Show.master` is on the wire and unused. Live's Master volume is the
  obvious source for a global brightness.
