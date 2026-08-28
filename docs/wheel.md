# The wheel

`resolve.ts`, `server/show.ts`, `server/scheme.ts`, `roll.ts`. What is on screen, and why.

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
| **Weather** | no set and no shipped picture: `polar` makes two numbers out of a position, `paint` makes a colour out of one and `hue` makes every colour out of the other |
| **Water** | refraction. A surface that displaces what you see *through* it, and the one drift here deliberately not in time |
| **Vortex** | a portal that turns rather than recedes: `zoom` on the beat pulse, so the whole spiral punches inward on every hit |
| **Gateway** | geometry happens *before* the picture — `fold` and a bare point feed two sources that never meet until the blend |
| **Outline** | the set as a diagram. `edge` keeps the outline and throws the fill away — over a grid, so there are always edges to find, and over a ghost of the same junction |
| **Poster** | flat bands, and the one flow that changes with the *music* rather than the playing: `posterize` to four steps over a wash, hue rotated by the song's key |
| **Glitch** | two lenses, a spread and two grades in a row and nothing else, over a scan pattern there is always something to break in — the busiest thing here, and the one that teaches how far a chain of small steps gets |
| **Lava** | a threshold walked slowly off `time` rather than the beat, and a cord run backwards by a negative depth |
| **Storm** | a `wave` snapped to the beat times a squared `random`, gating a contour cut out of a noise field — a strike that is rarely big and never the same size twice |
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
wave / playback ──> a ┐
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

## Rolling a library

`roll` deals a new one from a seed. It used to roll a *show* — colourways, song assignments,
section energies, per-track bindings and two circuits at once — because a show was a table of
decisions with a couple of graphs in it. A show is a library and a wheel now, so it rolls the
two things a library is made of: **flows and colourways**.

A rolled flow walks a **shape** — a structure a person might wire — and randomises what
fills each slot. A random walk over the whole vocabulary produces garbage nine times in
ten; the shape is what makes it a flow and the fill is what makes it a different one every
time. There are **five shapes** now, where one deck of judged deals showed a single shape
kept everything inside one family resemblance: the classic chain (a picture, moved about,
then worked on), a priced feature (a fractal or field carrying the frame), a hung light (a
lamp at a driven `place`, over the set or a dimmed wash), a spread finish, and a keyed flow
whose colour turns with the song's key. `video`, `flow` and `polar` stay out on purpose —
files a machine may not have, a library a deal must not assume, and an authoring tool.

Three constraints are worth stating because they are what make a rolled one read as
*something*:

- **It reaches for the set more often than not.** A rolled flow that ignored whoever is
  playing is a screensaver, and this rig is not one.
- **It wires at most one `spread`, and only over a cheap chain.** `bloom`, `smear`, `edge`
  and `shift` each read their input several times, so nesting two — or putting one over a
  fractal, field or light — multiplies the shader. A hand reaches for one knowing what it
  costs; a roll follows the rule constructively, so it can never wire the multiplication
  the compiler would refuse.
- **Colours are a harmony, not five hues**, and the harmony always contains an opposite. A
  base, one of five relationships to it, **two members taken loud** — the base and whatever
  sits furthest from it — and one kept as a **tint** so a busy frame has something to read
  edges against. Two of the five relationships used to be a spread of neighbours, and a set
  drawn out of one of those is a wall in a single colour: harmonious, and indistinguishable
  from a gel over the lamp.

  **Saturated is not the same as bright, and confusing the two is what made these pastel.**
  The old range topped out at 70% lightness, where a hue has given away most of itself
  whatever its saturation says. The new one sits where a colour is loudest — and is then
  **evened out by hue**, because a yellow and a blue at the same lightness are not the same
  brightness at all, and the ones that vanish on a cheap lamp are always the blues. What the
  projector argument actually asks for is *not dark*; it never asked for pale.

**Nothing about the songs is rolled.** A song entry is an override, and rolling one would be
the machine writing down an exception nobody asked for — which is exactly the noise the
cascade used to generate.

### It deals only what you leave switched on

Three chips beside the button — `colours`, `flows`, `rotation` — all on by default. By the
second evening the colourways are the part you have settled and the flows are the part you
are still fishing for, and a button that deals both is a button you stop pressing.

**Every part is rolled and only the wanted ones land.** Drawing from the generator in the same
order regardless of what is kept is what makes a seed mean one show: keeping only the colours
has to give the same colours rolling everything would have, or a seed written on a hand is
worth nothing.

Clearing "what the last roll wired" means **only** that: a rolled flow carries `rolled: true`,
so a flow you built by hand survives instead of being deleted as a side effect of a button
whose whole promise is that one level of undo covers it.

**Undo covers the roll you just did; the seed covers the one from last Tuesday.** One level is
the right number — a roll replaces a library, so the thing you want back is always the thing
you had a moment ago. Anything older is better served by a seed, which is two words and a
number, survives a reload, and can be written on a hand.

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
