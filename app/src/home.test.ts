import { describe, expect, it } from 'vitest';
import type { LibraryQuery, LibraryRow, Level } from './api.ts';
import { prepareRow, type Prepared } from './librarySearch.ts';
import { DEFAULT_SETTINGS, EMPTY_DECK, type Lists, type Playlist } from './playlists.ts';
import { changeUnit, matches, RECENT, sections, seedStarters, SEEDED_KEY, STARTERS, STRIP_CAP, strip, withSetting, type Mark } from './home.ts';
import { firstPane } from './Home.tsx';

const row = (name: string, speed: Level = 'mid', intensity: Level = 'mid', over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: `g/${name}.milk`,
  path: `/presets/g/${name}.milk`,
  hash: `hash-${name}`,
  style: 'g',
  sub_style: null,
  authors: ['geiss'],
  title: name,
  thumbnail: `thumb:${name}`,
  look: { hues: [0.5], brightness: 0.3, speed: 3, intensity: 10, brightness_level: 'mid', speed_level: speed, intensity_level: intensity },
  starter: false,
  ...over,
});
const prep = (r: LibraryRow, hidden = false): Prepared => prepareRow(r, hidden ? { hidden: true } : undefined);

const manual = (id: string, paths: string[], over: Partial<Playlist> = {}): Playlist => ({
  id,
  name: id,
  items: paths.map((p) => ({ path: p, name: p.split('/').pop()!.replace('.milk', ''), group: 'g', missing: false, hash: null })),
  kind: 'manual',
  query: null,
  settings: DEFAULT_SETTINGS,
  ...over,
});
const smart = (id: string, query: LibraryQuery, over: Partial<Playlist> = {}): Playlist => ({ id, name: id, items: [], kind: 'smart', query, settings: DEFAULT_SETTINGS, ...over });

class MapMark implements Mark {
  m = new Map<string, string>();
  get = (k: string) => this.m.get(k) ?? null;
  set = (k: string, v: string) => void this.m.set(k, v);
}

/** The app's side of seeding, writing down what it was asked. */
const app = () => {
  const saved: { name: string; query: LibraryQuery }[] = [];
  const set: { id: string; every: number }[] = [];
  return {
    saved,
    set,
    save: async (name: string, query: LibraryQuery) => {
      saved.push({ name, query });
      return `id-${name}`;
    },
    settings: async (id: string, s: typeof DEFAULT_SETTINGS) => void set.push({ id, every: s.change.every }),
  };
};

describe('seedStarters', () => {
  it('makes Calm, Peak-time and Recently played once, each with its own settings', async () => {
    const mark = new MapMark();
    const a = app();
    expect(await seedStarters([], mark, a)).toBe(3);
    expect(a.saved.map((s) => s.name)).toEqual(['Calm', 'Peak-time', 'Recently played']);
    expect(a.set.map((s) => s.id)).toEqual(['id-Calm', 'id-Peak-time', 'id-Recently played']);
    expect(mark.get(SEEDED_KEY)).not.toBeNull();
    // The next start makes none, even with the starters since deleted.
    expect(await seedStarters([], mark, a)).toBe(0);
    expect(a.saved).toHaveLength(3);
  });

  it('skips a starter whose name a smart playlist already has, and marks itself done', async () => {
    const mark = new MapMark();
    const a = app();
    expect(await seedStarters([smart('Calm', { groups: {}, text: '' })], mark, a)).toBe(2);
    expect(a.saved.map((s) => s.name)).toEqual(['Peak-time', 'Recently played']);
    expect(mark.get(SEEDED_KEY)).not.toBeNull();
  });

  it('makes nothing without storage to remember it by', async () => {
    const a = app();
    expect(await seedStarters([], null, a)).toBe(0);
    expect(a.saved).toEqual([]);
  });

  it('builds Calm and Peak-time from speed and intensity, and Recently played from what played', () => {
    const [calm, peak, recent] = STARTERS;
    expect(calm.query.groups).toEqual({ speed: ['low', 'mid'], intensity: ['low'] });
    expect(peak.query.groups).toEqual({ speed: ['mid', 'high'], intensity: ['high'] });
    expect(recent.query.recent).toBe(RECENT);
  });
});

describe('sections', () => {
  it('splits manual from smart, each in the order kept', () => {
    const ls = [manual('a', []), smart('s1', { groups: {}, text: '' }), manual('b', []), smart('s2', { groups: {}, text: '' })];
    const { manual: m, smart: s } = sections(ls);
    expect(m.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s.map((p) => p.id)).toEqual(['s1', 's2']);
  });
});

describe('matches', () => {
  const rows = [prep(row('a', 'low', 'low')), prep(row('b', 'high', 'high')), prep(row('c', 'mid', 'low')), prep(row('d', 'low', 'low'), true)];

  it('picks what the query asks, never a hidden preset', () => {
    expect(matches(STARTERS[0].query, rows, []).map((p) => p.title)).toEqual(['a', 'c']);
    expect(matches(STARTERS[1].query, rows, []).map((p) => p.title)).toEqual(['b']);
  });

  it('with recent, takes what played newest first, once each, up to the count', () => {
    const played = ['/presets/g/c.milk', '/presets/g/a.milk', '/presets/g/c.milk', '/presets/g/d.milk', '/presets/g/b.milk'];
    expect(matches({ groups: {}, text: '', recent: 50 }, rows, played).map((p) => p.title)).toEqual(['c', 'a', 'b']);
    expect(matches({ groups: {}, text: '', recent: 2 }, rows, played).map((p) => p.title)).toEqual(['c', 'a']);
  });
});

