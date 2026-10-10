// @vitest-environment happy-dom
//
// The library mounted in a DOM, with the app's commands and events faked: what
// it tells the deck when the grid opens a preset, and when it follows the grid
// again after the filter changes (decision 49).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, LibraryRow, Resume } from './api.ts';
import { Library } from './Library.tsx';
import { forgetResumedQuery, stepDeck } from './library.ts';
import { searchLibrary } from './librarySearch.ts';
import { EMPTY_DECK, type Deck } from './playlists.ts';

const { invoke, heard } = vi.hoisted(() => ({
  invoke: vi.fn(),
  heard: new Map<string, Set<(e: { payload: unknown }) => void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, f: (e: { payload: unknown }) => void) => {
    const all = heard.get(name) ?? new Set();
    heard.set(name, all.add(f));
    return Promise.resolve(() => void all.delete(f));
  },
}));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));

const row = (key: string): LibraryRow => ({ key, path: `/p/${key}.milk`, hash: key, style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
const ROWS = ['a', 'b', 'c'].map(row);
const ENTRIES: Entry[] = ROWS.map((r) => ({ path: r.path, name: r.title, group: 'A' }));

/** What the app's commands answer. */
function answer(cmd: string): unknown {
  if (cmd === 'library_index') return ROWS;
  if (cmd === 'library_data') return { version: 1, presets: {} };
  if (cmd === 'presets_failed' || cmd === 'presets') return [];
  if (cmd === 'playlists') return { playlists: [], deck };
  if (cmd === 'resume_state') return resume;
  return null;
}

/** What `resume_state` answers: where the app picked up. */
let resume: Resume | null = null;
/** What the deck plays, as `playlists` answers. */
let deck: Deck = EMPTY_DECK;

/** The `query` actions sent to the deck: the grid followed, from where. */
const follows = () =>
  invoke.mock.calls.filter(([cmd, args]) => cmd === 'act' && (args as { action: { kind: string } }).action.kind === 'query').map(([, args]) => (args as { action: { at: string } }).action.at);

/** An event from the app, as the page gets it. */
const emit = (name: string, payload: unknown) => act(() => heard.get(name)?.forEach((f) => f({ payload })));
const live = (deck: Partial<Deck>, path: string | null = null) => emit('live', { deck: { ...EMPTY_DECK, ...deck }, opened: null, path, error: null });
const lists = (deck: Partial<Deck>) => emit('lists', { playlists: [], deck: { ...EMPTY_DECK, ...deck } });

/** The library as the App shows it: `current` and `search` are the App's. */
function view(current: string | null, search = '', onSearch: (s: string) => void = () => {}) {
  return <Library entries={ENTRIES} loaded search={search} onSearch={onSearch} found={searchLibrary(ENTRIES, search)} current={current} into={null} onLoad={() => {}} onAdd={() => {}} />;
}

/** Mount it, let the index and data answer, and open the first tile from the grid (focus, Enter). */
async function mountAndPlay() {
  const r = render(view(ROWS[0].path));
  await act(() => vi.advanceTimersByTimeAsync(0));
  const grid = screen.getByRole('listbox', { name: 'presets' });
  fireEvent.focus(grid);
  fireEvent.keyDown(grid, { key: 'Enter' });
  expect(follows()).toEqual([ROWS[0].path]);
  return r;
}

/** Change the filter (typing in the search box) and wait out the re-follow's delay. */
async function filter(r: ReturnType<typeof render>, current: string | null, search: string) {
  r.rerender(view(current, search));
  await act(() => vi.advanceTimersByTimeAsync(400));
}

beforeEach(() => {
  vi.useFakeTimers();
  resume = null;
  deck = EMPTY_DECK;
  forgetResumedQuery(true);
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(answer(cmd)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the library showing a filter the app picked up', () => {
  const QUERY = { groups: { style: ['A'] }, text: 'b' };
  const picked = (over: Partial<Resume> = {}): Resume => ({ playlist: null, index: null, current: ROWS[1].path, source: null, query: QUERY, ...over });
  // The app played the filter again: the deck follows it.
  beforeEach(() => {
    deck = { ...EMPTY_DECK, current: ROWS[1].path, query: QUERY };
  });
  const mount = async (onSearch: (s: string) => void = () => {}) => {
    const r = render(view(ROWS[1].path, '', onSearch));
    await act(() => vi.advanceTimersByTimeAsync(0));
    return r;
  };

  it("shows its chips and search, and the deck follows it on as it's changed", async () => {
    resume = picked();
    const onSearch = vi.fn();
    const r = await mount(onSearch);
    expect(screen.getByRole('button', { name: 'stop filtering by A' })).toBeTruthy();
    expect(onSearch).toHaveBeenCalledWith('b');
    // Already following it (the app played it again): a change to it is followed.
    await filter(r, ROWS[1].path, 'c');
    expect(follows().at(-1)).toBe(ROWS[1].path);
  });

  it('is shown once a run: a library opened later starts unfiltered', async () => {
    resume = picked();
    const r = await mount();
    expect(screen.getByRole('button', { name: 'stop filtering by A' })).toBeTruthy();
    r.unmount();
    await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
  });

  it('is shown by no library once the user changed the filter before it came', async () => {
    resume = picked();
    const r = render(view(ROWS[1].path));
    // Typed into the search before the app answered.
    fireEvent.change(screen.getByRole('searchbox', { name: 'search presets' }), { target: { value: 'x' } });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
    r.unmount();
    await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
  });

  it("isn't shown after a playlist was loaded from the home before the library opened, so it can't replace the playlist", async () => {
    resume = picked();
    // On the home, the user loads a playlist; then opens the library.
    deck = { ...EMPTY_DECK, playlist: 'mine', index: 0, current: ROWS[2].path };
    await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(follows()).toEqual([]);
  });

  it('shows nothing when a playlist was picked up, or nothing at all', async () => {
    resume = picked({ playlist: 'mine' });
    let r = await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
    r.unmount();
    resume = null;
    forgetResumedQuery(true);
    r = await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
    expect(follows()).toEqual([]);
  });
});

describe("the home's library pane (decision 68)", () => {
  /** The library as the home's main pane, with the App's `search`. */
  const home = (search = '', onSearch: (s: string) => void = () => {}, scope: 'library' | 'starred' = 'library') => (
    <Library
      entries={ENTRIES}
      loaded
      search={search}
      onSearch={onSearch}
      found={searchLibrary(ENTRIES, search)}
      current={null}
      into={null}
      onLoad={() => {}}
      onAdd={() => {}}
      home={{ scope, title: scope === 'starred' ? 'Starred' : 'Library', onChosen: () => {} }}
    />
  );
  const mount = async (search = '', onSearch: (s: string) => void = () => {}, scope: 'library' | 'starred' = 'library') => {
    const r = render(home(search, onSearch, scope));
    await act(() => vi.advanceTimersByTimeAsync(0));
    return r;
  };
  const count = () => document.querySelector('.lib-head .lib-count')!.textContent;
  const searchbox = () => screen.getByRole('searchbox', { name: 'search presets' });
  beforeEach(() => localStorage.clear());

  it("counts the results while filtering, and the pane's total otherwise", async () => {
    const r = await mount();
    expect(count()).toBe('3');
    expect(searchbox().getAttribute('placeholder')).toBe('Search 3 presets');
    r.rerender(home('b'));
    expect(count()).toBe('1');
    // The placeholder keeps the pane's own count.
    expect(searchbox().getAttribute('placeholder')).toBe('Search 3 presets');
  });

  it('shows a count on "Filter" only when values are picked', async () => {
    await mount();
    const button = screen.getByRole('button', { name: 'filter' });
    expect(button.textContent).toBe('Filter');
    expect(button.querySelector('.lib-filter-badge')).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'style' }));
    fireEvent.click(screen.getByRole('button', { name: 'A, 3 presets' }));
    const picked = screen.getByRole('button', { name: 'filter, 1 picked' });
    expect(picked.querySelector('.lib-filter-badge')!.textContent).toBe('1');
    expect(count()).toBe('3');
    expect(document.querySelector('.lib-picked-count')!.textContent).toBe('3 presets');
  });

  it('says a search found nothing, and its clear empties the search and goes back to the box', async () => {
    const onSearch = vi.fn();
    await mount('zebra kazoo', onSearch);
    expect(screen.queryByRole('listbox', { name: 'presets' })).toBeNull();
    expect(count()).toBe('0');
    const state = screen.getByRole('heading', { name: 'Nothing matches “zebra kazoo”' }).closest('.lib-empty') as HTMLElement;
    expect(state.textContent).toContain('Every word has to match a name, style, author or tag.');
    fireEvent.click(within(state).getByRole('button', { name: 'Clear the search' }));
    expect(onSearch).toHaveBeenLastCalledWith('');
    expect(document.activeElement).toBe(searchbox());
  });

  it('says a filter found nothing, naming its values, and its clear lets them go', async () => {
    resume = { playlist: null, index: null, current: null, source: null, query: { groups: { style: ['Z'] }, text: '' } };
    deck = { ...EMPTY_DECK, query: { groups: { style: ['Z'] }, text: '' } };
    await mount();
    const state = screen.getByRole('heading', { name: 'Nothing matches “Z”' }).closest('.lib-empty') as HTMLElement;
    expect(state.textContent).toContain('No preset has every value picked.');
    fireEvent.click(within(state).getByRole('button', { name: 'Clear the filter' }));
    expect(screen.queryByRole('button', { name: 'stop filtering by Z' })).toBeNull();
    expect(screen.getByRole('listbox', { name: 'presets' })).toBeTruthy();
    expect(document.activeElement).toBe(searchbox());
    expect(count()).toBe('3');
  });

  it('browses curated picks first, counts only what the grid can show, and saves a smart playlist that does not browse', async () => {
    const fade: LibraryRow = { ...row('fade'), style: '! Transition' };
    const picks = [row('a'), { ...row('b'), curated: true }, row('c'), fade];
    const starred = { version: 1, presets: { c: { star: true }, fade: { star: true } } };
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'library_index' ? picks : cmd === 'library_data' ? starred : answer(cmd)));
    const tiles = () => screen.getAllByRole('option').map((o) => o.getAttribute('aria-label')!.split(' — ')[0]);
    const r = await mount();
    expect(tiles()).toEqual(['b', 'a', 'c']);
    // The transition waits for a filter, so neither the title nor the placeholder counts it.
    expect(count()).toBe('3');
    expect(searchbox().getAttribute('placeholder')).toBe('Search 3 presets');
    // A search reaches it, and the deck following the grid is told the grid browses.
    r.rerender(home('fade'));
    expect(tiles()).toEqual(['fade']);
    fireEvent.focus(screen.getByRole('listbox', { name: 'presets' }));
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'presets' }), { key: 'Enter' });
    const query = invoke.mock.calls.filter(([cmd]) => cmd === 'act').map(([, a]) => (a as { action: { query: { browse?: boolean } } }).action.query);
    expect(query.at(-1)).toMatchObject({ text: 'fade', browse: true });
    // Saved, the filter is a plain query: a smart playlist resolves every match, by key.
    fireEvent.click(screen.getByRole('button', { name: 'Save as smart playlist' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'smart playlist name' }), { key: 'Enter' });
    const saved = invoke.mock.calls.find(([cmd]) => cmd === 'smart_playlist_save')![1] as { query: object };
    expect(saved.query).toEqual({ groups: {}, text: 'fade' });
    cleanup();
    // Starred counts by the grid's rule too: the starred transition isn't shown, so it isn't counted.
    await mount('', () => {}, 'starred');
    expect(tiles()).toEqual(['c']);
    expect(count()).toBe('1');
    expect(searchbox().getAttribute('placeholder')).toBe('Search 1 preset');
  });

  it('says so, centred, when nothing is starred', async () => {
    await mount('', () => {}, 'starred');
    expect(screen.getByRole('heading', { name: 'Nothing starred yet' }).closest('.lib-empty')).toBeTruthy();
    expect(count()).toBe('0');
    expect(searchbox().getAttribute('placeholder')).toBe('Search 0 presets');
  });
});

