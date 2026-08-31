# The wheel

`resolve.ts`, `server/show.ts`, `server/scheme.ts`, `randomize.ts`. What is on screen, and why.

## It replaced a cascade

This file used to be called *the cascade* and described four levels — song, archetype, track,
clip — each overriding the last, with additive flow lists, accumulating bias, and a `Said`
for every scalar so the editor could explain which level had answered.

All of it existed to combine pictures. [A graph combines pictures](flows.md), so it is gone,
and what replaced it is one question with one answer: **which flow, and which colours.**

## The rotation is the default and binding is the exception

That inversion is why most of the model could go, and it is the whole design.

A rig that draws nothing until it is configured is a rig nobody configures. This one turns
through everything you have made — a wheel of flows and a wheel of colourways, advancing on
musical time — so a set it has never seen still gets a show. A song entry is how you say
"not for this one".

```
Rotation {
  flows: []        // empty means EVERY flow there is
  colorways: []    // empty means EVERY colourway there is
  bars: 8          // turn the flow every 8 bars. 0 holds
  colorEvery: 16   // turn the palette on a longer wheel
  onClip: true     // and turn when a clip is fired out of band
}
```

**An empty pool means everything, never nothing.** That reading is the one thing a blank
field must not have here: it is the state a fresh install is in, and a fresh install has to
draw a show.

## A shuffled cycle, not a random pick

`atTurn` walks a shuffled cycle rather than picking independently each time, so a pool of
five shows all five before it shows any of them twice.

Independent picks *feel* random and *read* as broken: the same flow twice in a row looks like
the change failed, and two of five never appearing at all looks like they are unwired.

The shuffle is deterministic in the pool and the lap, so the server and the editor agree
about what is up without either telling the other, and a lap later is a different order
rather than the same one again. The join between two laps is fixed up too — the last of one
lap and the first of the next are never the same thing, which is the one repeat a shuffled
cycle can still make and the one that reads as the wheel having jammed.

## Three triggers, and two are gestures

**Bars, not seconds.** Everything here is musical, and a picture that changes 11.4 seconds in
changes in the middle of a phrase.

**An out-of-band clip launch.** A scene launch moves every track at once; a clip launch moves
one. So the dominant playing index is the scene, and a track that has moved somewhere else on
its own is somebody reaching past the grid — which is already the "and now something else" of
a live set, and the only gesture the rig can hear without being told.

**The `n` key.** This turns only the flow wheel once and leaves the colourway where it is.
The turn belongs to the server, not the browser that received the key, so the console and the
projector change together. Key repeat is ignored: one press is one flow.

A **scene change is deliberately not a trigger.** Scenes fire constantly and the picture would
never settle into anything. A scene *launch* re-phases the wheel instead, which changes
nothing on screen — see below.

## Where the phrase starts, and why the rig has to be told

Bars are counted from **the one**, which is a beat the server holds and not Link's zero.

Link's beat is one continuous session timeline that started whenever the first peer in the
building opened a laptop, so an eight-bar wheel counted from its zero turns on a boundary
with nothing to do with the music — the third beat of some bar nobody can name — and stays
there all night. Every change lands slightly wrong and no amount of choosing the right
number of bars fixes it, because the number of bars was never the problem.

Three things set it, and only the last costs a gesture:

- **Live's transport starting.** A set that stops between songs re-phases itself. The
  clearest statement of where a phrase begins that this rig will ever get is somebody
  pressing play, and it is free.
- **A scene launch button**, and only when the launch lands somewhere the phrase grid does
  not already have a line. A set that is locked in keeps counting; a section called early
  moves the one. See below.
- **The `1` key**, for a set that never stops and never leaves a scene. A digit rather than
  a letter because it *is* the count.

### Pressing play is not starting

With a session up, pressing play does not start playback — it **arms** it, and Live holds
until the next bar line so that every machine on the network starts together. That is the
phase widget filling up beside the Link button.

Live's transport flag goes true at the **press**, which is up to a whole bar before a note
is heard. Taking the one from that moment puts the phrase a bar early for the rest of the
night, which is the same misalignment the one exists to fix, arrived at by a different road.

