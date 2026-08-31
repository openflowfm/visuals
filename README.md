# visual[flow]

The visuals module of **open[flow]**. A VJ rig that reads a Live set: its own Node server,
its own browser app, its own `node_modules` — and an ordinary client of the bridge.

The directory is still `visuals/`, because a name is a thing you read and an import path
is a thing that breaks; the package is `@openflow/visuals`. `visual[flow]` is what the app
calls itself; the paths are what the compiler calls it.

```
Live ─ SessionBridge :17800 ─WS─> visuals backend :17900 ─WS─> Electron (WebGL2)
                                          |
                                     Ableton Link  <──── Live's Link session
```

## Where the reasoning lives

**Read the row you need, not the set.**

| doc | read it before touching | source |
|---|---|---|
| [the clock](docs/clock.md) | Link, tempo, the beat, why the browser extrapolates, the native addon | `server/link.ts`, `client/state/useShow.ts`, `tools/build-link.ts` |
| [flows](docs/flows.md) | **the one noun**, the node vocabulary, the compiler, the designer | `protocol.ts`, `client/render/circuit.ts`, `client/ui/Designer.tsx` |
| [the wheel](docs/wheel.md) | what is on screen and why, song overrides, the scheme file, the randomiser | `resolve.ts`, `server/show.ts`, `server/scheme.ts`, `randomize.ts` |
| [the console](docs/console.md) | the four product views, and what the views before them were for | `client/ui/Console.tsx`, `Designer.tsx`, `TrainView.tsx`, `ReviewsView.tsx`, `SetView.tsx` |
| [the lab](docs/lab.md) | the lineage forest, exploring roots, developing a node, frozen editions and the detailed corpus | `lab.ts`, `server/lab.ts`, `server/lineage.ts`, `server/batch.ts`, `server/finals.ts`, `client/ui/TrainView.tsx`, `client/ui/ForestView.tsx`, `client/ui/ExploreView.tsx`, `client/ui/DevelopView.tsx`, `client/ui/FinalsView.tsx`, `client/ui/ReviewsView.tsx` |
| [parameter calibration](docs/calibration.md) | the development-only A/B/C response bench and its evidence | `response.ts`, `calibration.ts`, `server/calibration.ts`, `client/ui/CalibrationView.tsx` |
| [the renderer](docs/render.md) | the two passes, blending, fill rate, **pointing a projector** | `client/render/*` |
| [the engine](docs/engine.md) | where the frame time goes, the meter, the benchmark, why particles need no rewrite | `client/render/meter.ts`, `bench.ts`, `../tools/benchmark.ts` |
| [the harness](docs/harness.md) | working on this with no Ableton, and the Link safety rule | `tools/fake-live.ts` |
| [the desktop app](docs/desktop.md) | the window, the wall on a projector, the display list, why the server is a child process | `electron/main.ts`, `electron/preload.ts`, `client/state/useWall.ts` |
| [agent authoring](docs/mcp.md) | the MCP tools for reading nodes, validating and saving flows, and reviewing node designs | `mcp/*` |

## The one idea

**Everything is one graph, and that graph is a flow.**

A flow has one output — a frame — and everything that goes into it is a node: the pictures
that ship, the effects that work on them, the meters, the song, the Live set's own layer
mix, and *other flows*. There is no stack, no cascade, no per-track binding and no clip
exception, because each of those was a different answer to "how do two pictures combine"
and a graph answers it once.

The Live set is in there as a node. `tracks` draws every playing track and mixes them down,
so firing a scene still changes the picture with nothing authored — which is what keeps this
a rig that reads a set rather than a screensaver. Everything else about it is wired.

Above the graph there is one thing, and it is deliberately tiny: a **wheel** that turns
through the flows and colourways you have made, on musical time. Nothing has to be
configured for it to draw a show.

## Running it

```sh
npm run visuals          # a show night: build, run the server, open the app — see docs/desktop.md
npm run visuals:browser  # the same, in a dedicated Chrome instead of the app
npm run benchmark        # every flow, as fast as this machine draws it — docs/engine.md
npm run dev              # everything, opening the app on vite HMR; its backend stays local
npm run dev:visuals      # the server alone: Link peer + bridge client + host, :17900
npm run dev:visuals-ui   # the renderer with HMR, :5473, proxying /ws to the server
npm run dev:visuals-app  # the HMR app + its backend, when vite is already running
npm run build:visuals    # the renderer into visuals/dist, which the server serves
npm run dev:fake-live    # a bridge that isn't one, for working without Ableton
npm --prefix visuals run mcp  # local stdio server for agent-authored flows and nodes
```

