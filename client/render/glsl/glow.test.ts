import { describe, expect, it } from 'vitest';
import { GLOW_LIB } from './glow.ts';

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/** The scalar form of the falloffs, which are closed and hold no lattice. */
const reach = (halo: number): number => 0.004 * Math.pow(60, clamp(halo));
const neon = (d: number, e: number, core: number, halo: number): number => {
  const q = Math.max(d, 0) / reach(halo);
  const body = 1 / (1 + q * q * 8);
  const width = mix(0.1, 0.85, clamp(core));
  const hot = Math.exp(-(q * q) / (width * width));
  return clamp((body * 0.85 + hot) * mix(0.65, 1.15, e));
};
const band = (d: number, e: number, away: number, halo: number): number =>
  clamp(
    Math.exp(-Math.pow(Math.abs(Math.max(d, 0) - clamp(away) * 0.4) / reach(halo), 2) * 0.7) *
      mix(0.6, 1.15, e),
  );

describe('a distance becoming light', () => {
  it('is brightest on the shape and dies away from it', () => {
    let previous = Infinity;
    for (let step = 0; step <= 24; step++) {
      const lit = neon((step / 24) * 0.3, 0.5, 0.35, 0.35);
      expect(lit).toBeLessThanOrEqual(previous);
      expect(lit).toBeGreaterThanOrEqual(0);
      previous = lit;
    }
  });

  it('reaches two orders of magnitude, which is why the control is exponential', () => {
    // A hairline and a wash are both wanted. Spread linearly, everything
    // usable would sit in the bottom twentieth of the control.
    expect(reach(1) / reach(0)).toBeCloseTo(60, 5);
    expect(reach(0)).toBeLessThan(0.01);
    expect(reach(1)).toBeGreaterThan(0.2);
  });

  it('carries further when the halo is opened, at every distance', () => {
    for (const at of [0.01, 0.05, 0.12]) {
      expect(neon(at, 0.5, 0.35, 0.8)).toBeGreaterThan(neon(at, 0.5, 0.35, 0.2));
    }
  });

  it('spends the core on the filament rather than on the reach', () => {
    const near = 0.004;
    const far = 0.05;
    // A wider core lifts what is close to the shape...
    expect(neon(near, 0.5, 0.9, 0.35)).toBeGreaterThan(neon(near, 0.5, 0.05, 0.35));
    // ...and leaves the tail where the halo put it.
    expect(neon(far, 0.5, 0.9, 0.35)).toBeCloseTo(neon(far, 0.5, 0.05, 0.35), 4);
  });

  it('stands the band off the shape, and at zero away is the plain falloff', () => {
    expect(band(0.1, 0.5, 0.25, 0.35)).toBeGreaterThan(band(0, 0.5, 0.25, 0.35));
    expect(band(0.1, 0.5, 0.25, 0.35)).toBeCloseTo(1 * mix(0.6, 1.15, 0.5), 6);
    let previous = Infinity;
    for (let step = 0; step <= 12; step++) {
      const lit = band((step / 12) * 0.3, 0.5, 0, 0.35);
      expect(lit).toBeLessThanOrEqual(previous);
      previous = lit;
    }
  });
});

describe('the glow library is arithmetic, and priced as such', () => {
  it('holds no loop and reads no picture, so it costs what a math node costs', () => {
    expect(GLOW_LIB).not.toContain('for (');
    expect(GLOW_LIB).not.toContain('texture(');
  });

  it('offers one falloff per mode', () => {
    for (const mode of ['neon', 'soft', 'band']) {
      expect(GLOW_LIB).toContain(`vec4 glow_${mode}(`);
    }
  });
});
