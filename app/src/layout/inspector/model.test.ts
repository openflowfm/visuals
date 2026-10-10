import { describe as group, expect, it } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { characterOf, colourNames, fieldSays, listed, scaleOf } from './model.ts';

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
