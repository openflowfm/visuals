// @vitest-environment happy-dom
//
// The home mounted in a DOM, with the app's commands and events faked. Since
// decision 70 it is an inspector view: the sidebar picks a source, the main
// column is the Now Playing hero over a plain grid of the source's presets, the
// inspector is about the presets picked (else the source), and the transport
// bar runs along the bottom. A click picks a tile, a double-click or Enter plays
// it, Esc goes back to the source; ←, → and R step the deck (#137) but leave the
// grid's own arrows alone; the preset the app put back stays (#161); and
// `VISUALS_VIEW=library` opens it on the library.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, LibraryRow, Resume } from './api.ts';
import { Home, stripTip } from './Home.tsx';
import { forgetResumedQuery } from './library.ts';
import { EMPTY_DECK, manual, type Deck, type Playlist } from './playlists.ts';
import { SEEDED_KEY } from './home.ts';
import { INSPECTOR_KEY, SIDEBAR_KEY } from './layout/home-model.ts';
import { INSPECTOR_ID, SIDEBAR_ID } from './layout/HomeLayout.tsx';
import { SHEET_EVENT, sheetOf } from './views.tsx';
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

const viewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });

async function mount(props: { start?: string | null; library?: boolean } = {}) {
  const r = render(<Home start={props.start ?? null} onMode={() => {}} library={props.library} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(0));
  return r;
}

const grid = () => screen.queryByRole('listbox', { name: 'presets' });
const tile = (name: string) => within(grid()!).getByRole('option', { name: new RegExp(`^${name} — `) });
const header = () => document.querySelector<HTMLElement>('.vf-header')!;
const inspector = () => document.querySelector('.insp');
/** A source's row in the sidebar (not its section's heading of the same name). */
const sourceRow = (name: string) =>
  within(document.querySelector('.lay-side') as HTMLElement)
    .getAllByRole('button', { name: new RegExp(`^${name}`) })
    .find((b) => b.classList.contains('isb-row'))!;

