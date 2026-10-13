// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSING, DATA, ROWS, WARM_UP, itemOf, row } from '../fixtures/fixtures';
import { browseOrder, prepare, STARRED } from './librarySearch';
import type { Playlist } from './playlists';
import { inspectorShowsMap, LIBRARY_VIEW_KEY, listRows, mapRows, paneQuery, readLibraryView, roomShowsMap, setLibraryView, useLibraryView } from './libraryView';

/** The library as the home's pane prepares it: the user's data over the index, browse-ordered. */
const PREPARED = browseOrder(prepare(ROWS, DATA));
const keys = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

describe('the library view kept', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    setLibraryView('grid');
    vi.unstubAllGlobals();
  });

  it('reads map, and the grid for anything else', () => {
    expect(readLibraryView('map')).toBe('map');
    expect(readLibraryView('grid')).toBe('grid');
    expect(readLibraryView(null)).toBe('grid');
    expect(readLibraryView('tiles')).toBe('grid');
  });

  it('starts on the grid, and keeps a change in storage for the next start', () => {
    const { result } = renderHook(() => useLibraryView());
    expect(result.current[0]).toBe('grid');
    act(() => result.current[1]('map'));
    expect(result.current[0]).toBe('map');
    expect(store.get(LIBRARY_VIEW_KEY)).toBe('map');
  });

  it('follows what storage holds, so a page started in Map view opens on it', () => {
    store.set(LIBRARY_VIEW_KEY, 'map');
    const { result } = renderHook(() => useLibraryView());
    expect(result.current[0]).toBe('map');
  });

  it('is one choice for the page: every view of it follows a change', () => {
    const a = renderHook(() => useLibraryView());
    const b = renderHook(() => useLibraryView());
    act(() => a.result.current[1]('map'));
    expect(b.result.current[0]).toBe('map');
  });

  it("holds for the session when storage can't keep it", () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {},
    });
    const { result } = renderHook(() => useLibraryView());
    act(() => result.current[1]('map'));
    expect(result.current[0]).toBe('map');
  });
});

describe('where the map shows', () => {
  it('the room shows it in Map view, and the inspector leaves its own out', () => {
    expect(roomShowsMap('map', false)).toBe(true);
    expect(inspectorShowsMap('map', false)).toBe(false);
  });

  it('in Grid view the room shows the grid, and the inspector keeps its map', () => {
    expect(roomShowsMap('grid', false)).toBe(false);
    expect(inspectorShowsMap('grid', false)).toBe(true);
  });

  it('quick add keeps the grid (a click adds), so the inspector keeps its map', () => {
    expect(roomShowsMap('map', true)).toBe(false);
    expect(inspectorShowsMap('map', true)).toBe(true);
  });
});

describe('what the map draws: what the grid would show', () => {
  const style = ROWS[0].style;

  it('the library: every browsable preset', () => {
    const all = mapRows(PREPARED, paneQuery(false, {}, '', true));
    // The fixture's presets are all curated: the library's map draws every one.
    expect(keys(all).sort()).toEqual(keys(ROWS).sort());
  });

  it('Starred: only the starred ones', () => {
    const starred = mapRows(PREPARED, paneQuery(true, {}, '', true));
    const want = PREPARED.filter((p) => p.star).map((p) => p.row.key);
    expect(starred.length).toBeGreaterThan(0);
    expect(keys(starred).every((k) => want.includes(k))).toBe(true);
  });

  it('a filter narrows the dots to its values', () => {
    const all = mapRows(PREPARED, paneQuery(false, {}, '', true));
    const one = mapRows(PREPARED, paneQuery(false, { style: [style] }, '', true));
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(all.length);
    expect(one.every((r) => r.style === style)).toBe(true);
  });

  it('a search narrows the dots, and with the filter too (AND)', () => {
    const word = ROWS[0].title.split(/\s+/)[0];
    const all = mapRows(PREPARED, paneQuery(false, {}, '', true));
    const found = mapRows(PREPARED, paneQuery(false, {}, word, true));
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(all.length);
    expect(keys(found)).toContain(ROWS[0].key);
    const both = mapRows(PREPARED, paneQuery(false, { style: [style] }, word, true));
    expect(both.every((r) => r.style === style && keys(found).includes(r.key))).toBe(true);
  });

  it('a search that finds nothing draws nothing', () => {
    expect(mapRows(PREPARED, paneQuery(false, {}, 'zzzz-no-such-preset', true))).toEqual([]);
  });

  it("Starred's star stays picked under the viewer's own filter", () => {
    expect(paneQuery(true, { style: [style] }, 'x', true)).toEqual({ groups: { style: [style], star: [STARRED] }, text: 'x', browse: true });
    expect(paneQuery(false, {}, '', false)).toEqual({ groups: {}, text: '' });
  });

  it("a manual playlist: its presets, once each, none for a file that's gone", () => {
    const twice: Playlist = { ...WARM_UP, items: [...WARM_UP.items.slice(0, 3), itemOf(row(0))] };
    expect(keys(listRows(twice, PREPARED, []))).toEqual(keys(WARM_UP.items.slice(0, 3).map((i) => ROWS.find((r) => r.path === i.path)!)));
    // Closing has a missing file: four dots for its five items.
    expect(listRows(CLOSING, PREPARED, [])).toHaveLength(4);
  });

  it('a manual playlist finds a moved preset by its hash', () => {
    const moved: Playlist = { ...WARM_UP, items: [{ ...itemOf(row(3)), path: '/elsewhere/moved.milk' }] };
    expect(keys(listRows(moved, PREPARED, []))).toEqual([row(3).key]);
  });

  it('a smart playlist: its matches; Recently played: the presets played lately', () => {
    const fast: Playlist = { ...WARM_UP, kind: 'smart', items: [], query: { groups: { style: [style] }, text: '' } };
    const got = listRows(fast, PREPARED, []);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.style === style)).toBe(true);
    const recent: Playlist = { ...fast, query: { groups: {}, text: '', recent: 50 } };
    expect(keys(listRows(recent, PREPARED, [row(5).path, row(2).path]))).toEqual([row(5).key, row(2).key]);
  });
});
