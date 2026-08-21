import type { Blend, LookDef, Scheme, Show } from '../../protocol.ts';
import { hint } from '../../hints.ts';
import { flatten } from './circuit.ts';
import {
  buildLook,
  namedEnergies,
  namedTracks,
  paramsOf,
  signatureOf,
  trackBank,
} from './look.ts';
import { compile, createTarget, drawFullscreen, rgb, type Program } from './gl.ts';
import { columns, warpFor, OUTPUT_SHADER, SQUARE, type Corners } from './output.ts';
import { TRACK_SHADERS } from './shaders.ts';

/**
 * Two passes and an output stage, where there used to be a stack of them.
 *
 * The renderer is a graph now, and a graph of colours needs no buffers — a
 * colour is an expression evaluated at a point, so a whole look compiles to one
 * fragment shader. See `circuit.ts`.
 *
 * The one thing that cannot be an expression is the **set**. A `tracks` node
 * draws the same picture once per playing Live track with a different colour,
 * meter and fader each time, and a fragment shader cannot loop over a varying
 * number of those cheaply. So it stays a pass: every playing track drawn into
 * one target, which the look then reads as a texture.
 *
 * **Blending is fixed-function** in that pass, so there is no accumulator
 * buffer. Every track shader writes premultiplied alpha, which lets one
 * `blendFunc` per track give the four modes below.
 */
const BLENDS: Record<Blend, [number, number]> = {
  // Premultiplied "over" — the ordinary stacking that something has to do.
  over: [1, 0x0303], // ONE, ONE_MINUS_SRC_ALPHA
  add: [1, 1], // ONE, ONE
  screen: [1, 0x0301], // ONE, ONE_MINUS_SRC_COLOR
  multiply: [0x0306, 0x0303], // DST_COLOR, ONE_MINUS_SRC_ALPHA
};

export interface Compositor {
  frame(show: Show, scheme: Scheme | null, beat: number, seconds: number, dt: number): void;
  setOutput(output: Output | null): void;
  resize(): void;
  free(): void;
  readonly error: string | null;
}

export interface Output {
  corners: Corners;
  /** Master brightness. 1 is what the look asked for. */
  gain: number;
  /** Overlay a grid, in source space, so it arrives on the wall already warped. */
  test: boolean;
}

