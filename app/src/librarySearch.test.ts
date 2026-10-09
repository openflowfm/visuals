import { describe, expect, it } from 'vitest';
import type { Entry, LibraryData, LibraryRow, Level, Look } from './api.ts';
import {
  colourOf,
  debounced,
  emptyQuery,
  facet,
  facetSummary,
  isEmpty,
  parseTags,
  prepare,
  prepareRow,
  queryName,
  rowsFromEntries,
  searchLibrary,
  stepIn,
  tileFor,
  toggle,
  valueLabel,
  valuesFor,
  type Clock,
} from './librarySearch.ts';

const e = (group: string, name: string): Entry => ({ path: `${group}/${name}.milk`, name, group });
const lib = [e('Geiss', 'Spiral Dance'), e('Flexi', 'Mandala Spiral'), e('Geiss', 'Warp Field'), e('Rovastar', 'Fractal')];

const look = (hues: number[], speed: Level = 'mid', intensity: Level = 'mid'): Look => ({
  hues,
  brightness: 0.3,
  speed: 3,
  intensity: 10,
  brightness_level: 'mid',
  speed_level: speed,
  intensity_level: intensity,
});

const row = (key: string, over: Partial<LibraryRow> = {}): LibraryRow => {
  const [style, sub] = key.split('/');
  return {
    key,
    path: `/presets/${key}`,
    hash: '',
    style,
    sub_style: sub && key.split('/').length > 2 ? sub : null,
    authors: ['geiss'],
    title: key,
    thumbnail: null,
    look: null,
    starter: false,
    ...over,
  };
};

describe('searchLibrary', () => {
  it('returns everything for an empty query', () => {
    const f = searchLibrary(lib, '  ');
    expect(f.shown).toEqual(lib);
    expect(f).toMatchObject({ matched: 4, total: 4 });
  });

  it('matches every word, case-insensitively, across group and name, with no cap', () => {
    expect(searchLibrary(lib, 'spiral').shown.map((x) => x.name)).toEqual(['Spiral Dance', 'Mandala Spiral']);
    expect(searchLibrary(lib, 'GEISS spiral').shown.map((x) => x.name)).toEqual(['Spiral Dance']);
    expect(searchLibrary(lib, 'geiss  nothing').matched).toBe(0);
    const many = Array.from({ length: 1000 }, (_, i) => e('g', `p${i}`));
    expect(searchLibrary(many, 'p').shown).toHaveLength(1000);
  });
});

describe('colourOf', () => {
  it('names hues, wrapping round', () => {
    expect([0, 30, 60, 120, 180, 210, 270, 300, 350, 360, -10].map(colourOf)).toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'red', 'red', 'red']);
  });
});

describe('prepareRow', () => {
  it('reads the groups from the index', () => {
    const p = prepareRow(row('Dancer/Whirl/a.milk', { look: look([0, 210], 'high', 'low'), authors: ['geiss', 'flexi'] }), undefined);
    expect(p.values).toEqual({
      style: ['Dancer', 'Dancer/Whirl'],
      author: ['geiss', 'flexi'],
      colour: ['red', 'blue'],
      speed: ['high'],
      intensity: ['low'],
      star: [],
      tags: [],
    });
    expect(p.hidden).toBe(false);
  });

  it('calls a drawn preset with no hue grey, and an undrawn one nothing', () => {
    expect(prepareRow(row('A/x.milk', { look: look([]) }), undefined).values.colour).toEqual(['grey']);
    expect(prepareRow(row('A/x.milk'), undefined).values).toMatchObject({ colour: [], speed: [], intensity: [] });
  });

  it("lays the user's data over the index", () => {
    const p = prepareRow(row('Dancer/Whirl/a.milk', { look: look([0]) }), {
      star: true,
      hidden: true,
      tags: ['warm up'],
      overrides: { style: 'Fractal', sub_style: 'Ring', hues: [120], speed: 'low', authors: ['me'], title: 'Mine' },
    });
    expect(p).toMatchObject({ style: 'Fractal', subStyle: 'Ring', title: 'Mine', star: true, hidden: true, tags: ['warm up'] });
    expect(p.values).toMatchObject({ style: ['Fractal', 'Fractal/Ring'], colour: ['green'], speed: ['low'], author: ['me'], star: ['starred'], tags: ['warm up'] });
    expect(p.text).toContain('warm up');
  });
});

