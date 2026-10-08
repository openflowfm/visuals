# visual[flow]

Read [`README.md`](README.md) first. The MilkDrop engine and the editor app that replace
the Electron app are in `engine/` and `app/`; `docs/milkdrop-engine.md` is their plan and
status.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render | any change under `engine/` |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `cargo test -p visuals-app` | the app's Rust: live actions, playlists, the Link one and changes on the beat, the compare view's approvals file and audio bytes, the live output's display choice and fit, the live effects' timing (building needs `cmake`, for Ableton Link) | any change under `app/src-tauri/` |
| `npm run typecheck` | the TypeScript (old app, server, editor page) compiles | any `.ts`/`.tsx` change |
| `npx vitest run <files>` | targeted unit tests | the tests next to what you changed; CI runs the whole suite |
| `cargo run --release -p visuals-engine --bin record -- <audio> <out.mp4> --cut <s> <preset> …` | presets drawn from an audio file into a video, frame by frame — the teaser's footage (see `teaser/README.md`) | after a change to `record.rs`: record a few seconds and look at them |
| `npm run typecheck` in `teaser/` | the teaser's Remotion edit compiles (the root typecheck doesn't reach it) | any change under `teaser/src/` |
| `cargo run --release -p visuals-engine --bin gpucheck -- [files or folders] [--sample N \| --all] [--timeout S]` | presets load and draw on the GPU: by default a fixed sample of 250 spread over the pack (about a minute); a preset stuck over 20 s ends the run naming it | the default sample locally after changes to shader translation or the renderer; `--all` (all 9,795) only when asked or before a release |
| `npm run compare -- [presets or folders] [--sample N] [--frames N] [--captures N] [--size WxH] [--refresh HZ] [--no-serve]` | each preset drawn by Butterchurn (30 preset frames a second) and by our engine (at `--refresh`, 60 by default) from the same audio, time and seeds; scored side by sides in `harness/out/compare/index.html`, approvals in `~/.openflow/visuals/compare/approvals.json` | after an engine change, to see whether it looks closer (see "The harness" in `docs/milkdrop-engine.md`); `--serve` reopens the last report |

`npm run app` runs the editor; `VISUALS_COMPARE=1` starts it in the compare view
(Butterchurn beside our engine, live, with approve / reject / note) and
`VISUALS_PRESET=<path in the pack>` on a given preset. `VISUALS_LIVE=1` starts it in live
mode, which opens the output window full screen on a display (`VISUALS_DISPLAY=<n>`
picks display `n`, from 0; otherwise the one chosen last). No dev port is fixed: it takes `PORT` or a free port from
the OS and hands it to vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a
picture of its own window, for checking it without screen access, and
`VISUALS_CAPTURE_OUTPUT=<file.png>` of the live output window (both after
`VISUALS_CAPTURE_AFTER` seconds, 8 by default). `VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'`
sends those live actions (effects, hold…) 5 s after start (`VISUALS_FX_AFTER`), to check
effects in a capture.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
