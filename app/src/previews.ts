import { useEffect, useRef } from 'react';
import * as api from './api.ts';

/**
 * Stage pictures from the engine, drawn into the canvases on node faces.
 *
 * One poll for all of them: the engine packs the pictures asked for into one
 * buffer, so a frame of previews is one round trip however many nodes show one.
 * The engine reads them back every other preset step (fifteen a second at 1×,
 * following the speed), and this polls at about that rate.
 *
 * Only the pictures of canvases on screen are asked for, at about the device
 * pixels they cover — CSS width × the nodes' zoom × the graph's zoom × the
 * display's pixel ratio — in coarse steps (`STEPS`), so a zoomed-in node stays
 * sharp and a zoomed-out graph costs what it always did.
 */
const canvases = new Map<HTMLCanvasElement, number>();
let running = false;
/** The nodes' zoom × the graph's zoom, read at each poll; 1 with no graph. */
let zoomOf: (() => number) | null = null;

/** The first layer picture (`PREVIEWS` order): the ones before are the chain's. */
export const FIRST_LAYER = 4;
/** The picture a layer draws into: the warp's output, the frame before any layer. */
export const UNDER = 0;
/** How bright that frame shows under a layer's drawing. */
export const DIM = 0.45;
/** The most a faint drawing is brightened by. */
export const MAX_GAIN = 8;

/**
 * The picture widths asked for, 16:9 each: the base size, 2× and 4× (the
 * engine's `PREVIEW_MAX`). A layer's 32:9 face shows the middle of the same
 * 16:9 picture, as wide, so it needs no size of its own.
 */
export const STEPS = [api.PREVIEW.width, api.PREVIEW.width * 2, api.PREVIEW.maxWidth];
/** How far a picture may be stretched before the next step up is asked for. */
export const STRETCH = 1.25;
/** How far under a smaller step the need must fall before stepping down to it. */
export const SHRINK = 0.9;
/** How long a new step must hold before it's asked for: zooming has settled. */
export const SETTLE_MS = 250;
/** The bytes before the pictures in a poll's buffer (`bench::HEADER`). */
export const HEADER = 12;

/**
 * Which of `STEPS` to show a picture `need` device pixels wide at, from step
 * `current`. Up as soon as `current` would be stretched past `STRETCH`; down
 * only once a smaller step covers it with room to spare (`SHRINK`), so a need
 * between two steps never flips between them.
 */
export function stepFor(need: number, current: number): number {
  const up = STEPS.findIndex((w) => w * STRETCH >= need);
  const fits = up < 0 ? STEPS.length - 1 : up;
  if (fits > current) return fits;
  let step = Math.min(current, STEPS.length - 1);
  while (step > 0 && need <= STEPS[step - 1] * SHRINK) step--;
  return step;
}

/**
 * A step that changes only once it has held for `SETTLE_MS`: given the step
 * wanted now (and the time), the step to use.
 */
export function settler(start = 0) {
  let used = start;
  let pending: { step: number; since: number } | null = null;
  return (wanted: number, now: number): number => {
    if (wanted === used) pending = null;
    else if (pending?.step !== wanted) pending = { step: wanted, since: now };
    else if (now - pending.since >= SETTLE_MS) {
      used = wanted;
      pending = null;
    }
    return used;
  };
}

type Pictures = Map<number, Uint8ClampedArray<ArrayBuffer>>;

/** A poll's buffer as its pictures, by `PREVIEWS` index; null when it isn't whole. */
export function unpack(buffer: ArrayBuffer): { width: number; height: number; pictures: Pictures } | null {
  if (buffer.byteLength < HEADER) return null;
  const header = new DataView(buffer, 0, HEADER);
  const [width, height, mask] = [0, 4, 8].map((at) => header.getUint32(at, true));
  const each = width * height * 4;
  const pictures: Pictures = new Map();
  let at = HEADER;
  for (let which = 0; which < 32; which++) {
    if (!(mask & (1 << which))) continue;
    if (at + each > buffer.byteLength) return null;
    pictures.set(which, new Uint8ClampedArray(buffer, at, each));
    at += each;
  }
  return at === buffer.byteLength && pictures.size > 0 ? { width, height, pictures } : null;
}

