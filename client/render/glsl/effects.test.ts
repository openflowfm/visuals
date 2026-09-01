import { describe, expect, it } from 'vitest';
import { EFFECT_LIB } from './effects.ts';

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/**
 * The highlight shoulder, mirrored.
 *
 * One channel of it, because it is per-channel by design: a highlight that
 * rolls off should desaturate as it climbs, which is the thing an eye reads as
 * brightness past the top of the range.
 */
const shoulder = (value: number, knee: number, amount: number): number => {
  const pivot = mix(0.35, 0.92, clamp(knee));
  const headroom = 1 - pivot;
  const roll = mix(0.6, 4.5, clamp(amount));
  if (value < pivot) return value;
  const over = Math.max(value - pivot, 0) * roll;
  return clamp(pivot + (headroom * over) / (over + headroom));
};

describe('rolling the highlights off instead of clipping them', () => {
  it('leaves everything below the knee exactly where it arrived', () => {
    // The whole difference between this and a levels curve. A shoulder that
    // moved the midtones would be a contrast control wearing the wrong name.
    const pivot = mix(0.35, 0.92, 0.65);
    for (let step = 0; step <= 20; step++) {
      const at = (step / 20) * pivot * 0.999;
      expect(shoulder(at, 0.65, 0.55)).toBe(at);
    }
  });

  it('is continuous at the knee, so no edge appears where it starts', () => {
    const pivot = mix(0.35, 0.92, 0.65);
    const below = shoulder(pivot - 1e-6, 0.65, 0.55);
    const above = shoulder(pivot + 1e-6, 0.65, 0.55);
    expect(Math.abs(above - below)).toBeLessThan(1e-4);
  });

  it('never reaches white, which is what makes it a shoulder', () => {
    // Asymptotic: the curve approaches 1 and arrives only at infinity, so a
    // picture cannot develop a flat area with a hard boundary round it.
    expect(shoulder(1, 0.65, 1)).toBeLessThan(1);
    expect(shoulder(4, 0.65, 1)).toBeLessThan(1);
    expect(shoulder(4, 0.65, 1)).toBeGreaterThan(shoulder(1, 0.65, 1));
  });

  it('rises monotonically, so nothing brighter comes out darker', () => {
    let previous = -1;
    for (let step = 0; step <= 60; step++) {
      const lit = shoulder((step / 40) * 1.5, 0.65, 0.55);
      expect(lit).toBeGreaterThanOrEqual(previous);
      previous = lit;
    }
  });

  it('is one expression with no loop and no sample in it', () => {
    const body = EFFECT_LIB.slice(
      EFFECT_LIB.indexOf('vec4 fxHighlights('),
      EFFECT_LIB.indexOf('vec4 fxBloom('),
    );
    expect(body).not.toContain('for (');
    expect(body).not.toContain('texture(');
    expect(body).toContain('step(vec3(pivot), col)');
  });
});

/** The spill, mirrored: one channel of colour and the coverage it carries. */
const spill = (
  base: readonly [number, number, number, number],
  gathered: readonly [number, number, number, number],
  floorAt: number,
  gain: number,
): [number, number, number, number] => {
  const over = [0, 1, 2].map((i) => Math.max(gathered[i] - floorAt, 0) * gain);
  const most = Math.max(...over);
  return [base[0] + over[0], base[1] + over[1], base[2] + over[2], Math.min(1, base[3] + most)];
};

describe('light that did not fit in a pixel, put back around it', () => {
  it('takes nothing at all from a picture that stayed inside the range', () => {
    // The whole difference between a bloom and a blur. Before the vocabulary
    // could carry anything above one this harvested mid-greys, so the resting
    // position of the control was a soft-focus filter that nobody asked for.
    const base: [number, number, number, number] = [0.6, 0.8, 0.9, 1];
    const [r, g, b, a] = spill(base, [0.7, 0.9, 0.95, 1], 1, 1);
    expect([r, g, b]).toEqual([0.6, 0.8, 0.9]);
    expect(a).toBe(1);
  });

  it('spreads exactly the excess, and in the channel that had it', () => {
    const [r, g, b] = spill([0.2, 0.2, 0.2, 0.3], [2.5, 1.0, 0.4, 1], 1, 0.5);
    expect(r).toBeCloseTo(0.2 + 1.5 * 0.5, 6);
    expect(g).toBeCloseTo(0.2, 6);
    expect(b).toBeCloseTo(0.2, 6);
  });

  it('lifts coverage with colour, so the halo composites over what is behind', () => {
    // A halo that brightened the frame without covering any of it disappears
    // the moment the result is laid over anything: light is both the thing you
    // see and the thing that hides what is behind it.
    const [, , , a] = spill([0, 0, 0, 0], [3, 3, 3, 1], 1, 0.4);
    expect(a).toBeCloseTo(0.8, 6);
    // And never past full, whatever it was handed.
    expect(spill([0, 0, 0, 0.9], [9, 9, 9, 1], 1, 1)[3]).toBe(1);
  });

  it('is one expression with no loop and no sample in it', () => {
    const body = EFFECT_LIB.slice(
      EFFECT_LIB.indexOf('vec4 fxBloom('),
      EFFECT_LIB.indexOf('vec4 fxChannels('),
    );
    expect(body).not.toContain('for (');
    expect(body).not.toContain('texture(');
  });
});