So the server waits the same wait, by the same clock: it holds the reset until Link's phase
drops, which is the bar line, which is where Live actually started. **The wait only happens
when there is somebody to wait for** — with no peers there is no session to start together
with, Live rolls immediately, and a rig that held on for a bar would be the one thing in the
building out of time.

### The launch button, never the movement

**This one is asked for, not inferred, and the difference is the whole feature.**

A scene launch moves every track's `playing_slot_index` at once, so a burst of `playState`
looks exactly like one. But so does a row of clip follow actions walking the grid on its own,
and that is the opposite gesture: nobody pressed anything. Re-phasing on those would restart
the countdown at every section, and a wheel whose period is longer than a section would then
never reach a turn on the clock at all — the picture would freeze until somebody hit a key.

So the rig watches `Scene.is_triggered`, which **is** the launch button, and which a follow
action never sets. One observer per scene, which is the same order as the play watcher's
three per track and nothing like the per-slot cost the [protocol rules](../../protocol/README.md)
forbid. It is its own watch — `watchScenes` — rather than a rider on `watchPlay`, because
only this rig asks and a grid that doesn't care shouldn't pay for it.

**The landing, not the press.** `is_triggered` goes 1 when the button is hit and 0 when the
scene actually starts, so the bridge reports the falling edge: Live has already sat through
its own launch quantisation, which is the wait the transport needs done by hand and this gets
for free. Launching a second scene while the first is still blinking clears the first without
it ever starting, so only the *pending* scene's fall counts. With quantisation off both edges
arrive in one tick and it still reports.

### Only when it would move the one

A launch that lands on a line the grid already has is **not** a re-phase.

This is the condition that makes the whole thing safe to leave switched on, and the
arithmetic behind it is worth being explicit about. `reOne` carries the turn count across the
move, so nothing on screen changes — but it restarts the *countdown*, and a timed turn only
ever lands if the gap between re-phases is longer than `bars`. Re-phase at every section and
an eight-bar wheel reaches a turn roughly never: the picture freezes, for a set that is
behaving perfectly, and the only things left that could move it are `n` and an out-of-band
clip.

So `inPhase` asks whether the launch is telling the rig anything. A player who launches a
scene exactly one wheel-length in has confirmed what the grid already said — the set is
locked in, and it keeps counting undisturbed. What is left is the launch that lands
*somewhere else*: an early call, a cut, a section that ran long. Those are the moments the
phrase genuinely moved, and the only ones worth spending a reset on.

Measured against the flow wheel, which is the one being watched. A launch in phase with it
may be out of phase with a longer colour wheel, and skipping still leaves both exactly where
they were — where re-phasing would have moved the colour. Skipping is never the destructive
answer.

### The line comes from the phase, never from the beat

`Math.round(beat)` is not a downbeat. Link's beat has no bar 1 in it, so a whole beat of it
lands on some beat of some bar with no relation to the music — which is the original problem
in miniature. `phase` is the part Link shares that *is* musical: subtract it and you are on
the line Live's own grid is drawn on.

Nearest line rather than the one just passed, because a hand is as likely to be early as
late and a tap three quarters of the way through a bar means the downbeat about to happen.

**None of them turns a wheel**, and that is the part worth getting right. A reset lands
on a downbeat, which is exactly the moment `beat - one` is nearest zero — which is where a
naive count would snap every wheel back to the start of its cycle. So the gesture you make
when the picture is right and only the timing is off would change the picture, every single
time. `reOne` reads the counts on both sides of the move and carries the difference, so what
changes is *when* the next turn happens and nothing else.



The counting lives in `Turning`, held by the server and handed in, because a show built from
scratch every second has nowhere to remember an event. One per server rather than per client:
the wheel is a property of the show rather than of who is watching it, and two browsers open
on the same rig have to be looking at the same picture. A **first read never counts as a
change**, or the wheel would advance every time a browser connected.

## What a song may say

Two fields, both optional, both meaning *pin this instead of letting it turn*.

