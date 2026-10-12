# Camera lab handoff — 2026-10-11

## Paused state

Ryan asked to put this down, commit everything, write a handoff, and stop servers. All camera assignment servers are stopped. Do not restart until work is resumed.

Persistent coordinator: `/Users/ryan/Documents/Codex/2026-10-11/i-wa/outputs/camera-lab`
Branch: `codex/camera-coordinator`
Implementation head before this handoff: `64ddeaa69bd326aed33538c149dc421871ac2169`.
Original saved OpenFlow checkout and main were not updated. Nothing pushed or published.

## User direction

Experimental browser webcam into the actual OpenFlow MilkDrop engine, with person-only isolation before feedback. Keep the person recognizable while allowing colorful, extreme presets. Follow the satoramoto/web strategy: inject the source into feedback and draw a stable representation of the same source above the distortion.

Latest requested features: compact preset overlay for fast cycling; smooth, almost-vector contours; higher-resolution output; microphone/audio-interface reactivity. Then Ryan questioned the 30 FPS result and wants 60 FPS. He explicitly permits encoding the stream if necessary. Encoding has not been implemented or selected as the next approach.

## Implemented

- Local MediaPipe worker person mask; 250 ms freshness limit, bounded inference, source/mirror resets. Occasional segmentation false positives remain.
- Denoised contours, connected-chain tracing, simplified quadratic Canvas paths. The same traced paths feed native feedback and the sharp foreground; no full-HD CPU contour processing. Curve smoothing is adjustable. Tracing caps: 512 paths, 8,192 traversed edges.
- Color and Recognition controls, plus three audio-reactive native camera presets: Chromatic vortex, Prism cult, Acid tide.
- Compact overlay with search, thumbnails, previous/next/random, keyboard travel, and 60-result pages. Native catalog returned 9,798 entries on this machine: three camera presets plus the installed 9,795-preset pack. Other machines may have fewer installed presets.
- Native 360p, 720p, 1080p renderer AND output resizing; 720p default. Returned dimensions are authoritative.
- Explicit Enable audio, microphone/interface selector, sensitivity, input meter. Browser mono PCM snapshots feed native engine FFT; no speaker monitoring. Stop drains requests and releases tracks/context. No automatic microphone permission request on startup.
- Preset request serialization, rejection rollback to the last accepted preset, and startup ordering fixes.

## Latest performance change — not yet accepted

Source `35b6308b4a8b53ecd9388048cefb5d304e300c44` integrated as `64ddeaa69bd326aed33538c149dc421871ac2169`.

Previously both capture/preparation and output loops were explicitly capped at 30 FPS. The latest commit:

- Uses a 60 Hz output deadline with one request in flight; avoids RAF/async frame quantization.
- Keeps expensive preparation independently bounded at 30 Hz.
- Requests camera ideal/max 60 FPS, subject to device/browser support. This does NOT mean processed source updates are 60 FPS.
- Shows actual output FPS and accepted input FPS separately.
- Adds an opt-in timing breakdown for fetch/body/compose/preparation/upload and caches the foreground gradient.

The author reports 52 targeted tests and typecheck passed. This last performance commit has NOT received final source review, browser measurement, or normal/lab UI build checks. Do not claim achieved 60 FPS.

## Evidence before that last performance commit

- Curve source review clear; backend review clear; frontend review clear through startup fix `92081bf6` (integrated `18d5f322`).
- 51 combined camera/bridge tests, typecheck, formatting, normal/lab UI builds, production UI exclusion passed through `18d5f322`.
- Backend: 303 Rust tests passed, three ignored; normal/lab native builds, formatting, production binary/UI exclusion passed. No core engine source changes in this revision.
- Native smoke: all three camera presets at all three resolutions loaded without shader fallback. Actual output: 640×360/921,600 bytes; 1280×720/3,686,400; 1920×1080/8,294,400.
- Synthetic PCM caused actual native FFT/bass response; stale audio became silent. Audio and stop endpoints worked. No physical microphone or webcam was accessed by agents.
- Integrated browser photo fixture: overlay search, library loading, rapid next/next, resolution switching, and smooth outlines worked. 720p roughly 29–30 FPS; a heavy Paint Spill variant at 1080p roughly 21–25 FPS. Those measurements were with the old 30 FPS output cap.
- Combined browser preparation roughly 8.5–10 ms. Developer CPU-only synthetic preparation median 5.36 ms, p95 5.55 ms, excluding Canvas/model/network/native work.
- Idle 720p HTTP readback probe: median total 10.96 ms, native snapshot header median 7.21 ms. Large outliers occurred (p95 ~634 ms in only 30 samples); this is a small idle probe, not evidence of sustained 60 FPS under load.

