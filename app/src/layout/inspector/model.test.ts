import { describe as group, expect, it } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { asMade, characterOf, colourNames, fieldSays, listed, scaleOf, TUNE_STEPS, tuneAt, tuneOf, tunePosition } from './model.ts';

const look: Look = { hues: [278, 5], brightness: 0.1, speed: 0.5, intensity: 3, brightness_level: 'low', speed_level: 'low', intensity_level: 'low' };
const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: 'p/Hypnotic/x.milk',
  path: '/p/Hypnotic/x.milk',
  hash: '',
  style: 'Hypnotic',
  sub_style: null,
  authors: ['geiss', 'rovastar'],
  title: 'Spiral',
  thumbnail: null,
  look,
  starter: true,
  ...over,
});

group('the inspector model', () => {
  it("reads a preset's character in plain words", () => {
    const c = characterOf(prepareRow(row(), undefined));
    expect(c.name).toBe('Spiral');
    expect(c.by).toBe('geiss & rovastar');
    expect([c.speed.word, c.brightness.word, c.intensity.word]).toEqual(['slow', 'dark', 'calm']);
    expect(colourNames(c)).toEqual(['purple', 'red']);
  });

  it('says only what was measured, and leaves out "unknown" authors', () => {
    const c = characterOf(prepareRow(row({ look: null, authors: ['unknown'], style: 'Particles' }), undefined));
    expect(c.unmeasured).toBe(true);
    expect(c.by).toBe('');
    expect(fieldSays(c, 250)).toBe('Not drawn yet, among 250 presets');
  });

  it('is grey when drawn with no hue, and takes the user overrides', () => {
    expect(characterOf(prepareRow(row({ look: { ...look, hues: [] } }), undefined)).grey).toBe(true);
    const fast = characterOf(prepareRow(row(), { overrides: { speed: 'high' } }));
    expect(fast.speed.word).toBe('fast');
    expect(fast.speed.at).toBeCloseTo(5 / 6);
  });

  it('says where the subject sits in the field, or what the field is with none', () => {
    expect(fieldSays(characterOf(prepareRow(row(), undefined)), 9795)).toBe('Slow and dark, among 9,795 presets');
    expect(fieldSays(null, 250)).toBe('The library: 250 presets by speed and brightness');
  });

  it('places measures on 0–1 scales, the median near the middle', () => {
    expect(scaleOf.speed(2.9)).toBeGreaterThan(0.5);
    expect(scaleOf.speed(2.9)).toBeLessThan(0.7);
    expect(scaleOf.intensity(1000)).toBe(1);
    expect(scaleOf.brightness(-1)).toBe(0);
  });

  it('lists words as a sentence does', () => {
    expect(listed(['a'])).toBe('a');
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

group("a preset's tune", () => {
  it('is 1 for each the user keeps none of', () => {
    expect(tuneOf(undefined)).toEqual({ speed: 1, sensitivity: 1 });
    expect(tuneOf({ tune: { speed: 0.5 } })).toEqual({ speed: 0.5, sensitivity: 1 });
    expect(asMade(tuneOf({}))).toBe(true);
    expect(asMade(tuneOf({ tune: { sensitivity: 2 } }))).toBe(false);
  });

  it('has 1× in the middle of a log scale from ¼× to 4×, a doubling a step of twelve', () => {
    expect(TUNE_STEPS).toBe(49);
    expect(tunePosition(1)).toBe(0);
    expect(tunePosition(0.25)).toBe(-2);
    expect(tunePosition(4)).toBe(2);
    expect(tunePosition(16)).toBe(2);
    expect(tunePosition(0)).toBe(0);
    expect(tuneAt(-2)).toBe(0.25);
    expect(tuneAt(2)).toBe(4);
    expect(tuneAt(-1)).toBe(0.5);
    expect(tuneAt(9)).toBe(4);
  });

  it('snaps to exactly 1× near the middle, and keeps three decimals off it', () => {
    expect(tuneAt(0.03)).toBe(1);
    expect(tuneAt(-0.04)).toBe(1);
    expect(tuneAt(1 / 12)).toBe(1.059);
    expect(tuneAt(Number.NaN)).toBe(1);
    // What is kept reads back onto the same step.
    expect(tuneAt(tunePosition(tuneAt(5 / 12)))).toBe(tuneAt(5 / 12));
  });
});
