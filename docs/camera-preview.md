# Camera possession (experimental local preview)

A dev-only browser instrument isolates the person and feeds denoised contour frames into the native OpenFlow
MilkDrop feedback loop, then displays its returned GPU frames in the browser.
This is a local live preview, not a virtual webcam device or a hosted service.

Run the existing unified launcher from this checkout:

```sh
VISUALS_CAMERA_LAB=1 OPENFLOW_HOME="$PWD/work/camera-state" PORT=4287 STORYBOOK_PORT=6117 VISUALS_DEV_OPEN=0 npm run dev
```

Open the URL it prints, replacing `/` before `?token=` with `/camera.html`.
Keep the token. The launcher owns the headless app, Vite and Storybook; stop it
as a whole with Ctrl-C. `OPENFLOW_HOME` keeps the experiment's app settings away
from your everyday OpenFlow state. `VISUALS_CAMERA_LAB=1` prevents the native
app from resuming any saved microphone or system-audio source in this dev run.

Click **Run demo** for a gently moving NASA portrait of Eileen Collins, or **Start camera**
to ask the browser for video permission. Audio is never requested. Nothing
starts the camera automatically. **Stop** and leaving the page
release the browser's camera tracks. The native source expires after two seconds
without frames and clears its feedback. Switching tabs keeps the experiment
running (browser background throttling may still expire the native source). The browser sends images only to the
authenticated loopback dev bridge; there is no remote upload or recording.

- **Person only** is on by default. A pinned local MediaPipe model runs in a
  browser worker at up to 10 inferences/second. The latest foreground confidence
  mask removes the room; results older than 250 ms are rejected until fresh
  inference arrives. Mirror and isolation changes drain in-flight uploads/output,
  clear browser images and native feedback, then reacquire a matching mask.
  The mask's outer silhouette and strong internal edges feed the
  effect at up to 30 fps. No frame uploads before the first valid mask. Model
  failure pauses injection and offers an explicit whole-scene choice; it never
  silently labels the room as a person-only result.
- **Contours** converts the isolated person to narrow bright edges on black.
  **Raw camera** keeps the color image (still isolated when Person only is on).
  The small **Input to the loop** preview shows the actual pixels being uploaded.
- **Edge detail** controls denoising; lower removes fine textures. **Noise cutoff**
  rejects weaker edges. Raise it for a noisy room; lower for a dimly lit face.
- **Chromatic vortex**, **Prism cult**, and **Acid tide** are camera-specific
  presets: a spinning RGB-split wormhole, sixfold prismatic symmetry, and liquid
  chromatic ribbons. All motion and color separation run in native MilkDrop shaders.
- **Edge feed** (Camera feed in raw mode) is the new image's blend per preset step. Low values give the
  feedback more room to deform. Zero allows existing imagery to evolve alone.
- **Afterimage** uses the engine's existing brightness-preserving trails effect.
- **Speed** changes the preset clock, and therefore also the camera-injection rate.
- **Mirror source** mirrors incoming imagery. **Bring my face back** increases the
  incoming share for one second. Full screen enlarges the processed output.

The input is center-cropped to 320×180. A separable denoiser and thinned Sobel
filter reuse bounded CPU buffers. Input uploads and native-output fetches each
allow only one request in flight and target 30 fps without queuing old frames.
The raw native output uses `GET /__bridge/camera/output`: RGBA8 top-to-bottom,
`X-Frame-Width` and `X-Frame-Height` headers, exact byte-length validation, then
`ImageData` directly into the display canvas. There is no WebP encode/decode.
The FPS indicator counts returned native output; the input thumbnail label shows
local preparation time. Camera acquisition asks for at most 30 fps.

A Node benchmark of 120 masked 320×180 contour frames measured 3.34 ms median,
4.63 ms p95 on the development Mac. This excludes camera readback, worker
inference, bridge transport and native rendering; browser end-to-end timing must
be measured separately. The local worker uses CPU inference asynchronously.

The photo demo goes through the same real person model and contour filter as
camera input, with room texture, skin shading and clothing instead of a neon
cartoon. It never requests webcam permission. Photo/model provenance and license
are in `app/src/dev/camera/person-assets/README.md`.

`Renderer::set_camera_frame` is optional and validates dimensions/bytes/mix.
The engine allocates no camera GPU resources until called. A zero mix adds no
render pass. Injection happens after warp and before blur/drawing, including
fractional refreshes. No camera endpoint or page enters production app builds.

