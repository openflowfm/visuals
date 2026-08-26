import { TRACK_DRAWS, type Circuit, type FlowDef, type Scheme, type Show } from '../../protocol.ts';
import { compileCircuit, flatten } from './circuit.ts';
import { createFeed } from './feed.ts';
import { banksOf, signatureOfCircuit } from './flow.ts';
import { compile, createTarget, drawFullscreen, type Program } from './gl.ts';
import { createVideoBank } from './video.ts';
import { createImageBank } from './image.ts';

/**
 * A small picture of what one node has made.
 *
 * Not the bench. The bench is a whole `Compositor` on its own canvas, drawing
 * the flow exactly the way the wall will. This is the other thing: the face of
 * every node on the canvas, showing what *that* node produced.
 *
 * A node face showing a thumbnail of the finished flow would be the same image
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
 *
 * ## It is fed exactly what the bench is fed
 *
 * It used to be fed stand-ins — the set as one grid shader in a hardcoded
 * orange, every meter banked at a half, the tempo at 120, the section at the
 * middle, the song's key not set at all — on the argument that a node face is a
 * *diagram* and the real set would make a dozen tiny canvases flicker.
 *
 * That argument was wrong in the way that matters. The gesture this whole panel
 * is built around is **click a face and see it bigger**, and a small picture
 * that cannot be compared to the big one has failed at the only thing it is
 * for: you cannot tell whether the difference you are looking at is the node or
 * the renderer. So the faces now read the same [`Show`](../state/useRoom.ts) the
 * bench does — which at a desk is the room, dialled, and therefore steady
 * anyway — through the same [`feed`](./feed.ts), and land through the same
 * output stage. What is left different is framing and resolution, which are
 * properties of a 320-pixel canvas and cannot be otherwise.
 */

/** What every face this frame shares. */
export interface PreviewRoom {
  /**
   * The graph the faces are all probes of.
   *
   * Here so the set's own pass is drawn **once** for the whole canvas rather
   * than once per face: every probe of one flow reads the same `tracks` node,
   * and drawing twenty-six Live tracks a dozen times over for one frame is the
   * kind of cost that only shows up on somebody else's laptop.
   */
  circuit: Circuit;
  show: Show;
  /**
   * The whole scheme, for the same reason the compositor takes one.
   *
   * Its library is what a face showing a `flow` node is expanded against —
   * without it that face is black, and so is every face downstream of one, since
   * `compileCircuit` alone cannot expand a nested flow. The bench and the wall
   * never had the problem because they go through `compileFlow`, which has the
   * library; this is the one path that was handed a bare circuit.
   */
  scheme: Scheme;
  beat: number;
  seconds: number;
  dt: number;
}

export interface Preview {
  /** The clock and the set's picture, once, before any face is drawn. */
  begin(at: PreviewRoom): void;
  /** One face, onto the shared canvas, for the caller to blit. */
  draw(circuit: Circuit): void;
  free(): void;
  /** The last compile failure, so a face can say what is wrong with the wiring. */
  readonly error: string | null;
}

/** A built probe. The banks are not here: they are re-read every frame. */
interface Built {
  program: Program | null;
  error: string | null;
}

/**
 * How many probe shaders to keep before dropping the oldest.
 *
 * A face is cached by what it was compiled from, so turning a number costs
 * nothing and every structural edit costs one more entry — which over an
 * evening's building is thousands. Far above a canvas's worth of nodes, so the
 * only thing ever evicted is a graph that no longer exists.
 */
const KEEP = 96;

