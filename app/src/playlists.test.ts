import { describe, expect, it, vi } from 'vitest';

// The module's commands go through Tauri; these tests touch only its pure helpers.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { freshName, nextSays, upNext, type Deck, type Lists, type Playlist } from './playlists.ts';

const item = (name: string, missing = false) => ({ path: `g/${name}.milk`, name, group: 'g', missing });
const list = (id: string, names: string[]): Playlist => ({ id, name: id, items: names.map((n) => item(n)) });
const deck = (over: Partial<Deck> = {}): Deck => ({ playlist: null, index: null, auto: false, seconds: 30, current: null, hold: false, bars: 0, ...over });
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
    const a: Playlist = { id: 'a', name: 'a', items: [item('x'), item('gone', true), item('z')] };
    expect(upNext(lists([a], { playlist: 'a', index: 0 }))?.next?.missing).toBe(true);
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
