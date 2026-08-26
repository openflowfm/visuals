import type { Circuit, Scheme, Show } from '../../protocol.ts';
import { flatten, portId, type CircuitImage, type CircuitVideo } from './circuit.ts';
import { createNumberEvaluator, type NumberEvaluator } from './evaluateNumber.ts';
import { createFeed, type Banks } from './feed.ts';
import { banksOf, buildFlow, signatureOf } from './flow.ts';
import { compile, createTarget, drawFullscreen, type Program } from './gl.ts';
import { columns, warpFor, SQUARE, type Corners } from './output.ts';
import { createVideoBank } from './video.ts';
import { createImageBank } from './image.ts';

/**
 * Two passes and an output stage, where there used to be a stack of them.
 *
 * The renderer is a graph now, and a graph of colours needs no buffers — a
 * colour is an expression evaluated at a point, so a whole flow compiles to one
 * fragment shader. See `circuit.ts`.
 *
 * The one thing that cannot be an expression is the **set**. A `tracks` node
 * draws the same picture once per playing Live track with a different colour,
 * meter and fader each time, and a fragment shader cannot loop over a varying
 * number of those cheaply. So it stays a pass: every playing track drawn into
 * one target, which the flow then reads as a texture.
 *
 * **What each pass is fed is [not this file's](./feed.ts)**, and the split is
 * recent. The node faces on the canvas are the other front end, they were
 * feeding their own flows a different set of numbers, and the two lists drifted
 * until the small picture and the big one could not be compared. What is left
 * here is what a *wall* adds: a target to draw into, a keystone and a gain.
 */

export interface Compositor {
  frame(show: Show, scheme: Scheme | null, beat: number, seconds: number, dt: number): void;
  setOutput(output: Output | null): void;
  /** Draw for a window somebody is looking *at*, rather than for a projector. */
  preview(on: boolean): void;
  resize(): void;
  free(): void;
  readonly error: string | null;
}

export interface Output {
  corners: Corners;
  /** Master brightness. 1 is what the flow asked for. */
  gain: number;
  /** Overlay a grid, in source space, so it arrives on the wall already warped. */
  test: boolean;
}

/** A built flow, and enough about it to know when it stopped being current. */
interface Built {
  program: Program | null;
  /** What it was compiled from. Structure only — a set number is a uniform. */
  signature: string;
  error: string | null;
  /** Re-read every frame, because a value is a uniform. See `banksOf`. */
  banks: Banks;
  /** How each Live track draws, or null when the flow never asked for the set. */
  draws: string | null;
  circuit: Circuit;
  videos: CircuitVideo[];
  images: CircuitImage[];
  numbers: NumberEvaluator;
}

