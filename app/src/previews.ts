import { useEffect, useRef } from 'react';
import * as api from './api.ts';

/**
 * Stage pictures from the engine, drawn into the canvases on node faces.
 *
 * One poll for all of them: the engine packs every stage's picture into one
 * buffer, so a frame of previews is one round trip however many nodes show one.
 * The engine reads them back every other preset step (fifteen a second at 1×,
 * following the speed), and this polls at about that rate.
 */
const canvases = new Map<HTMLCanvasElement, number>();
let running = false;

/** The first layer picture (`PREVIEWS` order): the ones before are the chain's. */
export const FIRST_LAYER = 4;
/** The picture a layer draws into: the warp's output, the frame before any layer. */
export const UNDER = 0;
/** How bright that frame shows under a layer's drawing. */
export const DIM = 0.45;
/** The most a faint drawing is brightened by. */
export const MAX_GAIN = 8;

/**
 * A layer's picture as its node shows it: the drawing, brightened so its
 * brightest channel reaches full (at most `MAX_GAIN`×), over the frame it draws
 * into at `DIM`. Alone on black a thin wave or a small shape is mostly black;
 * over the frame it reads where it lands, and the gain makes a faint one seen.
 */
export function layerOver(layer: Uint8ClampedArray, under: Uint8ClampedArray, out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(layer.length)): Uint8ClampedArray<ArrayBuffer> {
  let peak = 0;
  for (let i = 0; i < layer.length; i += 4) peak = Math.max(peak, layer[i], layer[i + 1], layer[i + 2]);
  const gain = peak > 0 ? Math.min(MAX_GAIN, 255 / peak) : 1;
  for (let i = 0; i < layer.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = under[i + c] * DIM + layer[i + c] * gain;
    out[i + 3] = 255;
  }
  return out;
}

async function loop() {
  running = true;
  await api.setPreviews(true);
  while (canvases.size > 0) {
    const started = performance.now();
    const buffer = await api.previews().catch(() => new ArrayBuffer(0));
    const { width, height, count } = api.PREVIEW;
    const each = width * height * 4;
    if (buffer.byteLength === each * count) {
      const picture = (which: number) => new Uint8ClampedArray(buffer, each * which, each);
      for (const [canvas, which] of canvases) {
        const pixels = which >= FIRST_LAYER ? layerOver(picture(which), picture(UNDER)) : picture(which);
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