Automated GPU tests cover orientation, actual recursive feedback and exact
ordinary-render equality at zero mix. Browser acceptance uses the public-domain photo fixture; real camera permission
and physical-camera behavior require a user test. Filter tests cover grain
rejection, low-contrast contours, background removal and dark silhouettes. DOM
regressions cover permission/lifecycle races, mask failure without silent fallback,
and invalid raw native output.

## Spectral identity (revision 3)

Following satoramoto/web's Tree Museum strategy, one prepared source drives both
native feedback and a crisp foreground. Colored contours are the actual RGB bytes
uploaded to MilkDrop, not a tint on the returned picture. **Color** sets their
saturation (zero returns silver contours). A gently traveling palette varies with
vertical position and subject luminance. **Camera opacity** mixes the lightly
posterized camera image above the native output; **Outline opacity** independently
adds recognizable edges. Camera opacity defaults to zero and skips the camera-image
draw entirely. Set both to zero to expose the native loop alone. **Bring my face
back** briefly boosts only the outline, without restoring the camera image or
changing Edge feed. Raw comparison omits these foreground layers.
The foreground is committed only after its matching upload succeeds. It is cleared
on stop, mode, mirror or isolation changes and after 250 ms without a fresh mask.
Both products use the same 320×180 source; only Canvas scaling/compositing runs at
output resolution. The presets are original camera-specific .milk files, with no
changes to the ordinary OpenFlow render path.

## Live browser, curves, HD and sound (revision 4)

The floating preset dock opens a searchable thumbnail browser for the installed
native catalog plus the three camera presets. Previous/next and random work within
the search results; arrow keys travel when focus is outside a form control. Preset
loads are serialized and superseded pending choices are skipped. Errors remain in
the browser. Cycling keeps the camera and microphone alive.

The default output is native 1280×720. Choose 1920×1080 for full HD or 640×360 for
throughput. Returned dimensions control the canvas buffers; these are actual native
render sizes, not a CSS upscale. Preparation stays at 320×180: filtered edges become
bounded, smoothed paths once per frame, rasterized for colorful feedback and drawn
again as curves at the actual output resolution. The recognition plate retains
restrained facial shading without the former bright raster outline underneath.
**Curve smoothing** trades detail for flowing strokes. This is traced geometry,
not semantic facial reconstruction; features absent from the source cannot return.

**Enable audio** explicitly requests a microphone or audio interface input. Choose
an input after permission reveals device labels, and adjust Sensitivity while
watching the input meter. Browser audio is never connected to speakers. Mono
1024-sample Float32 little-endian snapshots, at the actual context sample rate,
reach the native analyzer at at most ~30 Hz with one request in flight. The demo is
silent until audio is enabled. Disable audio, Stop, input disconnection and page
exit release the browser tracks/context and reset native sound after draining a
pending upload. Source preparation changes preserve audio. Physical-device
permission and hardware routing still require the user's test.

Output requests now target 60 Hz deadlines with a single request in flight, rather
than sharing the preparation loop's 30 Hz timer. Camera acquisition asks for up to
60 Hz, while CPU segmentation/contour preparation remains independently bounded to
30 Hz (person inference remains decimated). The stage reports completed **output**
frames, and the prepared thumbnail reports accepted **input** uploads separately.
No duplicate redraws are counted as native frames. **Show timing breakdown** reveals
mean header/fetch wait, response-body transfer and composition time, plus preparation
and upload time, over each reporting interval. This exposes transport/render costs
without assuming the browser is the bottleneck. A requested 60 Hz camera or uncapped
output loop is not evidence of achieved 60 FPS; measure each resolution/preset.

Distinct-frame measurement uses the runtime's monotonic `X-Frame-Sequence`, which
increments after an actual native render, including interpolated refreshes, and
not after a snapshot. Repeated IDs contribute zero additional native frames; gaps
in IDs do not invent frames the browser never received. **Show timing breakdown**
includes a rolling ten-second distinct-frame mean and its actual sampling duration,
plus mean `X-Snapshot-Ms` reported by the native snapshot path. Resolution, accepted
preset and source changes start a fresh sample. Without valid frame IDs the UI
explicitly reports reads/second and says native FPS is unavailable. Identity can
still be recomposited onto a duplicate response without counting a new native frame.

## Hardware-encoded output

