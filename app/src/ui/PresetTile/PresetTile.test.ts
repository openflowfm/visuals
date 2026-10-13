import { describe, expect, it } from 'vitest';
import { tileBy, tileName } from './PresetTile';

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
