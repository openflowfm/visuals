# Storybook

Where a piece of this app's UI is looked at on its own, and where a small experiment is
kept once it has been worth running.

```sh
npm run storybook        # http://localhost:5573
npm run build:storybook  # the static site CI builds as a smoke check
```

The port is `OPENFLOW_PORT_BASE + 400`, or `OPENFLOW_STORYBOOK_PORT` outright — the
offsets the other servers use are in `@openflow/desktop/apps.ts`, and this one sits clear of
them (the UI is +300, mix is +500). `--exact-port` is on, so a collision fails loudly.

## Two kinds of story

**A component's states.** `client/**/*.stories.tsx` sits beside the component it shows —
`client/ui/Colorways.stories.tsx` next to `Colorways.tsx` — and shows it with none of the
console around it. The console mounts the colourway editor inside a page that also owns a
library, a scheme, a set and a stage, so a fault in the editor arrives wrapped in four things
that could also have caused it. A story has none of them, which is the same argument
`client/debug/GraphBench.tsx` makes for the canvas.

**An experiment.** `stories/experiments/*.stories.tsx` is a page that exists to answer a
question — what does each mood actually deal, what does the boundary look like when it
fires — and is kept because the question comes back. The first one is
[`PaletteMoods`](../stories/experiments/PaletteMoods.stories.tsx): six rows, one a mood,
each dealt from the same seeds so a column is the same draw judged under six rules. Write
the next one when a question has taken more than one throwaway page to answer; a page
worth writing twice is a page worth keeping.

What they run on is in [`stories/fixtures.ts`](../stories/fixtures.ts): a show at rest and
a show with every link up, a scheme with a dealt library in it, and a clock off the wall
with an optional kink. Dealt from fixed seeds so a story looks the same every time it
opens.

## What's on it

| group | for |
|---|---|
| **Nodes** | editable example graphs, one component section per node |
| **UI** | the colourway editor, the tag picker, the boundary |
| **Debug** | the wiring checklist in each of its states, and the beat harness on a made clock |
| **Experiments** | pages that answer a question |

## The frame

Most of the console's styling is scoped under `.console`, which is also the fixed
full-window frame. `.storybook/preview.tsx` wraps every story in that class so the rules
apply, and `.storybook/preview.css` takes the frame off it — and takes the window lock off
`app.css`, which is right for a stage and wrong for a page that scrolls. The boundary's
full-window sheet becomes a card the same way.

Storybook has its own Vite config, `.storybook/vite.config.ts`, rather than the app's: the
app's proxies a show server that is not running and regenerates the node registry on load,
and neither belongs in a page that is only drawing components. A story that needs the
registry imports `client/nodes/generated.ts` like anything else and runs `npm run nodes`
first.

## What it doesn't do

Nothing here talks to the server, the bridge or Link. A story that needs a show gets one
from the fixtures. Coverage ignores `*.stories.tsx`; `npm run typecheck` covers them and
`.storybook/`.

## Stories as tests

`npm test` has a fourth project, `visuals/stories`: `@storybook/addon-vitest` renders every
story in headless Chromium through playwright and fails if one throws. Exact answers stay in
`*.test.ts`; this is the test the console's *look* gets, and an experiment that stops
rendering fails CI rather than rotting quietly. CI installs Chromium with
`npx playwright install --with-deps chromium` before the tests.

The addon is a version ahead of its peer range — Storybook 10.6 declares vitest 3 or 4 and
this repo is on 5 — and runs fine on it. `.npmrc` sets `legacy-peer-deps` so `npm ci`
accepts the mismatch; take that line out when Storybook 11, which lists vitest 5, ships.

## Developing a node or shader

Open **Nodes** and choose a node, then an example. Each story renders a small connected
circuit through the real `CircuitEditor`, `NodePictures` and `Bench`. Controls live on the
nodes: move nodes, wire ports, change modes and inputs, or delete a node. Drag the canvas
to pan and scroll to zoom. The separate output shows the whole graph; node pictures show
each step and number nodes show scopes. Connected numeric inputs use the production evaluator.

The shared [`NodeHarness`](../stories/node-harness/NodeHarness.tsx) owns local graph state,
a seeded palette, a simulated show and one transport used by pictures, readouts and output.
Stories start frozen at two seconds and 120 BPM. **Seconds** scrubs the clock; **Animate**
and **Freeze** control time; **Tempo** changes beat speed without jumping the current beat.
**Reset example** restores the complete graph, simulation inputs and clock, and remounts
renderers to clear envelopes and scope history. Frozen time also freezes envelope decay.
Seeking changes clock position; it does not reconstruct historical envelope or scope state.

The **Track / Meter To Brightness** story supplies a local Drums track. Its meter slider and
playback checkbox emulate incoming Ableton data; the meter is held, not an automatic pulse.
No server, Link or Ableton connection is created. A locally connected show flag only prevents
the renderer replacing this explicit fixture with its usual desk stand-ins. Smoothing uses
simulation time, so animate before expecting a smoothed meter to decay after lowering it.

There are examples for every previously supported procedural kind, plus Track. Lens includes
a checker ripple, kaleidoscope and an LFO-driven ripple. Number outputs are wired through
colorway brightness; point outputs drive sampling a plasma source. These adapters are visible
nodes in the graph. Compiler and renderer errors appear with the graph output.

To add an example, export a story under `Nodes/<Node>` with an `example` containing a title,
description and circuit. Reuse [`exampleFor`](../stories/node-harness/examples.ts) for the
basic procedural case, or supply a purpose-built graph. Keep graphs small and connections
readable; use actual node controls rather than extra story-specific sliders. Asset, history
and flow-interface nodes still need purpose-built resources and reset policies.

```sh
npm run typecheck
npx vitest run --project=visuals stories/node-harness/fixture.test.ts
npx vitest run --project=visuals/stories stories/node-harness
npm run build:storybook
```

Fixture tests compile every supported mode/outlet and the modulation/track graphs. Browser
stories exercise the actual editor and production WebGL output, stable frozen frames,
parameter edits, reset, transport controls and simulated track inputs. These are behavior
checks, not cross-GPU golden screenshot comparisons.
