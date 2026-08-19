import type { Blend, EffectKind, Show, SourceKind } from '../../protocol.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program, type Target } from './gl.ts';
import { effectSources, sourceSources } from './shaders.ts';

/**
 * The layer stack, drawn once a frame.
 *
 * This is Resolume's model and Ableton's at the same time, because they turn out
 * to be the same shape: a composition is layers stacked bottom to top, each
 * showing one clip, each with a blend mode and a fader. That is a session grid
 * read down a column — Live's tracks are the layers and Live's scenes are the
 * columns — which is why nothing here invents a transport or a launcher.
 *
 * **Blending is fixed-function**, so there is no accumulator buffer. Every
 * shader writes premultiplied alpha, which lets one `blendFunc` per layer give
 * the four modes below, and leaves an offscreen target needed only by a layer
 * that actually carries effects.
 */
const BLENDS: Record<Blend, [number, number]> = {
  // Premultiplied "over" — the ordinary stacking that something has to do.
  over: [1, 0x0303], // ONE, ONE_MINUS_SRC_ALPHA
  add: [1, 1], // ONE, ONE
  screen: [1, 0x0301], // ONE, ONE_MINUS_SRC_COLOR
  multiply: [0x0306, 0x0303], // DST_COLOR, ONE_MINUS_SRC_ALPHA
};

export interface Compositor {
  frame(show: Show, beat: number, seconds: number, dt: number): void;
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

  /**
   * Two targets, ping-ponged, because a layer can carry more than one effect.
   *
   * A chain is what makes energy *additive* rather than a switch — a chorus can
   * contribute a kaleidoscope while the drum track contributes a ripple, and
   * both have to survive. Two is the cap (`maxEffects`), which is why there are
   * exactly two here and no pool.
   */
  const targets = [createTarget(gl), createTarget(gl)];

  /**
   * Where each layer's opacity currently is, as against where the show says it
   * should be.
   *
   * Section changes move energy, energy moves the floor gate, and the gate moves
   * opacity — so without this a chorus arriving would pop three layers into
   * existence on one frame. Eased, it reads as the picture opening up, which is
   * what the section actually did. Keyed by track index because that is a
   * layer's identity across every reshuffle of the set.
   */
  const shown = new Map<number, number>();

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
   * Every layer is a full-screen pass and every effect is another, so fill rate
   * is the single number that decides whether the rig holds 60. Left to the
   * display it is ruinous: a Retina laptop reports a device pixel ratio of 2,
   * which on an ordinary window asks for 3728x2006 — 7.5 megapixels, times the
   * layers, times their effects, times sixty a second.
   *
   * A projector is 1080p, and the output of this is a projector. So the cap is
   * the honest resolution of the destination rather than of the screen someone
   * happens to be previewing on.
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
    for (const target of targets) target.resize(width, height);
  };

  resize();

  const setCommon = (
    program: Program,
    show: Show,
    index: number,
    opacity: number,
    beat: number,
    seconds: number,
  ) => {
    const layer = show.layers[index];
    const quantum = show.quantum || 4;
    gl.uniform2f(program.uniform('uRes'), canvas.width, canvas.height);
    gl.uniform1f(program.uniform('uTime'), seconds);
    gl.uniform1f(program.uniform('uBeat'), beat);
    gl.uniform1f(program.uniform('uPhase'), ((beat % quantum) + quantum) % quantum);
    gl.uniform1f(program.uniform('uQuantum'), quantum);
    gl.uniform1f(program.uniform('uLevel'), layer.level);
    gl.uniform1f(program.uniform('uEnergy'), layer.energy);
    gl.uniform1f(program.uniform('uOpacity'), opacity);
    gl.uniform3fv(program.uniform('uColor'), rgb(layer.color));
    // Per layer and stable, so two layers drawing the same source out of the
    // same colourway don't draw the identical picture on top of each other.
    gl.uniform1f(program.uniform('uSeed'), layer.t * 37.13);
  };

  return {
    get error() {
      return error;
    },
    resize,
    free() {
      for (const target of targets) target.free();
      for (const p of sources.values()) gl.deleteProgram(p.program);
      for (const p of effects.values()) gl.deleteProgram(p.program);
    },
    frame(show, beat, seconds, dt) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      // Roughly a 200ms glide however fast the display runs, so a section change
      // looks the same on 60 Hz and 144 Hz.
      const glide = 1 - Math.exp(-dt / 0.2);

      for (let i = 0; i < show.layers.length; i++) {
        const layer = show.layers[i];
        // Nothing playing means nothing drawn — not the last thing that played.
        // A layer holding its previous clip after the scene changed is the
        // failure that looks most like the renderer having crashed. The target
        // is taken to zero rather than skipped so it fades out on its way.
        const target = layer.playing < 0 ? 0 : layer.opacity;
        const was = shown.get(layer.t) ?? 0;
        const opacity = was + (target - was) * glide;
        shown.set(layer.t, opacity);
        if (opacity <= 0.002) continue;

        const source = sourceProgram(layer.source);
        if (!source) continue;
        const [src, dst] = BLENDS[layer.blend] ?? BLENDS.over;

        const chain = layer.effects
          .map((applied) => ({ applied, program: effectProgram(applied.kind) }))
          .filter((step): step is { applied: (typeof layer.effects)[number]; program: Program } =>
            Boolean(step.program),
          );

        if (chain.length === 0) {
          gl.blendFunc(src, dst);
          gl.useProgram(source.program);
          setCommon(source, show, i, opacity, beat, seconds);
          drawFullscreen(gl);
          continue;
        }

        // The source goes offscreen first, so the chain has a whole picture to
        // work on rather than whatever is already on the screen underneath it.
        let read = 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].framebuffer);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(source.program);
        setCommon(source, show, i, opacity, beat, seconds);
        drawFullscreen(gl);

        for (let step = 0; step < chain.length; step++) {
          const { applied, program } = chain[step];
          const last = step === chain.length - 1;
          const write = 1 - read;

          if (last) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.enable(gl.BLEND);
            gl.blendFunc(src, dst);
          } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].framebuffer);
            gl.disable(gl.BLEND);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }

          gl.useProgram(program.program);
          setCommon(program, show, i, opacity, beat, seconds);
          // The fader was applied when the source drew. An effect samples that
          // picture, so applying it again would square it at every step.
          gl.uniform1f(program.uniform('uOpacity'), 1);
          gl.uniform1f(program.uniform('uAmount'), applied.amount);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, targets[read].texture);
          gl.uniform1i(program.uniform('uTex'), 0);
          drawFullscreen(gl);

          read = write;
        }
      }
    },
  };
}