beforeEach(() => {
  // A wide window: the sidebar and the inspector docked, unless a test says otherwise.
  viewport(1440);
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

describe('the home, an inspector view (decision 70)', () => {
  it('offers Home and Live in the header, and no library view', async () => {
    await mount();
    const views = screen.getByRole('radiogroup', { name: 'view' });
    expect(
      within(views)
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['home', 'live']);
  });

  it('has the sidebar’s toggle, the search and Filter and the inspector’s toggle in the header, no ⚙, no mark and no key-hint footer', async () => {
    await mount({ library: true });
    const h = header();
    const buttons = within(h)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons[0]).toBe('sidebar');
    expect(buttons.at(-1)).toBe('info');
    expect(buttons).not.toContain('settings');
    expect(h.textContent).not.toContain('⚙');
    expect(h.querySelector('.vf-mark')).toBeNull();
    expect(buttons).toContain('filter');
    expect(within(h).getByRole('searchbox', { name: 'search presets' })).toBeTruthy();
    expect(document.querySelector('.vf-footer')).toBeNull();
  });

  it('shows the preview in the Now Playing hero, over the grid, and paints nothing under it', async () => {
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    const theme = ':root { --bg: rgb(1, 1, 1); --panel: rgb(2, 2, 2); --rail: rgb(3, 3, 3); --sel: rgb(4, 4, 4); --surface-control: rgb(5, 5, 5); }';
    const sheets = ['app.css', 'home.css', 'tile.css', 'library.css', 'popover.css', 'layout/layout.css', 'layout/hero.css', 'layout/transport-bar.css'];
    style.textContent = [theme, ...sheets.map(css)].join('\n');
    document.head.append(style);
    try {
      await mount({ library: true });
      const previews = screen.getAllByRole('img', { name: 'preview of the playing preset' });
      expect(previews).toHaveLength(1);
      expect(previews[0].closest('.hero')).toBeTruthy();
      expect(grid()!.contains(previews[0])).toBe(false);
      const paints = (el: Element) => {
        const bg = getComputedStyle(el).backgroundColor;
        return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'none';
      };
      const painted: string[] = [];
      for (let el: Element | null = previews[0]; el; el = el.parentElement) if (paints(el)) painted.push(`${el.tagName.toLowerCase()}.${el.className}`);
      expect(painted).toEqual([]);
    } finally {
      style.remove();
    }
  });

  it('opens Settings from the sidebar’s Settings row, as ⌘, does', async () => {
    await mount({ library: true });
    const asked: (string | null)[] = [];
    const heard = (e: Event) => asked.push(sheetOf(e));
    window.addEventListener(SHEET_EVENT, heard);
    try {
      fireEvent.click(within(document.querySelector('.lay-side') as HTMLElement).getByRole('button', { name: /Settings/ }));
      expect(asked).toEqual(['settings']);
    } finally {
      window.removeEventListener(SHEET_EVENT, heard);
    }
  });

  it('docks the inspector in a wide window, and keeps it closed once closed there', async () => {
    await mount({ library: true });
    expect(inspector()).toBeTruthy();
    const toggle = within(header()).getByRole('button', { name: 'info' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(inspector()).toBeNull();
    expect(localStorage.getItem(INSPECTOR_KEY)).toBe('0');
    cleanup();
    await mount({ library: true });
    expect(inspector()).toBeNull();
    // ⌘I opens it again.
    fireEvent.keyDown(window, { key: 'i', metaKey: true });
    expect(inspector()).toBeTruthy();
  });

  it('starts with the inspector closed under 1200 px, and opening it there is not kept', async () => {
    viewport(1000);
    localStorage.setItem(INSPECTOR_KEY, '1');
    await mount({ library: true });
    expect(inspector()).toBeNull();
    fireEvent.click(within(header()).getByRole('button', { name: 'info' }));
    expect(inspector()).toBeTruthy();
    expect(localStorage.getItem(INSPECTOR_KEY)).toBe('1');
  });

  it('shows or hides the sidebar with its toggle and ⌃⌘S, kept where it docks', async () => {
    await mount({ library: true });
    const toggle = within(header()).getByRole('button', { name: 'sidebar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 's', metaKey: true, ctrlKey: true });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('0');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the preset playing in the inspector; a ⌘-click picks one instead, and Esc goes back to the one playing', async () => {
    await mount({ library: true, start: ROWS[0].path });
    const insp = () => within(inspector() as HTMLElement);
    expect(insp().getByRole('heading', { name: 'a' })).toBeTruthy();
    expect(inspector()!.textContent).toContain('Now playing');
    invoke.mockClear();
    fireEvent.click(tile('b'), { metaKey: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open')).toEqual([]);
    expect(tile('b').getAttribute('aria-selected')).toBe('true');
    expect(insp().getByRole('heading', { name: 'b' })).toBeTruthy();
    fireEvent.click(tile('c'), { metaKey: true });
    expect(inspector()!.textContent).toContain('2 selected');
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(tile('b').getAttribute('aria-selected')).toBe('false');
    expect(insp().queryByRole('heading', { name: 'b' })).toBeNull();
    expect(insp().getByRole('heading', { name: 'a' })).toBeTruthy();
  });

  it('plays a preset on one click, the deck following the grid from it, and the inspector shows it playing', async () => {
    await mount({ library: true, start: ROWS[0].path });
    invoke.mockClear();
    fireEvent.click(tile('b'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path]);
    expect(sent('act').some((a) => (a.action as { kind: string }).kind === 'query')).toBe(true);
    expect(tile('b').getAttribute('aria-selected')).toBe('false');
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'b' })).toBeTruthy();
    expect(inspector()!.textContent).toContain('Now playing');
    // A double-click's second click doesn't open it again.
    invoke.mockClear();
    fireEvent.click(tile('c'), { detail: 1 });
    fireEvent.click(tile('c'), { detail: 2 });
    fireEvent.doubleClick(tile('c'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[2].path]);
  });

  it('shows the source’s card when its row is picked again, until Esc', async () => {
    await mount({ library: true, start: ROWS[0].path });
    fireEvent.click(sourceRow('Library'));
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'Library' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(inspector() as HTMLElement).queryByRole('heading', { name: 'Library' })).toBeNull();
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'a' })).toBeTruthy();
  });

  it('plays the preset highlighted in the grid on Enter', async () => {
    await mount({ library: true, start: ROWS[0].path });
    const g = grid()!;
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    fireEvent.keyDown(g, { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toContain(ROWS[1].path);
  });

  it('keeps the filter behind "Filter ▾" in the header', async () => {
    await mount({ library: true });
    expect(screen.queryByRole('group', { name: 'groups' })).toBeNull();
    fireEvent.click(within(header()).getByRole('button', { name: 'filter' }));
    expect(screen.getByRole('group', { name: 'groups' })).toBeTruthy();
  });

  it('puts focus in the search on ⌘F, opening the library from a playlist', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    await mount();
    expect(grid()).toBeNull();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(grid()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'search presets' }));
  });

  it('shows only the starred presets under Starred', async () => {
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'library_data' ? { version: 1, presets: { b: { star: true, hidden: false, tags: [] } } } : answer(cmd)));
    await mount({ library: true });
    fireEvent.click(within(document.querySelector('.lay-side') as HTMLElement).getByRole('button', { name: /^Starred/ }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(
      within(grid()!)
        .getAllByRole('option')
        .map((o) => o.getAttribute('aria-label')?.split(' — ')[0]),
    ).toEqual(['b']);
  });

  it('goes back to the source when the presets picked leave the index, with nothing playing', async () => {
    let rows = ROWS;
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'library_index' ? rows : answer(cmd)));
    // The app put back nothing playing, so the page opens nothing of its own.
    resume = { playlist: null, index: null, current: null, source: null, query: null };
    await mount({ library: true });
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'Library' })).toBeTruthy();
    fireEvent.click(tile('b'), { metaKey: true });
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'b' })).toBeTruthy();
    rows = [ROWS[0], ROWS[2]];
    act(() => heard.get('presets-changed')?.forEach((f) => f({ payload: null })));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(within(inspector() as HTMLElement).queryByRole('heading', { name: 'b' })).toBeNull();
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'Library' })).toBeTruthy();
  });

  it('names its panels on their toggles, and a toggle closes its panel laid over the grid', async () => {
    viewport(1000);
    await mount({ library: true });
    const toggle = within(header()).getByRole('button', { name: 'info' });
    expect(toggle.getAttribute('aria-controls')).toBe(INSPECTOR_ID);
    expect(within(header()).getByRole('button', { name: 'sidebar' }).getAttribute('aria-controls')).toBe(SIDEBAR_ID);
    fireEvent.click(toggle);
    expect(document.querySelector('.lay-insp-cell')?.getAttribute('data-mode')).toBe('overlay');
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(inspector()).toBeNull();
  });

  it('picks a tile pressed while the inspector is laid over the grid, and keeps the inspector open', async () => {
    viewport(1000);
    await mount({ library: true });
    fireEvent.click(within(header()).getByRole('button', { name: 'info' }));
    fireEvent.pointerDown(tile('b'));
    fireEvent.click(tile('b'), { metaKey: true });
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'b' })).toBeTruthy();
    // A press elsewhere still puts it away.
    fireEvent.pointerDown(header());
    expect(inspector()).toBeNull();
  });

  it('puts the sidebar laid over the grid away once a source is picked, focus back on its toggle', async () => {
    viewport(800);
    await mount({ library: true });
    const toggle = within(header()).getByRole('button', { name: 'sidebar' });
    toggle.focus();
    fireEvent.click(toggle);
    const side = document.querySelector<HTMLElement>('.lay-side')!;
    expect(side.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(side).getByRole('button', { name: /^Starred/ }));
    expect(document.querySelector('.lay-side')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('leaves ⌘I, ⌘F and ⌃⌘S to a sheet or dialog open over it', async () => {
    await mount({ library: true });
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    document.body.append(sheet);
    try {
      fireEvent.keyDown(window, { key: 'i', metaKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true, ctrlKey: true });
      fireEvent.keyDown(window, { key: 'f', metaKey: true });
      await act(() => vi.advanceTimersByTimeAsync(50));
      expect(inspector()).toBeTruthy();
      expect(within(header()).getByRole('button', { name: 'sidebar' }).getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).not.toBe(screen.getByRole('searchbox', { name: 'search presets' }));
    } finally {
      sheet.remove();
    }
  });

  it('opens on the library for VISUALS_VIEW=library, even with playlists', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
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
    expect(screen.getByRole('list', { name: 'Warm up, in the order it plays' })).toBeTruthy();
  });
});

