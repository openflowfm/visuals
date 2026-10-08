import { describe, expect, it } from 'vitest';
import type { Entry } from './api.ts';
import { firstToOpen } from './library.ts';

const entry = (path: string): Entry => ({
  path,
  name: path
    .split('/')
    .pop()!
    .replace(/\.milk$/, ''),
  group: '',
});
const library = [entry('/p/a.milk'), entry('/p/b.milk'), entry('/p/c.milk')];

describe('firstToOpen', () => {
  it('opens the preset asked for, as the library knows it', () => {
    const known = { ...entry('/p/b.milk'), group: 'Geiss' };
    expect(firstToOpen([library[0], known], '/p/b.milk', 0)).toBe(known);
  });

  it('opens a preset asked for that is not in the library by its path', () => {
    expect(firstToOpen(library, '/elsewhere/x.milk', 0)).toEqual({ path: '/elsewhere/x.milk', name: 'x', group: '' });
  });

  it('picks through the library otherwise, never past its end', () => {
    expect(firstToOpen(library, null, 0)).toBe(library[0]);
    expect(firstToOpen(library, null, 0.5)).toBe(library[1]);
    expect(firstToOpen(library, null, 1)).toBe(library[2]);
  });

  it('opens nothing from an empty library', () => {
    expect(firstToOpen([], null, 0.3)).toBeNull();
  });
});
