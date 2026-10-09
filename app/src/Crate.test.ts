import { describe, expect, it } from 'vitest';
import type { LibraryData } from './api.ts';
import * as pl from './playlists.ts';
import { chipAction, dropSlot, litMoods, moods, moveFor, needsDeckItems, orderable, upNote, upcoming } from './Crate.tsx';

const item = (name: string, missing = false): pl.Item => ({ path: `pack/${name}.milk`, name, group: 'pack', missing, hash: null });
const ITEMS = ['a', 'b', 'c', 'd', 'e'].map((n) => item(n, n === 'd'));
const LIST = pl.manual('m', 'Set', ITEMS);
const SMART: pl.Playlist = { ...pl.manual('s', 'Calm', []), kind: 'smart', query: { groups: { intensity: ['low'] }, text: '' } };
const lists = (deck: Partial<pl.Deck>): pl.Lists => ({ playlists: [LIST, SMART], deck: { ...pl.EMPTY_DECK, ...deck } });

describe('moods', () => {
  it('counts every tag, the most used first, then by name', () => {
    const data: LibraryData = {
      version: 1,
      presets: { x: { tags: ['dark', 'warm'] }, y: { tags: ['warm', 'dark', 'dark'] }, z: { tags: ['warm'], hidden: true }, w: { star: true } },
    };
    expect(moods(data)).toEqual([
      { tag: 'warm', count: 3 },
      { tag: 'dark', count: 2 },
    ]);
    expect(moods({ version: 1, presets: { a: { tags: ['b'] }, c: { tags: ['a'] } } }).map((m) => m.tag)).toEqual(['a', 'b']);
  });

  it('has none without data or tags', () => {
    expect(moods(null)).toEqual([]);
    expect(moods({ version: 1, presets: { x: { star: true } } })).toEqual([]);
  });
});

describe('litMoods', () => {
  it('reads the tags of a filter playing, never of a playlist', () => {
    expect(litMoods(lists({ query: { groups: { tags: ['dark', 'warm'] }, text: '' } }).deck)).toEqual(['dark', 'warm']);
    expect(litMoods(lists({ playlist: 's', query: { groups: { tags: ['dark'] }, text: '' } }).deck)).toEqual([]);
    expect(litMoods(lists({ query: { groups: { style: ['x'] }, text: '' } }).deck)).toEqual([]);
    expect(litMoods(pl.EMPTY_DECK)).toEqual([]);
  });
});

describe('chipAction', () => {
  it('plays a mood, mixes a second in, takes one out, and stops with the last', () => {
    expect(chipAction([], 'dark')).toEqual({ kind: 'query', query: { groups: { tags: ['dark'] }, text: '' } });
    expect(chipAction(['dark'], 'warm')).toEqual({ kind: 'query', query: { groups: { tags: ['dark', 'warm'] }, text: '' } });
    expect(chipAction(['dark', 'warm'], 'dark')).toEqual({ kind: 'query', query: { groups: { tags: ['warm'] }, text: '' } });
    expect(chipAction(['dark'], 'dark')).toEqual({ kind: 'unload' });
  });
});

