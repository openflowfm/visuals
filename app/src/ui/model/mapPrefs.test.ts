import { describe, expect, it } from 'vitest';
import { DEFAULT_AXES } from './field';
import { readAxes } from './mapPrefs';

describe('readAxes', () => {
  it('reads a whole choice', () => {
    expect(readAxes('{"across":"intensity","up":"hue","colour":"style"}')).toEqual({ across: 'intensity', up: 'hue', colour: 'style' });
  });

  it('takes the default for nothing, bad JSON or not an object', () => {
    expect(readAxes(null)).toEqual(DEFAULT_AXES);
    expect(readAxes('')).toEqual(DEFAULT_AXES);
    expect(readAxes('{across')).toEqual(DEFAULT_AXES);
    expect(readAxes('"speed"')).toEqual(DEFAULT_AXES);
    expect(readAxes('[1,2]')).toEqual(DEFAULT_AXES);
    expect(readAxes('null')).toEqual(DEFAULT_AXES);
  });

  it('fills a partial choice from the default, field by field', () => {
    expect(readAxes('{"across":"rating"}')).toEqual({ across: 'rating', up: 'brightness', colour: 'hue' });
    expect(readAxes('{"colour":"rating"}')).toEqual({ ...DEFAULT_AXES, colour: 'rating' });
  });

  it('drops unknown ids', () => {
    expect(readAxes('{"across":"loudness","up":"style","colour":"mood"}')).toEqual({ across: 'speed', up: 'style', colour: 'hue' });
    expect(readAxes('{"across":3,"up":true,"colour":null}')).toEqual(DEFAULT_AXES);
  });

  it('never keeps the same axis both ways', () => {
    expect(readAxes('{"across":"hue","up":"hue"}')).toEqual({ across: 'hue', up: 'brightness', colour: 'hue' });
    expect(readAxes('{"across":"brightness","up":"brightness"}')).toEqual({ across: 'brightness', up: 'speed', colour: 'hue' });
  });
});
