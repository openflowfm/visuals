import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LibraryRow } from './api.ts';
import { prepareRow } from './librarySearch.ts';
import { LAB_LOOK, TILE, Tile, centreFor, firstLaidOut, homeLook, layout, pickInto, pickOf, rangeAnchor, scrollFor, tileSays, windowOf } from './LibraryGrid.tsx';

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

  it('keeps the lab editor’s look: 4:3 pictures, a title line, 6 px gaps on 8 px padding', () => {
    expect(LAB_LOOK).toEqual({ gap: 6, rowGap: 6, label: 18, padX: 8, padTop: 8, padBottom: 8, aspect: 3 / 4 });
    // (204 − 16 − 6) / 2 = 91 wide; 91 × 3/4 + 18 + 6 = 92.25.
    expect(layout(204, 9795)).toEqual({ columns: 2, tile: 91, rowHeight: 92, rows: 4898 });
    expect(layout(204, 9795, TILE.min, LAB_LOOK)).toEqual(layout(204, 9795));
  });
});

describe('the home’s look (decision 68)', () => {
  it('spaces tiles 12 px across and 16 px down, on the main pane’s padding', () => {
    expect(homeLook()).toMatchObject({ gap: 12, rowGap: 16, padX: 22 });
    expect(homeLook(16).padX).toBe(16);
  });

  it('counts a 16:9 picture and the name and author lines in a row', () => {
    // The main pane at 1440 px with the panel open: 1440 − 220 − 340.
    const l = layout(880, 100, 150, homeLook(22));
    expect(l.columns).toBe(5);
    expect(l.tile).toBeCloseTo((880 - 44 - 4 * 12) / 5);
    expect(l.rowHeight).toBe(Math.round((l.tile * 9) / 16 + 39 + 16));
  });

  it('has three across at 900 px with the panel open', () => {
    // 900 − 184 (the sidebar) − 280 (the panel), on 16 px padding and 124 px tiles.
    expect(layout(436, 100, 124, homeLook(16)).columns).toBe(3);
    expect(layout(436, 100, 150, homeLook(16)).columns).toBe(2);
  });
});

describe('centreFor', () => {
  it('puts the row in the middle of the view, starting the view on a whole row', () => {
    // Row 10 starts at 8 + 1000; its tiles are 94 tall, so its middle is at 1055: 905 would centre it, row 9 starts nearest.
    expect(centreFor(10, 100, 300)).toBe(900);
    // Row 4's middle is at 8 + 600 + 67 = 675; 425 would centre it, row 3 (450) starts nearest.
    expect(centreFor(4, 150, 500, homeLook(22))).toBe(450);
  });

  it('never cuts a row off at the top, and lands within half a row of the middle', () => {
    const look = homeLook();
    for (const [row, height] of [
      [6, 500],
      [40, 731],
      [3, 288],
    ]) {
      const top = centreFor(row, 151, height, look);
      expect(top % 151).toBe(0);
      const middle = look.padTop + row * 151 + (151 - look.rowGap) / 2;
      expect(Math.abs(middle - top - height / 2)).toBeLessThanOrEqual(151 / 2);
    }
  });

  it('goes no higher than the top', () => {
    expect(centreFor(0, 100, 600)).toBe(0);
    expect(centreFor(1, 100, 600, homeLook())).toBe(0);
  });

  it('centres a row the least scroll would leave at the edge of the view', () => {
    const look = homeLook();
    const least = scrollFor(6, 150, 0, 500, look)!;
    const centred = centreFor(6, 150, 500, look);
    const middle = look.padTop + 6 * 150 + (150 - look.rowGap) / 2;
    expect(middle - least).toBeGreaterThan(400);
    expect(Math.abs(middle - centred - 250)).toBeLessThanOrEqual(75);
  });
});

describe("the home's grid beside a scrollbar", () => {
  it('keeps 3 columns at 900px when a classic scrollbar takes 15px, giving it the right padding', () => {
    // The main pane at 900px: 900 - 184 - 280 = 436, on a 16px padding.
    expect(layout(436 - 15, 9795, 124, homeLook(16)).columns).toBe(2);
    const look = homeLook(16, 15);
    expect(look.padRight).toBe(1);
    expect(layout(436 - 15, 9795, 124, look).columns).toBe(3);
    // An overlay scrollbar takes nothing, and the padding stays even.
    expect(homeLook(16, 0).padRight).toBe(16);
    expect(homeLook(16, 40).padRight).toBe(0);
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

  it('keeps the lab editor’s tile: its picture and title, no author line', () => {
    expect(html).toContain('class="lib-tile"');
    expect(html).toContain('<span class="lib-title">aurora</span>');
    expect(html).not.toContain('tile-by');
  });
});

describe('a tile on the home', () => {
  const row: LibraryRow = {
    key: 'k',
    path: '/p/Geiss - 3d tunnel.milk',
    hash: '',
    style: 'A',
    sub_style: null,
    authors: ['geiss', 'flexi'],
    title: '42',
    thumbnail: 'thumb:k',
    look: null,
    starter: false,
  };
  const p = prepareRow(row, undefined);
  const tile = (playing: boolean, failed = false) =>
    renderToStaticMarkup(createElement(Tile, { id: 't', index: 0, p, active: false, selected: true, playing, failed, intoName: 'Mine', onPick: () => {}, onAdd: () => {}, home: true }));

  it('is the shared tile, named by its file when its title is a number, with its authors under it', () => {
    const html = tile(false);
    expect(html).toContain('class="tile"');
    expect(html).not.toContain('lib-tile');
    expect(html).toContain('<span class="tile-name">Geiss - 3d tunnel</span><span class="tile-by">geiss &amp; flexi</span>');
  });

  it('says the same to a screen reader as the lab’s', () => {
    expect(tile(true)).toContain(`role="option" aria-selected="true" aria-label="${tileSays(p, true, false).replace(/&/g, '&amp;')}"`);
  });

  it('marks playing with the level badge, a failure with its mark, and keeps + out of what is read', () => {
    expect(tile(true)).toContain('class="tile-live"');
    expect(tile(false)).not.toContain('tile-live');
    expect(tile(false, true)).toContain('tile-failed');
    expect(tile(false)).toMatch(/<button type="button" class="tile-add" tabindex="-1" aria-hidden="true"/);
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
