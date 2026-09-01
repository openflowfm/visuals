import { describe, expect, it } from 'vitest';
import { hash } from '../scalar.ts';
import { VARY_LIB } from './vary.ts';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** The scalar form of the rolls, which hold no loop and read no picture. */
const varyKey = (n: number, steps: number): number => {
  const s = Math.floor(clamp(steps) * 48);
  const t = clamp(n);
  return s < 1 ? t : (Math.floor(t * s) + 0.5) / s;
};
const even = (n: number, steps: number, seed = 0.37): number => {
  const key = varyKey(n, steps);
  return hash(key * 91.7 + 3.1, key * 13.3 - 7.9, seed);
};
const few = (n: number, steps: number, seed = 0.37): number => {
  const roll = even(n, steps, seed);
  return roll * roll * roll;
};

const across = (roll: (n: number, steps: number) => number, steps: number, count = 512): number[] =>
  Array.from({ length: count }, (_, i) => roll(i / count, steps));
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('an ordered number dealt into an unordered one', () => {
  it('is stable: the same copy is dealt the same number every time', () => {
    // The whole reason this is a hash and not a random. A roll that moved
    // between frames would be a flicker, and a flicker is what people reach for
    // `lfo` to get — deliberately, at a rate they chose.
    for (const at of [0, 0.17, 0.5, 0.83, 1]) {
      expect(even(at, 0.4)).toBe(even(at, 0.4));
      expect(few(at, 0.4)).toBe(few(at, 0.4));
    }
  });

  it('gives neighbouring copies nothing to do with each other', () => {
    // Wire a copy number straight into a control and what comes out is a ramp
    // across the repeat: arm two brighter than arm one, always. The point of
    // the node is to break exactly that, so adjacent steps must not correlate.
    const steps = 0.34; // sixteen bands
    const band = (i: number) => even((i + 0.5) / 16, steps);
    let rises = 0;
    for (let i = 0; i < 15; i++) if (band(i + 1) > band(i)) rises += 1;
    // A ramp would rise fifteen times out of fifteen.
    expect(rises).toBeGreaterThan(3);
    expect(rises).toBeLessThan(12);
  });

  it('cuts the number into bands, so a whole segment shares one roll', () => {
    const steps = 0.25; // twelve bands, each a twelfth wide
    expect(even(0.01, steps)).toBe(even(0.07, steps));
    expect(even(0.01, steps)).not.toBe(even(0.2, steps));
    // And at zero steps every value gets its own, which is what a continuous
    // input wants.
    expect(even(0.01, 0)).not.toBe(even(0.011, 0));
  });

  it('keeps `few` mostly dark, which is what makes a highlight readable', () => {
    // An even roll across sixteen arms puts half of them in the top half, and a
    // ring where half the arms are burning has no highlight in it at all — it
    // reads as a white ring. Measured, that came back at a saturation of 0.26
    // against the 0.55 the footage holds.
    // Relative, because sixteen bands is sixteen samples and the sample mean of
    // a cube wanders: what has to hold is that the weighted roll sits well
    // below the flat one, not that it lands on a particular number.
    expect(mean(across(few, 0.34))).toBeLessThan(mean(across(even, 0.34)) * 0.7);
    // Over the whole continuous range it settles on the cube's own mean.
    expect(mean(across(few, 0))).toBeCloseTo(0.25, 1);
    expect(mean(across(even, 0))).toBeCloseTo(0.5, 1);
    // Still reaching the top, or it would be a dimmer rather than a chooser.
    expect(Math.max(...across(few, 0.34))).toBeGreaterThan(0.6);
  });

  it('never leaves the unit range either mode', () => {
    for (const steps of [0, 0.2, 0.55, 1]) {
      for (const roll of [even, few]) {
        for (const at of across(roll, steps, 64)) {
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the vary library is arithmetic, and priced as such', () => {
  it('holds no loop and reads no picture, so it costs what a math node costs', () => {
    expect(VARY_LIB).not.toContain('for (');
    expect(VARY_LIB).not.toContain('texture(');
  });

  it('offers one roll per mode', () => {
    for (const mode of ['even', 'few']) expect(VARY_LIB).toContain(`float vary_${mode}(`);
  });
});
