import { describe, expect, it } from 'vitest';
import type { Entry } from './api.ts';
import { CAP, foundSummary, rowFor, searchLibrary } from './librarySearch.ts';

const e = (group: string, name: string): Entry => ({ path: `${group}/${name}.milk`, name, group });
const lib = [e('Geiss', 'Spiral Dance'), e('Flexi', 'Mandala Spiral'), e('Geiss', 'Warp Field'), e('Rovastar', 'Fractal')];

describe('searchLibrary', () => {
  it('returns everything for an empty query', () => {
    const f = searchLibrary(lib, '  ');
    expect(f.shown).toEqual(lib);
    expect(f.matched).toBe(4);
    expect(f.total).toBe(4);
  });

  it('matches every word, case-insensitively, across group and name', () => {
    expect(searchLibrary(lib, 'spiral').shown.map((x) => x.name)).toEqual(['Spiral Dance', 'Mandala Spiral']);
    expect(searchLibrary(lib, 'GEISS spiral').shown.map((x) => x.name)).toEqual(['Spiral Dance']);
    expect(searchLibrary(lib, 'geiss  nothing').matched).toBe(0);
  });

  it('caps the rows shown but counts every match', () => {
    const many = Array.from({ length: CAP + 50 }, (_, i) => e('g', `p${i}`));
    const f = searchLibrary(many, 'p');
    expect(f.shown).toHaveLength(CAP);
    expect(f.matched).toBe(CAP + 50);
    expect(f.total).toBe(CAP + 50);
    expect(searchLibrary(lib, '', 2)).toMatchObject({ matched: 4, total: 4 });
    expect(searchLibrary(lib, '', 2).shown).toHaveLength(2);
  });
});

describe('foundSummary', () => {
  it('says when the list is capped, with thousands separators', () => {
    expect(foundSummary({ shown: new Array(400), matched: 1203, total: 5000 }, 'a')).toBe('showing 400 of 1,203 — keep typing');
  });

  it('says when nothing matches', () => {
    expect(foundSummary({ shown: [], matched: 0, total: 4 }, ' foo ')).toBe('no presets match “foo”');
  });

  it('says nothing when everything fits, or there is no query', () => {
    expect(foundSummary(searchLibrary(lib, 'spiral'), 'spiral')).toBeNull();
    expect(foundSummary({ shown: [], matched: 0, total: 0 }, '')).toBeNull();
  });
});

describe('rowFor', () => {
  it('steps and clamps', () => {
    expect(rowFor('ArrowDown', -1, 5)).toBe(0);
    expect(rowFor('ArrowDown', 2, 5)).toBe(3);
    expect(rowFor('ArrowDown', 4, 5)).toBe(4);
    expect(rowFor('ArrowUp', 0, 5)).toBe(0);
    expect(rowFor('ArrowUp', -1, 5)).toBe(0);
    expect(rowFor('ArrowUp', 3, 5)).toBe(2);
  });

  it('pages by ten and clamps', () => {
    expect(rowFor('PageDown', 0, 50)).toBe(10);
    expect(rowFor('PageDown', 45, 50)).toBe(49);
    expect(rowFor('PageUp', 15, 50)).toBe(5);
    expect(rowFor('PageUp', 3, 50)).toBe(0);
  });

  it('jumps with Home and End', () => {
    expect(rowFor('Home', 7, 20)).toBe(0);
    expect(rowFor('End', -1, 20)).toBe(19);
  });

  it('ignores other keys and handles an empty list', () => {
    expect(rowFor('a', 2, 5)).toBeNull();
    expect(rowFor('Enter', 2, 5)).toBeNull();
    expect(rowFor('ArrowDown', -1, 0)).toBe(-1);
  });
});
