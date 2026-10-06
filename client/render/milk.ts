import butterchurn, { type AudioLevels, type Visualizer } from 'butterchurn';
import { presetUrl } from '../../milk.ts';

/**
 * MilkDrop, drawn by Butterchurn, inside the compositor's own GL context.
 *
 * **One context, not two.** The wall's output stage — keystone, gain, the test
 * grid — is a pass over the compositor's `out` target, and a preset has to land
 * there for any of it to apply. A second canvas would be a second picture the
 * projector alignment never touched.
 *
 * Butterchurn was written to own its canvas, so it is given the context and
 * fenced in rather than forked:
 *
 * - **Its screen is our target.** It binds the default framebuffer to present.
 *   While it runs, `bindFramebuffer(null)` is redirected to the target we hand
 *   it, so "the screen" is `out` and everything after it is unchanged.
 * - **Its vertex state is its own.** It never binds a vertex array, so every
 *   attribute it sets lands in whichever one is bound. It gets one of its own,
 *   and the compositor's attribute-less fullscreen triangle never meets an
 *   attribute array it did not enable.
 * - **What it leaves behind is put back** — blending, the pixel-store flags our
 *   image and video uploads assume, the texture unit and program.
 *
 * Butterchurn is pinned at 2.6.7 because two of those fences, and the FFT fix
 * below, lean on how that version behaves. See `docs/milkdrop.md`.
 */
export interface Milk {
  /** Draw `preset` into `target`, a `width × height` framebuffer. */
  draw(
    target: WebGLFramebuffer | null,
    width: number,
    height: number,
    preset: string,
    dt: number,
    audio: AudioLevels,
    sampleRate: number,
  ): void;
  /** What the last preset to fail said, or null. Cleared by the next one that loads. */
  readonly error: string | null;
  /** The preset on screen, which trails the one asked for while it loads. */
  readonly showing: string | null;
  free(): void;
}

/** Seconds one preset takes to melt into the next. MilkDrop's own default is 2.7. */
const BLEND_SECONDS = 2.7;
/** Parsed presets kept, so a short rotation never refetches. Each is a clone source. */
const KEEP = 12;

export function createMilk(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): Milk {
  const vao = gl.createVertexArray();
  let visualizer: Visualizer | null = null;
  let size = { width: 0, height: 0 };
  let rate = 0;
  let error: string | null = null;
  let showing: string | null = null;
  let wanted: string | null = null;
  const parsed = new Map<string, unknown>();
  const failed = new Map<string, string>();
  const loading = new Set<string>();

  /** Run Butterchurn with its screen pointed at `target`, and tidy up after it. */
  const fenced = <T>(target: WebGLFramebuffer | null, run: () => T): T => {
    const bind = gl.bindFramebuffer;
    gl.bindVertexArray(vao);
    (gl as unknown as { bindFramebuffer: typeof bind }).bindFramebuffer = (kind, framebuffer) =>
      bind.call(gl, kind, framebuffer ?? target);
    try {
      return run();
    } finally {
      delete (gl as unknown as { bindFramebuffer?: typeof bind }).bindFramebuffer;
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.useProgram(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
  };

  const ensure = (target: WebGLFramebuffer | null, width: number, height: number) => {
    if (!visualizer) {
      visualizer = fenced(target, () =>
        butterchurn.createVisualizer(null, canvas, { width, height, pixelRatio: 1, textureRatio: 1 }),
      );
      size = { width, height };
      rate = 0;
    } else if (size.width !== width || size.height !== height) {
      const v = visualizer;
      fenced(target, () => v.setRendererSize(width, height));
      size = { width, height };
    }
    return visualizer;
  };

  /**
   * Butterchurn's FFT bands are fixed for 44.1 kHz when it is not given an
   * AudioContext, which it never is here. At 48 kHz every band is 9% off, and
   * `bass` is what half of all presets move on.
   */
  const tune = (v: Visualizer, sampleRate: number) => {
    if (sampleRate <= 0 || sampleRate === rate) return;
    const band = (hz: number) => Math.max(0, Math.min(511, Math.round(hz / (sampleRate / 1024)) - 1));
    v.renderer.audioLevels.starts = [band(20), band(320), band(2800)];
    v.renderer.audioLevels.stops = [band(320), band(2800), band(11025)];
    rate = sampleRate;
  };

  const fetchPreset = (preset: string) => {
    if (parsed.has(preset) || failed.has(preset) || loading.has(preset)) return;
    loading.add(preset);
    fetch(presetUrl(preset))
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
        return response.json();
      })
      .then((data: unknown) => {
        parsed.set(preset, data);
        while (parsed.size > KEEP) parsed.delete(parsed.keys().next().value!);
      })
      .catch((reason: Error) => failed.set(preset, reason.message))
      .finally(() => loading.delete(preset));
  };

  return {
    get error() {
      return error;
    },
    get showing() {
      return showing;
    },
    draw(target, width, height, preset, dt, audio, sampleRate) {
      const v = ensure(target, width, height);
      tune(v, sampleRate);
      if (preset !== showing) {
        if (preset !== wanted) {
          wanted = preset;
          fetchPreset(preset);
        }
        const why = failed.get(preset);
        if (why) {
          error = `${preset}: ${why}`;
        } else if (parsed.has(preset)) {
          // Butterchurn writes compiled functions into what it is handed, so it
          // gets a copy and the cache stays JSON.
          const data = structuredClone(parsed.get(preset));
          try {
            fenced(target, () => v.loadPreset(data, showing ? BLEND_SECONDS : 0));
            showing = preset;
            error = null;
          } catch (reason) {
            failed.set(preset, (reason as Error).message);
            error = `${preset}: ${(reason as Error).message}`;
          }
        }
      }
      if (!showing) {
        // Nothing has loaded yet: black, rather than an uninitialised target.
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      fenced(target, () => v.render({ audioLevels: audio, elapsedTime: Math.max(0.001, dt) }));
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, width, height);
    },
    free() {
      gl.deleteVertexArray(vao);
      // Butterchurn has no teardown. Its textures go with the context, which is
      // the only way this is freed in practice — a lost context or a closed window.
      visualizer = null;
      showing = null;
      wanted = null;
    },
  };
}
