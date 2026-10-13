// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIGHT_FAST, CLOSING, DATA, ROWS, WARM_UP, itemOf, row } from '../fixtures/fixtures';
import type { LibraryRow } from './api';
import { matches, STRIP_CAP, strip } from './home';
import { browseOrder, prepare, STARRED } from './librarySearch';
import type { Playlist } from './playlists';
import { drawnOf, inspectorShowsMap, LIBRARY_VIEW_KEY, listPlace, listRows, mapRoom, mapRows, paneQuery, readLibraryView, roomShowsMap, setLibraryView, useLibraryView } from './libraryView';

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

  it('follows a choice another window keeps, and stops listening when nothing does', () => {
    const elsewhere = (key: string | null, value: string) =>
      act(() => {
        store.set(LIBRARY_VIEW_KEY, value);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
      });
    const a = renderHook(() => useLibraryView());
    const b = renderHook(() => useLibraryView());
    expect(a.result.current[0]).toBe('grid');
    elsewhere(LIBRARY_VIEW_KEY, 'map');
    expect(a.result.current[0]).toBe('map');
    expect(b.result.current[0]).toBe('map');
    // Storage cleared elsewhere (`key` null) is heard too.
    elsewhere(null, 'grid');
    expect(a.result.current[0]).toBe('grid');
    a.unmount();
    b.unmount();
    // Nothing listening: the page stops following the event.
    const removed = vi.spyOn(window, 'removeEventListener');
    const c = renderHook(() => useLibraryView());
    c.unmount();
    expect(removed).toHaveBeenCalledWith('storage', expect.any(Function));
    removed.mockRestore();
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

describe('where a dot of a playlist plays from', () => {
  const rowAt = (path: string) => ROWS.find((r) => r.path === path)!;

  it("a manual playlist: the place its tile has (the strip's numbering); listed twice, its first", () => {
    const { tiles } = strip(WARM_UP, { rows: PREPARED, played: [], playing: null });
    // Warm-up lists some presets twice: one dot, which plays from the first of its tiles.
    expect(new Set(tiles.map((t) => t.path)).size).toBeLessThan(tiles.length);
    for (const t of tiles) expect(listPlace(WARM_UP, rowAt(t.path), PREPARED, [], false)).toBe(tiles.find((x) => x.path === t.path)!.index);
  });

  it('a manual playlist past the strip: its place, though it has no tile', () => {
    const gone = (i: number) => ({ path: `/gone/${i}.milk`, name: `${i}`, group: '', missing: true, hash: null });
    const long: Playlist = { ...WARM_UP, items: [...Array.from({ length: STRIP_CAP + 5 }, (_, i) => gone(i)), itemOf(row(2))] };
    const { tiles } = strip(long, { rows: PREPARED, played: [], playing: null });
    expect(tiles.some((t) => t.path === row(2).path)).toBe(false);
    expect(listPlace(long, row(2), PREPARED, [], false)).toBe(STRIP_CAP + 5);
  });

  it('a manual playlist: by hash when moved, never a missing item, null when not in it', () => {
    const moved: Playlist = { ...WARM_UP, items: [{ ...itemOf(row(3)), path: '/elsewhere/moved.milk' }] };
    expect(listPlace(moved, row(3), PREPARED, [], false)).toBe(0);
    const missing: Playlist = { ...WARM_UP, items: [{ ...itemOf(row(3)), missing: true }, itemOf(row(3))] };
    expect(listPlace(missing, row(3), PREPARED, [], false)).toBe(1);
    expect(listPlace(moved, row(4), PREPARED, [], false)).toBeNull();
  });

  it('a manual playlist playing shuffled: still its place in the playlist', () => {
    const at = CLOSING.items.findIndex((i) => !i.missing);
    expect(listPlace(CLOSING, rowAt(CLOSING.items[at].path), PREPARED, [], true)).toBe(at);
  });

  it('a smart playlist: its index among the matches, past the strip too; playing shuffled, none', () => {
    // A library bigger than the strip, every preset a match.
    const big: LibraryRow[] = Array.from({ length: STRIP_CAP + 20 }, (_, i) => ({ ...row(i), key: `k${String(i).padStart(4, '0')}`, path: `/big/${i}.milk`, hash: `h${i}` }));
    const rows = prepare(big, { version: 1, presets: {} });
    const all: Playlist = { ...BRIGHT_FAST, query: { groups: {}, text: '' } };
    const found = matches(all.query!, rows, []);
    expect(found.length).toBeGreaterThan(STRIP_CAP);
    const last = found[found.length - 1].row;
    // Set to shuffle but not the one playing: the strip numbers it unshuffled, and so does this.
    expect(all.settings.order).toBe('shuffle');
    expect(listPlace(all, last, rows, [], false)).toBe(found.length - 1);
    expect(listPlace(all, found[3].row, rows, [], false)).toBe(3);
    // Playing shuffled: the deck's order, which the page can't name.
    expect(listPlace(all, last, rows, [], true)).toBeNull();
    expect(listPlace({ ...all, query: null }, last, rows, [], false)).toBeNull();
  });
});

describe('what Map view shows', () => {
  const unmeasured = (r: LibraryRow): LibraryRow => ({ ...r, look: null });

  it('counts the dots: the measured rows', () => {
    const rows = [row(0), row(1), unmeasured(row(2))];
    expect(drawnOf(rows)).toBe(rows.filter((r) => r.look).length);
    expect(drawnOf(rows.map(unmeasured))).toBe(0);
    expect(drawnOf([])).toBe(0);
  });

  it('the map while any preset is a dot', () => {
    expect(mapRoom(5, 1)).toBe('map');
  });

  it('presets but no dots (none measured, or all gone): the note', () => {
    expect(mapRoom(5, 0)).toBe('undrawn');
    // A playlist whose items are all gone: tiles, no rows, so no dots.
    const allGone: Playlist = { ...CLOSING, items: CLOSING.items.filter((i) => i.missing) };
    expect(mapRoom(allGone.items.length, drawnOf(listRows(allGone, PREPARED, [])))).toBe('undrawn');
  });

  it('nothing at all: the source says it is empty', () => {
    expect(mapRoom(0, 0)).toBe('empty');
  });
});
