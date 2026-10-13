import { beforeEach, describe, expect, it } from 'vitest';
import { noteTrail, resetTrail, sessionTrail, TRAIL_MAX, trailAfter } from './trail';

describe('trailAfter', () => {
  it('appends the preset played', () => {
    expect(trailAfter(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('skips null and a repeat of the last, but not an earlier one', () => {
    expect(trailAfter(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(trailAfter(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(trailAfter(['a', 'b'], 'a')).toEqual(['a', 'b', 'a']);
  });

  it('keeps only the newest `max`', () => {
    expect(trailAfter(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
    const long = Array.from({ length: TRAIL_MAX }, (_, i) => `p${i}`);
    const next = trailAfter(long, 'new');
    expect(next).toHaveLength(TRAIL_MAX);
    expect(next[0]).toBe('p1');
    expect(next[TRAIL_MAX - 1]).toBe('new');
  });

  it('never changes the trail it is given', () => {
    const was = ['a'];
    trailAfter(was, 'b');
    expect(was).toEqual(['a']);
  });
});

describe("the session's trail", () => {
  beforeEach(() => resetTrail());

  it('grows as presets play, oldest first, skipping a repeat', () => {
    for (const p of [null, 'a', 'a', 'b', null, 'c', 'b']) noteTrail(p);
    expect(sessionTrail()).toEqual(['a', 'b', 'c', 'b']);
  });

  it('starts over seeded, and goes on from the seed', () => {
    noteTrail('x');
    resetTrail(['a', 'b']);
    expect(sessionTrail()).toEqual(['a', 'b']);
    noteTrail('b');
    noteTrail('c');
    expect(sessionTrail()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the newest TRAIL_MAX', () => {
    for (let i = 0; i < TRAIL_MAX + 5; i++) noteTrail(`p${i}`);
    expect(sessionTrail()).toHaveLength(TRAIL_MAX);
    expect(sessionTrail()[0]).toBe('p5');
  });
});
