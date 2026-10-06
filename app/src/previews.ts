import { useEffect, useRef } from 'react';
import * as api from './api.ts';

/**
 * Stage pictures from the engine, drawn into the canvases on node faces.
 *
 * One poll for all of them: the engine packs every stage's picture into one
 * buffer, so a frame of previews is one round trip however many nodes show one.
 */
const canvases = new Map<HTMLCanvasElement, number>();
let running = false;

async function loop() {
  running = true;
  await api.setPreviews(true);
  while (canvases.size > 0) {
    const started = performance.now();
    const buffer = await api.previews().catch(() => new ArrayBuffer(0));
    const { width, height, count } = api.PREVIEW;
    const each = width * height * 4;
    if (buffer.byteLength === each * count) {
      for (const [canvas, which] of canvases) {
        const pixels = new Uint8ClampedArray(buffer, each * which, each);
        canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0);
      }
    }
    // About fifteen a second: enough to read a stage, little enough to cost nothing.
    await new Promise((r) => setTimeout(r, Math.max(0, 66 - (performance.now() - started))));
  }
  await api.setPreviews(false);
  running = false;
}

/** A canvas showing stage picture `which` (`PREVIEWS` order). */
export function usePreview(which: number | undefined) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || which === undefined) return;
    canvases.set(canvas, which);
    if (!running) loop();
    return () => {
      canvases.delete(canvas);
    };
  }, [which]);
  return ref;
}
