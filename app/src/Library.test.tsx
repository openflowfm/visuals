import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LibraryRow, Mine } from './api.ts';
import { prepareRow } from './librarySearch.ts';
import { chipSays, groupSays, valueSays, Values } from './Library.tsx';
import { PresetDrawer, pressedFor } from './PresetDrawer.tsx';
import { Playlists, itemSays, listSays } from './Playlists.tsx';
import { DEFAULT_SETTINGS, manual, type Deck, type Lists } from './playlists.ts';

const row = (key: string): LibraryRow => ({ key, path: `/p/${key}`, hash: '', style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
const p = (key: string, mine?: Mine) => prepareRow(row(key), mine);
const none = () => {};

/** Every attribute `name` in `html`, in order. */
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

describe('the library chips, read aloud', () => {
  it('names the star group in words, not ★', () => {
    expect(groupSays('star')).toBe('starred');
    expect(chipSays('star', 0)).toBe('starred');
    expect(chipSays('style', 2)).toBe('style, 2 picked');
  });

  it('says a value with its count, without the ★', () => {
    expect(valueSays('★ starred', 1)).toBe('starred, 1 preset');
    expect(valueSays('A › warm', 1234)).toBe('A › warm, 1,234 presets');
  });

  it('labels each value with its whole name and state, and the group in words', () => {
    const html = renderToStaticMarkup(
      <Values
        group="style"
        values={[
          { value: 'A', count: 3 },
          { value: 'A/warm', count: 1 },
        ]}
        selected={['A/warm']}
        find=""
        onFind={none}
        onPick={none}
      />,
    );
    expect(attrs(html, 'aria-label')).toEqual(['style values', 'A, 3 presets', 'A › warm, 1 preset']);
    expect(attrs(html, 'aria-pressed')).toEqual(['false', 'true']);
  });

  it('names the star group in words on its values', () => {
    const html = renderToStaticMarkup(<Values group="star" values={[{ value: 'yes', count: 2 }]} selected={[]} find="" onFind={none} onPick={none} />);
    expect(attrs(html, 'aria-label')).toEqual(['starred values', 'starred, 2 presets']);
  });
});

describe('the preset drawer, read aloud', () => {
  const drawer = (chosen: ReturnType<typeof p>[], current: string | null = null) =>
    renderToStaticMarkup(<PresetDrawer chosen={chosen} hiddenByFilter={0} playlists={[]} current={current} onSet={none} onLoad={none} onClose={none} error={null} />);

  it('says a toggle is on for all, some or none', () => {
    const star = (x: { star: boolean }) => x.star;
    expect(pressedFor([p('a', { star: true }), p('b', { star: true })], star)).toBe(true);
    expect(pressedFor([p('a', { star: true }), p('b')], star)).toBe('mixed');
    expect(pressedFor([p('a')], star)).toBe(false);
  });

  it('gives the picture, the close and the toggles word names and states', () => {
    const html = drawer([p('a', { star: true, tags: ['warm'] })]);
    expect(html).toContain('aria-label="close, let go of the selection"');
    expect(html).toContain('aria-label="play a"');
    expect(html).toMatch(/aria-label="star" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="never play" aria-pressed="false"/);
    expect(html).toContain('aria-label="take the tag warm off"');
    expect(html).toMatch(/role="group" aria-label="tags"/);
    expect(html).toMatch(/<span aria-hidden="true">★<\/span>/);
  });

  it('says the picture is playing, and a mixed selection is mixed', () => {
    expect(drawer([p('a')], '/p/a')).toContain('aria-label="a, playing"');
    const html = drawer([p('a', { star: true, tags: ['warm'] }), p('b')]);
    expect(html).toMatch(/aria-label="star" aria-pressed="mixed"/);
    expect(html).toContain('aria-label="take the tag warm off (on 1 of 2)"');
  });
});

describe('the playlists panel, read aloud', () => {
  const item = (name: string, missing = false) => ({ path: `/p/${name}.milk`, name, group: 'g', missing, hash: null });
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
  const lists: Lists = { playlists: [manual('1', 'Warm up', [item('x'), item('y', true)]), { ...manual('2', 'Peak', []), kind: 'smart' }], deck: deck({ playlist: '1', index: 0 }) };

  it('says each row in words', () => {
    expect(listSays(lists.playlists[0], true)).toBe('Warm up, 2 presets, playing');
    expect(listSays(lists.playlists[1], false)).toBe('Peak, smart playlist');
    expect(itemSays(1, item('y', true), false)).toBe('2. y, missing, file not found');
    expect(itemSays(0, item('x'), true)).toBe('1. x, g, playing');
  });

  it('labels the rows, the symbol buttons, the switch and the seconds', () => {
    const html = renderToStaticMarkup(<Playlists lists={lists} current={null} selected="1" onSelect={none} onLists={none} onError={none} />);
    const labels = attrs(html, 'aria-label');
    for (const want of [
      'Warm up, 2 presets, playing',
      'Stop Warm up',
      'Peak, smart playlist',
      'Play Peak',
      '1. x, g, playing',
      'Remove x from Warm up',
      '2. y, missing, file not found',
      'move on by itself',
      'seconds on each preset',
    ])
      expect(labels).toContain(want);
    expect(html).toMatch(/aria-pressed="false" aria-label="move on by itself"|aria-label="move on by itself"[^>]*aria-pressed="false"/);
  });
});
