// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryData } from './api.ts';
import { Crate, FOLDS_KEY, readFolds } from './Crate.tsx';
import * as pl from './playlists.ts';

vi.mock('./playlists.ts', async (original) => ({ ...(await original<typeof import('./playlists.ts')>()), moveItem: vi.fn(), deckItems: vi.fn() }));

const item = (name: string): pl.Item => ({ path: `pack/${name}.milk`, name, group: 'pack', missing: false, hash: null });
const LIST = pl.manual('m', 'Set', ['a', 'b', 'c', 'd', 'e'].map(item));
const SMART: pl.Playlist = { ...pl.manual('s', 'Calm', []), kind: 'smart', query: { groups: { intensity: ['low'] }, text: '' } };
const lists = (deck: Partial<pl.Deck>): pl.Lists => ({ playlists: [LIST, SMART], deck: { ...pl.EMPTY_DECK, ...deck } });

const ROW = 40;

beforeEach(() => {
  vi.mocked(pl.moveItem).mockReset().mockResolvedValue(lists({}));
  vi.mocked(pl.deckItems).mockReset();
  // happy-dom lays nothing out: each up-next row is ROW tall, one under the other.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const at = this.tagName === 'LI' && this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
    return { top: at * ROW, height: ROW, bottom: (at + 1) * ROW, left: 0, right: 100, width: 100, x: 0, y: at * ROW, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const crate = (l: pl.Lists) => <Crate lists={l} data={null} act={() => {}} onLists={() => {}} onError={(e) => expect.unreachable(String(e))} current={l.deck.current} />;
const rowNames = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.classList.contains('scr-next'))
    .map((li) => li.getAttribute('aria-label'));
const handleOf = (name: string) => screen.getByRole('listitem', { name }).querySelector('.scr-handle') as HTMLElement;

describe('Up next in a DOM', () => {
  it('drops a dragged row where it was dropped, though auto-advance moved the deck mid-drag', () => {
    const view = render(crate(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 })));
    // b is the Next line; c, d, e follow.
    expect(rowNames()).toEqual(['c', 'd', 'e']);
    fireEvent.pointerDown(handleOf('d'), { button: 0, pointerId: 1, clientY: ROW * 1.5 });

    // Auto-advance: b plays, c is Next, and d is now the first row.
    view.rerender(crate(lists({ playlist: 'm', index: 1, current: 'pack/b.milk', next_index: 2 })));
    expect(rowNames()).toEqual(['d', 'e', 'a']);
    // Dropped under a, the last row: d goes after a in the playlist (from item 3 to item 1), not whatever row d's index held at the start.
    fireEvent.pointerUp(handleOf('d'), { button: 0, pointerId: 1, clientY: ROW * 3 + 5 });
    expect(pl.moveItem).toHaveBeenCalledTimes(1);
    expect(pl.moveItem).toHaveBeenCalledWith('m', 3, 1);
  });

  it('drops nothing when the dragged row became the Next line mid-drag', () => {
    const view = render(crate(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 })));
    fireEvent.pointerDown(handleOf('c'), { button: 0, pointerId: 1, clientY: ROW / 2 });
    view.rerender(crate(lists({ playlist: 'm', index: 1, current: 'pack/b.milk', next_index: 2 })));
    fireEvent.pointerUp(screen.getAllByRole('listitem', { name: 'd' })[0].querySelector('.scr-handle') as HTMLElement, { pointerId: 1, clientY: ROW * 3 });
    expect(pl.moveItem).not.toHaveBeenCalled();
  });

  it("asks for the play order once, not again each time the playing preset steps, and again once the deck's Next disagrees with it", async () => {
    vi.mocked(pl.deckItems).mockResolvedValue(['pack/a.milk', 'pack/b.milk', 'pack/c.milk', 'pack/d.milk']);
    const deck = { playlist: 's', count: 4 };
    const view = render(crate(lists({ ...deck, current: 'pack/a.milk', next: 'pack/b.milk' })));
    await waitFor(() => expect(rowNames()).toEqual(['c', 'd']));
    view.rerender(crate(lists({ ...deck, current: 'pack/b.milk', next: 'pack/c.milk' })));
    view.rerender(crate(lists({ ...deck, current: 'pack/c.milk', next: 'pack/d.milk' })));
    expect(rowNames()).toEqual(['a', 'b']);
    expect(pl.deckItems).toHaveBeenCalledTimes(1);

    // Loaded again, shuffled afresh: what the deck says is next isn't what follows in the order held.
    vi.mocked(pl.deckItems).mockResolvedValue(['pack/c.milk', 'pack/a.milk', 'pack/d.milk', 'pack/b.milk']);
    view.rerender(crate(lists({ ...deck, current: 'pack/c.milk', next: 'pack/a.milk' })));
    await waitFor(() => expect(rowNames()).toEqual(['d', 'b']));
    expect(pl.deckItems).toHaveBeenCalledTimes(2);
  });

  it('moves a row with Alt+↓ and keeps focus on it', async () => {
    const act = vi.fn();
    const onLists = vi.fn();
    render(
      <Crate
        lists={lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 })}
        data={null}
        act={act}
        onLists={onLists}
        onError={(e) => expect.unreachable(String(e))}
        current="pack/a.milk"
      />,
    );
    const c = screen.getByRole('listitem', { name: 'c' });
    c.focus();
    fireEvent.keyDown(c, { key: 'ArrowDown', altKey: true });
    // c (item 2) goes after d (item 3).
    expect(pl.moveItem).toHaveBeenCalledWith('m', 2, 3);
    await waitFor(() => expect(onLists).toHaveBeenCalled());
  });

  it('opens the rest behind "Show all", and folds them back with "Show fewer"', () => {
    const long = pl.manual('m', 'Set', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(item));
    render(crate({ playlists: [long], deck: { ...pl.EMPTY_DECK, playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 } }));
    expect(rowNames()).toEqual(['c', 'd', 'e', 'f']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(rowNames()).toEqual(['c', 'd', 'e', 'f', 'g', 'h']);
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(rowNames()).toHaveLength(4);
  });
});

