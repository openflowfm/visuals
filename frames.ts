/**
 * What a flow actually looks like, at the size it will be looked at.
 *
 * `npm run frames` — the page half. `tools/frames.ts` is the half that opens a
 * window on it and writes the files.
 *
 * **This exists because every other way of looking at the renderer was lying.**
 * A hand-built harness that compiles the flow shader and sets its uniforms is
 * quick to write and wrong in ways that do not announce themselves: it fed
 * `uLevel` where a `track` node reads `uTracks[]`, so every flow whose dynamics
 * come from the music measured as a still image, and it drew the flow straight
 * to the canvas — skipping the *output stage*, which is where the shoulder, the
 * gain and the keystone live and where the picture is actually finished. Two
 * separate rounds of "the flows look flat" turned out to be that harness.
 *
 * So this drives the real `Compositor` through the real `Show`. What comes out
 * is what a wall gets, and it is written to a PNG at full resolution rather than
 * screenshotted — a screenshot is downscaled and JPEG-compressed, which removes
 * exactly the two defects worth looking for. Banding does not survive a JPEG.
 */

import type { Scheme, Show, Track } from './protocol.ts';
import type { ModelLibrary } from './model.ts';
import { createCompositor } from './client/render/compositor.ts';
import { compileFlow } from './client/render/circuit.ts';
import { cyclicMotion, metricsOf, type FrameMetrics } from './frameMetrics.ts';

const params = new URLSearchParams(location.search);
const asked = (name: string, fallback: string): string => params.get(name) ?? fallback;

const TEMPO = Number(asked('tempo', '124'));
const WIDTH = Number(asked('w', '1280'));
const HEIGHT = Number(asked('h', '720'));
/** Frames drawn before the first capture, so trails and followers have settled. */
const SETTLE = Number(asked('settle', '90'));
const FPS = 60;
const TRACKS = 4;

export interface FrameStat extends FrameMetrics {
  flow: string;
  beat: number;
}

export interface SequenceStat {
  flow: string;
  /** Mean per-channel change across equal phase steps, including the loop seam. */
  motion: number;
}

/** A per-beat kick, an accent on two and four, and a slow swell under both. */
function meterAt(beat: number): number {
  const within = beat - Math.floor(beat);
  const kick = Math.pow(1 - within, 3);
  const accent = Math.floor(beat) % 2 === 1 ? Math.pow(1 - within, 6) * 0.55 : 0;
  return Math.min(1, 0.06 + 0.8 * kick + accent);
}
function roomAt(beat: number): number {
  return Math.min(1, 0.32 + 0.22 * Math.sin((beat * Math.PI) / 8) + 0.25 * meterAt(beat));
}

function trackAt(t: number, beat: number): Track {
  return {
    t,
    name: `frames ${t}`,
    color: [0xff5252, 0x52ff9d, 0x527dff, 0xfff152][t % 4],
    opacity: 0.7 + 0.3 * ((t % 3) / 2),
    // Each track a different distance behind the beat, so a flow reading two of
    // them is not reading one number twice.
    level: meterAt(beat + t * 0.17),
    playing: t % 7,
    clipName: `clip ${t}`,
  };
}

function showAt(beat: number, colors: number[], flow: string | null): Show {
  return {
    connected: true,
    lomReady: true,
    playing: true,
    peers: 1,
    clock: true,
    tempo: TEMPO,
    quantum: 4,
    beat,
    at: Date.now(),
    since: beat * (60 / TEMPO),
    master: roomAt(beat),
    tracks: Array.from({ length: TRACKS }, (_, t) => trackAt(t, beat)),
    groups: [],
    flow,
    pinned: true,
    colorway: null,
    colors: colors.length ? colors : [0xffffff],
    song: null,
    key: 0.25,
    role: null,
    one: 0,
    schemeError: null,
    roles: [],
    songs: [],
  };
}

const packColor = (hex: string): number => parseInt(hex.replace('#', ''), 16);

function statOf(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  flow: string,
  beat: number,
): FrameStat {
  return { flow, beat, ...metricsOf(pixels, width, height) };
}

export interface FramesReport {
  renderer: string;
  width: number;
  height: number;
  stats: FrameStat[];
  sequences: SequenceStat[];
  models: {
    peakInstances: number;
    peakGeometries: number;
    peakTargets: number;
    loadingAtCapture: number;
    instancesAfterRelease: number;
  };
  errors: string[];
}

