# Camera feature handoff — 2026-10-12

## Current state

The camera experiment is integrated into the actual visual[flow] player on
`codex/camera-coordinator`. Persistent checkout:
`/Users/ryan/Documents/Codex/2026-10-11/i-wa/outputs/camera-lab`.
It is a local clone of `/Users/ryan/Code/openflowfm/visuals`; original main is
untouched. Nothing has been pushed or published.

**The development server remains stopped.** Previous camera.html URLs and tokens
are historical. Do not restart the browser experiment unless requested.

Open **Camera** from Home or Live. Camera starts off; **Enable camera** requests
video only. Choose a device in **Source**; camera labels refresh after permission
and when devices change. Closing the panel or changing views/presets keeps capture
active; switching **Enable camera** off releases it and cancels pending startup. Existing native audio selection, preset library,
performance controls and fullscreen output remain authoritative.

## User direction and implementation

Ryan wants a recognizable person shedding strong psychedelic trails, with the room
removed, independently adjustable camera-image and outline opacity, much smoother
edges, sound reactivity, high-resolution output and a 60 FPS target.

- Defaults: camera image 0%, outline 65%, edge feed 30%, steadiness 85%, person only.
- Local person segmentation worker; no remote image processing. Model, WASM and
  license ship with the app. Missing/stale masks fail closed.
- Source processing is bounded at 320×180 and 30 submissions/second. Decoded-frame
  freshness, mask age and native expiry prevent stalled images lingering. Capture
  preserves actual camera aspect ratio and transparent padding.
- Production geometry is bounded to 4,096 points before temporal matching. Strong
  temporal stabilization plus native spatial interpolation reduces jitter without
  pairing unrelated path ordinals. Synthetic small-jitter RMS fell about 92%.
- Colored contours replace the native basic waveform inside recursive feedback.
  Photo and recognizable outlines are separate native presentation layers, with
  independent opacity, before master effects. Both appear in preview/fullscreen
  output, obey blackout and preserve proportions on portrait outputs.
- Atomic binary CAM1 packets carry image and geometry together. Sessions,
  increasing sequences, source epochs, one acknowledged upload in flight and
  freshness deadlines handle Stop/restart, late permission grants and device loss.
- Actual-app output goes directly through Metal: no H.264 round trip is needed.
  The development-only browser demo retains its encoded transport and preset UI.

Guides: [player](camera-player.md), [native evidence](camera-native-app.md),
[IPC contract](camera-app-contract.md), [browser experiment](camera-preview.md).

## Camera controls follow-up

The panel now groups controls into Source, Appearance and Motion, with a frosted
surface and slim glass slider tracks/handles. Camera and outline opacity remain
independent. The selector uses an exact device ID when a camera is chosen; active
switches release the old stream and serialize native session transitions. Late
permission grants cannot revive a canceled source. Selecting while off never
starts capture. A missing selected camera is shown as unavailable, without silently
switching to another device.

The glass material uses layered tints/reflections and CSS backdrop filtering for
page content. WebKit cannot blur the native Metal surface behind it.

## Verification

The camera-controls follow-up passed 57 camera tests, typecheck, formatting,
normal/lab UI builds and the production isolation guard. Both updated Chromium
stories pass, including keyboard device choice, toggle behavior and slider
endpoint/rail alignment. Review found no remaining actionable issues. A fresh
local debug app bundle was built; a silent offscreen WebKit capture verified the
glass panel, corrected tracks and readable status text at
`outputs/camera-glass-panel.png`. The app exited with zero audio peaks and no
physical camera/microphone input. Real hardware switching remains untested.


Reviewed native and UI implementation plus aspect-ratio fixes; no remaining
reported findings. Combined UI checks: 129 targeted tests, typecheck, formatting,
normal/lab builds and production isolation. Feature-owner stories: 12 Chromium
stories across Camera/Home/Live; subsequent compact-panel checks: 3 DOM tests and
2 Camera stories. Native: 155 engine tests, 33 bin tests, 312 app tests; manual
fixtures excluded from those counts. Starter GPU sample: 250/250 own shaders,
no fallback/failure. Normal and lab/dev-bridge native builds and no-dev-code checks
passed.

The 1080p native fixture with 4,096 points measured 6.40 ms mean / 11.01 ms p95.
It excludes capture, segmentation, IPC, complex presets and a second output.
**This is not an end-to-end 60 FPS guarantee.** The 8,192-point protocol maximum
exceeded the frame budget at p95, which is why production uses 4,096.

A headless built-app check loaded the bundled worker/model under WebKit and returned
PASS: 256×144, 36,864 confidence values. The initial synthetic inference was
32 ms; the final silent run was 51 ms (single samples, not steady-state averages).
The final UI image is `outputs/camera-app-panel.png` in the task workspace; it
shows the off state, all controls and the worker PASS. Audio peaks stayed zero,
no input was opened, the process exited and ports4286/6116 were closed. No physical
webcam was accessed. Real webcam permission, appearance, unplugging/reconnection
and sustained complete-system FPS remain user-device acceptance items.

The first manual headless UI run unexpectedly opened the default microphone:
SourcePicker polling called the existing audio-follow path despite bypassing
startup resume. The run exited; no audio recording was saved. The issue was
reported to Ryan. The fixture now blocks audio at the acquisition boundary, tested
against resume, repeated polls, explicit choices and low-level device/tap paths.
This applies only to debug + headless + Camera-sheet fixture runs; normal app
sound behavior is unchanged.

## Local build

A local ad-hoc signed debug app is available at
`/Users/ryan/Documents/Codex/2026-10-11/i-wa/work/camera-target/debug/bundle/macos/visual[flow].app`.
It includes the camera usage description and camera/audio entitlements, verified
from the built bundle. The normal bundle/page pass the no-dev-code guard. It was
not installed over the existing app or notarized/published. A window-server
screenshot from the bundled executable returned no image; the same freshly built
standalone binary completed the final UI-only capture and synthetic worker check.

## Safe follow-up checks

Use an isolated `OPENFLOW_HOME` with `visuals/first_run.json` containing
`{"done":true}` and `visuals/access.json` containing
`{"reduce":true,"flash_warning_understood":true}`. For a freshly built debug
binary, set `VISUALS_HEADLESS=1`, `VISUALS_SHEET=camera`,
`VISUALS_CAPTURE_UI_ONLY=1`, `VISUALS_CAPTURE=<absolute PNG path>` and
`VISUALS_CAPTURE_AFTER=25`. The fixture guard prevents audio acquisition.
`VISUALS_CAMERA_WORKER_SMOKE=<bundled person-mask.worker-*.js basename>` additionally
exercises synthetic local inference. The app captures its own offscreen window
and exits; no server or physical capture is needed. Never rely on null audio
settings alone to keep a normal app launch silent.

For actual webcam acceptance, Ryan should open the built app, select Camera,
choose a camera and switch Enable camera on, then verify camera opacity 0 with outline/trails visible, the two
opacity controls independently, stabilization, normal audio input, preset changes,
Home/Live persistence and fullscreen output. Use the existing native quality
controls for output performance. Do not auto-enable capture from an agent check.

Implementation and integration mappings are in the task's `work/coordination.md`.
Older camera-controls/camera-curves/camera-runtime worktrees remain preserved.
