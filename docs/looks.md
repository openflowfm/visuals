# Looks

`protocol.ts`, `resolve.ts`, `src/ui/Designer.tsx`, `src/ui/stack.ts`. The unit of visual
work, and the designer it gets made in.

## One noun

A **look** is a graph that produces a frame. That is the whole type.

There used to be two: eleven *sources* that drew a picture and twelve *effects* that
changed one. The split was never real. A shader either reads the frame that arrived or it
ignores it, which is a property of the shader rather than a category of thing — and the
circuit compiler had already worked this out, calling a graph with `paint` and no `sample`
a generator while the source slot could not be pointed at one.

Collapsing them cost one preamble and bought three things:

- **Custom sources**, the feature three docs listed as *not built*. A look you draw is a
  source now, because there is nothing else it could be.
- **One kind of pass** in the compositor. It used to run a source and then a chain; it now
  runs a stack, and whether a given pass *uses* what it read is the shader's business.
- **One kind of object** in the designer, which is what makes a library of looks something
  you can build before deciding what drives any of it.

The one thing that still tells the halves apart is [`isGenerator`](../resolve.ts), and it
asks the look rather than reading which list it came from: a built-in by name, a circuit by
whether it ever samples the frame.

## A stack is a composition

A stack has one thing at the bottom that draws its own picture and anything above it works
on what is already there. That is a **composition**, and it is what the renderer shows.

The rules are in [`stack.ts`](../src/ui/stack.ts) and there are only two:

- **A generator replaces the base.** Two of them in a stack means drawing one and then
  painting entirely over it — a full-screen pass that produces nothing.
- **A transformer appends**, because that is what a stack is *for*: a kaleidoscope over a
  ripple is a different picture from either.

The cascade keeps the same distinction for the same reason. A more specific level naming a
generator *replaces* the base — that is what "a clip is an exception" has to mean — while a
transformer is *added*, so a section's character and a track's own character both survive.

`maxLooks` caps the whole stack, base included, which is why the built-in default went from
two to three when the noun collapsed: two on top of a base is what `maxEffects: 2` meant.

## Energy dials the top, never the base

The base always draws at full. Energy thins what is above it, and the floor gate decides
whether the layer is in the picture at all — dimming the base as well would be dimming the
same thing twice, and a quiet section would read as a broken layer rather than a calm one.

## The designer runs on its own clock

This is the change that makes a library possible.

Everything here used to read Link through the show, which is right on stage and exactly
wrong at a desk: it made *Ableton running* a precondition for drawing a picture. You cannot
build a library of looks you can only see during a rehearsal.

So [`useTransport`](../src/state/useTransport.ts) free-runs — a tempo, a play button, a
restart — and can be told to follow the room when there is a room. Following is the option,
not the fallback. It is a `Clock`, the same shape the compositor and the bench already
take, so nothing downstream can tell whether the beat came from a laptop or from a stage.
That is the point: what you build at a desk is what will play.

The signals a look reads are hand-drivable too. Energy is a knob; the meter is either a
held value or the beat envelope, and when it is generated a `Meter` shows it — a
hand-driven signal can be a slider because you can see where you put it, and a generated
one cannot.

## The bench draws a stack, and it has to

Not a nicety. Once the noun collapsed, **a transformer previewed on its own shows nothing**:
it mixes against the black frame underneath and comes back black. Selecting one and seeing
nothing would read as a broken look rather than as a look with nothing under it.

So the bench holds a stack, and the designer puts a base under a transformer for you. The
stack is not a *preview of* a composition — it **is** one, drawn by the renderer the stage
uses. Composition preview fell out of the collapse rather than being built beside it, which
is usually the sign the collapse was right.

## A picture on every node

Each node face shows what *that node* has made, not a thumbnail of the finished look.
[`probe.ts`](../src/ui/probe.ts) builds it by cutting the circuit off at one outlet and
bringing the result back to a colour through `paint` or `sample` — the vocabulary's own two
crossings — so a number is shown the way `paint` would show it.

All of them come out of **one** GL context, blitted into a small 2D canvas per node.
A context each is the obvious build and the wrong one: browsers keep about sixteen alive
and start evicting the oldest, and this page already has a bench. That is also why
`preview.ts` caches programs by signature in a map rather than one slot — one context
cycling through a dozen defs a frame would otherwise recompile every one of them, every
frame.

## Reading a file written before the collapse

`server/scheme.ts` carries the old spelling forward: `effects` becomes `looks`, a layer's
`source` and `effects` fold into one stack with the source first, and `maxEffects` gains
one. Nothing is rewritten until someone saves, and then it is written in the new spelling.
Reading old and writing new is the whole migration — refusing the file would mean losing a
show to a rename.

## What is not built

**A device parameter as a source.** A `track` node reaches another track's meter because
the meter is already on the wire; a filter cutoff is not. The drawer says so rather than
offering something that would silently read zero.

**Notes and velocity.** The LOM exposes no played-note event and the bridge device is an
audio effect. See [the cascade](mapping.md).

**Saving a composition.** A stack lives in the designer and is not yet a thing you can name
and recall. Where it goes is the open question — see the [brief](brief.md) on binding: the
composition is what the renderer is showing, built by a cascade of looks, and it may never
need to be an artifact of its own.
