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
      EFFECT_LIB.indexOf('vec4 fxChannels('),
    );
    expect(body).not.toContain('for (');
    expect(body).not.toContain('texture(');
    expect(body).toContain('step(vec3(pivot), col)');
  });
});