describe('the library following the grid', () => {
  it('plays a tile with nothing followed until the index has answered, then follows as usual', async () => {
    let index!: (rows: LibraryRow[]) => void;
    invoke.mockImplementation((cmd: string) => (cmd === 'library_index' ? new Promise((r) => (index = r)) : Promise.resolve(answer(cmd))));
    const r = render(view(null));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const grid = screen.getByRole('listbox', { name: 'presets' });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(follows()).toEqual([]);
    // Nor once the filter changes: the deck isn't following the fallback grid.
    await filter(r, null, 'b');
    expect(follows()).toEqual([]);
    r.rerender(view(null));
    await act(async () => index(ROWS));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(follows()).toEqual([ROWS[0].path]);
  });

  it('follows the grid again after the filter changes', async () => {
    const r = await mountAndPlay();
    await filter(r, ROWS[0].path, 'b');
    expect(follows()).toEqual([ROWS[0].path, ROWS[0].path]);
  });

  it('stops following when a playlist loads', async () => {
    const r = await mountAndPlay();
    lists({ playlist: null });
    live({ playlist: 'mine', index: 0 });
    await filter(r, ROWS[0].path, 'b');
    expect(follows()).toEqual([ROWS[0].path]);
  });

  it('stops following when the playlist is let go, until the grid opens a preset again', async () => {
    const r = await mountAndPlay();
    // Opened from the grid while a playlist plays: the deck keeps the playlist.
    lists({ playlist: 'mine', index: 0 });
    await filter(r, ROWS[0].path, 'b');
    expect(follows()).toHaveLength(2);
    live({ playlist: null });
    await filter(r, ROWS[0].path, 'c');
    expect(follows()).toHaveLength(2);
  });

  it('waits for the live event when the deck answers a step first, then follows from the new preset', async () => {
    const r = await mountAndPlay();
    // → answered at once; the `live` event saying what opened hasn't reached the page.
    await act(() => stepDeck({ kind: 'next' }));
    await filter(r, ROWS[0].path, 'b');
    expect(follows()).toEqual([ROWS[0].path]);
    // The event comes, the App shows the new preset, and the follow goes from there.
    live({}, ROWS[1].path);
    r.rerender(view(ROWS[1].path, 'b'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(follows()).toEqual([ROWS[0].path, ROWS[1].path]);
  });
});