```ts
interface SongSpec {
  colorway?: string;
  flows?: string[];
}
```

A song naming exactly **one** flow is the only case that stops the wheel. A song naming three
is still a rotation, just a shorter one — which is what makes the override cheap to reach
for, because "these three, for this song" is a normal thing to want and should not need a
second concept.

A pin naming a flow nobody has any more is dropped rather than obeyed. A stale id must not
black the screen for a whole song.

## Colours come from the wheel, never from the clip

Each track takes a colour by its position in the set out of whatever colourway is up.

**Clip colour is not an input and should not become one.** Those colours are how you find
your place in the grid during a show, and driving the picture from them would force a choice
between a set you can navigate and a set that looks right.

### A colourway is five roles, and the length is fixed

`primary`, `secondary`, `complement`, `accent`, `chalk` — `COLOR_ROLES` in `protocol.ts`.
Each names the job the colour does in a picture rather than where it sits, so a source asks
for the kind of colour it needs and any colourway can answer.

This replaced a list of any length whose only distinction was position, of which **a flow
could reach exactly one**. Every generator drew from `colors[0]` and invented the rest,
mixing toward `vec3(1.0)` or toward its own complement — so a five-colour palette rendered
as one member plus two colours that were not in it, and members two through five were
reachable only through a `tracks` node handing them out by position in the set. The cheap
per-track pass was the only thing in the rig honouring the palette.

**Fixed at five**, because outlets are static on a node spec and the colourway on the wheel
changes every `colorEvery` bars. A `colorway` node's per-role outlets cannot follow a
palette that changes length, and a cord orphaned by editing a *palette* — in a flow that is
not even open — is the worst kind of action at a distance. `paletteOf` is the one place a
shorter stored colourway is made to answer, called from `merge` so the repair is written
back rather than redone sixty times a second.

## The scheme library

`~/.openflow/visuals/schemes/<id>.json`, one saved scheme per file. On a new library,
`server/library.ts` writes **main** as an ordinary editable copy of `EXAMPLES` and also puts
the system **Examples** scheme on the shelf. Examples is read-only: it always reflects what
this version ships, and **save as** is the way to make a scheme from it. `state.json` beside
the library remembers which scheme is open, so a restart reopens the show you were in. The
paths are `home.ts`'s business: `OPENFLOW_HOME` moves the `~/.openflow` root wholesale,
`OPENFLOW_VISUALS_SCHEME` pins one exact file and turns the library off, and a scheme from
before the library — the single
`~/.openflow/visuals/scheme.json`, or the `visuals/scheme.json` beside the code before
that — is adopted as `main`, copied once, the first time anything resolves it.

**An edit is not a save.** Every gesture in the editor reaches every screen immediately —
the picture has to follow the pointer — and all of it lands in server memory only. The file
changes when you press save, and the distance between the two is the dirty mark in the
console. That is what makes it safe to tear a scheme apart during a set: the saved one is
exactly as good as it was when you last meant it. The cost is honest too — unsaved edits
live in the server process, and stopping it takes them along. Save writes the open user
scheme's file, save-as writes it under a new id and stays there, load opens a saved one —
the console asks before dropping unsaved edits, the server does not. An edited Examples
scheme may only be saved as a user scheme; save and the MCP authoring door both refuse to
overwrite the system source. `server/library.ts` holds all of this.

**A scheme owns its flows and colourways.** Their maps are complete, not overlays: removing
an id means it is gone, on the next server round trip and after a restart. A file from an old
partial format that omits an entire `flows` or `colorways` section receives the examples as
a one-time compatibility floor; once saved, the full maps are explicit like every current
scheme.

A parse error **keeps the scheme that was already working** and reports the message in the
panel. Losing the show to a trailing comma is the wrong answer at any time and an unthinkable
one during a set.

