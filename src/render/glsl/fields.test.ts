import { describe, expect, it } from 'vitest';
import {
  FIELD_LIB,
  FIELD_MAX_WORK,
  FIELD_WORK,
  METABALL_MAX,
  METABALL_MIN,
} from './fields.ts';

type Point = readonly [number, number];

const mix32 = (input: number): number => {
  let value = input >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
};

const hash = (x: number, y: number, seed = 3.71): number => {
  const seeded = Math.floor(Math.abs(seed) * 4096) >>> 0;
  const bits = (Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ seeded) >>> 0;
  return (mix32(bits) & 0x00ff_ffff) / 0x00ff_ffff;
};

const feature = (x: number, y: number, seed = 3.71): Point => [
  hash(x, y, seed),
  hash(x + 37, y + 17, seed),
];

const fract = (value: number): number => value - Math.floor(value);
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Independent scalar form of the shader's fixed 3x3 Worley F1 search. */
const worley = ([px, py]: Point, seed = 3.71): number => {
  const homeX = Math.floor(px);
  const homeY = Math.floor(py);
  const localX = fract(px);
  const localY = fract(py);
  let nearest = 2;
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const [fx, fy] = feature(homeX + x, homeY + y, seed);
      nearest = Math.min(nearest, Math.hypot(x + fx - localX, y + fy - localY));
    }
  }
  return clamp(nearest * Math.SQRT1_2);
};

const fade = (value: number): number =>
  value * value * value * (value * (value * 6 - 15) + 10);

const gradient = (x: number, y: number, seed = 3.71): Point => {
  const angle = hash(x, y, seed) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
};

const dot = ([ax, ay]: Point, [bx, by]: Point): number => ax * bx + ay * by;
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/** One canonical 2-D gradient-noise sample: four lattice-corner visits. */
const gradientNoise = ([px, py]: Point, seed = 3.71): number => {
  const x = Math.floor(px);
  const y = Math.floor(py);
  const fx = fract(px);
  const fy = fract(py);
  const a = dot(gradient(x, y, seed), [fx, fy]);
  const b = dot(gradient(x + 1, y, seed), [fx - 1, fy]);
  const c = dot(gradient(x, y + 1, seed), [fx, fy - 1]);
  const d = dot(gradient(x + 1, y + 1, seed), [fx - 1, fy - 1]);
  return lerp(lerp(a, b, fade(fx)), lerp(c, d, fade(fx)), fade(fy));
};

/** Four-octave normalized fBm with lacunarity two and gain one half. */
const fbm = ([startX, startY]: Point, seed = 3.71): number => {
  let x = startX;
  let y = startY;
  let amplitude = 1;
  let normalizer = 0;
  let total = 0;
  for (let octave = 0; octave < 4; octave++) {
    total += gradientNoise([x, y], seed) * amplitude;
    normalizer += amplitude;
    x = x * 2 + 19.1;
    y = y * 2 + 7.7;
    amplitude *= 0.5;
  }
  return clamp(0.5 + 0.5 * total / (normalizer * Math.SQRT2));
};

/** Finite summed Gaussian densities, with explicit centres for invariant tests. */
const metaballs = (point: Point, centres: readonly Point[], spread: number): number => {
  return centres.reduce((sum, centre) => {
    const dx = point[0] - centre[0];
    const dy = point[1] - centre[1];
    return sum + Math.exp(-(dx * dx + dy * dy) * spread);
  }, 0);
};

/** The shader's 0–1 control mapped to an integer colony size. */
const activeBalls = (value: number): number =>
  Math.min(
    METABALL_MAX,
    METABALL_MIN + Math.floor(clamp(value) * (METABALL_MAX - METABALL_MIN + 1)),
  );

/** Independent form of one seeded elliptical orbit from the shader. */
const metaballCentre = (index: number, beat: number, apart: number, seed = 3.71): Point => {
  const key: Point = [index * 13 + 5, index * 29 + 11];
  const direction = hash(key[0] + 7, key[1] + 3, seed) < 0.5 ? -1 : 1;
  const speed = lerp(0.07, 0.22, hash(key[0] + 17, key[1] + 23, seed)) * direction;
  const angle = hash(key[0], key[1], seed) * Math.PI * 2 + beat * speed;
  const colonyRadius = lerp(0.08, 0.55, clamp(apart));
  const orbit = colonyRadius * lerp(0.35, 1, hash(key[0] + 31, key[1] + 19, seed));
  const ellipse = lerp(0.65, 1.25, hash(key[0] + 43, key[1] + 37, seed));
  return [Math.cos(angle) * orbit, Math.sin(angle) * ellipse * orbit];
};