describe('a playlist’s grid', () => {
  beforeEach(() => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0]), item(ROWS[2])])];
  });

  it('says how to pick, play and reorder it in its tooltip, not a line over it', async () => {
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    await mount();
    const list = screen.getByRole('list', { name: 'Warm up, in the order it plays' });
    expect(list.getAttribute('title')).toBe(stripTip(true));
    expect(list.getAttribute('data-hint')).toBe(stripTip(true));
    expect(document.querySelector('.home-strip-tip')).toBeNull();
  });

  it('picks a tile with a ⌘-click, and plays from a tile on one click, letting the picks go', async () => {
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    resume = { playlist: null, index: null, current: ROWS[0].path, source: null, query: null };
    await mount();
    invoke.mockClear();
    const second = screen.getByRole('listitem', { name: '2. c' });
    fireEvent.click(second, { metaKey: true });
    expect(screen.getByRole('listitem', { name: '2. c, picked' })).toBe(second);
    expect(sent('act')).toEqual([]);
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'c' })).toBeTruthy();
    fireEvent.click(second);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('act').at(-1)).toEqual({ action: { kind: 'go', index: 1 } });
    expect(second.hasAttribute('data-picked')).toBe(false);
  });

  it('lets go of the picks on Enter as on a click, and plays from that tile', async () => {
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    resume = { playlist: null, index: null, current: ROWS[0].path, source: null, query: null };
    await mount();
    const first = screen.getByRole('listitem', { name: '1. a, playing' });
    const second = screen.getByRole('listitem', { name: '2. c' });
    fireEvent.click(first, { metaKey: true });
    invoke.mockClear();
    fireEvent.keyDown(second, { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('act').at(-1)).toEqual({ action: { kind: 'go', index: 1 } });
    expect(first.hasAttribute('data-picked')).toBe(false);
  });

  it('shows the playlist’s card in the inspector for its row menu’s Show info, until Esc', async () => {
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    resume = { playlist: null, index: null, current: ROWS[0].path, source: null, query: null };
    await mount({ library: true });
    fireEvent.contextMenu(sourceRow('Warm up'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show info' }));
    expect(screen.getByRole('list', { name: 'Warm up, in the order it plays' })).toBeTruthy();
    expect(within(inspector() as HTMLElement).queryByRole('heading', { name: 'a' })).toBeNull();
    expect(inspector()!.textContent).toContain('Warm up');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'a' })).toBeTruthy();
  });

  it('shows the playlist’s card in the inspector when its row is picked again, until something is picked', async () => {
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    resume = { playlist: null, index: null, current: ROWS[0].path, source: null, query: null };
    await mount();
    const insp = () => within(inspector() as HTMLElement);
    expect(insp().getByRole('heading', { name: 'a' })).toBeTruthy();
    fireEvent.click(within(document.querySelector('.lay-side') as HTMLElement).getByRole('button', { name: /^Warm up/ }));
    expect(insp().queryByRole('heading', { name: 'a' })).toBeNull();
    expect(inspector()!.textContent).toContain('Warm up');
    fireEvent.click(screen.getByRole('listitem', { name: /^2\. c/ }), { metaKey: true });
    expect(insp().getByRole('heading', { name: 'c' })).toBeTruthy();
  });

  it('loads the playlist from the tile when it isn’t the one playing', async () => {
    await mount();
    fireEvent.click(within(document.querySelector('.lay-side') as HTMLElement).getByRole('button', { name: /^Warm up/ }));
    fireEvent.keyDown(screen.getByRole('listitem', { name: '2. c' }), { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('act').at(-1)).toEqual({ action: { kind: 'load', playlist: 0, index: 1 } });
  });

  it('keeps the pick on the preset as it moves (⌥→), and the inspector’s Play plays that tile', async () => {
    const moved = [manual('1', 'Warm up', [item(ROWS[2]), item(ROWS[0])])];
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'playlist_move_item' ? { playlists: moved, deck } : answer(cmd)));
    deck = { ...EMPTY_DECK, playlist: '1', index: 1, current: ROWS[2].path };
    // The app put the deck back (as it does when a playlist plays), so the page opens no random preset of its own.
    resume = { playlist: null, index: null, current: ROWS[2].path, source: null, query: null };
    await mount();
    fireEvent.click(screen.getByRole('listitem', { name: /^1\. a/ }), { metaKey: true });
    fireEvent.keyDown(screen.getByRole('listitem', { name: /^1\. a/ }), { key: 'ArrowRight', altKey: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('playlist_move_item')).toEqual([{ id: '1', from: 0, to: 1 }]);
    // a is second now, and still the one picked; c, now first, isn't.
    expect(screen.getByRole('listitem', { name: /^2\. a.*picked$/ })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /^1\. c/ }).hasAttribute('data-picked')).toBe(false);
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'a' })).toBeTruthy();
    invoke.mockClear();
    fireEvent.click(within(inspector() as HTMLElement).getByRole('button', { name: 'play it' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('act').at(-1)).toEqual({ action: { kind: 'go', index: 1 } });
  });

  it('lets go of a tile taken out (✕), and the inspector shows the preset playing again, not a blank', async () => {
    const left = [manual('1', 'Warm up', [item(ROWS[0])])];
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'playlist_remove' ? { playlists: left, deck } : answer(cmd)));
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    resume = { playlist: null, index: null, current: ROWS[0].path, source: null, query: null };
    await mount();
    fireEvent.click(screen.getByRole('listitem', { name: /^2\. c/ }), { metaKey: true });
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'c' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take c out of Warm up' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('listitem', { name: /^2\./ })).toBeNull();
    expect(within(inspector() as HTMLElement).queryByRole('heading', { name: 'c' })).toBeNull();
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'a' })).toBeTruthy();
  });

  it('shows the shared tile, with the name, the author line, its place and the playing mark', async () => {
    const rows = [{ ...ROWS[0], authors: ['geiss', 'flexi'] }, ROWS[1], ROWS[2]];
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'library_index' ? rows : answer(cmd)));
    deck = { ...EMPTY_DECK, playlist: '1', index: 0, current: ROWS[0].path };
    await mount();
    const [first, second] = [...document.querySelectorAll('.home-grid > li.tile')];
    expect(first.querySelector('.tile-name')!.textContent).toBe('a');
    expect(first.querySelector('.tile-by')!.textContent).toBe('geiss & flexi');
    expect(first.hasAttribute('data-playing')).toBe(true);
    expect(first.querySelector('.home-tile-n')!.textContent).toBe('1');
    expect(second.hasAttribute('data-playing')).toBe(false);
  });
});

