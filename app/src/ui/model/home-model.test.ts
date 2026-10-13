import { describe, expect, it } from 'vitest';
import { INSPECTOR_KEY, offersQuickAdd, paneName, rowSays, SIDEBAR_KEY } from './home-model';
import { DEFAULT_SETTINGS, EMPTY_DECK, type Lists, type Playlist } from './playlists';

// Which panes dock (`modesFor` over `homeDocks`) is HomeLayout.test.tsx's; the old fixed 900/1200 px widths are gone.

describe('the layout choices', () => {
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

describe('offersQuickAdd', () => {
  it('offers quick add on manual playlists only', () => {
    const manual: Playlist = { id: 'm', name: 'M', items: [], kind: 'manual', query: null, settings: DEFAULT_SETTINGS };
    expect(offersQuickAdd(manual)).toBe(true);
    expect(offersQuickAdd({ ...manual, kind: 'smart' })).toBe(false);
  });
});
