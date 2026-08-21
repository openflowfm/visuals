# Looks

`protocol.ts`, `src/render/circuit.ts`, `src/render/shaders.ts`, `src/ui/Designer.tsx`.
The one noun, the vocabulary it is wired from, and the compiler underneath.

## One noun, and it is a graph

A **look** is a graph that produces a frame. Not a graph plus a stack plus a cascade: one
graph. `LookDef` is a name and a circuit, and that is the whole type.

Everything that used to be a *level of something* is a node in it — the pictures that ship,
the effects that work on them, the Live set's own layer mix, the meters, the song, and
other looks. That collapse deleted four concepts:

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
a look can be dropped inside another look, and none of it needs a buffer or a second pass.

**The `point` node emits the point being asked about**, not `centred()`. That one line is
what makes the threading compose: a graph reading `point → fold → source`, evaluated at a
remapped point, folds the remapped point rather than starting over from the fragment.

### What it costs, which is worth knowing

A **multi-tap** effect evaluates its whole input once per tap. `bloom` is eight taps plus
the centre, `smear` is six, `edge` is four, `shift` is three. Nesting two of them multiplies.
`MAX_LINES` is the backstop and it refuses by name rather than handing the driver a shader
that takes a second to compile — the number is high enough that no sane graph reaches it,
and [the roll](wheel.md) deliberately never wires those four.

## Three signals

| signal | is | `data-kind` |
|---|---|---|
| **point** | where in the frame you are looking, `vec2` | `p` |
| **number** | anything scalar — a knob, a meter, the beat, `float` | `n` |
| **colour** | a premultiplied `vec4` | `c` |

Having exactly three types is what keeps the canvas legible: a cord's colour tells you what
it carries, and the editor refuses a cord it cannot type rather than inventing a conversion.

Points are **centred and aspect-corrected** — zero in the middle, a circle round. `uncentred`
and `recentred` are the pair that convert, and only the handful of effects whose maths was
written in screen space ever touch them.

### Numbers are 0–1

Every number a node produces is 0–1 unless it is `beat` or `time`, and every number a node
*consumes* is read as 0–1 and mapped internally to whatever that node's useful range is.

This is the rule that makes the vocabulary composable: any outlet can go into any inlet and
mean something, so wiring a meter straight into a kaleidoscope's segment count works without
anyone having built a scaling node first. The cost is real — a node's internal range is its
own business and is not visible on the canvas. The alternative is a patch bay of converters,
which is how these things usually die.

It is also what lets **one control** serve every number inlet there is. `KNOB` in
[`param.ts`](../src/ui/param.ts) is that control, and nothing has to declare a range to get
one.

### Unconnected inlets have answers, and a number's answer is yours

Every inlet has an answer, so a half-wired graph still compiles and still draws. An unwired
`point` inlet is **the point being asked about** and an unwired colour is transparent. An
unwired **number** is a number — and it is a knob on the node's own face.

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

**A set value rides a uniform, never the source.** Knob values are deliberately left out of
the shader cache's signature so that dragging one does not recompile sixty times a second;
a number written into the GLSL would hand that back at every inlet on the canvas, and what
it reaches a person as is a knob that stalls the picture. So every set value gets a slot in
`uParams` — the same bank a `value` node rides — and the **bank is cut to the graph**,
because the shader is generated and can declare exactly the size this one needs. Giving an
inlet a value for the first time recompiles once, since that is a change to the shader's
shape. Turning it after that recompiles nothing. A look with no knobs at all still declares
one float, because GLSL rejects a zero-length array.

**Wiring is not a destructive gesture.** A wired inlet's number stays on the node, out of
the bank while a cord is on top of it and back on the face the moment the cord goes. An
inlet that snapped to its default when you unwired it would be one you stop experimenting
with.

**Only numbers are settable.** A point has no single control and a colour has no useful
constant, so those two keep the answers they always had.

