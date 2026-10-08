# visual[flow]

Read [`README.md`](README.md) first. The MilkDrop engine and the editor app that replace
the Electron app are in `engine/` and `app/`; `docs/milkdrop-engine.md` is their plan and
status.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render | any change under `engine/` |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `cargo test -p visuals-app` | the app's Rust: live actions, playlists, the Link one and changes on the beat, the live output's display choice and fit, the live effects' timing (building needs `cmake`, for Ableton Link) | any change under `app/src-tauri/` |
| `npm run typecheck` | the TypeScript (old app, server, editor page) compiles | any `.ts`/`.tsx` change |
| `npx vitest run <files>` | targeted unit tests | the tests next to what you changed; CI runs the whole suite |
| `cargo run --release -p visuals-engine --bin record -- <audio> <out.mp4> --cut <s> <preset> …` | presets drawn from an audio file into a video, frame by frame — the teaser's footage (see `teaser/README.md`) | after a change to `record.rs`: record a few seconds and look at them |
| `npm run typecheck` in `teaser/` | the teaser's Remotion edit compiles (the root typecheck doesn't reach it) | any change under `teaser/src/` |
| `cargo run --release -p visuals-engine --bin gpucheck -- [files or folders] [--sample N \| --all] [--timeout S]` | presets load and draw on the GPU: by default a fixed sample of 250 spread over the pack (about a minute); a preset stuck over 20 s ends the run naming it. Exit 0 when every preset drew (fall-backs to MilkDrop's default shader are reported but pass), 1 when any failed to load or draw or panicked, or on a usage error, 2 on a timeout | the default sample locally after changes to shader translation or the renderer; `--all` (all 9,795) only when asked or before a release |
| `cargo run --release -p visuals-engine --bin motion -- <presets or folders> [--hz 60,120] [--speed 0.25,1,4] [--seconds S] [--dump DIR]` | how evenly presets move from one refresh to the next: block-matched motion and frame difference per refresh, averaged by where the refresh lands in its step, as the most-changing phase over the least; `--dump` saves the pictures (see "The preset clock" in `docs/milkdrop-engine.md`) | after a change to how refreshes between steps are drawn |

`npm run app` runs the editor; `VISUALS_PRESET=<path in the pack>` starts it on a given
preset. `VISUALS_LIVE=1` starts it in live
mode, which opens the output window full screen on a display (`VISUALS_DISPLAY=<n>`
picks display `n`, from 0; otherwise the one chosen last). No dev port is fixed: it takes `PORT` or a free port from
the OS and hands it to vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a
picture of its own window, for checking it without screen access, and
`VISUALS_CAPTURE_OUTPUT=<file.png>` of the live output window (both after
`VISUALS_CAPTURE_AFTER` seconds, 8 by default). `VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'`
sends those live actions (effects, hold…) 5 s after start (`VISUALS_FX_AFTER`), to check
effects in a capture.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
