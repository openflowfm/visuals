# Flows

`protocol.ts`, `src/render/circuit.ts`, `src/render/shaders.ts`, `src/ui/Designer.tsx`.
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
and [the roll](wheel.md) deliberately never wires those four.

An iterative node needs a second answer, because a loop of thirty-two orbit steps is still
one GLSL statement. `fractal` therefore declares its worst-case work separately and the
compiler charges it every time the graph asks for the picture at another point. Two direct
fractals fit; putting one under any `spread` does not. `detail` may stop the loop earlier,
but it is a uniform that can be turned after compilation, so the budget is always the hard
ceiling rather than the number it happens to be showing now.

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
[`param.ts`](../src/ui/param.ts) is that control, and nothing has to declare a range to get
one.

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

**Two number inlets have nothing to set either**, and they are the two whose answer is
already alive: an `energy` inlet reads the room, and a `wave`'s `phase` reads the beat. A
number there would offer to replace something moving with something that is not, which is a
worse default than the one it replaced. They get a meter rather than a handle, so the live
answer is visible without pretending it is yours to turn. Wire them, or leave them running.

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

## The vocabulary documents itself

The node reference is executable data in `NODE_SPECS`, not prose copied into the browser.
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
| `source` | `p` `energy` | `c` | one of eleven: `solid` `bars` `rings` `noise` `strobe` `grid` `tunnel` `plasma` `spiral` `scan` `sparks` |
| `fractal` | `p` `energy` + its mode's numbers | `c` | `mandelbrot` or `julia`, with bounded zoom, detail and iterative work |
| `flow` | `p` | `c` | another flow, whole, as one node |
| `paint` | `amount` `energy` | `c` | the colourway's colour at a brightness |

### transform — everything that gives a picture back where it already is

| node | in | out | |
|---|---|---|---|
| `grade` | `c` + its mode's numbers | `c` | `levels` `hue` `posterize` `invert` |
| `spread` | `c` `energy` + its mode's numbers | `c` | `bloom` `smear` `edge` `shift` |
| `blend` | `base` `top` `amount` | `c` | `over` `add` `screen` `multiply` |

### geometry — moving the point a picture is read at

| node | in | out | |
|---|---|---|---|
| `point` | — | `p` | where this fragment is being read |
| `place` | `x` `y` | `p` | how two numbers become a position |
| `lens` | `p` `c` `energy` + its mode's numbers | `p` `c` | `zoom` `swirl` `fold` `wobble` `tile` `mirror` `kaleido` `twist` `ripple` `slice` `pixelate` |
| `polar` | `p` | `radius` `angle` | how a position becomes a number |

### `place` is the other direction, and it was missing

`polar` took a point apart and nothing put one back together. A graph could read a position
as two numbers and never write two numbers as a position, so a point built from a pair of
`wave`s, or from two Ableton track levels, was a sentence the vocabulary could not say.

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
it under something. It is also why [the roll](wheel.md) never wires one, and why a `place`
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
`track`. So building a point from a radius and an angle is not expressible, `wave` and `math`
cannot fake it (`math`'s `subtract` clamps at zero, so there is no way to make a bipolar
cosine out of a unipolar sine), and it is in **what is not built** below where it belongs.

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
`roll.ts` kept a hand-written list of these four by name so a roll would never stack three —
and a fact the vocabulary could not state was a fact somebody had to remember. It is a kind
now, and the list is gone.

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

`math`, `wave`, and `value`.

**`math` is deliberately asymmetric at the edge of the 0–1 convention.** `add` and
`subtract` clamp their answers to 0–1; `multiply` does not, while `min`, `max` and `average`
need no extra clamp for ordinary 0–1 inputs. The unclamped multiply is load-bearing:
`Water` uses it to amplify a number beyond one. It also means subtraction cannot make a
bipolar cosine from a unipolar wave, because its negative half stops at zero.

**`value` means one number in several places.** Every inlet holds its own number now, so a
`value` node wired to exactly one of them is the long way round — it says nothing the number
on the face does not, and costs a cord across the canvas to say it. What it still does, and
nothing else can, is put *the same* number on two inlets at once: turn it and both move.
`Weather` in the built-in library is wired that way on purpose, and it is the only `value`
node left in the twelve flows that ship.