describe('upcoming', () => {
  it('reads a manual playlist in order from next_index, round the end, never the playing one', () => {
    const rows = upcoming(lists({ playlist: 'm', index: 3, next_index: 4 }), null, 8);
    expect(rows.map((r) => [r.name, r.at])).toEqual([
      ['e', 4],
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(upcoming(lists({ playlist: 'm', index: 3, next_index: 4 }), null, 2).map((r) => r.at)).toEqual([4, 0]);
    expect(upcoming(lists({ playlist: 'm', index: 1, next_index: 2 }), null).find((r) => r.name === 'd')?.missing).toBe(true);
  });

  it('starts at the first before anything in the playlist has played', () => {
    expect(upcoming(lists({ playlist: 'm' }), null).map((r) => r.at)).toEqual([0, 1, 2, 3, 4]);
  });

  it('reads the deck items from after the playing one for a shuffle, a smart list or a mood, and none can be dragged', () => {
    const paths = ['pack/c.milk', 'pack/a.milk', 'pack/d.milk', 'pack/b.milk'];
    const shuffled = upcoming(lists({ playlist: 'm', order: 'shuffle', current: 'pack/a.milk' }), paths);
    expect(shuffled.map((r) => [r.name, r.at, r.missing])).toEqual([
      ['d', null, true],
      ['b', null, false],
      ['c', null, false],
    ]);
    const mood = upcoming(lists({ query: { groups: { tags: ['x'] }, text: '' }, current: 'other/z.milk' }), ['p/one.milk', 'p/two.milk']);
    expect(mood.map((r) => [r.name, r.at])).toEqual([
      ['one', null],
      ['two', null],
    ]);
    expect(upcoming(lists({ playlist: 's', current: 'p/two.milk' }), ['p/one.milk', 'p/two.milk', 'p/three.milk'], 8).map((r) => r.name)).toEqual(['three', 'one']);
  });

  it('has none when nothing plays or the items are not in yet', () => {
    expect(upcoming(lists({}), ['p/one.milk'])).toEqual([]);
    expect(upcoming(lists({ playlist: 's' }), null)).toEqual([]);
  });
});

describe('orderable and the notes', () => {
  it('only a manual playlist in order can be reordered; the rest say why not', () => {
    expect(orderable(lists({ playlist: 'm' }))?.id).toBe('m');
    expect(orderable(lists({ playlist: 'm', order: 'shuffle' }))).toBeNull();
    expect(orderable(lists({ playlist: 's' }))).toBeNull();
    expect(needsDeckItems(lists({ playlist: 'm' }))).toBe(false);
    expect(needsDeckItems(lists({ playlist: 's' }))).toBe(true);
    expect(needsDeckItems(lists({}))).toBe(false);
    expect(upNote(lists({ playlist: 'm', order: 'shuffle' }))).toBe('Shuffled: the order is picked as it plays.');
    expect(upNote(lists({ query: { groups: { tags: ['x'] }, text: '' } }))).toBe('A mood plays in library order.');
    expect(upNote(lists({ playlist: 's' }))).toMatch(/smart playlist/);
    expect(upNote(lists({ playlist: 'm' }))).toMatch(/Drag/);
  });
});

describe('dropSlot', () => {
  const rows = [
    { top: 0, height: 64 },
    { top: 64, height: 64 },
    { top: 128, height: 64 },
  ];
  it('lands before the first row whose middle is below the pointer', () => {
    expect(dropSlot(rows, -10)).toBe(0);
    expect(dropSlot(rows, 31)).toBe(0);
    expect(dropSlot(rows, 33)).toBe(1);
    expect(dropSlot(rows, 150)).toBe(2);
    expect(dropSlot(rows, 500)).toBe(3);
  });
});

describe('moveFor', () => {
  // Playing c (2): the rows are d e a b, items 3 4 0 1.
  const rows = upcoming(lists({ playlist: 'm', index: 2, next_index: 3 }), null);

  it('maps a drop between rows back to item indices, round the end of the list', () => {
    expect(rows.map((r) => r.at)).toEqual([3, 4, 0, 1]);
    // b to the top, before d: out of 1, the rest move up, in before d at 2.
    expect(moveFor(rows, 3, 0)).toEqual({ from: 1, to: 2 });
    // d to before b.
    expect(moveFor(rows, 0, 3)).toEqual({ from: 3, to: 1 });
    // d after the last row (b).
    expect(moveFor(rows, 0, 4)).toEqual({ from: 3, to: 2 });
    // e down one (Alt+↓: before row 3): before b.
    expect(moveFor(rows, 1, 3)).toEqual({ from: 4, to: 1 });
  });

  it('does nothing where the row already is, off the ends, or for rows that cannot be dragged', () => {
    expect(moveFor(rows, 1, 1)).toBeNull();
    expect(moveFor(rows, 1, 2)).toBeNull();
    expect(moveFor(rows, 0, -1)).toBeNull();
    expect(moveFor(rows, 3, 5)).toBeNull();
    expect(
      moveFor(
        [
          { path: 'p', name: 'p', missing: false, at: null },
          { path: 'q', name: 'q', missing: false, at: null },
        ],
        0,
        2,
      ),
    ).toBeNull();
  });
});
