import type { LookDef } from '../../protocol.ts';
import { lookShader, namedTracks, paramsOf, signatureOf, trackBank } from './look.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program } from './gl.ts';
import { columns, warpFor, OUTPUT_SHADER, SQUARE } from './output.ts';

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
/** One pass of a preview's stack. */
export interface PreviewPass {
  def: LookDef;
  /** 0–1. Meaningless to a generator, which writes the frame outright. */
  amount: number;
}

export interface PreviewFrame {
  /**
   * The stack, bottom first.
   *
   * A stack rather than a source and an effect, because that split is gone —
   * and because it is what makes one renderer serve both halves of the
   * designer. A single look is a stack of one; a **composition** is a stack of
   * several, drawn exactly the way the stage will draw it. Two code paths for
   * those would be two things that could disagree about what you are about to
   * put on a wall.
   */
  stack: readonly PreviewPass[];
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
  // Two, ping-ponged the way the compositor does it: each pass reads the one it
  // did not just write, and the output stage takes whichever ended up last.
  const targets = [createTarget(gl), createTarget(gl)];
  let stage: Program | null = null;
  const identity = columns(warpFor(SQUARE));
  /**
   * Programs by signature, plural, and the plural is load-bearing.
   *
   * One bench showing one look could live with a single slot. The look
   * canvas draws a picture *per node* — the same circuit cut off at each of its
   * outlets in turn — which means one context cycling through a dozen defs every
   * frame. A single slot would evict and recompile on each of them, calling the
   * driver's compiler twelve times a frame; a map compiles each once and never
   * again. A failure is remembered as a failure for the same reason it is in the
   * compositor.
   */
  const looks = new Map<string, { program: Program | null; error: string | null }>();

  const lookProgram = (def: LookDef): Program | null => {
    const signature = signatureOf(def);
    const held = looks.get(signature);
    if (held) {
      error = held.error;
      return held.program;
    }
    const built: { program: Program | null; error: string | null } = {
      program: null,
      error: null,
    };
    const { source, error: why } = lookShader(def);
    if (!source) {
      built.error = why;
    } else {
      try {
        built.program = compile(gl, source, 'preview:effect');
      } catch (err) {
        built.error = (err as Error).message;
      }
    }
    looks.set(signature, built);
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
      if (stage) gl.deleteProgram(stage.program);
      for (const built of looks.values()) {
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

      // A pass that failed to build drops out rather than emptying the stack,
      // so a broken look in the middle of a composition costs that look and not
      // the picture.
      const stack = next.stack.flatMap((pass) => {
        const program = lookProgram(pass.def);
        return program ? [{ pass, program }] : [];
      });

      let read = 0;
      if (stack.length === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].framebuffer);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }

      for (let step = 0; step < stack.length; step++) {
        const { pass, program } = stack[step];
        read = step % 2;
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].framebuffer);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program.program);
        setCommon(program, next, 1);
        gl.uniform1f(program.uniform('uAmount'), pass.amount);
        gl.uniform1fv(program.uniform('uParams'), paramsOf(pass.def));
        const named = namedTracks(pass.def);
        if (named.some(Boolean)) {
          const meters = next.meters;
          gl.uniform1fv(
            program.uniform('uTracks'),
            trackBank(named, (name) => meters?.(name) ?? 0),
          );
        }
        // The frame beneath, which the bottom of a stack reads as black.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets[1 - read].texture);
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
