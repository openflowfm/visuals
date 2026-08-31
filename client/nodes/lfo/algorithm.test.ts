import { describe, expect, it } from 'vitest';
import { LFO_SHAPES } from '../../../protocol.ts';
import {
  LFO_SYNC_LABELS,
  lfoClock,
  lfoCyclesPerBeat,
  lfoHz,
  lfoIdentity,
  lfoRateLabel,
  lfoValue,
} from './algorithm.ts';

describe('LFO timing contract', () => {
  it('quantizes the full travel onto straight note periods', () => {
    expect(LFO_SYNC_LABELS).toEqual(['4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32']);
    expect(LFO_SYNC_LABELS.map((_label, index) => lfoCyclesPerBeat(index / 7))).toEqual([
      1 / 16,
      1 / 8,
      1 / 4,
      1 / 2,
      1,
      2,
      4,
      8,
    ]);
    expect(lfoRateLabel(5 / 7, true)).toBe('1/8');
  });

  it('maps free rate exponentially with one hertz at the midpoint', () => {
    expect(lfoHz(0)).toBeCloseTo(0.05);
    expect(lfoHz(0.5)).toBeCloseTo(1);
    expect(lfoHz(1)).toBeCloseTo(20);
    expect(lfoRateLabel(0.5, false)).toBe('1.0 Hz');
  });

  it('switches clocks at one half and applies a whole-cycle phase offset', () => {
    expect(lfoClock(3, 10, 0.5, 1, 0.25)).toBeCloseTo(3.25);
    expect(lfoClock(3, 10, 0.5, 0, 0.25)).toBeCloseTo(10.25);
  });
});

describe('LFO waveform contract', () => {
  it('pins canonical samples for every continuous shape', () => {
    const id = lfoIdentity('lfo');
    expect(lfoValue('sine', 0.25, id)).toBeCloseTo(1);
    expect(lfoValue('triangle', 0.25, id)).toBeCloseTo(0.5);
    expect(lfoValue('saw', 0.25, id)).toBeCloseTo(0.25);
    expect(lfoValue('square', 0.25, id)).toBe(0);
    expect(lfoValue('square', 0.75, id)).toBe(1);
  });

  it('holds one seeded value for a cycle and gives nodes distinct sequences', () => {
    const a = lfoIdentity('a');
    const b = lfoIdentity('b');
    expect(lfoValue('sample-hold', 4.1, a)).toBe(lfoValue('sample-hold', 4.9, a));
    expect(lfoValue('sample-hold', 4.1, a)).not.toBe(lfoValue('sample-hold', 5.1, a));
    expect(lfoValue('sample-hold', 4.1, a)).not.toBe(lfoValue('sample-hold', 4.1, b));
    for (const shape of LFO_SHAPES) {
      expect(lfoValue(shape, 13.37, a)).toBeGreaterThanOrEqual(0);
      expect(lfoValue(shape, 13.37, a)).toBeLessThanOrEqual(1);
    }
  });
});
