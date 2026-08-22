import type { Blend, Scheme, Show } from '../../protocol.ts';
import { hint } from '../../hints.ts';
import { sectionOf, seedOf, smoothTrack, trackReading } from './evaluateNumber.ts';
import { compile, drawFullscreen, rgb, type Program } from './gl.ts';
import type { TrackAsk } from './look.ts';
import { OUTPUT_SHADER, SQUARE, columns, warpFor } from './output.ts';
import { TRACK_SHADERS } from './shaders.ts';

// Kept as exports here for callers that got these renderer facts from `feed`
// before the CPU evaluator became their shared pure home.
export { sectionOf, seedOf } from './evaluateNumber.ts';

/**
 * What a look is fed, and the two passes that do the feeding.
 *
 * There are two front ends in this app — the stage, which is what a wall gets,
 * and the node faces on the canvas — and for a while they disagreed about
 * fourteen separate things. The faces drew the set as one grid shader tinted a
 * hardcoded orange, banked every meter at a half, ran the section and the tempo
 * off constants, never set the song's key at all, and skipped the shoulder. So
 * the small picture and the big one could not be compared, which is the only
 * thing either of them is for.
 *
 * None of that was a decision anybody made; it was two lists of `gl.uniform`
 * calls drifting apart, in different files, neither of which looked wrong on its
 * own. So there is one list, here, and both callers read it.
 *
 * **What the front ends still get to decide is the destination** — a wall gets a
 * keystone and a master gain, a node face gets neither — and nothing else.
 */

/** Everything about *right now* that is not about a particular look. */
export interface Feeding {
  show: Show;
  scheme: Scheme | null;
  beat: number;
  seconds: number;
  /** Seconds since the last frame, for the followers and the opacity glide. */
  dt: number;
  /** The buffer being drawn into, for aspect correction. */
  width: number;
  height: number;
}

/** What a compiled look needs banked, cut to its own graph. */
export interface Banks {
  params: Float32Array;
  tracks: readonly TrackAsk[];
}

/**
 * Fixed-function blending for the set's pass, so there is no accumulator buffer.
 *
 * Every track shader writes premultiplied alpha, which lets one `blendFunc` per
 * track give the four modes.
 */
const BLENDS: Record<Blend, [number, number]> = {
  // Premultiplied "over" — the ordinary stacking that something has to do.
  over: [1, 0x0303], // ONE, ONE_MINUS_SRC_ALPHA
  add: [1, 1], // ONE, ONE
  screen: [1, 0x0301], // ONE, ONE_MINUS_SRC_COLOR
  multiply: [0x0306, 0x0303], // DST_COLOR, ONE_MINUS_SRC_ALPHA
};

/**
 * How a track stacks on the ones drawn before it.
 *
 * `screen` for everything above the bottom, because it saturates at white rather
 * than climbing past it. An even pick over the four modes puts a quarter of a
 * tall stack on `add`, and a quarter is enough to white out the frame before the
 * tracks that were meant to be seen have drawn. The bottom one is `over` because
 * something has to be opaque.
 *
 * A fixed rule rather than a bound one: per-track blend was a field on a binding
 * that no longer exists. If it needs to vary, it varies inside the graph — a
 * `blend` node is right there.
 */
function trackBlend(t: number): Blend {
  return t === 0 ? 'over' : 'screen';
}

export interface Feed {
  /**
   * The set's own picture, into whatever framebuffer is bound.
   *
   * The one thing that cannot be an expression: a `tracks` node draws the same
   * picture once per playing Live track with a different colour, meter and fader
   * each time, and a fragment shader cannot loop over a varying number of those
   * cheaply. So it stays a pass.
   */
  drawSet(at: Feeding, draws: string): void;
  /** Every uniform a compiled look reads, out of one show. */
  look(program: Program, at: Feeding, banks: Banks): void;
  /**
   * The last pass: a picture on a texture, onto the screen.
   *
   * `corners` and `gain` describe **this projector in this room** and default to
   * neither, which is what a preview wants. The shoulder is not optional and
   * that is the point of it being here — it is the difference between a bench
   * that tells you what the wall will look like and one that flatters.
   */
  grade(texture: WebGLTexture, at: { width: number; height: number }, look?: Wall): void;
  readonly error: string | null;
  free(): void;
}

/** What the destination does to the picture, as against what the look asked for. */
export interface Wall {
  /** Column-major, as `columns` leaves it — the caller keeps it, not this. */
  warp?: Float32Array;
  /** Master brightness. 1 is what the look asked for. */
  gain?: number;
  /** Overlay a grid, in source space, so it arrives on the wall already warped. */
  test?: boolean;
}

const FLAT = columns(warpFor(SQUARE));