describe('facet', () => {
  const rows = [
    row('Dancer/Whirl/a.milk', { look: look([0], 'high'), authors: ['geiss'] }),
    row('Dancer/Whirl/b.milk', { look: look([210], 'low'), authors: ['flexi'] }),
    row('Dancer/Spin/c.milk', { look: look([0, 120], 'high'), authors: ['flexi'] }),
    row('Fractal/d.milk', { look: look([], 'high'), authors: ['rovastar'] }),
  ];
  const data: LibraryData = { version: 1, presets: { 'Fractal/d.milk': { star: true, tags: ['chill'] } } };
  const prepared = prepare(rows, data);
  const keys = (q = emptyQuery()) => facet(prepared, q).shown.map((p) => p.row.key);

  it('shows everything for an empty query, counting every value', () => {
    const f = facet(prepared, emptyQuery());
    expect(f.shown).toHaveLength(4);
    expect(Object.fromEntries(f.counts.style)).toEqual({ Dancer: 3, 'Dancer/Whirl': 2, 'Dancer/Spin': 1, Fractal: 1 });
    expect(Object.fromEntries(f.counts.colour)).toEqual({ red: 2, blue: 1, green: 1, grey: 1 });
    expect(Object.fromEntries(f.counts.star)).toEqual({ starred: 1 });
    expect(Object.fromEntries(f.counts.tags)).toEqual({ chill: 1 });
  });

  it('ORs values within a group', () => {
    expect(keys({ groups: { author: ['geiss', 'rovastar'] }, text: '' })).toEqual(['Dancer/Whirl/a.milk', 'Fractal/d.milk']);
    expect(keys({ groups: { style: ['Dancer/Spin', 'Fractal'] }, text: '' })).toEqual(['Dancer/Spin/c.milk', 'Fractal/d.milk']);
  });

  it('ANDs across groups, and with the text', () => {
    expect(keys({ groups: { style: ['Dancer'], speed: ['high'] }, text: '' })).toEqual(['Dancer/Whirl/a.milk', 'Dancer/Spin/c.milk']);
    expect(keys({ groups: { style: ['Dancer'], speed: ['high'], colour: ['green'] }, text: '' })).toEqual(['Dancer/Spin/c.milk']);
    expect(keys({ groups: { speed: ['high'] }, text: 'FLEXI spin' })).toEqual(['Dancer/Spin/c.milk']);
    expect(keys({ groups: { star: ['starred'] }, text: '' })).toEqual(['Fractal/d.milk']);
    expect(keys({ groups: { tags: ['chill'] }, text: 'chill' })).toEqual(['Fractal/d.milk']);
  });

  it("counts a group's values against every other group, so a count says what OR-ing it in adds", () => {
    const f = facet(prepared, { groups: { style: ['Dancer'], speed: ['high'] }, text: '' });
    // Speed is counted over Dancer only; style over the fast ones only.
    expect(Object.fromEntries(f.counts.speed)).toEqual({ high: 2, low: 1 });
    expect(Object.fromEntries(f.counts.style)).toEqual({ Dancer: 2, 'Dancer/Whirl': 1, 'Dancer/Spin': 1, Fractal: 1 });
    // Every other group is counted over what's shown.
    expect(Object.fromEntries(f.counts.author)).toEqual({ geiss: 1, flexi: 1 });
  });

  it('filters 9,795 rows in under 100 ms', () => {
    const styles = ['Dancer', 'Fractal', 'Geometric', 'Hypnotic', 'Particles', 'Reaction', 'Sparkle', 'Supernova', 'Waveform', 'Drawing'];
    const levels: Level[] = ['low', 'mid', 'high'];
    const big = Array.from({ length: 9795 }, (_, i) =>
      row(`${styles[i % 10]}/Sub${i % 7}/p${i}.milk`, {
        authors: [`author${i % 600}`, ...(i % 5 ? [] : [`author${(i * 7) % 600}`])],
        title: `Preset number ${i}`,
        look: i % 50 ? look(i % 3 ? [(i * 37) % 360] : [(i * 37) % 360, (i * 91) % 360], levels[i % 3], levels[(i >> 2) % 3]) : null,
      }),
    );
    const bigData: LibraryData = { version: 1, presets: Object.fromEntries(big.filter((_, i) => i % 9 === 0).map((r, i) => [r.key, { star: i % 2 === 0, tags: [`tag${i % 20}`] }])) };
    const query = {
      groups: { style: ['Dancer', 'Fractal/Sub3', 'Sparkle'], colour: ['red', 'blue'], speed: ['high', 'mid'], author: Array.from({ length: 120 }, (_, k) => `author${k * 5}`) },
      text: 'preset',
    };

    const t0 = performance.now();
    const ready = prepare(big, bigData);
    const f = facet(ready, query);
    const first = performance.now() - t0;
    // A keystroke once the rows are prepared.
    const t1 = performance.now();
    facet(ready, { ...query, text: 'preset number 1' });
    const again = performance.now() - t1;

    expect(f.total).toBe(9795);
    expect(f.shown.length).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
    expect(again).toBeLessThan(100);
  });
});

