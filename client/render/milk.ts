import type butterchurnModule from 'butterchurn';
import type { AudioLevels, Visualizer } from 'butterchurn';
import { presetUrl } from '../../milk.ts';

/**
 * Butterchurn, loaded the first time a preset is drawn rather than with this
 * module. Its webpack UMD bundle touches `window` as it loads, so a static import
 * made every test that reaches the compositor fail in Node before it ran.
 *
 * Its export is `{ default: Butterchurn }`, and which layer an `import` lands on
 * depends on the bundler's CommonJS interop, so take whichever one has the factory.
 */
let butterchurn: typeof butterchurnModule | null = null;
let arriving: Promise<void> | null = null;
function loadButterchurn(): void {
  arriving ??= import('butterchurn').then((m) => {
    const layers = [m, (m as { default?: unknown }).default, ((m as { default?: { default?: unknown } }).default ?? {}).default];
    butterchurn = (layers.find((l) => l && typeof l === 'object' && 'createVisualizer' in l) ?? null) as typeof butterchurnModule | null;
  });
}

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
 * - **What it leaves behind is put back** — sampler objects, blending, the
 *   pixel-store flags our image and video uploads assume, the texture unit and
 *   program.
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
/** The texture units Butterchurn 2.6.7 binds sampler objects to. */
const SAMPLER_UNITS = [0, 1, 2, 3, 4, 12];
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
      // Sampler objects outrank a texture's own filtering, and Butterchurn
      // leaves its mipmapped ones bound on units 0–4 and 12. Left there, the
      // output stage samples `out` through them and a texture with no mipmaps
      // reads as black.
      for (const unit of SAMPLER_UNITS) gl.bindSampler(unit, null);
      gl.disable(gl.BLEND);
      gl.useProgram(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
  };

  const ensure = (target: WebGLFramebuffer | null, width: number, height: number): Visualizer | null => {
    if (!visualizer) {
      const factory = butterchurn;
      if (!factory) {
        loadButterchurn();
        return null;
      }
      visualizer = fenced(target, () =>
        factory.createVisualizer(null, canvas, { width, height, pixelRatio: 1, textureRatio: 1 }),
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

  /**
   * Load a preset, falling back to MilkDrop's own warp or comp shader for any
   * that will not link.
   *
   * The converter turns HLSL into GLSL by translation, and HLSL is looser: it
   * takes `&&` between vectors, for one, which GLSL refuses. Butterchurn draws
   * black when a shader fails and says nothing, which on a wall is a preset
   * that silently is not there. MilkDrop's answer to a broken shader is its
   * default one, and so is this: the equations, waves and shapes still run, so
   * the preset still moves like itself.
   *
   * The first time costs a cut rather than a blend — the broken attempt has to
   * be replaced before anything blends out of it. After that the repaired copy
   * is what is cached, and it blends like any other.
   */
  const load = (v: Visualizer, target: WebGLFramebuffer | null, preset: string) => {
    const data = parsed.get(preset) as { warp?: string; comp?: string };
    // Butterchurn writes compiled functions into what it is handed, so it gets
    // a copy and the cache stays JSON.
    fenced(target, () => v.loadPreset(structuredClone(data), showing ? BLEND_SECONDS : 0));
    const linked = (shader: { shaderProgram: WebGLProgram } | undefined) =>
      !!shader && !!gl.getProgramParameter(shader.shaderProgram, gl.LINK_STATUS);
    const warpBroken = !linked(v.renderer.warpShader);
    const compBroken = !linked(v.renderer.compShader);
    if (!warpBroken && !compBroken) return;
    const repaired = {
      ...data,
      ...(warpBroken ? { warp: '' } : {}),
      ...(compBroken ? { comp: '' } : {}),
    };
    parsed.set(preset, repaired);
    fenced(target, () => v.loadPreset(structuredClone(repaired), 0));
    console.warn(
      `milkdrop: ${preset} — ${[warpBroken && 'warp', compBroken && 'comp'].filter(Boolean).join(' and ')} shader would not compile; drawing MilkDrop's default instead`,
    );
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
      let v: Visualizer | null;
      try {
        v = ensure(target, width, height);
      } catch (reason) {
        // Said once in the panel, not thrown sixty times a second into a loop
        // that would stop drawing everything else with it.
        error = `MilkDrop could not start: ${(reason as Error).message}`;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      if (!v) {
        // Butterchurn is still arriving: black for the frame or two it takes.
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
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
          try {
            load(v, target, preset);
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
      try {
        fenced(target, () => v.render({ audioLevels: audio, elapsedTime: Math.max(0.001, dt) }));
      } catch (reason) {
        // An equation that throws throws every frame. Retire the preset rather
        // than spend the evening on it; the wheel will move on by itself.
        const broken = showing;
        failed.set(broken, (reason as Error).message);
        error = `${broken}: ${(reason as Error).message}`;
        showing = null;
      }
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