`npm run dev` opens the Electron window itself; `:5473` is the HMR page it loads. Open
`http://localhost:17900` only for the built browser renderer.

`npm run dev` runs vite alongside the bridge and `set/`, then launches the real visuals
Electron shell. The shell supervises its own backend exactly as it does in production;
vite proxies `/ws` and `/media` to that local child. The stack uses `concurrently -k`, so a
port already in use takes the whole dev session down with it — if it dies on startup, look
for a visuals app or standalone `dev:visuals` you left running.

**That `-k` is why `npm run visuals` exists.** Ten dev processes where any one exiting kills
the other nine is right for a dev loop and wrong for a gig: a watcher falling over would
take the wall with it. It builds `dist/`, runs the server as a supervised child, and opens
the rig in a window of its own — see [the desktop app](docs/desktop.md). It also settles
which URL a projector gets: the app is on the built bundle, where `:5473` has HMR attached
and reloads the wall on every save.

`npm run visuals:browser` is the same rig in a dedicated Chrome instance instead —
[`tools/visuals.ts`](../tools/visuals.ts) — kept because a second machine runs a browser
anyway, and because it is the rollback if the app misbehaves on a show night.
`i` toggles the panel, `e` the editor, `k` the output stage, `w` the wall, `f` fullscreen, and
`l` turns to the next flow without changing the colourway. **`1` says
"here is the one"** — it re-phases the rotation so changes land on the top of a phrase
without changing what is on screen. Live's transport starting does the same thing by itself,
and so does a scene launched somewhere the phrase grid does not already have a line — a set
that is locked in keeps counting undisturbed. The key is for the rest. See
[the wheel](docs/wheel.md).

**`w` sends the picture to the projector.** There is no such thing as rendering to an HDMI
port — the port is a display, and something has to own a window on it — so this opens one for
you: chrome-less, fullscreen, on the display you pick, remembered for next time. The browser
you are working in stays the console, and the two ends keep the keystone and the test grid in
step between them. See [the renderer](docs/render.md).

**`k` opens the output stage** — corner pinning and master brightness. Drag the four corners
until the test grid is square *on the wall*; that corrects an angled throw in a way two
keystone sliders cannot. Both are kept in the browser's storage rather than in `scheme.json`,
because they describe this projector in this room and would be wrong everywhere else. See
[the renderer](docs/render.md).

| | | |
|---|---|---|
| app backend | 17900, loopback | `OPENFLOW_VISUALS_PORT`, `OPENFLOW_VISUALS_HOST` |
| renderer (dev) | UI + 300 | `OPENFLOW_VISUALS_UI_PORT` |
| bridge it follows | `ws://127.0.0.1:17800/ws` | `OPENFLOW_BRIDGE_WS` |
| fake bridge | 17801 | `OPENFLOW_FAKE_PORT` |

## Why it is a separate process

Two reasons, both forcing.

**Link is a native addon** compiled against a particular Node ABI, and the bridge's Node
lives *inside* Max — a Live update would break it. `tools/build-link.ts` exists because the
package needs two repairs before it compiles at all; see [the clock](docs/clock.md).

**It is meant to run on another machine**, so a GPU drawing sixty frames a second is never
on the same box as Live's audio thread. A standalone browser server therefore binds
`0.0.0.0` — a deliberate exposure, on a show LAN and not a hotel one. The Electron app's
child binds `127.0.0.1` instead because both of its windows are already local; an explicit
`OPENFLOW_VISUALS_HOST` can still opt it into the LAN.

Once it is out of the device, being an ordinary bridge client is free, and rule 5 in
[`AGENTS.md`](../AGENTS.md) already anticipated it: *"a second kind of client — a stage
display, a CLI — should cost nothing and perturb nothing."* This asks for `snapshot`
without `fresh`, never sends the device's own watches, and can connect, drop and reconnect
without the bridge noticing.

## Customising it

Press **`e`** in the app for the console, over the picture so you can work on a flow while
one is on screen. Four product views:

| view | the question | the scale |
|---|---|---|
| **build** | what is worth putting on a wall | one flow |
| **train** | what is worth developing, and what developing it produced | one lineage forest |
| **review** | what did a slower, detailed judgment say | the preserved corpus |
| **set** | what turns through them, and what says otherwise | the set |

**Build is the product.** A canvas, a library of the flows you have made, and a browser of
every node there is — the node is the row and its presets open under it, the way a device
browser lists one, with a search box that reaches inside. It runs on its own clock and needs
no bridge, no set and no Link: a library you can only see during a rehearsal is a library
nobody builds.

