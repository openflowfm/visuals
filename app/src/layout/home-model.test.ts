import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_DECK, type Lists, type Playlist } from '../playlists.ts';
import { INSPECTOR_AT, INSPECTOR_KEY, modesFor, paneName, rowSays, SIDEBAR_AT, SIDEBAR_KEY } from './home-model.ts';

const unset = { sidebar: null, inspector: null };

describe('modesFor', () => {
  it('docks both in a wide window, and keeps them so unless the viewer put them away', () => {
    expect(modesFor(1400, unset)).toEqual({ sidebar: 'docked', inspector: 'docked' });
    expect(modesFor(INSPECTOR_AT, unset)).toEqual({ sidebar: 'docked', inspector: 'docked' });
    expect(modesFor(1400, { sidebar: false, inspector: false })).toEqual({ sidebar: 'hidden', inspector: null });
    expect(modesFor(1400, { sidebar: true, inspector: true })).toEqual({ sidebar: 'docked', inspector: 'docked' });
  });

  it('closes the inspector by default under 1200, and lays it over the main column when opened', () => {
    expect(modesFor(INSPECTOR_AT - 1, unset)).toEqual({ sidebar: 'docked', inspector: null });
    expect(modesFor(1000, { sidebar: null, inspector: true })).toEqual({ sidebar: 'docked', inspector: 'overlay' });
  });

  it('hides the sidebar under 900, and lays it over the main column when opened', () => {
    expect(modesFor(SIDEBAR_AT, unset).sidebar).toBe('docked');
    expect(modesFor(SIDEBAR_AT - 1, unset).sidebar).toBe('hidden');
    expect(modesFor(600, { sidebar: false, inspector: null }).sidebar).toBe('hidden');
    expect(modesFor(600, { sidebar: true, inspector: null }).sidebar).toBe('overlay');
  });

  it('keeps its choices under keys of their own, beside the home’s others', () => {
    expect(SIDEBAR_KEY).toBe('visuals.home.sidebar');
    expect(INSPECTOR_KEY).toBe('visuals.home.inspector');
  });
});

describe('the words a row and a pane say', () => {
  const mine: Playlist = { id: 'mine', name: 'Mine', items: [{ path: '/p/g/a.milk', name: 'a', group: 'g', missing: false, hash: null }], kind: 'manual', query: null, settings: DEFAULT_SETTINGS };
  const lists: Lists = { playlists: [mine], deck: EMPTY_DECK };

  it('name a playlist’s row with its kind, its count and whether it plays', () => {
    expect(rowSays(mine, true)).toBe('Mine, playlist, 1 preset, playing');
  });

  it('name a pane, falling back to the library', () => {
    expect(paneName(null, lists)).toBe('Library');
    expect(paneName({ kind: 'starred' }, lists)).toBe('Starred');
    expect(paneName({ kind: 'list', id: 'mine' }, lists)).toBe('Mine');
    expect(paneName({ kind: 'list', id: 'gone' }, lists)).toBe('Library');
  });
});