## `out` is one, required, and not in the browser

Every flow has **exactly one** `out`. It arrives with the flow, it can be moved anywhere on
the canvas, and it cannot be deleted — the faceplate has no `×` and `dropNode` refuses it, so
the rule is the model's rather than the button's.

It is also **not in the node browser**, which it used to be. The browser is built from the
vocabulary and `out` is part of the vocabulary, but being part of the vocabulary and being
something you *add* are different questions and only the second one a drawer answers.
Dropping a second one was the single thing you could do from that browser that made a flow
stop compiling: a trap wearing a feature's clothes.

`flow` is the other kind the node browser leaves out, for a different reason: it is not
missing, it is upstairs. Every flow in the library is a row on the flow shelf, and one of
those rows placed on a canvas *is* a `flow` node.

**Where the rule is enforced is `merge` in `server/scheme.ts`**, and nowhere else. A scheme
reaches the renderer exactly two ways — read off `scheme.json`, or sent up by an editor that
gets it straight back down — and both come through that one function. So a flow that arrived
without an `out`, or with two, leaves it as a flow and is written back that way the next time
anything saves. The compiler keeps its two error messages as a backstop for a circuit nobody
built, which is what a probe and a test are.

The other thing repaired at the same door is a **cord addressed to a port that is not there**.
See below.

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
`pulse` and a `wave` all run whether or not anything is playing, since Link free-runs.

The shape that says it is **`max` of a clock and a meter**, with the clock arriving on a
range:

```
wave pulse ─────> a ┐                    a: value 0.3, depth 0.4
                    ├ max ──> energy     so the clock walks 0.3 → 0.7
track master ────> b ┘                   and the meter wins above that
```

`max` rather than `average`, because an average with a silent meter halves everything the
clock is doing — which is how a floor becomes a ceiling. The range on `a` is what keeps the
floor off the ground without pinning the top: an energy at 0.3 is a picture, an energy at 0
is the same picture at its dullest setting, and the difference between those two is most of
what "it looks dead at a desk" ever meant. The twelve flows that ship keep that rule, a
test asserts it, and it is the difference between a library that reads as calm at a desk and
one that reads as broken.

The bench and the node faces are both fed the **room's** energy — the control on the designer's
own bar — for the same reason and from the other end: it is a condition you can dial rather
than one you have to wait for.

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
your library, marked `◈`, each row saying how many nodes are inside it and carrying two
verbs — open it, or place it in the flow you have open. The **node browser** below lists the
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
an alive number gets a meter; a settable number gets one horizontal filled control with its
name and reading inside it. A driven number keeps that control disabled, names its driver
and moves its fill and reading with the number arriving there, preserving the stored value
until the cord comes off. Alive and driven rows are sampled on a ten-hertz display clock,
not the render loop, and React is updated only when the formatted reading changes.

The CPU can follow `value`, `playback`, `track`, `song`, `math` and `wave` chains. A
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
[`probe.ts`](../src/ui/probe.ts) builds it by cutting the graph off at one outlet and
bringing the result back to a colour: a number through `paint`, a point through a `plasma`
source, because a point's whole job is to move a picture and a picture with structure in it
is one you can see moving.

All of them come out of **one** GL context, blitted into a small 2D canvas per node. A
context each is the obvious build and the wrong one: browsers keep about sixteen alive and
start evicting the oldest, and this page already has the stage and the bench. That is also
why `preview.ts` caches programs by signature in a map rather than one slot.

One context does not make every draw free. Only visible faces draw, at most ten per frame;
the promoted node and `out` take the first slots. Zoom below a half, exceed the budget or
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
[`feed.ts`](../src/render/feed.ts), and the stage, the bench and every face read it.

The faces get the same [`Show`](../src/state/useRoom.ts) the bench does, which at a desk is
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
so a `place` cannot be used as an *offset* to the point being asked about. The lens modes
displace a point in eleven fixed shapes and none of them takes a vector. It is the obvious
next node and it was deliberately not smuggled into `place`, whose whole claim is that it
makes a point out of two numbers rather than out of two numbers and a point.

**Undo.** The scheme is replaced whole on every edit and the file is the record, so `git
diff` is the undo — and the roll keeps one level of its own.
