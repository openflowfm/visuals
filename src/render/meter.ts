/**
 * What a frame cost, and how often one arrived late.
 *
 * The renderer's whole performance question is one number: the frame the show
 * *misses*, not the frame it averages. A mean of 6ms with a 40ms spike every
 * eight bars looks excellent in a readout and looks broken on a wall, so
 * everything here is percentiles and a late count, and nothing here is a mean
 * you could hide behind. `docs/engine.md` is the argument this exists to settle.
 *
 * Three clocks, because they fail differently and the difference names the
 * culprit:
 *
 * - **interval** — wall time between presented frames. The one that matters. If
 *   this is clean the show is smooth, whatever the other two say.
 * - **cpu** — time inside `frame()`. Climbing here is our JavaScript: uniform
 *   writes, the number evaluator, a program cache missing.
 * - **gpu** — time the driver says it spent, when it will say. Climbing here is
 *   fill rate, which is the shader and the resolution and nothing else.
 *
 * Interval alone cannot tell a heavy shader from a stalled tab, and CPU alone
 * cannot see a shader at all. Together they point at one of the four costs in
 * `docs/engine.md` and say which.
 */

/** Frames kept for a reading. At 60Hz this is ten seconds. */
export const WINDOW = 600;

/**
 * How far past the median an interval goes before it counts as dropped.
 *
 * A ratio rather than a millisecond budget, because this rig runs at 60, 120 and
 * 144Hz depending on what it is plugged into and a fixed 16.7ms budget would
 * call every frame on a 144Hz projector early and every frame on a 30Hz capture
 * card late. Half a frame of slack past the median is the standard tolerance:
 * below it a frame is jitter, above it the display repeated one.
 */
export const LATE_RATIO = 1.5;

export interface Spread {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface FrameStats {
  /** Frames in the window. Percentiles below about 300 are not worth reading. */
  frames: number;
  /** Milliseconds between presented frames. */
  interval: Spread;
  /** Milliseconds spent inside `frame()`. */
  cpu: Spread;
  /** Milliseconds the GPU reported, or `null` where the driver will not say. */
  gpu: Spread | null;
  /** Frames whose interval ran past `LATE_RATIO` times the median. */
  late: number;
  /** Those as a share of the window, which is the number to quote. */
  lateShare: number;
  /** Frames per second implied by the median interval. */
  hz: number;
  /** JS heap in MB where the engine exposes it, for watching a leak. */
  heapMb: number | null;
}

const EMPTY: Spread = { p50: 0, p95: 0, p99: 0, max: 0 };

/**
 * The value at a rank, with no interpolation.
 *
 * Nearest-rank rather than a linear blend between neighbours: an interpolated
 * p99 is a number no frame actually took, and the question being asked here is
 * "how bad was the bad one", which wants a real observation.
 */
export function spreadOf(values: readonly number[]): Spread {
  if (!values.length) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

/** How many of `intervals` ran past `LATE_RATIO` times their own median. */
export function lateFrames(intervals: readonly number[]): number {
  if (intervals.length < 2) return 0;
  const limit = spreadOf(intervals).p50 * LATE_RATIO;
  let late = 0;
  for (const each of intervals) if (each > limit) late++;
  return late;
}

/** A fixed-size window that overwrites its oldest sample. */
class Ring {
  private readonly values: number[] = [];
  private next = 0;

  push(value: number): void {
    if (this.values.length < WINDOW) this.values.push(value);
    else {
      this.values[this.next] = value;
      this.next = (this.next + 1) % WINDOW;
    }
  }

  get length(): number {
    return this.values.length;
  }

  read(): readonly number[] {
    return this.values;
  }

  clear(): void {
    this.values.length = 0;
    this.next = 0;
  }
}

export interface Meter {
  /** Call at the top of a frame. */
  begin(now: number): void;
  /** Call once the frame's draw calls are issued. */
  end(now: number): void;
  /** The window as it stands. Sorts, so read it about once a second, not per frame. */
  read(): FrameStats;
  reset(): void;
  /** Whether the driver agreed to time the GPU. */
  readonly timingGpu: boolean;
  free(): void;
}

/**
 * A GPU timer, where one is allowed.
 *
 * `EXT_disjoint_timer_query_webgl2` is the only way to ask what the GPU actually
 * spent, and it is frequently absent — it leaks a high-resolution clock, so
 * browsers have withdrawn it before and may again. Absent is not an error here:
 * `gpu` reads `null`, the other two clocks still answer, and the readout says
 * which it is rather than quietly reporting zero.
 *
 * Results arrive several frames after the frame they describe, so queries are
 * pooled and harvested late. A **disjoint** result is discarded rather than
 * recorded: the GPU was preempted mid-measure and the number is meaningless,
 * and a meaningless number in a p99 is worse than a missing one.
 */
function createGpuTimer(gl: WebGL2RenderingContext, samples: Ring) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  if (!ext) return null;

  /** Four is enough to cover the driver's latency without ever waiting on one. */
  const POOL = 4;
  const idle: WebGLQuery[] = [];
  const flight: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;

  for (let i = 0; i < POOL; i++) {
    const query = gl.createQuery();
    if (query) idle.push(query);
  }

  const harvest = () => {
    // Oldest first, and stop at the first one not ready — they complete in
    // order, so a later one being ready while an earlier one is not cannot
    // happen, and scanning past it would only cost the walk.
    while (flight.length) {
      const query = flight[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      flight.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint) samples.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
      idle.push(query);
    }
  };

  return {
    begin(): void {
      harvest();
      // Only one TIME_ELAPSED query may be open at a time, so a frame with no
      // spare query simply goes unmeasured rather than throwing.
      const query = idle.pop();
      if (!query) return;
      active = query;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    end(): void {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      flight.push(active);
      active = null;
    },
    free(): void {
      for (const query of [...idle, ...flight]) gl.deleteQuery(query);
      idle.length = 0;
      flight.length = 0;
      active = null;
    },
  };
}

/** JS heap in MB, where the engine exposes it. Chromium does; the spec does not. */
function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
}

/**
 * `gl` is optional so the meter works on a canvas-less path — the tests, and any
 * caller that wants the two CPU clocks without a context to hand.
 */
export function createMeter(gl?: WebGL2RenderingContext | null): Meter {
  const intervals = new Ring();
  const cpu = new Ring();
  const gpu = new Ring();
  const timer = gl ? createGpuTimer(gl, gpu) : null;

  let last = 0;
  let started = 0;

  return {
    timingGpu: timer !== null,

    begin(now) {
      // The first frame has no interval — there is nothing before it — and a
      // gap after a tab was hidden is the browser's, not the renderer's. Both
      // would land in the window as an enormous outlier and both are excluded
      // by only recording a gap that is under a second.
      if (last && now - last < 1000) intervals.push(now - last);
      last = now;
      started = now;
      timer?.begin();
    },

    end(now) {
      cpu.push(now - started);
      timer?.end();
    },

    read() {
      const spans = intervals.read();
      const median = spreadOf(spans).p50;
      const late = lateFrames(spans);
      return {
        frames: spans.length,
        interval: spreadOf(spans),
        cpu: spreadOf(cpu.read()),
        gpu: timer && gpu.length ? spreadOf(gpu.read()) : null,
        late,
        lateShare: spans.length ? late / spans.length : 0,
        hz: median ? 1000 / median : 0,
        heapMb: heapMb(),
      };
    },

    reset() {
      intervals.clear();
      cpu.clear();
      gpu.clear();
      last = 0;
    },

    free() {
      timer?.free();
    },
  };
}
