# Flows

`protocol.ts`, `client/render/circuit.ts`, `client/render/glsl/*`,
`client/render/shaders.ts`, `client/ui/Designer.tsx`.
The one noun, the vocabulary it is wired from, and the compiler underneath.

## One noun, and it is a graph

A **flow** is a graph that produces a frame. Not a graph plus a stack plus a cascade: one
graph. `FlowDef` is a name and a circuit, and that is the whole type.

Everything that used to be a *level of something* is a node in it — the pictures that ship,
the effects that work on them, the Live set's own layer mix, the meters, the song, and
other flows. That collapse deleted four concepts:

| gone | it was | it is now |
|---|---|---|
| the layer stack | a base plus two transformers, ping-ponged | a chain you draw, in one shader |
| `Scheme.layers` | what each track draws, bound by name | a `tracks` node |
| `Scheme.clips` | the exception, keyed by clip name | a graph, or a song override |
| `Scheme.archetypes` | energy and character per section | a `track` node and a `song` node |

Each of them was a different answer to **how do two pictures combine**, and a graph answers
that once. What is left above the graph is [the wheel](wheel.md), which is deliberately tiny.

## A colour is a function of a point, not a value

This is the change that let the stack go away, and it is unusual enough to state plainly.

The obvious way to build a node compositor is to give every colour node a render target:
draw node A into a texture, let node B sample it. That is what the old renderer did with two
ping-ponged buffers, and it is *why* an effect could only ever work on "the frame that
arrived" — a linear chain, because a chain is all two buffers can express.

Here a colour outlet compiles to an **expression evaluated at a point**, and the point is
threaded through resolution. `kaleido` does not sample a buffer; it asks its input for the
colour at a *folded* point, and the input re-evaluates itself there:

```glsl
vec4 v0 = laid(gen_plasma(fxKaleido(centred(), 0.5, 0.5, uEnergy), uEnergy), uEnergy);
```

Everything composes for free from that. Two sources can be folded differently and blended,
a flow can be dropped inside another flow, and none of it needs a buffer or a second pass.

**The `point` node emits the point being asked about**, not `centred()`. That one line is
what makes the threading compose: a graph reading `point → fold → source`, evaluated at a
remapped point, folds the remapped point rather than starting over from the fragment.

### What it costs, which is worth knowing

A **multi-tap** effect evaluates its whole input once per tap. `bloom` is eight taps plus
the centre, `smear` is six, `edge` is four, `shift` is three. Nesting two of them multiplies.
`MAX_LINES` is the backstop and it refuses by name rather than handing the driver a shader
that takes a second to compile — the number is high enough that no sane graph reaches it,
and [the randomiser](wheel.md) deliberately never wires those four.

A bounded procedural node needs a second answer, because a loop or repeated kernel may still
be one GLSL statement. `field` charges 9, 16, or 7 primitive visits for cells, clouds, or
metaballs; `light` charges 1, 8, 16, or 18 for its lamp, beam, shafts, or
caustics; `fractal` charges its thirty-two-step orbit ceiling. The compiler adds that work
every time the graph asks for the picture at another point, so a three-tap colour shift over
clouds fits while a nine-tap bloom is refused. Two direct fractals fit; putting one under any
`spread` does not. A seven-ball metaball under the same nine-tap bloom costs 63 of 64 and fits.

A **video** is the deliberate stateful exception to expression-only pictures. The graph still
samples it as a colour at a point, so lenses, grades, spreads, blends, and nested flows work
unchanged, but a browser decoder and persistent WebGL texture own the current frame. Only
reachable video nodes start decoders, and a flattened flow may reach at most two. Texture
uploads happen when the browser reports a newly decoded frame, never merely because another
render frame began. That keeps a 30 fps clip at roughly 30 uploads even on a 120 Hz display.

The node has `loop`, `once` and `scrub` modes. `once` holds its final decoded frame; leaving
the flow releases the decoder, so returning starts it from the beginning. A played clip takes
`pace`, a centred 0–1 control mapped exponentially from 0.5× through 1× to 2×, and `freeze`,
a gate that pauses the decoder on the frame that is up and lets it run again when the gate
falls. A **scrubbed** clip takes neither and takes `position` instead: the whole clip over
0–1, seeking only when the ask has moved by more than a frame's worth. That is the mode that
makes a clip a function of the music rather than a thing playing beside it — a bar-length
ramp is one pass through the footage at whatever tempo the room is at.

All three are CPU-evaluated from the same number graph the faceplate reads, because none of
them is something a fragment shader can do: a shader decides what a frame looks like and only
a decoder decides *which* frame it is. `freeze` is its own inlet rather than a pace of zero
because `playbackRate = 0` is not a legal rate in every browser, and the ones that accept it
disagree about whether the decoder still holds the frame. Video audio is always muted. An
absent or undecodable asset draws transparent and reports a visible renderer error instead of
taking the flow down.
Small node-face thumbnails leave video transparent to avoid decoder churn; the large bench
and wall play it.

Files are ids below `OPENFLOW_VISUALS_MEDIA`, defaulting to
`~/.openflow/visuals/media/`. The server groups supported files by media type, follows no
symlinks, rejects absolute paths and traversal, and serves byte ranges for decoder seeking.
The selected relative id travels with the scheme; the media file does not.

An **image** crosses the same safe media boundary without a decoder clock. PNG, JPEG, WebP,
and AVIF files are discovered separately from video, so each node's selector only offers files
it can use. `cover` fills and crops; `contain` preserves the whole image and makes its unused
frame transparent, which matters when it is blended. A reachable still is fetched, decoded,
and uploaded once, then kept as one texture until the flow or selection changes. Its longest
uploaded edge is capped at 4096 pixels or the GPU's lower texture limit, and no flattened flow
may reach more than four image nodes. Parked image nodes allocate nothing. Small node-face
previews bind them transparent for the same anti-thrashing reason as video; the bench and wall
render the real image.

