# Circuits

`src/render/circuit.ts`, `src/ui/Circuit.tsx`, `src/ui/Designer.tsx`. A **look** built out
of nodes, compiled to a fragment shader. See [looks](looks.md) for what a look is.

## Why a graph here and nowhere else

The scheme is a table of decisions and stays one. What an effect *is*, though, is a
dataflow — a point moved about, a picture read at it, a colour worked on — and a table has
never been able to say that. So the canvas is here, on one effect at a time, and the rest
of the editor is lists.

The built-ins are handwritten GLSL and always will be: they are what a rig draws before
anyone has wired anything. A circuit is the other half, and the compositor cannot tell them
apart. Both are addressed by an **id** wherever a look is named, so nothing that *uses* one
knows which kind it got.

## Three signals, and everything follows from them

| signal | is | `data-kind` |
|---|---|---|
| **point** | where in the frame you are looking, `vec2` | `p` |
| **number** | anything scalar — a knob, a meter, the beat, `float` | `n` |
| **colour** | a premultiplied `vec4` | `c` |

Geometry nodes move points about, `sample` turns a point into a colour by reading the
picture that arrived, colour nodes work on colours, and `out` takes the one that leaves.
That is every move a fragment shader makes on a frame. Having exactly three types is what
keeps the canvas legible: a cord's colour tells you what it carries, and the editor refuses
a cord it cannot type rather than inventing a conversion.

Points are **centred and aspect-corrected** — zero in the middle, a circle round. `sample`
is the only node that converts back, so nothing else has to know the frame's shape.

## Numbers are 0–1

Every number a node produces is 0–1 unless it is `beat` or `time`, and every number a node
*consumes* is read as 0–1 and mapped internally to whatever that node's useful range is.

This is the rule that makes the vocabulary composable: any outlet can go into any inlet and
mean something, so wiring a meter straight into a fold works without anyone having built a
scaling node first. The cost is real — a node's internal range is its own business and is
not visible on the canvas. The alternative is a patch bay of converters, which is how these
things usually die.

## Unconnected inlets have answers

Every inlet has a fallback, so a half-wired circuit still compiles and still draws. An
unwired `point` inlet is the fragment's own; an unwired `sample` reads the frame where it
already was; an unwired number is a half.

That is not politeness, it is how these get built: you drop a node, look at what it did,
and wire the next one. A compiler that treated an unfinished graph as an error would make
the canvas unusable for exactly the way it gets used. Same reasoning for dead nodes — only
what `out` can reach is emitted, so a node parked on the canvas while you decide where it
goes costs nothing.

## The vocabulary

| node | in | out | |
|---|---|---|---|
| `point` | | `p` | where this fragment is |
| `signal` | | `n` | `level` `energy` `beat` `phase` `pulse` `time` `amount` `random`. **This layer's**, wherever it is used |
| `track` | | `n` | another track's meter, **by name**, or `master`. Absolute: it breaks if the look moves |
| `value` | | `n` | a knob. Named here, turned in the effect list |
| `fold` | `p` `sides` | `p` | mirror into wedges around the centre |
| `swirl` | `p` `turn` | `p` | rotate by more the further out you are |
| `zoom` | `p` `by` | `p` | push in or pull out; a half is life size |
| `wobble` | `p` `amount` | `p` | displace on a sine that runs on the beat |
| `tile` | `p` `count` | `p` | repeat the frame in a grid |
| `polar` | `p` | `radius` `angle` | a point as distance and angle |
| `sample` | `p` | `c` | read the picture that arrived. The only way in |
| `paint` | `amount` | `c` | the song's colour at a brightness. How a number becomes a picture |
| `hue` | `c` `shift` | `c` | rotate the colour without touching the shape |
| `levels` | `c` `gain` `lift` | `c` | contrast and brightness; a half of each is neutral |
| `blend` | `base` `top` `amount` | `c` | `over` `add` `screen` `multiply` — the same four layers stack with |
| `math` | `a` `b` | `n` | `add` `subtract` `multiply` `min` `max` `average` |
| `wave` | `phase` | `n` | `sine` `saw` `ramp` `square` `pulse` `noise` |
| `out` | `c` | | what leaves, mixed against the untouched frame by the effect's amount |

`paint` and `sample` are the two crossings, and a circuit that has a `paint` but no
`sample` is a **generator** — it ignores what arrived and draws its own picture.