## Next performance investigation

1. Review latest `35b6308b`/`64ddeaa6`, then run the relevant checks and live photo demo with timing breakdown. Measure actual output and input FPS at 720p and 1080p under representative presets.
2. Separate native snapshot time (`X-Snapshot-Ms`) from browser fetch/body/compose and preparation. Do not infer an in-app browser limit from the previous explicit 30 FPS cap.
3. Current raw transport is ~221 MB/s at 720p60 or ~498 MB/s at 1080p60, before other costs. Snapshot allocates a texture and staging buffer for each request and synchronously reads back the GPU.
4. If snapshot allocation/readback dominates, consider a camera-only reusable snapshot texture/staging buffer, resizing only on dimension changes. Keep ordinary OpenFlow rendering unchanged.
5. If transfer/decode dominates, evaluate an encoded stream (explicitly acceptable to Ryan), including latency, hardware encoder availability, and browser decoding. Avoid guessing that encoding alone fixes synchronous GPU readback. Browser-native rendering is another larger architectural option, not currently implemented.
6. Only compare another browser if measurements still implicate the browser. Do not claim 60 FPS until demonstrated; do not count duplicate presentation callbacks as new native frames.
7. Real microphone/interface and webcam acceptance is still a user test. Enable audio explicitly and confirm input meter/preset response; preserve local-only handling and no audible monitoring.

## Relevant code and protocol

- `app/src/dev/camera/main.ts`: controls, source generation/lifecycle, output/preparation pacing, compositor.
- `app/src/dev/camera/curve-contours.ts`: tracing/smoothing/vector drawing.
- `app/src/dev/camera/color-signal.ts`: colored emission and identity shading.
- Other camera modules: preset browser and microphone lifecycle; tests beside source.
- `app/src-tauri/src/bridge/camera.rs`: authenticated local catalog, settings, RGBA and PCM transport.
- `app/src-tauri/src/bench.rs`: native camera audio, renderer/output resize, snapshot.
- `docs/camera-preview.md`, `docs/camera-lab/runtime-v4.md`: usage and API contract.
- GET `/__bridge/camera/presets`, GET `/__bridge/camera/output`.
- POST camera settings requires speed/persistence; accepts presetId and resolution. Preset IDs are catalog-allowlisted, never arbitrary client paths.
- POST `/__bridge/camera/audio?rate=48000&gain=1`: 512 or 1024 mono Float32 LE samples; bounded finite data/rate/gain; 250 ms expiry. POST `/__bridge/camera/audio/stop` silences it.
- Camera POST input remains bounded at 640×360; current preparation is 320×180. Foreground curves scale cleanly to output size; this is not a high-detail 1080p camera segmentation model.

## Preserved worktrees and mappings

All three temporary worktrees are retained for resumption; do not discard unique or uncertain files. No assignment server remains.

- `work/camera-runtime`, branch `codex/camera-runtime`, source `1137b60d67bd5404dc893a10ecf022341d52fa57` → coordinator `a723a43d`.
- `work/camera-curves`, branch `codex/camera-curves`, source `32041dea19f9c7eb234a77143255e5ee793d9c33` → `f5754a40`.
- `work/camera-controls`, branch `codex/camera-controls`, source head `35b6308b4a8b53ecd9388048cefb5d304e300c44`.
- Frontend source `5bab32c3` → `2b1f6db6`; payload fix `79cd721a` → `d026b273`; rejection rollback `7266bfb5` → `c486f782`; startup fix `92081bf6` → `18d5f322`; performance `35b6308b` → `64ddeaa6`.
- Frontend local curve dependency `4b8276d` duplicates source `32041dea`; integrated only once.
- Shared native build cache: `work/camera-target`. Coordinate exclusive ownership before simultaneous native builds.
- Detailed assignment ledger: `/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/coordination.md`.

## Restart only when requested

From the coordinator directory, use the unified launcher only:

```sh
OPENFLOW_HOME=/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/camera-coordinator-state \
CARGO_TARGET_DIR=/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/camera-target \
VISUALS_CAMERA_LAB=1 VISUALS_DEV_OPEN=0 PORT=4286 STORYBOOK_PORT=6116 \
npm run dev
```

Read the fresh token from launcher output, then open `/camera.html?token=...`. Tokens from prior runs are expired. Use the photographic demo for agent verification. Never independently launch Vite/Storybook/native children to repair the preview.

Final stopped coordinator session: `45527`; launcher PID `47499`, children `47506–47508`. Confirmed absent, and camera ports 4286/6116, 4288/6118, 4289/6119 vacant after shutdown. No further runtime testing was performed after Ryan asked to stop.
