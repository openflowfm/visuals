# visual[flow]

Read [`README.md`](README.md) first. The product is the MilkDrop engine (`engine/`) and
the player app (`app/`: the Tauri shell in `app/src-tauri`, its page in `app/src`);
`docs/milkdrop-engine.md` is their plan and status. The preset editor is in **lab** builds
only: the `lab` Cargo feature on `visuals-app` (its commands, `app/src-tauri/src/editor.rs`)
and `VITE_LAB=1` for the page (`app/src/Lab.tsx`, which loads the editor: `app/src/ui/lab.ts`).
The app people get is built without both.

**The UI is in `app/src/ui/`.** The page people get (the home, live mode, the sheets, the
welcome flow, the prompts) is `VisualsApp` (`app/src/ui/index.ts`), built on the design OS
zen (GitHub `satoramoto/zen`, pinned in `package.json`) in zen's `visuals` theme pack.
`app/src/ui/README.md` is its convention: one folder per screen or part (`<Name>.tsx`,
`<Name>.css`, `<Name>.stories.tsx`, tests), `model/` (the commands and state, `model/ipc.ts`
the bridge every command goes through), `fixtures/` (the parts' stories' fake backend).
`app/src/main.tsx` installs the Tauri bridge (`app/src/zenBridge.ts`: the UI reaches the
app only through it) and renders it; `app/src/main.css` is the page's frame and Instrument
Sans. The lab's editor is `app/src/ui/lab.ts` (`VisualsEditor`, the graph, the inspector;
its commands in `ui/model/lab.ts`, never `ui/model/api.ts`): `app/src/Lab.tsx` (a lab build
only) renders `VisualsApp` with `lab={VisualsEditor}`, so none of the editor reaches the
app's page. The UI reaches zen only through its public entries: `@satoramoto/zen` (and its
`@satoramoto/zen/zen.css`) everywhere, `@satoramoto/zen/storybook` in stories, tests and
`ui/fixtures/` only; never a deeper path. `app/src/stories/` (the App stories' fake
Tauri app) uses `ui/model/` too; there are no older copies of the modules beside it any more.

**What gets tested.** Hooks and models (`ui/model/`, and a part's own hooks in
`<Name>.hooks.test.tsx` beside it) have unit tests; stories' plays check behaviour (keys
and clicks → state, callbacks, focus, aria). Layout is zen's job: no test or play asserts
positions, sizes, overlap or computed styles; only the app's own decisions (when the
sidebar and inspector dock, Stage's forms) are tested.

**Working on the app and zen together.** A generic control, a token or a theme is zen's;
a screen or a part of this app is `app/src/ui/`. To change both at once:

1. `npm run dev` (the page in a browser, plus Storybook) or `npm run dev:app` (the real
   window) link the local zen first (`app/dev-zen.sh`): `ZEN_SOURCE` is the checkout,
   `~/Code/satoramoto/zen` by default when it exists; they run
   `npm install --no-save "$ZEN_SOURCE"` (node_modules/@satoramoto/zen becomes a link to the
   checkout; skipped when it already is) and export `ZEN_SOURCE`. With no checkout there, or
   `ZEN_SOURCE=` (empty), they say so in one line and run against the pinned zen.
