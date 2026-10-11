// @vitest-environment happy-dom
//
// A tile's context menu on the home, mounted in a DOM with the app's commands
// faked: it opens on a right-click (or ⌃-click) and on the context-menu key or
// ⇧F10, leads with the inspector's header actions in its order, acts through
// the handlers Home hands the inspector, acts on every tile picked when opened
// on one of them, and in a playlist's grid takes tiles out. The playlist's
// tiles move under the pointer as the library's do.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LibraryRow, Mine } from './api.ts';
import { LibraryGrid } from './LibraryGrid.tsx';
import { PlaylistPane } from './Home.tsx';
import { strip } from './home.ts';
import { prepareRow } from './librarySearch.ts';
import { EMPTY_DECK, manual, type Playlist } from './playlists.ts';
import { HOVER_DWELL_MS } from './previews.ts';
import { menuChosen, opensMenu, removeItems, TileMenuContext, type TileMenuActions } from './TileMenu.tsx';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const row = (key: string): LibraryRow => ({
  key,
  path: `/p/${key}.milk`,
  hash: key,
  style: 'Hypnotic',
  sub_style: null,
  authors: ['geiss'],
  title: key,
  thumbnail: `thumb:${key}`,
  look: null,
  starter: false,
});
// Bloom is starred already.
const ROWS = ['Aurora', 'Bloom', 'Coil'].map((k) => prepareRow(row(k), k === 'Bloom' ? ({ star: true } as Mine) : undefined));
const LISTS: Playlist[] = [
  manual(
    'warm',
    'Warm up',
    ROWS.map((p) => ({ path: p.row.path, name: p.title, group: 'Hypnotic', missing: false, hash: p.row.hash })),
  ),
  manual('late', 'Late', []),
];

