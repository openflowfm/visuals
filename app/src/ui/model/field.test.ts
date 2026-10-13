import { describe, expect, it } from 'vitest';
import type { LibraryRow, Look, Mine } from './api';
import {
  BANDS,
  bandOf,
  bandPaths,
  DEFAULT_AXES,
  dotOf,
  dotsOf,
  groupColour,
  M,
  nearest,
  step,
  stylesOf,
  timesOf,
  trailPoints,
  tunedAt,
  tunedPath,
  tunedSays,
  W,
  H,
  withAxis,
  xOf,
  yOf,
  type Dot,
  type MapAxes,
} from './field';

const look = (over: Partial<Look> = {}): Look => ({
  hues: [200],
  brightness: 0.5,
  speed: 2,
  intensity: 15,
  brightness_level: 'mid',
  speed_level: 'mid',
  intensity_level: 'mid',
  ...over,
});
const row = (key: string, over: Partial<LibraryRow> = {}): LibraryRow => ({
  key,
  path: `/p/${key}.milk`,
  hash: '',
  style: 'Dancer',
  sub_style: null,
  authors: ['geiss'],
  title: key,
  thumbnail: null,
  look: look(),
  starter: false,
  ...over,
});
const axes = (across: MapAxes['across'], up: MapAxes['up'], colour: MapAxes['colour'] = 'hue'): MapAxes => ({ across, up, colour });
/** A dot's place back as 0–1 across and up. */
const at = (d: Dot) => ({ x: (d.x - M) / (W - 2 * M), y: 1 - (d.y - M) / (H - 2 * M) });

describe('dotsOf on other axes', () => {
  it('places intensity across and hue up, leaving grey out on hue', () => {
    const lib = [row('a', { look: look({ intensity: 60, hues: [90, 10] }) }), row('b', { look: look({ intensity: 0, hues: [] }) }), row('c', { look: null })];
    const dots = dotsOf(lib, undefined, axes('intensity', 'hue'));
    expect(dots.map((d) => d.row.key)).toEqual(['a']);
    expect(at(dots[0]).x).toBeCloseTo(1);
    expect(at(dots[0]).y).toBeCloseTo(90 / 360);
  });

  it('reads an intensity override as its level', () => {
    const dots = dotsOf([row('a')], { a: { overrides: { intensity: 'high' } } }, axes('intensity', 'speed'));
    expect(at(dots[0]).x).toBeCloseTo(5 / 6);
  });

  it('places colourfulness and rating, honouring a hue override, unrated at the bottom', () => {
    const lib = [row('grey', { look: look({ hues: [] }) }), row('two', { look: look({ hues: [1, 2] }) }), row('many', { look: look({ hues: [1, 2, 3, 4, 5, 6] }) })];
    const mine: Record<string, Mine> = { grey: { overrides: { hues: [5] }, rating: 5 }, two: { rating: 3 } };
    const dots = dotsOf(lib, mine, axes('colourfulness', 'rating'));
    const by = Object.fromEntries(dots.map((d) => [d.row.key, at(d)]));
    expect(by.grey.x).toBeCloseTo(0.25);
    expect(by.two.x).toBeCloseTo(0.5);
    expect(by.many.x).toBeCloseTo(1);
    expect(Math.abs(by.grey.y - 1)).toBeLessThanOrEqual(0.06 + 1e-9);
    expect(Math.abs(by.two.y - 0.6)).toBeLessThanOrEqual(0.06 + 1e-9);
    expect(by.many.y).toBeGreaterThanOrEqual(0);
    expect(by.many.y).toBeLessThanOrEqual(0.06 + 1e-9);
  });

  it('puts every dot of a style in its lane, jittered the same way each time', () => {
    const styles = ['Waves', 'Dancer', 'Geometric'];
    const lib = Array.from({ length: 60 }, (_, i) => row(`k${i}`, { style: styles[i % 3] }));
    expect(stylesOf(lib)).toEqual(['Dancer', 'Geometric', 'Waves']);
    const a = dotsOf(lib, undefined, axes('style', 'speed'));
    const b = dotsOf(lib, undefined, axes('style', 'speed'));
    expect(a.map((d) => d.x)).toEqual(b.map((d) => d.x));
    const lanes = stylesOf(lib);
    for (const d of a) {
      const i = lanes.indexOf(d.row.style);
      const x = at(d).x;
      expect(x).toBeGreaterThan(i / 3);
      expect(x).toBeLessThan((i + 1) / 3);
      expect(Math.abs(x - (i + 0.5) / 3)).toBeLessThanOrEqual(0.35 / 3 + 1e-9);
    }
    // The jitter spreads them: not all on the lane's middle.
    expect(new Set(a.map((d) => d.x)).size).toBeGreaterThan(30);
  });

  it('takes a style override into its lane', () => {
    const lib = [row('a', { style: 'Dancer' }), row('b', { style: 'Waves' })];
    const dots = dotsOf(lib, { a: { overrides: { style: 'Waves' } } }, axes('style', 'speed'));
    expect(at(dots[0]).x).toBeGreaterThan(0.5);
  });
});