2. Both also start the Storybooks (`app/dev-zen.sh`): zen's own launcher, `PREVIEW_LABEL=Zen
   PREVIEW_PORT=$ZEN_PREVIEW_PORT STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix
   "$ZEN_SOURCE" run dev` (4191 and 6022 by default), unless a Storybook already answers
   `/index.json` on `ZEN_STORYBOOK_PORT` (then it reuses it and never stops it; it exits 1
   first when either port is taken by something else). This repo's Storybook composes
   zen's in under "zen" (`ZEN_STORYBOOK_URL`, which they set), on `STORYBOOK_PORT` (6006, or
   a free port). Each prints what runs and the Storybook URL.
3. With `ZEN_SOURCE` set, `vite.app.config.ts` (and so `vite.dev.config.ts`) and
   `.storybook/main.ts` follow zen's `zen-source` recipe: the `zen-source` export condition
   first (zen's entries resolve to its TS/TSX source, hot-reloaded), React deduped, the
   checkout allowed to be served; `.storybook/main.ts` adds the `zen` ref. Without
   `ZEN_SOURCE` nothing changes: the pinned GitHub build (`lib/`) is used and there is no ref.
   `npm run app` and `npm run storybook` never link: they use whatever node_modules holds.
4. The link stays after the run. A plain `npm install` puts the pinned build back.
5. Land the zen change first, as its own zen PR. Meanwhile this repo's branch may pin that
   zen branch's head sha (`"@satoramoto/zen": "github:satoramoto/zen#<sha>"`, then
   `npm install`); once the zen PR merges, pin zen's `main` sha and merge here.

The library rules zen holds its own code to (only `toCssVars()` variables, no literal
colours or radii, the tiers) still describe `app/src/ui/`, but nothing here tests them yet.

A change runs only the build and a compile check: `cargo check -p visuals-engine --all-targets`
for `engine/`, `cargo build -p visuals-app` (and the lab build) for `app/src-tauri/`, and
`npm run typecheck` (plus `app:build-ui` when the app crate needs `dist-app/`) for the page.
Test suites, GPU runs (`--lib`, `gpucheck`, the compare bench) and the formatters run in a
test pass (when asked, or before a PR, each once) and on CI. Tests are written to a spec as
their own step, not as part of a change; if an existing test breaks, the next test pass or
CI catches it.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo check -p visuals-engine --all-targets` | the engine, its bins and its tests compile (no GPU, no test run) | any change under `engine/` |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render, and that GPU objects aren't leaked over preset and quality switches | test pass after a change under `engine/`, and CI |
| `cargo test -p visuals-engine --bins` | the engine's bins compile and their tests (`engine/src/bin/`) pass; `--lib` doesn't build them | test pass after a change under `engine/`, and CI |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `cargo test -p visuals-app --features dev-bridge` | the app's Rust: live actions, playlists, the Link one and changes on the beat, the live output's display choice and fit, the live effects' timing, the first-run state, and `npm run dev`'s bridge (`bridge.rs`: its requests, token and command order) (building needs `cmake`, for Ableton Link) | test pass after a change under `app/src-tauri/`, and CI |
| `cargo build -p visuals-app --features lab,dev-bridge` | the lab app (with the editor's commands), as `npm run dev:lab` builds it, compiles | any change under `app/src-tauri/` |
| `cargo fmt --all --check` | the Rust is formatted (`rustfmt.toml`: width 200; `cargo fmt --all` fixes it) | test pass after a `.rs` change, and CI |
| `npm run format:check` | the editor page (`app/src`) is formatted with Prettier (`.prettierrc.json`: single quotes, width 200; `npx prettier --write app/src` fixes it) | test pass after a change under `app/src`, and CI |
| `npm run typecheck` | the editor page's TypeScript (`app/src`) and the vite and vitest configs compile | any `.ts`/`.tsx` change |
| `npx vitest run --project unit <files>` | targeted unit tests (`app/src/**/*.test.{ts,tsx}`, `app/src/ui/` among them); they run in node, and a file that mounts components in a DOM opts into one on its first line: `// @vitest-environment happy-dom` (Testing Library and user-event; `ui/model/library.dom.test.tsx` is the pattern, and `ui/model/useLive.test.tsx` for a hook on `ui/fixtures/`' backend) or `// @vitest-environment jsdom` (the tests that came from zen, in `app/src/ui/`). `app/src/ui/test-setup.ts` adds jest-dom's matchers and Testing Library's cleanup | test pass: the tests next to what changed; CI runs them all (`npm test`) |
| `npm run test:stories` (or `npx vitest run --project stories <files>`) | every Storybook story renders in headless Chromium without throwing, and its `play` checks pass: the UI's parts (`app/src/ui/**/*.stories.tsx`, titled `open[flow]/visuals/…`, on `app/src/ui/fixtures/`) and the whole app (`app/src/App.stories.tsx`, over `zenBridge.ts`, on `app/src/stories/` answering Tauri's IPC), never the Rust app. No story is tagged `!test`; a play checks behaviour, never layout. Needs Playwright's Chromium once (`npx playwright install chromium`) | test pass after a change under `app/src/ui/`, to a story, `app/src/stories/`, `.storybook/`, `zenBridge.ts`, `main.css`, or zen's pin, and CI |
| `npm run storybook`, `npm run build-storybook` | Storybook with hot reload on port 6006 (or `PORT`), or built into `storybook-static/`: the UI's parts and the whole app, with zen's toolbar (theme pack, mode, facets) and a Desk menu. Agents add `-- --ci --no-open --host 127.0.0.1`, run it in the background with a `trap` that stops it, and check `ps` afterwards | to look at a component's states; `build-storybook` after a change to `.storybook/` |
| `npm run app:build-ui` | the app's page builds into `dist-app/`, which the app crate needs to compile; it must have no `Lab-*` chunk and no editor command (CI checks), so nothing outside `Lab.tsx` may import `app/src/ui/lab.ts`, `Editor/`, `StageGraph/`, `StageInspector/` or `ui/model/lab.ts` | changes to `app/src`, `app/index.html` or `vite.app.config.ts` |
| `npm run app:build-ui:lab` | the lab page (with the editor, as its own `Lab-*` chunk) builds into `dist-app/` | changes to `app/src`, `app/index.html` or `vite.app.config.ts`; run it before `app:build-ui`, which leaves the app's page in `dist-app/` |
| `npm run check:no-dev-code` (add `-- --bin target/debug/visuals` after a plain `cargo build -p visuals-app`) | none of `npm run dev`'s bridge is in what ships: not in the app's page in `dist-app/` (no `app/src/dev/`, and no Storybook, `mockIPC` or `app/src/stories/` either), nor in a binary built without `dev-bridge` (no `bridge.rs`); exit 1 naming what it found, 2 without `dist-app/` (CI runs both) | test pass after `npm run app:build-ui`, when `app/src/dev/`, `bridge.rs`, `vite.dev.config.ts` or `.storybook/` changed, and CI |
| `npm run dev` (`npm run dev:lab` for the editor) | the app's page in a normal browser with HMR, driving the real app headless over its dev bridge: real commands, events, deck, library, audio and Link, and the bench's frames streamed into the preview, against the local zen (`app/dev-zen.sh`: `npm install --no-save "$ZEN_SOURCE"`, `~/Code/satoramoto/zen` by default; `ZEN_SOURCE=` or no checkout uses the pinned zen and says so). It also starts zen's launcher (zen's Storybook on `ZEN_STORYBOOK_PORT` 6022, its app on `ZEN_PREVIEW_PORT` 4191) unless a Storybook already answers on that port, and this Storybook on `STORYBOOK_PORT` (6006, or a free port when taken) with zen's composed in under "zen"; either Storybook ending by itself is reported and the rest keeps running; the page's port is `PORT`. Prints the URLs to open, with the bridge's token; opens it when run from a terminal (`VISUALS_DEV_OPEN=0` doesn't). Exits 1, stopping everything it started, when the app fails to build or quits. Leaves node_modules linked to zen: a plain `npm install` restores the pin | designing the page or zen; agents use their own ports (never 6006, 6022, 4191), load the URL with Playwright (`compare/`'s), then stop the run, check `ps` that no vite, Storybook or `target/debug/visuals` is left, and run `npm install` |
| `npm run dev:app` (`npm run dev:app:lab` for the editor) | `app/run.sh` with `VISUALS_DEV_APP=1`: links the local zen and starts both Storybooks as `npm run dev` does, then `cargo tauri dev`, the real window with hot reload of the page and zen's source. Prints what runs and the Storybook URL; quitting the app stops the Storybooks too. Leaves node_modules linked to zen | working in the real window with zen, pointing at parts in Storybook; agents use their own ports, stop it, check `ps` that no vite, Storybook, `cargo-tauri` or `target/debug/visuals` is left, then `npm install` |
| `npm run app` (`npm run app:lab` for the editor) | `app/run.sh`: `cargo tauri dev` against whatever zen node_modules holds (the pin after a plain `npm install`); no link step | captures (below) and running the app as people get it |
| `VISUALS_HEADLESS=1 VISUALS_CAPTURE=<file.png> npm run app` (add `VISUALS_LIVE=1 VISUALS_CAPTURE_OUTPUT=<out.png>` for live mode, `VISUALS_FX=…` for effects) | the app runs and draws: pictures of the main window and the live output, with nothing shown on screen. It quits once the pictures are written, so the command ends by itself (exit 0) | after a change to the app or the page you want to see working: look at the pictures, then check with `ps` that no vite, `cargo-tauri` or `target/debug/visuals` is left |
| `cargo run --release -p visuals-engine --bin record -- <audio> <out.mp4> --cut <s> <preset> …` | presets drawn from an audio file into a video, frame by frame — the teaser's footage (see `teaser/README.md`) | after a change to `record.rs`: record a few seconds and look at them |
| `npm run typecheck` in `teaser/` | the teaser's Remotion edit compiles (the root typecheck doesn't reach it) | any change under `teaser/src/` |
| `cargo run --release -p visuals-engine --bin gpucheck -- [files or folders] [--sample N \| --all] [--timeout S]` | presets load and draw on the GPU: by default a fixed sample of 250 spread over the pack (about a minute); a preset stuck over 20 s ends the run naming it. Exit 0 when every preset drew (fall-backs to MilkDrop's default shader are reported but pass), 1 when any failed to load or draw or panicked, or on a usage error, 2 on a timeout | test pass: the default sample after changes to shader translation or the renderer; `--all` (all 9,795) only when asked or before a release |
| `cargo run --release -p visuals-engine --bin motion -- <presets or folders> [--hz 60,120] [--speed 0.25,1,4] [--seconds S] [--dump DIR]` | how evenly presets move from one refresh to the next: block-matched motion and frame difference per refresh, averaged by where the refresh lands in its step, as the most-changing phase over the least; `--dump` saves the pictures (see "The preset clock" in `docs/milkdrop-engine.md`) | test pass after a change to how refreshes between steps are drawn |
| `cargo run --release -p visuals-engine --bin bench -- [presets or folders] [--sizes ..] [--levels ..] [--sample N] [--frames N] [--churn N]` | frames a second per quality level, per size; `--churn N` measures memory growth over N switches of quality | test pass after a change to quality, scale or mesh handling |
| `cargo run --release -p visuals-engine --bin index -- <pack folder> --out DIR [--sample N] [--jobs N] [--timeout S]` | the preset index: a 192×144 WebP thumbnail of each preset at step 90 and `DIR/index.json` (path, hash, style, authors, title, hues, brightness, speed, intensity); incremental by content hash; a preset stuck past the timeout is listed under `skipped` and the run goes on (see "The preset index" in `docs/milkdrop-engine.md`). Keep DIR outside the repo | test pass after a change to `engine/src/index*`, `engine/src/analyse/` or the renderer: `--sample 250 --jobs 4` (about a minute); the full pack only before a release |
| `cargo run --release -p visuals-engine --bin features -- <pack folder> --out DIR [--sample N] [--jobs N] [--timeout S] [--retry]` | raw measurements of each preset for fitting tags: drawn at 384×288 for 10 s under music, silence, no waves and no shapes (same seed, each from black); 53 named features per preset in `DIR/features.json` and a 24-frame 12 fps 192×144 WebP sprite sheet per preset in `DIR/clips/`; incremental by content hash and `features::ANALYSIS`, with child processes and a timeout as `index` has. Keep DIR outside the repo | test pass after a change to `engine/src/features/`, `engine/src/analyse/` or anything that changes how a preset draws: `--sample 20 --jobs 4` |
| `npm run compare -- <presets or folders> [--sample N] [--frames N] [--captures N] [--size WxH] [--min-score N] [--timeout S]` in `compare/` (once: `npm ci && npx playwright install chromium`) | presets drawn by Butterchurn 2.6.7 and by the engine from the same audio, clock and seeds, compared section by section against how far each side drifts from itself (see `compare/README.md`): one line per preset on stdout, `compare/out/report.json`, a composite PNG per capture. A preset stuck over `--timeout` (30 s) on either side is killed and reported, and the run goes on. Exit 0 when every preset ran, 1 when ours failed to load or draw one (or timed out), one scored under `--min-score`, or none could be scored, 2 on a usage error | test pass after any change that affects how a preset draws (below) |
| `cargo test -p visuals-compare`, and `npm test` and `npm run typecheck` in `compare/` | the compare bench: its engine half, its section metric, its approvals file and its HLSL repairs (the root typecheck and tests don't reach `compare/`; CI runs all three) | `npm run typecheck` in `compare/` after any change under it; the tests in a test pass and CI |
| `npm run export -- <kit .sketch or unpacked folder> <symbol name prefixes…> [--out DIR] [--formats png,svg] [--scale N] [--sketchtool PATH]` in `kit/` (once: `npm ci`; needs Sketch installed) | a Sketch UI kit's symbols (Apple's macOS kit) exported by Sketch's own `sketchtool` under `DIR` (`kit/out/`), one folder per name segment: the exact PNG (`@2x`) and an SVG of the outlines, plus `sheet.html` laying them out on their appearance's window background; prints each sketchtool command. Exit 0 when every file was written, 1 when sketchtool failed or none matched, 2 on a usage error. Nothing it reads or writes goes in the repo (see `kit/README.md`) | to get the kit's reference pictures of a component before building or checking ours |
| `npm run tokens -- <kit .sketch or unpacked folder> [--out FILE] [--preview FILE]` in `kit/` | the kit's colours, type and layer styles written as CSS custom properties to `kit/tokens.css` (committed; light on `:root`, dark by preference or `[data-appearance='dark']`), and `kit/out/tokens.html` showing them all in light and dark. Exit 0 when written, 2 on a usage error | after a change to `kit/src/tokens.ts`, or a new kit: look at `tokens.html` and the diff of `tokens.css` |
| `npm test` and `npm run typecheck` in `kit/` | the kit exporter's symbol listing (from a folder or a `.sketch`), name selection, file names and sheet, and the token generator's naming, colour compositing (blend modes), rings, shadows, blurs and stylesheet, on made-up documents (CI runs both) | `npm run typecheck` after any change under `kit/`; `npm test` in a test pass and CI |
| `npm run label -- <features DIR>`, `npm run rubric -- <features DIR> [--tags a,b] [--yes]`, `npm run score -- <features DIR>` in `tags/` (once: `npm ci`) | hand labels by grid on a 127.0.0.1 page into `tags/labels.json` (committed); Claude Sonnet 5.5 rubric scores cached in `tags/out/rubric.json` (prints the cost; sends only with `ANTHROPIC_API_KEY` and `--yes`, exit 2 without a key); the per-tag held-out precision report `tags/out/report.html` and `tags/out/tags.json` (see `tags/README.md`) | after a features run, to label and score tags |
| `npm test` and `npm run typecheck` in `tags/` | the vocabulary, label storage, grid picking, the label server, rubric requests and parsing, the scorers (nested, duplicate-grouped cross-validation), calibration and the report, on a made-up fixture (CI runs both) | `npm run typecheck` after any change under `tags/`; `npm test` in a test pass and CI |
| `npm run calibrate` in `compare/` | how well the bench's score separates Butterchurn against itself from deliberately different pictures, on 20 presets picked at random (seeded), plus known cases of ours against Butterchurn labelled by eye (`compare/calibration.json`); prints the margin; exit 1 when any pair overlaps or either class is empty | test pass after a change to the bench's metric (`compare/harness/grid.ts`) |

**Compare against Butterchurn in the test pass before a PR.** When the PR changes how a
preset draws (shader translation, the renderer, EEL, audio, the runtime), the test pass runs
the compare bench on the presets it touches (`npm run compare -- <them>` in `compare/`; a
folder or `--sample 30` when the change is broad) and reads what it says before the PR:

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

`npm run app` runs the app (the home and live mode); `npm run app:lab` runs the lab
build, which starts in the editor (`VITE_LAB=1 app/run.sh --features lab`; the headless
capture above works with it too). `VISUALS_PRESET=<path in the pack>` starts either on a
given preset. Going live never opens the output by itself: it plays in the main window
until the user picks a display ("Go full screen on…" or the Output popover). Only a start
in live mode does: `VISUALS_LIVE=1` starts it in live mode with the output window full screen
on a display when another one can take it (`VISUALS_DISPLAY=<n>` picks display `n`, from 0; otherwise the one chosen
last), so `VISUALS_CAPTURE_OUTPUT` has an output to capture. `VISUALS_VIEW=home|library|live|live-windowed` starts it in that view and wins over
`VISUALS_LIVE`; `live` is `VISUALS_LIVE=1`'s, `library` is the home opened on its library pane (there is no library view
of its own since decision 66), and `live-windowed` plays live in the main window, as going live from the home does, so
its "Go full screen on…" overlay can be captured. With the flashing warning owed (first run
done, "I understand" not yet chosen), live mode waits behind it; the answer is kept in
`access.json`, so once answered in one dev run it holds for later runs, headless captures
included. No dev port is fixed: it takes `PORT` or a free port from the OS and hands it to
vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a picture of its own
window, for checking it without screen access, and `VISUALS_CAPTURE_OUTPUT=<file.png>` of
the live output window (both after `VISUALS_CAPTURE_AFTER` seconds, 8 by default).
`VISUALS_FX='[{"kind":"mirror","mode":"quad"}]'` sends those live actions (effects,
hold…) 5 s after start (`VISUALS_FX_AFTER`), to check effects in a capture.
`VISUALS_WINDOW_SIZE=WxH` (e.g. `800x900`) opens the main window at that size, to check a layout.
In a debug build `VISUALS_FROST=<material>` gives the main window another frost than
`tauri.conf.json`'s `hud`: `under-window`, `sidebar`, `hud`, `fullscreen-ui`, `popover`,
`menu`, `header`, `content`, `window`, `glass` or `glass-clear` (macOS 26's Liquid Glass),
or `off` for a solid window; `VISUALS_FROST_TINT=<0..1>` scales the page's tints over it
(0: the material alone, 1: as shipped; the page (`app/src/ui/`) doesn't read the tint or `data-frost` yet,
so only the material changes). Only a run on screen shows the frost: headless,
the log says `VISUALS_FROST: the main window is …` and, but for `off`, `bench: stacked [Frost, Bench, Other]`.
Home is the inspector view: the sidebar and the inspector either side of the main column
(`app/src/ui/model/home-model.ts`). The `VITE_HOME_*` flags below are read behind `import.meta.env.DEV`, so
only a dev run (`npm run dev`, `npm run app`) takes them, never a build. In a dev run `VITE_HOME_PANEL=1` opens the inspector at start and
`VITE_HOME_PANEL=0` starts it closed, at any width; `VITE_HOME_SIDEBAR=1` shows the sidebar at start and
`VITE_HOME_SIDEBAR=0` hides it; `VITE_HOME_PICK=<path in the pack>` starts with that preset picked, shown in
the inspector. `VITE_HOME_FILTER=<group>:<value>` (e.g. `style:Hypnotic`) starts the library with its filter
open on that group and that value picked, `VITE_HOME_SEARCH=<text>` with that search typed, and
`VITE_HOME_PLAYLIST=<name>` opens that playlist's pane, all for captures of Home's states.
`VISUALS_VIEW=library` stays the home on its library pane.
In a debug build `VISUALS_PACK_URL=<url>` replaces the full pack's download URL (a bundle
served locally; `docs/pack.md`), and `VISUALS_PACK_DOWNLOAD=1` starts the download at
launch, for headless tests. In a debug build, or in any headless run, the app doesn't bring
an existing full pack up to the pinned bundle at launch; in a debug build
`VISUALS_PACK_UPDATE=1` turns that background update back on, to test it headless with
`VISUALS_PACK_URL`. Beside the user's settings and `library.json`, the app keeps
`resume.json` (what to resume at the next launch), `timing.json` (the change timing
outside playlists, kept when no playlist is loaded), `failed.json` (presets that wouldn't load)
and `access.json` (the reduce-flashing choice, none meaning follow macOS, and the flashing warning's answer).

**Agents always run the app headless** (`VISUALS_HEADLESS=1`), from the first run on: the
owner is using the screen. Headless, the app has no Dock icon or menu bar, never becomes
the active app, and draws its windows (the editor and the live output) beyond every
display; captures still show what was drawn (the presets' pictures are read from the GPU
and pasted in). With a capture it quits once the pictures are written. `npm run app` is
`app/run.sh`, which runs `cargo tauri dev` in a process group of its own and stops the
whole group (vite, `cargo-tauri`, the app) when it is stopped (SIGINT, SIGTERM, hangup)
or whatever started it goes away; still, never leave a run going, and check with `ps`
afterwards.

**`npm run dev` is development only.** `app/dev.sh` runs the app headless (`cargo run
--features dev-bridge`, always `VISUALS_HEADLESS=1`) and vite with `vite.dev.config.ts`, each
in a process group of its own, stopped together as `app/run.sh` stops its group. The app's
dev bridge (`app/src-tauri/src/bridge.rs`, the `dev-bridge` Cargo feature, off by default)
listens on `VISUALS_BRIDGE=127.0.0.1:<port>` only (nothing happens without it) and wants
`VISUALS_BRIDGE_TOKEN` on every request; `dev.sh` picks both and passes the token to the page
in the URL it prints. It hands each command to Tauri's own IPC entry, so every command the
app has works with no list to keep, in the order the page sent them; it relays events,
serves thumbnails and the bench's frames, and puts the hidden window's own page away. The
page's half is `app/src/dev/` (it stands in for Tauri's internals), loaded only by
`vite.dev.config.ts`, which proxies `/__bridge` to the bridge. Neither half may reach a
release: `npm run check:no-dev-code` checks the page and the binary.

**Contract files.** These are the shared surface every feature's parts would otherwise
all touch. A change to them lands as its own small PR (a milestone's contract) before the
lanes that need it; a lane that needs one asks for it rather than making it:
`app/src/ui/model/api.ts` (the commands' TS types), `app/src/main.tsx` and `app/src/zenBridge.ts`
(what the page renders and the bridge the UI runs on), `app/src/ui/Views/Views.tsx`,
`app/src/ui/model/words.ts` (the plain words all UI copy uses: bench → preview, the one → bar
start…), `app/src-tauri/src/main.rs` (modules and the command list),
`app/src-tauri/src/settings.rs`, `app/src-tauri/Cargo.toml`, `Cargo.lock`,
`app/src-tauri/tauri.conf.json` (each lane owns its own section, such as `plugins.updater`),
`package.json` (zen's pin among it), `vite.app.config.ts`, `.github/workflows/ci.yml`, `AGENTS.md`, `README.md`
and `app/src/ui/model/playlists.ts`. The screens' own contract files (`App`, `Numbers`,
the home's and live's models) are in `app/src/ui/` now (`App/`, `Numbers/`,
`model/home-model.ts`, `model/live-model.ts`, `model/stage-model.ts`). The milestone
notes below name files as they were before the UI moved to zen and back; the screens
among them are in `app/src/ui/`.
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
own file: `Home.tsx` (#96: the home view, since decision 66 the only one that browses),
`Settings.tsx` and `MoreEffects.tsx` (#98, opened with `openSheet` from
`views.tsx`; the app menu's Settings… ⌘, sends `menu-settings`, which opens it too), `app/src-tauri/src/resume.rs` (#99: `resume_state`, and the deck's
`note` and `open_failed` hooks), `access.rs` and `access.ts` (#100: `reduced_motion`),
`quality.rs` (#101: `quality_get`, `quality_set`), and `crash.rs` and `CrashPrompt.tsx`
(#102: `crash_reports`, `crash_report_open`, the opt-in; written locally, sent only as a
GitHub issue the user submits). Each `.rs` stub's `start` (or `install`) is already
called from `main.rs`.

The per-preset tune contract (a preset's own speed and sensitivity) adds `library.json`'s
`tune` (`{ "speed": 0.5, "sensitivity": 1.5 }`, multipliers 0.25–4, 1 never written;
`userlib::PresetTune`, `Change.tune`/`clear_tune`, `userlib::tune_of`), its types in
`api.ts` (`PresetTune`, `TUNE_MIN`/`TUNE_MAX`, `Mine.tune`, `LibraryChange.tune`/`clear_tune`)
and its words in `words.ts`. Its stub: `app/src-tauri/src/tune.rs` (`apply_preset_tune`,
called from `resume::open_reported` on every preset load, and `retune`, called from
`userlib::library_set` after a tune changes).

The Stage contract (live mode as the picture full-bleed with Home's inset panels over it)
adds, as contract files: `app/src/live/live-model.ts` (`LiveState`, the one shape every
live part is handed, and live's reckonings: intensity, stars, the Next line's name and
when; Live.tsx re-exports the ones it had) and `app/src/live/stage-model.ts` (the crate
docked from `STAGE_DOCK_AT` 1100 px or laid over below, `\` hiding the panels and Esc
showing them before it leaves, and each part's props). Live's glyphs are in
`layout/icons.tsx`; the help list's Stage-only controls (`crate`, `panels`) show with
`HelpOverlay`'s `stage`; `liveKeys` takes `panels` and `escape`. `app/src/live/useLive.ts`
is live's state, read from the app (Live.tsx's, moved). Its stubs, each in the lane's own
file: `StageLayout.tsx` (the shell), `StageDock.tsx`, `StageCrate.tsx` and `StageHead.tsx`
(with `FullScreenOffer`), all in `app/src/live/`; Live.tsx mounts them last.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
