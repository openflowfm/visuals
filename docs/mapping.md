# The cascade

`server/show.ts`, `server/scheme.ts`, `scheme.json`. How a Live set becomes a show.

## Four levels, and a thing that is not a level

Each level owns what it is actually in a position to know, and each is more specific than
the last:

| level | owns | because |
|---|---|---|
| **song** | the colours, and how hard it plays | a song has an identity that outlives any one section of it |
| **archetype** | energy and character | a section is a feeling, and the same chorus should differ between two songs |
| **track** | what a layer does with content | a track is an instrument; its layer should stay recognisable across a whole song |
| **clip** | the exception | the most specific thing there is, and the only level that can say "not this time" |

**Live signals are deliberately not a level.** The meter, the beat, the phase and the tempo
thread through everything as shader uniforms rather than being resolved at one step,
because they are not a description of what the picture should *be* — they are what makes it
move once it has been decided. Anything can be modulated by them, and nothing in the
cascade has to know they exist. A [circuit](circuit.md) reads them by name as `signal`
nodes; a built-in shader reads them as `uLevel` and `uBeat`. Same values, same frame.

That split is what makes an archetype dynamic rather than a preset. A section does not pick
a different picture; it moves `uEnergy`, and every source and effect responds to it
continuously.

## How the levels combine

Three different rules, and each is deliberate:

- **Scalars override, field by field.** `source`, `blend`, `floor`, `bias` and `hide` take
  the most specific value that was set, which is what "a clip is an exception" has to mean.
  Field by field matters as much as the order: binding one field of a track leaves the rest
  to the name hint, so saying "this drum track is calmer" does not also throw away "this
  drum track is a drum".
- **Effects add up.** The archetype contributes the section's character, the track
  contributes what that instrument always does, and both survive. "The chorus should mix in
  more frenetic effects" is additive by construction — anything else would make the track
  and the section fight over one slot. `maxEffects` caps the pile.
- **`bias` accumulates**, which is what makes **energy per layer** rather than per show. A
  drum track can run hotter than the pad under it in the same chorus, and that is a thing a
  single global number cannot say. The song's bias is the exception: it lands on the
  *section's* energy rather than on any one layer's, because a song that plays hard brings
  the whole picture up with it — including the floor gate that decides how much of the
  stack is in.

## Energy, and the four things it reaches

One number per archetype, trimmed by the song, biased per layer, arriving in every shader
as `uEnergy`.

| it drives | how |
|---|---|
| **reaction speed** | see `rate()` in [the renderer](render.md) — energy moves a section up a ladder of musical divisions, each layer sits a rung or two either side of it, and `defaults.pace` shifts the lot |
| **effect intensity and count** | `dialEffects` opens the first across the bottom half of the range and the second across the top, so a section *grows into* its effects rather than acquiring two at once. Every effect mixes against its own input by `uAmount`, so 0.3 is a suggestion and 0.95 has taken the frame |
| **brightness and contrast** | `charge()`, applied by `OUT`, so no source can forget it |
| **how many layers draw** | each layer has a `floor`; below it the layer fades out rather than cutting, so a quiet section reads as the picture closing down |

### Presence and character are separate, and conflating them was a bug

The floor is tested against the **section's** energy, never the layer's biased energy.

A pad track carrying `bias: -0.15` is asking to be *calmer*. Tested against its own biased
value it became *absent* — gone for the whole of every verse. Presence is a fact about the
section ("the chorus brings everything in"); the bias only ever describes how frenetic a
layer is once it is already there. Two questions, two inputs.

## Layers bind to track names, not to patterns

`Scheme.layers` is keyed by the **exact name of a track**, and `Scheme.clips` by the exact
name of a clip. This replaced a list of case-insensitive regular expressions, and the trade
is worth stating plainly.

A pattern could catch a track that did not exist yet, and could describe a family in one
line. What it could not do was be *read*: a rule was a string you typed, matched against
names you had to remember, in an order that silently decided the answer, and a typo was
invisible until the night the section it was written for arrived. What a binding gets in
return is that **every layer is on screen**, in composite order, each showing what it
actually resolved to. A show is configured once and read a hundred times.

The patterns did not die; they were **demoted to hints**. [`hints.ts`](../hints.ts) holds
the same table, and it answers only for a track nobody has bound — which is exactly what a
pattern is good at. An unconfigured set still draws something roughly right, and that first
evening is the difference between configuring this and not bothering. It sits beside
`protocol.ts` rather than in `server/` because the randomiser needs the same reading of a
name that the resolver does.

Two tracks with the **same name share one binding**, since the name is the key. That is
usually what you want — three tracks called `MIDI` are three of the same thing — and it is
visible in the editor, where all of them light the bound marker together.

Word boundaries in those hints are load-bearing, not tidiness: without them `beat` matches
inside "Beating Pad" and a pad track draws as a drum. `scheme.test.ts` pins that against
real track names, because a mis-routed layer looks like a rendering bug rather than a
regex one.

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

Overrides are shallow *per section*: naming one archetype does not delete the other six,
and registering one effect does not remove the six built-in ones. `layers` and `clips`
merge the same way, since an entry keyed by one track's name has nothing to say about
another's.

A parse error **keeps the scheme that was already working** and reports the message in the
panel. Losing the show to a trailing comma is the wrong answer at any time and an
unthinkable one during a set.

