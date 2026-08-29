/**
 * How fast this machine can draw each flow, with nothing pacing it.
 *
 * `npm run benchmark` — the page half. `tools/benchmark.ts` is the half that
 * opens a window on it and prints the table.
 *
 * **This deliberately does not use `requestAnimationFrame`.** rAF is capped at
 * the display's refresh, so a rig comfortably capable of 300fps and one barely
 * holding 60 both report 60 through it, which is the one answer a ceiling
 * measurement must not give. The loop here runs free and forces the GPU to
 * finish, so what it reports is the ceiling rather than the cap.
 *
 * **A fixed window of music, and the frames that fit in it.** Eight bars at the
 * show's own tempo, drawn as fast as the machine will draw them, and the score
 * is the count.
 *
 * The obvious inverse — a fixed frame count, timed — is what this was first, and
 * it is subtly the wrong question. Frames land every half-millisecond there, so
 * the musical clock has to be advanced *per frame* to keep moving, which runs
 * the show at about thirty times speed. Everything the renderer does against
 * real elapsed time is then wrong in the same direction: a video decoder
 * delivers four frames where a show would see four hundred and its per-frame
 * upload cost vanishes; an envelope follower sees a bar go by in a few
 * milliseconds. The picture being priced stops being a picture anyone will see.
 *
 * Here the clock comes off the wall instead. Musical time advances at the rate
 * it advances on a stage, every decoder and follower runs at the rate it will
 * run on the night, and the only thing free to vary is how many frames get
 * drawn — which is exactly the thing being measured.
 *
 * **Two hard constraints shape how it is timed.** `performance.now()` is clamped
 * to 100µs in a page that is not cross-origin isolated, so no single frame can
 * be timed at all on this class of GPU — measuring against a window sidesteps
 * that completely. And there is no working per-frame GPU barrier in a browser:
 * `gl.finish()` returns when Chromium's command buffer has drained rather than
 * when the GPU is done, and a one-pixel `readPixels` is real but stalls the
 * pipeline it is timing. So frames are issued in chunks, each chunk closed with
 * one `readPixels`, which keeps the CPU/GPU overlap a real frame has and bounds
 * how many frames can be counted but not yet drawn to one chunk's worth.
 *
 * The context is fetched from the canvas rather than handed over by the
 * compositor: `getContext` returns the same object for the same canvas, so the
 * bench forces its barrier without the renderer growing a method that exists
 * only for this file.
 */

import scheme from './scheme.json' with { type: 'json' };
import type { Scheme, Show, Track } from './protocol.ts';
import { createCompositor } from './src/render/compositor.ts';
import { compileFlow } from './src/render/circuit.ts';

export interface FlowResult {
  id: string;
  name: string;
  /** The compiler's own prediction, against a ceiling of 64. */
  work: number;
  /** Frames drawn inside the window. The score. */
  frames: number;
  /** How long the window actually ran, which overshoots by at most one chunk. */
  windowMs: number;
  /** The window over the count. */
  msPerFrame: number;
  /** Frames a second, sustained across the whole window. */
  fps: number;
  error: string | null;
}

export interface Pass {
  width: number;
  height: number;
  tracks: number;
  /** Bars of music each flow was drawn for, at `tempo`. */
  bars: number;
  tempo: number;
  flows: FlowResult[];
}

export interface BenchReport {
  renderer: string;
  passes: Pass[];
}

/**
 * Long edge of each pass, from the query string.
 *
 * 1920 alone by default, because that is the show and a sweep of four is minutes
 * rather than seconds — a benchmark long enough to make coffee for is one that
 * gets run once. The sweep is what answers "where does this stop being free",
 * so it is one flag away rather than gone: `npm run benchmark -- --sweep`.
 */
const EDGES = (new URLSearchParams(location.search).get('edges') ?? '1920')
  .split(',')
  .map((each) => Number(each.trim()))
  .filter((each) => Number.isFinite(each) && each > 0);

/** Playing tracks in the set pass. Eight is the realistic ceiling for a set. */
const TRACKS = 8;

/** Height of the readout strip along the bottom, which the picture must clear. */
const READOUT = 34;

const asked = new URLSearchParams(location.search);
const number = (name: string, fallback: number): number => {
  const found = Number(asked.get(name));
  return Number.isFinite(found) && found > 0 ? found : fallback;
};

