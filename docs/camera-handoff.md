# Camera lab handoff — 2026-10-12

## Server stopped

Resumed at Ryan's request. Coordinator implementation head: `f1cde4afd5c41cd2a8a36167942e936fb72f68f9`, branch `codex/camera-coordinator`.
Persistent coordinator: `/Users/ryan/Documents/Codex/2026-10-11/i-wa/outputs/camera-lab`.
User requested shutdown after the split-opacity/interpolation work began. Launcher20537 and its children20546–20548 were stopped; ports4286/6116 verified closed. Previous tokens/session11148 are historical. Original saved checkout/main remain unchanged; nothing pushed or published.

## Unintegrated smoothing checkpoint

`work/camera-edge-motion`, branch `codex/camera-edge-motion`, clean commit `abb5c715b383da99bd71dc0a7c9aa06fbbf3c4b3` on base `1ae7a6d`. Implements separate camera opacity (0) and outline opacity (65), wider/stronger temporal stabilization and output geometry interpolation. Existing 83 tests and typecheck passed. New behavior regressions, quantified jitter/performance tests, documentation, full build checks and browser acceptance are unfinished. Not integrated or accepted; preserve this worktree. No assignment server exists.

## User direction

Experimental browser webcam into the actual OpenFlow MilkDrop engine, with person-only isolation before feedback. Keep the person recognizable while allowing colorful, extreme presets. Follow the satoramoto/web strategy: inject the source into feedback and draw a stable representation of the same source above the distortion.

Latest requested features: compact preset overlay for fast cycling; smooth, almost-vector contours; higher-resolution output; microphone/audio-interface reactivity. Then Ryan questioned the 30 FPS result and wants 60 FPS. He explicitly permits encoding the stream if necessary. Hardware H.264 output is now implemented on macOS, with raw RGBA fallback.

## Implemented

- Local MediaPipe worker person mask; 250 ms freshness limit, bounded inference, source/mirror resets. Occasional segmentation false positives remain.
- Denoised contours, connected-chain tracing, simplified quadratic Canvas paths. The same traced paths feed native feedback and the sharp foreground; no full-HD CPU contour processing. Curve smoothing is adjustable. Tracing caps: 512 paths, 8,192 traversed edges.
- Color and Recognition controls, plus three audio-reactive native camera presets: Chromatic vortex, Prism cult, Acid tide.
- Compact overlay with search, thumbnails, previous/next/random, keyboard travel, and 60-result pages. Native catalog returned 9,798 entries on this machine: three camera presets plus the installed 9,795-preset pack. Other machines may have fewer installed presets.
- Native 360p, 720p, 1080p renderer AND output resizing; 720p default. Returned dimensions are authoritative.
- Explicit Enable audio, microphone/interface selector, sensitivity, input meter. Browser mono PCM snapshots feed native engine FFT; no speaker monitoring. Stop drains requests and releases tracks/context. No automatic microphone permission request on startup.
- Preset request serialization, rejection rollback to the last accepted preset, and startup ordering fixes.

## Latest user preference: recognizable foreground with strong trails

Ryan clarified that the outline should stay recognizable while shedding strong distorted trails, and the requested fade means camera/outline opacity. The existing foreground-opacity control is now explicitly labeled **Camera / outline opacity**, default 35%; Edge feed stays 30%, speed 0.4x, and temporal smoothing is unchanged. This supersedes the earlier zero-overlay default below. Source `2a1a89b4` → integrated `f1cde4af`; 83 tests and UI checks passed, fresh browser labels/defaults verified. No native changes or server restart. The completed worktree was cleaned up, branch retained.

## Feed balance follow-up

Ryan still felt contours were separate from the effect. Fresh loads retained the old 85% clean overlay and 9% native input, obscuring the waveform change. Defaults now use Clean outline 0%, Edge feed 30%, Speed 0.4x; temporal stabilization is unchanged. Labels explicitly distinguish the undistorted foreground overlay from edge input (Camera feed in raw mode). Source `78950e2f` → integrated `be1e7a98`; 83 tests and all required UI checks passed. Root reviewed the narrow change and verified fresh defaults in the browser. No native changes or server restart needed.

