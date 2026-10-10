import { describe, expect, it } from 'vitest';
import type { Drag } from '../drag.ts';
import { DEFAULT_SETTINGS, EMPTY_DECK, manual, type Lists, type Playlist } from '../playlists.ts';
import { canToggle, dropState, menuAt, menuStep, renamed, rowMenu, sidebarSections, toggleTitle } from './sidebar-model.ts';

const item = (k: string) => ({ path: `/p/${k}.milk`, name: k, group: 'A', missing: false, hash: k });
const smart = (id: string, name: string, recent?: number): Playlist => ({
  id,
  name,
  items: [],
  kind: 'smart',
  query: { groups: {}, text: '', ...(recent === undefined ? {} : { recent }) },
  settings: DEFAULT_SETTINGS,
});

const chill = manual('chill', 'Chill', [item('a'), item('b')]);
const warm = manual('warm', 'Warm up', []);
const calm = smart('calm', 'Calm');
const recent = smart('recent', 'Recently played', 50);
const lists: Lists = { playlists: [chill, calm, recent, warm], deck: { ...EMPTY_DECK, playlist: 'chill' } };

const dragging = (target: string | null): Drag => ({ payload: { kind: 'preset', path: '/p/x.milk', name: 'x', thumbnail: null }, x: 0, y: 0, target });

describe('sidebarSections', () => {
  it('puts recently played under the library, the playlists and the smart ones after, and marks the one playing', () => {
    const [lib, mine, smarts] = sidebarSections(lists, { library: 9, starred: 2 });
    expect(lib.rows.map((r) => r.name)).toEqual(['Library', 'Starred', 'Recently played']);
    expect(mine.rows.map((r) => [r.name, r.count, !!r.playing])).toEqual([
      ['Chill', 2, true],
      ['Warm up', 0, false],
    ]);
    expect(smarts.rows.map((r) => r.name)).toEqual(['Calm']);
  });
});

describe('playing from a row', () => {
  it('plays a playlist with presets or a smart one, stops the one playing, and has nothing to play in an empty one', () => {
    expect(canToggle(chill, false)).toBe(true);
    expect(canToggle(calm, false)).toBe(true);
    expect(canToggle(warm, false)).toBe(false);
    expect(canToggle(warm, true)).toBe(true);
    expect(toggleTitle(chill, true)).toBe('Stop Chill');
    expect(toggleTitle(chill, false)).toBe('Play Chill');
    expect(toggleTitle(warm, false)).toBe('Add presets to play it');
  });
});

describe('rowMenu', () => {
  const actions = (p: Playlist | undefined, playing = false) => rowMenu(p, playing, lists).map((i) => i.action);

  it('offers play, rename, save to a file and delete for a playlist', () => {
    expect(actions(chill)).toEqual(['play', 'rename', 'export', 'delete']);
    expect(rowMenu(chill, false, lists).map((i) => i.label)).toEqual(['Play', 'Rename', 'Save to a file', 'Delete…']);
    expect(rowMenu(chill, false, lists).find((i) => i.action === 'delete')?.danger).toBe(true);
    expect(actions(calm)).toEqual(['play', 'rename', 'export', 'delete']);
  });

  it('offers stop for the one playing, and play disabled for an empty one', () => {
    expect(actions(chill, true)[0]).toBe('stop');
    expect(rowMenu(warm, false, lists)[0]).toMatchObject({ action: 'play', disabled: true });
  });

  it('keeps recently played’s name and keeps it from being deleted', () => {
    expect(actions(recent)).toEqual(['play', 'export']);
  });

  it('has nothing for a row that is not a playlist', () => {
    expect(actions(undefined)).toEqual([]);
  });
});

describe('dropState', () => {
  it('makes a playlist a drop target, lit while the drag is over it', () => {
    expect(dropState(chill, null)).toEqual({ drop: 'list:chill', over: false, refuses: false });
    expect(dropState(chill, dragging('list:chill'))).toEqual({ drop: 'list:chill', over: true, refuses: false });
    expect(dropState(chill, dragging('list:warm')).over).toBe(false);
  });

  it('has a smart playlist refuse anything dragged, and take no drop', () => {
    expect(dropState(calm, null)).toEqual({ over: false, refuses: false });
    expect(dropState(calm, dragging(null))).toEqual({ over: false, refuses: true });
  });

  it('makes no target of a row that is not a playlist', () => {
    expect(dropState(undefined, dragging(null))).toEqual({ over: false, refuses: false });
  });
});

describe('renamed', () => {
  it('gives the trimmed name, or none when blank or unchanged', () => {
    expect(renamed('Chill', '  Chill out ')).toBe('Chill out');
    expect(renamed('Chill', 'Chill ')).toBeNull();
    expect(renamed('Chill', '   ')).toBeNull();
  });
});

describe('menuStep', () => {
  const off = [false, true, false, false];
  it('walks the items that can be chosen, wrapping, and jumps to the ends', () => {
    expect(menuStep(off, 0, 'ArrowDown')).toBe(2);
    expect(menuStep(off, 3, 'ArrowDown')).toBe(0);
    expect(menuStep(off, 2, 'ArrowUp')).toBe(0);
    expect(menuStep(off, 0, 'ArrowUp')).toBe(3);
    expect(menuStep(off, -1, 'ArrowDown')).toBe(0);
    expect(menuStep(off, 2, 'Home')).toBe(0);
    expect(menuStep(off, 0, 'End')).toBe(3);
  });

  it('does nothing for other keys, or with nothing to choose', () => {
    expect(menuStep(off, 0, 'a')).toBeNull();
    expect(menuStep([true, true], 0, 'ArrowDown')).toBeNull();
  });
});

describe('menuAt', () => {
  const view = { w: 800, h: 600 };
  const size = { w: 200, h: 150 };
  it('opens at the point when it fits', () => {
    expect(menuAt({ x: 100, y: 100 }, size, view)).toEqual({ x: 100, y: 100 });
  });
  it('flips to the left of, and above, a point near the right and bottom edges', () => {
    expect(menuAt({ x: 700, y: 500 }, size, view)).toEqual({ x: 500, y: 350 });
  });
  it('stays inside the window when it fits neither way', () => {
    expect(menuAt({ x: 100, y: 100 }, { w: 200, h: 590 }, view)).toEqual({ x: 100, y: 8 });
    expect(menuAt({ x: 2, y: 2 }, size, view)).toEqual({ x: 8, y: 8 });
  });
});