That sentence used to end "…and is how a custom source would eventually arrive; the source
slot itself is still one of the six built-ins." It arrived. Source and effect are one noun
now, `isGenerator` asks exactly this question of a circuit, and a graph you draw can be the
bottom of a stack. See [looks](looks.md).

## Compiling

Depth-first from `out`, emitting one GLSL local per reachable outlet. Every outlet becomes
a variable even when it is read once, so a node feeding three others is computed once
rather than three times.

A cycle is refused by name rather than hung in. More than one `out`, or more than eight
knobs, is refused too — eight is the size of `uParams` in the shader preamble.

**A named track rides a uniform bank too.** A `track` node compiles to `uTracks[i]`, banked
positionally the way knobs are, and the compositor fills it by looking each name up in the
show. Positional rather than keyed by name so two nodes naming the same track still get a
slot each — deduplicating them would make deleting one silently change what the other read.
A name nobody can resolve reads zero rather than failing, so a look pointed at a track that
has since been renamed goes quiet instead of taking its layer down.

**Knobs ride a uniform, not the source.** A `value` node compiles to `uParams[i]`, so
turning one never rebuilds a shader. The compositor's cache key is the circuit's *structure*
— node ids, kinds and modes, and the cords — and deliberately excludes node positions and
knob values, or dragging a node would recompile a shader sixty times a second.

A build that fails is remembered as a failure. Retrying a broken circuit every frame would
call the driver's compiler sixty times a second for as long as it stayed broken, which is a
stall rather than an error message. A broken effect drops out of its layer's chain; it does
not take the layer with it.

## The bench

The designer draws its own frame: a **stack**, at whatever amount and energy you ask for —
and on its own transport, so none of it needs a set to be running.

It has to. Editing a shader against the stage means editing something you cannot see — the
panel is over it, the section's energy may have dialled it to nothing, and the layer
carrying it may not be playing. Worse, it means Ableton has to be running at all.

It still runs on a **musical** beat, which is the whole difference between this and a
shader toy: a `wave` wired to the beat is in time while you build it. The beat is just no
longer required to come from a room.

The meter is hand-driven or synthetic, and deliberately so. A real one would be some
particular track's, and choosing which is a question with no good answer at a desk — so it
is either a value you hold or a pulse on each beat, and a `Meter` shows which.

`src/render/look.ts` is shared between the bench and the compositor — the shader, the
parameter bank, and the cache signature. A preview that could disagree with the stage about
what an effect looks like would be worse than no preview.

## The canvas is `widgets`', and knows nothing

[`Graph`](../../widgets/docs/graph.md) contributes pan, zoom, dragging and the drawing, and
still has no idea what any of it means. It enforces one rule — an outlet reaches an inlet —
because that one is the drawing's own. Everything else is this app's: what a port carries,
which cords are legal, where a new node lands.

Two things fell out of that boundary working:

- **A knob inside a node turns without dragging the node.** `useParamGesture` calls
  `preventDefault` when it takes a pointer and `GraphNode` checks for it, so there is no
  drag handle and no rule about which part of a faceplate is furniture. That was written
  against no caller; this is the caller.
- **Cutting a cord is the host's job.** The cord layer is `pointer-events: none` and
  hit-testing a bezier is real work, so an inlet that has a cord grows a small `×` beside
  its port. The graph never learns that cords can be removed.

## Rolled circuits

The randomiser wires two of them per roll, and it walks a **shape** rather than the whole
vocabulary: a point, one to three things done to it, a sample, and sometimes a thing or two
done to the colour. Each geometry node's amount is driven by a knob, a live signal, or a
wave riding one.

A random walk over every node kind produces garbage nine times in ten. The shape is what
makes the result an effect; the fill is what makes it a different one every time. Its knobs
are capped at four so two rolls' worth still fit the bank, and `roll.test.ts` compiles every
circuit from forty seeds — really an assertion that the generator never names a port that
does not exist, which is the way a hand-written node table drifts.

## What is not built

- **A device parameter as a source.** `track` reaches another track's meter because the
  meter is already on the wire. A filter cutoff is not: it needs the bridge to watch device
  parameters, and until it does, the drawer says so rather than offering something that
  would silently read zero.
- **Naming a circuit's knobs on the layer that uses it.** An effect's knobs are global to
  the effect; two layers carrying the same circuit carry the same settings.
- **Copying or forking an effect.** A new circuit always starts from the same working
  kaleidoscope.
- **Undo.** The scheme is replaced whole on every edit and the file is the record, so `git
  diff` is the undo.
