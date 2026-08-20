# The console

`src/ui/Console.tsx`, `Coverage.tsx`, `Bind.tsx`, `Looks.tsx`. Three views over one show.

## Why three, and why these

They are not tabs over a settings screen. Each is a different **distance** to stand at from
the same set, and the three are the whole job of configuring one:

| view | the question it answers | the scale |
|---|---|---|
| **design** | what is worth putting on a wall | one look, and a stack of them |
| **coverage** | what have I not decided about | the set, all of it at once |
| **bind** | is this right, and how far should the fix reach | one moment |

**Design is first, and that ordering is the correction.** The console was built
binding-first, so a look only existed in relation to a track and the only way to see one
was to have Ableton running with the right clip playing. You cannot build a library that
way; you can only tweak whatever happens to be on screen. Make things, then decide what
drives them. The designer is [its own doc](looks.md).

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

## Design is documented separately

The look designer, the stack rules, the addressing drawers and the picture-per-node all
live in [looks](looks.md), because they are about **what a look is** rather than about how
the three views fit together. This file is the shell and the two binding views.

## It is built from `widgets`, and that was a correction too

The first pass of this console imported **no widgets at all**. The tab bar was raw
buttons, the segmented controls were hand-rolled five times across two stylesheets, and
`console.css` carried a blanket `button` rule to prop it all up — a rule that outranked
`.wdg-toggle-body` on specificity and would quietly have redrawn any widget dropped near
it.

Everything that is a control is now the widget for it: `Segmented` for the tabs, the
row/column cuts, the A/B mode and the scope; `Toggle` for hold and loop; `Button` for every
action; `Knob`, `Slider`, `NumberField`, `Meter` for values. What stayed hand-written is
what is genuinely not a control — a matrix cell, a list row, a layer chip — and those now
name themselves in CSS rather than claiming every `button` on the page.

Two widgets came out of the exercise rather than going into it: `Button` and `Meter`. Both
are in [the catalogue](../../widgets/docs/catalogue.md) with the reasoning.

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
