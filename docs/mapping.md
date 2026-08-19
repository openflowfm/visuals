# The cascade

`server/show.ts`, `server/scheme.ts`, `scheme.json`. How a Live set becomes a show.

## Four levels, and a thing that is not a level

Each level owns what it is actually in a position to know, and each is more specific than
the last:

| level | owns | because |
|---|---|---|
| **song** | the colours | a song has an identity that outlives any one section of it |
| **archetype** | energy and character | a section is a feeling, and the same chorus should differ between two songs |
| **track** | what a layer does with content | a track is an instrument; its layer should stay recognisable across a whole song |
| **clip** | the exception | the most specific thing there is, and the only level that can say "not this time" |

**Live signals are deliberately not a level.** The meter, the beat, the phase and the tempo
thread through everything as shader uniforms rather than being resolved at one step,
because they are not a description of what the picture should *be* — they are what makes it
move once it has been decided. Anything can be modulated by them, and nothing in the
cascade has to know they exist.

That split is what makes an archetype dynamic rather than a preset. A section does not pick
a different picture; it moves `uEnergy`, and every source and effect responds to it
continuously.

## How the levels combine

Three different rules, and each is deliberate:

- **Scalars override.** `source`, `blend` and `floor` take the most specific value, which is
  what "a clip is an exception" has to mean.
- **Effects add up.** The archetype contributes the section's character, the track
  contributes what that instrument always does, and both survive. "The chorus should mix in
  more frenetic effects" is additive by construction — anything else would make the track
  rule and the section rule fight over one slot. `maxEffects` caps the pile.
- **`energyBias` accumulates**, which is what makes **energy per layer** rather than per
  show. A drum track can run hotter than the pad under it in the same chorus, and that is a
  thing a single global number cannot say.

## Energy, and the four things it reaches

One number per archetype, biased per layer, arriving in every shader as `uEnergy`.

| it drives | how |
|---|---|
| **effect intensity and count** | `dialEffects` opens the first across the bottom half of the range and the second across the top, so a section *grows into* its effects rather than acquiring two at once. Every effect mixes against its own input by `uAmount`, so 0.3 is a suggestion and 0.95 has taken the frame |
| **reaction speed** | `rate()` in the preamble, quantised to musical divisions — half-beat, beat, half-bar. A rate *between* an eighth and a triplet is in time with nothing, so it steps rather than smears |
| **brightness and contrast** | `charge()`, applied by `OUT`, so no source can forget it |
| **how many layers draw** | each layer has a `floor`; below it the layer fades out rather than cutting, so a quiet section reads as the picture closing down |

### Presence and character are separate, and conflating them was a bug

The floor is tested against the **section's** energy, never the layer's biased energy.

A pad track carrying `energyBias: -0.15` is asking to be *calmer*. Tested against its own
biased value it became *absent* — gone for the whole of every verse. Presence is a fact
about the section ("the chorus brings everything in"); the bias only ever describes how
frenetic a layer is once it is already there. Two questions, two inputs.

## Colours come from the song, never from the clip

A song is assigned a **colourway** — a named list of colours — and each layer takes one by
its depth in the stack. A song with no assignment falls back to the default rather than
going dark, because an unstyled song would be a black screen for exactly the thing nobody
remembered to configure.

**Clip colour is not an input and should not become one.** Those colours are how you find
your place in the grid during a show, and driving the picture from them would force a
choice between a set you can navigate and a set that looks right. The song says what the
colours are; the grid stays yours.

## The scheme file

`visuals/scheme.json`, hot-reloaded, and **entirely optional** — the built-in scheme in
`server/scheme.ts` is a complete show, and the file only ever overrides parts of it. A rig
that draws nothing until configured is a rig nobody configures.

Overrides are shallow *per section*: naming one archetype does not delete the other six.
Rule **lists** replace wholesale, because a list you can only add to is a list you cannot
correct.

A parse error **keeps the scheme that was already working** and reports the message in the
panel. Losing the show to a trailing comma is the wrong answer at any time and an
unthinkable one during a set.

## The editor

`e` in the app opens it, over the picture rather than beside it, because the whole point is
tuning a chorus while a chorus is on screen. The section list **follows the set** until you
click one to pin it, and clicking the pinned one again lets go — no second control to
explain.

It is composed from [`widgets/`](../../widgets/README.md), which is the first use of that
module outside a device chain and the reason it exists: a knob that knew what an archetype
was could not have been written before archetypes did, while one that takes a `Param` and a
number was ready. The single adapter is [`src/ui/param.ts`](../src/ui/param.ts), the same
shape `ui/` has in `lib/liveParam.ts`.

Two things it does that a text editor cannot. Every name it offers — roles, songs, tracks —
comes from **the set**, so nothing asks you to type one; a rule matched against a role that
does not exist is invisible until the night it was written for. And each rule shows **what
it would actually catch**, which is the question a pattern raises and the one a plain field
cannot answer.

**Saving writes the whole resolved scheme**, so the file grows to state everything rather
than inheriting from the built-in. That is deliberate: a file that says exactly what the
show is has no invisible inheritance to reason about at two in the morning, and deleting it
still leaves the built-in as a complete show. It costs the hand-written formatting — the
file comes back as ordinary two-space JSON — but the `_` block and any other key it does
not know are preserved, because the editor writes *over* the file rather than in place of
it.

It is a file rather than device state for now, and that is a staging decision rather than a
final one. Archetypes belong beside roles eventually — roles are already set-owned, they
travel in the `.als`, and a show that looked different on the gig laptop would be a bug.
But that costs a protocol change through `lom.ts`, `bridge.ts` and `ui/`, and committing to
a shape before it has met a real set is how you get a protocol you regret. So: a file,
shaped so it can move without changing.

## What is deliberately absent

**Notes.** The LOM exposes no played-note event and the bridge device is an audio effect
that never sees MIDI, so notes cost a small MIDI Effect on each track you want them from.
The meter approximates it — a layer making sound moves — but it cannot tell you *which*
note, and pitch is the obvious next signal. It would thread through as one more uniform,
which is exactly why signals are not a cascade level.

**Per-clip visuals as files.** A clip rule can change what a layer *does*; it cannot yet
point at a video. That brings a whole question about where media lives that the derived
mapping has no answer for.

## Where the graph fits

The scheme is a table of rules, and a table is the right shape for it — a default good
enough never to touch beats a canvas that demands wiring.

But *what drives what* is genuinely a graph: signals on the left (a track's meter, beat
phase, the section's energy, a note when we tap one), parameters on the right. That is a
modulation matrix, and it is the one UI with no good non-graph form — Resolume's own
version is a dialog and it is the weakest part of the program.

So [`widgets/`'s `Graph`](../../widgets/docs/graph.md) belongs there, not in the render
path. The render path is source → effect → composite, which is a line, and a line is a
`Chain`.
