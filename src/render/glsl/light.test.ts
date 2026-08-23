import { describe, expect, it } from 'vitest';
import { LIGHT_LIB, LIGHT_WORK } from './light.ts';

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;
const smoothstep = (lower: number, upper: number, value: number): number => {
  const amount = clamp((value - lower) / (upper - lower));
  return amount * amount * (3 - 2 * amount);
};

/**
 * Independent scalar form of the lamp's closed-form coverage — the one light
 * with no lattice inside, so a CPU mirror can reproduce it exactly.
 */
const lampLit = (distance: number, e: number, carry: number, soft: number): number => {
  const radius = mix(0.22, 1.35, clamp(carry, 0, 1));
  const q = distance / radius;
  const window = 1 - smoothstep(0.55, 1.0, q);
  const halo = window / (1 + 9 * q * q);
  const core = Math.exp((-q * q) / Math.max(0.0045, soft * soft * 0.22));
  return clamp((halo + core) * mix(0.55, 1.15, e));
};

describe('the lamp, mirrored', () => {
  it('is brightest at its centre and dies monotonically along a ray', () => {
    let previous = Infinity;
    for (let step = 0; step <= 20; step++) {
      const lit = lampLit((step / 20) * 1.5, 0.5, 0.5, 0.4);
      expect(lit).toBeLessThanOrEqual(previous);
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThanOrEqual(1);
      previous = lit;
    }
  });

  it('goes fully dark past its windowed reach, so a lamp composes', () => {
    // The window closes at q = 1: distance = radius. Beyond it the halo is
    // exactly zero and only the (already vanishing) core tail remains.
    const radius = mix(0.22, 1.35, 0.5);
    expect(lampLit(radius * 1.05, 1, 0.5, 0.4)).toBeLessThan(0.01);
  });

  it('carries further when told to', () => {
    const at = 0.6;
    expect(lampLit(at, 0.5, 0.9, 0.4)).toBeGreaterThan(lampLit(at, 0.5, 0.1, 0.4));
  });

  it('spends energy on brightness alone', () => {
    const dim = lampLit(0.2, 0, 0.5, 0.4);
    const loud = lampLit(0.2, 1, 0.5, 0.4);
    expect(loud).toBeGreaterThan(dim);
    // Same footprint: past the window, energy has nothing left to brighten.
    expect(lampLit(1.4, 1, 0.5, 0.4)).toBeLessThan(0.01);
  });
});

describe('the light library holds to its declared work', () => {
  it('defines exactly the four modes the table prices', () => {
    for (const mode of Object.keys(LIGHT_WORK)) {
      expect(LIGHT_LIB).toContain(`vec4 light_${mode}(`);
    }
  });

  it('borrows the field lattice instead of shipping loops of its own', () => {
    // The charged work is the borrowed helpers': two gradient-noise octaves in
    // the beam (2 × 4 corners), one fBm in the shafts (4 × 4), two Worley
    // reads in the caustics (2 × 9). A `for` here would be work the table
    // does not know about.
    expect(LIGHT_LIB).not.toContain('for (');
    expect((LIGHT_LIB.match(/fieldGradientNoise\(/g) ?? []).length).toBe(LIGHT_WORK.beam / 4);
    expect((LIGHT_LIB.match(/fieldFbm\(/g) ?? []).length).toBe(LIGHT_WORK.shafts / 16);
    expect((LIGHT_LIB.match(/fieldWorleyF1\(/g) ?? []).length).toBe(LIGHT_WORK.caustics / 9);
  });
});
