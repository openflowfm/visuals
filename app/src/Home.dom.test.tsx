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
import { Home, stripTip } from './Home.tsx';
import { forgetResumedQuery } from './library.ts';
import { EMPTY_DECK, manual, type Deck, type Playlist } from './playlists.ts';
import { PANEL_KEY, SEEDED_KEY } from './home.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A stylesheet next to this test, read from disk: vitest hands a test empty CSS for an import, even `?raw`. */
const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8');

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
  // A wide window, with the Now Playing panel beside the grid, unless a test says otherwise.
  (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1440, height: 900 });
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

  it('has only the mark, home | live and ⚙ in the header, and no key-hint footer', async () => {
    await mount({ library: true });
    const header = document.querySelector('.vf-header')!;
    expect(
      within(header as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['settings']);
    expect(header.querySelector('.audio-input')).toBeNull();
    expect(document.querySelector('.vf-footer')).toBeNull();
  });

  it('shows the big preview in the Now Playing panel, outside the main pane, and the bar takes a small one when the panel closes', async () => {
    await mount({ library: true });
    let preview = screen.getByRole('img', { name: 'preview of the playing preset' });
    expect(preview.closest('.now-panel')).toBeTruthy();
    expect(screen.getByRole('main').contains(preview)).toBe(false);
    const toggle = screen.getByRole('button', { name: 'now playing panel' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(document.querySelector('.now-panel')).toBeNull();
    // Still one preview, in the bar; clicking it opens the panel again.
    preview = screen.getByRole('img', { name: 'preview of the playing preset' });
    expect(preview.closest('.home-bar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
    expect(screen.getAllByRole('img', { name: 'preview of the playing preset' })).toHaveLength(1);
    expect(document.querySelector('.now-panel')).toBeTruthy();
    // Closed stays closed next time.
    fireEvent.click(screen.getByRole('button', { name: 'now playing panel' }));
    cleanup();
    await mount({ library: true });
    expect(document.querySelector('.now-panel')).toBeNull();
  });

  // happy-dom lays nothing out, so where things land is worked out from the
  // home's grid: each of `.app.home`'s cells by its computed grid-row and
  // grid-column (3 columns, 3 rows at most), and anything not displayed left out.
  const paints = (el: Element) => {
    const bg = getComputedStyle(el).backgroundColor;
    return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'none';
  };
  const shown = (el: Element | null): boolean => !el || (getComputedStyle(el).display !== 'none' && shown(el.parentElement));
  const span = (v: string): [number, number] => {
    const [a, b] = v.split('/').map((s) => s.trim());
    const start = Number(a) || 1;
    const end = b === undefined || b === '' || b === 'auto' ? start + 1 : Number(b) < 0 ? 4 + Number(b) + 1 : Number(b);
    return [start, end];
  };
  const area = (el: Element) => {
    const s = getComputedStyle(el);
    return { rows: span(s.gridRow || s.gridRowStart), cols: span(s.gridColumn || s.gridColumnStart) };
  };
  const meet = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
  const label = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}`;

  /** Whatever paints a background under the preview box: its ancestors, and anything in a grid cell that shares its place. */
  function paintedUnder(preview: Element): string[] {
    const painted: string[] = [];
    for (let el: Element | null = preview; el; el = el.parentElement) if (paints(el)) painted.push(`${label(el)} (holds it)`);
    const cells = [...document.querySelector('.app.home')!.children];
    const own = cells.find((c) => c.contains(preview))!;
    const at = area(own);
    for (const cell of cells) {
      if (cell === own || !shown(cell)) continue;
      const there = area(cell);
      if (!meet(there.rows, at.rows) || !meet(there.cols, at.cols)) continue;
      for (const el of [cell, ...cell.querySelectorAll('*')]) if (shown(el) && paints(el)) painted.push(`${label(el)} (shares its cell)`);
    }
    return painted;
  }

  // The preview is a hole: the native view the engine draws in sits under the
  // page, so a background on anything under the box covers the picture. Wide,
  // it is in the Now Playing panel, or in the bar with the panel closed; narrow,
  // in the bar, or in the panel, which then takes the main pane's place.
  it.each([
    [1440, true, '.now-panel'],
    [1440, false, '.home-bar'],
    [800, false, '.home-bar'],
    [800, true, '.now-panel'],
  ] as const)('paints nothing under the preview at %ipx, panel open: %s', async (width, open, where) => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });
    if (!open) localStorage.setItem(PANEL_KEY, '0');
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    // The theme's surfaces come from the widgets' stylesheet; any colour will do.
    const theme = ':root { --bg: rgb(1, 1, 1); --panel: rgb(2, 2, 2); --rail: rgb(3, 3, 3); --sel: rgb(4, 4, 4); --surface-control: rgb(5, 5, 5); }';
    const sheets = ['app.css', 'home.css', 'tile.css', 'nowpanel.css', 'homebar.css', 'library.css', 'sources.css', 'playlisthead.css', 'popover.css'];
    style.textContent = [theme, ...sheets.map(css)].join('\n');
    document.head.append(style);
    try {
      await mount({ library: true });
      if (width < 900 && open) fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
      const previews = screen.getAllByRole('img', { name: 'preview of the playing preset' });
      expect(previews).toHaveLength(1);
      expect(previews[0].closest(where)).toBeTruthy();
      expect(paintedUnder(previews[0])).toEqual([]);
    } finally {
      style.remove();
    }
  });

  it('would catch the main pane drawn under a narrow panel (the check itself)', async () => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 800, height: 900 });
    const style = document.createElement('style');
    // home.css without the rule that keeps the main pane out from under the panel.
    const home = css('home.css').replace(/\.app\.home\[data-panel\] main\.home-main \{\s*display: none;\s*\}/, '');
    expect(home).not.toBe(css('home.css'));
    style.textContent = [':root { --bg: rgb(1, 1, 1); }', css('app.css'), home].join('\n');
    document.head.append(style);
    try {
      await mount({ library: true });
      fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
      expect(paintedUnder(screen.getByRole('img', { name: 'preview of the playing preset' }))).toContain('main.home-main (shares its cell)');
    } finally {
      style.remove();
    }
  });

  it('puts focus back on the bar when the panel closes, and into the panel when the small preview opens it', async () => {
    await mount({ library: true });
    fireEvent.click(screen.getByRole('button', { name: 'close now playing' }));
    expect(document.querySelector('.now-panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'now playing panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'close now playing' }));
  });

  it('in a narrow window, closing the panel puts focus on the small preview that opens it again', async () => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 800, height: 900 });
    await mount({ library: true });
    fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'close now playing' }));
    fireEvent.click(screen.getByRole('button', { name: 'close now playing' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'show the now playing panel' }));
  });

  it('says how to play from and reorder a playlist over its strip', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0]), item(ROWS[2])])];
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    await mount();
    expect(document.querySelector('.home-strip-tip')!.textContent).toBe(stripTip(true));
  });

  it('keeps the filter chips behind "filter · n", open or closed as left', async () => {
    await mount({ library: true });
    expect(screen.queryByRole('group', { name: 'groups' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    expect(screen.getByRole('group', { name: 'groups' })).toBeTruthy();
    cleanup();
    await mount({ library: true });
    expect(screen.getByRole('group', { name: 'groups' })).toBeTruthy();
  });

  it('shows only the starred presets under Starred', async () => {
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'library_data' ? { version: 1, presets: { b: { star: true, hidden: false, tags: [] } } } : answer(cmd)));
    await mount({ library: true });
    fireEvent.click(screen.getByText('Starred'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('heading', { name: 'Starred' })).toBeTruthy();
    expect(
      within(grid()!)
        .getAllByRole('option')
        .map((o) => o.getAttribute('aria-label')?.split(' — ')[0]),
    ).toEqual(['b']);
  });

  it('opens on the library pane for VISUALS_VIEW=library, even with playlists', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    await mount({ library: true });
    expect(grid()).toBeTruthy();
  });

  it('opens on the library otherwise, and on the playlist playing', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    let r = await mount();
    expect(grid()).toBeTruthy();
    r.unmount();
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    r = await mount();
    expect(grid()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Warm up' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('listitem', { name: 'Warm up, playlist, 2 presets' }));
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
    // Named in the bottom bar and the Now Playing panel.
    expect(document.querySelector('.home-bar')!.textContent).toContain('c');
    expect(within(document.querySelector('.now-panel') as HTMLElement).getByRole('heading', { name: 'c' })).toBeTruthy();
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
