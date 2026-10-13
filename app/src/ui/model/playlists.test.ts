import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, freshName, movingOn, nextSays, timingChangedLive, upNext, type Deck, type Lists, type Playlist } from './playlists.ts';

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

  it('says held while held, and still names what → opens (manual steps work under Hold)', () => {
    expect(nextSays(playing, true)).toMatchObject({ kind: 'held', then: { kind: 'item', item: { name: 'y' } } });
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

  it('says held while held, playing a filter too, with what → still opens', () => {
    expect(nextSays(lists([], { next: '/p/Dancer/calm.milk' }), true)).toMatchObject({ kind: 'held', then: { kind: 'filter', item: { name: 'calm' } } });
  });
});

describe('freshName', () => {
  it('numbers from 1, whatever else there is', () => {
    expect(freshName([])).toBe('playlist 1');
    // Four smart and starter playlists don't make the first one "playlist 5".
    expect(freshName([smart('Chill'), smart('Calm'), smart('Recent'), list('Warm', [])])).toBe('playlist 1');
  });

  it('takes the first not taken', () => {
    const named = (...ns: number[]) => ns.map((n) => ({ ...list(`l${n}`, []), name: `playlist ${n}` }));
    expect(freshName(named(1, 2, 3))).toBe('playlist 4');
    expect(freshName(named(1, 3))).toBe('playlist 2');
  });
});

describe('movingOn', () => {
  it('says the timing in effect', () => {
    expect(movingOn(deck({ bars: 1, every: { every: 1, unit: 'bars' } }))).toBe('moves on every bar');
    expect(movingOn(deck({ every: { every: 2, unit: 'beats' } }))).toBe('moves on every 2 beats');
    expect(movingOn(deck({ bars: 8 }))).toBe('moves on every 8 bars');
    expect(movingOn(deck({ auto: true, seconds: 30 }))).toBe('moves on every 30 s');
    expect(movingOn(deck())).toBe('stays on each preset');
  });
});

describe('timingChangedLive', () => {
  it('is only the playing playlist whose change timing differs', () => {
    expect(timingChangedLive(deck({ playlist: 'a', differs: ['change'] }), 'a')).toBe(true);
    expect(timingChangedLive(deck({ playlist: 'a', differs: ['speed'] }), 'a')).toBe(false);
    expect(timingChangedLive(deck({ playlist: 'b', differs: ['change'] }), 'a')).toBe(false);
  });
});
