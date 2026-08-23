# The console

`src/ui/Console.tsx`, `Designer.tsx`, `SetView.tsx`. Two views over one show.

## Why two, and why these

| view | the question | the scale |
|---|---|---|
| **design** | what is worth putting on a wall | one flow |
| **set** | what turns through them, and what says otherwise | the set |

Design is the product. Everything else this app does is arrangements of what gets made
there, which is why it opens on it and why it has the whole screen. The **vocabulary** is
documented in [flows](flows.md), because it is about what a flow *is* rather than about
where anything sits; the shell it is edited in is below.

Set is the small remainder: [the wheel](wheel.md), the colourways, and the handful of songs
that want to say otherwise.

## What went, and why deleting it was the point

There used to be three views. **Coverage** drew every song against every track and asked
which cell nobody had decided about; **bind** held a four-level address and asked how far a
fix should reach, with an A/B stager so nothing landed unseen.

Both were navigation for a cascade. The cascade existed to answer how two pictures combine,
and a graph answers that — so there are no cells to be missing and no scope to choose. What
a track draws is something you wire.

**Keeping them would have meant keeping the cascade alive underneath**, which is exactly the
complexity the collapse was for. Two models coexisting is the shape where neither gets
simple, and where every new feature has to be built twice.

Three things they did that were genuinely good are worth naming, because losing them is a
real cost rather than a tidy-up:

- **The gap-finder.** Coverage's whole insight was an asymmetry: you author one song at a
  time and the failure is set-wide. There is much less to be missing now — a rig with nothing
  configured turns through everything and every track draws — so the question is smaller, but
  it is not zero.
- **The A/B.** Bind drew the live scheme and a staged one side by side on one clock, so
  nothing landed unseen. The designer's bench is honest about the flow you are editing but it
  does not show you the one you are replacing.
- **The reach readout.** "This lands on every song with a pad" was a warning worth having.
  There is nothing to warn about at the wheel, and a song pin says its own scope.

## The design page's shell

What a flow *is* belongs to [flows](flows.md). What is around it is the column you build
from and the panel you judge in.

### The node browser lists nodes, and presets sit under them

It listed the **modes** — `plasma`, `kaleido`, `sparks`, twenty-three of them flat — and
never mentioned the node they were. That was solving something real, and the replacement has
to keep solving it: browsing nineteen node kinds and then discovering that two of them
contain another twenty-three between them is how a graph editor stays unusable, and nobody
should have to know that `plasma` is a `source` with a mode set in order to find it.

What it got wrong is what it made the list *mean*. Eleven entries that are all one node,
each dropping that node with a mode already chosen, is a browser of presets wearing a
browser of things' clothes — so what lands on the canvas is a node you never picked, and the
list implies that `plasma` is a kind of node when the model is clear that it is not.

So it is Ableton's shape. **The row is the node**, the way a device is; its **presets** open
under it, a mode and the values that make that mode read. Dropping the row gives you a
default node and dropping a preset gives you a configured one. Now that an inlet can hold a
number, that second half is real: a preset is a mode *plus* a set of values, which is why
this and settable inlets are one change. `posterize` is the preset that proves it — the
middle of its one number is eight steps, which on a projector is invisible, so the preset
carries the number that makes it a poster. Most presets carry none, because the middle
is where these were tuned to sit and a preset setting everything to a half would say nothing.

**Not every list under a node is a preset list.** A `track` names a track in the set, and
that is a **target** — an instance of something that exists elsewhere, not a way of being a
node. Those stay flat, one row each, because folding "Bass meter" under a generic `track`
node is the same mistake in reverse.

**One node per row, with its signature on the right.** These were chips wrapping into a
paragraph, which fits a lot of names into a short column and gives every one of them the
same nothing to say for itself. A row has a right-hand side, and what goes there is `p → c`,
`n → n`, `→ p` — what the node takes and what it gives, in the three signals the whole model
is built on. That is the question you have *before* you drop something: whether the cord in
your hand can reach it. A browser that makes you drop a node to find out its inlets costs an
undo per question.