describe('strip', () => {
  const rows = [prep(row('a')), prep(row('b')), prep(row('c'))];
  const ctx = { rows, played: [], playing: null };

  it("shows a manual playlist's items as listed, with thumbnails from the library", () => {
    const { tiles, total } = strip(manual('m', ['/presets/g/b.milk', '/presets/g/a.milk']), ctx);
    expect(total).toBe(2);
    expect(tiles.map((t) => [t.name, t.thumbnail, t.index])).toEqual([
      ['b', 'thumb:b', 0],
      ['a', 'thumb:a', 1],
    ]);
  });

  it('finds a moved preset by its hash, and draws a missing one without a thumbnail', () => {
    const list = manual('m', ['/old/a.milk', '/gone/z.milk']);
    list.items[0].hash = 'hash-a';
    list.items[1].missing = true;
    const { tiles } = strip(list, ctx);
    expect(tiles[0].thumbnail).toBe('thumb:a');
    expect(tiles[1]).toMatchObject({ thumbnail: null, missing: true });
  });

  it('follows the deck’s order while a manual playlist plays shuffled, a repeat taking its places in turn', () => {
    const list = manual('m', ['/presets/g/a.milk', '/presets/g/b.milk', '/presets/g/a.milk'], { settings: { ...DEFAULT_SETTINGS, order: 'shuffle' } });
    const { tiles } = strip(list, { ...ctx, playing: ['/presets/g/a.milk', '/presets/g/b.milk', '/presets/g/a.milk'].reverse() });
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2]);
    const second = strip(list, { ...ctx, playing: ['/presets/g/b.milk', '/presets/g/a.milk', '/presets/g/a.milk'] });
    expect(second.tiles.map((t) => t.index)).toEqual([1, 0, 2]);
  });

  it('keeps the listed order for a shuffled playlist that is not playing', () => {
    const list = manual('m', ['/presets/g/a.milk', '/presets/g/b.milk'], { settings: { ...DEFAULT_SETTINGS, order: 'shuffle' } });
    expect(strip(list, ctx).tiles.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it("shows a smart playlist's matches, and as the deck shuffled them while it plays", () => {
    const list = smart('s', { groups: {}, text: '' }, { settings: { ...DEFAULT_SETTINGS, order: 'shuffle' } });
    expect(strip(list, ctx).tiles.map((t) => [t.name, t.index])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    const playing = strip(list, { ...ctx, playing: ['/presets/g/c.milk', '/elsewhere/x.milk'] });
    expect(playing.tiles.map((t) => [t.name, t.index])).toEqual([
      ['c', null],
      ['x', null],
    ]);
  });

  it(`draws at most ${STRIP_CAP} tiles, and counts them all`, () => {
    const many = Array.from({ length: STRIP_CAP + 20 }, (_, i) => prep(row(`p${String(i).padStart(4, '0')}`)));
    const { tiles, total } = strip(smart('s', { groups: {}, text: '' }), { rows: many, played: [], playing: null });
    expect(tiles).toHaveLength(STRIP_CAP);
    expect(total).toBe(STRIP_CAP + 20);
  });
});

describe('settings', () => {
  it('keeps each setting within what the app allows', () => {
    const s = withSetting(DEFAULT_SETTINGS, 'speed', 99);
    expect(s.speed).toBe(4);
    expect(withSetting(DEFAULT_SETTINGS, 'transition', -1).transition).toBe(0);
    expect(withSetting(DEFAULT_SETTINGS, 'hue', Number.NaN).hue).toBe(0);
    expect(withSetting(DEFAULT_SETTINGS, 'change', { unit: 'bars', every: 100.4 }).change).toEqual({ unit: 'bars', every: 64 });
    expect(withSetting(DEFAULT_SETTINGS, 'change', { unit: 'seconds', every: 0 }).change).toEqual({ unit: 'seconds', every: 1 });
  });

  it('switching seconds and bars starts from that unit’s usual amount, and leaves the same unit alone', () => {
    expect(changeUnit(DEFAULT_SETTINGS, 'bars').change).toEqual({ unit: 'bars', every: 8 });
    const bars = changeUnit(DEFAULT_SETTINGS, 'bars');
    expect(changeUnit(bars, 'seconds').change).toEqual(DEFAULT_SETTINGS.change);
    expect(changeUnit(bars, 'bars')).toBe(bars);
  });
});

describe('firstPane', () => {
  const lists = (playlists: Playlist[], playing: string | null = null): Lists => ({ playlists, deck: { ...EMPTY_DECK, playlist: playing } });

  it('opens on the playlist playing, else the first, else the library', () => {
    expect(firstPane(lists([manual('a', []), manual('b', [])], 'b'))).toEqual({ kind: 'list', id: 'b' });
    expect(firstPane(lists([manual('a', []), manual('b', [])]))).toEqual({ kind: 'list', id: 'a' });
    expect(firstPane(lists([]))).toEqual({ kind: 'library' });
  });
});
