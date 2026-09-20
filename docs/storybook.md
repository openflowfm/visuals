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

Open **Debug / Node Harness**. It renders through the same `Bench` and compositor as the
console, without a server, media library or Link connection. Choose a node, its mode and
an outlet; the numeric controls come from `inletsOf`, including mode-specific inlets and
toggles. Unset live inlets retain their renderer fallback until you move the slider.
The row's reset restores that fallback rather than writing a guessed default.

Colour inputs receive checker and plasma fixtures so distortions and blends have visible
structure. Point inputs retain the renderer's position fallback. `probeAt` displays colour
outputs directly, numbers through colorway brightness, and points through a plasma source;
the harness labels these projections. Expand **Fixture circuit** to inspect the exact graph.

Stories start frozen at two seconds with a seeded palette and 120 BPM. Set **Seconds** to
scrub, **Animate** to run, and **Freeze** to retain the current time. **Reset** restores two
seconds and the selected node/mode's input defaults, and recreates the compositor to clear
GPU state. Renderer and compiler errors appear below the picture, including missing WebGL2.
This freezes beat and elapsed time; it is not a general simulation-step controller. History,
Live, media, model and flow-interface nodes are deliberately unsupported until they have
purpose-built fixtures. The selector only offers the supported procedural subset.

To develop a new mode of a supported kind, update the production descriptor/compiler and
run `npm run nodes` if the registry changed. Modes and controls appear automatically. For a
new kind, add a fixture in [`stories/node-harness/fixture.ts`](../stories/node-harness/fixture.ts),
review its input and time semantics, then add it to `SUPPORTED` and a representative story.
Do not add another shader renderer. Asset or stateful nodes need an explicit fixture and
reset policy before adding them to the list.

```sh
npm run typecheck
npx vitest run --project=visuals stories/node-harness/fixture.test.ts
npx vitest run --project=visuals/stories stories/node-harness/NodeHarness.stories.tsx
npm run build:storybook
```

The unit test compiles every supported mode/outlet and checks that fixtures need no external
assets or track bindings. Story interactions check mode/outlet selection, transport and
unsupported-state recovery. The lens story reads actual WebGL pixels to verify that a frozen
frame is stable, a depth change changes it, and resetting the inlet restores it. This is a
behavior check, not a cross-GPU golden screenshot comparison.
