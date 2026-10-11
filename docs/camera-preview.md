# Camera possession (experimental local preview)

A dev-only browser instrument feeds RGBA camera frames into the native OpenFlow
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

Click **Run demo** for an animated synthetic test subject, or **Start camera**
to ask the browser for video permission. Audio is never requested. Nothing
starts the camera automatically. **Stop** and leaving the page
release the browser's camera tracks. The native source expires after two seconds
without frames and clears its feedback. Switching tabs keeps the experiment
running (browser background throttling may still expire the native source). The browser sends images only to the
authenticated loopback dev bridge; there is no remote upload or recording.

- **Liquid identity**: Rovastar's Harlequin's Liquid Dragon.
- **Molten mind**: Krash and Fvese's Molten Indecision (Fvese Remix).
- **Psychotrip**: Pithlit's Spinning colours mix / orthorotate recursive helicities3.
- **Fresh camera** is the new image's blend per preset step. Low values give the
  feedback more room to deform. Zero allows existing imagery to evolve alone.
- **Afterimage** uses the engine's existing brightness-preserving trails effect.
- **Speed** changes the preset clock, and therefore also the camera-injection rate.
- **Mirror source** mirrors incoming imagery. **Bring my face back** increases the
  incoming share for one second. Full screen enlarges the processed output.

The input is center-cropped to 640×360 and sent at up to 15 fps, one acknowledged
frame at a time. The returned preview is 960×540 WebP, requested at up to 20 fps;
the displayed FPS measures returned native frames, not camera uploads. CPU GPU
readback and WebP encoding constrain cadence. This is a prototype for visual
experimentation, not a low-latency transport for production streaming.

`Renderer::set_camera_frame` is optional and validates dimensions/bytes/mix.
The engine allocates no camera GPU resources until called. A zero mix adds no
render pass. Injection happens after warp and before blur/drawing, including
fractional refreshes. No camera endpoint or page enters production app builds.

Automated GPU tests cover orientation, actual recursive feedback and exact
ordinary-render equality at zero mix. Browser acceptance uses the synthetic
source; real camera permission and physical-camera behavior require a user test.
