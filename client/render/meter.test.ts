import { describe, expect, it } from 'vitest';
import { createMeter, lateFrames, spreadOf, LATE_RATIO, WINDOW } from './meter.ts';

describe('the spread of a window of frames', () => {
  it('reports a rank rather than an interpolation between neighbours', () => {
    const values = Array.from({ length: 100 }, (_, at) => at + 1);

    // Every one of these is a value some frame actually took.
    expect(spreadOf(values)).toEqual({ p50: 50, p95: 95, p99: 99, max: 100 });
  });

  it('does not let one spike move the median it is measured against', () => {
    const values = [...Array.from({ length: 99 }, () => 16), 400];

    const spread = spreadOf(values);
    expect(spread.p50).toBe(16);
    expect(spread.max).toBe(400);
  });

  it('answers zeroes for an empty window rather than dividing by nothing', () => {
    expect(spreadOf([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe('counting the frames that arrived late', () => {
  it('counts a frame late once it passes the ratio, and not before', () => {
    const median = 16;
    const values = [
      ...Array.from({ length: 20 }, () => median),
      median * LATE_RATIO - 0.01,
      median * LATE_RATIO + 0.01,
    ];

    expect(lateFrames(values)).toBe(1);
  });

  it('measures against the window rather than an assumed refresh rate', () => {
    // A 144Hz projector. A fixed 16.7ms budget would call all of these late.
    const fast = Array.from({ length: 200 }, () => 6.94);

    expect(lateFrames(fast)).toBe(0);
  });

  it('finds the dropped frames in an otherwise clean 120Hz window', () => {
    const values = Array.from({ length: 200 }, (_, at) => (at % 50 === 0 ? 25 : 8.33));

    expect(lateFrames(values)).toBe(4);
  });
});

describe('the meter over a run of frames', () => {
  const run = (gaps: readonly number[], cost: (at: number) => number) => {
    const meter = createMeter();
    let now = 1000;
    gaps.forEach((gap, at) => {
      now += gap;
      meter.begin(now);
      meter.end(now + cost(at));
    });
    return meter.read();
  };

  it('separates time between frames from time spent inside one', () => {
    const stats = run(Array.from({ length: 100 }, () => 16.67), () => 4);

    expect(stats.interval.p50).toBeCloseTo(16.67, 1);
    expect(stats.cpu.p50).toBe(4);
    expect(stats.hz).toBeCloseTo(60, 0);
  });

  it('reports a late share rather than only a count', () => {
    // Every tenth frame, offset so none of them is the first — which has no
    // frame before it and therefore contributes no interval.
    const stats = run(
      Array.from({ length: 101 }, (_, at) => (at % 10 === 5 ? 50 : 16.67)),
      () => 4,
    );

    expect(stats.frames).toBe(100);
    expect(stats.late).toBe(10);
    expect(stats.lateShare).toBeCloseTo(0.1, 3);
  });

  it('records no interval for the first frame, having nothing to measure from', () => {
    const stats = run([16.67], () => 4);

    expect(stats.frames).toBe(0);
    expect(stats.cpu.p50).toBe(4);
  });

  it('excludes the gap left by a hidden window, which is not a dropped frame', () => {
    const stats = run([16.67, 16.67, 30_000, 16.67, 16.67], () => 4);

    // Four gaps, one of them thrown away, and the survivors unpolluted.
    expect(stats.frames).toBe(3);
    expect(stats.interval.max).toBeCloseTo(16.67, 1);
  });

  it('keeps a fixed window, so a long show does not grow without bound', () => {
    const stats = run(Array.from({ length: WINDOW * 3 }, () => 16.67), () => 4);

    expect(stats.frames).toBe(WINDOW);
  });

  it('holds the newest frames once the window has turned over', () => {
    // Slow for the first window, fast for the second: only the fast should survive.
    const gaps = [
      ...Array.from({ length: WINDOW }, () => 33.3),
      ...Array.from({ length: WINDOW }, () => 8.33),
    ];
    const stats = run(gaps, () => 4);

    expect(stats.frames).toBe(WINDOW);
    expect(stats.interval.p50).toBeCloseTo(8.33, 1);
    expect(stats.hz).toBeCloseTo(120, 0);
  });

  it('says the GPU was not timed rather than reporting it as zero', () => {
    const stats = run(Array.from({ length: 10 }, () => 16.67), () => 4);

    expect(stats.gpu).toBeNull();
  });

  it('starts over on reset', () => {
    const meter = createMeter();
    let now = 1000;
    for (let at = 0; at < 50; at++) {
      now += 16.67;
      meter.begin(now);
      meter.end(now + 4);
    }
    meter.reset();

    expect(meter.read().frames).toBe(0);
  });
});