**Search is what pays for the folding.** Typing `spark` gives one row: `source`, open, with
`sparks` alone under it. A node's own name keeps everything under it, because "show me the
effects" is a real thing to type. And the search terms carry the *kind* as well as the mode,
so `sine wave` and `song key` still find rows that now read just `sine` and just `key`.
Anything a search turned up is drawn open — a preset found behind a closed drawer has not
been found — and the drawers you opened by hand stay as you left them when the box clears.

Presets are **built in**. A user-saved one needs somewhere in the scheme to live and a name
to be saved under, and that decision is better made once these have been used.

### Flows are not in that list, and that is the whole point

Every flow in the library used to be a row in the node browser, under `draw`, in the same
chip with the same border as `source` and `paint`. So a graph of sixteen nodes and a single
shipped shader were the same object to anyone reading the column, and the only way to find
out which you were holding was to drop it. The flow that made this undeniable was `The set`
— one `tracks` node wired to `out` — which sat two rows below the `tracks` node it
contained, offering a second door to the same picture and reading, to anyone who had not
built it, as a kind of node.

Every node editor with composites has already made and undone this. Blender keeps node
groups in their own `Group` submenu rather than among the primitives. Unreal keeps functions
in a panel of their own. TouchDesigner draws a COMP as a container and gives you a path
breadcrumb for where you are inside one. Figma marks a component instance with a badge it
never takes off. Four tools, four different products, and the same three rules: composites
get their **own branch**, a **mark follows them everywhere**, and **entering one** is a
gesture rather than a menu.

So the sidebar is **two shelves under one search box**:

| | the row is | it says | the verbs |
|---|---|---|---|
| **flows** | one flow in the library | `◈`, its name, and `9 nodes · reads the set` | **open** it to edit, `⤵` to **place** it |
| **nodes** | one kind in the vocabulary | its name and its signature | drop it, or open its presets |

The node count is the differentiator and it is a fact rather than a style: a `source` has no
answer to "how many nodes are inside", and a row that says `9 nodes` cannot be mistaken for
a primitive. `1 flow inside` is the only warning that opening one flow is opening several.

**Two verbs where a node has one.** Opening a flow and placing a flow were previously the
same click in two different lists, which is precisely how you end up asking what kind of
node `The set` is. They are now two controls on one row, and `⤵` is simply absent where it
would be refused — the model still refuses a flow that would contain itself, but a button
that exists only to produce an error message teaches the wrong thing about what nesting can
do. Same argument as the missing delete on `out`.

**One box, both shelves.** Pulling flows out of the node palette would otherwise have made
them *harder* to find than they were, which is the opposite of the point. Typing `outl`
gives the `Outline` flow; typing `spark` gives `source`, open, with `sparks` under it.

**The mark is `◈` and it is in both places.** On the shelf row and on the node's own face on
the canvas, because what a person has to tell at a glance is *composite or primitive*, and a
mark that only appears in one of the two places it matters is a mark nobody learns.

### The canvas is a way in

A `flow` node names a graph, and until now the only way to open that graph was to find its
name again in the sidebar — so the containment this entire model rests on was invisible on
the one screen that draws it. `⤢` on a flow node's face opens it, and a trail across the top
of the canvas is the way back up.

The trail is state in the page rather than in the scheme, and deliberately: it is a fact
about this visit. Reopen the same flow from the shelf tomorrow and you did not come from
anywhere, so opening from the shelf clears it while entering from a node extends it.

### The picture is the point, so it floats

Two decisions, and both came from the same complaint: the picture was the smallest thing on
a screen devoted to making pictures.

**The bench floats.** It was a fixed column on the right, and a fixed column takes its width
from the narrowest thing in it — a caption, a list of three lines — so the one thing you are
judging got 236 pixels while the graph kept the rest of the monitor. It is a panel over the
canvas now: drag it by its header, stretch it by its corner, park it where the graph is
empty. A panel costs nothing where you are not working, which a column cannot say.

Its place is in `localStorage`, not in `scheme.json`, for the reason the projector corners
are — see [the renderer](render.md). The scheme is a document you carry to the gig laptop and
everything in it is a decision about the show; where somebody parked a preview is a decision
about their screen, and it would put a diff in `git` for every nudge.

Its **shape** is yours rather than pinned to 16:9, which is honest rather than lax. Points
are centred and aspect-corrected, so a wider bench shows more of the same plane with circles
still round — exactly what a wider wall does, through exactly the same code.