describe('bounded field work', () => {
  it('charges every primitive visit and exposes the worst single field', () => {
    expect(FIELD_WORK).toEqual({ cells: 9, clouds: 16, metaballs: 7 });
    expect(FIELD_MAX_WORK).toBe(16);
  });

  it('keeps every loop statically bounded in the GLSL', () => {
    expect(FIELD_LIB).toContain('for (int y = -1; y <= 1; y++)');
    expect(FIELD_LIB).toContain('for (int x = -1; x <= 1; x++)');
    expect(FIELD_LIB).toContain('for (int octave = 0; octave < 4; octave++)');
    expect(FIELD_LIB).toContain('for (int i = 0; i < 7; i++)');
    expect(FIELD_LIB).not.toMatch(/\bwhile\s*\(/);
  });

  it('offers one generator-shaped entry point for every charged mode', () => {
    for (const mode of Object.keys(FIELD_WORK)) {
      expect(FIELD_LIB).toContain(`vec4 field_${mode}(vec2 p, float e`);
    }
    expect(FIELD_LIB).toContain(
      'vec4 field_metaballs(vec2 p, float e, float balls, float apart)',
    );
  });
});

describe('the deterministic lattice', () => {
  it('pins integer-hash probes rather than depending on a platform sine', () => {
    expect(hash(0, 0)).toBeCloseTo(0.2023643972, 9);
    expect(hash(-7, 13)).toBeCloseTo(0.7617816783, 9);
    expect(hash(101, -53, 0.25)).toBeCloseTo(0.7988842606, 9);
  });

  it('puts Worley F1 at zero on a feature point and keeps every sample finite', () => {
    const [fx, fy] = feature(4, -2);
    expect(worley([4 + fx, -2 + fy])).toBeCloseTo(0, 12);
    for (const point of [[0, 0], [0.25, 0.75], [-18.2, 31.9], [10_000.1, -9_999.4]] as const) {
      expect(Number.isFinite(worley(point))).toBe(true);
      expect(worley(point)).toBeGreaterThanOrEqual(0);
      expect(worley(point)).toBeLessThanOrEqual(1);
    }
  });
});

describe('fixed gradient-noise fBm', () => {
  it('is zero at every lattice point before the normalized octave sum', () => {
    expect(gradientNoise([0, 0])).toBe(0);
    expect(gradientNoise([-9, 17])).toBe(0);
  });

  it('pins deterministic cloud probes and stays finite and normalized', () => {
    expect(fbm([0.125, 0.375])).toBeCloseTo(0.5415868042, 9);
    expect(fbm([-3.7, 8.2])).toBeCloseTo(0.5313172276, 9);
    for (const point of [[0, 0], [0.1, 0.9], [-30.25, 11.75], [2048.5, -1024.25]] as const) {
      const value = fbm(point);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('finite Gaussian metaballs', () => {
  const centres: readonly Point[] = [[-0.3, -0.1], [0.25, -0.2], [0.1, 0.35], [-0.2, 0.25]];

  it('stays finite at a centre and everywhere far away', () => {
    expect(Number.isFinite(metaballs(centres[0], centres, 12))).toBe(true);
    expect(Number.isFinite(metaballs([1e6, -1e6], centres, 12))).toBe(true);
    expect(metaballs([1e6, -1e6], centres, 12)).toBe(0);
  });

  it('is unchanged when the balls are visited in another order', () => {
    const point: Point = [0.12, -0.08];
    expect(metaballs(point, centres, 12)).toBeCloseTo(
      metaballs(point, [...centres].reverse(), 12),
      14,
    );
  });

  it('sums rather than averages, so another nearby ball strengthens the implicit field', () => {
    const point: Point = [0.12, -0.08];
    const one = metaballs(point, centres.slice(0, 1), 12);
    const colony = metaballs(point, centres, 12);
    expect(colony).toBeGreaterThan(one);
    expect(colony).toBeCloseTo(
      centres.reduce((sum, centre) => sum + metaballs(point, [centre], 12), 0),
      14,
    );
  });

  it('falls as a point moves away from every centre and remains non-negative', () => {
    const near = metaballs([0, 0], centres, 12);
    const far = metaballs([2, 2], centres, 12);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThanOrEqual(0);
  });

  it('maps the full control range onto two through seven active balls', () => {
    expect([0, 1 / 6, 0.5, 5 / 6, 1].map(activeBalls)).toEqual([2, 3, 5, 7, 7]);
    for (let value = 0; value <= 1; value += 0.01) {
      expect(activeBalls(value)).toBeGreaterThanOrEqual(METABALL_MIN);
      expect(activeBalls(value)).toBeLessThanOrEqual(METABALL_MAX);
    }
  });

  it('gives every ball a deterministic orbit that moves farther out with apart', () => {
    const near = Array.from({ length: METABALL_MAX }, (_, index) =>
      metaballCentre(index, 12.5, 0.1),
    );
    const far = Array.from({ length: METABALL_MAX }, (_, index) =>
      metaballCentre(index, 12.5, 0.9),
    );
    expect(near).toEqual(
      Array.from({ length: METABALL_MAX }, (_, index) => metaballCentre(index, 12.5, 0.1)),
    );
    expect(new Set(near.map(([x, y]) => `${x.toFixed(8)},${y.toFixed(8)}`)).size).toBe(
      METABALL_MAX,
    );
    for (let index = 0; index < METABALL_MAX; index++) {
      expect(Math.hypot(...far[index])).toBeGreaterThan(Math.hypot(...near[index]));
      expect(metaballCentre(index, 13.5, 0.9)).not.toEqual(far[index]);
    }
  });
});
