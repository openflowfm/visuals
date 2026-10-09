# visual[flow]

Read [`README.md`](README.md) first. The product is the MilkDrop engine (`engine/`) and
the player app (`app/`: the Tauri shell in `app/src-tauri`, its page in `app/src`);
`docs/milkdrop-engine.md` is their plan and status. The preset editor is in **lab** builds
only: the `lab` Cargo feature on `visuals-app` (its commands, `app/src-tauri/src/editor.rs`)
and `VITE_LAB=1` for the page (`app/src/Lab.tsx`, `editor.ts`, the graph and the inspector).
The app people get is built without both.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render | any change under `engine/` |
| `cargo test -p visuals-engine --bins` | the engine's bins compile and their tests (`engine/src/bin/`) pass; `--lib` doesn't build them | any change under `engine/` |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `cargo test -p visuals-app` | the app's Rust: live actions, playlists, the Link one and changes on the beat, the live output's display choice and fit, the live effects' timing, the first-run state (building needs `cmake`, for Ableton Link) | any change under `app/src-tauri/` |
| `cargo build -p visuals-app --features lab` | the lab app (with the editor's commands) compiles | any change under `app/src-tauri/` |
| `cargo fmt --all --check` | the Rust is formatted (`rustfmt.toml`: width 200; `cargo fmt --all` fixes it) | any `.rs` change |
| `npm run format:check` | the editor page (`app/src`) is formatted with Prettier (`.prettierrc.json`: single quotes, width 200; `npx prettier --write app/src` fixes it) | any change under `app/src` |
| `npm run typecheck` | the editor page's TypeScript (`app/src`) and the vite and vitest configs compile | any `.ts`/`.tsx` change |
| `npx vitest run <files>` | targeted unit tests | the tests next to what you changed; CI runs them all (`npm test`) |
| `npm run app:build-ui` | the app's page builds into `dist-app/`, which the app crate needs to compile; it must have no `Lab-*` chunk and no editor command (CI checks) | changes to `app/src`, `app/index.html` or `vite.app.config.ts` |
| `npm run app:build-ui:lab` | the lab page (with the editor, as its own `Lab-*` chunk) builds into `dist-app/` | changes to `app/src`, `app/index.html` or `vite.app.config.ts`; run it before `app:build-ui`, which leaves the app's page in `dist-app/` |
| `VISUALS_HEADLESS=1 VISUALS_CAPTURE=<file.png> npm run app` (add `VISUALS_LIVE=1 VISUALS_CAPTURE_OUTPUT=<out.png>` for live mode, `VISUALS_FX=…` for effects) | the app runs and draws: pictures of the main window and the live output, with nothing shown on screen. It quits once the pictures are written, so the command ends by itself (exit 0) | after a change to the app or the page you want to see working: look at the pictures, then check with `ps` that no vite, `cargo-tauri` or `target/debug/visuals` is left |
| `cargo run --release -p visuals-engine --bin record -- <audio> <out.mp4> --cut <s> <preset> …` | presets drawn from an audio file into a video, frame by frame — the teaser's footage (see `teaser/README.md`) | after a change to `record.rs`: record a few seconds and look at them |
| `npm run typecheck` in `teaser/` | the teaser's Remotion edit compiles (the root typecheck doesn't reach it) | any change under `teaser/src/` |
| `cargo run --release -p visuals-engine --bin gpucheck -- [files or folders] [--sample N \| --all] [--timeout S]` | presets load and draw on the GPU: by default a fixed sample of 250 spread over the pack (about a minute); a preset stuck over 20 s ends the run naming it. Exit 0 when every preset drew (fall-backs to MilkDrop's default shader are reported but pass), 1 when any failed to load or draw or panicked, or on a usage error, 2 on a timeout | the default sample locally after changes to shader translation or the renderer; `--all` (all 9,795) only when asked or before a release |
| `cargo run --release -p visuals-engine --bin motion -- <presets or folders> [--hz 60,120] [--speed 0.25,1,4] [--seconds S] [--dump DIR]` | how evenly presets move from one refresh to the next: block-matched motion and frame difference per refresh, averaged by where the refresh lands in its step, as the most-changing phase over the least; `--dump` saves the pictures (see "The preset clock" in `docs/milkdrop-engine.md`) | after a change to how refreshes between steps are drawn |
| `cargo run --release -p visuals-engine --bin bench -- [presets or folders] [--sizes ..] [--levels ..] [--sample N] [--frames N] [--churn N]` | frames a second per quality level, per size; `--churn N` measures memory growth over N switches of quality | after a change to quality, scale or mesh handling |
| `cargo run --release -p visuals-engine --bin index -- <pack folder> --out DIR [--sample N] [--jobs N] [--timeout S]` | the preset index: a 192×144 WebP thumbnail of each preset at step 90 and `DIR/index.json` (path, hash, style, authors, title, hues, brightness, speed, intensity); incremental by content hash; a preset stuck past the timeout is listed under `skipped` and the run goes on (see "The preset index" in `docs/milkdrop-engine.md`). Keep DIR outside the repo | after a change to `engine/src/index*`, `engine/src/analyse/` or the renderer: `--sample 250 --jobs 4` (about a minute); the full pack only before a release |
| `npm run compare -- <presets or folders> [--sample N] [--frames N] [--captures N] [--size WxH] [--min-score N] [--timeout S]` in `compare/` (once: `npm ci && npx playwright install chromium`) | presets drawn by Butterchurn 2.6.7 and by the engine from the same audio, clock and seeds, compared section by section against how far each side drifts from itself (see `compare/README.md`): one line per preset on stdout, `compare/out/report.json`, a composite PNG per capture. A preset stuck over `--timeout` (30 s) on either side is killed and reported, and the run goes on. Exit 0 when every preset ran, 1 when ours failed to load or draw one (or timed out), one scored under `--min-score`, or none could be scored, 2 on a usage error | after any change that affects how a preset draws (below) |
| `cargo test -p visuals-compare`, and `npm test` and `npm run typecheck` in `compare/` | the compare bench: its engine half, its section metric, its approvals file and its HLSL repairs (the root typecheck and tests don't reach `compare/`; CI runs all three) | any change under `compare/` |
| `npm run calibrate` in `compare/` | how well the bench's score separates Butterchurn against itself from deliberately different pictures, on 20 presets picked at random (seeded), plus known cases of ours against Butterchurn labelled by eye (`compare/calibration.json`); prints the margin; exit 1 when any pair overlaps or either class is empty | after a change to the bench's metric (`compare/harness/grid.ts`) |

**Compare against Butterchurn before pushing.** After any change that affects how a
preset draws (shader translation, the renderer, EEL, audio, the runtime), run the compare
bench on the presets it touches (`npm run compare -- <them>` in `compare/`; a folder or
`--sample 30` when the change is broad) and read what it says before you push:

- Each line's score is how far ours is beyond Butterchurn's own drift, not a pixel
  difference: presets drift apart by nature (rand streams part after the init equations,
  feedback amplifies tiny float differences), so Butterchurn is also drawn re-seeded, and
  ours re-seeded and slightly larger, and only a gap beyond that floor counts. The worst
  capture pulls the score down. 86 and up is within drift; under about 80, or a capture
  under 70, is worth a look. `n/c` means Butterchurn drifts too far from itself
  to tell; judge its first captures by eye. `[rand,…,strong-feedback]` says why a preset
  drifts.
- The line after the id says what differs and where ("ours darker in the centre sections;
  edges match; …"). Open the composite PNGs of the worst captures with your image reader
  (`compare/out/frames/<preset>/f<frame>.png`, named on the line): Butterchurn | ours |
  beyond the floor on top, Butterchurn re-seeded and the floor beneath, so you can see
  what normal drift looks like for that preset. `report.json` has every number.
- Compare before and after your change on the same presets; a score that drops, or a
  line that starts naming a feature, is the signal. Say what you saw in the PR.

Butterchurn is the reference, not the truth: Ryan judging beside the BlackHole visualizer
remains the final call, and `compare/README.md` lists what can't match.

`npm run app` runs the app (the library and live mode); `npm run app:lab` runs the lab
build, which starts in the editor (`VITE_LAB=1 app/run.sh --features lab`; the headless
capture above works with it too). `VISUALS_PRESET=<path in the pack>` starts either on a
given preset. `VISUALS_LIVE=1` starts it in live mode, which opens the output window full screen
on a display (`VISUALS_DISPLAY=<n>` picks display `n`, from 0; otherwise the one chosen
last). No dev port is fixed: it takes `PORT` or a free port from the OS and hands it to
vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a picture of its own
window, for checking it without screen access, and `VISUALS_CAPTURE_OUTPUT=<file.png>` of
the live output window (both after `VISUALS_CAPTURE_AFTER` seconds, 8 by default).
`VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'` sends those live actions (effects,
hold…) 5 s after start (`VISUALS_FX_AFTER`), to check effects in a capture.
`VISUALS_WINDOW_SIZE=WxH` (e.g. `800x900`) opens the main window at that size, to check a layout.
In a debug build `VISUALS_PACK_URL=<url>` replaces the full pack's download URL (a bundle
served locally; `docs/pack.md`), and `VISUALS_PACK_DOWNLOAD=1` starts the download at
launch, for headless tests. Beside the user's settings and `library.json`, the app keeps
`resume.json` (what to resume at the next launch), `failed.json` (presets that wouldn't load)
and `access.json` (the reduce-flashing choice; none means follow macOS).

**Agents always run the app headless** (`VISUALS_HEADLESS=1`), from the first run on: the
owner is using the screen. Headless, the app has no Dock icon or menu bar, never becomes
the active app, and draws its windows (the editor and the live output) beyond every
display; captures still show what was drawn (the presets' pictures are read from the GPU
and pasted in). With a capture it quits once the pictures are written. `npm run app` is
`app/run.sh`, which runs `cargo tauri dev` in a process group of its own and stops the
whole group (vite, `cargo-tauri`, the app) when it is stopped (SIGINT, SIGTERM, hangup)
or whatever started it goes away; still, never leave a run going, and check with `ps`
afterwards.

**Contract files.** These are the shared surface every feature's parts would otherwise
all touch. A change to them lands as its own small PR (a milestone's contract) before the
lanes that need it; a lane that needs one asks for it rather than making it:
`app/src/api.ts` (the commands' TS types), `app/src/App.tsx`, `app/src/views.tsx`,
`app/src/words.ts` (the plain words all UI copy uses: bench → preview, the one → bar
start…), `app/src-tauri/src/main.rs` (modules and the command list),
`app/src-tauri/src/settings.rs`, `app/src-tauri/Cargo.toml`, `Cargo.lock`,
`app/src-tauri/tauri.conf.json` (each lane owns its own section, such as `plugins.updater`),
`package.json`, `vite.app.config.ts`, `.github/workflows/ci.yml`, `AGENTS.md`, `README.md`.
Stubs for a lane's commands live in the lane's own file (`pack.rs`, `updater.rs`,
`testsound.rs`, `tap.rs`, `pack.ts`, `SourcePicker.tsx`) so the lane fills them in
without touching these.

The 0.4 (library) contract adds: `app/src-tauri/src/catalog.rs` (`library_index`: the
rows of every pack's `index.json` and the `thumb:` scheme its thumbnails are served on),
the starter set's index (`app/src-tauri/presets/starter/cream-of-the-crop/index.json`
and `thumbnails/`, made with the `index` bin), and the types in `api.ts`. Its stubs:
`app/src-tauri/src/userlib.rs` (`library_data`, `library_set`, the `library-changed`
event, `playable`, and the `library.json` format; #93 fills it in) and
`smartPlaylistSave` in `api.ts` (0.5).

The 0.5 (playlists and live) contract adds, as contract files:
`app/src-tauri/src/playlists.rs` (`playlists.json` version 2: manual or smart playlists
with their settings, items with content hashes, version 1 moved on open, export and
import), `app/src-tauri/src/actions.rs` (the deck: a playlist's settings taken on load,
live tweaks reported in `differs`, shuffle, smart playlists and filters resolved on load,
recently played), `app/src-tauri/src/query.rs` (a `LibraryQuery` worked out in Rust,
mirroring the page's filter), and `app/src/playlists.ts`. Its stubs, each in the lane's
own file: `Home.tsx` and `homeReady.ts` (#96: the home view, shown once `HOME_READY`
is on), `Settings.tsx` and `MoreEffects.tsx` (#98, opened with `openSheet` from
`views.tsx`), `app/src-tauri/src/resume.rs` (#99: `resume_state`, and the deck's
`note` and `open_failed` hooks), `access.rs` and `access.ts` (#100: `reduced_motion`),
`quality.rs` (#101: `quality_get`, `quality_set`), and `crash.rs` and `CrashPrompt.tsx`
(#102: `crash_reports`, `crash_report_open`, the opt-in; written locally, sent only as a
GitHub issue the user submits). Each `.rs` stub's `start` (or `install`) is already
called from `main.rs`.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