**A value of the wrong shape is a parse error by another name**, and gets the same answer.
`"colorways": {"x": "nope"}` parses perfectly and then reaches `hex.map` in `show.ts`;
`"flows": "folded"` on a song reaches `song.flows.filter` in `resolve.ts`; `nodes` that is
not an array reaches `reword`. All three run inside the show heartbeat, so all three used to
be the visuals process gone and the wall black — for a typo in a file people are *meant* to
hand-edit. There is nothing to repair, because nobody can say what those were supposed to be,
so `merge` refuses them: the working scheme stays, the message goes to the panel. It refuses
an unknown node `kind` for the same reason — `signalOfPort` reads `NODE_SPECS[kind].outlets`
unguarded, so a made-up kind is a throw rather than a node that draws nothing. Unknown *keys*
pass through untouched, since a hand-written `_` block explaining the file is not an error.

Both doors go through it, so an editor that sends a shape `merge` will not take is refused
the same way and leaves the picture where it was.

The open file is still watched. Edited clean — by hand, or by the MCP server — it reloads
onto every screen. Edited while the screen holds unsaved work, it does not: the console says
the file moved, and saving overwrites it while loading takes it. Nothing silently discards
either side.

**`merge` is the one door, so it is where a graph gets repaired.** A scheme reaches the
renderer exactly two ways — read off disk, or sent up by an editor that gets it straight back
down again — and both come through that function. Every flow that passes through it comes out
with exactly one `out` and with no cord addressed to a port that is not there, which are the
two things a *file* can say and the editor cannot. Repairing here means the repair is written
back the next time anything saves; repairing in the compiler would mean silently redoing the
same fix sixty times a second and never telling anyone. See [flows](flows.md).

**Examples never leak into a user scheme.** Improving or adding one changes the read-only
Examples scheme and the `main` copied on a genuinely new library. Existing schemes stay
byte-for-byte theirs; taking a newer example is an explicit copy rather than an update that
arrives inside a show.

## The seventeen examples

`EXAMPLES.flows` in `server/scheme.ts`, and they are the manual: nobody reads a node
reference and everybody takes a working example apart. So they are a **spread** rather than
seventeen variations, one lesson each — and because the wheel turns through everything by
default, they are also the show a fresh `main` puts on.

| flow | what it is for |
|---|---|
| **Folded** | a colour is a function of a point: the set and a ring of its own, read through a swirl and folded by a kaleidoscope that moves the whole chain |
| **Deep** | two pictures, one of them the room's — a corridor with the set screened into it and graded |
| **Weather** | no set and no shipped picture: `polar` makes two numbers out of a position, `colorway` makes a colour out of one and `hue` makes every colour out of the other |
| **Water** | refraction. A surface that displaces what you see *through* it, and the one drift here deliberately not in time |
| **Vortex** | a portal that turns rather than recedes: `zoom` on the beat pulse, so the whole spiral punches inward on every hit |
| **Gateway** | geometry happens *before* the picture — `fold` and a bare point feed two sources that never meet until the blend |
| **Outline** | the set as a diagram. `edge` keeps the outline and throws the fill away — over a grid, so there are always edges to find, and over a ghost of the same junction |
| **Poster** | flat bands, and the one flow that changes with the *music* rather than the playing: `posterize` to four steps over a wash, hue rotated by the song's key |
| **Glitch** | two lenses, a spread and two grades in a row and nothing else, over a scan pattern there is always something to break in — the busiest thing here, and the one that teaches how far a chain of small steps gets |
| **Lava** | a threshold walked slowly off `time` rather than the beat, and a cord run backwards by a negative depth |
| **Storm** | an `lfo` snapped to the beat times a squared `random`, gating a contour cut out of a noise field — a strike that is rarely big and never the same size twice |
| **Counterweight** | two lamps crossing in counter-motion over radial structure, with the set kept as a quiet layer rather than the picture it waits for |
| **Glasshouse** | mirrored and folded architecture filled with slow clouds and light shafts, moving like a building breathing |
| **Tidal glass** | caustics and metaballs moving at different depths under one shallow refraction |
| **Star loom** | a bounded Julia orbit folded before it is drawn, so one expensive fractal becomes radial without a spread multiplying it |
| **Switchyard** | a sample-held mechanical plate of cells, checker, edge and posterised bands |
| **The lot** | three of the others as three nodes, one of them folded by a kaleidoscope that never touches its insides |