/** A built look, and enough about it to know when it stopped being current. */
interface Built {
  program: Program | null;
  /** What it was compiled from. Structure only — a knob's value is a uniform. */
  signature: string;
  error: string | null;
  params: Float32Array;
  tracks: string[];
  energies: { name: string; smooth: number }[];
  /** How each Live track draws, or null when the look never asked for the set. */
  draws: string | null;
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
      resize() {},
      free() {},
      error: 'WebGL2 is not available in this browser.',
    };
  }

  let error: string | null = null;
  const looks = new Map<string, Built>();
  const sources = new Map<string, Program | null>();

  /** Where the set's own picture lands, for the look to read. */
  const live = createTarget(gl);
  /** Where the look lands, before the output stage takes it to the screen. */
  const out = createTarget(gl);
  let warp = columns(warpFor(SQUARE));
  let gain = 1;
  let test = false;
  let stage: Program | null = null;

  /**
   * Where each track's opacity currently is, as against where the show says.
   *
   * Without this, a scene change would pop tracks into existence on one frame.
   * Eased, it reads as the picture opening up, which is what the scene actually
   * did. Keyed by track index because that is a track's identity across every
   * reshuffle of the set.
   */
  const shown = new Map<number, number>();

  /**
   * Smoothed meters, one per name an `energy` node asked for.
   *
   * On the CPU because an envelope follower has to remember what it saw last
   * frame, and a fragment shader cannot. This is the whole implementation of
   * "energy means whatever you decide it means": a meter, an attack and a
   * release, and the name is yours.
   */
  const followed = new Map<string, number>();

  const sourceProgram = (mode: string): Program | null => {
    const held = sources.get(mode);
    if (held !== undefined) return held;
    const glsl = TRACK_SHADERS.get(mode) ?? TRACK_SHADERS.get('plasma')!;
    let built: Program | null = null;
    try {
      built = compile(gl, glsl, `source:${mode}`);
    } catch (err) {
      error = `${mode}: ${(err as Error).message}`;
    }
    sources.set(mode, built);
    return built;
  };

  const lookProgram = (scheme: Scheme, id: string): Built => {
    const signature = signatureOf(scheme.looks, id);
    const held = looks.get(id);
    const { circuit } = flatten(scheme.looks, id);
    if (held && held.signature === signature) {
      held.params = paramsOf(circuit);
      return held;
    }
    if (held?.program) gl.deleteProgram(held.program.program);

    const compiled = buildLook(scheme.looks, id);
    const built: Built = {
      program: null,
      signature,
      error: compiled.error,
      params: paramsOf(circuit),
      tracks: namedTracks(circuit),
      energies: namedEnergies(circuit),
      draws: compiled.draws,
    };
    if (compiled.source) {
      try {
        built.program = compile(gl, compiled.source, `look:${id}`);
        built.error = null;
      } catch (err) {
        built.error = (err as Error).message;
      }
    }
    if (built.error) error = `${scheme.looks[id]?.name || id}: ${built.error}`;
    else error = null;
    looks.set(id, built);
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
    live.resize(width, height);
    out.resize(width, height);
  };

  resize();

  const clock = (
    program: Program,
    show: Show,
    scheme: Scheme | null,
    beat: number,
    seconds: number,
  ) => {
    const quantum = show.quantum || 4;
    gl.uniform2f(program.uniform('uRes'), canvas.width, canvas.height);
    gl.uniform1f(program.uniform('uTime'), seconds);
    gl.uniform1f(program.uniform('uBeat'), beat);
    gl.uniform1f(program.uniform('uPhase'), ((beat % quantum) + quantum) % quantum);
    gl.uniform1f(program.uniform('uQuantum'), quantum);
    gl.uniform1f(program.uniform('uPace'), scheme?.defaults.pace ?? 0);
  };

  return {
    get error() {
      return error;
    },
    resize,
    setOutput(output) {
      test = output?.test ?? false;
      gain = output?.gain ?? 1;
      warp = columns(warpFor(output?.corners ?? SQUARE));
    },
    free() {
      live.free();
      out.free();
      if (stage) gl.deleteProgram(stage.program);
      for (const built of looks.values()) if (built.program) gl.deleteProgram(built.program.program);
      for (const program of sources.values()) if (program) gl.deleteProgram(program.program);
    },
    frame(show, scheme, beat, seconds, dt) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);

      const room = show.master;
      // Roughly a 200ms glide however fast the display runs, so a change looks
      // the same on 60 Hz and 144 Hz.
      const glide = 1 - Math.exp(-dt / 0.2);

      const id = show.look;
      const built = scheme && id ? lookProgram(scheme, id) : null;

      // --- the set's own picture, when the look asked for it ---------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, live.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (built?.draws) {
        gl.enable(gl.BLEND);
        for (const track of show.tracks) {
          // Nothing playing means nothing drawn — not the last thing that
          // played. A track holding its previous clip after the scene changed
          // is the failure that looks most like the renderer having crashed.
          const target = track.playing < 0 ? 0 : track.opacity;
          const was = shown.get(track.t) ?? 0;
          const opacity = was + (target - was) * glide;
          shown.set(track.t, opacity);
          if (opacity <= 0.002) continue;

          const mode = built.draws === 'by name' ? hint(track.name) : built.draws;
          const program = sourceProgram(mode);
          if (!program) continue;

          const [src, dst] = BLENDS[trackBlend(track.t)] ?? BLENDS.screen;
          gl.blendFunc(src, dst);
          gl.useProgram(program.program);
          clock(program, show, scheme, beat, seconds);
          gl.uniform1f(program.uniform('uLevel'), track.level);
          gl.uniform1f(program.uniform('uEnergy'), room);
          gl.uniform1f(program.uniform('uOpacity'), opacity);
          gl.uniform3fv(program.uniform('uColor'), rgb(track.color));
          // Per track and stable, so two tracks drawing the same picture out of
          // the same colourway do not draw the identical thing on top of each
          // other. It is also what spreads them across the division ladder.
          gl.uniform1f(program.uniform('uSeed'), track.t * 37.13);
          drawFullscreen(gl);
        }
      }

      // --- the look --------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      if (built?.program) {
        const program = built.program;
        gl.useProgram(program.program);
        clock(program, show, scheme, beat, seconds);
        gl.uniform1f(program.uniform('uLevel'), room);
        gl.uniform1f(program.uniform('uEnergy'), room);
        gl.uniform1f(program.uniform('uOpacity'), 1);
        gl.uniform1f(program.uniform('uSeed'), 3.71);
        gl.uniform3fv(program.uniform('uColor'), rgb(show.colors[0] ?? 0xffffff));
        gl.uniform1f(program.uniform('uSongSeed'), seedOf(show.song));
        gl.uniform1f(program.uniform('uSongTempo'), show.tempo);
        // A half for a set that states no key, which is the convention every
        // other song fact here already follows: no answer sits in the middle.
        gl.uniform1f(program.uniform('uSongKey'), show.key ?? 0.5);
        gl.uniform1f(program.uniform('uSection'), sectionOf(show));
        gl.uniform1f(program.uniform('uSections'), show.roles.length / 8);
        gl.uniform1fv(program.uniform('uParams'), built.params);

        const meter = (name: string) =>
          name === 'master' ? show.master : (show.tracks.find((t) => t.name === name)?.level ?? 0);

        if (built.tracks.some(Boolean)) {
          gl.uniform1fv(program.uniform('uTracks'), trackBank(built.tracks, meter));
        }
        if (built.energies.some((each) => each.name)) {
          const bank = new Float32Array(8);
          built.energies.forEach((each, i) => {
            if (!each.name) return;
            // Fast up, slow down. An envelope that fell as quickly as it rose
            // would be the meter again, and the meter is already a node.
            const now = meter(each.name);
            const was = followed.get(each.name) ?? 0;
            const fall = 1 - Math.exp(-dt / (0.05 + each.smooth * 1.95));
            const value = now > was ? now : was + (now - was) * fall;
            followed.set(each.name, value);
            bank[i] = value;
          });
          gl.uniform1fv(program.uniform('uEnergies'), bank);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, live.texture);
        gl.uniform1i(program.uniform('uTracksTex'), 0);
        drawFullscreen(gl);
      }

      // --- to the wall -----------------------------------------------------
      if (!stage) {
        try {
          stage = compile(gl, OUTPUT_SHADER, 'output');
        } catch (err) {
          error = (err as Error).message;
          return;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(stage.program);
      gl.uniformMatrix3fv(stage.uniform('uWarp'), false, warp);
      gl.uniform1f(stage.uniform('uTest'), test ? 1 : 0);
      gl.uniform1f(stage.uniform('uGain'), gain);
      gl.uniform2f(stage.uniform('uRes'), canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, out.texture);
      gl.uniform1i(stage.uniform('uTex'), 0);
      drawFullscreen(gl);
    },
  };
}

/**
 * How a track stacks on the ones drawn before it.
 *
 * `screen` for everything above the bottom, because it saturates at white rather
 * than climbing past it. An even pick over the four modes puts a quarter of a
 * tall stack on `add`, and a quarter is enough to white out the frame before the
 * tracks that were meant to be seen have drawn. The bottom one is `over` because
 * something has to be opaque.
 *
 * A fixed rule rather than a bound one, and that is the trade this whole change
 * makes: per-track blend was a field on a binding that no longer exists. If it
 * needs to vary, it varies inside the graph — a `blend` node is right there.
 */
function trackBlend(t: number): Blend {
  return t === 0 ? 'over' : 'screen';
}

/** A stable 0–1 per song name, so `song.seed` is a different number per song. */
function seedOf(name: string | null): number {
  if (!name) return 0.5;
  let h = 1779033703 ^ name.length;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where the playing section sits among the ones the set uses, 0–1. */
function sectionOf(show: Show): number {
  if (!show.role || show.roles.length < 2) return 0.5;
  const at = show.roles.indexOf(show.role);
  return at < 0 ? 0.5 : at / (show.roles.length - 1);
}
