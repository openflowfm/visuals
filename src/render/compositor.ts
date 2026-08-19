import type { Blend, EffectKind, Show, SourceKind } from '../../protocol.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program, type Target } from './gl.ts';
import { effectSources, sourceSources } from './shaders.ts';

/**
 * The layer stack, drawn once a frame.
 *
 * This is Resolume's model and Ableton's at the same time, because they turn
 * out to be the same shape: a composition is layers stacked bottom to top, each
 * showing one clip, each with a blend mode and a fader. That is a session grid
 * read down a column — Live's tracks are the layers and Live's scenes are the
 * columns — which is why nothing here has to invent a transport or a launcher.
 * Live already has both, and this draws the consequence.
 *
 * **Blending is fixed-function**, so there is no accumulator buffer. Every
 * shader writes premultiplied alpha, which lets one `blendFunc` per layer give
 * the four modes below and leaves the offscreen target needed only by a layer
 * that has an effect on it.
 */
const BLENDS: Record<Blend, [number, number]> = {
  // Premultiplied "over" — the ordinary stacking that something has to do.
  over: [1, 0x0303], // ONE, ONE_MINUS_SRC_ALPHA
  add: [1, 1], // ONE, ONE
  screen: [1, 0x0301], // ONE, ONE_MINUS_SRC_COLOR
  multiply: [0x0306, 0x0303], // DST_COLOR, ONE_MINUS_SRC_ALPHA
};

export interface Compositor {
  frame(show: Show, beat: number, seconds: number): void;
  resize(): void;
  free(): void;
  readonly error: string | null;
}

export function createCompositor(canvas: HTMLCanvasElement): Compositor {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    // The renderer is the only thing on this machine that matters, and a
    // compositor that quietly drops to software is worse than one that says so.
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    return {
      frame() {},
      resize() {},
      free() {},
      error: 'WebGL2 is not available in this browser.',
    };
  }

  let error: string | null = null;
  const sources = new Map<SourceKind, Program>();
  const effects = new Map<EffectKind, Program>();
  const scratch = createTarget(gl);

  // Compiled on demand and kept: a show changes which source a layer draws
  // whenever a clip fires, and compiling a shader mid-set is a dropped frame.
  const sourceProgram = (kind: SourceKind): Program | null => {
    const held = sources.get(kind);
    if (held) return held;
    try {
      const built = compile(gl, sourceSources.get(kind)!, `source:${kind}`);
      sources.set(kind, built);
      return built;
    } catch (err) {
      error = (err as Error).message;
      return null;
    }
  };

  const effectProgram = (kind: EffectKind): Program | null => {
    if (kind === 'none') return null;
    const held = effects.get(kind);
    if (held) return held;
    try {
      const built = compile(gl, effectSources.get(kind)!, `effect:${kind}`);
      effects.set(kind, built);
      return built;
    } catch (err) {
      error = (err as Error).message;
      return null;
    }
  };

  /**
   * The drawing buffer, capped at `MAX_EDGE` on its longest side.
   *
   * Every layer is a full-screen pass, so fill rate is multiplied by the number
   * of layers and this is the single number that decides whether the rig holds
   * 60. Left to the display it is ruinous: a Retina laptop reports a device
   * pixel ratio of 2, which on a 1864-point-wide window asks for 3728x2006 —
   * 7.5 megapixels, times five layers, times sixty a second.
   *
   * A projector is 1080p, and the output of this is a projector. So the cap is
   * the honest resolution of the destination rather than the resolution of the
   * screen someone happens to be previewing on, and a preview on a 5K panel is
   * very slightly soft in exchange for the frame rate that matters.
   */
  const MAX_EDGE = Number(new URLSearchParams(location.search).get('maxEdge')) || 1920;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    let height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    const over = Math.max(width, height) / MAX_EDGE;
    if (over > 1) {
      width = Math.max(1, Math.round(width / over));
      height = Math.max(1, Math.round(height / over));
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    scratch.resize(width, height);
  };

  resize();

  const setCommon = (program: Program, show: Show, layerIndex: number, beat: number, seconds: number) => {
    const layer = show.layers[layerIndex];
    const quantum = show.quantum || 4;
    gl.uniform2f(program.uniform('uRes'), canvas.width, canvas.height);
    gl.uniform1f(program.uniform('uTime'), seconds);
    gl.uniform1f(program.uniform('uBeat'), beat);
    gl.uniform1f(program.uniform('uPhase'), ((beat % quantum) + quantum) % quantum);
    gl.uniform1f(program.uniform('uQuantum'), quantum);
    gl.uniform1f(program.uniform('uLevel'), layer.level);
    gl.uniform1f(program.uniform('uOpacity'), layer.opacity);
    gl.uniform3fv(program.uniform('uColor'), rgb(layer.clipColor));
    // Per layer and stable, so two layers drawing the same source don't draw
    // the identical picture on top of each other.
    gl.uniform1f(program.uniform('uSeed'), layer.t * 37.13);
  };

  return {
    get error() {
      return error;
    },
    resize,
    free() {
      scratch.free();
      for (const p of sources.values()) gl.deleteProgram(p.program);
      for (const p of effects.values()) gl.deleteProgram(p.program);
    },
    frame(show, beat, seconds) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      for (let i = 0; i < show.layers.length; i++) {
        const layer = show.layers[i];
        // Nothing playing means nothing drawn — not the last thing that played.
        // A layer holding its previous clip after the scene changed is the
        // failure that looks most like the renderer having crashed.
        if (layer.playing < 0 || layer.opacity <= 0.001) continue;

        const source = sourceProgram(layer.source);
        if (!source) continue;
        const effect = effectProgram(layer.effect);
        const [src, dst] = BLENDS[layer.blend] ?? BLENDS.over;

        if (effect) {
          // Offscreen first, so the effect has a whole picture to work on
          // rather than whatever is already on the screen underneath it.
          gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.framebuffer);
          gl.disable(gl.BLEND);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(source.program);
          setCommon(source, show, i, beat, seconds);
          drawFullscreen(gl);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.enable(gl.BLEND);
          gl.blendFunc(src, dst);
          gl.useProgram(effect.program);
          setCommon(effect, show, i, beat, seconds);
          // The effect samples an already-premultiplied picture, so it must not
          // apply the fader a second time.
          gl.uniform1f(effect.uniform('uOpacity'), 1);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, scratch.texture);
          gl.uniform1i(effect.uniform('uTex'), 0);
          drawFullscreen(gl);
        } else {
          gl.blendFunc(src, dst);
          gl.useProgram(source.program);
          setCommon(source, show, i, beat, seconds);
          drawFullscreen(gl);
        }
      }
    },
  };
}
