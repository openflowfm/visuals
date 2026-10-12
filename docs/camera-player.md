# Camera in visual[flow]

Open **Camera** from Home or Live. The **Enable camera** toggle requests video only; the
existing music input, presets, effects and output controls stay authoritative.
Camera is off at launch. Closing the sheet, changing views or switching presets
keeps it running. Turning the toggle off, device loss, page teardown and errors release
capture and invalidate its native session. A permission grant or acknowledgement
arriving after Stop cannot restart it. The toggle can cancel a pending permission request.

**Source** includes the camera selector, person isolation, mirroring and noise
cutoff. The selector lists video inputs without opening them, starts with System
default camera, and refreshes labels after permission and on device changes.
Choosing a camera while off leaves it off. Changing cameras while on releases the
old capture first; the chosen device is requested exactly, with no silent fallback.
A missing selected device remains visible as unavailable. Native session changes
are serialized so late permission grants or native responses cannot revive an old
source. **Appearance** groups image/outline opacity and color; **Motion** groups
edge feed, steadiness and curve smoothing. The header uses the shared camera SVG
icon, and the panel uses the standard Settings surface and section spacing. Its
sliders use Zen’s shared Slider and parameter gestures, grouped with its standard
Group control. The sheet retains the app’s neutral opaque backing
because WebKit backdrop filtering cannot blur the separate native Metal surface.

The defaults are camera image 0%, recognizable outline 65%, native edge feed 30%,
edge steadiness 85%, and person-only isolation. Camera opacity shows original RGB
with full mask alpha at 100%; outline opacity is independent of it and of edge
feed. **Bring my outline back** raises only outline opacity. Steadiness settles
small motion over about 220 ms; fast movement releases the filter. Curve smoothing
rounds individual contours. Both filters run at capture resolution, never full HD.

The app creates its capture controller once and injects it into `VisualsApp` from
`@satoramoto/zen/visuals`. Zen owns the persistent provider and camera sheet; the
app retains capture, segmentation worker/model assets and binary IPC. The sheet
only changes controller state. It captures 320×180 at no more than 30 submissions per second, with a centered aspect-preserving fit and transparent padding for 4:3 or portrait
cameras. Padding boundaries are excluded from edge extraction. There is exactly
one acknowledgement in flight and no frame backlog. Decoded frame callbacks (or a decoded-frame counter fallback) must
advance to submit again, so stalled video cannot refresh native expiry. Callback age also reduces packet
freshness; capture fails readably if neither counter is supported. Person
masking runs locally in a worker, at most 10 Hz. Missing, failed or older-than-250-ms
masks fail closed. Mirror/person-only changes reset mask and temporal history and
increment the native source epoch. Stop releases the video tracks and worker.

Shared preparation/model/license files live in `app/src/camera`; the experiment
imports those same algorithms. Production contours are arc-length decimated to
4,096 points before temporal matching, preserving open endpoints and closed
paths. The binary transport still validates its 512-path / 8,192-point ceiling.
Each CAM1 packet atomically carries original masked RGBA plus colored stabilized
contour targets, opacity settings and remaining source/mask lifetime. See
[camera-app-contract.md](camera-app-contract.md). Native presentation interpolates
and draws both foreground layers; the browser does not decode native video or
paint an outline over the output. The ordinary native audio/preset path is shared.

Verification uses synthetic streams and images only: late permission/session/ack,
rejection, device loss, one-flight pacing, view/sheet persistence, stale masks and
video, independent opacities, geometry budgets, and exact binary envelopes.
Storybook checks the actual sheet controls without asking for any camera access.
The bundled worker/model/WASM completed synthetic inference in the native WebKit
app. Real webcam permission, appearance and sustained complete-system frame rate
still require device acceptance. Automated tests use synthetic capture. See the
[handoff](camera-handoff.md) for the manual-check audio isolation correction.
