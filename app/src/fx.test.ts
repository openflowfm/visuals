import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { effectKey, formatMultiplier, multiplierToPosition, POSITION_MAX, POSITION_MIN, positionToMultiplier } from './fx.ts';

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

describe('effectKey', () => {
  it('holds strobe, punch and freeze while their keys are down', () => {
    expect(effectKey('s', false)).toEqual({ hold: 'strobe' });
    expect(effectKey('p', false)).toEqual({ hold: 'punch' });
    expect(effectKey('F', false)).toEqual({ hold: 'freeze' });
  });

  it('latches them with Shift', () => {
    expect(effectKey('S', true)).toEqual({ action: { kind: 'strobe', on: null } });
    expect(effectKey('F', true)).toEqual({ action: { kind: 'freeze', on: null } });
  });

  it('toggles or steps the rest', () => {
    expect(effectKey('b', false)).toEqual({ action: { kind: 'blackout', on: null } });
    expect(effectKey('t', false)).toEqual({ action: { kind: 'tap' } });
    expect(effectKey('i', false)).toEqual({ action: { kind: 'invert', on: null } });
    expect(effectKey('m', false)).toEqual({ action: { kind: 'mirror', mode: null } });
    expect(effectKey('H', false)).toEqual({ action: { kind: 'hold', on: null } });
    expect(effectKey('0', false)).toEqual({ action: { kind: 'fx_reset' } });
  });

  it('leaves every other key alone', () => {
    for (const k of ['r', 'ArrowRight', 'Escape', 'x', ' ', '1']) expect(effectKey(k, false)).toBeNull();
  });
});
