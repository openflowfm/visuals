// @vitest-environment happy-dom
//
// The library mounted in a DOM, with the app's commands and events faked: what
// it tells the deck when the grid opens a preset, and when it follows the grid
// again after the filter changes (decision 49).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  if (cmd === 'playlists') return { playlists: [], deck: EMPTY_DECK };
  if (cmd === 'resume_state') return resume;
  return null;
}

/** What `resume_state` answers: where the app picked up. */
let resume: Resume | null = null;

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
  forgetResumedQuery(true);
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(answer(cmd)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the library showing a filter the app picked up', () => {
  const picked = (over: Partial<Resume> = {}): Resume => ({ playlist: null, index: null, current: ROWS[1].path, source: null, query: { groups: { style: ['A'] }, text: 'b' }, ...over });
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

  it('is shown by each library that opens until the user changes the filter', async () => {
    resume = picked();
    let r = await mount();
    r.unmount();
    r = await mount();
    expect(screen.getByRole('button', { name: 'stop filtering by A' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'clear the filter' }));
    r.unmount();
    await mount();
    expect(screen.queryByRole('button', { name: 'stop filtering by A' })).toBeNull();
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

describe('the library following the grid', () => {
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