Three of them are **portals**, and that is deliberate rather than repetition: `Deep` recedes,
`Vortex` turns and `Gateway` opens. It is the shape this kind of rig reaches for most, and
one example of it would have taught that a portal is a source rather than a way of building.

Between them they use every family in `NODE_FAMILIES`, which a test pins, and they keep two
rules that were learned the hard way.

**Nothing is only alive when the room is loud, and the shape of that is `max`.** `master` is
zero with no Live attached and near it when all that is running is a click between songs —
so a meter wired straight into an energy holds a generator at its dullest: fewest arms,
slowest rung on the division ladder, least charge. Every one of these now floors that with
something on the clock:

```
lfo / playback ───> a ┐
                      ├ max ──> energy
track (master) ────> b ┘
```

The `a` inlet carries a **range** rather than the whole swing — `{ a: [0.3, 0.4] }` is a
floor of three tenths that the clock lifts by four — so the picture sits somewhere useful with
the room silent and the meter takes over the moment it is louder than that. Which clock is
the flow's own business, and it is most of the character: `Vortex` floors on the same pulse
that punches its zoom, `Gateway` on a saw so it ramps rather than twitches, `Water` on the
slow sine already moving its surface, and `Glitch` on a per-beat pulse because it is the one
that should twitch.

**And a flow that reads the set carries a picture underneath it.** With no clip playing a
`tracks` node draws nothing, which used to mean five of these went black between songs. There
is a ring under `Folded`, a grid under `Outline`, a wash under `Poster` and a scan pattern
under `Glitch` — each blended so a playing set is what you see, and each there when it is not.
There is no exception. There was one, `The set`, a lone `tracks` node that drew what was
playing and nothing when nothing was; it is gone, because a flow that is a single node is
that node, and the browser already offers `tracks` under `draw`.

**Nothing is wired to something that cannot move it.** `Weather` used to drive a `hue` from
`song seed`, and a set with no song names holds that at a half — which is exactly the
rotation that does nothing. A cord drawn right across the canvas into a node that visibly
never changed is worse than no cord: it teaches the wrong thing about the vocabulary. A
number that idles at a half belongs on an inlet where a half means something, which is why it
now drives a blend amount instead.

**One of them costs what nesting costs, on purpose.** `The lot` ends up nine evaluations of
`Vortex`'s spiral and six of `Water`'s plasma in one frame, because both of those flows end
in a `spread` and a spread reads its input once per tap. Nesting does not add, it multiplies,
and the library should contain one honest example of that rather than only the cheap kind.

They are also **laid out from their own wiring** — a column per step along the signal — so
the first thing anyone opens reads left to right instead of needing untangling.

## Randomising a library

`randomize` deals a new one from a seed. It used to deal a *show* — colourways, song
assignments, section energies, per-track bindings and two circuits at once — because a show
was a table of decisions with a couple of graphs in it. A show is a library and a wheel now,
so it deals the two things a library is made of: **flows and colourways**.

It was called `roll`, and the word had to go. A roll is a piano roll in every DAW there is,
and this repo proves the point on itself — `tools/fake-live.ts` uses "the roll" throughout to
mean the chart's note display, three directories from a function that meant something else
entirely.

A randomised flow walks a **shape** — a structure a person might wire — and randomises what
fills each slot. A random walk over the whole vocabulary produces garbage nine times in
ten; the shape is what makes it a flow and the fill is what makes it a different one every
time. There are **five shapes** now, where one deck of judged deals showed a single shape
kept everything inside one family resemblance: the classic chain (a picture, moved about,
then worked on), a priced feature (a fractal or field carrying the frame), a hung light (a
lamp at a driven `place`, over the set or a dimmed wash), a spread finish, and a keyed flow
whose colour turns with the song's key. `video`, `flow` and `polar` stay out on purpose —
files a machine may not have, a library a deal must not assume, and an authoring tool.

Three constraints are worth stating because they are what make a dealt one read as
*something*:

