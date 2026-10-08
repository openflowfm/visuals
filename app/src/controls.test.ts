import { describe, expect, it } from 'vitest';
import { decimals, formatMultiplier, multiplierToPosition, paramOf, plural, POSITION_MAX, POSITION_MIN, positionToMultiplier, range, show } from './controls.ts';
import { PARAMS, type Spec } from './params.ts';

describe('plural', () => {
  it('names one in the singular and every other count in the plural', () => {
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(3, 'item')).toBe('3 items');
    expect(plural(0, 'item')).toBe('0 items');
  });

  it('takes an irregular plural', () => {
    expect(plural(2, 'match', 'matches')).toBe('2 matches');
    expect(plural(1, 'match', 'matches')).toBe('1 match');
  });
});

const spec = (key: string) => Object.values(PARAMS).flat().find((s) => s.key === key)!;

describe('the multiplier taper', () => {
  it('puts 1× at the centre and ¼× and 4× at the ends', () => {
    expect(positionToMultiplier(0)).toBe(1);
    expect(multiplierToPosition(1)).toBe(0);
    expect(positionToMultiplier(POSITION_MIN)).toBe(0.25);
    expect(positionToMultiplier(POSITION_MAX)).toBe(4);
    expect(multiplierToPosition(0.25)).toBe(POSITION_MIN);
    expect(multiplierToPosition(4)).toBe(POSITION_MAX);
  });

  it('gives every doubling the same distance', () => {
    expect(multiplierToPosition(2) - multiplierToPosition(1)).toBeCloseTo(multiplierToPosition(4) - multiplierToPosition(2));
    expect(multiplierToPosition(0.5)).toBeCloseTo(-1);
  });

  it('round-trips', () => {
    for (const m of [0.25, 0.3, 0.5, 0.8, 1, 1.5, 2, 2.8, 4]) expect(positionToMultiplier(multiplierToPosition(m))).toBeCloseTo(m, 10);
  });

  it('snaps to exactly 1× near the centre', () => {
    expect(positionToMultiplier(0.03)).toBe(1);
    expect(positionToMultiplier(-0.03)).toBe(1);
    expect(positionToMultiplier(0.5)).toBeCloseTo(Math.SQRT2);
  });

  it('clamps out-of-range input', () => {
    expect(positionToMultiplier(-9)).toBe(0.25);
    expect(positionToMultiplier(9)).toBe(4);
    expect(positionToMultiplier(Number.NaN)).toBe(1);
    expect(multiplierToPosition(0.01)).toBe(POSITION_MIN);
    expect(multiplierToPosition(0)).toBe(POSITION_MIN);
    expect(multiplierToPosition(-1)).toBe(POSITION_MIN);
    expect(multiplierToPosition(100)).toBe(POSITION_MAX);
    expect(multiplierToPosition(Number.NaN)).toBe(0);
  });

  it('reads as a multiplier', () => {
    expect(formatMultiplier(1)).toBe('1×');
    expect(formatMultiplier(0.5)).toBe('0.5×');
    expect(formatMultiplier(0.25)).toBe('0.25×');
    expect(formatMultiplier(2.83)).toBe('2.8×');
    expect(formatMultiplier(4)).toBe('4×');
  });
});

describe('a setting as a control', () => {
  it('is a float range with its default, like the effects sliders', () => {
    expect(range('trails', 0, 1, 0)).toEqual({ kind: 'float', min: 0, max: 1, defaultValue: 0, name: 'trails' });
    expect(paramOf(spec('zoom'), 1)).toMatchObject({ kind: 'float', min: 0.5, max: 1.5, defaultValue: 1, name: 'zoom' });
  });

  it('stretches to reach what the file says', () => {
    expect(paramOf(spec('sx'), 100)).toMatchObject({ min: 0.5, max: 100 });
    expect(paramOf(spec('zoom'), -2)).toMatchObject({ min: -2, max: 1.5 });
  });

  it('steps whole numbers and menus', () => {
    expect(paramOf(spec('nMotionVectorsX'), 12)).toMatchObject({ kind: 'int', steps: 65 });
    const mode = paramOf(spec('nWaveMode'), 3);
    expect(mode).toMatchObject({ kind: 'enum', steps: 8 });
    expect(mode.items).toHaveLength(8);
  });

  it('reads as its kind wants', () => {
    expect(show(spec('nWaveMode'), 2)).toBe('blob');
    expect(show(spec('bTexWrap'), 1)).toBe('on');
    expect(show(spec('bTexWrap'), 0)).toBe('off');
    expect(show(spec('nMotionVectorsX'), 11.6)).toBe('12');
    expect(show(spec('zoom'), 1.01234)).toBe('1.012');
    expect(show({ ...spec('zoom'), kind: 'float' } as Spec, 12.345)).toBe('12.3');
    expect(decimals(0.5)).toBe('0.5');
  });
});