/**
 * Frames thrown away before timing starts.
 *
 * The first frame of any flow compiles a shader, which is milliseconds of
 * driver work charged to a frame that will never pay it again, and the few
 * after it are the driver settling into the pipeline. Timing those would report
 * the compile as the flow's cost, and would do it worst for the flows with the
 * most in them.
 */
const WARMUP = number('warmup', 30);

/**
 * Bars of music each flow is drawn for.
 *
 * Eight is a phrase, which is the unit this rig thinks in and long enough that
 * a flow moving on a four-bar cycle is seen twice. It is also fifteen seconds a
 * flow at 128bpm, so a whole scheme is minutes rather than seconds — `--bars=2`
 * gives the same ranking in a quarter of the time when the ranking is all you
 * are after.
 */
const BARS = number('bars', 8);

/** The tempo the window is measured in, and the one the show is fed. */
const TEMPO = 128;

/**
 * How long to draw before yielding to the browser, in milliseconds.
 *
 * The loop has to come up for air: fifteen seconds of unbroken JavaScript is a
 * page the browser calls unresponsive and a window the runner cannot ask
 * anything of. Yielding also lets the frame actually reach the screen, which is
 * what makes the run watchable. Its cost is charged against the window rather
 * than excused from it — a real frame loop yields too.
 */
const CHUNK_MS = 16;

/** Flows to run, for a probe rather than a reading. All of them by default. */
const LIMIT = number('flows', Number.POSITIVE_INFINITY);

function trackAt(t: number): Track {
  return {
    t,
    name: `bench ${t}`,
    color: [0xff5252, 0x52ff9d, 0x527dff, 0xfff152][t % 4],
    // Deliberately not 1: opacity below 0.002 is skipped entirely, and a
    // benchmark that let a track fall out of the pass would be timing a
    // cheaper frame than the one it claims to be timing.
    opacity: 0.6 + 0.4 * ((t % 3) / 2),
    level: 0.35 + 0.5 * ((t % 5) / 4),
    playing: t % 7,
    clipName: `clip ${t}`,
  };
}

function showWith(tracks: number, colors: number[]): Show {
  return {
    connected: true,
    lomReady: true,
    playing: true,
    peers: 1,
    clock: true,
    tempo: TEMPO,
    quantum: 4,
    beat: 0,
    at: Date.now(),
    // The room's energy, which an unwired energy inlet falls back to. Held off
    // the rails so nothing is measured at a boundary it would never sit at.
    master: 0.62,
    tracks: Array.from({ length: tracks }, (_, t) => trackAt(t)),
    groups: [],
    flow: null,
    pinned: false,
    colorway: null,
    colors: colors.length ? colors : [0xffffff],
    song: null,
    key: 0.25,
    role: null,
    one: 0,
    schemeError: null,
    roles: [],
    songs: [],
  };
}

/**
 * Give the browser one turn.
 *
 * A `MessageChannel` rather than `setTimeout(0)`: a nested timeout is clamped to
 * four milliseconds, which against a sixteen-millisecond chunk would spend a
 * fifth of the window waiting rather than drawing. This yields in microseconds.
 */
function breathe(): Promise<void> {
  return new Promise((wake) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => wake();
    channel.port2.postMessage(0);
  });
}

function packColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16) || 0xffffff;
}