describe('quick add (#194)', () => {
  beforeEach(() => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0])])];
    // Nothing playing, so the inspector shows the playlist's card with its "Add presets".
    resume = { playlist: null, index: null, current: null, source: null, query: null };
    invoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      const list = playlists[0];
      if (cmd === 'playlist_add') {
        const r = ROWS.find((x) => x.path === args.path)!;
        playlists = [{ ...list, items: [...list.items, item(r)] } as Playlist];
        return Promise.resolve({ playlists, deck });
      }
      if (cmd === 'playlist_remove') {
        playlists = [{ ...list, items: list.items.filter((_, i) => i !== args.index) } as Playlist];
        return Promise.resolve({ playlists, deck });
      }
      return Promise.resolve(answer(cmd));
    });
  });

  const side = () => within(document.querySelector('.lay-side') as HTMLElement);
  const strip = () => document.querySelector<HTMLElement>('.home-quickadd');
  async function start() {
    await mount();
    fireEvent.click(side().getByRole('button', { name: /^Warm up/ }));
    fireEvent.click(within(inspector() as HTMLElement).getByRole('button', { name: 'Add presets' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
  }

  it('starts from the playlist’s Add presets: the library, with a strip naming the playlist and ✓ on what it holds', async () => {
    await start();
    expect(grid()).toBeTruthy();
    expect(strip()!.textContent).toBe('Adding to “Warm up”·1 presetDone');
    expect(tile('a').hasAttribute('data-added')).toBe(true);
    expect(tile('b').hasAttribute('data-added')).toBe(false);
    // The tiles' + is off while a click adds.
    expect(grid()!.querySelector('.tile-add')).toBeNull();
  });

  it('adds a preset on a click, and takes out one already in on a click on its ✓, opening nothing', async () => {
    await start();
    invoke.mockClear();
    fireEvent.click(tile('b'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('playlist_add')).toEqual([{ id: '1', path: ROWS[1].path, at: null }]);
    expect(tile('b').hasAttribute('data-added')).toBe(true);
    expect(strip()!.textContent).toContain('2 presets');
    fireEvent.click(tile('a'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('playlist_remove')).toEqual([{ id: '1', index: 0 }]);
    expect(tile('a').hasAttribute('data-added')).toBe(false);
    expect(sent('open')).toEqual([]);
  });

  it('takes out two presets clicked quickly by where each is once the first is answered, one listed twice too', async () => {
    playlists = [manual('1', 'Warm up', [item(ROWS[0]), item(ROWS[1]), item(ROWS[2]), item(ROWS[0])])];
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((cmd: string, args: Record<string, unknown>) => (cmd === 'playlist_remove' ? new Promise((done) => setTimeout(() => done(base(cmd, args)), 50)) : base(cmd, args)));
    await start();
    invoke.mockClear();
    fireEvent.click(tile('a'));
    fireEvent.click(tile('c'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(sent('playlist_remove')).toEqual([
      { id: '1', index: 0 },
      { id: '1', index: 1 },
    ]);
    expect(playlists[0].items.map((i) => i.path)).toEqual([ROWS[1].path, ROWS[0].path]);
    expect(tile('c').hasAttribute('data-added')).toBe(false);
  });

  it('stays on when the Library row is clicked, and ends when another source is picked', async () => {
    await start();
    fireEvent.click(sourceRow('Library'));
    expect(strip()).toBeTruthy();
    fireEvent.click(sourceRow('Warm up'));
    expect(strip()).toBeNull();
  });

  it('plays on ⌥-click or Space instead', async () => {
    await start();
    invoke.mockClear();
    fireEvent.click(tile('b'), { altKey: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path]);
    const g = grid()!;
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    fireEvent.keyDown(g, { key: ' ' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path, ROWS[2].path]);
    expect(sent('playlist_add')).toEqual([]);
  });

  it('ends on Done or Esc, back on the playlist; a click plays again', async () => {
    await start();
    fireEvent.click(within(strip()!).getByRole('button', { name: 'Done' }));
    expect(strip()).toBeNull();
    expect(screen.getByRole('list', { name: 'Warm up, in the order it plays' })).toBeTruthy();
    fireEvent.click(within(inspector() as HTMLElement).getByRole('button', { name: 'Add presets' }));
    expect(strip()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(strip()).toBeNull();
    expect(screen.getByRole('list', { name: 'Warm up, in the order it plays' })).toBeTruthy();
    fireEvent.click(sourceRow('Library'));
    invoke.mockClear();
    fireEvent.click(tile('b'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path]);
    expect(sent('playlist_add')).toEqual([]);
  });

  it('starts from the playlist’s row menu in the sidebar too', async () => {
    resume = { playlist: null, index: null, current: ROWS[2].path, source: null, query: null };
    await mount();
    fireEvent.contextMenu(sourceRow('Warm up'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quick add' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(strip()!.textContent).toContain('Warm up');
    expect(grid()).toBeTruthy();
  });

  it('ends when the playlist is deleted', async () => {
    await start();
    act(() => heard.get('lists')?.forEach((f) => f({ payload: { playlists: [], deck } })));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(strip()).toBeNull();
    expect(grid()).toBeTruthy();
    invoke.mockClear();
    fireEvent.click(tile('b'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent('open').map((a) => a.path)).toEqual([ROWS[1].path]);
  });
});

describe('the library grid on the home (decision 68)', () => {
  it.each([
    [1440, '8px 22px 22px'],
    [1000, '8px 16px 22px'],
  ] as const)('lays out at %ipx on the main column’s padding (%s), 12 px across and 16 px down', async (width, padding) => {
    viewport(width);
    const style = document.createElement('style');
    style.textContent = [':root { --bg: rgb(1, 1, 1); }', css('home.css'), css('tile.css')].join('\n');
    document.head.append(style);
    try {
      await mount({ library: true });
      const win = document.querySelector<HTMLElement>('.lib-grid-window')!;
      expect(win.style.padding).toBe(padding);
      expect(win.style.gap).toBe('16px 12px');
      expect(grid()!.querySelector('.tile .tile-pic')).toBeTruthy();
    } finally {
      style.remove();
    }
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

  it('leave the grid’s own arrows, and the search, alone', async () => {
    deck = { ...EMPTY_DECK, current: ROWS[0].path, query: { groups: {}, text: '' } };
    await mount({ library: true });
    invoke.mockClear();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'search presets' }), { key: 'r' });
    const g = grid()!;
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    fireEvent.keyDown(document.querySelector('.lay-side button')!, { key: 'ArrowLeft' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(actions()).toEqual([]);
  });
});

describe('the transport bar', () => {
  it('runs the time line while the deck moves on by itself, and blanks it while held', async () => {
    deck = { ...EMPTY_DECK, auto: true, seconds: 30, current: ROWS[0].path };
    await mount({ library: true, start: ROWS[0].path });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    const bar = screen.getByRole('progressbar', { name: 'time on this preset' });
    expect(bar.getAttribute('aria-valuemax')).toBe('30');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(2);
    act(() => heard.get('live')?.forEach((f) => f({ payload: { deck: { ...deck, hold: true }, opened: null, path: ROWS[0].path, error: null } })));
    expect(screen.queryByRole('progressbar', { name: 'time on this preset' })).toBeNull();
    // Held, the time on it still counts, with no end.
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^time on this preset: \d+:\d\d, until moved on$/);
  });

  it('names the preset playing', async () => {
    resume = { playlist: null, index: null, current: ROWS[2].path, source: null, query: null };
    deck = { ...EMPTY_DECK, current: ROWS[2].path };
    await mount();
    expect(document.querySelector('.lay-transport-name')!.textContent).toBe('c');
  });
});

describe('the hero (decision 71)', () => {
  it('is the picture alone; the inspector names a preset playing that the index doesn’t list', async () => {
    await mount({ library: true });
    act(() => heard.get('live')?.forEach((f) => f({ payload: { deck: { ...EMPTY_DECK, current: '/elsewhere/Odd one.milk' }, opened: null, path: '/elsewhere/Odd one.milk', error: null } })));
    expect(document.querySelector('.hero .hero-info')).toBeNull();
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'Odd one' })).toBeTruthy();
  });
});

describe('picking up where the app left off', () => {
  it('names the preset put back in the inspector without opening another', async () => {
    resume = { playlist: null, index: null, current: ROWS[2].path, source: null, query: null };
    deck = { ...EMPTY_DECK, current: ROWS[2].path };
    await mount();
    expect(sent('open')).toEqual([]);
    expect(within(inspector() as HTMLElement).getByRole('heading', { name: 'c' })).toBeTruthy();
  });

  it('shows the filter it picked up in the library, with the deck following it', async () => {
    const query = { groups: { style: ['A'] }, text: 'b' };
    resume = { playlist: null, index: null, current: ROWS[1].path, source: null, query };
    deck = { ...EMPTY_DECK, current: ROWS[1].path, query };
    await mount();
    expect(screen.getByRole('searchbox', { name: 'search presets' })).toHaveProperty('value', 'b');
    fireEvent.click(within(header()).getByRole('button', { name: 'filter' }));
    expect(screen.getByRole('button', { name: 'stop filtering by A' })).toBeTruthy();
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
