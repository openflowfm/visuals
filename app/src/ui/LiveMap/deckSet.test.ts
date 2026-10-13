import { describe, expect, it } from 'vitest';
import type { LibraryQuery } from '../model/api';
import { EMPTY_DECK, manual, type Deck, type Item, type Playlist } from '../model/playlists';
import { deckScope, deckSetKey, shownSet } from './deckSet';

describe('shownSet', () => {
  const readA = { key: 'k1', scope: deckScope({ ...EMPTY_DECK, playlist: 'a' }), paths: ['a.milk'] };

  it('keeps the last set while the same playlist reads again', () => {
    expect(shownSet(readA, 'k2', deckScope({ ...EMPTY_DECK, playlist: 'a' })).paths).toEqual(['a.milk']);
  });

  it('shows none of the old set after a switch to another playlist', () => {
    expect(shownSet(readA, 'k3', deckScope({ ...EMPTY_DECK, playlist: 'b' }))).toEqual({ paths: null, failed: false });
  });
});

const item = (path: string, hash: string | null = null): Item => ({ path, name: path, group: '', missing: false, hash });
const QUERY: LibraryQuery = { groups: { star: ['yes'] }, text: '' };
const list = manual('warm', 'Warm-up', [item('a.milk', 'h1'), item('b.milk', 'h2')]);
const smart: Playlist = { ...manual('stars', 'Stars', []), kind: 'smart', query: QUERY };
const playing = (playlist: string | null, more: Partial<Deck> = {}): Deck => ({ ...EMPTY_DECK, playlist, count: 2, ...more });

describe('deckSetKey', () => {
  it('is null when the deck plays the whole library', () => {
    expect(deckSetKey(null, [list], 0)).toBeNull();
    expect(deckSetKey(playing(null), [list], 0)).toBeNull();
  });

  it('is the same for the same contents', () => {
    const copy = manual('warm', 'Warm-up', [item('a.milk', 'h1'), item('b.milk', 'h2')]);
    expect(deckSetKey(playing('warm'), [list], 0)).toBe(deckSetKey(playing('warm'), [copy], 0));
  });

  it('changes when an item is replaced at the same count', () => {
    const replaced = { ...list, items: [item('a.milk', 'h1'), item('c.milk', 'h3')] };
    expect(deckSetKey(playing('warm'), [replaced], 0)).not.toBe(deckSetKey(playing('warm'), [list], 0));
  });

  it('changes when the same path has a new hash, or the items move', () => {
    const rehashed = { ...list, items: [item('a.milk', 'h1'), item('b.milk', 'h9')] };
    const moved = { ...list, items: [...list.items].reverse() };
    const key = deckSetKey(playing('warm'), [list], 0);
    expect(deckSetKey(playing('warm'), [rehashed], 0)).not.toBe(key);
    expect(deckSetKey(playing('warm'), [moved], 0)).not.toBe(key);
  });

  it("ignores the library's changes for a manual playlist", () => {
    expect(deckSetKey(playing('warm'), [list], 3)).toBe(deckSetKey(playing('warm'), [list], 0));
  });

  it("changes for a smart playlist after the library's data changes", () => {
    expect(deckSetKey(playing('stars'), [smart], 1)).not.toBe(deckSetKey(playing('stars'), [smart], 0));
  });

  it("changes when a smart playlist's query does", () => {
    const other = { ...smart, query: { ...QUERY, text: 'fire' } };
    expect(deckSetKey(playing('stars'), [other], 0)).not.toBe(deckSetKey(playing('stars'), [smart], 0));
  });

  it("changes for a filter after the library's data changes", () => {
    expect(deckSetKey(playing(null, { query: QUERY }), [], 1)).not.toBe(deckSetKey(playing(null, { query: QUERY }), [], 0));
  });
});
