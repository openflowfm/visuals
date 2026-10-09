import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, freshName, nextSays, upNext, type Deck, type Lists, type Playlist } from './playlists.ts';

const item = (name: string, missing = false) => ({ path: `g/${name}.milk`, name, group: 'g', missing, hash: null });
const list = (id: string, names: string[]): Playlist => ({ id, name: id, items: names.map((n) => item(n)), kind: 'manual', query: null, settings: DEFAULT_SETTINGS });
const smart = (id: string): Playlist => ({ id, name: id, items: [], kind: 'smart', query: { groups: { speed: ['low'] }, text: '' }, settings: DEFAULT_SETTINGS });
const deck = (over: Partial<Deck> = {}): Deck => ({
  playlist: null,
  index: null,
  auto: false,
  seconds: 30,
  current: null,
  hold: false,
  bars: 0,
  order: 'in_order',
  settings: null,
  differs: [],
  next: null,
  next_index: null,
  count: 0,
  query: null,
  ...over,
});
const lists = (playlists: Playlist[], d: Partial<Deck> = {}): Lists => ({ playlists, deck: deck(d) });

describe('upNext', () => {
  it('is null without lists or a playing playlist', () => {
    expect(upNext(null)).toBeNull();
    expect(upNext(lists([list('a', ['x'])]))).toBeNull();
  });

  it('is null when the playing playlist is gone', () => {
    expect(upNext(lists([list('a', ['x'])], { playlist: 'b', index: 0 }))).toBeNull();
  });

  it('steps one on from the playing item', () => {
    const up = upNext(lists([list('a', ['x', 'y', 'z'])], { playlist: 'a', index: 0 }));
    expect(up?.index).toBe(0);
    expect(up?.nextIndex).toBe(1);
    expect(up?.next?.name).toBe('y');
  });

  it('wraps round to the first after the last', () => {
    const up = upNext(lists([list('a', ['x', 'y'])], { playlist: 'a', index: 1 }));
    expect(up?.nextIndex).toBe(0);
    expect(up?.next?.name).toBe('x');
  });

  it('is the first when nothing in it has played yet', () => {
    const up = upNext(lists([list('a', ['x', 'y'])], { playlist: 'a', index: null }));
    expect(up?.index).toBeNull();
    expect(up?.next?.name).toBe('x');
  });

  it('treats an index past the end (items removed) as not started', () => {
    const up = upNext(lists([list('a', ['x', 'y'])], { playlist: 'a', index: 5 }));
    expect(up?.index).toBeNull();
    expect(up?.next?.name).toBe('x');
  });

  it('has no next for an empty playlist', () => {
    const up = upNext(lists([list('a', [])], { playlist: 'a', index: null }));
    expect(up?.playlist.id).toBe('a');
    expect(up?.next).toBeNull();
    expect(up?.nextIndex).toBeNull();
  });

  it('does not skip a missing item, as the engine does not', () => {
    const a: Playlist = { ...list('a', []), items: [item('x'), item('gone', true), item('z')] };
    expect(upNext(lists([a], { playlist: 'a', index: 0 }))?.next?.missing).toBe(true);
  });

  it("takes the deck's next over stepping, as shuffle does", () => {
    const up = upNext(lists([list('a', ['x', 'y', 'z'])], { playlist: 'a', index: 0, order: 'shuffle', next: 'g/z.milk', next_index: 2 }));
    expect(up?.next?.name).toBe('z');
    expect(up?.nextIndex).toBe(2);
    expect(up?.count).toBe(3);
  });

  it("names a smart playlist's next by its path, and counts its resolved matches", () => {
    const up = upNext(lists([smart('s')], { playlist: 's', index: 4, count: 12, next: '/p/Dancer/slow one.milk' }));
    expect(up?.next).toMatchObject({ path: '/p/Dancer/slow one.milk', name: 'slow one', group: 'Dancer', missing: false });
    expect(up?.nextIndex).toBeNull();
    expect(up?.index).toBe(4);
    expect(up?.count).toBe(12);
  });

  it("finds the deck's next by its index when the playlist holds that preset twice", () => {
    const up = upNext(lists([list('a', ['x', 'y', 'x'])], { playlist: 'a', index: 1, next: 'g/x.milk', next_index: 2 }));
    expect(up?.nextIndex).toBe(2);
    expect(up?.next?.name).toBe('x');
  });

  it('steps when the deck names no next', () => {
    expect(upNext(lists([list('a', ['x', 'y'])], { playlist: 'a', index: 0, next: null }))?.next?.name).toBe('y');
  });
});

describe('nextSays', () => {
  const playing = lists([list('a', ['x', 'y'])], { playlist: 'a', index: 0 });

  it('names the item → opens', () => {
    const says = nextSays(playing, false);
    expect(says.kind === 'item' && says.item.name).toBe('y');
  });

  it('names nothing while held, even with a playlist playing', () => {
    expect(nextSays(playing, true)).toEqual({ kind: 'held' });
  });

  it('names no file when stepping through the library', () => {
    expect(nextSays(lists([list('a', ['x'])]), false)).toEqual({ kind: 'library' });
  });

  it('says so when the playing playlist is empty', () => {
    expect(nextSays(lists([list('a', [])], { playlist: 'a' }), false).kind).toBe('empty');
  });

  it('says a smart playlist with no matches is empty', () => {
    expect(nextSays(lists([smart('s')], { playlist: 's', count: 0 }), false).kind).toBe('empty');
  });

  it("names the deck's next while playing a filter", () => {
    const query = { groups: { speed: ['low'] }, text: '' };
    const says = nextSays(lists([], { next: '/p/Dancer/calm.milk', query, count: 40 }), false);
    expect(says).toMatchObject({ kind: 'filter', item: { name: 'calm' }, query });
  });

  it('names nothing while held, even playing a filter', () => {
    expect(nextSays(lists([], { next: '/p/Dancer/calm.milk' }), true)).toEqual({ kind: 'held' });
  });
});

describe('freshName', () => {
  it('numbers from the count', () => {
    expect(freshName([])).toBe('playlist 1');
    expect(freshName([list('a', [])])).toBe('playlist 2');
  });

  it('skips a name already taken', () => {
    const taken = [{ ...list('a', []), name: 'playlist 2' }];
    expect(freshName(taken)).toBe('playlist 3');
  });
});
