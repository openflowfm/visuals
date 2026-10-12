# Development camera fixture

The shared model and license live in `app/src/camera/person-assets`.

`astronaut.png` is the public-domain NASA photograph of Eileen Collins, sourced
unchanged from scikit-image v0.25.2:
https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/astronaut.png
Fixture provenance: https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut
Only this photograph is used for automated/agent visual checks; no user's camera.

## Verification

Open `/camera-mask-smoke.html?token=<launcher token>` with the unified dev launcher.
It performs 30 inferences on the NASA photograph, shows source and confidence mask,
and reports a face sample, distant-room sample, and average worker inference time.
On 2026-10-11 in the Codex in-app browser: mean 7.83 ms, face confidence 1.0,
room confidence 0.0. This is a static-photo CPU inference measurement, not end-to-end
webcam or native feedback performance. The face/body mask was also inspected visually.
The lightweight model can retain held objects and uncertain background boundaries;
it is not a perfect matte. No physical webcam was accessed.
