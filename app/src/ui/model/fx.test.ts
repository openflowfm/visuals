import { describe, expect, it } from 'vitest';
import { effectKey } from './fx.ts';

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
