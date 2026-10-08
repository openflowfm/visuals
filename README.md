# visual[flow]

The visuals module of **open[flow]**: a native MilkDrop engine and the macOS app built on
it. The engine (`engine/`, Rust on wgpu — Metal on a Mac) reads `.milk` presets and draws
them from any Core Audio input; the app (`app/`, Tauri) is an editor for them, with
playlists, live effects, a full-screen output window and an Ableton Link peer that changes
presets on the bar.

```
Core Audio input ──> engine (wgpu/Metal) ──> bench and output window
                         ^
Ableton Link ──> the app (Tauri) <──> editor page (React, app/src)
```

The package is `@openflow/visuals`; `visual[flow]` is what the app calls itself.

## Running it

macOS, with Node (see `.nvmrc`), Rust, the Tauri CLI (`cargo install tauri-cli`) and
`cmake` (Ableton Link is built from source).

```sh
git clone https://github.com/openflowfm/visuals.git
cd visuals
npm ci
npm run app     # cargo tauri dev in app/src-tauri, the page's vite on $PORT or a free port
```

Presets are read from `~/.openflow/visuals/presets` (`OPENFLOW_VISUALS_PRESETS`
overrides), playlists kept in `~/.openflow/visuals/playlists.json`
(`OPENFLOW_VISUALS_PLAYLISTS` overrides).

| variable | what it does |
|---|---|
| `VISUALS_PRESET=<path in the pack>` | start on that preset |
| `VISUALS_LIVE=1` | start in live mode: the output window full screen on a display |
| `VISUALS_DISPLAY=<n>` | the display for the output window, from 0 (otherwise the one chosen last) |
| `VISUALS_LINK=0` | start with Link off |
| `VISUALS_LINK_EVERY=<bars>` | start with preset changes on the bar on, every that many bars |
| `VISUALS_LINK_LOG=1` | print Link's frame every second, and each change's beat |
| `VISUALS_CAPTURE=<file.png>`, `VISUALS_CAPTURE_OUTPUT=<file.png>` | save a picture of the main window, or of the output window, after `VISUALS_CAPTURE_AFTER` seconds (8 by default) |
| `VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'` | send those live actions `VISUALS_FX_AFTER` seconds (5 by default) after start |
| `PORT` | the page's dev port; otherwise a free one |

**Link: visuals follow, they never drive.** The app joins the network's Link session and
only reads it — tempo, beat and transport are never set from here. Bars are counted from
*the one*, a beat the app holds, and preset changes land exactly on the bar line.

The engine also runs on its own, without the app: `cargo run --release -p visuals-engine
--bin play -- <folder>` plays a library in a window, and `snapshot`, `check`, `gpucheck`,
`explain` and `record` are the other tools (see `docs/milkdrop-engine.md`).

## Tests and checks

[`AGENTS.md`](AGENTS.md) lists every command and when to run it. In short:
`npm run typecheck`, `npm test` (the editor page's unit tests), `npm run app:build-ui`,
`cargo test -p visuals-engine --lib` and `cargo test -p visuals-app`.

## Releases

`.github/workflows/release.yml` builds the Tauri app signed and notarised on macOS. A `v*`
tag matching `app/src-tauri/tauri.conf.json`'s version opens a draft release with the
disk image; running the workflow by hand on any branch builds the same image as a build
artifact, without a release. Every day that `main` has moved, it also replaces the
[nightly](https://github.com/openflowfm/visuals/releases/download/nightly/visual-flow-nightly_aarch64.dmg)
— a signed prerelease straight from `main`, always at that link. It needs the signing
secrets listed at the top of the file.

## Where the reasoning lives

[`docs/milkdrop-engine.md`](docs/milkdrop-engine.md): the engine's plan and status, the
editor app, playlists and live actions, Link and the one, the live output, performance,
and what can't match Butterchurn. [`docs/design/flow-outlet/intent.md`](docs/design/flow-outlet/intent.md)
records the product intent for the graph editor. [`teaser/README.md`](teaser/README.md)
is the teaser, cut from the engine's own footage.

The old visual[flow] — a Node server, a WebGL2 renderer, its MCP server, stories and
tools — is deleted; the last commit with it is `3bcc202`.