describe('colour groups', () => {
  it('groups by style, spread round the hue circle', () => {
    const lib = [row('a', { style: 'B' }), row('b', { style: 'A' }), row('c', { style: 'C' })];
    const dots = dotsOf(lib, undefined, axes('speed', 'brightness', 'style'));
    expect(dots.map((d) => d.band)).toEqual([1, 0, 2]);
    const styles = stylesOf(lib);
    expect(new Set([0, 1, 2].map((g) => groupColour('style', g, styles))).size).toBe(3);
  });

  it('groups by rating: unrated grey, 1–5 an amber ramp', () => {
    const lib = [row('a'), row('b'), row('c')];
    const dots = dotsOf(lib, { b: { rating: 2 }, c: { rating: 5 } }, axes('speed', 'brightness', 'rating'));
    expect(dots.map((d) => d.band)).toEqual([0, 2, 5]);
    expect(groupColour('rating', 0, [])).toBe('var(--caption)');
    expect(groupColour('rating', 1, [])).not.toBe(groupColour('rating', 5, []));
  });
});

describe('tuned speed', () => {
  const mine: Record<string, Mine> = { a: { tune: { speed: 4 } } };
  it('moves the dot up when up shows speed', () => {
    const [d] = dotsOf([row('a')], mine, axes('brightness', 'speed'));
    expect(d.tuned).toBeDefined();
    expect(d.x).toBe(d.tuned!.madeX);
    expect(d.y).toBeLessThan(d.tuned!.madeY);
    expect(tunedSays(d)).toMatch(/faster than measured/);
  });
  it('moves it across as before by default', () => {
    const [d] = dotsOf([row('a')], mine);
    expect(d.x).toBeGreaterThan(d.tuned!.madeX);
    expect(d.y).toBe(d.tuned!.madeY);
  });
  it('marks nothing when neither axis shows speed', () => {
    const [d] = dotsOf([row('a')], mine, axes('brightness', 'intensity'));
    expect(d.tuned).toBeUndefined();
  });
});

describe('moving on other axes', () => {
  // Intensity across, hue up: a at the left low, b right of it, c above it.
  const lib = [row('a', { look: look({ intensity: 2, hues: [30] }) }), row('b', { look: look({ intensity: 40, hues: [36] }) }), row('c', { look: look({ intensity: 3, hues: [250] }) })];
  const dots = dotsOf(lib, undefined, axes('intensity', 'hue'));
  it('steps right to b and up to c', () => {
    expect(dots[step(dots, 0, 'right')].row.key).toBe('b');
    expect(dots[step(dots, 0, 'up')].row.key).toBe('c');
    expect(step(dots, 0, 'left')).toBe(0);
  });
  it('finds the nearest dot to a point', () => {
    expect(nearest(dots, xOf(0), yOf(250 / 360), Infinity)).toBe(2);
  });
});