export function createFeed(gl: WebGL2RenderingContext): Feed {
  let error: string | null = null;
  const sources = new Map<string, Program | null>();
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
   * Smoothed readings, one per track-and-reading a `track` node asked for.
   *
   * On the CPU because an envelope follower has to remember what it saw last
   * frame, and a fragment shader cannot. This is the whole implementation of
   * "energy means whatever you decide it means": a number, an attack and a
   * release, and which number is yours.
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

  /** The clock, which every shader in the rig reads and none of them owns. */
  const clock = (program: Program, at: Feeding) => {
    const quantum = at.show.quantum || 4;
    gl.uniform2f(program.uniform('uRes'), at.width, at.height);
    gl.uniform1f(program.uniform('uTime'), at.seconds);
    gl.uniform1f(program.uniform('uBeat'), at.beat);
    gl.uniform1f(program.uniform('uPhase'), ((at.beat % quantum) + quantum) % quantum);
    gl.uniform1f(program.uniform('uQuantum'), quantum);
    gl.uniform1f(program.uniform('uPace'), at.scheme?.defaults.pace ?? 0);
  };

  return {
    get error() {
      return error;
    },

    drawSet(at, draws) {
      const { show } = at;
      // Roughly a 200ms glide however fast the display runs, so a change looks
      // the same on 60 Hz and 144 Hz.
      const glide = 1 - Math.exp(-at.dt / 0.2);
      gl.enable(gl.BLEND);
      for (const track of show.tracks) {
        // Nothing playing means nothing drawn — not the last thing that played.
        // A track holding its previous clip after the scene changed is the
        // failure that looks most like the renderer having crashed.
        const target = track.playing < 0 ? 0 : track.opacity;
        const was = shown.get(track.t) ?? 0;
        const opacity = was + (target - was) * glide;
        shown.set(track.t, opacity);
        if (opacity <= 0.002) continue;

        const mode = draws === 'by name' ? hint(track.name) : draws;
        const program = sourceProgram(mode);
        if (!program) continue;

        const [src, dst] = BLENDS[trackBlend(track.t)] ?? BLENDS.screen;
        gl.blendFunc(src, dst);
        gl.useProgram(program.program);
        clock(program, at);
        gl.uniform1f(program.uniform('uLevel'), track.level);
        gl.uniform1f(program.uniform('uEnergy'), show.master);
        gl.uniform1f(program.uniform('uOpacity'), opacity);
        gl.uniform3fv(program.uniform('uColor'), rgb(track.color));
        // Per track and stable, so two tracks drawing the same picture out of
        // the same colourway do not draw the identical thing on top of each
        // other. It is also what spreads them across the division ladder.
        gl.uniform1f(program.uniform('uSeed'), track.t * 37.13);
        drawFullscreen(gl);
      }
      gl.disable(gl.BLEND);
    },

    look(program, at, banks) {
      const { show } = at;
      const room = show.master;
      clock(program, at);
      gl.uniform1f(program.uniform('uLevel'), room);
      gl.uniform1f(program.uniform('uEnergy'), room);
      gl.uniform1f(program.uniform('uOpacity'), 1);
      gl.uniform1f(program.uniform('uSeed'), 3.71);
      gl.uniform3fv(program.uniform('uColor'), rgb(show.colors[0] ?? 0xffffff));
      gl.uniform1f(program.uniform('uSongSeed'), seedOf(show.song));
      gl.uniform1f(program.uniform('uSongTempo'), show.tempo);
      // A half for a set that states no key, which is the convention every other
      // song fact here already follows: no answer sits in the middle.
      gl.uniform1f(program.uniform('uSongKey'), show.key ?? 0.5);
      gl.uniform1f(program.uniform('uSection'), sectionOf(show));
      gl.uniform1f(program.uniform('uSections'), show.roles.length / 8);
      gl.uniform1fv(program.uniform('uParams'), banks.params);

      // One bank, filled per slot with whatever that node asked for. What used
      // to be two — raw meters and smoothed ones — is one question with a control
      // on it now, so the shader reads a number without learning which.
      if (banks.tracks.some((each) => each.name)) {
        const bank = new Float32Array(8);
        banks.tracks.forEach((each, i) => {
          if (!each.name) return;
          const now = trackReading(show, each.name, each.read);
          if (each.smooth <= 0) {
            bank[i] = now;
            return;
          }
          // Fast up, slow down. An envelope that fell as quickly as it rose
          // would be the number again, and the number is already the node
          // with its smoothing at zero. Keyed by name *and* reading, so a fader and
          // a meter off the same track do not share one follower.
          const key = `${each.name}/${each.read}`;
          const was = followed.get(key) ?? 0;
          const value = smoothTrack(was, now, each.smooth, at.dt);
          followed.set(key, value);
          bank[i] = value;
        });
        gl.uniform1fv(program.uniform('uTracks'), bank);
      }
    },

    grade(texture, at, wall) {
      if (!stage) {
        try {
          stage = compile(gl, OUTPUT_SHADER, 'output');
        } catch (err) {
          error = (err as Error).message;
          return;
        }
      }
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(stage.program);
      gl.uniformMatrix3fv(stage.uniform('uWarp'), false, wall?.warp ?? FLAT);
      gl.uniform1f(stage.uniform('uTest'), wall?.test ? 1 : 0);
      gl.uniform1f(stage.uniform('uGain'), wall?.gain ?? 1);
      gl.uniform2f(stage.uniform('uRes'), at.width, at.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(stage.uniform('uTex'), 0);
      drawFullscreen(gl);
    },

    free() {
      if (stage) gl.deleteProgram(stage.program);
      for (const program of sources.values()) if (program) gl.deleteProgram(program.program);
    },
  };
}
