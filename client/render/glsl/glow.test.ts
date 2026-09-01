import { describe, expect, it } from 'vitest';
import { GLOW_LIB } from './glow.ts';

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/** The scalar form of the falloffs, which are closed and hold no lattice. */
const reach = (halo: number): number => 0.004 * Math.pow(60, clamp(halo));
const glowBody = (q: number): number => Math.max(1 / (1 + q * q * 8) - 0.02, 0) / 0.98;
const neon = (d: number, e: number, core: number, halo: number): number => {
  const q = Math.max(d, 0) / reach(halo);
  const width = mix(0.1, 0.85, clamp(core));
  const hot = Math.exp(-(q * q) / (width * width));
  return clamp((glowBody(q) * 0.85 + hot) * mix(0.65, 1.15, e));
};
/** How far past white the filament drives, which is the whole point of it. */
const neonPeak = (d: number, e: number, core: number, halo: number): number => {
  const q = Math.max(d, 0) / reach(halo);
  const width = mix(0.1, 0.85, clamp(core));
  const hot = Math.exp(-(q * q) / (width * width));
  const white = smoothstep(0.15, 0.6, hot);
  const over = 1 + hot * hot * mix(0.8, 4.0, clamp(core)) * mix(0.7, 1.3, e);
  // The blue channel of a saturated cyan primary is the one that clips first;
  // the red channel is the one that decides whether it is *white*.
  return (0.078 + white * (1 - 0.078)) * over;
};
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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

describe('a filament that can actually blow out', () => {
  it('drives the middle of the stroke past white rather than up to it', () => {
    // The version this replaced mixed `hot * 0.85` toward white, which against
    // a saturated primary put a hard ceiling of about (220, 246, 255) on the
    // brightest pixel a glow could emit: every lit line in the library came out
    // a pale wash of the colourway and nothing was ever white. Measured against
    // the footage it imitates, the reference blows 11% of its peak frame and
    // the library managed 0.9%.
    expect(neonPeak(0, 0.6, 0.6, 0.35)).toBeGreaterThan(1);
    // And it is the core that decides how hard, so the control still means
    // something at both ends.
    expect(neonPeak(0, 0.6, 0.9, 0.35)).toBeGreaterThan(neonPeak(0, 0.6, 0.15, 0.35));
  });

  it('keeps the white to the middle, so the halo stays the colourway', () => {
    const halo = 0.35;
    // Far enough out that the filament has gone, the colour is the primary
    // undiluted — a glow whose halo whitened would throw the palette away.
    const q = 2.0;
    expect(smoothstep(0.15, 0.6, Math.exp(-(q * q) / (0.46 * 0.46)))).toBe(0);
    expect(neon(0, 0.6, 0.6, halo)).toBeGreaterThan(neon(0.02, 0.6, 0.6, halo));
  });

  it('reaches zero at a finite distance instead of tailing off forever', () => {
    // An inverse square never ends, and over a whole frame that is not a
    // rounding matter: the tail of one glow covers every pixel at some small
    // amplitude, so a picture built out of glows has no black in it anywhere
    // and any radial optic downstream turns that gradient into a frame-wide
    // hue shift. A cyan flower on a red field, with nothing in the graph
    // saying red.
    expect(glowBody(0)).toBeCloseTo(1, 6);
    expect(glowBody(2.5)).toBe(0);
    expect(glowBody(50)).toBe(0);
    // And it is still monotone on the way down, with no step where it lands.
    let previous = Infinity;
    for (let step = 0; step <= 60; step++) {
      const at = glowBody((step / 60) * 3);
      expect(at).toBeLessThanOrEqual(previous + 1e-9);
      expect(at).toBeGreaterThanOrEqual(0);
      previous = at;
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
