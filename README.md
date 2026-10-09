# visual[flow]

The visuals module of **open[flow]**: a MilkDrop player for the Mac. Open it, let it hear
your music, pick something to play. It draws MilkDrop presets natively on Metal, listens
straight to your DAW (or the whole Mac, or an interface), and keeps time with Ableton Link,
changing presets on the bar. A full-screen output sends the picture to a projector or a
second display.

It's a player, not an editor: the preset editor lives on in this repo as a lab build for
development (see [For developers](#for-developers)).

```
your DAW, the Mac or an input ──> engine (wgpu on Metal) ──> the window and the output
                                      ^
Ableton Link ──> the app (Tauri) <──> its page (React, app/src)
```

## Getting started

### Download

visual[flow] is a signed, notarised disk image for Macs with Apple silicon. There's no
stable release yet (1.0 is planned; see [the plan](docs/milkdrop-engine.md#the-plan-03-to-10)).
Until then, the
[nightly](https://github.com/openflowfm/visuals/releases/download/nightly/visual-flow-nightly_aarch64.dmg)
is built from `main` every day it changes. Open the DMG and drag visual[flow] to
Applications.

It updates itself: it checks on launch, and **visual[flow] › Check for Updates…** checks
now. Nothing installs until you say so.

### First run

The first time it opens, a short welcome walks through:

1. **Listen to:** what the visuals hear, with a test beat to see them move without music.
2. **Keep in time with Ableton:** shown when a Link session is on the network; choose how
   often the preset changes on the bar.
3. **The full library:** the app comes with 250 presets; the full Cream of the Crop pack
   (9,795) is one download (about 11 MB) that carries on while you play. Later is fine:
   the library offers it too.
4. **Flashing lights:** a photosensitivity warning.
5. **Pick a vibe:** a playlist, or something at random, and it plays.

**visual[flow] › Welcome…** runs it again. **visual[flow] › Credits** lists who made the
presets (see [`docs/pack.md`](docs/pack.md) for the pack, its credits and takedowns).

### Listen to your DAW

On macOS 14.4 and later, visual[flow] hears your DAW directly: no driver, no loopback
device, no change to your audio settings. Choose Ableton Live, Logic Pro, Bitwig Studio or
any other running music app, **everything on this Mac**, or a mic or interface. macOS asks
once for permission to hear other apps (System Settings › Privacy & Security › Screen &
System Audio Recording).

[`docs/connect-your-daw.md`](docs/connect-your-daw.md) is the full guide: each DAW, the
permission, Link, BlackHole for older macOS, and what to do when the meter doesn't move.

### Link

The app joins your Ableton Link session and **only follows it**: tempo, beat and transport
are never set from here. It can change the preset every beat, every 2 beats, or every 1 to
32 bars, landing exactly on the bar line. Bars count from *the one*, which you can set,
nudge or reset in live mode's Link panel.

### Live mode

Live mode is the show: the output full screen on a display of your choice (remembered for
next time), performance effects (strobe, blackout, punch, freeze, mirror, speed, trails…)
with keys, playlists that move on by themselves, and **stay on this one** to hold a
preset. Esc or ⌘⇧L
leaves it.

## For developers

### Running it

macOS, with Node (see `.nvmrc`), Rust, the Tauri CLI (`cargo install tauri-cli`) and
`cmake` (Ableton Link is built from source).

```sh
git clone https://github.com/openflowfm/visuals.git
cd visuals
npm ci
npm run app      # the player: app/run.sh runs cargo tauri dev, with the page's vite on $PORT or a free port
npm run app:lab  # the lab build: the same with the preset editor
```

The lab build adds the editor: the preset as MilkDrop's stage graph, each stage's picture,
its EEL or HLSL and numbers, and every edit reloading the preset as it plays. It's the
`lab` Cargo feature on `visuals-app` (its commands) and `VITE_LAB=1` for the page
(`npm run app:build-ui:lab` builds that page). It's a tool for working on the engine, not
part of the app people download.

`app/run.sh` runs `cargo tauri dev` (and with it vite and the app) in a process group of
its own, and stops the whole group when it is stopped (Ctrl-C, SIGTERM, hangup) or
whatever started it goes away, so nothing is left running.

### Where things are kept

Everything lives in `~/.openflow/visuals`: the presets folder (`presets/`, where the full
library downloads), the playlists (`playlists.json`), your library data (`library.json`),
and the small files the app remembers its choices in (the audio source, the output
display, the tempo, whether the welcome has run). The 250 starter presets are bundled
inside the app. The variables below move each of these; `OPENFLOW_HOME` moves the
library data and the small files, not the presets or the playlists.

### Environment variables

| variable | what it does |
|---|---|
| `VISUALS_PRESET=<path>` | start on that preset: absolute, or a path in the pack |
| `VISUALS_LIVE=1` | start in live mode: the output window full screen on a display |
| `VISUALS_DISPLAY=<n>` | the display for the output window, from 0 (otherwise the one chosen last) |
| `VISUALS_LINK=0` | start with Link off |
| `VISUALS_LINK_EVERY=<bars>` | start with preset changes on the bar on, every that many bars |
| `VISUALS_LINK_LOG=1` | print Link's frame every second, and each change's beat |
| `VISUALS_HEADLESS=1` | keep off the screen: no Dock icon or menu bar, never the active app, and the windows (main and output) drawn beyond every display; with a capture, quit once it is written |
| `VISUALS_CAPTURE=<file.png>`, `VISUALS_CAPTURE_OUTPUT=<file.png>` | save a picture of the main window, or of the output window, after `VISUALS_CAPTURE_AFTER` seconds (8 by default) |
| `VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'` | send those live actions `VISUALS_FX_AFTER` seconds (5 by default) after start |
| `OPENFLOW_HOME=<dir>` | keep the library data and the remembered choices in `<dir>/visuals` instead of `~/.openflow/visuals` |
| `OPENFLOW_VISUALS_PRESETS=<dir>` | the presets folder (also read by the engine's bins) |
| `OPENFLOW_VISUALS_PLAYLISTS=<file>` | the playlists file |
| `OPENFLOW_VISUALS_LIBRARY=<file>` | the library data file (stars, tags, hidden presets) |
| `PORT` | the page's dev port; otherwise a free one |

At build time, `VISUALS_CHANNEL=nightly` makes the updater follow the nightly instead of
tagged releases, and `VISUALS_BUILD=<n>` is the nightly's build number; `release.yml` sets
both.

### The engine on its own

The engine runs without the app: `cargo run --release -p visuals-engine --bin play --
<folder>` plays a library in a window, and `snapshot`, `check`, `gpucheck`, `explain`,
`record`, `motion`, `stages` and `index` are the other tools (see
[`docs/milkdrop-engine.md`](docs/milkdrop-engine.md) and [`AGENTS.md`](AGENTS.md)).

### Tests and checks

[`AGENTS.md`](AGENTS.md) lists every command and when to run it. In short:
`npm run typecheck`, `npm test` (the page's unit tests), `npm run format:check`,
`npm run app:build-ui` (and `app:build-ui:lab`), `cargo test -p visuals-engine --lib`,
`cargo test -p visuals-app`, `cargo build -p visuals-app --features lab` and
`cargo fmt --all --check`.

### Releases

`.github/workflows/release.yml` builds the Tauri app signed and notarised on macOS. A `v*`
tag matching `app/src-tauri/tauri.conf.json`'s version opens a draft release with the
disk image and the update bundle; running the workflow by hand on any branch builds the
same image as a build artifact, without a release. Every day that `main` has moved, it
also replaces the
[nightly](https://github.com/openflowfm/visuals/releases/download/nightly/visual-flow-nightly_aarch64.dmg),
a signed prerelease straight from `main`, always at that link. It needs the signing
secrets listed at the top of the file.

## Where the reasoning lives

- [`docs/milkdrop-engine.md`](docs/milkdrop-engine.md): the plan from 0.3 to 1.0 and
  where it stands, then the engine's reference: the app's playlists, live actions and
  effects, Link and the one, the live output, the preset clock, the preset index,
  performance, and what can't match Butterchurn.
- [`docs/connect-your-daw.md`](docs/connect-your-daw.md): the user guide to hearing your
  DAW and keeping time with Link.
- [`docs/pack.md`](docs/pack.md): the preset pack, its credits and takedowns.
- [`docs/design/flow-outlet/intent.md`](docs/design/flow-outlet/intent.md): the product
  intent recorded for the graph editor, now the lab's.
- [`teaser/README.md`](teaser/README.md): the teaser, cut from the engine's own footage.

The old visual[flow] (a Node server, a WebGL2 renderer, its MCP server, stories and
tools) is deleted; the last commit with it is `3bcc202`.