- **It reaches for the set more often than not.** A randomised flow that ignored whoever is
  playing is a screensaver, and this rig is not one.
- **It wires at most one `spread`, and only over a cheap chain.** `bloom`, `smear`, `edge`
  and `shift` each read their input several times, so nesting two — or putting one over a
  fractal, field or light — multiplies the shader. A hand reaches for one knowing what it
  costs; the randomiser follows the rule constructively, so it can never wire the
  multiplication the compiler would refuse.
- **Every colour is dealt to its role.** A colourway is five named jobs — `primary`,
  `secondary`, `complement`, `accent`, `chalk` — and each harmony now states which offset
  fills which. It did not used to: the deal found whichever member sat furthest round the
  wheel and called that the loud answer, then picked one of the leftovers at random to be the
  light one. So which *position* held the opposite moved from deal to deal, which was
  survivable while nothing could reach past the first colour and is not now that a graph
  wires to a role.

  Every relationship still contains an opposite, because a palette of neighbours is a wall in
  a single colour — harmonious, and indistinguishable from a gel over the lamp. What changed
  is that the opposite is *chosen* rather than found, and it lands in `complement` where the
  vocabulary says it is.

  **The colours are picked in OKLCH, and dropping HSL is what stopped them being mud.**
  HSL's `l` is not lightness and its hue degrees are not evenly spaced, and the old generator
  carried a correction for each: an `evenly()` that added back a fraction of a hand-written
  luma table, and harmonies whose 22-degree step was the whole distance from red to orange
  but almost nothing between two greens. Both are deleted rather than improved. `L` is
  perceptual lightness, `C` is how much colour there actually is — independent of `L`, where
  "saturation 0.9" had meant a pastel at one lightness and a fire engine at another — and a
  hue offset means one relationship wherever the base landed.

  **Every member sits relative to its own hue's peak**, which is the thing the old one had no
  way to ask. How vivid a hue can be depends entirely on how light it is, and where that peak
  sits moves right around the wheel: a fully saturated yellow-green is a light colour and a
  fully saturated blue is a dark one. Naming one lightness for all five asked for the colour
  that does not exist and got mud in the yellows every time. The four shipped colourways have
  always done this by eye — measured in OKLCH, every non-tint member of all four sits at or
  near its own hue's peak, and their lightnesses run 0.60 to 0.92 as a result.

  Three things are then guaranteed by construction rather than left to the ranges, because
  each had a hue somewhere on the wheel that broke it:

  - **`secondary` is measured against the primary's own chroma**, not its own hue's ceiling.
    A blue primary floored up to 0.58 for the projector, beside a magenta secondary taking
    four fifths of magenta's far larger ceiling, gave a secondary that shouted louder than
    the base.
  - **`accent` is lifted by what the lift costs**, not by a fixed step. +0.12 off an amber
    peaking at 0.75 lands where amber has nothing left, while the same step costs a yellow
    almost nothing — so one number made a strong mark for half the wheel and a washed-out one
    for the rest.
  - **`chalk` is held below the quietest of the other four**, and takes **what its hue can
    actually hold** at the lightness it landed on. Being the least colourful thing in the
    palette is what the role *is*, so it cannot be a coincidence of the ranges — and it
    stopped being one the moment a lifted amber accent reached a chroma a cream could match.

    The gamut check is newer and it fixed a bug nobody could see. Chalk was the one member
    still *naming* a chroma rather than asking for one, and sRGB is at its narrowest in the
    tints: at 0.94 lightness a green has 0.22 of chroma available and a blue has 0.030. A flat
    ask of 0.045 was comfortable at one end of the wheel and fifty per cent outside the gamut
    at the other — and outside it, clipping does not return a quieter version of the colour
    asked for, it returns **a different hue**, by as much as 24 degrees. So the tint of a blue
    primary came back a pale cyan two roles away from the colour it was supposed to be tinting.

### The deal is searched, not rolled

Everything above is **placement**, and every rule in it is pairwise: it fixes one member's
relationship to the primary. That is why the generator could satisfy every rule it had and
still deal a bad palette — nothing in it could see the five members *together*.