Visual checks with the moving photo fixture: Chromatic and Acid visibly stretch the contours into trails with no foreground overlay. With clean outline and edge feed both zero, Prism's effect faded away; restoring edge feed rebuilt it, confirming causal source input. Physical webcam feel remains for Ryan to judge. Preview remains running on the same token/session; the single completed balance worktree was cleaned up after integration, branch retained.

## Native contour waveform and temporal steadiness follow-up

Ryan reported that edges did not feel like the waveform and requested reduced jitter. Investigation confirmed the old contour path was opaque RGBA injected after warp/before blur: black outside the strokes dimmed all feedback, while the crisp identity was composed afterward in the browser.

Contour mode now sends bounded colored vector paths to `POST /__bridge/camera/contours`. It replaces the native basic waveform only while active; custom waves/shapes remain. Additive antialiased strokes touch only their coverage, enter recursive feedback at the waveform stage, and have bounded bass brightness modulation. Camera presets deliberately have ordinary wave alpha zero; the contour emission uses its own mix. Raw camera mode retains the RGBA route and disables contour mode. Stop/expiry clears external geometry. Ordinary OpenFlow without contour input follows the unchanged path.

The new Edge steadiness slider applies time-aware matching of nearby, similarly oriented segments, with a bounded spatial grid. It eases small jitter, releases quickly for larger movement, and never retains disappeared edges. This is separate from spatial Curve smoothing. Source/mirror/mode/Stop/stale-mask resets clear history. Native between-step rendering crossfades external geometry instead of morphing vertices by unstable path order. The same stabilized geometry feeds native output and browser identity.

Protocol: `{width,height,mix,paths:[{closed,points:[{x,y,color:[r,g,b]}]}]}`; source pixel coordinates, normalized RGB, at most 512 paths and 8192 points. Renderer accepts optional point/global colors; validation rejects invalid dimensions, values and geometry. Implementation: `engine/src/contours.rs`, `engine/src/draw.rs`, renderer camera integration, bridge/bench; frontend `temporal-contours.ts` and `contour-packet.ts`.

Source → integration: temporal `19097c9c` → `5b2e775b`; frontend vectors `9be3afc5` → `4ca5d9fc`; native `106ed4d1` → `d90fe7ab`. Both independent reviews clear. 82 integrated camera/bridge tests passed; source UI typecheck/format/build/isolation passed. Temporal-only 2000-point synthetic benchmark median 0.387 ms, p95 0.632 ms. Native GPU tests cover wave-alpha-zero visibility, asymmetric orientation, disconnected paths, unattenuated background, recursive trails, mode/clear behavior and ordinary-render equivalence. Engine 151 tests and bin tests passed; app 308 tests passed, four ignored. Normal/lab native builds, production exclusion and formatting passed; 250/250 ordinary presets drew with their own shaders without failures/fallbacks. A later FPS warmup fix (source `4190eb82` → `ea1ef102`) raises frontend tests to 83 and avoids first-frame spikes.

Integrated browser proof: Recognition 0% still shows colored facial contours forming native recursive trails. Raw/contour transitions and Stop work; Stop released all 6015 decoded frames and all decoders. 1080p H.264 sampled ~57.7–60.1 FPS over 10-second windows during the initial vector run; physical webcam jitter remains a user acceptance check.

Additive contour strokes exposed over-retention in the three camera presets formerly balanced by opaque image blending. Their decay alone was corrected from .995 to .91 (source `1dbbeb7b` → `0093463b`), preserving color shaders. A 30-second dense geometry plus synthetic audio fixture showed old Prism/Acid reaching 100% white, while all corrected presets had 0% fully white pixels and at most 0.1% two-channel clipping at 5/15/30 seconds. Regression explicitly uses shipped preset text (`a7358d9b`). Latest app suite: 308 passed, five ignored; explicit sustained fixture and native builds/isolation passed. Test-fix integration `a7358d9b` → `70d434b6`.

Final live corrected Acid tide check: native contours visible at Recognition 0, then left at Recognition 45 and Edge steadiness 85, 1080p H.264. No whiteout in the observed run. Current sampled output fell to 45–50 FPS under substantial concurrent machine load (unrelated processes left untouched); cannot promise sustained 60 on this final run. Snapshot/encode/decode timings all increased. No causal attribution or regression exclusion established. Screenshot `outputs/camera-stable-waveform.png` in the task workspace. Physical moving webcam/microphone remain untested. Both completed temporal/waveform worktrees removed after clean-state and integration audits; branches retained, older worktrees/shared target preserved. Unified server session11148 remains running; fresh token in log.