The file lags an edit by 200ms. A knob turning and a node being dragged both emit on every
pointer move, so what the server *holds* updates immediately — the picture has to follow
the pointer — while the write is debounced, since nobody reads the file until the gesture
is over.

## The console

`e` in the app opens it, over the picture rather than beside it, because the whole point is
tuning a chorus while a chorus is on screen. Full reasoning in [the console](console.md).

It used to be four panes that **were** the cascade — songs, sections, layers, effects, in
the order specificity runs. That was the right first shape and the wrong second one: it was
organised by *where a value lives* rather than by *what you are trying to do*, so the
commonest job of all ("this song reads wrong, fix it") was spread across three panes and
none of them showed the picture. The three views that replaced it are three distances
instead — the set, a moment, one effect.

The cascade did not go anywhere; it stopped being the *navigation*. Coverage draws it as
four cell states (said here, inherited, backstop, not in this row), and bind's scope
selector is the same four levels asked as one question: how far should this reach.

**The resolver is shared with the server.** [`resolve.ts`](../resolve.ts) sits beside
`protocol.ts` for the reason [`hints.ts`](../hints.ts) does — two consumers, one reading.
`buildShow` resolves the cell the transport is sitting in and calls it the show; the console
resolves any cell you point at and calls it the answer. A second implementation would
drift, and it would drift in the worst way: the editor would tell you what a chorus was
going to look like and the stage would disagree.

It also returns **who answered** for every scalar, which the old inline resolution computed
and threw away. That was fine while the only consumer drew pixels. An editor cannot work
without it: "said at track level" and "inherited, untouched" are both questions about where
a value came from rather than what it is.

Every name it offers — roles, songs, tracks, the playing clip — comes from **the set**, so
nothing asks anyone to type one.

## What is deliberately absent

**Notes.** The LOM exposes no played-note event and the bridge device is an audio effect
that never sees MIDI, so notes cost a small MIDI Effect on each track you want them from.
The meter approximates it — a layer making sound moves — but it cannot tell you *which*
note, and pitch is the obvious next signal. It would thread through as one more uniform and
one more `signal` node, which is exactly why signals are not a cascade level.

**Per-clip visuals as files.** A clip exception can change what a layer *does*; it cannot
yet point at a video. That brings a whole question about where media lives that the derived
mapping has no answer for.

## Rolling a show

The `roll` button in the editor's header replaces the whole scheme with a new one, drawn
from a seed and from whatever the set actually contains. [`roll.ts`](../roll.ts).

It is not a scatter of random numbers over a scheme. A random show is easy and always looks
like noise; what makes a rolled one read as a *show* is that it obeys the same constraints
a hand-made scheme does:

- **One source per family, not per track.** Every arp in the set draws the same way, because
  four arps across four unrelated sources read as four unrelated things when they are one
  family. The families are the name hints above, which is why they had to move somewhere
  both the resolver and the roll could reach.
- **A song keeps its shape.** `INTRO < VERSE < BUILD < CHORUS` holds for every seed, because
  those four are drawn from **disjoint** energy bands. Ranges that merely *tended* the right
  way put an intro above a verse about one roll in thirty — often enough to happen on stage
  and never while you are looking. A bridge, a jam and an ending are not in that chain and
  may overlap freely, because nothing says a bridge is louder than a verse.
- **Colours are a harmony, not five hues.** A base hue, one of five relationships to it, and
  one member kept near white so a busy frame has something to read edges against. All of it
  kept light: a cheap projector has no black to work against, so a dark colourway is a dark
  screen.
- **A drum is not a wash and a pad is not a strobe.** Percussive families draw from a
  percussive set and pads from a soft one; everything else may have anything.
- **The pace moves by a whole rung either way.** Two rolls of the same set should not only
  look different, they should *move* differently — and a rung is a big enough step to feel
  without any of them landing off the grid.
- **A wash never gets `over`.** `solid`, `plasma` and `noise` fill the frame, and layer order
  is Live's track order, which a roll cannot change — so one of them landing on `over` near
  the top of the stack is a curtain drawn across the show. Every other mode lets what is
  underneath through. Blends generally lean toward `screen`, which saturates at white rather
  than climbing past it: an even pick over the four modes puts a quarter of a tall stack on
  `add`, and a quarter is enough to white out the frame before the layers that were meant to
  be seen have drawn.

Each roll also wires **two fresh circuits** and clears the ones before them, or a week of
rolling leaves forty of them and every archetype pointing at a ghost.

**Undo covers the roll you just did; the seed covers the one from last Tuesday.** One level
of undo is the right number — a roll replaces everything, so the thing you want back is
always the thing you had a moment ago. Anything older is better served by a seed, which is
two words and a number, survives a reload, and can be written on a hand. Typing one back
into the footer reproduces that show exactly.

## Where the graph fits

It is here already, and it is [an effect](circuit.md) — sources and effects are what a rig
of this kind actually spends its vocabulary on, and a table was never the right shape for
one.

The scheme itself stays a table, and should. A default good enough never to touch beats a
canvas that demands wiring, and coverage and bind are lists of decisions rather than a
dataflow. The thing that genuinely *is* a graph is what drives what — and that is what a
circuit's `signal` nodes already are, per effect. A global modulation matrix, wiring a
track's meter to another layer's parameter, is the version of that idea that has not been
built and has no caller yet.
