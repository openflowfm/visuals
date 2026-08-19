# The mapping

`server/show.ts`. How a Live set becomes a show, with nothing to configure.

## Derived, not declared

This is [`docs/direction.md`](../../docs/direction.md)'s argument applied one module over.
The song mapping is read back out of scene names rather than stored beside the set, because
*the names are the mapping* and a second record is a second thing to keep in step. A
visuals app that made you assign a clip to every cell would be exactly that second record.

So a set that has been through the session view already says what its sections are and what
its tracks play, and this reads it. Point it at a named, coloured set and it has an opinion
immediately; point it at an unnamed one and it still runs, on positional fallbacks.

| | comes from | why |
|---|---|---|
| **source** | the **track** | a track is an instrument, and its layer should stay recognisable across a whole song |
| **effect** | the scene's **role** | a section is a change of treatment, and it should land the moment the chorus does |
| **blend** | the layer's **depth** | something has to be opaque at the bottom, and stacked light adds |
| **colour** | the **clip** | the set is already colour-coded; that work should not be done twice |
| **opacity** | the **track fader** | a layer stack with a level per layer *is* a mixer |
| **motion** | the track's **meter** | the layer that is making the sound is the layer that should move |

## The mistake in the first row

Keying the source off the *role* looked obviously right — the section is what changed, so
let it pick the picture. It produced five layers all drawing the identical thing on top of
each other, and the reason is structural: **a role belongs to the scene, which is a whole
column of the grid.** Every track in that column gets the same one.

Sections change together; instruments differ from each other. Those are perpendicular, and
the two axes of the session grid are exactly that distinction — so the two things being
chosen have to come from different axes. Source from the track, effect from the scene.

The same reasoning caps how far the effect spreads. A role's effect lands on **alternate
layers only**: kaleidoscoping all five at once read as a single texture and threw away the
identity the source column works to build. Half the stack changing says the chorus arrived
while the other half still says which instrument is which.

## Track names, because people name tracks after what plays on them

Matched loosely and on first hit, so `Drum Bus`, `drums 2` and `DRUMS` land together:

| matches | source |
|---|---|
| kick, drum, beat, perc, snare | `strobe` |
| bass, sub, 808 | `bars` |
| lead, solo, gtr, guitar, vox, vocal | `rings` |
| pad, string, atmos, amb | `noise` |
| key, synth, chord, piano, organ | `grid` |

An unmatched track falls through to its position in the stack, which is how a set whose
tracks are called `1` to `5` still gets five different layers.

Roles come from the `[ROLE]` prefix the naming convention already writes. Most sections
map to no effect on purpose: an effect distinguishes a moment only while the moments around
it are plain.

## What is deliberately absent

**An override.** There is no way to say "this cell draws *that*". Derivation came first
because that is what keeps an override optional — a tool where the mapping is mandatory is
a chore, and the whole argument of `direction.md` is that the set can describe itself.

When it arrives it should be a *sparse* layer over this, stored the way set-owned
configuration already is, so an unset cell keeps deriving.

**Notes.** The LOM exposes no played-note event and the bridge device is an audio effect
that never sees MIDI, so notes cost a small MIDI Effect on each track you want them from.
Meters approximate it well enough for an MVP — a layer that is making sound moves — but
they cannot tell you *which* note, and pitch is the obvious next axis. It would arrive as
one more field on `Layer` and one more uniform; nothing in the renderer would change shape.

## Where the graph fits, when it does

The table at the top of this file is currently a set of hardcoded rules, and that is the
right place to start — a default that is good enough to never touch beats a blank canvas
that demands configuration.

But it is also, obviously, a **patch**: sources on the left (a track's meter, the beat
phase, the section, a clip's colour, a note when there is one), visual parameters on the
right, and rules wiring them together. That is a modulation matrix, and a modulation matrix
is the one UI that has no good non-graph form — Resolume's own version of it is a dialog,
and it is the weakest part of the program.

So this is where [`widgets/`'s `Graph`](../../widgets/docs/graph.md) earns its place in
this app, rather than in the render path. The render path is a line — source, effect,
composite — and a line is a `Chain`. What is genuinely a graph is *what drives what*.