**Set is what is left above the graph.** The wheel that turns through your flows and
colourways, and the handful of songs that want to pin one instead. Most songs should have
nothing there.

**Train grows a body of work, and the record of how it got there.** Its home is the
**forest**: the lineages down the left listed by their root, one family at a time on a
pannable canvas growing downward, and the selected work on the right. Bookmarks and batch
counts ride on every node, so the thing you can see at a glance is which ideas somebody
liked and never developed.

**Explore** stages one fresh root at a time and asks only whether there is anything there —
yes, no, or skip. Nothing is compared, because what is being decided is absolute, and one at
a time means every sampled root reaches you instead of one in six. **Develop** is where
comparison belongs: choose a node, ask for a batch, and its children — some one-step, some
larger leaps — run against each other *and against their parent* under one room. The parent
being in its own field is what lets the answer be "nothing here beat it". **Editions** freezes
a collection out of what accumulated and tests every nominee across four different rooms,
producing a derived top-ten. Completed runs stay durable and another edition can follow.

Nothing schedules anything: the map is the document and the modes are places you go from it.
It needs no Ableton, Link or bridge, and copying one work or a whole collection uses the
ordinary edit-and-save path.

**Review preserves the detailed corpus.** The earlier anchored scores, tags, signed reasons
and notes are still browsable and revisable there. Binary selections do not manufacture
those labels. See [the lab](docs/lab.md).

An internal **calibrate** view appears only when the server is started with
`OPENFLOW_CALIBRATION=1`. It compares parameter-response curves and writes to a separate
development database; it is not part of the user-facing lab. See
[parameter calibration](docs/calibration.md).

Every name either view offers — songs, tracks, flows — comes from **the set** or from what
you made, so it never asks you to type one.

Schemes are saved in `~/.openflow/visuals/schemes/`, one readable file per scheme. A new
library starts with an editable `main` copied from the complete system **Examples** scheme;
Examples stays on the shelf, read-only, so newer examples never appear unexpectedly inside
a show you own. Edit a saved file by hand if you like — the open one is watched, and a clean
reload reaches the screen.

**An edit is not a save.** Every gesture follows the pointer onto every screen, but nothing
reaches disk until you press save (or `⌘S`). The console's header names the open scheme,
marks unsaved edits, and opens the shelf: save, save under a new name, or load another —
loading asks before it drops unsaved work. A restart reopens the scheme you were in.

**Every user scheme is yours.** The library lives under `~/.openflow` (`OPENFLOW_HOME` moves
that root; `OPENFLOW_VISUALS_SCHEME` pins one exact file and turns the library off), a scheme
from before the library is adopted as `main` on first start, and a fresh machine receives a
real `main.json` copied from Examples. Flow and colourway maps are complete rather than
overlays, so deleting one stays deleted. See [the wheel](docs/wheel.md).

Everything that draws is a **flow**, and a flow is a **graph** — see [flows](docs/flows.md).
The lightweight pictures, the bounded fractals and the effects that ship are node *modes*,
so nothing in the model knows their individual names except the node that draws them, and
one flow can hold them wired however you like.

Put images or video files in `~/.openflow/visuals/media/` (or set
`OPENFLOW_VISUALS_MEDIA`) and the matching node will offer their relative paths. `image`
has aspect-correct cover and contain framing and uploads a selected still once; `video` has
looping and one-shot modes, always mutes embedded audio, and keeps at most two reachable
decoders alive per flattened flow.

The trick that makes that possible is that **a colour is a function of a point**, not a
value in a buffer: `kaleido` asks its input for the colour at a folded point and the input
re-evaluates itself there, so a whole flow compiles to one fragment shader with no render
targets at all. `tracks` is the one extra render pass because it draws once per playing Live
track; `image` and `video` are bounded texture inputs sampled by that same flow shader.

What is on screen is [the wheel](docs/wheel.md): a rotation through your flows and
colourways, advancing every N bars and when somebody launches a clip out of band. A song may
pin either instead. That is the whole of the model above the graph.

## What is not built

**Clip colour is not an input, on purpose.** Those colours are navigation — how you find
your place in the grid during a show — and driving the picture from them would force a
choice between a set you can read and a set that looks right.

**No note reactivity.** The LOM has no played-note event and the bridge device is an audio
effect, so notes cost a small MIDI Effect on each track you want them from. Meters and the
beat carry it for now; a note would arrive as one more `playback` mode and nothing else would
have to change.

**One track's picture as another's input.** A flow reaches a track's *meter* and not its
*frame*. That needs a render target per track, which the renderer does not keep.
