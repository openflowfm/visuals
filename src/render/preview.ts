import type { EffectDef, SourceKind } from '../../protocol.ts';
import { effectShader, namedTracks, paramsOf, signatureOf, trackBank } from './effect.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program } from './gl.ts';
import { columns, warpFor, OUTPUT_SHADER, SQUARE } from './output.ts';
import { sourceSources } from './shaders.ts';

/**
 * One source through one effect, on its own canvas.
 *
 * The reason the effect editor is usable at all. Wiring a shader graph against
 * the stage means editing something you cannot see — the panel is over it, the
 * effect might be dialled to nothing by the section's energy, and the layer
 * carrying it might not be playing. So the bench draws its own frame, at its own
 * energy, with the effect at whatever amount you ask for, and it does it on the
 * **same clock as the show**: a wave wired to the beat is in time with the room
 * while you are building it.
 *
 * It shares `effect.ts` with the compositor rather than reimplementing it, and
 * it ends on the same **output stage** — so the shoulder that keeps the stage
 * from blowing out is in the bench too. A preview that could disagree with the
 * stage about what an effect looks like would be worse than no preview, and
 * brightness is exactly the thing you come here to judge.
 */
export interface PreviewFrame {
  source: SourceKind;
  /** Null draws the bare source, which is also what a broken effect falls back to. */
  def: EffectDef | null;
  amount: number;
  energy: number;
  level: number;
  /** Packed `0xRRGGBB`, standing in for the song's colourway. */
  color: number;
  /** The scheme's pace trim, so the bench moves at the speed the stage will. */
  pace: number;
  beat: number;
  seconds: number;
  quantum: number;
  /**
   * A meter per track, by name, for a look that named one.
   *
   * The bench has no show to read, so the editor supplies the reading. It hands
   * over the real ones — a look wired to the bass has to be judged against the
   * bass actually playing, and a synthetic stand-in would be showing you a
   * different effect from the one the stage will draw.
   */
  meters?: (name: string) => number;
}

export interface Preview {
  frame(next: PreviewFrame): void;
  free(): void;
  /** The last compile failure, so the bench can say what is wrong with the wiring. */
  readonly error: string | null;
}

export function createPreview(canvas: HTMLCanvasElement): Preview {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) {
    return {
      frame() {},
      free() {},
      error: 'WebGL2 is not available in this browser.',
    };
  }

  let error: string | null = null;
  const sources = new Map<SourceKind, Program>();
  // Two, ping-ponged the way the compositor does it: the source lands in one,
  // the effect in the other, and the output stage reads whichever ended up last.
  const targets = [createTarget(gl), createTarget(gl)];
  let stage: Program | null = null;
  const identity = columns(warpFor(SQUARE));
  /**
   * Programs by signature, plural, and the plural is load-bearing.
   *
   * One bench shows one effect and a single slot was right for it. The look
   * canvas draws a picture *per node* — the same circuit cut off at each of its
   * outlets in turn — which means one context cycling through a dozen defs every
   * frame. A single slot would evict and recompile on each of them, calling the
   * driver's compiler twelve times a frame; a map compiles each once and never
   * again. A failure is remembered as a failure for the same reason it is in the
   * compositor.
   */
  const effects = new Map<string, { program: Program | null; error: string | null }>();

  const sourceProgram = (kind: SourceKind): Program | null => {
    const held = sources.get(kind);
    if (held) return held;
    try {
      const built = compile(gl, sourceSources.get(kind)!, `preview:${kind}`);
      sources.set(kind, built);
      return built;
    } catch (err) {
      error = (err as Error).message;
      return null;
    }
  };

  const effectProgram = (def: EffectDef): Program | null => {
    const signature = signatureOf(def);
    const held = effects.get(signature);
    if (held) {
      error = held.error;
      return held.program;
    }
    const built: { program: Program | null; error: string | null } = {
      program: null,
      error: null,
    };
    const { source, error: why } = effectShader(def);
    if (!source) {
      built.error = why;
    } else {
      try {
        built.program = compile(gl, source, 'preview:effect');
      } catch (err) {
        built.error = (err as Error).message;
      }
    }
    effects.set(signature, built);
    error = built.error;
    return built.program;
  };

  const size = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    for (const target of targets) target.resize(width, height);
  };

  const setCommon = (program: Program, next: PreviewFrame, opacity: number) => {
    gl.uniform2f(program.uniform('uRes'), canvas.width, canvas.height);
    gl.uniform1f(program.uniform('uTime'), next.seconds);
    gl.uniform1f(program.uniform('uBeat'), next.beat);
    gl.uniform1f(
      program.uniform('uPhase'),
      ((next.beat % next.quantum) + next.quantum) % next.quantum,
    );
    gl.uniform1f(program.uniform('uQuantum'), next.quantum);
    gl.uniform1f(program.uniform('uLevel'), next.level);
    gl.uniform1f(program.uniform('uEnergy'), next.energy);
    gl.uniform1f(program.uniform('uOpacity'), opacity);
    gl.uniform3fv(program.uniform('uColor'), rgb(next.color));
    gl.uniform1f(program.uniform('uSeed'), 11.7);
    gl.uniform1f(program.uniform('uPace'), next.pace);
  };

  return {
    get error() {
      return error;
    },
    free() {
      for (const target of targets) target.free();
      for (const p of sources.values()) gl.deleteProgram(p.program);
      if (stage) gl.deleteProgram(stage.program);
      for (const built of effects.values()) {
        if (built.program) gl.deleteProgram(built.program.program);
      }
    },
    frame(next) {
      size();
      gl.viewport(0, 0, canvas.width, canvas.height);
      // No blending anywhere here. Everything writes premultiplied alpha and the
      // context has no alpha channel, so a premultiplied colour written straight
      // to the screen *is* that colour composited over black — which is what a
      // preview wants to show.
      gl.disable(gl.BLEND);

      const source = sourceProgram(next.source);
      if (!source) return;
      const program = next.def ? effectProgram(next.def) : null;

      let read = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(source.program);
      setCommon(source, next, 1);
      drawFullscreen(gl);

      if (program) {
        read = 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].framebuffer);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program.program);
        setCommon(program, next, 1);
        gl.uniform1f(program.uniform('uAmount'), next.amount);
        gl.uniform1fv(program.uniform('uParams'), paramsOf(next.def!));
        const named = namedTracks(next.def!);
        if (named.some(Boolean)) {
          const meters = next.meters;
          gl.uniform1fv(
            program.uniform('uTracks'),
            trackBank(named, (name) => meters?.(name) ?? 0),
          );
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets[0].texture);
        gl.uniform1i(program.uniform('uTex'), 0);
        drawFullscreen(gl);
      }

      if (!stage) {
        try {
          stage = compile(gl, OUTPUT_SHADER, 'preview:output');
        } catch (err) {
          error = (err as Error).message;
          return;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(stage.program);
      // Square and at unity: the bench is not where a projector gets pointed,
      // and a keystone here would only make the effect harder to judge.
      gl.uniformMatrix3fv(stage.uniform('uWarp'), false, identity);
      gl.uniform1f(stage.uniform('uTest'), 0);
      gl.uniform1f(stage.uniform('uGain'), 1);
      gl.uniform2f(stage.uniform('uRes'), canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read].texture);
      gl.uniform1i(stage.uniform('uTex'), 0);
      drawFullscreen(gl);
    },
  };
}