/** The pictures to ask for to show stages `shown`: a layer needs the frame it draws into too. */
export function wanted(shown: Iterable<number>): number[] {
  const set = new Set(shown);
  if ([...set].some((w) => w >= FIRST_LAYER)) set.add(UNDER);
  return [...set].sort((a, b) => a - b);
}

/**
 * A layer's picture as its node shows it: the drawing, brightened so its
 * brightest channel reaches full (at most `MAX_GAIN`×), over the frame it draws
 * into at `DIM`. Alone on black a thin wave or a small shape is mostly black;
 * over the frame it reads where it lands, and the gain makes a faint one seen.
 */
export function layerOver(
  layer: Uint8ClampedArray,
  under: Uint8ClampedArray,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(layer.length),
): Uint8ClampedArray<ArrayBuffer> {
  let peak = 0;
  for (let i = 0; i < layer.length; i += 4) peak = Math.max(peak, layer[i], layer[i + 1], layer[i + 2]);
  const gain = peak > 0 ? Math.min(MAX_GAIN, 255 / peak) : 1;
  for (let i = 0; i < layer.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = under[i + c] * DIM + layer[i + c] * gain;
    out[i + 3] = 255;
  }
  return out;
}

/** Whether any of `canvas` is inside the graph pane it sits in (or the window). */
function onScreen(canvas: HTMLCanvasElement): boolean {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const pane = canvas.closest('.wdg-graph')?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  return r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom;
}

/** Draw a poll's pictures into the canvases on screen, at the size they came. */
function draw(shown: [HTMLCanvasElement, number][], { width, height, pictures }: { width: number; height: number; pictures: Pictures }) {
  const under = pictures.get(UNDER);
  for (const [canvas, which] of shown) {
    const picture = pictures.get(which);
    const layer = which >= FIRST_LAYER;
    if (!picture || (layer && !under)) continue;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const pixels = layer ? layerOver(picture, under!) : picture;
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0);
  }
}

async function loop() {
  running = true;
  const settle = settler();
  let step = 0;
  let asked = '';
  while (canvases.size > 0) {
    const started = performance.now();
    const shown = [...canvases].filter(([canvas]) => onScreen(canvas));
    // `offsetWidth` is the canvas's CSS width, before any zoom above it.
    const zoom = (zoomOf?.() ?? 1) * (window.devicePixelRatio || 1);
    const need = Math.max(0, ...shown.map(([canvas]) => (canvas.offsetWidth || api.PREVIEW.width) * zoom));
    step = settle(stepFor(need, step), started);
    const which = wanted(shown.map(([, w]) => w));
    const width = STEPS[step];
    const height = Math.round((width * api.PREVIEW.height) / api.PREVIEW.width);
    const ask = `${which.join(',')}@${width}`;
    if (ask !== asked) {
      asked = ask;
      await api.setPreviews(which, width, height).catch(() => {});
    }
    const got = which.length ? unpack(await api.previews().catch(() => new ArrayBuffer(0))) : null;
    if (got) draw(shown, got);
    // About fifteen a second: enough to read a stage, little enough to cost nothing.
    await new Promise((r) => setTimeout(r, Math.max(0, 66 - (performance.now() - started))));
  }
  await api.setPreviews([]).catch(() => {});
  running = false;
  // A canvas that mounted while the engine was being told to stop.
  if (canvases.size > 0) loop();
}

/**
 * Where the poll reads the zoom the pictures are shown at: the nodes' zoom ×
 * the graph's, read when it's needed. Returns the way to let go of it.
 */
export function previewZoom(read: () => number): () => void {
  zoomOf = read;
  return () => {
    if (zoomOf === read) zoomOf = null;
  };
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