## 60 FPS implementation and evidence

- Camera-only reusable GPU readback texture/staging avoids per-frame allocation. Ordinary OpenFlow snapshots remain unchanged.
- Hardware-required VideoToolbox H.264, pooled BGRA buffers, Accelerate conversion, all-IDR Annex B packets. Absolute 60 Hz producer deadlines; at most two encodes pending and latest-only output. Stop/resize/idle release or invalidate owned resources.
- Browser WebCodecs decoder with one pending decode and one prefetched packet. Frames are explicitly closed; Stop/reset cancels work. Unsupported/failed encoding falls back to raw RGBA. No encoder dependency or camera code in production builds.
- Distinct native sequence IDs underpin rolling output FPS. Duplicate snapshots do not count. CPU contour/source preparation remains independently bounded at 30 Hz; camera requests 60 subject to hardware/browser availability. **60 output FPS is not 60 prepared camera frames per second.**
- Before encoding: raw 720p 59.9 distinct FPS; raw 1080p 48.2 FPS (10-second browser windows).
- Native 1080p hardware harness: 180/180 frames in 3.004 seconds, 59.93 FPS, zero pending drops. Integrated encoded endpoint: 180 frames in 3.003 seconds, 59.94 FPS, mean packet 171 KB (versus 8.29 MB raw).
- Integrated browser 1080p/photo/person-only: Chromatic 59.7, Prism 59.2, Acid 59.9 distinct FPS; Acid with synthetic PCM 59.7. 720p H.264 59.5. These are 10-second windows, not long-term guarantees.
- Stop/restart, resolution switching, raw/auto switching worked. Physical camera/microphone remain untested by agents; synthetic PCM verifies the native audio path only.
- One longer in-app-browser run fell to 56 FPS then its tab crashed; native server remained alive (~177 MB RSS). Cause is unproven. A fresh diagnostics baseline passed 8,010 frames at 59 FPS with all frames closed, zero live/orphaned frames, one decoder, 46.5 MiB JS heap.
- Latest separate experiment makes the output canvas opaque and clears it before encoded composition, to avoid possible deferred canvas retention. It is **not a proven crash fix**. Resource counters expose heap/frame/decoder ownership. No speculative decoder recycling was added.

Final opaque-canvas soak: more than five minutes at 1080p/photo/person-only, 18,720 decoded and 18,720 closed frames, zero live/orphaned frames, one live/created decoder, zero pending decode jobs at sampling. Latest rolling window 59.5 FPS; sampled windows 59.5–59.9. Heap fluctuated with collection (24.7–59.2 MiB sampled, final 32.6 MiB). No repeat crash during this bounded run. This does not establish the earlier crash cause or guarantee indefinite stability. A 20-second synthetic audio load completed (999 posts, cleared afterward). Screenshot: `outputs/camera-60fps.png` in the enclosing task workspace.

Validation: 308 Rust tests passed, four ignored; separate ignored native hardware harness exercised manually. Normal/lab native and UI builds, formatting, typecheck, production exclusion checks passed on source revisions. Latest frontend source: 73 targeted camera/bridge tests passed and rerun successfully in the coordinator (61 camera + 12 bridge). Independent review found no remaining actionable issues; unsupported-platform Stop/restart fallback issue was fixed and re-reviewed. Exact source/integrated path equality verified. Long-run browser stability and physical moving-camera quality remain acceptance boundaries.

## Next acceptance work

1. Continue sustained 1080p encoded testing, watching distinct native FPS and resource counters. Record any repeat crash without claiming a browser limit from one failure.
2. Ryan should try the real webcam and explicitly enable microphone/interface input. Confirm person recognition, foreground smoothness, audio response, moving H.264 quality and latency.
3. Heavy third-party presets may exceed the frame budget; the three camera presets are the measured set. No blanket 60 FPS guarantee for all 9,798 presets.

## Relevant code and protocol

