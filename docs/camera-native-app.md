# Native camera presentation

The production player accepts bounded atomic `CAM1` submissions through `camera_begin`, `camera_submit`, and `camera_end`. See [the IPC contract](camera-app-contract.md). The renderer thread owns session ordering, sequence acceptance and freshness deadlines. An old session cannot upload or stop a replacement session. Packet validation finishes before renderer mutation. A stale frame removes camera foreground and future contour emission without resetting the preset's existing trails.

The existing native audio ring, gain, deck speed, effects, preset selection and window sizing remain authoritative. Camera commands never select an audio device, replace audio samples, resize an output or clear preset feedback. The older experimental camera commands remain development-only and separate.

Contours replace the basic waveform in recursive feedback. Photo and recognizable outline are independently composed onto temporary presentation textures; neither enters recursive feedback. Both current and outgoing preset images receive the same foreground before the existing master pass, so preset transitions retain the person and blackout still affects everything. This path serves the native preview, fullscreen output and native captures. With no camera, the ordinary presentation path is unchanged.

The photo is straight-alpha, masked RGBA. Photo, foreground outlines and initial recursive contour emission share a centered aspect fit; portrait and square outputs do not squeeze the person. Native outline interpolation matches target points to nearby segments of the currently displayed geometry within six source pixels, with a bounded spatial index. Target topology is authoritative: disappearing paths disappear immediately, new unmatched paths appear in place, and unrelated path ordinals are never paired. A source epoch change discards correspondence. Interpolation advances once per real render tick independently of preset speed or the number of windows being presented.

## Verification

At code revision `5d456aa26c6384233765360d1d17b5351ed0b50a`:

- Real Metal engine tests: 155 passed; one manual performance fixture ignored by the normal suite.
- Engine bin tests: 33 passed. Standard 250-preset starter GPU sample: 250 own shaders, zero fallback/failure.
- Normal and lab/dev-bridge native builds, formatting, and normal UI/binary no-dev-code guard passed.
- Native app tests with `dev-bridge`: 310 passed; five existing manual fixtures ignored. This includes native audio/deck tests, packet/session tests, GPU snapshot and hardware encoder tests.
- GPU fixtures check independent photo/outline opacity, asymmetric source orientation, blackout, outgoing transitions, no foreground contamination of comp/feedback, expiry, portrait aspect fit and immediate resizing, aligned recursive/foreground contours, and exact ordinary output after disabling.
- Initial sandbox-only runs could not access Metal, hardware encoding or loopback fixtures. The reported passing native runs used those host capabilities. No camera/microphone capture or development server was started.

## 1080p fixture timing

Manual command: `cargo test -p visuals-engine --lib person_camera_1080p_performance -- --ignored --nocapture` with Metal access. A simple Spiral preset draws at 1920×1080, uses synthetic audio, uploads camera geometry and a 320×180 RGBA image every other tick, and presents once per tick. Thirty warmup ticks precede 120 measured ticks. Each tick waits for GPU completion, so timings include completed render/presentation work rather than queue submission alone. Photo opacity 35%, outline 65%, feedback 30%.

| Contour points | Mean tick | p95 tick | Maximum | Throughput |
| --- | ---: | ---: | ---: | ---: |
| None | 2.16 ms | 3.26 ms | 4.66 ms | 463.7 fps |
| 2,048 | 4.93 ms | 8.28 ms | 16.37 ms | 203.0 fps |
| 4,096 | 6.40 ms | 11.01 ms | 12.05 ms | 156.3 fps |
| 8,192 | 10.82 ms | 18.35 ms | 19.06 ms | 92.4 fps |

These are a local fixture run under ordinary machine scheduling, not a universal or end-to-end 60 fps claim. Capture, segmentation, IPC parsing, complex presets and a second fullscreen surface are outside this measurement. The 8,192-point protocol maximum exceeds a 16.7 ms frame budget at p95; a 4,096-point production budget leaves more room for capture and segmentation. Nearby runs showed scheduling variation (2,048-point p95 6.20–11.83 ms).

## Packaged WebKit smoke hook

Debug, headless captures can set `VISUALS_SHEET=camera` to open the Camera sheet without enabling a device. The bounded retry ends after five seconds or a dialog appears. With `VISUALS_CAMERA_WORKER_SMOKE=<bundled-worker-basename.js>`, the same guarded hook loads that local worker and submits a synthetic gray OffscreenCanvas. A capture-visible PASS reports the returned mask dimensions and inference time; ERROR/TIMEOUT remains visible on failure. The basename is restricted to ASCII letters/digits, dash, underscore and dot. The hook never requests a camera or microphone and is absent from release builds.

Real packaged webcam permission, device loss and actual capture performance still require device acceptance; synthetic model inference is a separate boundary.
