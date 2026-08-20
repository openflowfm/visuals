# A front end for the visuals rig

A brief. Enough context to propose a UX; not a specification of one.

## What this is

A band plays a set in Ableton Live. There is no lighting operator and no VJ. There is a
projector, and there is a laptop that already knows everything about the show, because the
show *is* the Live set. This program turns that set into visuals.

The reference points, in order of usefulness:

- **A timecoded DMX show.** A pop act's lighting rig runs itself off the timeline. Nobody
  is at a desk. That is the operating model here, and Live is the console.
- **MilkDrop.** What the picture should feel like — generated, reactive, alive, never a
  video loop.
- **Resolume.** The composition model, which already exists in the engine: layers stacked
  bottom to top, each with a source, a blend mode and a fader, fired in columns. A Live
  track *is* a layer; a Live scene *is* a column.

## The one idea

**The show derives itself from the set.** A well-mapped Live set should produce a distinct,
usable, interesting identity for every song with no per-song authoring at all.

The bar is not "different tint, same show." Every song should be recognisably its own
thing. But that difference has to fall out of facts the set already contains rather than
out of thirty-five hand-built designs — which song it is, which tracks it uses, what key
it is in, what section is playing. A song's name can seed its colours; its key can choose
its shapes; the particular combination of tracks that are up is already a different picture.
Those are illustrations of the principle, not settled rules.

The consequence for the UI is the important part: **the work is binding, not designing.**
You configure how the set maps to the vocabulary, and the show follows. You are not
authoring songs one at a time.

## The cascade

Four levels of specificity, each owning what it is in a position to know.

| level | contributes | why it owns it |
|---|---|---|
| **song** | identity — colour, overall character | the topmost differential; a song outlives any section of it |
| **section** | dynamics — energy, intensity, how much of the stack is on screen | a chorus is a feeling, and the same chorus differs between two songs |
| **track** | what a layer draws — the shapes, the source | a track is an instrument; its layer stays recognisable all song |
| **clip / scene** | the exception | the most specific thing there is, and the only level that can say "not this time" |

There is deliberately **nothing above song**. No show-wide theme. The set is not red night.

Live signals — meters, the beat, tempo, phase — are **not a level**. They thread through
everything continuously as modulation. They are not what the picture *is*; they are what
makes it move once it has been decided.

## Effects are the noun

The unit of authorship is an **effect**: a small program built on a node canvas, which
already exists and works.

An effect reads whatever the thing it is bound to can tell it. Bind one to a track and it
can read that track's volume, its meter, its device parameters. Bind it to a clip and it
additionally gets that clip's notes and velocities. The ambition is that every facet of a
track, its group, and the master is reachable, and that reaching for one is a normal part
of building an effect rather than a special feature.

Two worked examples, both real requests:

- Crossfade between two effects, driven by the position of a filter cutoff.
- A blocky visualisation whose block heights are driven by the notes being played.

**Relative and absolute addressing are both needed, and the difference has to be legible.**
"The notes on *my own* track" makes an effect portable — it means something different and
correct wherever it lands. "The cutoff on *the Bass track's* Auto Filter" is specific and
breaks when moved. Both are wanted; a designer has to make which one you are looking at
obvious without making anyone think about the word "relative."

## The three things a person does

1. **Author an effect.** The node canvas, with a preview of that effect alone.
2. **Preview a composition.** Several effects assembled into a frame, as they will actually
   appear. What "preview" needs to mean here — what it runs against, whether it can be
   scrubbed — is an open design question and one of the more interesting ones.
3. **Bind, play, and override.** Set up the bindings, run the show, and fix what you notice —
   trying a change against what is already on screen before it lands.

## Overrides are found by playing, and tried before they land

This is the workflow that matters most and is least served today.

You do not audit the set looking for problems. You play it, and something is wrong: this
song reads too much like the last one, or that pad should have had a specific shape, or
this one scene needs to look exactly like this and nothing else does.

So the override gesture must be reachable **in the moment**, aimed at what is currently on
screen. But noticing is only half of it. **An edit has to be previewable against what is
already there** — the current picture and the proposed one, comparable, before anything is
committed. Nobody can hold a moving picture in their head accurately enough to judge a
change from memory, and a change that has already overwritten what it replaced cannot be
judged at all.

That comparison is only honest if both sides run on **the same clock and the same signals**.
Two reactive pictures shown at two different moments of the music differ for reasons that
have nothing to do with the edit. Whatever form it takes — side by side, a toggle, a wipe —
the before and the after have to be the same instant of the show.

The other hard part is **scope**. The same annoyance can be fixed at the song, the track or
the clip, and picking the wrong one is how a show quietly drifts into inconsistency. *How
far does this change reach* should be a fast, obvious part of the gesture, not a consequence
discovered later.

Override, mixin and "a specific look" are one concept, not three: a more specific level
saying something the levels above it did not.

## Where binding is going

Recorded because it is the shape the data model has to leave room for, not because it is
next. **The composition is simply what the renderer is showing** — it is the output, not an
artifact you save and recall. What builds it is a cascade of looks:

- A look per song is already enough to make the set read as dynamic and distinct, and that
  alone is the first useful version.
- Per-track overrides go on top, so improvising on one instrument changes the picture in a
  way that belongs to that instrument.

So a composition is never bound *as a thing*; it is what a cascade of looks resolves to at
a moment. That is the same shape the existing cascade already has — the difference is that
the unit being cascaded becomes a **look** rather than a source-plus-effect-list.

## Constraints

- **Hands-off during the show.** Nothing in v1 is a performance surface. If the interface
  is open during a set, that is a failure of the configuration, not a feature.
- **The set is the source of truth for every name.** Songs, sections, tracks, clips, devices
  and parameters all come down the wire. The interface should never ask anyone to type a
  name that Live already knows.
- **It runs on a second machine.** Live is on one laptop; this is on another, driving a
  projector. The interface and the output are not necessarily the same screen.
- **Improv is normal.** New clips get recorded mid-set, tracks get added between gigs. An
  unconfigured thing must still draw something reasonable rather than nothing.
- **Configuration is a readable file.** It is diffable and committable, and it stays the
  record after a night of tuning.

## What exists today

A working engine and a first-pass interface, both usable, neither designed. There is a
status panel; a four-pane editor split by cascade level; a node canvas for building an
effect, with a live bench that runs on the real musical clock; and a keystone overlay for
lining up the projector. This is a redesign of the front end, not a rewrite of the engine.

## Not in v1

A live performance surface. Video clips as sources. Multiple outputs. Undo — the file is
the record.

## One naming problem to solve early

**"Effect" already means something.** A visual effect will constantly appear in the same
sentence as a Live audio effect whose parameter drives it. Choosing a different word for one
of them is cheaper now than after the screens exist.

## Open — needs Ryan

- Roughly how many songs in a set, and how many tracks.
- Where this work actually happens: desk, rehearsal room, backstage.
- What a night-before session mostly is — adding new material, or fixing what did not read
  right last time.