So a deal is now forty candidates scored against four criteria, keeping the best. The
randomness that is left is the randomness worth having: **which good palette**, rather than
whether it is one.

| criterion | what it catches |
|---|---|
| **separation** | two roles that came out the same colour. A split complement on a base around 150° put `complement` at 302 and `accent` at 358, both lifted, both landing on one violet-pink — every rule satisfied, and a four-colour palette with a spare. A graph wires to five outlets; two of them carrying the same colour is a flow whose second cord does nothing. Floors are per pair, because `secondary` is *meant* to sit close and `complement` is not, and `accent` has the strictest floor against everything because hue discrimination collapses at the size it gets drawn. |
| **hierarchy** | a "primary" that is the second-loudest thing in the palette. `complement` is dealt at its own hue's peak on purpose, and how much a hue can hold varies enormously — so a blue primary floored up for the projector, against a magenta complement at magenta's much larger peak, inverts the palette. The fix is not to cap the complement, which would undo the reason it is there; it is to **prefer a base that can hold the lead against its own opposite**, and that is a choice only a search can make. |
| **temperature** | a palette that is all one temperature. The oldest working rule in colour and one the generator had no notion of: a dominant with a **counterpoint**. The harmonies guarantee an opposite *hue*, which is a different claim — red and yellow-green are 120° apart and both warm. Three against one, either way, is the classic. |
| **clarity** | the khaki. Only one stretch of the wheel goes *dirty* rather than pale when it loses chroma, and exactly one role loses chroma on purpose: `accent` trades colour for lightness. Traded in the yellows that is a fine bargain; traded at 110° it is olive drab, and olive drab as the small bright mark is a mark nobody finds. |

Separation is a **gate** rather than a vote — the score multiplies by it, so a candidate whose
members collide can never win on charm. Two members reading as one colour is a broken palette;
a palette with no temperature lead is merely a duller one, and no amount of dullness should
lose to a collision.

Distance is measured as ΔE in OKLab **with lightness at less than half weight**. OKLab is
calibrated for two patches side by side on a good display; a cheap lamp has no black to work
against and the room adds its own light to everything equally, and both of those crush
lightness differences specifically. Two colours that differ only in how light they are arrive
at the back of the room as one colour.

### A mood is the person's half of the deal

`MOODS` in `protocol.ts`: `any`, `neon`, `sunset`, `ice`, `earth`, `flare`, pinned per
colourway from the picker beside its dice and stored in `Scheme.moods`.

The generator knows a great deal about *how* to build a palette and nothing about **which one
you want tonight**, and that gap is what made the dice feel like a slot machine: every press
was an equally likely draw from the whole wheel, so getting the cold one you had in mind meant
pressing until it came up.

A mood does not name colours — the swatches are for that. It names the **conditions**: which
arc of the wheel the base comes from, how loud the palette may be, how high or low it sits,
and which relationships are on the table. The rules then do exactly the work they already did,
inside that. They are lighting conditions rather than adjectives on purpose — this is a rig
that points a lamp at a wall, and "sunset" says something a room can be where "warm" only says
something a number can be.

**`earth` is the one worth reading the code for**, because the obvious implementation of it is
wrong. Rust, ochre, olive and brick are not desaturated oranges, reds and yellows — they are
*dark* ones. A tangerine at full chroma and two tenths less lightness is rust; getting there by
pulling chroma out instead gives a dusty pastel, which is the thing a cheap lamp cannot throw
and the thing this generator was rewritten to stop producing. And a lift alone could not do it,
because a lift is one number and a peak is not: seven hundredths off an orange peaking at 0.70
is rust, and the same seven hundredths off a yellow peaking at 0.95 is still lemon. `earth`
dealt limes until it was given a **ceiling**. It is also the only mood that switches off
`clarity`, because the khaki that criterion exists to catch is what this one is made of.

A mood may spend below the usual chroma floor — `ice` buys lightness with it and `earth` buys
its ochre — but nothing moves any role below the projector floor. That number is not a mood's
to argue with: a cheap lamp has no black to work against whatever light the room is meant to be
in, and a colourway nobody can see is not a quiet colourway.