let actions: { playlists: TileMenuActions['playlists']; onSet: Mock<TileMenuActions['onSet']>; onAddTo: Mock<TileMenuActions['onAddTo']> };

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'presets_failed' ? [] : cmd === 'hover_preview' ? 1 : cmd === 'hover_frame' ? new ArrayBuffer(0) : null));
  actions = { playlists: LISTS, onSet: vi.fn(), onAddTo: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function grid(selected: string[] = [], onPick = vi.fn()) {
  const noop = () => {};
  const view = render(
    <div className="app home">
      <TileMenuContext.Provider value={actions}>
        <LibraryGrid rows={ROWS} active={1} selected={new Set(selected)} current={null} into={null} onMove={noop} onPick={onPick} onAdd={noop} onClear={noop} reveal={0} home />
      </TileMenuContext.Provider>
    </div>,
  );
  return { ...view, onPick };
}

const tile = (c: HTMLElement, name: string) => [...c.querySelectorAll<HTMLElement>('.tile')].find((t) => t.querySelector('.tile-name')?.textContent === name)!;
const menu = () => screen.getByRole('menu');
const items = () => [...menu().querySelectorAll(':scope > [role^="menuitem"]')].map((b) => b.textContent);

describe('a library tile’s menu', () => {
  it('opens on a right-click with the inspector’s actions in its order, Never set apart', () => {
    const { container } = grid();
    fireEvent.contextMenu(tile(container, 'Aurora'), { clientX: 40, clientY: 50 });
    expect(items()).toEqual(['Play', 'Star', 'Add to playlist', 'Never play']);
    // Never comes after a rule.
    const kids = [...menu().children];
    expect(kids[kids.length - 2].getAttribute('role')).toBe('separator');
    expect(menu().style.left).toBe('40px');
    expect(tile(container, 'Aurora').hasAttribute('data-menu')).toBe(true);
    // Its first action has focus, for the keyboard.
    expect(document.activeElement?.textContent).toBe('Play');
  });

  it('opens on a ⌃-click without picking the tile as ⌘-click does', () => {
    const { container, onPick } = grid();
    const aurora = tile(container, 'Aurora');
    fireEvent.contextMenu(aurora, { ctrlKey: true });
    fireEvent.click(aurora, { ctrlKey: true });
    expect(menu()).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens from the keyboard on the highlighted tile: the context-menu key, or ⇧F10', () => {
    const { container } = grid();
    const list = container.querySelector<HTMLElement>('.lib-grid')!;
    fireEvent.keyDown(list, { key: 'ContextMenu' });
    expect(tile(container, 'Bloom').hasAttribute('data-menu')).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(list, { key: 'F10', shiftKey: true });
    expect(menu()).toBeTruthy();
    // Arrows move through the actions.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Take the star off');
  });

  it('acts through the inspector’s handlers: Play plays as a click does, Star and Never set, a playlist adds', () => {
    const { container, onPick } = grid();
    fireEvent.contextMenu(tile(container, 'Aurora'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Play/ }));
    expect(onPick).toHaveBeenCalledWith(0, 'load');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(tile(container, 'Bloom'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /star/i }));
    expect(actions.onSet).toHaveBeenLastCalledWith(['Bloom'], { star: false });

    fireEvent.contextMenu(tile(container, 'Coil'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Never play/ }));
    expect(actions.onSet).toHaveBeenLastCalledWith(['Coil'], { hidden: true });

    fireEvent.contextMenu(tile(container, 'Coil'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to playlist/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Late' }));
    expect(actions.onAddTo).toHaveBeenCalledWith('late', ['/p/Coil.milk']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('acts on every tile picked when opened on one of several; Play then waits for one', () => {
    const { container } = grid(['Aurora', 'Bloom']);
    fireEvent.contextMenu(tile(container, 'Bloom'));
    expect(menu().getAttribute('aria-label')).toBe('2 presets');
    expect(screen.getByRole('menuitem', { name: /Play/ })).toHaveProperty('disabled', true);
    // Only some are starred: mixed, and Star stars them all.
    const star = screen.getByRole('menuitemcheckbox', { name: /star/i });
    expect(star.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(star);
    expect(actions.onSet).toHaveBeenLastCalledWith(['Aurora', 'Bloom'], { star: true });
    // Opened on a tile not picked: on it alone.
    fireEvent.contextMenu(tile(container, 'Coil'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Never play/ }));
    expect(actions.onSet).toHaveBeenLastCalledWith(['Coil'], { hidden: true });
  });

  it('closes on a press outside, and isn’t there without Home’s actions (the lab’s column)', () => {
    const { container } = grid();
    fireEvent.contextMenu(tile(container, 'Aurora'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
    const noop = () => {};
    const bare = render(
      <div className="app home">
        <LibraryGrid rows={ROWS} active={0} selected={new Set()} current={null} into={null} onMove={noop} onPick={noop} onAdd={noop} onClear={noop} reveal={0} home />
      </div>,
    );
    fireEvent.contextMenu(tile(bare.container, 'Aurora'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('a playlist tile’s menu', () => {
  function pane(picked: string[] = [], onPlay = vi.fn(), list: Playlist = LISTS[0], pickAll = false) {
    const ui = (l: Playlist) => {
      const { tiles, total } = strip(l, { rows: ROWS, played: [], playing: null });
      const keys = pickAll ? tiles.map((t) => t.key) : picked.map((name) => tiles.find((t) => t.name === name)!.key);
      return (
        <div className="app home">
          <TileMenuContext.Provider value={actions}>
            <PlaylistPane
              list={l}
              lists={{ playlists: LISTS, deck: EMPTY_DECK }}
              tiles={tiles}
              total={total}
              rows={ROWS}
              dropping={{ accepts: () => false, onDrop: () => {} }}
              picked={keys}
              onPick={() => {}}
              onPlay={onPlay}
              onLists={() => {}}
              onError={() => () => {}}
              onLibrary={() => {}}
            />
          </TileMenuContext.Provider>
        </div>
      );
    };
    const view = render(ui(list));
    return { ...view, onPlay, show: (l: Playlist) => view.rerender(ui(l)) };
  }

  it('counts a preset in the playlist twice once, but takes out each place', async () => {
    const twice = manual(
      'twice',
      'Twice',
      [ROWS[0], ROWS[1], ROWS[0]].map((p) => ({ path: p.row.path, name: p.title, group: 'Hypnotic', missing: false, hash: p.row.hash })),
    );
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'playlist_remove' ? { playlists: LISTS, deck: EMPTY_DECK } : null));
    const { container } = pane([], vi.fn(), twice, true);
    fireEvent.contextMenu(tile(container, 'Bloom'));
    expect(menu().getAttribute('aria-label')).toBe('2 presets');
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to playlist/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Late' }));
    expect(actions.onAddTo).toHaveBeenCalledWith('late', ['/p/Aurora.milk', '/p/Bloom.milk']);
    fireEvent.contextMenu(tile(container, 'Bloom'));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Twice' })));
    const removes = invoke.mock.calls.filter(([c]) => c === 'playlist_remove').map(([, a]) => (a as { index: number }).index);
    expect(removes).toEqual([2, 1, 0]);
  });

  it('closes when its tile goes, and doesn’t come back when the tiles do', () => {
    const { container, show } = pane();
    fireEvent.contextMenu(tile(container, 'Coil'));
    expect(menu()).toBeTruthy();
    show(manual('warm', 'Warm up', []));
    expect(screen.queryByRole('menu')).toBeNull();
    show(LISTS[0]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a wheel or a scroll of the page', () => {
    const { container } = pane();
    fireEvent.contextMenu(tile(container, 'Coil'));
    fireEvent.wheel(container);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(tile(container, 'Coil'));
    fireEvent.scroll(document);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape, giving focus back, and arrows walk its actions round', () => {
    const { container } = pane();
    const aurora = tile(container, 'Aurora');
    aurora.focus();
    fireEvent.keyDown(aurora, { key: 'ContextMenu' });
    expect(document.activeElement?.textContent).toBe('Play');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Star');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toContain('Remove from Warm up');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Play');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toContain('Remove from Warm up');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(aurora);
  });

  it('starts no hover preview during a drag, here or in the library’s grid', () => {
    document.body.dataset.dragging = '';
    try {
      const { container } = pane();
      fireEvent.mouseEnter(tile(container, 'Coil'));
      expect(container.querySelector('canvas.tile-motion')).toBeNull();
      cleanup();
      const g = grid();
      fireEvent.mouseEnter(tile(g.container, 'Coil'));
      expect(g.container.querySelector('canvas.tile-motion')).toBeNull();
    } finally {
      delete document.body.dataset.dragging;
    }
  });

  it('ends with Remove from the playlist, which takes the tiles out, the last place first', async () => {
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'playlist_remove' ? { playlists: LISTS, deck: EMPTY_DECK } : null));
    const { container } = pane(['Aurora', 'Coil']);
    fireEvent.contextMenu(tile(container, 'Coil'));
    expect(items()).toEqual(['Play', 'Star', 'Add to playlist', 'Never play', 'Remove from Warm up']);
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Warm up' })));
    const removes = invoke.mock.calls.filter(([c]) => c === 'playlist_remove').map(([, a]) => (a as { index: number }).index);
    expect(removes).toEqual([2, 0]);
  });

  it('opens from the keyboard on a focused tile, and Play plays from that place', () => {
    const { container, onPlay } = pane();
    const bloom = tile(container, 'Bloom');
    bloom.focus();
    fireEvent.keyDown(bloom, { key: 'ContextMenu' });
    fireEvent.click(screen.getByRole('menuitem', { name: /Play/ }));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ path: '/p/Bloom.milk', index: 1 }));
    // Esc gives focus back to the tile.
    fireEvent.keyDown(bloom, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(bloom);
  });

  it('moves the tile the pointer rests on, as the library’s grid does', async () => {
    vi.useFakeTimers();
    const { container } = pane();
    const coil = tile(container, 'Coil');
    fireEvent.mouseEnter(coil);
    expect(coil.querySelector('canvas.tile-motion')).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 10)));
    expect(invoke.mock.calls.filter(([c]) => c === 'hover_preview').map(([, a]) => (a as { path: string }).path)).toEqual(['/p/Coil.milk']);
    fireEvent.mouseLeave(coil);
    expect(coil.querySelector('canvas.tile-motion')).toBeNull();
  });
});

describe('the menu’s rules', () => {
  it('opens on the context-menu key or ⇧F10 only', () => {
    expect(opensMenu({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(opensMenu({ key: 'F10', shiftKey: true })).toBe(true);
    expect(opensMenu({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('acts on all picked only when opened on one of several', () => {
    const all = ['a', 'b', 'c'];
    expect(menuChosen('b', new Set(['a', 'b']), all, (k) => k)).toEqual(['a', 'b']);
    expect(menuChosen('c', new Set(['a', 'b']), all, (k) => k)).toEqual(['c']);
    expect(menuChosen('a', new Set(['a']), all, (k) => k)).toEqual(['a']);
  });

  it('takes places out the last first, each once', async () => {
    await removeItems('x', [1, 4, 1, 2]);
    expect(invoke.mock.calls.map(([, a]) => (a as { index: number }).index)).toEqual([4, 2, 1]);
  });
});