export async function run(canvas: HTMLCanvasElement): Promise<BenchReport> {
  const loaded = scheme as unknown as Scheme;
  const ids = Object.keys(loaded.flows).slice(0, LIMIT);
  const colors = (Object.values(loaded.colorways)[0] ?? ['#ffffff']).map(packColor);
  const passes: Pass[] = [];
  let renderer = 'unknown';

  // Read before the loop touches the query string: `EDGES` came from there, and
  // the first `replaceState` below overwrites the parameter it was read from.
  const edges = [...EDGES];

  for (const edge of edges) {
    // `MAX_EDGE` is read from the query string when a compositor is built, so
    // the pass sets it before building one.
    history.replaceState(null, '', `?maxEdge=${edge}`);

    // **Sized to land on the target exactly, not to overshoot it.**
    //
    // `resize()` takes `clientWidth * devicePixelRatio` and only scales down if
    // that overshoots `maxEdge`, so the arithmetic is run here instead: a CSS
    // box of `edge / ratio` gives a drawing buffer of exactly `edge` with the
    // cap never engaging. Overshooting and letting the cap correct it was the
    // obvious version and cost a factor of thirty — a 3840-CSS-pixel element is
    // composited at 3840 CSS pixels however small its drawing buffer is, and
    // that upscale, not the shader, was what the first runs were measuring.
    //
    // The transform then fits that box to the window without touching
    // `clientWidth`, which is what the size above was derived from.
    //
    // **Both axes, and no clamp at 1.** Fitting width alone leaves a 16:9 box
    // taller than the window cropped at the bottom; clamping at 1 means the box
    // is never scaled *up*, so 1920 on a two-times display is a 960-pixel box
    // sitting in a 1200-pixel window looking like a preview of a preview. The
    // box is smaller than the window as often as it is larger, and only fitting
    // both directions in both directions actually fills it.
    //
    // Showing it costs nothing worth having: compositing is charged on the
    // destination, which is the window either way, and it happens at the
    // display's rate rather than at the rate this issues frames.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = { width: edge / ratio, height: Math.round((edge * 9) / 16 / ratio) };
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    canvas.style.transformOrigin = '0 0';
    const fit = Math.min(
      window.innerWidth / box.width,
      // The readout sits along the bottom, so the picture does not get that strip.
      (window.innerHeight - READOUT) / box.height,
    );
    canvas.style.transform = `scale(${fit})`;

    const compositor = createCompositor(canvas);
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 is not available');

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));

    const show = showWith(TRACKS, colors);
    /** The one pixel the barrier reads back into. Allocated once, never read. */
    const sync = new Uint8Array(4);
    const flows: FlowResult[] = [];

    const windowMs = (BARS * 4 * 60_000) / TEMPO;

    for (const id of ids) {
      const compiled = compileFlow(loaded.flows, id);
      const at: Show = { ...show, flow: id };

      /** Block until the GPU has finished everything issued so far. */
      const settle = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
      };

      // Warmed on a still clock, because the only thing this has to buy is the
      // shader compile and the driver settling — neither cares what beat it is.
      for (let i = 0; i < WARMUP; i++) compositor.frame(at, loaded, 0, 0, 1 / 60);
      settle();

      const started = performance.now();
      let last = started;
      let elapsed = 0;
      let frames = 0;

      while (elapsed < windowMs) {
        const until = Math.min(windowMs, elapsed + CHUNK_MS);
        do {
          const now = performance.now();
          elapsed = now - started;
          // **Musical time off the wall clock, not off a frame counter.** This
          // is the whole point: the beat advances at the rate a stage advances
          // it, however many frames the machine manages in between.
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          compositor.frame(at, loaded, (elapsed / 60_000) * TEMPO, elapsed / 1000, dt);
          frames++;
        } while (elapsed < until);

        // One barrier a chunk. Per frame would stall the pipeline being measured;
        // once at the end would let an unknown number of frames be counted and
        // never drawn. A chunk bounds that error to sixteen milliseconds of it.
        settle();
        elapsed = performance.now() - started;
        await breathe();
        elapsed = performance.now() - started;
      }

      settle();
      const spent = performance.now() - started;
      const ms = spent / frames;
      // Published as it goes. A run this long with no output cannot be told
      // from a run that has hung, and the difference matters at minute four.
      const said =
        `${canvas.width}x${canvas.height}  ${flows.length + 1}/${ids.length}  ` +
        `${loaded.flows[id]?.name ?? id}  ${frames} frames in ${BARS} bars  ` +
        `${((frames * 1000) / spent).toFixed(0)}fps`;
      (window as unknown as { __benchProgress?: string }).__benchProgress = said;
      // The drawing buffer's real size, on the page, beside the picture it
      // describes. The canvas is displayed smaller than it is drawn, and that
      // is exactly the kind of thing a number should settle rather than a
      // reader having to trust the transform above.
      const out = document.getElementById('out');
      if (out) out.textContent = said;
      flows.push({
        id,
        name: loaded.flows[id]?.name ?? id,
        work: compiled.work,
        msPerFrame: ms,
        // From the window rather than from `ms`, so it is literally frames
        // divided by the seconds they were drawn in.
        fps: spent > 0 ? (frames * 1000) / spent : 0,
        frames,
        windowMs: spent,
        error: compositor.error ?? compiled.error,
      });

      // The event loop, so a four-resolution run over 27 flows is a window that
      // is merely busy rather than one the compositor kills as unresponsive.
      await new Promise((wake) => setTimeout(wake, 0));
    }

    passes.push({
      width: canvas.width,
      height: canvas.height,
      tracks: TRACKS,
      bars: BARS,
      tempo: TEMPO,
      flows,
    });
    compositor.free();
  }

  return { renderer, passes };
}
