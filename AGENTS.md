# visual[flow]

Read [`README.md`](README.md) first. The product is the MilkDrop engine (`engine/`) and
the editor app (`app/`: the Tauri shell in `app/src-tauri`, its page in `app/src`);
`docs/milkdrop-engine.md` is their plan and status.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render | any change under `engine/` |
| `cargo test -p visuals-engine --bins` | the engine's bins compile and their tests (`engine/src/bin/`) pass; `--lib` doesn't build them | any change under `engine/` |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `cargo test -p visuals-app` | the app's Rust: live actions, playlists, the Link one and changes on the beat, the live output's display choice and fit, the live effects' timing (building needs `cmake`, for Ableton Link) | any change under `app/src-tauri/` |
| `cargo fmt --all --check` | the Rust is formatted (`rustfmt.toml`: width 200; `cargo fmt --all` fixes it) | any `.rs` change |
| `npm run format:check` | the editor page (`app/src`) is formatted with Prettier (`.prettierrc.json`: single quotes, width 200; `npx prettier --write app/src` fixes it) | any change under `app/src` |
| `npm run typecheck` | the editor page's TypeScript (`app/src`) and the vite and vitest configs compile | any `.ts`/`.tsx` change |
| `npx vitest run <files>` | targeted unit tests | the tests next to what you changed; CI runs them all (`npm test`) |
| `npm run app:build-ui` | the editor page builds into `dist-app/`, which the app crate needs to compile | changes to `app/src`, `app/index.html` or `vite.app.config.ts` |
| `VISUALS_HEADLESS=1 VISUALS_CAPTURE=<file.png> npm run app` (add `VISUALS_LIVE=1 VISUALS_CAPTURE_OUTPUT=<out.png>` for live mode, `VISUALS_FX=…` for effects) | the app runs and draws: pictures of the main window and the live output, with nothing shown on screen. It quits once the pictures are written, so the command ends by itself (exit 0) | after a change to the app or the page you want to see working: look at the pictures, then check with `ps` that no vite, `cargo-tauri` or `target/debug/visuals` is left |
| `cargo run --release -p visuals-engine --bin record -- <audio> <out.mp4> --cut <s> <preset> …` | presets drawn from an audio file into a video, frame by frame — the teaser's footage (see `teaser/README.md`) | after a change to `record.rs`: record a few seconds and look at them |
| `npm run typecheck` in `teaser/` | the teaser's Remotion edit compiles (the root typecheck doesn't reach it) | any change under `teaser/src/` |
| `cargo run --release -p visuals-engine --bin gpucheck -- [files or folders] [--sample N \| --all] [--timeout S]` | presets load and draw on the GPU: by default a fixed sample of 250 spread over the pack (about a minute); a preset stuck over 20 s ends the run naming it. Exit 0 when every preset drew (fall-backs to MilkDrop's default shader are reported but pass), 1 when any failed to load or draw or panicked, or on a usage error, 2 on a timeout | the default sample locally after changes to shader translation or the renderer; `--all` (all 9,795) only when asked or before a release |
| `cargo run --release -p visuals-engine --bin motion -- <presets or folders> [--hz 60,120] [--speed 0.25,1,4] [--seconds S] [--dump DIR]` | how evenly presets move from one refresh to the next: block-matched motion and frame difference per refresh, averaged by where the refresh lands in its step, as the most-changing phase over the least; `--dump` saves the pictures (see "The preset clock" in `docs/milkdrop-engine.md`) | after a change to how refreshes between steps are drawn |

`npm run app` runs the editor; `VISUALS_PRESET=<path in the pack>` starts it on a given
preset. `VISUALS_LIVE=1` starts it in live mode, which opens the output window full screen
on a display (`VISUALS_DISPLAY=<n>` picks display `n`, from 0; otherwise the one chosen
last). No dev port is fixed: it takes `PORT` or a free port from the OS and hands it to
vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a picture of its own
window, for checking it without screen access, and `VISUALS_CAPTURE_OUTPUT=<file.png>` of
the live output window (both after `VISUALS_CAPTURE_AFTER` seconds, 8 by default).
`VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'` sends those live actions (effects,
hold…) 5 s after start (`VISUALS_FX_AFTER`), to check effects in a capture.

**Agents always run the app headless** (`VISUALS_HEADLESS=1`), from the first run on: the
owner is using the screen. Headless, the app has no Dock icon or menu bar, never becomes
the active app, and draws its windows (the editor and the live output) beyond every
display; captures still show what was drawn (the presets' pictures are read from the GPU
and pasted in). With a capture it quits once the pictures are written. `npm run app` is
`app/run.sh`, which runs `cargo tauri dev` in a process group of its own and stops the
whole group (vite, `cargo-tauri`, the app) when it is stopped (SIGINT, SIGTERM, hangup)
or whatever started it goes away; still, never leave a run going, and check with `ps`
afterwards.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