**Output transport → Auto** uses the native hardware H.264 stream when this browser
supports the negotiated High-profile decoder. The browser checks the actual codec
profile from `X-Video-Codec`, receives independent Annex-B keyframes with SPS/PPS,
and decodes one frame at a time through WebCodecs. Every decoded `VideoFrame` closes
after composition; Stop, page exit and decoder failures also dispose the decoder.
Decode stalls are bounded. A 204 response means no new frame and contributes no FPS;
unsupported service/codec or decode failure visibly falls back to raw RGBA.
**Raw RGBA → comparison** retains the original path. Changing transport resets the
rolling measurement; encode and decode timing appear alongside snapshot, transfer
and composition costs. FPS is recorded only after decoding and composition.

Browser hardware preference is not proof of its chosen decoder implementation.
Measure the ten-second distinct-frame rate for each resolution/preset. This transport
does not change the 320×180 contour preparation budget or request camera/microphone
permission automatically.

Encoded transport overlaps one prefetched packet with the current decode. The slot
holds at most one request or completed packet; there is still only one decoder job.
Each next request asks for a sequence newer than the packet being decoded, so it
cannot flood the independent-frame producer. Stop, source reset, raw comparison
and decode fallback abort and drain that slot. The timing display distinguishes
critical-path **packet wait** from total fetch time: fetch now overlaps decoding,
so adding those two service times does not give the presentation interval.

The opt-in timing panel also shows JS heap when the browser exposes
`performance.memory`, cumulative decoded/closed video-frame counts, orphan callback
frames, live/created decoder counts and pending decode jobs. Frame tracking uses a
WeakSet and cannot keep decoded surfaces alive. During steady playback the ownership
balance should return to zero after each composed frame, with one decoder and no
queued decoder job at the reporting instant. Stop should leave no live decoder.
These counters expose application ownership; they cannot measure internal browser,
GPU or driver allocations. A crash without growing application balances still needs
browser/process evidence. No periodic decoder recycling is enabled merely to hide
an unexplained stability problem.

The output canvas requests an opaque (`alpha: false`) backing store. Encoded frames
clear and replace the full canvas before foreground composition; Stop remains black.
This is a controlled experiment intended to reduce deferred canvas/video-surface
retention under occlusion and resize. It is not evidence that retained GPU surfaces
caused the observed browser crash, nor a verified crash fix; compare resource/process
measurements and a sustained soak against the preceding diagnostics-only revision.

## Temporal edge steadiness

**Curve smoothing** rounds each frame spatially; **Edge steadiness** additionally
calms motion between frames. Stabilization projects current vertices onto nearby,
similarly oriented prior segments through a bounded spatial grid, independent of
path order or topology. The default 85% uses a 220 ms settling time constant for
small motion. Matching extends to six input pixels, with faster response between
three and six pixels and immediate response beyond the matching radius. This
intentionally trades some motion latency for calmer two-to-three-pixel jitter.

The native feed and prepared view receive the stabilized geometry. The foreground
interpolates matched geometry at output cadence over 50–85 ms, retargeting from its
currently displayed positions. It does not blend whole images or pair unrelated
paths by index. Removed edges disappear immediately; new unmatched edges appear
immediately. Gaps over 150 ms and stale-mask, Stop, source, mirror and mode resets
discard history. Interpolation does not extend the source's 250 ms freshness limit.
Work stays at 320×180 with at most 512 paths / 8,192 points; output remains independent.

Contour mode sends paths as colored native waveform geometry through
`POST /__bridge/camera/contours`, rather than uploading an opaque raster image.
The payload contains source dimensions, mix and whole open/closed paths with
normalized palette colors per vertex. Serialization independently enforces the
512-path / 8,192-point limit, dropping whole excess paths rather than truncating a
closed loop. Vertex colors come from the palette, never from black/antialiased edge
pixels. Raw camera comparison retains the RGBA frame route.

The default balance is **Camera opacity 0%**, **Outline opacity 65%**,
**Edge feed 30%**, and **Speed 0.4×**: recognizable edges shedding native trails
without the camera image. Both foreground opacities are independent of native feed.

Synthetic validation at 30 Hz reduced stationary alternating ±2/±3-input-pixel
jitter RMS by 92.4%/92.1% at the default steadiness. A local Node benchmark of
stabilization plus display retargeting measured median/p95 1.17/1.82 ms at 2,000
points and 4.74/7.96 ms at 8,000 points. Display sampling alone measured median
0.035/0.139 ms respectively. These are synthetic CPU measurements, excluding edge
extraction, masking, native rendering and canvas drawing; they do not establish
physical-webcam appearance or browser frame rate. Regression tests cover midpoint
interpolation, reordered paths, resets, removal, independent opacity and Rescue.
