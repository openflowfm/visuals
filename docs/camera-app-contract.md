# Camera in the player

Camera is a global optional input, opened from Home or Live in the existing sheet shell. App mounts CameraProvider once; closing the sheet or changing views/presets does not stop capture. Enable is explicit and requests video only. Disable, track loss and app teardown release tracks and invalidate the native session. The existing audio input, preset library, deck effects and output configuration remain authoritative.

Shared modules live in app/src/camera. The development experiment imports them; production never imports app/src/dev. Model/worker assets are bundled locally with their licenses.

## IPC v1

- camera_begin() returns an opaque session token string; replacing a session clears only camera state.
- camera_submit(raw body) atomically accepts geometry and image, returning the accepted sequence (u32, starts at 1). Only one acknowledged submission may be in flight; there is no backlog.
- camera_end({sessionToken}) invalidates that session; an old token cannot stop a newer session. Late uploads are rejected.

The binary body is ASCII CAM1, u32 little-endian JSON byte length, UTF-8 JSON metadata (CameraFrame in app/src/camera/api.ts), then tightly packed straight-alpha sRGB RGBA, top row first. Always exactly width*height*4 bytes even at zero camera opacity. Maximum width640,height360,512paths,8192points,JSON1MiB,total2MiB; all numeric values finite. sourceEpoch and sequence are u32. Opacities and feedMix are0..1, outlineWidth is0.25..4 source pixels, interpolationMs is0..100ms. Dimensions are positive, coordinates lie in their source rectangle and RGB is normalized0..1.

remainingFreshMs is0..250 from the source/mask capture age; native records receive time before queuing, never compares cross-process clocks. Expiry clears camera foreground and stops new emission. sourceEpoch changes reset prior geometry/image correspondence (mirror/isolation/source changes). Invalid packets do not partially mutate state. End never resets audio, preset feedback, trails, speed or output sizing.

Contours replace the basic waveform at its existing recursive stage. Recognizable outlines and the original masked camera image are separate foreground layers with independent opacity, composed into a separate presentation texture before master fade/blackout. They must appear in bench, fullscreen output and native captures, without entering recursive feedback. Native presentation interpolates target contours with bounded spatial correspondence, never ordinal path pairing; topology appearing/disappearing is immediate. No camera preserves the ordinary renderer path.

Defaults: camera image0%, outline65%, feed30%, stabilization85%, person only. The native player presents directly through Metal; it does not use the experiment's H.264 output transport. Camera does not select a preset or replace the user's audio input. Production acceptance must cover permission denial/late grants/device loss and offline packaged WKWebView model/capture compatibility separately from fixture tests.
