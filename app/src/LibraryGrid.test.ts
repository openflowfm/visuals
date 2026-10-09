import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LibraryRow } from './api.ts';
import { prepareRow } from './librarySearch.ts';
import { TILE, Tile, firstLaidOut, layout, pickInto, pickOf, rangeAnchor, scrollFor, tileSays, windowOf } from './LibraryGrid.tsx';

describe('layout', () => {
  it('fits as many tiles across as their narrowest allows', () => {
    // The library column is 220 px: two tiles across, with or without a 15 px scrollbar.
    const l = layout(204, 9795);
    expect(l.columns).toBe(2);
    expect(layout(219, 9795).columns).toBe(2);
    expect(l.tile).toBeGreaterThanOrEqual(TILE.min);
    expect(l.rows).toBe(4898);
    expect(l.rowHeight).toBe(Math.round((l.tile * 3) / 4 + TILE.label + TILE.gap));
    expect(layout(1000, 10).columns).toBe(11);
  });

  it('takes wider tiles where there is room, as the home does', () => {
    const l = layout(1000, 10, 150);
    expect(l.columns).toBe(6);
    expect(l.tile).toBeGreaterThanOrEqual(150);
    expect(l.rows).toBe(2);
  });

  it('keeps one column when there is no room, and no rows for no tiles', () => {
    expect(layout(0, 5)).toMatchObject({ columns: 1, rows: 5 });
    expect(layout(220, 0).rows).toBe(0);
  });
});

describe('windowOf', () => {
  it('draws the rows in view and a few either side', () => {
    expect(windowOf(0, 300, 100, 1000)).toEqual({ first: 0, last: 6 });
    expect(windowOf(5000, 300, 100, 1000)).toEqual({ first: 47, last: 56 });
    expect(windowOf(99_900, 300, 100, 1000)).toEqual({ first: 996, last: 999 });
  });

  it('draws a little before the view is measured, and nothing for no rows', () => {
    expect(windowOf(0, 0, 100, 1000, 0)).toEqual({ first: 0, last: 1 });
    expect(windowOf(0, 300, 100, 0)).toEqual({ first: 0, last: -1 });
  });

  it('draws a few hundred tiles at most for the whole pack', () => {
    const l = layout(220, 9795);
    const { first, last } = windowOf(200_000, 800, l.rowHeight, l.rows);
    expect((last - first + 1) * l.columns).toBeLessThan(60);
  });
});

describe('scrollFor', () => {
  it('scrolls up to a row above the view and down to one below it', () => {
    expect(scrollFor(2, 100, 1000, 300)).toBe(200);
    const down = scrollFor(20, 100, 0, 300)!;
    expect(down).toBe(TILE.pad + 2000 + 100 - TILE.gap + TILE.pad - 300);
  });

  it('leaves a row already in view', () => {
    expect(scrollFor(1, 100, 0, 300)).toBeNull();
  });
});