**Two number inlets have no knob either**, and they are the two whose answer is already
alive: an `energy` inlet reads the room, and a `wave`'s `phase` reads the beat. A knob there
would offer to replace something moving with something that is not, which is a worse default
than the one it replaced. Wire them, or leave them running.

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

## The vocabulary

Grouped the way the browser groups them, which is `NODE_FAMILIES` in `protocol.ts` — two
editors listing these differently would be two different vocabularies.

### draw — everything that makes a colour out of nothing

| node | in | out | |
|---|---|---|---|
| `tracks` | `p` | `c` | **the Live set**: every playing track, drawn and mixed. Fire a scene, it changes |
| `source` | `p` `energy` | `c` | one of eleven: `solid` `bars` `rings` `noise` `strobe` `grid` `tunnel` `plasma` `spiral` `scan` `sparks` |
| `look` | `p` | `c` | another look, whole, as one node |
| `paint` | `amount` `energy` | `c` | the colourway's colour at a brightness |

### transform — everything that gives a picture back where it already is

| node | in | out | |
|---|---|---|---|
| `grade` | `c` + its mode's knobs | `c` | `levels` `hue` `posterize` `invert` |
| `spread` | `c` `energy` + its mode's knobs | `c` | `bloom` `smear` `edge` `shift` |
| `blend` | `base` `top` `amount` | `c` | `over` `add` `screen` `multiply` |

### geometry — moving the point a picture is read at

| node | in | out | |
|---|---|---|---|
| `point` | — | `p` | where this fragment is being read |
| `lens` | `p` `c` `energy` + its mode's knobs | `p` `c` | `zoom` `swirl` `fold` `wobble` `tile` `mirror` `kaleido` `twist` `ripple` `slice` `pixelate` |
| `polar` | `p` | `radius` `angle` | how a position becomes a number |

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
question, and two uniform banks for what is almost always two floats. It is a **knob** now,
and at zero it is the number itself.

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

**`value` means one number in several places.** Every inlet has its own knob now, so a
`value` node wired to exactly one of them is the long way round — it says nothing the number
on the face does not, and costs a cord across the canvas to say it. What it still does, and
nothing else can, is put *the same* number on two inlets at once: turn it and both move.
`Weather` in the built-in library is wired that way on purpose, and it is the only knob node
left in the ten looks that ship.

## `out` is one, required, and not in the browser

Every look has **exactly one** `out`. It arrives with the look, it can be moved anywhere on
the canvas, and it cannot be deleted — the faceplate has no `×` and `dropNode` refuses it, so
the rule is the model's rather than the button's.

It is also **not in the node browser**, which it used to be. The browser is built from the
vocabulary and `out` is part of the vocabulary, but being part of the vocabulary and being
something you *add* are different questions and only the second one a drawer answers.
Dropping a second one was the single thing you could do from that browser that made a look
stop compiling: a trap wearing a feature's clothes.

**Where the rule is enforced is `merge` in `server/scheme.ts`**, and nowhere else. A scheme
reaches the renderer exactly two ways — read off `scheme.json`, or sent up by an editor that
gets it straight back down — and both come through that one function. So a look that arrived
without an `out`, or with two, leaves it as a look and is written back that way the next time
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
`bloom` and `smear` both have a `reach`, and it is the same knob in both. The **values set
on those inlets** are kept by name too, and dropped by name — a number left behind on an
inlet the new mode does not have is invisible, and comes back to change the picture the next
time somebody switches the mode back.

## Energy is a node, not a level

It used to be the one number the whole show agreed about: an archetype set it, a cascade
biased it, and every shader read `uEnergy` without being asked. That made "energy" mean
exactly one thing forever — where in practice it means whatever you decide, and the useful
one is often a particular track's. **Bass energy** is a different picture from master energy
and neither is more correct.

So it is a node — and then it stopped being one. It is a **knob on `track`**, because a
meter with an envelope on it is a `track` node with its smoothing turned up, and a node whose
only difference from another node is one number is a mode of that node. At zero the knob is
the number itself, which is exactly what `track` always did.

