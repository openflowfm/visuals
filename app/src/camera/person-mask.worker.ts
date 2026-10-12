import { ImageSegmenter } from '@mediapipe/tasks-vision';
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import binaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import modelUrl from './person-assets/selfie_segmenter_landscape.tflite?url';

// Emscripten's ES-module loader runs inside the worker; no CDN and no UI-thread inference.
async function initialize() {
  const segmenter = await ImageSegmenter.createFromOptions(
    { wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl },
    {
      baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
      canvas: new OffscreenCanvas(256, 144),
    },
  );
  self.onmessage = ({ data }: MessageEvent<{ image: ImageBitmap; timestamp: number }>) => {
    const start = performance.now();
    try {
      segmenter.segmentForVideo(data.image, data.timestamp, (result) => {
        // This model has one output channel: foreground confidence, not background.
        const source = result.confidenceMasks?.[0];
        if (!source) throw new Error('Selfie model returned no confidence mask.');
        // Callback memory expires on return; copy once and transfer ownership.
        const confidence = source.getAsFloat32Array().slice();
        self.postMessage(
          { type: 'mask', mask: { data: confidence, width: source.width, height: source.height, inferenceMs: performance.now() - start, capturedAt: data.timestamp } },
          { transfer: [confidence.buffer] },
        );
      });
    } catch (error) {
      self.postMessage({ type: 'error', error: String(error) });
    } finally {
      data.image.close();
    }
  };
  self.postMessage({ type: 'ready' });
}
void initialize().catch((error) => self.postMessage({ type: 'error', error: String(error) }));