describe('withAxis', () => {
  it('sets an axis, and swaps when the other shows it', () => {
    expect(withAxis(DEFAULT_AXES, 'across', 'hue')).toEqual({ across: 'hue', up: 'brightness', colour: 'hue' });
    expect(withAxis(DEFAULT_AXES, 'across', 'brightness')).toEqual({ across: 'brightness', up: 'speed', colour: 'hue' });
    expect(withAxis(DEFAULT_AXES, 'up', 'speed')).toEqual({ across: 'brightness', up: 'speed', colour: 'hue' });
  });
});

describe('trailPoints', () => {
  const dots = dotsOf([row('a', { look: look({ speed: 0 }) }), row('b', { look: look({ speed: 8 }) }), row('c', { look: null })]);
  const pa = dots[0];
  const pb = dots[1];
  it('runs through the presets played in order, skipping repeats and ones not in the field', () => {
    const pts = trailPoints(dots, ['/p/a.milk', '/p/a.milk', '/p/c.milk', '/p/x.milk', '/p/b.milk', '/p/c.milk', '/p/a.milk']);
    expect(pts).toEqual([
      { x: pa.x, y: pa.y },
      { x: pb.x, y: pb.y },
      { x: pa.x, y: pa.y },
    ]);
  });
  it('is empty with nothing played', () => {
    expect(trailPoints(dots, [])).toEqual([]);
  });
});

