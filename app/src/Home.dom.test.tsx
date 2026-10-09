// @vitest-environment happy-dom
//
// The home mounted in a DOM, with the app's commands and events faked: since the
// library view merged into it (decision 66), it is the one place to browse, so
// what that view did is checked here. The header offers Home and Live; the big
// preview sits in its own cell, outside the main pane; choosing a preset in the
// grid or the strip opens it; ←, → and R step the deck while it follows the grid
// or a playlist (#137); the preset the app put back stays (#161); and
// `VISUALS_VIEW=library` opens it on the library pane.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, LibraryRow, Resume } from './api.ts';
import { Home } from './Home.tsx';
import { forgetResumedQuery } from './library.ts';
import { EMPTY_DECK, manual, type Deck, type Playlist } from './playlists.ts';
import { SEEDED_KEY } from './home.ts';

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
// The preview's placement asks the engine every frame; here it is only a box.
vi.mock('./preview.ts', () => ({ usePreview: () => true }));

const row = (key: string): LibraryRow => ({ key, path: `/p/${key}.milk`, hash: key, style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
const ROWS = ['a', 'b', 'c'].map(row);
const ENTRIES: Entry[] = ROWS.map((r) => ({ path: r.path, name: r.title, group: 'A' }));
const item = (r: LibraryRow) => ({ path: r.path, name: r.title, group: 'A', missing: false, hash: r.hash });

/** What `resume_state` answers: where the app picked up. */
let resume: Resume | null = null;
/** What the deck plays, and the playlists, as `playlists` answers. */
let deck: Deck = EMPTY_DECK;
let playlists: Playlist[] = [];

/** What the app's commands answer. */
function answer(cmd: string): unknown {
  if (cmd === 'library_index') return ROWS;
  if (cmd === 'library_data') return { version: 1, presets: {} };
  if (cmd === 'presets') return ENTRIES;
  if (cmd === 'playlists') return { playlists, deck };
  if (cmd === 'resume_state') return resume;
  if (cmd === 'stats') return { fps: 60, cpu_ms: 1 };
  if (cmd === 'open') return { preset: null, report: null };
  if (cmd === 'act') return { playlists, deck };
  if (cmd === 'levels') return [0, 0];
  if (['presets_failed', 'recently_played', 'settings_problems', 'audio_sources', 'inputs', 'deck_items'].includes(cmd)) return [];
  return null;
}

/** The commands sent, by name, with their arguments. */
const sent = (name: string) => invoke.mock.calls.filter(([cmd]) => cmd === name).map(([, args]) => args as Record<string, unknown>);
/** The deck's actions sent, by kind. */
const actions = () => sent('act').map((a) => (a.action as { kind: string }).kind);

async function mount(props: { start?: string | null; library?: boolean } = {}) {
  const r = render(<Home start={props.start ?? null} onMode={() => {}} library={props.library} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(0));
  return r;
}

const grid = () => screen.queryByRole('listbox', { name: 'presets' });

beforeEach(() => {
  vi.useFakeTimers();
  resume = null;
  deck = EMPTY_DECK;
  playlists = [];
  forgetResumedQuery(true);
  // The starter smart playlists were made on an earlier run: nothing is seeded here.
  localStorage.setItem(SEEDED_KEY, '1');
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(answer(cmd)));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('the home, the one place to browse', () => {
  it('offers Home and Live in the header, and no library view', async () => {
    await mount();
    const views = screen.getByRole('radiogroup', { name: 'view' });
    expect(
      within(views)
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['home', 'live']);
  });

  it('shows the big preview in its own cell, outside the main pane, so it covers neither the chips nor the strip', async () => {
    await mount({ library: true });
    const preview = screen.getByRole('img', { name: 'preview of the playing preset' });
    const stage = preview.closest('.home-stage');
    expect(stage).toBeTruthy();
    expect(screen.getByRole('main').contains(preview)).toBe(false);
    expect(stage!.contains(grid())).toBe(false);
  });

  it('opens on the library pane for VISUALS_VIEW=library, even with playlists', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    await mount({ library: true });
    expect(grid()).toBeTruthy();
  });

  it('opens on the first playlist otherwise, and on the library while the deck follows its filter', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    let r = await mount();
    expect(grid()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Warm up' })).toBeTruthy();
    r.unmount();
    deck = { ...EMPTY_DECK, current: ROWS[1].path, query: { groups: { style: ['A'] }, text: '' } };
    r = await mount();
    expect(grid()).toBeTruthy();
  });

  it('plays a preset chosen in the grid, and the deck follows the grid from it', async () => {
    await mount({ library: true, start: ROWS[0].path });
    const g = grid()!;
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    fireEvent.keyDown(g, { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toContain(ROWS[1].path);
    expect(sent('act').some((a) => (a.action as { kind: string; at?: string }).kind === 'query')).toBe(true);
  });

  it('plays a preset chosen in a playlist strip from there', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0]), item(ROWS[2])])];
    await mount();
    fireEvent.click(screen.getByRole('listitem', { name: '2. c' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('act').at(-1)).toEqual({ action: { kind: 'load', playlist: 0, index: 1 } });
  });
});

describe('← → and R on the home', () => {
  it('step the deck while it follows the grid', async () => {
    deck = { ...EMPTY_DECK, current: ROWS[0].path, query: { groups: {}, text: '' } };
    await mount({ library: true });
    invoke.mockClear();
    for (const key of ['ArrowRight', 'ArrowLeft', 'r']) fireEvent.keyDown(window, { key });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(actions()).toEqual(['next', 'previous', 'random']);
    expect(sent('open')).toEqual([]);
  });

  it('go through the library itself when nothing is followed', async () => {
    await mount({ library: true, start: ROWS[0].path });
    invoke.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path]);
  });

  it('leave the page alone while typing in the search', async () => {
    deck = { ...EMPTY_DECK, current: ROWS[0].path, query: { groups: {}, text: '' } };
    await mount({ library: true });
    invoke.mockClear();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'search presets' }), { key: 'r' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(actions()).toEqual([]);
  });
});

describe('picking up where the app left off', () => {
  it('names the preset put back without opening another', async () => {
    resume = { playlist: null, index: null, current: ROWS[2].path, source: null, query: null };
    deck = { ...EMPTY_DECK, current: ROWS[2].path };
    await mount();
    expect(sent('open')).toEqual([]);
    expect(screen.getByTitle('A / c')).toBeTruthy();
  });

  it('shows the filter it picked up in the library, with the deck following it', async () => {
    const query = { groups: { style: ['A'] }, text: 'b' };
    resume = { playlist: null, index: null, current: ROWS[1].path, source: null, query };
    deck = { ...EMPTY_DECK, current: ROWS[1].path, query };
    await mount();
    expect(screen.getByRole('button', { name: 'stop filtering by A' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'search presets' })).toHaveProperty('value', 'b');
  });
});

describe('the notice banner', () => {
  it('says when a preset could not be opened, and goes when dismissed', async () => {
    invoke.mockImplementation((cmd: string) => (cmd === 'open' ? Promise.reject(new Error('bad file')) : Promise.resolve(answer(cmd))));
    await mount({ library: true, start: ROWS[0].path });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't open a.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
