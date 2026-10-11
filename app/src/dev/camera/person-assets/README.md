# Local person-mask assets

Camera frames are inferred in a browser worker using the CPU delegate. No inference
service, remote CDN, or image upload is used. Runtime JS/WASM comes from the pinned
`@mediapipe/tasks-vision` 1.1.0 npm dev dependency. This directory is imported only by
the development camera experiment, not the shipping app.

Model: Google MediaPipe Selfie Segmenter Landscape, float16, version 1 (256×144).
One confidence output channel represents foreground/person probability.
Downloaded from https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite
SHA-256: `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e`.
MediaPipe is Copyright Google LLC, Apache-2.0; license is preserved beside the model.
Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter

`astronaut.png` is the public-domain NASA photograph of Eileen Collins, sourced
unchanged from scikit-image v0.25.2:
https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/astronaut.png
Fixture provenance: https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut
Only this photograph is used for automated/agent visual checks; no user's camera.
