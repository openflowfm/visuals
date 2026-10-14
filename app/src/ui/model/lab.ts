/**
 * The lab's (the preset editor's) commands and its stage-picture poll, kept out
 * of `api.ts` and `previews.ts` on purpose.
 *
 * visual[flow]'s CI fails when the command strings 'apply', 'set_value',
 * 'previews' and 'default_shader' appear in the app's (non-lab) bundle, and
 * zen's lab ships as its own package entry. Anything the editor reaches through
 * the shared `api.ts` or `previews.ts` would be bundled into the app people get,
 * so the editor takes every command it needs from here, never from
 * `api.apply`/`setValue`/`setPreviews`/`previews`/`defaultShader` or
 * `previews.usePreview`/`previewZoom`. Same signatures and command names as those.
 */
import { useEffect, useRef } from 'react';
import { invoke } from './ipc';
import { PREVIEW, type Owner, type Preset, type Report } from './api';
import { FIRST_LAYER, STEPS, UNDER, layerOver, needed, settler, stepFor, unpack, wanted, withinBudget, type Zoom } from './previews';
import type { Stage } from './stages';

export type { Zoom } from './previews';

// --- the commands --------------------------------------------------------------

/** Apply a whole preset to the bench; answers what of it failed to compile. */
export const apply = (preset: Preset) => invoke<Report>('apply', { preset });
/** One setting, live. False means the preset needs applying whole instead. */
export const setValue = (owner: Owner, key: string, value: number) => invoke<boolean>('set_value', { owner, key, value });
/** Keep the stage pictures `which` (`PREVIEWS` indices) at `width`×`height`; none stops them. */
export const setPreviews = (which: number[], width = PREVIEW.width, height = PREVIEW.height) => invoke<void>('set_previews', { which, width, height });
/** The latest stage pictures, packed with a header (`unpack` in previews.ts). */
export const previews = () => invoke<ArrayBuffer>('previews');
/** MilkDrop's default `warp` or `comp` shader as code to start from, with this
 * preset's decay, gamma and echo written in as numbers so it runs in any player
 * (`engine::shader::written_default`). */
export const defaultShader = (preset: Preset, which: 'warp' | 'comp') => invoke<string>('default_shader', { preset, which });

/** "Write my own": a shader stage's code set to MilkDrop's default, as the engine
 * writes it out, so it can be edited from there. (The original's `graph/writeDefaultShader.ts`.) */
export function writeDefaultShader(preset: Preset, stage: Stage, onChange: (next: Preset) => void): void {
  const which = stage.id as 'warp' | 'comp';
  defaultShader(preset, which).then((code) => onChange({ ...preset, [which]: code }), console.error);
}

// --- the stage-picture poll ------------------------------------------------------
// `previews.ts`'s `usePreview`/`previewZoom` over this module's commands, on the
// pure helpers it exports. `Pictures`, `onScreen`, `draw` and the loop aren't
// exported there, so they are copied here (the pane is `.lib-graph`, not `.wdg-graph`).

/** A poll's pictures by `PREVIEWS` index (copied: not exported by previews.ts). */
type Pictures = Map<number, Uint8ClampedArray<ArrayBuffer>>;

const canvases = new Map<HTMLCanvasElement, number>();
let running = false;
/** The nodes' zoom and the graph's zoom, read at each poll; 1 and 1 with no graph. */
let zoomOf: (() => Zoom) | null = null;

/** Whether any of `canvas` is inside the graph pane it sits in (or the window). */
function onScreen(canvas: HTMLCanvasElement): boolean {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const pane = canvas.closest('.lib-graph')?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
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
    const zoom = zoomOf?.() ?? { node: 1, graph: 1 };
    const dpr = window.devicePixelRatio || 1;
    const need = Math.max(0, ...shown.map(([canvas]) => needed(canvas.offsetWidth || PREVIEW.width, zoom, dpr, step)));
    const which = wanted(shown.map(([, w]) => w));
    step = settle(withinBudget(stepFor(need, step), which.length), started);
    const width = STEPS[step];
    const height = Math.round((width * PREVIEW.height) / PREVIEW.width);
    const ask = `${which.join(',')}@${width}`;
    // Only a request that reached the engine counts as asked, so a failed one is tried again next poll.
    if (ask !== asked) {
      asked = await setPreviews(which, width, height).then(
        () => ask,
        () => asked,
      );
    }
    const got = which.length ? unpack(await previews().catch(() => new ArrayBuffer(0))) : null;
    if (got) draw(shown, got);
    // About fifteen a second: enough to read a stage, little enough to cost nothing.
    await new Promise((r) => setTimeout(r, Math.max(0, 66 - (performance.now() - started))));
  }
  await setPreviews([]).catch(() => {});
  running = false;
  // A canvas that mounted while the engine was being told to stop.
  if (canvases.size > 0) loop();
}

/**
 * Where the poll reads the zoom the pictures are shown at: the nodes' zoom and
 * the graph's, read when it's needed. Returns the way to let go of it.
 */
export function previewZoom(read: () => Zoom): () => void {
  zoomOf = read;
  return () => {
    if (zoomOf === read) zoomOf = null;
  };
}

/** A canvas showing stage picture `which` (`PREVIEWS` order). `previews.usePreview` for the lab. */
export function usePicture(which: number | undefined) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || which === undefined) return;
    canvases.set(canvas, which);
    // Started after this render's other effects, so canvases mounted together all join its first poll.
    if (!running) {
      running = true;
      queueMicrotask(() => void loop());
    }
    return () => {
      canvases.delete(canvas);
    };
  }, [which]);
  return ref;
}