export function createCompositor(canvas: HTMLCanvasElement): Compositor {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    return {
      frame() {},
      setOutput() {},
      preview() {},
      resize() {},
      free() {},
      error: 'WebGL2 is not available in this browser.',
    };
  }

  let error: string | null = null;
  /** False between a context being lost and the browser handing one back. */
  let alive = true;
  const flows = new Map<string, Built>();
  let feed = createFeed(gl);
  let video = createVideoBank(gl);
  let image = createImageBank(gl);

  /** Where the set's own picture lands, for the flow to read. */
  let live = createTarget(gl);
  /** Where the flow lands, before the output stage takes it to the screen. */
  let out = createTarget(gl);
  let warp = columns(warpFor(SQUARE));
  let gain = 1;
  let test = false;

  /**
   * The scheme a flow last failed to *build* from.
   *
   * Not the same failure as a shader that would not compile, which the `Built`
   * below already remembers by signature. This one is a graph that could not be
   * flattened at all — a node kind nothing can draw, out of a hand edit or an
   * MCP typo — and there is no signature to key it by, because computing one
   * means flattening it. So the scheme object is the key: retrying costs an
   * edit rather than a frame. Rebuilding it per frame is the wall freezing while
   * it re-flattens a broken graph sixty times a second.
   */
  const brokenFrom = new Map<string, Scheme>();

  const flowProgram = (scheme: Scheme, id: string): Built => {
    const held = flows.get(id);
    if (held && brokenFrom.get(id) === scheme) {
      error = `${scheme.flows[id]?.name || id}: ${held.error}`;
      return held;
    }
    try {
      const built = buildProgram(scheme, id, held);
      brokenFrom.delete(id);
      return built;
    } catch (err) {
      // Outside the GL try below on purpose: this is `flatten` and `buildFlow`
      // failing, not a shader. A flow that cannot be built draws nothing and
      // says so in the panel, which is an evening somebody can rescue.
      const built = nothing((err as Error).message);
      flows.set(id, built);
      brokenFrom.set(id, scheme);
      error = `${scheme.flows[id]?.name || id}: ${built.error}`;
      return built;
    }
  };

  /** A flow that could not be built, in the shape `frame` reads. Draws nothing. */
  const nothing = (why: string): Built => ({
    program: null,
    signature: '',
    error: why,
    banks: banksOf({ nodes: [], cords: [] }),
    draws: null,
    circuit: { nodes: [], cords: [] },
    videos: [],
    images: [],
    numbers: createNumberEvaluator(),
  });

  const buildProgram = (scheme: Scheme, id: string, held: Built | undefined): Built => {
    const signature = signatureOf(scheme.flows, id);
    const { circuit } = flatten(scheme.flows, id);
    if (held && held.signature === signature) {
      held.banks = banksOf(circuit);
      held.circuit = circuit;
      return held;
    }
    if (held?.program) gl.deleteProgram(held.program.program);

    const compiled = buildFlow(scheme.flows, id);
    const built: Built = {
      program: null,
      signature,
      error: compiled.error,
      banks: banksOf(circuit),
      draws: compiled.draws,
      circuit,
      videos: compiled.videos,
      images: compiled.images,
      numbers: createNumberEvaluator(),
    };
    if (compiled.source) {
      try {
        built.program = compile(gl, compiled.source, `flow:${id}`);
        built.error = null;
      } catch (err) {
        built.error = (err as Error).message;
      }
    }
    if (built.error) error = `${scheme.flows[id]?.name || id}: ${built.error}`;
    else error = null;
    flows.set(id, built);
    return built;
  };

  /**
   * The drawing buffer, capped at `MAX_EDGE` on its longest side.
   *
   * Fill rate is the single number that decides whether the rig holds 60. Left
   * to the display it is ruinous: a Retina laptop reports a device pixel ratio
   * of 2, which on an ordinary window asks for 7.5 megapixels sixty times a
   * second. A projector is 1080p, and the output of this is a projector — so the
   * cap is the honest resolution of the destination rather than of whatever
   * screen someone happens to be previewing on.
   *
   * **A console with a wall open is not a destination**, and drawing it as if it
   * were is the one way this rig can cost twice what it should: the same graph,
   * the same shader, at the same 1920, for a picture nobody is projecting. So a
   * preview draws at `PREVIEW_EDGE` — a quarter of the pixels, which is a tenth
   * of the frame's cost and a picture you can still judge a flow on.
   */
  const MAX_EDGE = Number(new URLSearchParams(location.search).get('maxEdge')) || 1920;
  const PREVIEW_EDGE = 960;
  let edge = MAX_EDGE;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    let height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    const over = Math.max(width, height) / edge;
    if (over > 1) {
      width = Math.max(1, Math.round(width / over));
      height = Math.max(1, Math.round(height / over));
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    live.resize(width, height);
    out.resize(width, height);
  };

  resize();

  /** Everything this holds on the GPU, and the video elements beside it. */
  const release = () => {
    live.free();
    out.free();
    feed.free();
    video.free();
    image.free();
    for (const built of flows.values()) if (built.program) gl.deleteProgram(built.program.program);
    flows.clear();
    brokenFrom.clear();
  };

  /**
   * A GPU reset, which on a show machine is a driver crash, a laptop switching
   * graphics, or a display waking up.
   *
   * Every GL call after one is a silent no-op, so with nothing listening the
   * wall simply stays black and nothing anywhere says why. `preventDefault` is
   * what makes the browser offer a restore at all.
   *
   * The teardown is here, on the loss, rather than on the restore: while the
   * context is lost every call is a harmless no-op, where a call made *after*
   * restoration holding a handle from before it is an `INVALID_OPERATION`.
   * What it actually releases is the half that is not on the GPU — the video
   * elements the bank keeps open.
   */
  const onLost = (e: Event) => {
    e.preventDefault();
    alive = false;
    error = 'the graphics context was lost — waiting for the browser to hand one back';
    release();
  };

  /**
   * Nothing is restored, because nothing survived — it is all made again.
   *
   * The caches are the point: they are what knows a flow existed, and clearing
   * them is what makes the next frame rebuild exactly the flow that was up.
   */
  const onRestored = () => {
    feed = createFeed(gl);
    video = createVideoBank(gl);
    image = createImageBank(gl);
    live = createTarget(gl);
    out = createTarget(gl);
    alive = true;
    error = null;
    resize();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    get error() {
      return error ?? feed.error ?? video.error ?? image.error;
    },
    resize,
    preview(on) {
      // `?maxEdge` still wins. Someone who asked for 800 asked for 800.
      const next = on ? Math.min(MAX_EDGE, PREVIEW_EDGE) : MAX_EDGE;
      if (next === edge) return;
      edge = next;
      resize();
    },
    setOutput(output) {
      test = output?.test ?? false;
      gain = output?.gain ?? 1;
      warp = columns(warpFor(output?.corners ?? SQUARE));
    },
    free() {
      // Before the release, or `loseContext` below would fire `onLost` and
      // release a second time.
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (alive) {
        release();
        // A context is not collected when the last reference to it goes: a
        // browser keeps around sixteen per origin and evicts the oldest, so
        // opening and closing the console enough times silently kills the wall's
        // own context. This is the one call that actually hands one back.
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    },
    frame(show, scheme, beat, seconds, dt) {
      // Nothing to draw into. Every call below would be a no-op anyway; not
      // making them is what keeps a lost context from rebuilding flows that
      // cannot compile, sixty times a second, until it comes back.
      if (!alive) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);

      const at = { show, scheme, beat, seconds, dt, width: canvas.width, height: canvas.height };
      const id = show.flow;
      const built = scheme && id ? flowProgram(scheme, id) : null;

      // --- the set's own picture, when the flow asked for it ---------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, live.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (built?.draws) feed.drawSet(at, built.draws);

      // --- the flow --------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      if (built?.program) {
        gl.useProgram(built.program.program);
        feed.flow(built.program, at, built.banks);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, live.texture);
        gl.uniform1i(built.program.uniform('uTracksTex'), 0);
        const sample = built.numbers.sample(built.circuit, {
          show,
          beat,
          seconds,
          dt,
          pace: scheme?.defaults.pace,
        });
        video.bind(
          built.program,
          built.videos,
          (binding) => sample.inlet(portId(binding.id, 'pace')) ?? 0.5,
          id ?? '',
        );
        image.bind(built.program, built.images, id ?? '');
        drawFullscreen(gl);
      } else {
        video.clear();
        image.clear();
      }

      // --- to the wall -----------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      feed.grade(out.texture, at, { warp, gain, test });
    },
  };
}
