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
- **Echo tunnel**, **Mirror cathedral**, and **Liquid wire** are camera-specific
  presets designed for recursive outlines rather than music-only imagery.
- **Fresh camera** is the new image's blend per preset step. Low values give the
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