**Moods are the one overlay in a scheme.** Every other map is complete; this one is keyed by
colourway name, so `merge` prunes any entry whose colourway is gone and any word this build
does not know — a file naming an unknown light is a *newer* file, not a broken one, and
refusing the whole scheme over it would cost somebody their flows. Rename carries the mood,
delete drops it, and `any` is stored by not being stored, so what is in `moods` is what
somebody actually asked for.

**Nothing about the songs is dealt.** A song entry is an override, and dealing one would be
the machine writing down an exception nobody asked for — which is exactly the noise the
cascade used to generate.

**It re-deals the colourways that are there rather than inventing new ones.** It used to take
four fresh names out of `WORDS` and drop whatever the library held, which was wrong twice
over: a scheme somebody had grown to eight came back as four, and — the part that actually
broke things — **a song pins a colourway by name**, so every pin in the scheme was orphaned by
every press of the button, with nothing said. The songs just quietly fell back to the default.
Names are a person's; what the randomiser deals is what is inside them.

**And it deals the library against itself.** Four independent deals are not a library, and
this was the second way the old generator felt random when it was not: every colourway was
excellent, and nothing stopped three of the four being excellent in the same part of the
wheel. Turning through those is a wheel that does not appear to turn — the flow changes, the
palette changes, and the wall stays roughly amber all night. So each row takes its own arc of
the wheel from an even division, spun to a random offset and shuffled among the names, and its
own relationship while there are unused ones left. Measured as the widest arc no colourway
occupies, four independent deals leave a median of 222° empty and as much as 346°; dealt
against each other the worst case is 186°.

**A pinned mood wins over the spread.** Naming a light is an instruction and the spread is only
a default — somebody who has set two rows to `ice` has said something more specific than "be
different from each other", and dragging one of them into the oranges would ignore the only
part of this they actually asked for.

**And one colourway can be dealt on its own**, from the dice beside its row in the console —
in its own mood. The button deals a whole library, which is the wrong size of gesture most of
the time: by the second evening three of the four are settled and the fourth is the one being
fished for. A per-row deal is a hand edit like dragging a swatch, so it is not written to the
scheme's `seed` — that records what the last *library* came from.

### It deals only what you leave switched on

Three chips beside the button — `colours`, `flows`, `rotation` — all on by default. By the
second evening the colourways are the part you have settled and the flows are the part you
are still fishing for, and a button that deals both is a button you stop pressing.

**Every part is dealt and only the wanted ones land.** Drawing from the generator in the same
order regardless of what is kept is what makes a seed mean one show: keeping only the colours
has to give the same colours dealing everything would have, or a seed written on a hand is
worth nothing.

Clearing "what the last one wired" means **only** that: a dealt flow carries
`randomized: true`, so a flow you built by hand survives instead of being deleted as a side
effect of a button whose whole promise is that one level of undo covers it. A file still
spelling that mark `rolled` is carried across by `merge` — it is the one field here a *later*
gesture reads, so a file keeping the old name would have every dealt flow quietly become
permanent.

**Undo covers the randomise you just did; the seed covers the one from last Tuesday.** One
level is the right number — a randomise replaces a library, so the thing you want back is
always the thing you had a moment ago. Anything older is better served by a seed, which is two
words and a number, survives a reload, and can be written on a hand.

## What is deliberately absent

**Notes.** The LOM exposes no played-note event and the bridge device is an audio effect that
never sees MIDI, so notes cost a small MIDI Effect on each track you want them from. The
meter approximates it — a track making sound moves — but it cannot tell you *which* note.
It would arrive as one more `playback` mode.

**Per-clip video assignment.** A flow can contain a `video` node pointed at the safe media
folder, but a Live clip does not select a file directly. Clip names still move the wheel; the
graph decides what that flow draws.

**More than one scheme, named and switchable.** `OPENFLOW_VISUALS_SCHEME` already points at
whichever is live, so this is mostly a picker.