The **previous frame** is the third stateful picture, and the only one that is not a file.
See [the frame before this one](#the-frame-before-this-one) below: one ping-ponged target per
destination, sampled by a `last` node as a colour at a point, exactly as a video is.

The server follows no symlinks and refuses traversal for both media types. It deliberately does
not admit GIF or SVG: the former quietly turns a still node into animation, while the latter
adds an active/external-resource format to a boundary meant to serve inert files.
A control may stop work sooner, but controls can turn after compilation, so the budget is
always the hard ceiling rather than what happens to be visible now.

## Three signals

| signal | is | `data-kind` |
|---|---|---|
| **point** | where in the frame you are looking, `vec2` | `p` |
| **number** | anything scalar — one you set, a meter, the beat, `float` | `n` |
| **colour** | a premultiplied `vec4` | `c` |

Having exactly three types is what keeps the canvas legible: a cord's colour tells you what
it carries, and the editor refuses a cord it cannot type rather than inventing a conversion.

Points are **centred and aspect-corrected** — zero in the middle, a circle round. Their
vertical range is ±0.5; on a 16:9 frame the horizontal range is about ±0.89. They are not
±1. `uncentred` and `recentred` are the pair that convert, and only the handful of effects
whose maths was written in screen space ever touch them.

### Numbers are 0–1

Every number a node produces is 0–1 unless it is `beat` or `time`, and every number a node
*consumes* is read as 0–1 and mapped internally to whatever that node's useful range is.

This is the rule that makes the vocabulary composable: any outlet can go into any inlet and
mean something, so wiring a meter straight into a kaleidoscope's segment count works without
anyone having built a scaling node first. The cost is real — a node's internal range is its
own business and is not visible on the canvas. The alternative is a patch bay of converters,
which is how these things usually die.

It is also what lets **one control** serve every number inlet there is. `VALUE` in
[`param.ts`](../client/ui/param.ts) is that control, and nothing has to declare a range to get
one.

### The wire is normalized; the response is not

The final 0–1-to-domain mapping is executable metadata on the consuming
`PortSpec`, after the inlet's held value and modulation depth have been combined.
`response.ts` owns the data shapes and their matched TypeScript and GLSL
evaluators: linear, exponential, centered power, and discrete steps. This keeps
cords interchangeable while letting a signed speed spend most of its travel
near stopped, a frequency use ratios, and a count land on actual rungs.

Response-set version three contains 85 calibrated controls: the original three
rotation mappings plus 82 accepted legacy-parameter shapes. Linear identities
are recorded alongside root and square choices so the source says that a
control was judged, not merely that it happens to retain its old arithmetic.
Swirl remains linear, twist has more linear reach, and kaleidoscope spin has a
square response with more reach. The
[calibration bench](calibration.md) substitutes candidate definitions at
compile time without writing them into a flow. Its broader legacy-parameter
matrix shapes the normalized input in front of the existing shader mapping;
those compact source-controlled mappings can be absorbed into semantic
responses as the handwritten arithmetic moves. Accepted responses live in
source, never in the calibration database or in a scheme.

### Unconnected inlets have answers, and a number's answer is yours

Every inlet has an answer, so a half-wired graph still compiles and still draws. An unwired
`point` inlet is **the point being asked about** and an unwired colour is transparent. An
unwired **number** is a number — and it is on the node's own face.

That last one used to be a constant nobody could reach. A `posterize` has one inlet and one
useful thing to say about it, and saying it meant dropping a `value` node, naming it and
drawing a cord across the canvas to set a number that went nowhere else — a node and a wire
to say *four steps*. The number is on the node now. It starts wherever the fallback
already was, so nothing changes until you turn it, and a cord is what you draw when the
number should come from somewhere rather than what you draw to have a number at all.

Only what `out` can reach is emitted, so a node parked on the canvas while you decide where
it goes costs nothing. That is not politeness, it is how these get built: you drop a node,
look at what it did, and wire the next one. A compiler that treated an unfinished graph as
an error would make the canvas unusable for exactly the way it gets used.

**A set number rides a uniform, never the source.** These are deliberately left out of
the shader cache's signature so that dragging one does not recompile sixty times a second;
a number written into the GLSL would hand that back at every inlet on the canvas, and what
it reaches a person as is a control that stalls the picture. So every set number gets a slot in
`uParams` — the same bank a `value` node rides — and the **bank is cut to the graph**,
because the shader is generated and can declare exactly the size this one needs. Giving an
inlet a number for the first time recompiles once, since that is a change to the shader's
shape. Turning it after that recompiles nothing. A flow that sets nothing at all still
declares one float, because GLSL rejects a zero-length array.

**Wiring is not a destructive gesture.** A wired inlet's number stays on the node and its
row stays on the face. An inlet that snapped to its default when you unwired it would be
one you stop experimenting with.

**Only numbers are settable.** A point has no single control and a colour has no useful
constant, so those two keep the answers they always had.

### A cord carries an inlet; it does not replace it

A cord into a number used to *be* the number: whatever arrived was what the inlet became,
and the number underneath went dormant. So a meter wired into an inlet swung it across the
whole range and there was no way to say *pulse between a fifth and a half* — the only way
to narrow it was a `math` node, and the only way to invert it was another one.

An inlet holds a **depth** as well as a value now, and a cord reads

```
value + depth × signal
```

clamped when it is read. The value is where the inlet sits; the depth is how far the signal
may carry it, **signed**, so the sign is the polarity — a negative depth runs the same cord
the other way with nothing wired in to do it.

**A depth of one over a value of zero is exactly the replacement it replaced**, which is
what a missing depth means, so a flow written before any of this draws the same picture and
costs the same slots. A wired inlet at that default takes no room in `uParams` at all;
give it either half of a range and it takes a pair, both riding the bank so that turning
one is never a recompile.

Both are set on the row: drag for the value, **shift-drag for the range**, and the span is
drawn from the value in the direction of the sign, so which side of the mark it falls on is
the polarity you set. That is also why the row is no longer disabled under a cord. It was,
on the argument that the number underneath was dormant and showing it would make the face
flow authoritative exactly when it was not — a good argument for what was true then. The
number is load-bearing now, so the row is honest again, and the live reading moved to the
readout where a number nobody can drag belongs.

The reinterpretation is real enough to need a migration: a number sleeping under a cord in
an older file is written down as a floor of zero with a depth of one, in `ranged` in
`server/scheme.ts`. It costs that dormant number, which was never on screen — and every
other reading of it would change a picture somebody already made.

### It was called a knob, and the word had to go

The number a node holds on one of its inlets was a **knob** — `CircuitNode.knobs`, `KNOB_AT`,
`LENS_KNOBS`, a `value` node the browser listed as *knob*. It is **`values`** now, everywhere.

A knob is the shape of a control. It is a fine name for the thing `widgets` draws — that
component is still `Knob` and should be — but it is the wrong name for what a flow *holds*,
because the same number is a knob on a face, a float in `uParams`, a key in a JSON file and,
the moment a cord lands on it, nothing you can see at all. Naming the stored number after
one of the four places it shows up made the other three read as exceptions, and it put a
noun from the front end into the file format.

The one thing to know reading the code is that **`CircuitNode.value` and
`CircuitNode.values` are one letter apart because they are related, but not interchangeable.**
`value` is the number held by a `value` node; `values` is the map of numbers held by a node's
settable inlets, keyed and trimmed against the inlets it actually has. A `track` node's CPU
envelope is neither, so it is `smooth`.

Every file already written says `knobs`, so `reword` in `server/scheme.ts` carries them
across at the one door every scheme comes through, and drops the old spelling rather than
leaving both — see below on reading an old file.

**Two number inlets start on a signal rather than a setting**, and they are the two whose
answer is already alive: an `energy` inlet reads the room, and an `lfo`'s `clock` reads the
beat. Neither carries a default number — a default there would replace something moving with
something that is not, which is a worse default than the one it replaced. But the row is the
same fader as every other number row, and a drag on it catches the signal wherever it was
and holds it there. Held, it is an ordinary set value; double-click (or the `∿` beside the
port) lets it run live again. It used to be a meter — visibly identical to the faders below
it, taking no gesture, and a press on it dragged the whole node, which read as the first
parameter on the face being broken.

The same shape reaches further: every constant a source or field had `e` mixed into — a
`bars`' columns, a `spiral`'s arms, the weave of a `noise` or a `cells` — is an inlet now,
**following the energy inlet until somebody takes it**. Unwired and unheld it compiles to
exactly the coupling it replaced, through a held or wired energy too, so a graph nobody has
touched draws what it always drew — and every one of those numbers can be caught, or driven
by anything that makes a number.

**A mode's inlets carry their values with them.** See below — it is the same rule cords get,
one step quieter, and it matters more: a stray cord at least lights an outlet up, where a
number stranded under a name no port answers to cannot be seen at all until the mode comes
back and the picture changes for no reason. `setNode` drops those when a mode moves under
them and `merge` drops them at the door, exactly as it does for a cord.

**An unwired colour inlet is a no-op, in every mode.** `blend`'s `multiply` was the one
exception and it did not survive: on premultiplied colour a plain `a * b` multiplies the
coverages as well as the colours, so an empty `top` — `vec4(0.0)` — took the base out.
All four modes are now written as the `blendFunc` the track pass gets them from, which also
keeps the graph and the set agreeing about what `screen` means. See [the renderer](render.md).

**A graph with nothing wired to `out` still compiles**, and draws transparent black, because
that is the state every graph passes through on the way to being one. What it must not do is
be *silent* about it: a canvas full of nodes drawing black is indistinguishable from a canvas
full of nodes that is broken, and the difference is one cord. So the canvas says
`nothing reaches out` under the graph and refuses nothing.

**A branch that stops one cord short is the same argument, one step later.** Once something
*does* leave the flow, a node whose work never reaches a door — `out`'s inlet, or a `give`'s
— draws no pixel, so the picture is identical to the same graph with that branch deleted.
`strandedNodes` names them and the canvas dims them and says how many there are, still
refusing nothing: a graph being wired is stranded almost continuously, so a canvas that
objected would object the whole time somebody was working. The lab takes the opposite
position on the same fact and rejects a *candidate* that has any — see
[the lab](lab.md).

## A folder is the registration

Every node kind has one folder under `client/nodes/` and one `node.ts` descriptor in that
folder. The descriptor owns the stable kind, browser family, order, and whether the node is
addable, belongs on the flow shelf, or is fixed in every graph. `tools/generate-nodes.ts`
discovers those folders and writes `client/nodes/generated.ts`, whose static imports work in
both the Vite browser bundle and the raw Node MCP server. Vite refreshes it at startup,
`npm --prefix visuals run mcp` refreshes it before serving, and `nodes:check` plus the
manifest test make a forgotten generated update fail rather than silently hiding a node.

`NodeKind`, the family lists, browser placement, browser order, protocol validation, and the
MCP catalog all derive from that manifest. Adding a kind to a union or to a hand-maintained
palette is no longer part of adding a node. `NodeSpec` remains the executable compiler
contract — ports, documentation, fixed work, and emission — rather than the registry. New
runtime-specific contracts live beside their descriptor (`video/spec.ts` is the first), so
adding a node does not make the historical compiler table grow another implementation block.

## The vocabulary documents itself

The node reference is executable `NodeSpec` data, not prose copied into the browser.
Three interfaces make that a rule rather than a convention:

- `NodeDocumentation.description` is the plain-language account of a node regardless of its
  mode.
- `NodeModeDocumentation` gives every fixed mode its name and its own description. Bare mode
  strings are not part of a `NodeSpec` any more.
- `PortDocumentation.description` is required by `PortSpec`, so an inlet or outlet cannot be
  added to the compiler without also saying what arrives or leaves there.

`documentedModes` takes the protocol's fixed mode list and a mapped description object. Adding
one member to `SOURCES`, `LENS_MODES`, `MATH_OPS`, or another vocabulary is therefore a type
error until its description exists. The mode-dependent inlet tables derive a `ValueInlet`
union in the same way, so adding a control such as `ripple/depth` is a type error until that
port has a description too.

The app and the agent-authoring server read those same objects. Node descriptions feed browser
search and faceplate help; mode descriptions are the visible preset explanations; port
descriptions sit on the control or port row they explain; and `visual-flow://nodes` serializes
the whole registry for an MCP client. There is no UI-only or agent-only table to drift from the
renderer.

A completeness test still walks every node under every mode and checks every real inlet and
outlet. The types catch a missing field where it is authored; the test catches a dynamic port
that a mode assembled incorrectly. That is why this is both documentation and coverage of the
actual headless vocabulary.

## The vocabulary

Grouped the way the browser groups them, which is `NODE_FAMILIES` in `protocol.ts` — two
editors listing these differently would be two different vocabularies.

### draw — everything that makes a colour out of nothing

| node | in | out | |
|---|---|---|---|
| `tracks` | `p` | `c` | **the Live set**: every playing track, drawn and mixed. Fire a scene, it changes |
| `source` | `p` `energy` | `c` | one of fourteen, including `checker`, `rays` and connected `traces`; all are safe as per-track pictures |
| `field` | `p` `energy`, plus `balls` `apart` on metaballs | `c` | `cells` `clouds` `metaballs`; fixed work, charged per graph sample and never offered per track |
| `fractal` | `p` `energy` + its mode's numbers | `c` | `mandelbrot` or `julia`, with bounded zoom, detail and iterative work |
| `light` | `p` `energy` + its mode's numbers, and `from` on the hung three | `c` | `lamp` `beam` `shafts` `caustics`; 2D lights with fixed work, drifting in seconds rather than beats |
| `form` | `p` `turn` `tilt` `dolly` `thick` `flare` `chrome` `energy` + its mode's numbers | `c` | `torus` `rings` `frame` `lattice` `weave` `loom` `orbits` `relief` `iris` `truss` `rotor` `armillary` `gyre` `astrolabe` `rosette` `corolla` `spindle` `meridian` `tube`; the one node with a third coordinate in it, marched and charged like a fractal |
| `glow` | `d` `energy` + its mode's numbers | `c` | `neon` `soft` `band`: a distance becomes a lit stroke |
| `shade` | `n` `amount` `energy` | `c` | `across` `heat` `filament`: a number becomes a colour off the colourway |
| `flow` | `p` | `c` | another flow, whole, as one node |
| `last` | `p` `fade` | `c` | the frame this flow drew last time, fading as it ages |
| `colorway` | `amount` `energy` | `primary` `secondary` `complement` `accent` `chalk` | the colourway that is up, one outlet per role |

### transform — everything that gives a picture back where it already is

| node | in | out | |
|---|---|---|---|
| `grade` | `c` + its mode's numbers | `c` | `levels` `saturate` `hue` `tint` `posterize` `solarize` `channels` `invert` |
| `spread` | `c` `energy` + its mode's numbers | `c` | `bloom` `smear` `edge` `shift` `streak` `disperse` |
| `halftone` | `c` + its mode's numbers | `c` | `dots` `lines` `dither` `scanlines` |
| `blend` | `base` `top` `amount` | `c` | `over` `add` `screen` `multiply` `stencil` `cut` |

### geometry — moving the point a picture is read at

| node | in | out | |
|---|---|---|---|
| `point` | — | `p` | where this fragment is being read |
| `place` | `x` `y` | `p` | how two numbers become a position |
| `lens` | `p` `c` `energy` + its mode's numbers | `p` `c` | `zoom` `swirl` `fold` `wobble` `tile` `mirror` `kaleido` `twist` `ripple` `slice` `pixelate` `creep` |
| `displace` | `p` `field` `amount` | `p` | `map` `curl`: a point moved by what a picture says |
| `polar` | `p` | `radius` `angle` | how a position becomes a number |
| `figure` | `p` + its mode's numbers | `d` `along` | `circle` `box` `line` `arc` `polygon` `star` `rose` `lissajous`: how far this point is from a shape |
| `array` | `p` `count`, and `turn` on the ring | `p` `which` | `row` `grid` `ring` `mirror`: a repeated space, and the copy you are in |
| `vary` | `n` `steps` | `n` | `even` or `few`: an ordered number dealt into a stable unordered one |

### `place` is the other direction, and it was missing

`polar` took a point apart and nothing put one back together. A graph could read a position
as two numbers and never write two numbers as a position, so a point built from a pair of
`lfo`s, or from two Ableton track levels, was a sentence the vocabulary could not say.

`place` says it. Two 0–1 numbers, `x` and `y`, through `recentred` — the same helper the
handful of screen-space effects come back through — so **0 to 1 spans the frame and a half
is the middle**. The aspect correction comes with it, which is the reason it is that helper
and not a hand-written `(n - 0.5) * 2.0`: doubling about the middle overshoots the plane in
both axes and by different amounts, so the ends of the travel would be off the picture and
a turn of `x` would not move as far as the same turn of `y`. See [render](render.md).

An untouched one is the **centre**, because both inlets start at the half every number inlet
starts at. So dropping a `place` in front of a picture changes nothing until you turn
something, which is the same bargain every other unwired inlet makes.

**A place is one colour.** It is the same point for every fragment, so a picture read at one
fills the whole frame with whatever is at that spot — moving, if the numbers move, but flat.
That is a real thing to reach for: it is how you take a colour *out* of a picture and blend
it under something. It is also why [the randomiser](wheel.md) never wires one, and why a `place`
node's own face is a flat square.

**Cartesian, and there is no polar mode.** Two numbers read as a radius and an angle is a
genuine second answer, and the substitution rule is what says it cannot be a mode of this
one: *would you flick between these two with the picture up and no cords moving?* No — `x`
and `y` are the only inlets there are, so a flick to `radius`/`angle` cuts **every cord on
the node**. That is what separates it from `lens`, where eleven modes rename their numbers
freely and the picture and the point stay wired throughout. A mode moving the trim is the
rule working; a mode moving the whole signal path is a change of wiring wearing a dropdown.

And it is not a second *kind* either, because two node kinds differing only by a coordinate
system is two rows in a browser for one idea — the exact complaint that merged `energy` into
`track`. So building a point from a radius and an angle is not expressible, `lfo` and `math`
cannot fake it (`math`'s `subtract` clamps at zero, so there is no way to make a bipolar
cosine out of a unipolar sine), and it is in **what is not built** below where it belongs.

## A distance is the missing direction, and `figure` measures one

`read` turns a picture into a number and `polar` turns a point into numbers. Nothing went the
other way. A number could decide *where* something was drawn and never *that* something was
drawn, so the only way to get a line on the wall was to find a `source` that happened to
contain one — and the whole family of looks that is nothing but glowing curves was
unreachable by anyone who had not shipped a shader for it.

Three small nodes close it. **`figure` is `polar` generalised off the origin**: instead of
how far this point is from the middle, how far it is from a circle, a rose, a lissajous
figure — and, on its second outlet, how far *along* that shape the nearest part of it lies.
It is in `geometry` for the reason `polar` is, and it gives back a number rather than a
picture, which is the whole design. What a distance becomes is somebody else's decision:
**`glow`** makes it a lit stroke with a hot filament and a halo, **`shade`** makes it a
colour off the colourway, `math` makes it another distance, `displace` reads it off a
picture instead. A `figure` that drew its own line would own a thickness, a falloff and a
colour, and would be one more source that only draws what its author thought of.

`shade` is not called `ramp`, which is what it is: an lfo runs a `ramp` shape, and one word
meaning a falling oscillator in one node and a colour lookup in another is a vocabulary you
cannot read a dropdown out of. It is not `swatch` either — the colourway editor calls its
five role chips swatches, and this node's job is the colours *between* those five.

Only `lissajous` costs anything: a closed form for the distance to one does not exist, so it
is walked in thirty-two segments and charged at that ceiling the way a fractal is. Everything
else is arithmetic, which is why a `glow` may be bloomed like any other picture.

**Most of these distances are radial rather than perpendicular.** For a circle, a box and a
straight line the two are the same and the maths is exact. For a rose, a star and a polygon
the distance is taken along the ray from the centre, which is wrong by the cosine of how
steeply the curve leans away from that ray. What it *looks* like is a stroke that thickens
where the curve is steep — which is what a brush does. An exact rhodonea distance costs a
root solve per pixel and buys a stroke of relentlessly even weight.

## `array` repeats a space and says which copy you are in

`lens/tile` already repeats a picture across the frame, and for a wallpaper that is the whole
job. What it cannot say is *which* tile, so every copy is the same copy and twenty of them is
one thing stamped twenty times.

The second outlet is the entire reason this is a kind. Wire `which` into a sweep, a phase, a
size or a colour and the copies stop being stamps: a fan of arcs each opening a little
further, a stack of squares each dimmer than the last, a grid of cells each firing on its own
beat. It is the difference between a repeat and an arrangement. Two outlets of different
signals is already precedent — `polar` has them — and neither can be a loop, because an
`array` has no colour inlet to feed anything back into.

## `form` is the only node with a third coordinate, and it keeps it

A colour here is a function of a point and the point is two numbers. That is what makes the
graph composable, and it is also what kept every picture in it flat: a ring seen at an angle,
a cube whose far edges are behind its near ones, a corridor with things arriving out of it —
none of that is a function of where you are on the screen. It is a function of what lies
along the ray through that screen position, which is a **search** rather than an expression.

So `form` does the search and hands back a picture, exactly as `field` and `fractal` do for
their own bounded loops. The third coordinate stays inside it. Nothing else in the vocabulary
learns one, no cord changes what it carries, and a form composes downstream as any other
picture does.

**It brings its own light rather than being bloomed.** Every step of the march adds
`exp(-distance)` to a running total, *weighted by how far that step carried the ray* — count
steps instead and you count deceleration, because a march slows to its floor as it closes on
a surface, so a ray grazing a tube comes out as bright as one that went through the middle.
Weighted, the glow is an integral along the ray, which is better than a screen-space bloom
rather than a substitute for one: near tubes bloom harder than far ones, and a strand passing
behind another glows through it. It is also the only affordable answer — a march is charged
at its step ceiling and a `spread` reads its input once per tap, so a bloom over a form would
charge nine marches and be refused by name.

**Chrome is an inlet, not a mode.** The march already knows where it stopped, and four more
distance samples give the surface normal, so a reflection is one `reflect` and a room to
reflect into. The room is the colourway as a gradient with a **hard horizon** in it: a
polished thing reads as polished because it shows you a whole room compressed into a curve,
and a room has edges. A smooth gradient reflected off a tube is indistinguishable from matte
plastic lit from above, which is what the first version of it was. At `chrome` zero none of
it is mixed in and the form is pure emission.

`weave` and `orbits` are compound objects rather than more primitives. A weave is twelve
rounded rectangular tube loops: four parallel layers in each of three orthogonal planes.
`apart` separates those layers, `corner` runs each loop from square toward round and `tumble`
rotates the complete union as a rigid body, so crossings keep a real front and back. Orbits
nests five smaller ring radii across fixed crossing planes inside one enclosing ring; `nest`
controls the radial hierarchy and its own `tumble` moves the assembly without changing the
camera. Weave's two-axis route eases away from exact equal-angle steps so its fourfold
symmetry does not collapse a phase sequence into repeated views, while both axes still close
exactly at the seam. Both remain analytic unions inside the existing march — they add no hidden loop and
keep the same declared work ceiling as the five simpler forms.

`truss` is a related construction with different dimensions and motion rather than a renamed
weave. Its twelve members are four parallel rounded-rectangle rails around each of the three
centre planes of one cuboid: the wide, tall and deep faces share the same three physical
extents. That produces the outer cage, horizontal hourglass and nested central diamonds as
different projections of one object instead of drawing those silhouettes independently.
`apart` separates each four-rail face and `corner` rounds it. `tumble` drives a closed rigid
oscillation which exposes a different side at every quarter, dwells around the frontal
hourglass and returns every member and crossing to the same place at the seam.

`rotor` is a counter-wound pair of turbine cages rather than a flat radial array. One open
U-shaped blade is folded analytically into between fourteen and thirty azimuthal sectors;
each blade has two swept sides, a rounded outer bridge and four deliberately open ends around
the throat. Front and rear cages rise into opposite domes and disagree slightly in phase and
curl, so the rear members become visible through gaps in the front and produce real woven
crossings under an oblique eye. `blades` sets the physical member count and `sweep` controls
both the pinwheel bend and dome depth. `tumble` combines a bounded two-axis view excursion
with thirteen complete blade sectors of spin. Repeated geometry therefore returns to the
identical pose at one without hiding the object edge-on for half the loop. The sector fold is
analytic and the approximate swept-curve distance uses a conservative half stride, so the
mode still has only the renderer's one ray loop.

`armillary` is one fixed dark sphere, an analytic bank of seven to twenty separate coplanar
hoops and three enclosing gimbals. The gimbals are single broad polished bodies: the parallel
streaks which cross them come from a black studio's reflected strips, not extra rails frozen
into the geometry. The same strip bends into the characteristic diagonal slash on the sphere.
Every member remains centred on the origin, so radius gives it a stable material identity while
its plane moves; spectral roles therefore stay attached to physical hoops instead of sliding
over the finished image. `ribs` sets the bank's member count, `nest` its outer radius and
`tumble` runs the bank and three gimbals through separate closed precessions. Hoop planes are
half-turn periodic, so their whole- and half-turn paths meet exactly at the loop seam even
though their bounded excursions produce different intermediate silhouettes.

`gyre` uses three banks of four genuinely nested rounded hoops. Two large banks turn in
counter-motion and a smaller axial bank runs through them, producing the capsule, diamond,
crossed waist and rounded-square projections of one continuous construction. The outer hoop
of each bank has a broader shoulder and is identified by comparing its exact distance with
the whole bank once at the final shading point. It can therefore carry the pale emissive shell
while inner members stay black chrome; a radius threshold would wrongly brighten the corners
and sides of the same rounded rectangle differently. `nest` controls the size hierarchy,
`corner` changes every member's roundness and `tumble` closes the two half-turn planes and
axial whole turn at the seam. The Xenon 91 treatment mirrors the rendered projection across
both frame axes—the source members remain ordinary 3D solids, while the two mirror seams make
the exact bilateral cusps visible in the reference.

`astrolabe` locks between three and seven circular gimbals into one rigid sculpture. They are
rounded rectangular metal stock rather than round neon cord: a hoop exposes a broad radial
face from one direction and only its thin edge from another. `members` changes the physical
member count and `spread` opens a deliberately non-uniform hierarchy—two dominant outside
bands around a much smaller inner knot. One closed three-axis rocking transform drives
`tumble`, so the angles between members, their intersections and their occlusion order remain
fixed through the loop instead of every hoop inventing a new pose. The mode uses a close
wide-angle eye so near arcs swell around a compact far knot. Its neutral stock reflects broad
cyan, magenta, warm and white studio panels; colour therefore travels along the same member as
its surface normal turns, while a weak permanent member tint keeps crossings legible. Two
orthogonal `mirror` lenses can impose Xenon 96's exact frame symmetry after projection without
changing the underlying 3D construction.

`rosette` distributes between five and twenty-four equal circular hoops on permanent hinges
around one axis. `petals` alone chooses the member count; `spread` moves every hinge outward
while shrinking its hoop, so a low value makes large circles cross through the common axis and
a high value opens a hollow wreath without replacing the members at a hidden threshold. Every
hoop opens by the same closed angle around its own radial hinge while the complete rail rocks as
one construction. The camera push is part of that closed choreography: the coplanar wreath is
shown whole, then the eye moves close as its hoops stand up and their projected rails leave the
frame. All members are evaluated explicitly because a nearest-sector shortcut overestimates the
distance along rays approaching from another sector and cuts black wedges through the sculpture.
The members use fine emissive wire with a saturated hit core rather than chrome-dark tube faces,
which preserves the thin cyan/white crossings in the Xenon 05 treatment.

`corolla` is a separate two-bank mechanism rather than the high-spread end of `rosette`. Ten to
fourteen rounded outer loops and circular inner hoops sit on coaxial hinge rails. In the compact
pose both banks stand in tangent planes around a hollow torus, like links around a necklace; as
`open` advances they enlarge and rotate into a face-on layered flower. The outer bank also makes
one coherent normal-axis twist during that opening, producing a pinwheel instead of a radial
row of rectangles, while the inner circular bank opens by a different angle into the smaller
turbine. `petals` changes the permanent sector count and `corner` changes only the rounded outer
profile. Both banks retain every member, hinge and distinct profile through the closed cycle,
and all sectors are explicit for the same ray-distance reason as `rosette`. This is the compound
compact-cage/large-flower topology of the Xenon 78 treatment, not a 2D repeat of one petal.

`spindle` stacks between nine and seventeen permanent open circular rails on one vertical axis.
Their heights and radii form a fixed symmetric hierarchy: a narrow middle and progressively
larger outer members. A close wide-angle eye turns the middle circles into horizontal rays while
near outer arcs swell beyond the frame, producing Xenon 32's hourglass without a radial screen
warp. Each member is a true circular arc. Inside its moving gap the field measures distance to
one of two round endpoints rather than to an invisible complete hoop, and both the gap centre and
half-width follow closed paths so the same endpoints circulate and change separation through the
loop. `ribs` changes the permanent member count, `reach` changes the outer radius hierarchy and
`phase` drives that endpoint circulation. All possible rails are explicit because a nearest
height-plane fold can miss a more distant member whose larger radius is physically closer.

The material follows that construction too. A two-wave light chase is indexed by the rail's
fixed height identity, so brightness migrates through members rather than flashing the entire
render; a permanent overhead bias gives the stack its asymmetric studio exposure. Its broad
volumetric halo uses lower gain than the other fine-wire forms, and polished surfaces reflect a
separate cyan/warm panel room. The graph therefore controls geometry, endpoint motion, light and
material independently while remaining one bounded march.

`meridian` builds two oblate banks of complete elliptical rails in permanent vertical planes.
Every upper member shares the waist pole and one upper pole; every lower member shares that same
waist pole and one lower pole. Their projection explains both parts of Xenon 59 without inventing
a second structure: near-edge-on planes collect into the narrow central fans, while progressively
face-on planes become the long nested side arcs. There are no latitude hoops and therefore no
false grid junctions. `ribs` sets the repeated plane count and `bow` changes the horizontal ellipse
radius without changing any pole or rail identity.

`phase` counter-rotates the upper and lower plane sets by exactly one repeated plane spacing, so
the first and last fields are identical. Two closed waves travel around each ellipse in physical
polar coordinates and across its fixed plane identity. That makes bright segments migrate along
the same complete rails while the unlit portions remain real occluding geometry rather than being
deleted by a screen mask. A mostly cyan strip-lit room and a small opposing bank exposure reproduce
the moving white/cyan emphasis while leaving geometry, excitation and reflected material separately
controllable.

`loom` repeats the weave as geometry through all three axes rather than tiling a rendered
picture of it. Every cell contains three orthogonal four-member loop bundles. Each complete
bundle rises and falls by one member radius around its rounded path, with a different phase
per orientation; crossings therefore acquire depth order without fusing the members, cutting
an artificial gap or changing their topology. Its chrome response keeps the broad room dark
while retaining narrow glints, so these read as black tubes rather than silver bars. `apart`
sets bundle spacing, `cells` sets construction spacing and `travel` advances through exactly
four repeated cells while the eye makes one closed sway. Position modulo the field, heading
and roll therefore agree at zero and one.

`relief` lays out a deterministic grammar of closed frames, nested U modules, elbows,
stepped hooks and paired circular arcs, then makes their paths into shallow bevelled solids with broad front
faces and real sidewalls. Cells rotate and vary slightly in height without changing identity,
so motion is a camera crossing one constructed wall rather than a texture boiling underneath
it. `tiles` controls the physical cell size, `raise` sets their extrusion and `travel` moves
the eye around a closed two-axis path over the field. On this
mode the common `tilt` is the grazing angle, `dolly` is altitude and `turn` is camera roll.
Member cells carry their own chased material identity, so a bright region travels through the
geometry instead of a whole rendered frame being flashed.

`iris` encloses a finite barrel of circular hoops inside an exact two-circle lens shell.
`ribs` changes the spacing of the bank and `open` its radius. `phase` is a seamless physical
cycle rather than a texture animation: the barrel begins edge-on, progressively gives way to
an explicit symmetric pair of rigid tilted hoops at the midpoint, then closes back to the
same edge-on bank. The pair is explicit because tilted hoops overlap in projection and a
nearest-member repeat can represent only one of them; it is still a fixed analytic union and
adds no shader loop. The hoop radii follow a permanent barrel profile instead of breathing,
so the envelope stays constructed while visibility changes. Its hot filament clips through
the colourway's chalk role rather than neutral white, and opposite sides of the lens tube use
accent and primary roles to produce surface-bound orange/cyan fringes without a multi-sample
screen-space dispersion.

`tube` exposes the two quantities its corridor formerly owned: `radius` sets how far the helix
runs from its axis, and `travel` is normalized distance through exactly two repetitions. Its
unwired travel retains the old slow beat-driven flight; wiring a phase makes the fly-through
scrubbable and exactly seamless at zero and one.

## Light is allowed above white, and that is where a bloom comes from

For most of this vocabulary's life nothing in it could emit a colour greater than one. It
sounds like a rounding matter and it is the difference between a picture that is lit and a
picture that is drawn.

The reason is what a blown highlight physically *is*. A bright thing does not stop at the top
of the display's range; it overwhelms the pixel it lands on and spills into the ones around
it, and the size of that spill is how the eye judges how bright the thing was. Clamp every
stage at one and there is no spill to find — a filament and a merely-lit line come out the
same value, and the only tool left for saying "brighter" is a wider stroke.

The buffers have to be deep enough to carry it, and for a long time they were not: every
intermediate target was `RGBA8`, so the excess was quantised away before the output stage's
shoulder could roll it back down into the top of the range, and the brightest pixel the app
could draw was 232 of 255. See [the engine](./engine.md) for that and for the dither that
goes with it.

So three things carry the excess. `glow/neon` drives its filament past one, by an amount its
`core` chooses; `form` keeps the light it gathered along the ray unclamped before deciding how
white it is; and `charge` — the contrast every generator passes through — clamps at
`OVERBRIGHT` rather than at one. None of that is visible on its own. What makes it visible is
`spread/bloom`, which takes eight taps around each point, keeps only what is above its
`floor`, and adds that back. **`floor` has white at its midpoint**, so at rest the node
harvests exactly the light that could not fit and nothing else. Turned down, it blooms things
that are merely bright, which is a decision rather than a default.

Two consequences worth stating. A bloom over a `form` is refused, because eight taps of a
march is eight marches — the light there is gathered along the ray on the way past instead.
And a glow's falloff is **windowed**: an inverse square never reaches zero, and the tail of
one glow covering every pixel in the frame at some small amplitude means a picture built out
of glows has no black in it anywhere, and any radial optic downstream turns that gradient into
a frame-wide hue shift. A cyan flower on a red field, with nothing in the graph saying red.

## `vary` deals the copies, because a copy number is in order and light is not

`array` hands out a copy number and `figure` hands out how far along a curve a point is. Both
are *ordered* — copy three is between two and four and always will be — so wiring either
straight into a control paints a gradient across the repeat: a fan whose arms get steadily
brighter clockwise, which reads as a ramp somebody applied rather than as sixteen separate
lights.

`vary` is the step from that ordered number to an unordered one that is nonetheless **stable**:
the same copy is dealt the same value on every frame, so nothing flickers, but neighbours have
nothing to do with each other. `steps` cuts the number into bands first, which is what turns a
continuous `along` into dashes rather than dissolving it.

The two modes are two distributions and the second is the one worth having. `even` is flat.
`few` is cubed, so most copies land near nothing and a handful land right up — which is how a
bank of lights actually looks, and what the eye reads as *many* rather than as a pattern. An
even roll across sixteen arms puts half of them in the top half of the range, and a ring where
half the arms are burning has no highlight in it at all.

`math/curve` is the general form of the same idea for a single number: `pow` with the exponent
on a control whose midpoint is the identity. It exists because there was no way to write an
exponent at all, so flows reached for `multiply` with both inlets fed from one cord to get a
square.

## `effect` was three things wearing one name

There is no `effect` node. There were twelve modes on one, and the compiler had been saying
for a while that they were not one thing: **six** of them emitted *read my input at a moved
point*, **two** emitted *change the colour where it is*, and **four** read their input
several times. Only the last can make a shader too big to draw; only the first is geometry.
One dropdown holding all three taught that they were variations on each other.

The six that move the point went to **`lens`** — and took the five standalone geometry kinds
with them, because those were already the same functions written twice under two prefixes in
two files: `fold` **is** `kaleido`'s wedge fold and `swirl` **is** `twist`'s rotation. Eleven
`vec2 → vec2` functions, one node.

### A lens has both outlets, and that is the whole trick

Take `p` and it is the geometry node it replaced. Take `c` and it is the effect: *the colour
of my input, at the point I moved to.*

Without the second outlet this would have been a regression rather than a merge. `Folded` is
the set kaleidoscoped — the plainest sentence in the vocabulary — and a point-only lens would
need a second node and two more cords to say it. With the colour outlet it is the same eight
cords it always was, and it now teaches something extra: one kind at both ends of one graph,
and the difference is which port you took.

The point outlet **cannot see the colour inlet**, which the spec says out loud. That is what
makes a lens feeding a picture that feeds the lens back a graph that terminates and draws,
where anything reasoning node-to-node calls it a loop and refuses the cord.

### `spread` is a kind because of what it *costs*

`bloom`, `smear`, `edge` and `shift` each read their whole input several times, so nesting
two multiplies everything upstream of them. That was already true and already load-bearing —
`randomize.ts` kept a hand-written list of these four by name so a deal would never stack three —
and a fact the vocabulary could not state was a fact somebody had to remember. It is a kind
now, and the list is gone.

### `displace` is not a lens mode, and `halftone` is not a grade mode

Three kinds were added for footage, and each one is a kind rather than a mode for a reason the
vocabulary already had a rule for.

**`displace` moves a point by what a picture says.** The eleven `lens` modes are eleven fixed
functions of a point — a fold, a swirl, a tile — and none of them can be told where to go by
something else, which is why footage under a lens reads as footage under an *effect* rather
than as footage moving on its own. A displacement takes its offset from a field, so the motion
is as organic as whatever is wired in, and at a low amount the content stays perfectly
readable while the frame breathes. It cannot be a `lens` mode because `lens` spends its one
colour inlet on *the picture it reads through*: a mode needing a second colour inlet for a
different purpose moves the signal path rather than the trim, which is the same line `place`
sits on the other side of.

Its two modes both take one `amount` and read the same field, so flicking between them moves
no cords at all. `map` reads red and green as x and y, the way a displacement map has always
been read, which is right for footage and photographs where the channels are independent.
`curl` reads brightness as a *direction*, which is right for everything else here: every
procedural picture is tinted by the colourway, so a source's red and green move together and
reading them as x and y would lock the whole displacement to one diagonal.

**`halftone` reads the colour *and* where in the frame it is.** Every `grade` mode answers
*what colour is here* from the colour that is already here; these four answer it from the
colour and its position. A dropdown holding both would teach that a hue rotation and a print
screen are variations on each other, which is the `effect` mistake in miniature.

They earn a place in a video vocabulary specifically. A halftone is the one reduction that was
invented to survive being reduced, so a face is still a face at four tones — which is the
whole brief: make it breathe, keep it decipherable. `scanlines` is the one that dims rather
than carves, and the difference is what the two things are: a screen decides whether there is
ink here, a tube decides how brightly this row is lit, and scanlines that carved holes would
composite as lace over whatever is underneath.

**`stencil` and `cut` are why `blend` has a mode list of its own.** `Blend` is the *set pass's*
list: four names that each compile to one `blendFunc` pair, because a track is drawn into a
buffer by fixed-function hardware. A stencil is not expressible as one, because it reads the
top picture's **brightness** where the hardware only ever reads its alpha.

Brightness rather than alpha is the entire point on footage: a video's alpha is 1 in every
pixel it has, so `over` can never be masked and `multiply` darkens the outside instead of
removing it. Wire the same picture into both inlets and a stencil is a luma key; wire a light
or a source in and it is a mask. The luminance is taken off the *premultiplied* colour, so it
is brightness times coverage in one number — a lamp fading to nothing at its edge should stop
masking there, and dividing the coverage back out first would make its faintest edge as strong
a mask as its core.

Each carve keeps all three inlets and moves only what the top inlet answers when nothing is
wired to it. Nothing on top of a sum is `vec4(0.0)`; nothing on top of a stencil is a mask
that lets everything through, which is white, and nothing on top of a cut is one that takes
nothing away, which is black. Left at zero, a fresh `stencil` would black the frame the moment
it was dropped and read as a node that had come unhooked — which is the exact complaint that
fixed `multiply`.

**And four `grade` modes that are only colour.** `saturate` was a plain hole: nothing in the
vocabulary could make footage mono, which is the most reliable way there is to make a clip sit
under everything else. `tint` maps luminance into a ramp ending at the room's own colour and is
the most content-preserving thing in the file — the brightness carrying the picture passes
through untouched and only the hue is decided, so a face is still a face while the frame agrees
with the colourway. `solarize` folds everything above a pivot back down the other side and
leaves it there, which is a *look*, where the `invert` beside it turns the whole frame over on
a division, which is an *event*. `channels` permutes red, green and blue, snapped to thirds so
an lfo wired into it lands on one of three whole rotations in time rather than spending most of
the bar between two wrong colours.

### the room — three questions you can ask the set

| node | out | |
|---|---|---|
| `playback` | `n` | where the music is now: `level` `beat` `phase` `pulse` `time` `random` |
| `track` | `n` | one track, **by name**, and which of its numbers: `level` `fader` `playing` — plus how much to smooth it |
| `song` | `n` | what the set's names say: `seed` `tempo` `key` `section` `sections` |

**Three, and there is no fourth.** It was four — `signal`, `song`, `track`, `energy` — and
the seam was in the wrong place twice.

`energy` was `track` with an envelope on it: same signature, same bank, named the same way,
differing by one number that happened to be computed on a CPU. Two rows in a browser for one
question, and two uniform banks for what is almost always two floats. It is a **number on
`track`** now, and at zero it is the meter itself.

`signal` sat next to `song`, which was also, unhelpfully, a signal. What separates them is
not where the number comes from but what you are asking: `playback` is where the music *is*,
`song` is what it *is*. Swapping `beat` for `phase` is a change of mind; swapping `beat` for
`key` is not.

That test — **would you flick between these two with the picture up and no cords moving?** —
is what decides a kind from a mode here, and it is worth stating because it is falsifiable at
the wall rather than a matter of taste. `level` and `fader` pass it, which is why they are
one node: a fader is a hand on a control, the most deliberate thing a player does that a rig
can hear, and it is a different answer to the same question rather than a different question.

`song key` is the musical one — the tonic as a pitch class over twelve, chromatic, with the
mode dropped. Two songs in the same key get the same number on purpose, which is what makes
it different from `seed`: it is the one song fact that is about *the music*, so a set wired
key → hue draws a picture that modulates with it. The mode is dropped because a 0–1 number
is a **position**, and there is nowhere honest to put a boolean in one — `Cm` between `C`
and `C#` would jump the picture a semitone every time a song went minor. Chromatic rather
than the circle of fifths for the matching reason: adjacent numbers should be adjacent
pitches.

The set states it as a name (`Bm`, `F#m`, `Db`), and a song whose scenes disagree renders as
the collection `Bm / D`. `server/show.ts` reads that — the playing **scene's** key first,
because a scene states one exactly when it departs from its song — and the first of a
collection, because a song that modulates is in the first key when it starts.

### numbers

`lfo`, `math`, `read`, `take`, `value`, and `vary`.

**`read` is the one that turns a picture into a number**, and until it existed nothing did.
Every `n` outlet in the vocabulary came from the clock, the set, or arithmetic between them,
so a picture could drive nothing at all. That barely mattered while every picture was
procedural — a graph already knows what it told a plasma to do — and it matters enormously
with footage, which is the only picture here whose content nobody in the graph chose.

It takes a `c` and a `p` and gives one number: `luma`, `red`, `green`, `blue`, or `alpha`.
Unwired, the `p` is the point being drawn, which makes a read a per-pixel fact about the
picture; wired to a `place` it is one spot, which makes it one number for the whole frame.
That is the difference between footage driving its own hue and footage driving the brightness
of the entire show.

Every colour on the wire is premultiplied, so the four colour modes divide the coverage back
out before reporting — a half-covered white pixel is `vec4(0.5)` and reading `.r` raw would
call it grey. `alpha` is the one that does not divide, because coverage is what it is asking
about.

A picture whose own reading moves it is a **loop**, and the compiler refuses it by name. That
is correct rather than conservative: the number and the picture are the same trip round the
graph. The way to say it legally is across a frame, through `last`.

**`lfo` is the only oscillator, and it was two.** A `wave` node turned whatever phase
reached it into a shape and, with nothing wired, read the beat — so it owned a clock after
all, and the line this paragraph used to draw between them was not one the code kept. Across
72 authored flows, every one of the 23 `wave` nodes in them was an oscillator on musical
time: ten took the beat unwired, eleven were fed a `playback` phase, and the three that
looked like genuine shapers were `playback:time` through a `math:multiply` — a rate knob,
hand-built. So they merged, and the six shapes a wave owned came across with it.

Eight modes now — `sine`, `triangle`, `saw`, `ramp`, `square`, `pulse`, `noise` and
`sample-hold` — over four inlets that stay put while the waveform changes. **`clock` is the
phase it runs on**, and it is alive: unwired it reads the beat, which is what makes an
untouched lfo run in time with the music. `rate` chooses the note period or frequency,
`sync` is a real two-state face control and a number inlet on the wire, and `phase` offsets
the result by zero to one complete cycle. Every one can be wired and modulated.

**A wired clock is divided rather than obeyed.** `rate` goes on working: a phase arriving
once a bar leaves twice a bar at `1/8`, which is the thing those three hand-built multiplies
were for. Free-running is the exception — elapsed seconds are the clock there, so a signal
wired in has nothing to divide and is not read.

A library written before the merge migrates at the one door every scheme comes through: a
`wave` becomes an `lfo` of the same shape, a cord on its `phase` moves to `clock`, and **the
rate is written down** rather than left at its resting place. That last part is not a detail.
`rate` is calibrated per mode — sine, triangle and saw square the knob and the rest do not —
so the midpoint is a whole-note cycle on the first three and a quarter-note cycle on the
others. A migration that trusted the default would have run half the shipped flows four times
too slowly: the same picture, and wrong.

Synced rate is quantized onto straight periods from `4/1`, `2/1`, `1/1`, `1/2`, `1/4`,
`1/8`, `1/16`, through `1/32`; the midpoint is a quarter-note cycle. Free rate is exponential
from 0.05 to 20 Hz with 1 Hz at its midpoint. The face prints the selected note period or Hz
and phase in degrees rather than showing percentages with no musical meaning. `sample-hold`
picks one deterministic value per complete cycle; node identity keeps two of them from
quietly producing the same sequence.

**`math` is deliberately asymmetric at the edge of the 0–1 convention.** `add` and
`subtract` clamp their answers to 0–1; `multiply` does not, while `min`, `max` and `average`
need no extra clamp for ordinary 0–1 inputs. The unclamped multiply is load-bearing:
`Water` uses it to amplify a number beyond one. It also means subtraction cannot make a
bipolar cosine from a unipolar oscillator, because its negative half stops at zero.

**`value` means one number in several places.** Every inlet holds its own number now, so a
`value` node wired to exactly one of them is the long way round — it says nothing the number
on the face does not, and costs a cord across the canvas to say it. What it still does, and
nothing else can, is put *the same* number on two inlets at once: turn it and both move.
`Weather` in the Examples scheme is wired that way on purpose, and it is the only `value`
node left in the seventeen flows that ship.

## `out` is at most one, and none is a provider

`out` is the render target: the picture wired into it is what the wall shows when this flow
is live, and what a parent flow reads when this one is nested. A flow keeps **at most one**
— two would be a question about which one shows, which is exactly the question this design
refuses to invent an answer for — and `merge` in `server/scheme.ts` collapses a file that
says two down to the one that was drawing.

It used to be required and undeletable, and is neither now, because a flow with no `out` is
a real thing: a **provider**, a flow that hands out signals through `give` doors instead of
drawing. Deleting `out` is how a flow becomes one, the browser offers `out` back for the
change of mind, and a flow with no out and no give gets one quiet line on the canvas rather
than a refusal. A provider asked to draw anyway — the wheel, the bench — shows the honest
transparent frame.

`flow` is the one kind the node browser leaves out: it is not missing, it is upstairs. Every
flow in the library is a row on the flow shelf, and one of those rows placed on a canvas
*is* a `flow` node.

The other thing repaired at the `merge` door is a **cord addressed to a port that is not
there** — judged with the whole library in hand, because a cord landing on a flow node's
door can only be checked against the flow it names. See below.

## A flow has doors: `take` and `give`

The browser has always described a node as what it TAKES and what it GIVES. A flow earns the
same sentence through two door nodes:

- **`take`** is a number the flow asks for. On its own canvas it is a `value` wearing a
  name — a label field, a fader, an `n` outlet — and inside another flow, that name becomes
  a real inlet on the `flow` node's face: settable there, wireable from anything that makes
  a number, falling back to the take's own resting value when the parent says nothing.
- **`give`** is a signal the flow hands out — a number, a point, or a picture, by mode. Its
  label becomes an outlet on the `flow` node's face, and a cord from that outlet reads
  whatever feeds the door inside.

Together they make a flow a **function**. The canonical use is the pre-wired reactive value:
a `pad energy` flow with all the smoothing and pulse-shaping built once, giving one number —
and any flow that wants that reactivity wires one outlet instead of rebuilding the chain.

**The compiler never learns any of this.** `flatten` resolves the doors while pasting: a
read of a give is rewired straight to what feeds it inside; a take supplied by the parent
vanishes and its readers take the parent's cord; an unsupplied take stands, holding the
number set on the parent face (or its own), exactly as a `value` does. A door with no label
is not a door yet, and the validator says so; a label the flow node already owns (`p` in,
`c` out) is shadowed and skipped; the first door to claim a name keeps it.

One honest limit today: the display clock cannot follow a number *through* a give door, so
a driven row on the far side reads `—` the way a per-fragment `polar` reading does. The
picture is right; the readout declines to guess.

## A mode moves the inlets

A node's inlets are its *mode's*: a `lens` set to `ripple` has `waves`, `depth` and `speed`;
a `grade` set to `posterize` has `steps` and nothing else. Changing a mode therefore changes the shape of the
node under whatever was already wired to it, and the cords that have nowhere to go are cut.

They used not to be, and the symptom was not the cord — the canvas cannot draw a cord to a
port that is not mounted, and the compiler ignores one addressed to an inlet that does not
exist. What you saw was **an outlet lit up with no wire leaving it**, and a node visibly
connected to something with no effect on the picture. Switching the mode back made the wire
reappear, which makes it look like the editor rather than the graph.

Cords are kept **by name**, so an inlet the new mode shares with the old one stays wired:
`bloom` and `smear` both have a `reach`, and it is the same number in both. The **numbers set
on those inlets** are kept by name too, and dropped by name — a number left behind on an
inlet the new mode does not have is invisible, and comes back to change the picture the next
time somebody switches the mode back.

## Energy is a node, not a level

It used to be the one number the whole show agreed about: an archetype set it, a cascade
biased it, and every shader read `uEnergy` without being asked. That made "energy" mean
exactly one thing forever — where in practice it means whatever you decide, and the useful
one is often a particular track's. **Bass energy** is a different picture from master energy
and neither is more correct.

So it is a node — and then it stopped being one. It is a **number on `track`**, because a
meter with an envelope on it is a `track` node with its smoothing turned up, and a node whose
only difference from another node is one number is a mode of that node. At zero it is the
number itself, which is exactly what `track` always did.

`rate`, `beatPulse`, `charge` and every generator take an energy as a **parameter**, and
every mode that reads one has an `energy` inlet — so what you wire in is yours.

The envelope is computed on the CPU and banked into `uTracks`, because an envelope follower
has to remember what it saw last frame and a fragment shader cannot. Fast up, slow down — one
that fell as quickly as it rose would be the meter again, and the meter is that same number
at zero.

`uEnergy` survives as **the room's** energy, a smoothed master meter, which is what an
unwired energy inlet falls back to. A default, not a level.

### It has no floor, and should not get one

With nothing playing, `Show.master` is zero — so a `track` node reading `master` is zero,
`charge` takes about a fifth off the brightness, and `rate` picks the slowest rung it has.
That is **right**: energy is a meter, and a meter with a floor under it cannot say *silence*,
which is the one thing a section break needs it to say.

What is not right is a flow that is only alive when the room is loud, because most of the
hours anyone spends in the designer are hours with no Live attached — and because a set
between songs is a click and nothing else. The fix is in the wiring rather than in the
number: **take the motion off the clock and let the meter add to it.** `phase`, `beat`,
`pulse` and a synced `lfo` both run whether or not anything is playing, since
Link free-runs.

The shape that says it is **`max` of a clock and a meter**, with the clock arriving on a
range:

```
lfo pulse ──────> a ┐                    a: value 0.3, depth 0.4
                    ├ max ──> energy     so the clock walks 0.3 → 0.7
track master ────> b ┘                   and the meter wins above that
```

`max` rather than `average`, because an average with a silent meter halves everything the
clock is doing — which is how a floor becomes a ceiling. The range on `a` is what keeps the
floor off the ground without pinning the top: an energy at 0.3 is a picture, an energy at 0
is the same picture at its dullest setting, and the difference between those two is most of
what "it looks dead at a desk" ever meant. The seventeen flows that ship keep that rule, a
test asserts it, and it is the difference between a library that reads as calm at a desk and
one that reads as broken.

The bench and the node faces are both fed the **room's** energy — the control on the designer's
own bar — for the same reason and from the other end: it is a condition you can dial rather
than one you have to wait for.

## The frame before this one

A colour is a function of a point, so no node can ever see another node's *result* — only
recompute it. That is what deleted the layer stack, and it forbids exactly one family of
effect: anything that needs a **finished picture**. Trails, echo, infinite zoom, and every
other feedback look are all one thing, and the expression model cannot say any of it.

So there is a `last` node, and it is the same escape hatch a video is: a real texture,
sampled as a colour at a point, with every lens, grade, spread, blend and nested flow working
on it unchanged. The trail everybody actually reaches for is four nodes —

```
last -> lens zoom -> grade levels -> blend add <- the fresh picture -> out
```

— and because a colour is a function of a point, the zoom does not need a pass of its own. It
compiles to one sample of the history at a moved point: `fromLast(cZoom(centred(), 0.55), …)`.

### It is the previous output of the whole flow

Not "the previous value of the node I am wired to", which would be a buffer per node and is
precisely the render-target-per-node design this renderer exists instead of. There is **one**
history, so every `last` in a graph reads the same frame and four of them cost four samples
rather than four buffers — unlike a video, which is a decoder and is capped at two.

A `last` inside a nested flow therefore reads the previous frame of the flow that reached the
wall, not of the sub-flow it was written in. That is the only coherent rule with one buffer,
and it is stated here because it is the kind of thing that is otherwise discovered.

### The buffer is per destination, and there are three of them

Feedback is state, and state belongs to whoever is drawing rather than to the graph. The
stage and the bench each own a `Compositor`, so each owns a history already. The node faces
are the hard case: `preview.ts` draws up to ten different graphs through **one** target in a
single frame, so one shared buffer between them would not be ten trails, it would be ten
graphs smearing into each other.

They get a history each, keyed by the same signature the shader is keyed by — so an edited
face gets a fresh, black history exactly when it gets a fresh shader. Twelve are kept against
a live-picture limit of ten, which is two spare so promoting a face does not evict the history
of one still on screen.

The two answers are also opposites on purpose. The compositor **ping-pongs**: two full-size
targets and a swap, because blitting 1920×1080 every frame is a second whole-frame write for
a picture nobody sees. A face **copies**, because ping-ponging needs a second texture per face
and a blit at the size of a node face is nothing.

A face's history is copied out **before** the output stage rather than after it, so a trail
accumulates the picture the flow made rather than the picture the shoulder left. Rolling the
highlights off once per frame, compounding, would make a long trail fade toward a colour the
wall never shows.

### The decay is in seconds, and it is the only thing here that is

Everything in this renderer is in beats on purpose: the clock is a uniform, so a shape that
grows over a bar grows over a *musical* bar and stays with the music when the tempo moves.
Feedback cannot be. A trail loses a fixed fraction per **drawn frame**, so a decay expressed
per frame is a decay expressed per display — a 0.9 that is a 115ms half-life on the projector
it was dialled in on is 58ms on a 120Hz laptop beside it.

So `fade` is a half-life in seconds, from a flicker to two and a half, applied with a `uDt`
uniform that is the one per-frame quantity in the preamble. Wire an lfo into it for a trail
that breathes with the music; the seconds are what make it the same trail on the bench and on
the wall. `uDt` is clamped to 100ms before it is uploaded, because a hidden tab, a stalled
driver, or the first frame after a rebuild all hand it a second or more, and one of those
would wipe a trail to nothing in a way that reads as the loop having broken.

### `creep` is the zoom a trail wants

The iconic feedback look is the history read slightly larger every frame, and `zoom` is the
wrong control for it twice over.

Its range is four octaves either way, so every useful per-frame step lives between 0.500 and
0.510 — a hundredth of the travel, which is not something anybody dials at a desk with a band
waiting. And a fixed factor applied once a frame **compounds into a different speed on every
display**: sixty frames of 0.99 is not a hundred and twenty frames of 0.99, so a trail set on
the projector runs at half the speed on the laptop beside it. That is the same fault `uDt` was
added to fix one node along, and feedback is the only place it can appear.

So `creep` is a zoom per *second*. Its exponents sum to the elapsed time however many frames
it took, and the curve is cubed so most of the travel is a few percent a second while the ends
can still throw the picture out of the frame. At rest it holds still, like every other centred
control.

It is deliberately **not dealt by [the randomiser](wheel.md)**. A creep only says something when
its result is fed back into the picture it came from, the randomiser never wires a `last`, and
a randomised
creep would be a lens moving the point by a fraction of a percent — a dead node wearing a real
name. The mode is not the problem; dealing it into a graph with no feedback in it is.

### A loop with gain in it will find white

`last` itself can never amplify: it multiplies by a decay that is at most one, and it does
**not** re-`charge` what it reads, which would compound contrast every frame until the picture
was two colours. The gain comes from what you add the history back with.

`blend add` is the one to know about. A bright picture summed into a history that decays by
0.995 a frame settles at a couple of hundred times that picture, which is a white wall in well
under a second. The output shoulder means it clips rather than explodes, but it clips to white.
`screen` is the safe version of the same gesture — `a + b - ab` converges on one rather than on
infinity — and a `grade levels` dimming the history before it is added back is the other
answer. This is true of feedback in every rig that has it; it is written down here because the
distance between a trail and a white-out is one knob, and the room it happens in has a band in
it.

### Two things it does not do

**It never samples past its own edge.** The target is `CLAMP_TO_EDGE` like every other one
here, which is right for an effect reading a neighbour and catastrophic for a loop reading
itself: a feedback zoom would write its own edge pixel back every frame and burn four
permanent streaks across the wall inside a second. Outside the frame `last` is transparent.

**It starts from black on a flow change.** Carrying a history across one would open the new
picture dissolving out of the old, which is a thing somebody might want and nobody asked for
— and, worse, it would make a flow look different the second time it was opened.

## The set is a pass, and it is the only one

A `tracks` node draws the same picture once per playing Live track, with that track's colour,
meter and fader each time. A fragment shader cannot loop over a varying number of those
cheaply, so it stays a pass: every playing track into one target, which the flow reads as a
texture. It is the last surviving piece of the compositor this replaced, and the whole reason
there is more than one pass left. See [the renderer](render.md).

What each track draws is the node's mode: `by name` uses the [name hints](../hints.ts), and
anything else draws every track the same way.

**One `tracks` texture per frame.** Two `tracks` nodes with different modes in one flow share
the first one's, because a target per mode is a target per node and the win is small. Not
built.

## A flow inside a flow

The graph a `flow` node names is **pasted in around the node** before the compiler runs, with
every id prefixed so two copies of one flow cannot collide. Expanding rather than teaching
the compiler about sub-flows is what keeps the compiler one thing: set numbers, named tracks and
energies all get their bank slots from the expanded graph without a second pass to gather
them.

**Around the node, not in place of it**, and that is the whole of why a `flow` node has a
point inlet that works. The sub-flow's own `out` becomes a junction held on a reserved inlet
— `~inner`, which the canvas hides because the flattener writes it and nobody else — and the
node's one job is to read that junction at whatever point is wired into `p`. So a nested flow
can be folded, zoomed or tiled from outside exactly as a `source` can, and with nothing wired
it is read where it is asked, which is identical to having pasted its nodes in by hand.

Splicing the node out instead left the `p` cord addressed to a node that no longer existed:
drawn across the canvas, looked up by nothing, changing nothing on the wall.

A **loop is refused at the moment of wiring**, by `wouldLoop`, not at compile time. At
compile time the honest message is "one of these seven flows contains itself", which nobody
can act on; at the moment of dropping, the message is about the thing you just clicked. The
compiler refuses one too, because a file can be hand-edited.

**A cord that would loop inside one graph is refused the same way**, by `wouldFeedItself`,
and both it and the compiler's guard are keyed by the **outlet**.

Not by the node, which was right until a lens had two of them: its point never looks at its
colour, so a lens feeding a picture that feeds the lens back terminates, and a node-wide
guard refused a graph that draws. Not by the node *and the point it is read at*, which is the
tempting third option and catches nothing at all — a loop with a lens in it arrives at a
different point every trip, so the pair never repeats and the resolver descends until the
stack gives out. What that reaches a person as is a page that has stopped rather than a
sentence about their wiring. By outlet the set is finite, so it terminates, and a colour that
comes back round still reaches an outlet that is already open.

A flow that has been deleted makes the node draw nothing rather than failing. A flow you
deleted should make the thing that used it go quiet, not stop the show.

**`The lot` is the shipped example**, and it is in the library rather than in this document
because a paragraph about nesting convinces nobody. It is `Water` as a wash, `Vortex` folded
by a kaleidoscope wired **point first** — the lens's `p` outlet into the flow node's own point
inlet, so the spiral bends into the wedges instead of being a picture of a spiral cut into
pieces — and `Outline` adding the set's own edges on top. It is also the most expensive flow
that ships, and for the reason above: `Vortex` ends in a `bloom` and `Water` in a `smear`, so
one frame is nine evaluations of that spiral and six of that plasma. Taking it apart is the
fastest way to find out what nesting costs.

## The designer is the product

Everything else this app does is arrangements of what gets made here.

**Two shelves under one search box**, and the split is the change. The **flow shelf** lists
your library, marked `◈`, each row saying how many nodes are inside it and carrying three
verbs — open it, place it in the flow you have open, or delete it (armed on the row, and
committed by a second press). The **node browser** below lists the
vocabulary, one kind per row with its signature (`p → c`) on the right. A flow used to
appear in both, and in the second one it was a chip identical to `source` — which is how a
flow that was a single `tracks` node came to read as a kind of node. See
[the console](console.md) for the shape, the four tools that solved this the same way, and
what the search box has to keep reaching.

A faceplate shows the **mode** rather than the kind, which is the same idea one step later:
a node reading `source` above a dropdown reading `plasma` makes you read two things to learn
one. The kind sits quietly beside the mode, and the hot-swap button opens that kind's modes
in the same browser that created it. Choosing one changes the node already on the canvas;
it does not drop a replacement. A target from outside the vocabulary — the track a `track`
reads or the flow a `flow` draws — stays in the one chooser band below the title.

**Every node has one anatomy.** Its fixed-size picture is an overlay above the frame, then
the title, two reserved outlet lines, one chooser band and six reserved inlet lines. Empty
space is real here: reserving the largest face means changing a mode, wiring a cord or
renaming a value gives the graph's port observer nothing to report. Each inlet is one row,
with its dot on the same centre as the thing it governs. A point or colour prints one name;
every continuous number — the alive ones included — gets one horizontal filled control with
its name and reading inside it; a binary inlet such as `lfo.sync` gets a switch but remains a
number on the wire. A driven number stays a control, because the number under the
cord is the floor the cord carries the inlet from: the row names its driver in its tooltip,
prints the arriving number in its readout, and holds the fill at the floor a drag on it
sets. Alive and driven rows are sampled on a ten-hertz display clock,
not the render loop, and React is updated only when the formatted reading changes.

The CPU can follow `value`, `playback`, `track`, `song`, `math` and `lfo` chains. A
`polar` outlet is different: its radius or angle changes per fragment, so there is no one
number to report. A row driven by one names `polar·radius` or `polar·angle` but deliberately
shows no number or fill rather than inventing a misleading value.

The outlet band is usually just a label and a dot. `lens` and `polar` are the two exceptions
because each has two honest answers to “what did this node make?” Their outlet labels are
buttons, with the selected one marked, and that explicit choice drives both the small face
and a promoted bench. Old graphs with no choice retain the wiring-aware fallback, so this
adds a decision without changing an existing picture.

**The bench is a `Compositor`**, not a second renderer. There used to be one and it was a
standing risk: a bench that could disagree with the stage about brightness or blend is worse
than no bench, because those are exactly what you come here to judge. With no bridge it gets
**stand-in tracks** driven off the beat, so a flow built on the set is not black at a desk —
which is precisely the situation the designer exists to work in. Those are `withStandIns` and
belong to the room rather than to the bench, because the node faces need the same four or
they are black while the bench beside them is lit.

**It floats over the canvas** rather than sitting in a column beside it, which is a layout
question with a real answer: a fixed sidebar takes its width from the narrowest thing in it,
and the thing you are actually judging was getting 236 pixels while the graph kept the rest.
See [the console](console.md) for that and for the group of controls above it.

**It runs on its own room.** `useTransport` free-runs — a tempo, a play button, a restart —
and `useRoom` invents the rest of the conditions a flow reads: energy, section, colourway
and key. Both can be told to take the real thing when there is one, and following is the
option rather than the fallback. What comes out is a `Clock` and a `Show`, the same two
shapes the compositor already takes, so nothing downstream can tell whether the beat came
from a laptop or a stage or whether the chorus is really happening. That is the point: what
you build at a desk is what will play.

## A picture on every node

Each node face shows what *that node* has made, not a thumbnail of the finished flow.
[`probe.ts`](../client/ui/probe.ts) builds a picture by cutting the graph off at one outlet and
bringing the result back to a colour: a point through a `plasma` source, because a point's
whole job is to move a picture and a picture with structure in it is one you can see moving.

A **number** outlet is not brought to a colour any more — its face is an oscilloscope.
It used to cross through `colorway`, which is honest as a wiring and useless as a reading: a
blinking rectangle cannot tell a sine from a saw, and the bridge's unwired `energy` rode the
room besides, so the face throbbed with a signal that was not the node's while the readout
beside it — off the CPU evaluator — told the truth. [`scope.ts`](../client/ui/scope.ts) draws
the trace from that same evaluator, so the face and the number beside it cannot disagree,
and the sweep is synced to the bar so a square at 1/4 is four stationary steps and a phase
offset is a visible shift. The `colorway` crossing survives where a number only exists per
pixel — `polar`'s radius has no single value to plot — and there its energy is now held at
the middle, so the probed signal is the only thing moving in the picture.

All of them come out of **one** GL context, blitted into a small 2D canvas per node. A
context each is the obvious build and the wrong one: browsers keep about sixteen alive and
start evicting the oldest, and this page already has the stage and the bench. That is also
why `preview.ts` caches programs by signature in a map rather than one slot.

One context does not make every draw free. Only visible faces draw, at most ten per frame;
the promoted node and `out` take the first slots. Scope faces are outside the count — a
polyline into a 2D canvas is not a GL draw, so a graph full of numbers never spends slots
the pictures could use — though they obey the same switch, zoom floor and visibility. Zoom below a half, exceed the budget or
turn **live pictures** off and the affected faces keep their last frame with `paused` written
on it. The browser reports `live / visible` beside the switch, so saving work never looks
like a broken preview. The switch is a machine preference in `localStorage`, not part of the
scheme: projector and authoring laptop can make different performance choices without
changing a flow. Graph zoom stays owned by `Graph`; the budget reads it through a stable ref
so a wheel gesture does not become a React update through every node.

A node picture is fed **exactly what the bench is fed**, and that is a correction. It used
to be stand-ins — the set as one grid shader in a hardcoded orange, every meter banked at a
half, the tempo at 120, the section in the middle, the song's key not set at all — on the
argument that a face is a *diagram* and the real set would make a dozen tiny canvases
flicker.

That argument was wrong in the way that matters. The gesture this panel is built around is
**click a face and see it bigger**, and a small picture that cannot be compared to the big
one has failed at the only thing it is for: you cannot tell whether what you are looking at
is the node or the renderer. Fourteen separate uniforms had drifted between the two lists,
in different files, neither of which looked wrong on its own — so there is one list, in
[`feed.ts`](../client/render/feed.ts), and the stage, the bench and every face read it.

The faces get the same [`Show`](../client/state/useRoom.ts) the bench does, which at a desk is
the room, dialled, and therefore steady anyway — including the same stand-in set when there
is no Live attached, which is `withStandIns` and is shared for the same reason.

**A face gets the library, not just the graph.** A nested flow is a *different* graph, so a
`preview.ts` handed only a circuit had nothing to expand a `flow` node against — which made
that node's face black, and every face downstream of it black too, in a graph that drew
perfectly well on the wall. A run of black diagrams down the middle of a working flow is
exactly the thing a node face exists to prevent.

So the probe graph is parked under a reserved id and expanded by the **same** `flatten` the
stage uses, rather than given an expander of its own. A face that disagreed with the bench
about what a nested flow draws would be worse than one that showed nothing, because it would
be believed.

**Clicking a face promotes it to the bench**, which is the other half of the same idea: a
hundred pixels across is enough to see *that* something is happening and nowhere near enough
to see what. The only way to flow properly used to be to wire the node into `out`, flow, and wire it
back — an edit, made to answer a question, on a graph that is the record.

The two are now the same picture at two sizes, which is what makes the click worth making.
The same `probeAt` graph, the same feed, and the same output stage — a face lands through
the **shoulder** as well, so it does not show a highlight the bench beside it has already
rolled off.

**What is left different is framing and resolution**, and both are honest. A face is 16:9
because the wall is; a bench is whatever shape you dragged it, and a wider one shows more of
the same plane with circles still round. Resolution is the other one, and it is why `edge`
measures its tap as a fraction of the frame rather than in pixels — see [render](render.md).

`probeAt` is shared rather than reimplemented, so what gets bigger is the picture and not the
reading of the node. It is [the console](console.md) that has to say which of the two you are
looking at, and it does: a number and a point have no picture of their own, so what you get
big is still a diagram, and a big diagram implies otherwise unless it says.

## Reading a file written when the cascade existed

`server/scheme.ts` carries forward what a **person made** and drops what the cascade decided.
The colourways, which song draws from which, and any flow that was a graph all survive.
`layers`, `clips` and `archetypes` do not — inventing a graph out of a layer binding would
produce something nobody wrote and nobody wants to debug.

A flow that was only a built-in is not carried either: a built-in is a node mode now, and a
library full of twenty-three entries called "Ripple" that are one node each is worse than an
empty one.

Two node kinds changed meaning rather than disappearing. `sample` meant "the frame that
arrived", which was the layer underneath in a stack — the nearest thing to that now is the
set's own picture, so it becomes `tracks`. The `playback` modes `energy` and `amount` are gone
and fall back to the meter, which is the signal they were most often standing in for.

Two fields changed their **names** rather than their meanings. A node's `knobs` are its
`values`; that pass runs on every node before any kind is read, since a node of any kind can
carry them and an old `effect` may still need one of their keys renamed. A `track` node's
old `value` is its `smooth`; the new spelling wins if a hand-edited file somehow carries
both, while a `value` node's `value` stays exactly where it was. The old keys are deleted
rather than left beside the new ones, because `scheme.json` is a file somebody reads and
diffs and two spellings of one field is a question nobody should have to answer.

Nothing else is affected: a number that failed to come across would not be a parse error, it
would be a flow that opens with its inlets quietly back at their defaults, which is the kind
of thing you find out about on stage.

## What is not built

**A device parameter as a source.** A `track` node reaches another track's meter because the
meter is already on the wire; a filter cutoff is not. It needs the bridge to watch device
parameters.

**Notes and velocity.** The LOM exposes no played-note event and the bridge device is an
audio effect. See [the wheel](wheel.md).

**One track's picture as another's input.** A flow reaches a track's *meter* and not its
*frame*. That needs a render target per track, which the compositor does not keep.

**A point from a radius and an angle.** `place` builds one from `x` and `y`, and the
substitution rule says the polar reading cannot be a mode of it — see above. Whether it
wants a kind of its own is a question to answer after somebody has missed it.

**Arithmetic on a point.** `math` takes two numbers; there is nothing that adds two points,
so a `place` cannot be used as an *offset* to the point being asked about. `displace` moves a
point by what a *picture* says, which is the case that mattered for footage and is not the
general one: it takes a colour, not a point, so two points still cannot be added. It was
deliberately not smuggled into `place`, whose whole claim is that it makes a point out of two
numbers rather than out of two numbers and a point.

**A picture's own reading moving that picture.** `read` gives a number off a colour and the
compiler refuses the graph where that number moves the point the same colour is read at,
correctly: it is one trip round. Saying it needs a frame of delay, which is what `last` is —
so it is expressible, and only across a frame.

**Undo.** The scheme is replaced whole on every edit and the file is the record, so `git
diff` is the undo — and the randomiser keeps one level of its own.
