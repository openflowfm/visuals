import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresetTile, tileBy, tileName } from './PresetTile.tsx';

describe('tileName', () => {
  it('keeps a title that says something', () => {
    expect(tileName('Aurora borealis', '/p/Geiss - aurora.milk')).toBe('Aurora borealis');
    expect(tileName('void', '/p/x.milk')).toBe('void');
  });

  it('shows the file name for a title that is only a number', () => {
    expect(tileName('12345', '/pack/Flexi - mindblob 12345.milk')).toBe('Flexi - mindblob 12345');
    expect(tileName('3.14', '/pack/martin - pi.milk')).toBe('martin - pi');
  });

  it('shows the file name for a title under four characters', () => {
    expect(tileName('a1', '/pack/Rovastar - a1 (remix).MILK')).toBe('Rovastar - a1 (remix)');
    expect(tileName('  ', 'C:\\pack\\shifter - wave.milk')).toBe('shifter - wave');
  });

  it('keeps the title when there is no file name to show', () => {
    expect(tileName('7', '')).toBe('7');
  });
});

describe('tileBy', () => {
  it('joins the authors with " & ", else says the style', () => {
    expect(tileBy(['flexi', 'rovastar'], 'Geometric')).toBe('flexi & rovastar');
    expect(tileBy(['geiss'], 'Geometric')).toBe('geiss');
    expect(tileBy([], 'Geometric')).toBe('Geometric');
  });
});

describe('PresetTile', () => {
  const html = (playing: boolean) => renderToStaticMarkup(createElement(PresetTile, { as: 'li', className: 'home-tile', thumbnail: 'thumb:x', name: 'Aurora', by: 'geiss', playing, star: true }));

  it('is a 16:9 picture with a name and an author line under it', () => {
    expect(html(false)).toMatch(/^<li class="tile home-tile"><div class="tile-pic"><img src="thumb:x"/);
    expect(html(false)).toContain('<span class="tile-name">Aurora</span><span class="tile-by">geiss</span>');
    expect(html(false)).toContain('tile-star');
  });

  it('marks the one playing, with a level badge', () => {
    expect(html(true)).toContain('data-playing=""');
    expect(html(true)).toContain('class="tile-live"');
    expect(html(false)).not.toContain('data-playing');
    expect(html(false)).not.toContain('tile-live');
  });
});
