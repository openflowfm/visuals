import { describe, expect, it } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { BANDS, bandOf, bandPaths, dotOf, dotsOf, marksPath, nearest, step, timesOf, tunedAt, tunedPath, tunedSays, W, H, type Dot } from './field.ts';

const look = (over: Partial<Look> = {}): Look => ({ hues: [10], brightness: 0.5, speed: 2, intensity: 10, brightness_level: 'mid', speed_level: 'mid', intensity_level: 'mid', ...over });
const row = (key: string, l: Look | null): LibraryRow => ({
  key,
  path: `/${key}.milk`,
  hash: '',
  style: 'Hypnotic',
  sub_style: null,
  authors: [],
  title: key,
  thumbnail: null,
  look: l,
  starter: true,
});
/** A dot at (x, y) in the box's units. */
const at = (key: string, x: number, y: number): Dot => ({ row: row(key, look()), x, y, band: 0 });

describe("the inspector's field", () => {
  it('places every measured preset, and leaves out one not drawn yet', () => {
    const dots = dotsOf([row('a', look({ speed: 0, brightness: 0 })), row('b', null), row('c', look({ speed: 8, brightness: 1, hues: [] }))]);
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
    const rows = [row('a', look({ speed: 0, brightness: 0 })), row('n', look({ speed: null as unknown as number, speed_level: null as unknown as 'mid' }))];
    const dots = dotsOf(rows, { a: { overrides: { speed: 'high', brightness: 'high' } } });
    expect(dots.map((d) => d.row.key)).toEqual(['a']);
    // Fast and bright by the override's level (5/6 of the way), not slow and dark by the index's raw values.
    expect(dots[0].x).toBeGreaterThan((3 * W) / 4);
    expect(dots[0].y).toBeLessThan(H / 4);
  });

  it("places a preset at its speed as played: the measured speed times the user's own, on the axis's scale, clamped", () => {
    // Speed 8 is the right edge, 2 the middle (√(2/8) = 0.5), 0.5 a quarter of the way.
    const rows = [row('fast', look({ speed: 8 })), row('mid', look({ speed: 2 })), row('slow', look({ speed: 0.5 })), row('same', look({ speed: 2 }))];
    const dots = dotsOf(rows, { fast: { tune: { speed: 0.25 } }, mid: { tune: { speed: 4 } }, slow: { tune: { speed: 4 } }, same: { star: true } });
    const [fast, mid, slow, same] = dots;
    // A fast preset slowed to a quarter plays as a steady one: it sits with the middle, where it was made marked.
    expect(fast.x).toBeCloseTo(same.x, 5);
    expect(fast.tuned).toEqual({ speed: 0.25, madeX: W - 8 });
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
    const dots = dotsOf([row('a', look({ speed: 8 })), row('b', look({ speed: 2 }))], { a: { tune: { speed: 0.25 } } });
    const d = tunedPath(dots);
    // One ring (two arcs) and one line ending at the as-made place.
    expect(d.match(/a/g)?.length).toBe(2);
    expect(d).toContain(`H${(W - 8).toFixed(1)}`);
    expect(tunedPath(dotsOf([row('b', look({ speed: 2 }))]))).toBe('');
    expect(timesOf(0.5)).toBe('0.5×');
    expect(timesOf(1.333)).toBe('1.33×');
  });

  it('marks several picks as one path: a ring round each drawn one, once each', () => {
    const dots = dotsOf([row('a', look({ speed: 0 })), row('b', look({ speed: 8 })), row('c', look()), row('u', null)]);
    const d = marksPath(dots, ['b', 'a', 'u', 'a']);
    // Two rings (two arcs each): a and b; u has no dot, the second a no second ring.
    expect(d.match(/a/g)?.length).toBe(4);
    expect(d.match(/M/g)?.length).toBe(2);
    expect(d.startsWith(`M${(dots[0].x - 3.6).toFixed(1)} `)).toBe(true);
    expect(marksPath(dots, [])).toBe('');
    expect(marksPath(dots, ['u'])).toBe('');
  });

  it('draws 9,800 presets as at most one path per band', () => {
    const rows = Array.from({ length: 9800 }, (_, i) => row(`p${i}`, look({ hues: i % 7 ? [(i * 37) % 360] : [], speed: (i % 97) / 12, brightness: (i % 89) / 89 })));
    const paths = bandPaths(dotsOf(rows));
    expect(paths.length).toBeLessThanOrEqual(BANDS + 1);
    expect(paths.reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0)).toBe(9800);
  });

  it('finds the dot nearest the pointer, only within reach', () => {
    const dots = [at('a', 10, 10), at('b', 20, 10)];
    expect(nearest(dots, 12, 11, 6)).toBe(0);
    expect(nearest(dots, 17, 10, 6)).toBe(1);
    expect(nearest(dots, 100, 100, 6)).toBe(-1);
  });

  it("moves the keyboard's cursor to the nearest dot that way, along a row before across", () => {
    //   c
    // a b   d
    //     e
    const dots = [at('a', 10, 50), at('b', 20, 50), at('c', 20, 40), at('d', 40, 50), at('e', 30, 60)];
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
    const dots = [at('a', 10, 10), at('b', 10, 10), at('c', 10, 10), at('d', 30, 10)];
    expect(step(dots, 0, 'right')).toBe(1);
    expect(step(dots, 1, 'right')).toBe(2);
    expect(step(dots, 2, 'right')).toBe(3);
    expect(step(dots, 2, 'left')).toBe(1);
    expect(step(dots, 1, 'up')).toBe(0);
  });
});
