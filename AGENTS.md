# visual[flow]

Read [`README.md`](README.md) first. The MilkDrop engine and the editor app that replace
the Electron app are in `engine/` and `app/`; `docs/milkdrop-engine.md` is their plan and
status.

| Command | What it checks | When to run |
| --- | --- | --- |
| `cargo test -p visuals-engine --lib` | the engine: `.milk` parsing, shader translation, EEL, audio, a GPU render | any change under `engine/` |
| `cargo build -p visuals-app` | the Tauri app compiles | any change under `app/src-tauri/` |
| `npm run typecheck` | the TypeScript (old app, server, editor page) compiles | any `.ts`/`.tsx` change |
| `npx vitest run <files>` | targeted unit tests | the tests next to what you changed; CI runs the whole suite |
| `cargo run --release -p visuals-engine --bin gpucheck` | every preset in the pack loads and draws on the GPU | changes to shader translation or the renderer |

`npm run app` runs the editor. No dev port is fixed: it takes `PORT` or a free port from
the OS and hands it to vite and Tauri. `VISUALS_CAPTURE=<file.png>` makes the app save a
picture of its own window, for checking it without screen access.

Every agent commit must end with a blank line and a GitHub-compatible co-author trailer naming the agent that actually made it, for example `Co-authored-by: Codex <noreply@openai.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never name an agent that didn't write the commit.