// The field on its default axes (speed across, brightness up, coloured by hue band), from the
// old copy's tests (`app/src/layout/inspector/field.test.ts`).
describe('the default field', () => {
  const lk = (over: Partial<Look> = {}): Look => look({ hues: [10], ...over });
  const r = (key: string, l: Look | null) => row(key, { look: l });
  /** A dot at (x, y) in the box's units. */
  const dotAt = (key: string, x: number, y: number): Dot => ({ row: r(key, lk()), x, y, band: 0 });

  it('places every measured preset, and leaves out one not drawn yet', () => {
    const dots = dotsOf([r('a', lk({ speed: 0, brightness: 0 })), r('b', null), r('c', lk({ speed: 8, brightness: 1, hues: [] }))]);
    expect(dots.map((d) => d.row.key)).toEqual(['a', 'c']);
    // Slow and dark at the bottom left, fast and bright at the top right, inside the margin.
    expect(dots[0].x).toBeLessThan(W / 4);
    expect(dots[0].y).toBeGreaterThan((3 * H) / 4);
    expect(dots[1].x).toBeGreaterThan((3 * W) / 4);
    expect(dots[1].y).toBeLessThan(H / 4);
    expect(dots[1].band).toBe(BANDS);
    expect(dotOf(dots, 'c')).toBe(1);
    expect(dotOf(dots, 'b')).toBe(-1);
  });

  it('cuts the hue circle into bands, wrapping round', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(359)).toBe(BANDS - 1);
    expect(bandOf(360)).toBe(0);
    expect(bandOf(-10)).toBe(BANDS - 1);
    expect(bandOf(undefined)).toBe(BANDS);
  });

  it("places a dot where the user's overrides put it, and leaves out one with no speed or brightness", () => {
    const rows = [r('a', lk({ speed: 0, brightness: 0 })), r('n', lk({ speed: null as unknown as number, speed_level: null as unknown as 'mid' }))];
    const dots = dotsOf(rows, { a: { overrides: { speed: 'high', brightness: 'high' } } });
    expect(dots.map((d) => d.row.key)).toEqual(['a']);
    // Fast and bright by the override's level (5/6 of the way), not slow and dark by the index's raw values.
    expect(dots[0].x).toBeGreaterThan((3 * W) / 4);
    expect(dots[0].y).toBeLessThan(H / 4);
  });

  it("places a preset at its speed as played: the measured speed times the user's own, on the axis's scale, clamped", () => {
    // Speed 8 is the right edge, 2 the middle (√(2/8) = 0.5), 0.5 a quarter of the way.
    const rows = [r('fast', lk({ speed: 8 })), r('mid', lk({ speed: 2 })), r('slow', lk({ speed: 0.5 })), r('same', lk({ speed: 2 }))];
    const dots = dotsOf(rows, { fast: { tune: { speed: 0.25 } }, mid: { tune: { speed: 4 } }, slow: { tune: { speed: 4 } }, same: { star: true } });
    const [fast, mid, slow, same] = dots;
    // A fast preset slowed to a quarter plays as a steady one: it sits with the middle, where it was made marked.
    expect(fast.x).toBeCloseTo(same.x, 5);
    expect(fast.tuned).toMatchObject({ speed: 0.25, madeX: W - 8 });
    expect(tunedSays(fast)).toBe('Played at 0.25× speed, so it sits slower than measured');
    // Sped up 4 times it would run past the edge: clamped.
    expect(mid.x).toBeCloseTo(W - 8, 5);
    expect(slow.x).toBeCloseTo(same.x, 5);
    expect(tunedSays(slow)).toContain('faster than measured');
    expect(same.tuned).toBeUndefined();
    expect(tunedSays(same)).toBe('');
    expect(tunedAt(0.5, 1)).toBe(0.5);
    expect(tunedAt(0.5, undefined)).toBe(0.5);
    expect(tunedAt(0.9, 4)).toBe(1);
    expect(tunedAt(0.5, 0.25)).toBeCloseTo(0.25, 5);
  });

  it('marks only the tuned presets, with a line back to where each was made', () => {
    const dots = dotsOf([r('a', lk({ speed: 8 })), r('b', lk({ speed: 2 }))], { a: { tune: { speed: 0.25 } } });
    const d = tunedPath(dots);
    // One ring (two arcs) and one line ending at the as-made place.
    expect(d.match(/a/g)?.length).toBe(2);
    expect(d).toContain(`H${(W - 8).toFixed(1)}`);
    expect(tunedPath(dotsOf([r('b', lk({ speed: 2 }))]))).toBe('');
    expect(timesOf(0.5)).toBe('0.5×');
    expect(timesOf(1.333)).toBe('1.33×');
  });

  it('draws 9,800 presets as at most one path per band', () => {
    const rows = Array.from({ length: 9800 }, (_, i) => r(`p${i}`, lk({ hues: i % 7 ? [(i * 37) % 360] : [], speed: (i % 97) / 12, brightness: (i % 89) / 89 })));
    const paths = bandPaths(dotsOf(rows));
    expect(paths.length).toBeLessThanOrEqual(BANDS + 1);
    expect(paths.reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0)).toBe(9800);
  });

  it('finds the dot nearest the pointer, only within reach', () => {
    const dots = [dotAt('a', 10, 10), dotAt('b', 20, 10)];
    expect(nearest(dots, 12, 11, 6)).toBe(0);
    expect(nearest(dots, 17, 10, 6)).toBe(1);
    expect(nearest(dots, 100, 100, 6)).toBe(-1);
  });

  it("moves the keyboard's cursor to the nearest dot that way, along a row before across", () => {
    //   c
    // a b   d
    //     e
    const dots = [dotAt('a', 10, 50), dotAt('b', 20, 50), dotAt('c', 20, 40), dotAt('d', 40, 50), dotAt('e', 30, 60)];
    expect(step(dots, 0, 'right')).toBe(1);
    expect(step(dots, 1, 'up')).toBe(2);
    // d is 20 along the row; e only 10 along but 10 aside, which counts double.
    expect(step(dots, 1, 'right')).toBe(3);
    expect(step(dots, 1, 'down')).toBe(4);
    expect(step(dots, 3, 'left')).toBe(1);
    // Nothing that way: it stays.
    expect(step(dots, 3, 'right')).toBe(3);
    expect(step(dots, 2, 'up')).toBe(2);
  });

  it('takes dots on the same spot in order, so each is reachable', () => {
    const dots = [dotAt('a', 10, 10), dotAt('b', 10, 10), dotAt('c', 10, 10), dotAt('d', 30, 10)];
    expect(step(dots, 0, 'right')).toBe(1);
    expect(step(dots, 1, 'right')).toBe(2);
    expect(step(dots, 2, 'right')).toBe(3);
    expect(step(dots, 2, 'left')).toBe(1);
    expect(step(dots, 1, 'up')).toBe(0);
  });
});
