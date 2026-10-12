# Camera in visual[flow]

Open **Camera** from Home or Live. **Enable camera** requests video only; the
existing music input, presets, effects and output controls stay authoritative.
Camera is off at launch. Closing the sheet, changing views or switching presets
keeps it running. **Stop camera**, device loss, page teardown and errors release
capture and invalidate its native session. A permission grant or acknowledgement
arriving after Stop cannot restart it.

The defaults are camera image 0%, recognizable outline 65%, native edge feed 30%,
edge steadiness 85%, and person-only isolation. Camera opacity shows original RGB
with full mask alpha at 100%; outline opacity is independent of it and of edge
feed. **Bring my outline back** raises only outline opacity. Steadiness settles
small motion over about 220 ms; fast movement releases the filter. Curve smoothing
rounds individual contours. Both filters run at capture resolution, never full HD.

The App-mounted provider owns a persistent controller; the sheet only changes its
state. It captures 320×180 at no more than 30 submissions per second, with a centered aspect-preserving fit and transparent padding for 4:3 or portrait
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
Packaged WKWebView camera permission, offline worker/WASM loading and real webcam
appearance still require device acceptance. No physical capture is used by tests.