export async function run(canvas: HTMLCanvasElement): Promise<FramesReport> {
  // Served by the runner rather than imported, so this draws the library as it
  // is now — or one of the user's own schemes, named on the command line. The
  // checked-in `scheme.json` beside this file is a snapshot the benchmark uses
  // for a stable score, and pointing here at it meant every flow written since
  // it was taken compiled to an empty circuit and rendered black with no error
  // to say why.
  const loaded = (await (await fetch('/scheme.json')).json()) as Scheme;
  const models = (await (await fetch('/models.json')).json()) as ModelLibrary;
  const wayName = asked('colorway', Object.keys(loaded.colorways)[0] ?? '');
  const colors = (loaded.colorways[wayName] ?? Object.values(loaded.colorways)[0] ?? ['#ffffff'])
    .map(packColor);
  const ids = asked('flows', Object.keys(loaded.flows).join(',')).split(',').filter(Boolean);
  const beats = asked('at', '0,1,2,3').split(',').map(Number);

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `scale(${Math.min(
    window.innerWidth / WIDTH,
    window.innerHeight / HEIGHT,
  )})`;

  const compositor = createCompositor(canvas);
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not available');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';

  // A wall, not a window: no keystone and no master gain, and `preview` off, so
  // what is captured has been through the same output stage a projector gets.
  compositor.setOutput(null);
  compositor.preview(false);

  const shot = document.createElement('canvas');
  shot.width = WIDTH;
  shot.height = HEIGHT;
  const flat = shot.getContext('2d', { willReadFrequently: true })!;

  const stats: FrameStat[] = [];
  const sequences: SequenceStat[] = [];
  const errors: string[] = [];
  const modelStats = {
    peakInstances: 0,
    peakGeometries: 0,
    peakTargets: 0,
    loadingAtCapture: 0,
    instancesAfterRelease: 0,
  };
  const measureModels = () => {
    const held = compositor.modelResources();
    modelStats.peakInstances = Math.max(modelStats.peakInstances, held.instances);
    modelStats.peakGeometries = Math.max(modelStats.peakGeometries, held.geometries);
    modelStats.peakTargets = Math.max(modelStats.peakTargets, held.targets);
    modelStats.loadingAtCapture = held.loading;
  };
  const dt = 1 / FPS;
  const perFrame = TEMPO / 60 / FPS;

  for (const id of ids) {
    if (!loaded.flows[id]) {
      errors.push(`${id}: no such flow in this scheme`);
      continue;
    }
    const compiled = compileFlow(loaded.flows, id);
    if (compiled.error) {
      errors.push(`${id}: ${compiled.error}`);
      continue;
    }
    const sampled: Uint8ClampedArray[] = [];
    // Start model loads, then yield until the actual parser says every
    // reachable setup is ready. A fixed sleep made captures depend on disk and
    // GPU speed and let a slow machine record a convincing sheet of black.
    compositor.frame(showAt(beats[0] ?? 0, colors, id), loaded, beats[0] ?? 0, 0, dt, undefined, models);
    const readyBy = performance.now() + 15_000;
    while (compositor.modelResources().loading > 0 && performance.now() < readyBy) {
      await new Promise((ready) => setTimeout(ready, 16));
      compositor.frame(showAt(beats[0] ?? 0, colors, id), loaded, beats[0] ?? 0, 0, dt, undefined, models);
    }
    if (compositor.modelResources().loading > 0) {
      errors.push(`${id}: model load timed out`);
      continue;
    }
    if (compositor.error) {
      errors.push(`${id}: ${compositor.error}`);
      continue;
    }
    measureModels();
    for (const target of beats) {
      // Wind the clock up to the wanted beat from far enough back that anything
      // reading the previous frame has a previous frame to read. A flow with a
      // trail in it captured cold is a picture of its first frame.
      let beat = target - SETTLE * perFrame;
      for (let step = 0; step < SETTLE; step++) {
        compositor.frame(showAt(beat, colors, id), loaded, beat, beat * (60 / TEMPO), dt, undefined, models);
        beat += perFrame;
      }
      compositor.frame(showAt(target, colors, id), loaded, target, target * (60 / TEMPO), dt, undefined, models);
      if (compositor.error) {
        errors.push(`${id}: ${compositor.error}`);
        break;
      }
      // Same task as the draw, because the drawing buffer is not preserved.
      // Be explicit even though the runner pins `maxEdge` to the requested
      // dimensions. `drawImage(canvas, 0, 0)` copies at the backing buffer's
      // native size; if a browser ever ignores that cap, the target canvas
      // would crop its right and bottom instead of scaling the whole wall.
      flat.drawImage(canvas, 0, 0, WIDTH, HEIGHT);
      const pixels = flat.getImageData(0, 0, WIDTH, HEIGHT).data;
      stats.push(statOf(pixels, WIDTH, HEIGHT, id, target));
      sampled.push(new Uint8ClampedArray(pixels));
      measureModels();
      const png = shot.toDataURL('image/png');
      await fetch(`/write?name=${encodeURIComponent(`${id}@${target}`)}`, {
        method: 'POST',
        body: png,
      });
    }
    if (sampled.length > 0) sequences.push({ flow: id, motion: cyclicMotion(sampled) });
  }

  compositor.frame(showAt(0, colors, null), loaded, 0, 0, dt, undefined, models);
  modelStats.instancesAfterRelease = compositor.modelResources().instances;
  compositor.free();
  return { renderer, width: WIDTH, height: HEIGHT, stats, sequences, models: modelStats, errors };
}