describe('pickInto', () => {
  const row = (key: string): LibraryRow => ({ key, path: `/p/${key}`, hash: '', style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
  const shown = ['a', 'b', 'c', 'd', 'e'].map((k) => prepareRow(row(k), undefined));

  it('selects just the tile a plain click loads', () => {
    expect(pickInto(['a', 'c'], shown, 1, 'load', 'a')).toEqual(['b']);
  });

  it('adds or takes out a ⌘-clicked tile', () => {
    expect(pickInto(['a'], shown, 2, 'toggle', 'a')).toEqual(['a', 'c']);
    expect(pickInto(['a', 'c'], shown, 2, 'toggle', 'a')).toEqual(['a']);
  });

  it('selects a run from the anchor with ⇧, either way', () => {
    expect(pickInto(['b'], shown, 3, 'range', 'b')).toEqual(['b', 'c', 'd']);
    expect(pickInto(['e'], shown, 1, 'range', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('shrinks the run when ⇧ moves back towards the anchor', () => {
    const grown = pickInto(['b'], shown, 4, 'range', 'b');
    expect(grown).toEqual(['b', 'c', 'd', 'e']);
    expect(pickInto(grown, shown, 2, 'range', 'b')).toEqual(['b', 'c']);
  });

  it('selects just the tile when the anchor is gone', () => {
    expect(pickInto(['x'], shown, 1, 'range', 'x')).toEqual(['b']);
    expect(pickInto([], shown, 1, 'range', null)).toEqual(['b']);
  });
});

describe('rangeAnchor', () => {
  const row = (key: string): LibraryRow => ({ key, path: `/p/${key}`, hash: '', style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
  const shown = ['a', 'b', 'c'].map((k) => prepareRow(row(k), undefined));

  it('runs the first ⇧ move from the highlighted tile', () => {
    expect(rangeAnchor(null, 'b', shown)).toBe('b');
    expect(pickInto([], shown, 2, 'range', rangeAnchor(null, 'b', shown))).toEqual(['b', 'c']);
  });

  it('keeps an anchor still shown, and drops one the filter hid', () => {
    expect(rangeAnchor('a', 'c', shown)).toBe('a');
    expect(rangeAnchor('gone', 'c', shown)).toBe('c');
  });
});

describe('firstLaidOut', () => {
  it('is true once, when the grid first has a size and rows', () => {
    expect(firstLaidOut(false, 0, 10)).toBe(false);
    expect(firstLaidOut(false, 220, 0)).toBe(false);
    expect(firstLaidOut(false, 220, 10)).toBe(true);
    expect(firstLaidOut(true, 220, 10)).toBe(false);
  });
});

describe('a preset that failed', () => {
  const row: LibraryRow = { key: 'k', path: '/p/broken.milk', hash: '', style: 'A', sub_style: null, authors: [], title: 'broken', thumbnail: null, look: null, starter: false };
  const p = prepareRow(row, undefined);
  const tile = (failed: boolean) =>
    renderToStaticMarkup(createElement(Tile, { id: 't', index: 0, p, active: false, selected: false, playing: false, failed, intoName: null, onPick: () => {}, onAdd: () => {} }));

  it('says it was skipped in live', () => {
    expect(tileSays(p, false, true)).toContain('didn’t open — skipped in live');
    expect(tileSays(p, false, false)).not.toContain('skipped');
  });

  it('is marked on its tile', () => {
    expect(tile(true)).toContain('data-failed=""');
    expect(tile(true)).toContain('lib-failed');
    expect(tile(true)).toContain('skipped in live');
    expect(tile(false)).not.toContain('data-failed');
    expect(tile(false)).not.toContain('lib-failed');
  });
});

describe('a tile, read aloud', () => {
  const row: LibraryRow = { key: 'k', path: '/p/aurora.milk', hash: '', style: 'A', sub_style: null, authors: ['geiss'], title: 'aurora', thumbnail: null, look: null, starter: false };
  const p = prepareRow(row, undefined);
  const html = renderToStaticMarkup(createElement(Tile, { id: 't', index: 0, p, active: true, selected: false, playing: true, failed: false, intoName: 'Mine', onPick: () => {}, onAdd: () => {} }));

  it('is named by what it says, not by its picture and buttons', () => {
    expect(html).toContain(`role="option" aria-selected="false" aria-label="${tileSays(p, true, false)}"`);
    expect(tileSays(p, true, false)).toBe('aurora — A, by geiss · playing');
  });

  it('keeps its + out of what is read: the grid adds the active tile with the + key', () => {
    expect(html).toContain('class="wdg wdg-button lib-add" aria-hidden="true"');
  });
});

describe('pickOf', () => {
  it('reads the modifiers', () => {
    expect(pickOf({ metaKey: false, ctrlKey: false, shiftKey: false })).toBe('load');
    expect(pickOf({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe('toggle');
    expect(pickOf({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe('toggle');
    expect(pickOf({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe('range');
  });
});
