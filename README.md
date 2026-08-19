# visuals/

A VJ rig that reads a Live set. Its own Node server, its own browser app, its own
`node_modules` — and an ordinary client of the bridge.

```
Live ─ SessionBridge :17800 ─WS─> visuals server :17900 ─WS─> browser (WebGL2)
                                          |
                                     Ableton Link  <──── Live's Link session
```

## Where the reasoning lives

**Read the row you need, not the set.**

| doc | read it before touching | source |
|---|---|---|
| [the clock](docs/clock.md) | Link, tempo, the beat, why the browser extrapolates, the native addon | `server/link.ts`, `src/state/useShow.ts`, `tools/build-link.ts` |
| [the mapping](docs/mapping.md) | what a track means, what a scene means, how a show is derived from a set | `server/show.ts` |
| [the renderer](docs/render.md) | layers, blending, sources, effects, fill rate | `src/render/*` |
| [the harness](docs/harness.md) | working on this with no Ableton, and the Link safety rule | `tools/fake-live.ts` |

## The one idea

**A Live track is a layer. A Live scene is a column. Live's mixer is the visual mixer.**

Resolume's composition model — layers stacked bottom to top, each showing one clip, each
with a blend mode and a fader, fired in columns — is the same shape as a Session View
grid rotated. So there is no second transport, no second launcher and no second grid here:
Live already has all three, and this draws the consequence. Firing a scene in Live fires a
column of visuals because it *is* firing a column of visuals.

The corollary is that this app has almost no state of its own, which is the point.

## Running it

```sh
npm run dev:visuals      # the server: Link peer + bridge client + host, :17900
npm run dev:visuals-ui   # the renderer with HMR, :5473, proxying /ws to the server
npm run build:visuals    # the renderer into visuals/dist, which the server serves
npm run dev:fake-live    # a bridge that isn't one, for working without Ableton
```

Open `http://localhost:17900` for the built renderer, or `:5473` while working on it.
`i` toggles the panel, `f` goes fullscreen.

| | | |
|---|---|---|
| server | 17900 | `BSV_VISUALS_PORT`, `BSV_VISUALS_HOST` |
| renderer (dev) | UI + 300 | `BSV_VISUALS_UI_PORT` |
| bridge it follows | `ws://127.0.0.1:17800/ws` | `BSV_BRIDGE_WS` |
| fake bridge | 17801 | `BSV_FAKE_PORT` |

## Why it is a separate process

Two reasons, both forcing.

**Link is a native addon** compiled against a particular Node ABI, and the bridge's Node
lives *inside* Max — a Live update would break it. `tools/build-link.ts` exists because the
package needs two repairs before it compiles at all; see [the clock](docs/clock.md).

**It is meant to run on another machine**, so a GPU drawing sixty frames a second is never
on the same box as Live's audio thread. That is also why this server binds `0.0.0.0` where
the device binds `127.0.0.1` — a deliberate exposure, on a show LAN and not a hotel one.

Once it is out of the device, being an ordinary bridge client is free, and rule 5 in
[`AGENTS.md`](../AGENTS.md) already anticipated it: *"a second kind of client — a stage
display, a CLI — should cost nothing and perturb nothing."* This asks for `snapshot`
without `fresh`, never sends the device's own watches, and can connect, drop and reconnect
without the bridge noticing.

## Two things that are not built

**No override.** Every visual is derived from the set — track name picks the source, scene
role picks the effect, clip colour is the colour. There is no way to say "this cell draws
*that*" yet, and derivation came first deliberately: it is what keeps an override optional
rather than mandatory. See [the mapping](docs/mapping.md).

**No note reactivity.** The LOM has no played-note event and the bridge device is an audio
effect, so notes cost a small MIDI Effect on each track you want them from. Meters and the
beat carry the MVP; notes are the obvious next input and would arrive as one more field on
`Layer`.
