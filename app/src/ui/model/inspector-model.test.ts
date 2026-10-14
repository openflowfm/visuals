import { describe as group, expect, it } from 'vitest';
import type { LibraryRow, Look } from './api';
import {
  asMade,
  characterOf,
  colourNames,
  detentSays,
  fieldSays,
  listed,
  scaleOf,
  TUNE_DETENTS,
  TUNE_STEPS,
  tuneAt,
  tuneNudged,
  tuneOf,
  tunePosition,
  tuneSays,
  tuneShared,
  tuneStepped,
  tuneTyped,
} from './inspector-model';
import { prepareRow } from './librarySearch';

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

  it('says the words of the axes chosen, and "On the map" when the preset has none on them', () => {
    const c = characterOf(prepareRow(row(), undefined));
    expect(fieldSays(c, 250, 250, ['hue', 'style'])).toBe('Purple and Hypnotic, among 250 presets');
    expect(fieldSays(c, 250, 250, ['rating', 'colourfulness'])).toBe('On the map, among 250 presets');
    expect(fieldSays(null, 250, 250, ['hue', 'rating'])).toBe('The library: 250 presets by hue and my rating');
  });

  it('never counts only the presets measured as the library: 250 drawn of 9,791 installed says no count', () => {
    const c = characterOf(prepareRow(row(), undefined));
    expect(fieldSays(c, 9791, 9791)).toBe('Slow and dark, among 9,791 presets');
    expect(fieldSays(c, 250, 9791)).toBe('Slow and dark');
    expect(fieldSays(characterOf(prepareRow(row({ look: null }), undefined)), 250, 9791)).toBe('Not drawn yet');
    expect(fieldSays(null, 250, 9791)).toBe('The library by speed and brightness: 250 of its 9,791 presets drawn so far');
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

  it('says fractions on the detents and two decimals between', () => {
    expect(TUNE_DETENTS.map(tuneSays)).toEqual(['¼×', '½×', '1×', '2×', '4×']);
    expect(TUNE_DETENTS.map(detentSays)).toEqual(['¼', '½', '1', '2', '4']);
    expect(tuneSays(0.707)).toBe('0.71×');
    expect(tuneSays(3)).toBe('3.00×');
    expect(tuneSays(1.059)).toBe('1.06×');
  });

  it('steps to the next detent either way, and nudges a twelfth', () => {
    expect(tuneStepped(1.2, -1)).toBe(1);
    expect(tuneStepped(1.2, 1)).toBe(2);
    expect(tuneStepped(1, 1)).toBe(2);
    expect(tuneStepped(1, -1)).toBe(0.5);
    expect(tuneStepped(4, 1)).toBe(4);
    expect(tuneStepped(0.25, -1)).toBe(0.25);
    expect(tuneNudged(1, 1)).toBe(1.059);
    expect(tuneNudged(1.059, -1)).toBe(1);
    expect(tuneNudged(4, 1)).toBe(4);
  });

  it('reads a typed multiple in its usual forms, clamped and to three decimals', () => {
    expect(tuneTyped('0.5')).toBe(0.5);
    expect(tuneTyped(' .75 ')).toBe(0.75);
    expect(tuneTyped('1/2')).toBe(0.5);
    expect(tuneTyped('½')).toBe(0.5);
    expect(tuneTyped('¼×')).toBe(0.25);
    expect(tuneTyped('2x')).toBe(2);
    expect(tuneTyped('2 ×')).toBe(2);
    expect(tuneTyped('2/3')).toBe(0.667);
    expect(tuneTyped('9')).toBe(4);
    expect(tuneTyped('0.01')).toBe(0.25);
    for (const bad of ['', 'fast', '0', '-1', '1/0', '1..2', 'x']) expect(tuneTyped(bad)).toBeNull();
  });

  it('shares a value several presets agree on, and none where they differ', () => {
    expect(tuneShared([], 'speed')).toBe(1);
    expect(tuneShared([tuneOf({ tune: { speed: 2 } }), tuneOf({ tune: { speed: 2, sensitivity: 3 } })], 'speed')).toBe(2);
    expect(tuneShared([tuneOf({ tune: { speed: 2 } }), tuneOf({ tune: { speed: 2, sensitivity: 3 } })], 'sensitivity')).toBeNull();
  });
});
