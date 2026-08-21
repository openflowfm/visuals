import type { Circuit, LookDef } from '../../protocol.ts';
import { compileCircuit, flatten } from './circuit.ts';
import { paramsOf, signatureOfCircuit } from './look.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program } from './gl.ts';
import { TRACK_SHADERS } from './shaders.ts';

/**
 * A small picture of what one node has made.
 *
 * Not the bench. The bench is a whole `Compositor` on its own canvas, drawing
 * the look exactly the way the wall will — one renderer, so nothing can
 * disagree about what you are about to project. This is the other thing: the
 * face of every node on the canvas, showing what *that* node produced.
 *
 * A node face showing a thumbnail of the finished look would be the same image
 * a dozen times over and would teach nothing. One showing what has been built so
 * far turns the canvas into a series of steps you can read along, which is how
 * anyone reasons about signal flow anyway.
 *
 * **All of them come out of one GL context**, blitted into a small 2D canvas per
 * node. A context each is the obvious build and the wrong one: browsers keep
 * about sixteen alive and start evicting the oldest, and this page already has
 * the stage and the bench. Programs are cached by signature in a map rather than
 * one slot, because one context cycling through a dozen graphs a frame would
 * otherwise recompile every one of them, every frame.
 */
export interface PreviewFrame {
  circuit: Circuit;
  /**
   * The library, because a face may be showing a node that *is* another look.
   *
   * Without it a `look` node's face is black, and so is every face downstream of
   * one — `compileCircuit` alone cannot expand a nested look, and a graph whose
   * `look` node resolves to nothing draws nothing. The bench and the wall never
   * had the problem because they go through `compileLook`, which has the
   * library; this is the one path that was handed a bare circuit.
   */
  looks: Record<string, LookDef>;
  /** Hand-driven, because the whole point is seeing the node move on demand. */
  energy: number;
  level: number;
  /** Packed `0xRRGGBB`, standing in for the colourway. */
  color: number;
  pace: number;
  beat: number;
  seconds: number;
  quantum: number;
}

export interface Preview {
  frame(next: PreviewFrame): void;
  free(): void;
  /** The last compile failure, so a face can say what is wrong with the wiring. */
  readonly error: string | null;
}

export function createPreview(canvas: HTMLCanvasElement): Preview {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) {
    return { frame() {}, free() {}, error: 'WebGL2 is not available in this browser.' };
  }

  let error: string | null = null;
  /**
   * A stand-in for the Live set, so a graph containing a `tracks` node shows
   * something on a node face rather than black.
   *
   * Deliberately a stand-in rather than the real thing. A node picture is a
   * **diagram** — it is answering "what does this node do to what it was given"
   * — and threading the actual set through twelve tiny canvases would make every
   * face flicker with whatever happened to be playing, which is the opposite of
   * legible. The bench next to it is where you judge the real thing.
   */
  const live = createTarget(gl);
  let ground: Program | null = null;
  let groundTried = false;
  const looks = new Map<string, { program: Program | null; error: string | null }>();

  /**
   * The probe graph with every nested look spliced in.
   *
   * Parked under a reserved id and expanded by the same `flatten` the stage
   * uses, rather than given a second expander of its own — a face that disagreed
   * with the bench about what a nested look draws would be worse than a face
   * that showed nothing, because it would be believed.
   */
  const whole = (at: PreviewFrame): Circuit =>
    flatten({ ...at.looks, [FACE]: { name: 'face', circuit: at.circuit } }, FACE).circuit;

  const programFor = (circuit: Circuit): Program | null => {
    const signature = signatureOfCircuit(circuit);
    const held = looks.get(signature);
    if (held) {
      error = held.error;
      return held.program;
    }
    const built: { program: Program | null; error: string | null } = { program: null, error: null };
    const compiled = compileCircuit(circuit);
    if (!compiled.source) {
      built.error = compiled.error;
    } else {
      try {
        built.program = compile(gl, compiled.source, 'preview');
      } catch (err) {
        built.error = (err as Error).message;
      }
    }
    // A build that failed is remembered as a failure. Retrying a broken graph
    // every frame would call the driver's compiler sixty times a second for as
    // long as it stayed broken, which is a stall rather than an error message.
    looks.set(signature, built);
    error = built.error;
    return built.program;
  };

  const clock = (program: Program, at: PreviewFrame) => {
    gl.uniform2f(program.uniform('uRes'), canvas.width, canvas.height);
    gl.uniform1f(program.uniform('uTime'), at.seconds);
    gl.uniform1f(program.uniform('uBeat'), at.beat);
    gl.uniform1f(program.uniform('uPhase'), ((at.beat % at.quantum) + at.quantum) % at.quantum);
    gl.uniform1f(program.uniform('uQuantum'), at.quantum);
    gl.uniform1f(program.uniform('uLevel'), at.level);
    gl.uniform1f(program.uniform('uEnergy'), at.energy);
    gl.uniform1f(program.uniform('uOpacity'), 1);
    gl.uniform3fv(program.uniform('uColor'), rgb(at.color));
    gl.uniform1f(program.uniform('uSeed'), 3.71);
    gl.uniform1f(program.uniform('uPace'), at.pace);
  };

  return {
    get error() {
      return error;
    },
    free() {
      live.free();
      if (ground) gl.deleteProgram(ground.program);
      for (const built of looks.values()) if (built.program) gl.deleteProgram(built.program.program);
    },
    frame(at) {
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      live.resize(width, height);

      if (!groundTried) {
        groundTried = true;
        try {
          ground = compile(gl, TRACK_SHADERS.get('grid')!, 'preview:ground');
        } catch {
          ground = null;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, live.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (ground) {
        gl.useProgram(ground.program);
        clock(ground, at);
        drawFullscreen(gl);
      }

      // Once. The bank is cut to the graph and the shader declares it at that
      // size, so a face compiled from one expansion and fed from another is a
      // bank of the wrong length — which is a GL error and a black face.
      const graph = whole(at);
      const program = programFor(graph);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!program) return;

      gl.useProgram(program.program);
      clock(program, at);
      const bank = new Float32Array(8).fill(0.5);
      gl.uniform1fv(program.uniform('uParams'), paramsOf(graph));
      gl.uniform1fv(program.uniform('uTracks'), bank);
      gl.uniform1fv(program.uniform('uEnergies'), new Float32Array(8).fill(at.energy));
      gl.uniform1f(program.uniform('uSongSeed'), 0.42);
      gl.uniform1f(program.uniform('uSongTempo'), 120);
      gl.uniform1f(program.uniform('uSection'), 0.5);
      gl.uniform1f(program.uniform('uSections'), 0.5);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, live.texture);
      gl.uniform1i(program.uniform('uTracksTex'), 0);
      drawFullscreen(gl);
    },
  };
}

/** An id nobody can type, because a look called `face` is perfectly legal. */
const FACE = '~face';