describe('valuesFor', () => {
  const prepared = prepare(
    [
      row('B/Two/a.milk', { authors: ['zed'], look: look([300], 'high') }),
      row('B/One/b.milk', { authors: ['amy'], look: look([0], 'low') }),
      row('A/c.milk', { authors: ['amy'], look: look([120]) }),
      row('Bs/d.milk', { authors: ['amy'], look: look([210]) }),
    ],
    null,
  );

  it('lists styles with each sub-style after its style, by name', () => {
    const f = facet(prepared, emptyQuery());
    expect(valuesFor('style', f, emptyQuery()).map((c) => c.value)).toEqual(['A', 'B', 'B/One', 'B/Two', 'Bs']);
  });

  it('keeps colours and levels in their own order, and the rest by count', () => {
    const f = facet(prepared, emptyQuery());
    expect(valuesFor('colour', f, emptyQuery()).map((c) => c.value)).toEqual(['red', 'green', 'blue', 'pink']);
    expect(valuesFor('speed', f, emptyQuery()).map((c) => c.value)).toEqual(['low', 'mid', 'high']);
    expect(valuesFor('author', f, emptyQuery())).toEqual([
      { value: 'amy', count: 3 },
      { value: 'zed', count: 1 },
    ]);
  });

  it('keeps a picked value listed at 0, and drops the other empty ones', () => {
    const q = { groups: { author: ['zed'], speed: ['low'] }, text: '' };
    const f = facet(prepared, q);
    expect(f.shown).toHaveLength(0);
    expect(valuesFor('author', f, q)).toEqual([
      { value: 'amy', count: 1 },
      { value: 'zed', count: 0 },
    ]);
  });
});

describe('queries', () => {
  it('toggles values on and off, dropping an emptied group', () => {
    const a = toggle(emptyQuery('x'), 'style', 'Dancer');
    expect(a).toEqual({ groups: { style: ['Dancer'] }, text: 'x' });
    expect(toggle(a, 'style', 'Fractal').groups.style).toEqual(['Dancer', 'Fractal']);
    expect(toggle(a, 'style', 'Dancer')).toEqual({ groups: {}, text: 'x' });
  });

  it('is empty with no values and no text', () => {
    expect(isEmpty(emptyQuery(' '))).toBe(true);
    expect(isEmpty({ groups: { star: [] }, text: '' })).toBe(true);
    expect(isEmpty(emptyQuery('a'))).toBe(false);
    expect(isEmpty({ groups: { star: ['starred'] }, text: '' })).toBe(false);
  });

  it('names a query for a smart playlist', () => {
    expect(queryName({ groups: { speed: ['high'], style: ['Dancer/Whirl', 'Fractal'], star: ['starred'] }, text: ' warm ' })).toBe('Dancer › Whirl or Fractal, fast, ★, “warm”');
    expect(queryName(emptyQuery())).toBe('all presets');
  });

  it('labels values in plain words', () => {
    expect(valueLabel('intensity', 'high')).toBe('wild');
    expect(valueLabel('speed', 'low')).toBe('slow');
    expect(valueLabel('style', 'Dancer/Whirl')).toBe('Dancer › Whirl');
    expect(valueLabel('author', 'geiss')).toBe('geiss');
  });

  it('summarises a filter', () => {
    const prepared = prepare([row('A/a.milk'), row('B/b.milk')], null);
    expect(facetSummary(facet(prepared, emptyQuery()), emptyQuery())).toBeNull();
    const q = { groups: { style: ['A'] }, text: '' };
    expect(facetSummary(facet(prepared, q), q)).toBe('1 of 2 presets');
    expect(facetSummary(facet(prepared, emptyQuery('zzz')), emptyQuery('zzz'))).toBe('no presets match');
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, lower-cases and drops repeats', () => {
    expect(parseTags(' Warm Up ,  peak,,warm   up, ')).toEqual(['warm up', 'peak']);
    expect(parseTags('  ')).toEqual([]);
  });
});

describe('rowsFromEntries', () => {
  it('reads style and sub-style from the folders', () => {
    expect(rowsFromEntries([{ path: '/p/Dancer/Whirl/x.milk', name: 'x', group: 'Dancer/Whirl' }])[0]).toMatchObject({
      key: 'Dancer/Whirl/x.milk',
      style: 'Dancer',
      sub_style: 'Whirl',
      title: 'x',
      thumbnail: null,
    });
    expect(rowsFromEntries([{ path: '/p/x.milk', name: 'x', group: '' }])[0]).toMatchObject({ key: 'x.milk', style: '', sub_style: null });
  });
});

