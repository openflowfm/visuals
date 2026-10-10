import { describe, expect, it } from 'vitest';
import type { LibraryRow } from '../api.ts';
import { fitCount, sectionTileSays } from './sections-model.ts';

const row = (over: Partial<LibraryRow> = {}): LibraryRow =>
  ({ key: 'k', path: '/p/Hypnotic/Spiral/aurora.milk', hash: 'h', style: 'Hypnotic', sub_style: null, authors: ['geiss'], title: 'aurora', thumbnail: null, look: null, ...over }) as LibraryRow;

describe('fitCount', () => {
  it('fits as many as auto-fill would, gaps between them only', () => {
    expect(fitCount(1300, 200, 16)).toBe(6);
    expect(fitCount(600, 200, 16)).toBe(2);
    expect(fitCount(632, 200, 16)).toBe(3);
    expect(fitCount(631, 200, 16)).toBe(2);
  });
  it('always shows one, and every tile while unmeasured', () => {
    expect(fitCount(120, 200, 16)).toBe(1);
    expect(fitCount(0, 200, 16)).toBe(Infinity);
    expect(fitCount(800, Number.NaN, 16)).toBe(Infinity);
  });
});

describe('sectionTileSays', () => {
  it('says the grid’s words: name, style, authors, then what’s true now', () => {
    expect(sectionTileSays(row(), false, false)).toBe('aurora — Hypnotic, by geiss');
    expect(sectionTileSays(row({ sub_style: 'Spiral' }), true, true)).toBe('aurora — Hypnotic › Spiral, by geiss · playing · starred');
  });
  it('names a number-only title by its file, and leaves "unknown" out of the authors', () => {
    expect(sectionTileSays(row({ title: '385', path: '/p/Sparkle/Glimmer 385.milk', authors: ['unknown'] }), false, false)).toBe('Glimmer 385 — Hypnotic');
  });
});
