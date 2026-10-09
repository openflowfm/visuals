// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Crate } from './Crate.tsx';
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
});

const crate = (l: pl.Lists) => <Crate lists={l} data={null} act={() => {}} onLists={() => {}} onError={(e) => expect.unreachable(String(e))} current={l.deck.current} />;
const rowNames = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.classList.contains('live-crate-row'))
    .map((li) => li.getAttribute('aria-label'));
const handleOf = (name: string) => screen.getByRole('listitem', { name }).querySelector('.live-crate-handle') as HTMLElement;

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
    fireEvent.pointerUp(screen.getAllByRole('listitem', { name: 'd' })[0].querySelector('.live-crate-handle') as HTMLElement, { pointerId: 1, clientY: ROW * 3 });
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
});
