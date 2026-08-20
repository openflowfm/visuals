# The console

`src/ui/Console.tsx`, `Coverage.tsx`, `Bind.tsx`, `Looks.tsx`. Three views over one show.

## Why three, and why these

They are not tabs over a settings screen. Each is a different **distance** to stand at from
the same set, and the three are the whole job of configuring one:

| view | the question it answers | the scale |
|---|---|---|
| **coverage** | what have I not decided about | the set, all of it at once |
| **bind** | is this right, and how far should the fix reach | one moment |
| **looks** | what is this thing made of | one effect |

The order is the order a night before a gig runs in: find the gaps, fix them against the
picture, and only then open up the thing you are fixing *with*. Coverage hands an address
to bind, bind hands an effect to looks, and nothing hands anything back — going back is
what the tabs are for.

This replaced a four-pane editor whose panes were the four levels of the cascade. That was
the right first shape and the wrong second one: it was organised by *where a value lives*
rather than by *what you are trying to do*, so the commonest job — "this song reads wrong,
fix it" — was spread across three panes and none of them showed the picture.

## Coverage exists because of an asymmetry

You author one song at a time. The failure is set-wide.

A track nobody bound draws whatever its name suggested, which is fine almost everywhere —
that is what the backstop is *for* — right up until the one song where it reads wrong.
There is no way to find that song by playing them one at a time, which is exactly how you
would find it.

So the matrix is every row against every track, and **the interesting colour is the pale
one**. A view that showed how much was configured would be a progress bar; this shows what
is left. The four cell states are the cascade seen from outside:

| state | means |
|---|---|
| **said here** | a clip in this row carries an exception — the most specific thing there is |
| **inherited** | the track is bound, and this row gets it along with every other |
| **backstop** | nothing is bound; the name hint and the defaults are drawing it |
| **not in this row** | the row never uses this track, so there is nothing here to decide |

The last one earns its own state rather than being drawn as a gap. A gap you cannot fill is
not a gap, and colouring it like one would make the to-do list mostly noise.

**Rows and columns are both cuts of one question.** Songs against tracks finds the song
nobody styled; sections against tracks finds the track configured for the verses and
forgotten for the choruses. Neither is primary and the toolbar refuses to imply one is.

## Bind puts the output first

You are not setting a value, you are judging a picture. A form with a small preview in the
corner makes you do the judging in the corner, so the output *is* the screen and the
inspector is what fits beside it.

### Nothing lands until it has been seen next to what it replaces

The two panels are the same show on the same clock against two schemes — the live one, and
the one your staged edits would make. That is why an edit is a **value** rather than a
mutation (`pending.ts`): a mutation would have already destroyed the thing you needed to
compare against.

The comparison is only honest if both sides are the **same instant**. Two reactive pictures
sampled a second apart differ because the music moved, and you would read that as your
edit. Hence one clock — `Stage` reads it and never advances it, because `App` owns the
advance and a second advancing stage would run the beat at double tempo. Hence also `hold`
and `loop 4 bars`, which are the two ways to stop the music being the variable.

### The hard part of an override is its scope

The same annoyance can be fixed at the song, the section, the track or the clip, and
picking the wrong one is how a show quietly drifts. So the scope selector does not *change*
what you are pointing at — the `Aim` holds the whole address, and the scope chooses which
part of it the edit lands on.

The reach readout beside it is deliberately unflattering. A track binding is **global** —
the scheme keys layers by track name, not by song and track — so "make the pad calmer" said
at track level makes it calmer in every song with a pad. The readout says so, in songs and
clips. The level that means *this song's pad* is the clip, which is what makes the clip the
exception.

## Looks is the one thing that is genuinely a graph

The other two views are lists of decisions. What an effect *is* is a dataflow, and a table
has never been able to say that. See [circuits](circuit.md) for the vocabulary.

### Two drawers, and the difference between them is the whole idea

A look reads signal from somewhere, and there are exactly two somewheres.

- **My track** is *relative*: a `signal` node means whichever layer is drawing this, so the
  same look means something correct on the bass and on the pad, and travels between songs
  untouched.
- **A named track** is *absolute*: a `track` node names one thing and keeps meaning it,
  which is what "crossfade on the bass meter" needs and is also what breaks the moment the
  look is used somewhere else.

Both are wanted. The design problem was never which to have — it was making which one you
are looking at obvious without making anyone think about the word "relative". Hence the
shapes: **rounded travels, squared stays put.**

### A picture on every node

Each node face shows what *that node* has made, not a thumbnail of the finished effect —
six copies of the same image would teach nothing, while a picture per step turns the canvas
into something you can read along the chain.

`probe.ts` builds it by cutting the circuit off at one outlet and bringing the result back
to a colour through `paint` or `sample`, which are the vocabulary's own two crossings. So a
number is shown the way `paint` would show it: how it will actually look if you wire it
that way.

All of them come out of **one** GL context, blitted into a small 2D canvas per node. A
context each is the obvious build and the wrong one — browsers keep about sixteen alive and
start evicting the oldest, and this page already has the stage, two A/B stages and a bench.
That is also why `preview.ts` caches programs by signature in a map rather than a single
slot: one context cycling through a dozen defs a frame would otherwise recompile every one
of them, every frame.

## What is deliberately absent

**A device parameter as a source.** "Crossfade driven by a filter cutoff" is the second of
the two worked examples this was designed against, and it needs the bridge to watch device
parameters, which it does not. Meters and the clock are what a look can read today; the
drawer says so rather than offering something that would go quiet.

**Notes and velocity.** Same shape of problem, worse: the LOM exposes no played-note event
and the bridge device is an audio effect, so notes cost a small MIDI Effect on every track
you want them from. See [the cascade](mapping.md).

**A song-and-track binding.** The scheme keys layers by track name alone, so "the pad in
*this* song" is said with a clip exception rather than at track level. The reach readout is
honest about it. A fifth level would be the alternative and it has not earned itself yet.

**Undo.** The scheme is replaced whole on every save and the file is the record, so `git
diff` is the undo. Staged edits are the thing you can back out of, and that is on purpose —
they are the ones you have not seen the consequences of.
