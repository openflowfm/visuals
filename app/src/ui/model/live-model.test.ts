import { describe, expect, it } from 'vitest';
import type * as api from './api';
import type * as output from './output';
import { intensityOf, keyOf, opensOnStart, ratingOf, sinceAfter, starred } from './live-model';

const row = (path: string, key: string) => ({ path, key }) as api.LibraryRow;
const display = (id: number) => ({ id, index: id - 1, name: `Display ${id}`, width: 1920, height: 1080, main: id === 1 }) satisfies output.Display;

describe('sinceAfter: when the playing preset started', () => {
  it('a preset that opened starts it again, the same one included', () => {
    expect(sinceAfter(100, { path: 'a.milk', error: null }, 500)).toBe(500);
  });

  it('an event that opened nothing, or failed to, leaves it', () => {
    expect(sinceAfter(100, { path: null, error: null }, 500)).toBe(100);
    expect(sinceAfter(100, { path: 'a.milk', error: 'bad shader' }, 500)).toBe(100);
  });
});

describe('opensOnStart: whether going live opens the output by itself', () => {
  const two = [display(1), display(2)];
  it('going live never does: it plays in the window', () => {
    expect(opensOnStart(undefined, two)).toBe(false);
    expect(opensOnStart(true, two)).toBe(false);
    expect(opensOnStart(true, null)).toBe(false);
  });

  it('a start in live mode does, with another display to take it', () => {
    expect(opensOnStart(false, two)).toBe(true);
  });

  it('not with one display, where it would cover the controls', () => {
    expect(opensOnStart(false, [display(1)])).toBe(false);
    expect(opensOnStart(false, [])).toBe(false);
  });

  it('unknown displays (the call failed) open it all the same', () => {
    expect(opensOnStart(false, null)).toBe(true);
  });
});

describe('keyOf: a preset’s library key', () => {
  const rows = [row('a.milk', 'ka'), row('b.milk', 'kb')];
  it('from its path', () => {
    expect(keyOf(rows, 'b.milk')).toBe('kb');
  });
  it('null when nothing plays or the library doesn’t list it', () => {
    expect(keyOf(rows, null)).toBeNull();
    expect(keyOf(rows, 'c.milk')).toBeNull();
    expect(keyOf([], 'a.milk')).toBeNull();
  });
});

describe('stars and ratings', () => {
  const data: api.LibraryData = { version: 1, presets: { ka: { star: true, rating: 4 }, kb: { tags: ['peak'] } } };
  it('starred: only a preset starred in the data', () => {
    expect(starred(data, 'ka')).toBe(true);
    expect(starred(data, 'kb')).toBe(false);
    expect(starred(data, 'kc')).toBe(false);
    expect(starred(data, null)).toBe(false);
    expect(starred(null, 'ka')).toBe(false);
  });
  it('ratingOf: 1–5, or null when unrated or unknown', () => {
    expect(ratingOf(data, 'ka')).toBe(4);
    expect(ratingOf(data, 'kb')).toBeNull();
    expect(ratingOf(data, 'kc')).toBeNull();
    expect(ratingOf(data, null)).toBeNull();
    expect(ratingOf(null, 'ka')).toBeNull();
  });
});

describe('intensityOf: the slider read back from the sensitivity', () => {
  it('½× at the bottom, 1× in the middle, 2× at the top, on a log taper', () => {
    expect(intensityOf(0.5)).toBe(0);
    expect(intensityOf(1)).toBe(0.5);
    expect(intensityOf(2)).toBe(1);
    expect(intensityOf(Math.SQRT2)).toBeCloseTo(0.75);
  });
  it('round-trips the sensitivity the slider sets (0.5 × 4^v)', () => {
    for (const v of [0, 0.1, 0.33, 0.5, 0.9, 1]) expect(intensityOf(0.5 * 4 ** v)).toBeCloseTo(v);
  });
  it('clamped outside ½×–2×, and the middle for nonsense', () => {
    expect(intensityOf(0.1)).toBe(0);
    expect(intensityOf(10)).toBe(1);
    expect(intensityOf(0)).toBe(0.5);
    expect(intensityOf(-1)).toBe(0.5);
    expect(intensityOf(Number.NaN)).toBe(0.5);
  });
});