`rate`, `beatPulse`, `charge` and every generator take an energy as a **parameter**, and
every mode that reads one has an `energy` inlet — so what you wire in is yours.

The envelope is computed on the CPU and banked into `uTracks`, because an envelope follower
has to remember what it saw last frame and a fragment shader cannot. Fast up, slow down — one
that fell as quickly as it rose would be the meter again, and the meter is the same knob at
zero.

`uEnergy` survives as **the room's** energy, a smoothed master meter, which is what an
unwired energy inlet falls back to. A default, not a level.

### It has no floor, and should not get one

With nothing playing, `Show.master` is zero — so a `track` node reading `master` is zero,
`charge` takes about a fifth off the brightness, and `rate` picks the slowest rung it has.
That is **right**: energy is a meter, and a meter with a floor under it cannot say *silence*,
which is the one thing a section break needs it to say.

What is not right is a look that is only alive when the room is loud, because most of the
hours anyone spends in the designer are hours with no Live attached. The fix is in the wiring
rather than in the number: **take the motion off the clock and let the meter add to it.**
`phase`, `beat`, `pulse` and a `wave` all run whether or not anything is playing, since Link
free-runs. The ten looks that ship keep that rule, and it is the difference between a
library that reads as calm at a desk and one that reads as broken.

The bench and the node faces are both fed the **room's** energy — the knob on the designer's
own bar — for the same reason and from the other end: it is a condition you can dial rather
than one you have to wait for.

## The set is a pass, and it is the only one

A `tracks` node draws the same picture once per playing Live track, with that track's colour,
meter and fader each time. A fragment shader cannot loop over a varying number of those
cheaply, so it stays a pass: every playing track into one target, which the look reads as a
texture. It is the last surviving piece of the compositor this replaced, and the whole reason
there is more than one pass left. See [the renderer](render.md).

What each track draws is the node's mode: `by name` uses the [name hints](../hints.ts), and
anything else draws every track the same way.

**One `tracks` texture per frame.** Two `tracks` nodes with different modes in one look share
the first one's, because a target per mode is a target per node and the win is small. Not
built.

## A look inside a look

The graph a `look` node names is **pasted in around the node** before the compiler runs, with
every id prefixed so two copies of one look cannot collide. Expanding rather than teaching
the compiler about sub-looks is what keeps the compiler one thing: knobs, named tracks and
energies all get their bank slots from the expanded graph without a second pass to gather
them.

**Around the node, not in place of it**, and that is the whole of why a `look` node has a
point inlet that works. The sub-look's own `out` becomes a junction held on a reserved inlet
— `~inner`, which the canvas hides because the flattener writes it and nobody else — and the
node's one job is to read that junction at whatever point is wired into `p`. So a nested look
can be folded, zoomed or tiled from outside exactly as a `source` can, and with nothing wired
it is read where it is asked, which is identical to having pasted its nodes in by hand.

Splicing the node out instead left the `p` cord addressed to a node that no longer existed:
drawn across the canvas, looked up by nothing, changing nothing on the wall.

A **loop is refused at the moment of wiring**, by `wouldLoop`, not at compile time. At
compile time the honest message is "one of these seven looks contains itself", which nobody
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

A look that has been deleted makes the node draw nothing rather than failing. A look you
deleted should make the thing that used it go quiet, not stop the show.

## The designer is the product

Everything else this app does is arrangements of what gets made here.

**Two browsers**, and the second is the change. The library lists your looks; the **node
browser** lists the vocabulary. It is a device browser: the row is the **node**, and its
**presets** open underneath it. See [the console](console.md) for the shape and what search
has to keep reaching.

A faceplate shows the **mode** rather than the kind, which is the same idea one step later:
a node reading `source` above a dropdown reading `plasma` makes you read two things to learn
one. Below that it shows a knob for every number inlet with nothing wired to it, which is
what makes a node something you drop and dial rather than something you have to build a
knob for.

