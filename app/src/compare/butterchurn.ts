import type butterchurnModule from 'butterchurn';
import type { AudioLevels, Visualizer } from 'butterchurn';
import { DRAW, NOISE_SEED, SEED } from './api.ts';

/** The engine's generator (`eel::Memory::random`): xorshift64*, 53 bits. As `harness/compare.ts` has it. */
export function xorshift(seed: bigint) {
  const mask = (1n << 64n) - 1n;
  let s = seed | 1n;
  return {
    reseed(to: bigint) {
      s = to | 1n;
    },
    random() {
      s ^= s >> 12n;
      s = (s ^ (s << 25n)) & mask;
      s ^= s >> 27n;
      return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
    },
  };
}

/** Butterchurn's FFT band edges for `sampleRate`: `client/render/milk.ts`'s `tune`. */
export function bands(sampleRate: number): { starts: number[]; stops: number[] } {
  const band = (hz: number) => Math.max(0, Math.min(511, Math.round(hz / (sampleRate / 1024)) - 1));
  return { starts: [band(20), band(320), band(2800)], stops: [band(320), band(2800), band(11025)] };
}

/** Butterchurn 2.6.7's insides this reaches into; pinned with the version. */
interface Insides {
  gl: WebGL2RenderingContext;
  blendPattern: { createBlendPattern(): void };
  image: { samplers: Record<string, unknown> };
  audioLevels: { starts: number[]; stops: number[] };
  warpShader?: { shaderProgram: WebGLProgram };
  compShader?: { shaderProgram: WebGLProgram };
}

/** The reference picture: Butterchurn on one WebGL canvas, with the bench's randomness. */
export interface Reference {
  /** Load a converted preset. Returns the shaders that would not link: Butterchurn draws black for them. */
  load(json: string): string[];
  /** Nothing to draw (the converter failed): black until the next load. */
  blank(): void;
  /** One frame. Returns what stopped the preset, once, if it throws. */
  render(levels: AudioLevels, dt: number, sampleRate: number): string | null;
  free(): void;
}

/**
 * Make the reference on `canvas`. Butterchurn is imported here, not with the
 * page: it touches `window` as it loads.
 *
 * `Math.random` is the engine's generator from here until `free`, seeded as the
 * recorded bench seeds it: the noise seed while the visualizer makes its noise
 * textures, then [`SEED`] each time a preset loads, between the blend pattern and
 * `rand_start`, where the engine's preset seed starts.
 */
export async function createReference(canvas: HTMLCanvasElement, cancelled: () => boolean): Promise<Reference> {
  const m = await import('butterchurn');
  // Given up on while it was arriving (React's development double mount): the
  // canvas, and its one WebGL context, belong to whoever asked next.
  if (cancelled()) throw new Error('cancelled');
  // Its export is `{ default: Butterchurn }`, landing on whichever layer the
  // bundler's CommonJS interop puts it — and `Butterchurn` is a class, so a function.
  const layers = [m, (m as { default?: unknown }).default, ((m as { default?: { default?: unknown } }).default ?? {}).default];
  const factory = layers.find((l) => l && (typeof l === 'object' || typeof l === 'function') && 'createVisualizer' in l) as typeof butterchurnModule | undefined;
  if (!factory) throw new Error('butterchurn did not load');
  const original = Math.random;
  const rng = xorshift(NOISE_SEED);
  Math.random = rng.random;
  canvas.width = DRAW.width;
  canvas.height = DRAW.height;
  let viz: Visualizer;
  try {
    viz = factory.createVisualizer(null, canvas, { width: DRAW.width, height: DRAW.height, pixelRatio: 1, textureRatio: 1 });
  } catch (e) {
    Math.random = original;
    throw e;
  }
  const r = viz.renderer as unknown as Insides;
  const gl = r.gl;
  const makePattern = r.blendPattern.createBlendPattern.bind(r.blendPattern);
  r.blendPattern.createBlendPattern = () => {
    makePattern();
    rng.reseed(SEED);
  };
  // Its built-in images (`clouds2`, which every unknown sampler reads, and `empty`)
  // decode asynchronously; a preset loaded before them reads black.
  for (let waited = 0; !(r.image.samplers.clouds2 && r.image.samplers.empty) && waited < 5000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  let rate = 0;
  let drawing = false;
  const black = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const linked = (shader: { shaderProgram: WebGLProgram } | undefined) => !!shader && !!gl.getProgramParameter(shader.shaderProgram, gl.LINK_STATUS);
  return {
    load(json) {
      viz.loadPreset(JSON.parse(json), 0);
      drawing = true;
      return [!linked(r.warpShader) && 'warp', !linked(r.compShader) && 'comp'].filter((s): s is string => !!s);
    },
    blank() {
      drawing = false;
      black();
    },
    render(levels, dt, sampleRate) {
      if (sampleRate > 0 && sampleRate !== rate) {
        Object.assign(r.audioLevels, bands(sampleRate));
        rate = sampleRate;
      }
      if (!drawing) {
        black();
        return null;
      }
      try {
        viz.render({ audioLevels: levels, elapsedTime: dt });
        return null;
      } catch (e) {
        // An equation that throws throws every frame: stop, and say so once.
        drawing = false;
        black();
        return (e as Error).message;
      }
    },
    free() {
      if (Math.random === rng.random) Math.random = original;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