describe('tileFor', () => {
  it('moves by a tile across and a row down, clamped', () => {
    expect(tileFor('ArrowRight', 2, 10, 3)).toBe(3);
    expect(tileFor('ArrowLeft', 0, 10, 3)).toBe(0);
    expect(tileFor('ArrowDown', 2, 10, 3)).toBe(5);
    expect(tileFor('ArrowDown', 8, 10, 3)).toBe(9);
    expect(tileFor('ArrowUp', 1, 10, 3)).toBe(0);
    expect(tileFor('ArrowUp', 7, 10, 3)).toBe(4);
  });

  it('lands on a real tile from none', () => {
    expect(tileFor('ArrowRight', -1, 10, 3)).toBe(0);
    expect(tileFor('ArrowDown', -1, 10, 3)).toBe(0);
    expect(tileFor('ArrowUp', -1, 10, 3)).toBe(0);
    expect(tileFor('End', -1, 10, 3)).toBe(9);
  });

  it('pages by rows and jumps to the ends', () => {
    expect(tileFor('PageDown', 0, 100, 2, 5)).toBe(10);
    expect(tileFor('PageUp', 30, 100, 2, 5)).toBe(20);
    expect(tileFor('PageUp', 3, 100, 2, 5)).toBe(0);
    expect(tileFor('Home', 50, 100, 2)).toBe(0);
  });

  it('ignores other keys and handles an empty grid', () => {
    expect(tileFor('Enter', 2, 5, 2)).toBeNull();
    expect(tileFor('ArrowDown', -1, 0, 2)).toBe(-1);
  });
});

describe('debounced', () => {
  // A clock the test moves by hand.
  const fake = () => {
    let now = 0;
    let timers: { at: number; f: () => void; id: number }[] = [];
    let next = 1;
    const clock: Clock = {
      now: () => now,
      setTimeout: (f, ms) => {
        timers.push({ at: now + ms, f, id: next });
        return next++;
      },
      clearTimeout: (id) => {
        timers = timers.filter((t) => t.id !== id);
      },
    };
    const advance = (ms: number) => {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.f();
      }
      now = until;
    };
    return { clock, advance };
  };

  it('calls once after a burst goes quiet', () => {
    const { clock, advance } = fake();
    let calls = 0;
    const f = debounced(() => calls++, 500, 4000, clock);
    for (let i = 0; i < 5; i++) {
      f();
      advance(100);
    }
    expect(calls).toBe(0);
    advance(500);
    expect(calls).toBe(1);
  });

  it('still calls every so often while a burst goes on', () => {
    const { clock, advance } = fake();
    let calls = 0;
    const f = debounced(() => calls++, 500, 4000, clock);
    for (let i = 0; i < 100; i++) {
      f();
      advance(100);
    }
    expect(calls).toBe(2); // at 4 s and 8 s of a 10 s burst
    advance(500);
    expect(calls).toBe(3);
  });

  it('drops a pending call when cancelled', () => {
    const { clock, advance } = fake();
    let calls = 0;
    const f = debounced(() => calls++, 500, 4000, clock);
    f();
    f.cancel();
    advance(5000);
    expect(calls).toBe(0);
  });
});

describe('stepIn', () => {
  const at = (i: number) => lib[i].path;

  it('steps forward and back, wrapping round', () => {
    expect(stepIn(lib, at(1), 1)).toBe(lib[2]);
    expect(stepIn(lib, at(3), 1)).toBe(lib[0]);
    expect(stepIn(lib, at(1), -1)).toBe(lib[0]);
    expect(stepIn(lib, at(0), -1)).toBe(lib[3]);
  });

  it('starts at the first entry when nothing, or something not in the list, is open', () => {
    expect(stepIn(lib, null, 1)).toBe(lib[0]);
    expect(stepIn(lib, 'Elsewhere/Gone.milk', 1)).toBe(lib[0]);
  });

  it('picks at random for 0', () => {
    expect(stepIn(lib, at(0), 0, () => 0.99)).toBe(lib[3]);
    expect(stepIn(lib, at(0), 0, () => 0)).toBe(lib[0]);
  });

  it('gives null for an empty list', () => {
    expect(stepIn([], null, 1)).toBeNull();
    expect(stepIn([], null, 0)).toBeNull();
  });
});