**The bench is a `Compositor`**, not a second renderer. There used to be one and it was a
standing risk: a bench that could disagree with the stage about brightness or blend is worse
than no bench, because those are exactly what you come here to judge. With no bridge it gets
**stand-in tracks** driven off the beat, so a look built on the set is not black at a desk —
which is precisely the situation the designer exists to work in. Those are `withStandIns` and
belong to the room rather than to the bench, because the node faces need the same four or
they are black while the bench beside them is lit.

**It floats over the canvas** rather than sitting in a column beside it, which is a layout
question with a real answer: a fixed sidebar takes its width from the narrowest thing in it,
and the thing you are actually judging was getting 236 pixels while the graph kept the rest.
See [the console](console.md) for that and for the group of controls above it.

**It runs on its own room.** `useTransport` free-runs — a tempo, a play button, a restart —
and `useRoom` invents the rest of the conditions a look reads: energy, section, colourway
and key. Both can be told to take the real thing when there is one, and following is the
option rather than the fallback. What comes out is a `Clock` and a `Show`, the same two
shapes the compositor already takes, so nothing downstream can tell whether the beat came
from a laptop or a stage or whether the chorus is really happening. That is the point: what
you build at a desk is what will play.

## A picture on every node

Each node face shows what *that node* has made, not a thumbnail of the finished look.
[`probe.ts`](../src/ui/probe.ts) builds it by cutting the graph off at one outlet and
bringing the result back to a colour: a number through `paint`, a point through a `plasma`
source, because a point's whole job is to move a picture and a picture with structure in it
is one you can see moving.

All of them come out of **one** GL context, blitted into a small 2D canvas per node. A
context each is the obvious build and the wrong one: browsers keep about sixteen alive and
start evicting the oldest, and this page already has the stage and the bench. That is also
why `preview.ts` caches programs by signature in a map rather than one slot.

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

**A face gets the library, not just the graph.** A nested look is a *different* graph, so a
`preview.ts` handed only a circuit had nothing to expand a `look` node against — which made
that node's face black, and every face downstream of it black too, in a graph that drew
perfectly well on the wall. A run of black diagrams down the middle of a working look is
exactly the thing a node face exists to prevent.

So the probe graph is parked under a reserved id and expanded by the **same** `flatten` the
stage uses, rather than given an expander of its own. A face that disagreed with the bench
about what a nested look draws would be worse than one that showed nothing, because it would
be believed.

**Clicking a face promotes it to the bench**, which is the other half of the same idea: a
hundred pixels across is enough to see *that* something is happening and nowhere near enough
to see what. The only way to look properly used to be to wire the node into `out`, look, and wire it
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
The colourways, which song draws from which, and any look that was a graph all survive.
`layers`, `clips` and `archetypes` do not — inventing a graph out of a layer binding would
produce something nobody wrote and nobody wants to debug.

A look that was only a built-in is not carried either: a built-in is a node mode now, and a
library full of twenty-three entries called "Ripple" that are one node each is worse than an
empty one.

Two node kinds changed meaning rather than disappearing. `sample` meant "the frame that
arrived", which was the layer underneath in a stack — the nearest thing to that now is the
set's own picture, so it becomes `tracks`. The `playback` modes `energy` and `amount` are gone
and fall back to the meter, which is the signal they were most often standing in for.

## What is not built

**A device parameter as a source.** A `track` node reaches another track's meter because the
meter is already on the wire; a filter cutoff is not. It needs the bridge to watch device
parameters.

**Notes and velocity.** The LOM exposes no played-note event and the bridge device is an
audio effect. See [the wheel](wheel.md).

**One track's picture as another's input.** A look reaches a track's *meter* and not its
*frame*. That needs a render target per track, which the compositor does not keep.

**Undo.** The scheme is replaced whole on every edit and the file is the record, so `git
diff` is the undo — and the roll keeps one level of its own.
