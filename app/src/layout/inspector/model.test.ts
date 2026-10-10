import { describe as group, expect, it } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { characterOf, describe, listed, scaleOf } from './model.ts';

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
  it('writes a line from the analysis in plain words', () => {
    expect(describe(characterOf(prepareRow(row(), undefined)))).toBe('A slow, dark, calm hypnotic piece by geiss & rovastar. Mostly purple and red.');
  });

  it('says only what was measured, and leaves out "unknown" authors', () => {
    const c = characterOf(prepareRow(row({ look: null, authors: ['unknown'], style: 'Particles' }), undefined));
    expect(c.unmeasured).toBe(true);
    expect(describe(c)).toBe('A particles piece.');
  });

  it('says grey when drawn with no hue, and takes the user overrides', () => {
    const grey = characterOf(prepareRow(row({ look: { ...look, hues: [] } }), undefined));
    expect(describe(grey)).toMatch(/Grey, without a colour of its own\.$/);
    const fast = characterOf(prepareRow(row(), { overrides: { speed: 'high' } }));
    expect(fast.speed.word).toBe('fast');
    expect(fast.speed.at).toBeCloseTo(5 / 6);
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
