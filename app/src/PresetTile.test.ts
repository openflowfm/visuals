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

  it('keeps a short name that is a word, and shows the file name for an empty title', () => {
    expect(tileName('Orb', '/pack/Geiss - Orb.milk')).toBe('Orb');
    expect(tileName('a1', '/pack/Rovastar - a1 (remix).MILK')).toBe('a1');
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

  it('leaves out the index\'s "unknown" author', () => {
    expect(tileBy(['unknown'], 'Hypnotic')).toBe('Hypnotic');
    expect(tileBy(['Unknown', 'isosceles'], 'Dancer')).toBe('isosceles');
  });
});

describe('PresetTile', () => {
  const html = (playing: boolean) => renderToStaticMarkup(createElement(PresetTile, { as: 'li', className: 'home-tile', thumbnail: 'thumb:x', name: 'Aurora', by: 'geiss', playing, star: true }));

  it('is a 16:9 picture with its name and author on it, nothing under it', () => {
    expect(html(false)).toMatch(/^<li class="tile home-tile"><div class="tile-pic"><img src="thumb:x"/);
    expect(html(false)).toContain('<span class="tile-caption"><span class="tile-name">Aurora</span><span class="tile-by">geiss</span></span>');
    expect(html(false)).toMatch(/<\/div><\/li>$/);
    expect(html(false)).toContain('tile-star');
  });

  it('marks the one playing, with level bars before its name', () => {
    expect(html(true)).toContain('data-playing=""');
    expect(html(true)).toMatch(/<span class="tile-name"><span class="tile-live" aria-hidden="true">(<i><\/i>){4}<\/span>Aurora<\/span>/);
    expect(html(false)).not.toContain('data-playing');
    expect(html(false)).not.toContain('tile-live');
  });

  it('leaves out an empty author line, and puts the moving preset between the thumbnail and the name', () => {
    const out = renderToStaticMarkup(createElement(PresetTile, { thumbnail: 'thumb:x', name: 'Aurora', by: '', motion: createElement('canvas', { className: 'tile-motion' }) }));
    expect(out).not.toContain('tile-by');
    expect(out).toMatch(/<img [^>]*\/><canvas class="tile-motion"><\/canvas><span class="tile-caption">/);
  });
});