describe('The crate in a DOM', () => {
  const DATA: LibraryData = { version: 1, presets: { x: { tags: ['warm', 'peak'] }, y: { tags: ['warm'] } } };
  const mount = (l: pl.Lists, act = vi.fn()) => {
    render(<Crate lists={l} data={DATA} act={act} onLists={() => {}} onError={(e) => expect.unreachable(String(e))} current={l.deck.current} />);
    return act;
  };

  it('plays a playlist picked, and marks the one playing as the pill', () => {
    const act = mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    expect(screen.getByRole('button', { name: 'Set, playing' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Calm, smart playlist' }));
    expect(act).toHaveBeenCalledWith({ kind: 'load', playlist: 1, index: null });
  });

  it('plays a mood, mixes another in, and takes a lit one out', () => {
    const act = mount(lists({}));
    expect(screen.getByRole('heading', { name: 'Moods' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'warm' }));
    expect(act).toHaveBeenLastCalledWith({ kind: 'query', query: { groups: { tags: ['warm'] }, text: '' } });
    cleanup();
    // A mood playing reads its play order for up next.
    vi.mocked(pl.deckItems).mockResolvedValue([]);
    const mixed = mount(lists({ query: { groups: { tags: ['warm'] }, text: '' }, current: 'pack/a.milk' }));
    expect(screen.getByRole('button', { name: 'warm' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'peak' }));
    expect(mixed).toHaveBeenLastCalledWith({ kind: 'query', query: { groups: { tags: ['warm', 'peak'] }, text: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'warm' }));
    expect(mixed).toHaveBeenLastCalledWith({ kind: 'unload' });
  });

  it('has one tab stop, the playlist playing, and walks with the arrows without live mode seeing them', () => {
    mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    const root = document.querySelector('.scr') as HTMLElement;
    const tabbable = [...root.querySelectorAll('[tabindex="0"]')];
    expect(tabbable).toEqual([screen.getByRole('button', { name: 'Set, playing' })]);
    const window_ = vi.fn();
    window.addEventListener('keydown', window_);
    try {
      const set = screen.getByRole('button', { name: 'Set, playing' });
      set.focus();
      fireEvent.keyDown(set, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Calm, smart playlist' }));
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Moods' }));
      fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
      // The last stop: the last up-next row that moves.
      expect(document.activeElement).toBe(screen.getByRole('listitem', { name: 'e' }));
      fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Playlists' }));
      expect(window_).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', window_);
    }
    // The stop walked to last is the one tab stop now.
    expect([...root.querySelectorAll('[tabindex="0"]')]).toEqual([screen.getByRole('button', { name: 'Playlists' })]);
  });

  it('folds a section with ← or a click on its heading, and unfolds it with →', () => {
    mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    const set = screen.getByRole('button', { name: 'Set, playing' });
    set.focus();
    fireEvent.keyDown(set, { key: 'ArrowLeft' });
    const heading = screen.getByRole('button', { name: 'Playlists' });
    expect(document.activeElement).toBe(heading);
    fireEvent.keyDown(heading, { key: 'ArrowLeft' });
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Set, playing' })).toBeNull();
    fireEvent.keyDown(heading, { key: 'ArrowRight' });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Up next' }));
    expect(screen.queryByRole('list', { name: 'Up next, in play order' })).toBeNull();
  });

  it('remembers the folded sections in local storage, and opens all when storage is blocked', () => {
    mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Up next' }));
    expect(JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? '')).toEqual(['next']);
    cleanup();
    mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    expect(screen.getByRole('button', { name: 'Up next' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Playlists' }).getAttribute('aria-expanded')).toBe('true');
    cleanup();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readFolds()).toEqual([]);
    mount(lists({ playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 }));
    expect(screen.getByRole('button', { name: 'Up next' }).getAttribute('aria-expanded')).toBe('true');
    vi.restoreAllMocks();
  });
});