**It will show one node instead.** Clicking a node's small face promotes it: the bench draws
what that node has made, at whatever size the panel is. See [flows](flows.md) for what the
picture is and why it is the same `probeAt` graph the face was already showing; what belongs
here is the two things the console has to get right about it.

The first is **saying so**. Somebody clicks a node, walks away, and comes back to a big
picture that is not what the flow draws — and the next thing that happens is a bug report
about a flow that is fine. So the header names the node, says plainly that it is one node,
and turns amber, because a reader who has stopped reading still sees a colour. A `p` or an
`n` outlet gets a clause of its own: those have no picture, so `probeAt` brings a number back
through `paint` and a point back through a `plasma` source, and what is on screen is a
**diagram** of a signal rather than a frame. On a face nobody was going to mistake one; at
600 wide they would. The node reads as chosen on the canvas too, by an `outline` rather
than a border, so lighting it cannot move the face a pixel.

The second is that promoting a face must not **change** the picture, only its size. That is
[`feed.ts`](../src/render/feed.ts)'s job and it took a rewrite to get: the faces and the
bench had been feeding their flows different uniforms in fourteen places, so clicking one
gave you a picture with a different colourway, a different set, a different key and no
shoulder — and no way to tell which of those you were looking at. They read one list now.

The third is the **cache**. The compositor keeps one compiled program per *flow id* and
swaps it — old one deleted, new one compiled — whenever that id's signature changes. So the
promoted graph is parked under one reused throwaway id, and clicking through forty nodes
leaves one probe program alive. An id per node would compile just as correctly and leak one
program each, because nothing would ever come back to delete them.

**The room is one group.** The designer already ran on [its own clock](clock.md), and that
argument does not stop at the beat: if *Ableton running* must not be a precondition for
drawing a picture, neither must a chorus being played in F# minor with the third colourway
up. Each of those is a number a node reads, each changes what a flow does, and each used to
be reachable only by waiting for a rehearsal to arrive at it. So tempo, the play button,
energy, section, colourway and key sit together under one caption, and `useRoom` hands the
compositor the `Show` they add up to.

**One switch, not one per fact.** `follow the room` is the transport's own `following`,
widened from the clock to everything beside it. A half-followed room is a state that exists
nowhere — the stage's beat under a desk's section, or the real colourway with an invented
key — so judging a flow against one teaches you nothing about either. Two switches would
also be two things to leave in the wrong position. If it ever turns out that following the
beat alone is worth having, the transport still holds the flag on its own and the split is
small; nothing has been designed to prevent it.

The section list is **the set's own `[ROLE]` names** whenever there is a set, because neither
view ever asks you to type a name. The stand-ins for a desk are alphabetical, which looks
like a mistake and is not: `sectionOf` reports where a role sits in a sorted list, so a
stand-in ordered intro-to-outro would give the number a different meaning here from the one
it has on stage.

## The set page

Three panes, and the sizes are the argument.

**The wheel** is first because it is what plays when nobody has said anything, which is the
normal case. An empty pool reads as *everything* and says so — that is the state a fresh
install is in, and reading a blank field as "draw nothing" would be a black screen for the
one thing nobody filled in. A pool's first click means "only this one" rather than "all but
this one", because turning a thing off when nothing was chosen is how you say what you want.

**Songs that say otherwise** is deliberately framed as an exception rather than a checklist.
Most songs should have nothing in it, and every entry you add is a thing that stops turning.
A song whose last field is cleared is dropped from the file entirely, because an entry left
behind would claim a decision nobody made and would keep the wheel from ever reaching it.

**Colourways** is unchanged and was always a good pane.

## It is built from `widgets`

Everything that is a control is the widget for it: `Segmented` for the tabs, `Select` for a
pick, `Toggle` for a boolean, `NumberField` for bars and pace, `Button` for an action.

The exceptions are deliberate and there are three: a **list row**, a **palette chip** and a
**node's own picture**, all of which are buttons that are not parameters — the third is a
picture you click to promote it, which reports that it happened and leaves no value behind.
`console.css` names those three selectors rather than carrying a blanket rule on `button` —
a blanket rule outranks `.wdg-toggle-body` on specificity and would quietly redraw any widget
dropped near it.