- `app/src/dev/camera/main.ts`: controls, source generation/lifecycle, output/preparation pacing, compositor.
- `app/src/dev/camera/curve-contours.ts`: tracing/smoothing/vector drawing.
- `app/src/dev/camera/color-signal.ts`: colored emission and identity shading.
- Other camera modules: preset browser and microphone lifecycle; tests beside source.
- `app/src-tauri/src/bridge/camera.rs`: authenticated local catalog, settings, RGBA and PCM transport.
- `app/src-tauri/src/bench.rs`: native camera audio, renderer/output resize, snapshot.
- `docs/camera-preview.md`, `docs/camera-lab/runtime-v4.md`: usage and API contract.
- GET `/__bridge/camera/presets`, GET `/__bridge/camera/output` (raw), GET `/__bridge/camera/video?after=<sequence>` (H.264). Encoded response has native sequence/timestamp/dimensions/codec/timings; 204 means no fresh frame, 503 triggers fallback.
- `app/src-tauri/src/bridge/video.rs` and `video/hardware.rs`: bounded encoded producer and VideoToolbox ownership. Frontend `h264-decoder.ts`, `video-packets.ts`, `output-meter.ts`: decoding, bounded fetch, measured FPS.
- POST camera settings requires speed/persistence; accepts presetId and resolution. Preset IDs are catalog-allowlisted, never arbitrary client paths.
- POST `/__bridge/camera/audio?rate=48000&gain=1`: 512 or 1024 mono Float32 LE samples; bounded finite data/rate/gain; 250 ms expiry. POST `/__bridge/camera/audio/stop` silences it.
- Camera POST input remains bounded at 640×360; current preparation is 320×180. Foreground curves scale cleanly to output size; this is not a high-detail 1080p camera segmentation model.

## Preserved worktrees and mappings

The three older worktrees below remain preserved; do not discard unique or uncertain files. The four completed performance/H.264 worktrees from this turn were removed normally after clean-state, ignored-file, and exact integration checks; their branches remain. No assignment server remains; the coordinator preview is running.

- `work/camera-runtime`, branch `codex/camera-runtime`, source `1137b60d67bd5404dc893a10ecf022341d52fa57` → coordinator `a723a43d`.
- `work/camera-curves`, branch `codex/camera-curves`, source `32041dea19f9c7eb234a77143255e5ee793d9c33` → `f5754a40`.
- `work/camera-controls`, branch `codex/camera-controls`, source head `35b6308b4a8b53ecd9388048cefb5d304e300c44`.
- Frontend source `5bab32c3` → `2b1f6db6`; payload fix `79cd721a` → `d026b273`; rejection rollback `7266bfb5` → `c486f782`; startup fix `92081bf6` → `18d5f322`; performance `35b6308b` → `64ddeaa6`.
- Frontend local curve dependency `4b8276d` duplicates source `32041dea`; integrated only once.
- This turn source → integration: readback `f6e4c0af` → `21a10aa2`; metrics `972c3996` → `f8720c10`; H.264 backend `82c67da8` → `608c3a58`; H.264 frontend `f12d2a21` → `a0c1cbeb`; fallback fix `a9cc86a9` → `61454421`; fetch overlap `0a63c427` → `5660a245`; native pacing `897623d0` → `fe1cf13a`; diagnostics `3d9803e8` → `716cf50c`; opaque canvas `62b0d2c7` → `7609a48c`.
- Shared native build cache: `work/camera-target`. Coordinate exclusive ownership before simultaneous native builds.
- Detailed assignment ledger: `/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/coordination.md`.

## Unified launcher

From the coordinator directory, use the unified launcher only:

```sh
OPENFLOW_HOME=/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/camera-coordinator-state \
CARGO_TARGET_DIR=/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/camera-target \
VISUALS_CAMERA_LAB=1 VISUALS_DEV_OPEN=0 PORT=4286 STORYBOOK_PORT=6116 \
npm run dev
```

Read the fresh token from launcher output, then open `/camera.html?token=...`. Tokens from prior runs are expired. Use the photographic demo for agent verification. Never independently launch Vite/Storybook/native children to repair the preview.

Current preview was resumed under explicit user authorization. Leave the coordinator running for the user; stop only its identified launcher/process group when requested. Older stopped session IDs in prior handoff are historical.