export function createPreview(canvas: HTMLCanvasElement): Preview {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) {
    return { begin() {}, draw() {}, free() {}, error: 'WebGL2 is not available in this browser.' };
  }

  let error: string | null = null;
  const feed = createFeed(gl);
  const video = createVideoBank(gl);
  const image = createImageBank(gl);
  const built = new Map<string, Built>();

  /** Where the set's own picture lands, for every face to read. */
  const live = createTarget(gl);
  /** Where a face lands, before the output stage grades it onto the canvas. */
  const out = createTarget(gl);

  let at: PreviewRoom | null = null;
  let width = 1;
  let height = 1;

  /**
   * The probe graph with every nested flow spliced in.
   *
   * Parked under a reserved id and expanded by the same `flatten` the stage
   * uses, rather than given a second expander of its own — a face that disagreed
   * with the bench about what a nested flow draws would be worse than a face
   * that showed nothing, because it would be believed.
   */
  const whole = (circuit: Circuit, flows: Record<string, FlowDef>): Circuit =>
    flatten({ ...flows, [FACE]: { name: 'face', circuit } }, FACE).circuit;

  const programFor = (circuit: Circuit): Built => {
    const signature = signatureOfCircuit(circuit);
    const held = built.get(signature);
    if (held) {
      error = held.error;
      return held;
    }
    const made: Built = { program: null, error: null };
    const compiled = compileCircuit(circuit);
    if (!compiled.source) {
      made.error = compiled.error;
    } else {
      try {
        made.program = compile(gl, compiled.source, 'preview');
      } catch (err) {
        made.error = (err as Error).message;
      }
    }
    // A build that failed is remembered as a failure. Retrying a broken graph
    // every frame would call the driver's compiler sixty times a second for as
    // long as it stayed broken, which is a stall rather than an error message.
    built.set(signature, made);
    if (built.size > KEEP) {
      const oldest = built.keys().next().value;
      if (oldest !== undefined) {
        const dropped = built.get(oldest);
        if (dropped?.program) gl.deleteProgram(dropped.program.program);
        built.delete(oldest);
      }
    }
    error = made.error;
    return made;
  };

  return {
    get error() {
      return error ?? feed.error;
    },

    free() {
      live.free();
      out.free();
      feed.free();
      video.free();
      image.free();
      for (const made of built.values()) if (made.program) gl.deleteProgram(made.program.program);
      // Deleting what a context holds does not give the context back. A browser
      // keeps about sixteen per origin and evicts the oldest, so opening and
      // closing the console enough times takes out the wall's own — the risk
      // `NodePictures.tsx` already documents. This is the call that returns one.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },

    begin(room) {
      at = room;
      width = Math.max(1, canvas.width);
      height = Math.max(1, canvas.height);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      live.resize(width, height);
      out.resize(width, height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, live.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // The op off the flow's own `tracks` node, expanded, so a flow that only
      // reads the set through a nested one still gets the right picture. Read
      // off the graph rather than out of `compileCircuit`, which would emit a
      // whole shader's worth of GLSL to answer one question, sixty times a
      // second.
      const drawn = whole(room.circuit, room.scheme.flows).nodes.find((n) => n.kind === 'tracks');
      if (drawn) feed.drawSet({ ...room, width, height }, drawn.op ?? TRACK_DRAWS[0]);
    },

    draw(circuit) {
      if (!at) return;
      const graph = whole(circuit, at.scheme.flows);
      const made = programFor(graph);
      const feeding = { ...at, width, height };

      gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      if (made.program) {
        gl.useProgram(made.program.program);
        feed.flow(made.program, feeding, banksOf(graph));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, live.texture);
        gl.uniform1i(made.program.uniform('uTracksTex'), 0);
        // One shared context cycles through up to ten different probe graphs in
        // a frame. Starting and tearing down decoders per thumbnail would be
        // worse than hiding the thumbnail, so small faces bind transparent;
        // promotion into the bench uses the full compositor and plays it.
        video.bind(made.program, [], () => 0.5);
        image.bind(made.program, []);
        drawFullscreen(gl);
      }

      // Through the same output stage the wall gets, minus the keystone and the
      // gain — which describe a projector rather than a flow. The shoulder is
      // not one of those: a face that skipped it would show highlights the
      // bench beside it has already rolled off.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      feed.grade(out.texture, feeding);
    },
  };
}

/** An id nobody can type, because a flow called `face` is perfectly legal. */
const FACE = '~face';
