import { describe, expect, it } from 'vitest';
import type { LibraryRow, Look, Mine } from './api';
import { BOX, boxOf, DEFAULT_AXES, dotsOf, groupColour, M, nearest, step, stylesOf, trailPoints, tunedPath, tunedSays, W, H, withAxis, xOf, yOf, type Dot, type MapAxes } from './field';

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

describe('the box', () => {
  // Intensity across and hue up place exactly: 0 and 60 intensity are the ends, hue 180 the middle.
  const lib = [row('low', { look: look({ intensity: 0, hues: [0] }) }), row('high', { look: look({ intensity: 60, hues: [359.999999] }) }), row('mid', { look: look({ intensity: 15, hues: [180] }) })];
  const byKey = (dots: Dot[]) => Object.fromEntries(dots.map((d) => [d.row.key, d]));

  it('keeps the default 240 by 180, with or without a box', () => {
    expect(BOX).toEqual({ w: 240, h: 180 });
    expect([W, H]).toEqual([240, 180]);
    expect(xOf(0)).toBe(M);
    expect(xOf(1)).toBe(W - M);
    expect(yOf(0)).toBe(H - M);
    expect(yOf(1)).toBe(M);
    expect(dotsOf(lib, undefined, axes('intensity', 'hue'))).toEqual(dotsOf(lib, undefined, axes('intensity', 'hue'), BOX));
  });

  it.each([
    ['wide', boxOf(1200, 400)],
    ['tall', boxOf(300, 900)],
  ])('places the corners at the margins and the middle centred in a %s box', (_, box) => {
    const d = byKey(dotsOf(lib, undefined, axes('intensity', 'hue'), box));
    expect(d.low.x).toBeCloseTo(M);
    expect(d.low.y).toBeCloseTo(box.h - M);
    expect(d.high.x).toBeCloseTo(box.w - M);
    expect(d.high.y).toBeCloseTo(M, 3);
    expect(d.mid.y).toBeCloseTo(box.h / 2);
    expect(xOf(0.5, box)).toBeCloseTo(box.w / 2);
  });

  it('rounds a measured box and keeps room for the margins', () => {
    expect(boxOf(812.4, 433.6)).toEqual({ w: 812, h: 434 });
    expect(boxOf(3, 0)).toEqual({ w: 4 * M, h: 4 * M });
    expect(boxOf(NaN, Infinity)).toEqual(BOX);
  });

  it('marks a tuned dot in the box it is placed in', () => {
    const box = boxOf(1000, 300);
    const [d] = dotsOf([row('a')], { a: { tune: { speed: 4 } } }, DEFAULT_AXES, box);
    expect(d.tuned!.madeX).toBeCloseTo(xOf(0.5, box));
    expect(d.x).toBeGreaterThan(d.tuned!.madeX);
    expect(tunedPath([d])).toContain(`H${d.tuned!.madeX.toFixed(1)}`);
  });

  it('finds the nearest dot and steps among dots in a wide box', () => {
    const box = boxOf(1200, 300);
    // Speed across, brightness up: a at the left, b right of it, c above a.
    const wide = dotsOf(
      [row('a', { look: look({ speed: 0.5, brightness: 0.2 }) }), row('b', { look: look({ speed: 4, brightness: 0.25 }) }), row('c', { look: look({ speed: 0.6, brightness: 0.9 }) })],
      undefined,
      DEFAULT_AXES,
      box,
    );
    const [a, b, c] = wide;
    expect(b.x - a.x).toBeGreaterThan(W);
    expect(nearest(wide, b.x + 3, b.y - 3, 6)).toBe(1);
    expect(nearest(wide, (a.x + b.x) / 2, a.y, 6)).toBe(-1);
    expect(nearest(wide, c.x, c.y + 1, Infinity)).toBe(2);
    expect(step(wide, 0, 'right')).toBe(1);
    expect(step(wide, 0, 'up')).toBe(2);
    expect(step(wide, 1, 'left')).toBe(0);
    expect(step(wide, 0, 'down')).toBe(0);
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
