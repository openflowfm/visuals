import { describe, expect, it } from 'vitest';
import { PATTERN_BODIES } from './patterns.ts';

/** GLSL's definition, including its useful behavior for negative dividends. */
const mod = (x: number, y: number) => x - y * Math.floor(x / y);

const checker = (x: number, y: number): number =>
  mod(Math.floor(x) + Math.floor(y), 2);

/** The raw alternating-sector kernel, before the shader softens its edges. */
const ray = (x: number, y: number, sectors: number, turn = 0): number | null => {
  if (x === 0 && y === 0) return null;
  const sector = ((Math.atan2(y, x) + Math.PI + turn) * sectors) / (2 * Math.PI);
  return mod(Math.floor(sector), 2);
};

const pointAt = (angle: number, radius = 1): readonly [number, number] => [
  Math.cos(angle) * radius,
  Math.sin(angle) * radius,
];

/** Distance to the paired Truchet arcs inside one unit cell. */
const traceDistance = (x: number, y: number, reflected = false): number => {
  const localX = (reflected ? 1 - x : x) - 0.5;
  const localY = y - 0.5;
  const first = Math.abs(Math.hypot(localX - 0.5, localY - 0.5) - 0.5);
  const second = Math.abs(Math.hypot(localX + 0.5, localY + 0.5) - 0.5);
  return Math.min(first, second);
};

describe('the checker kernel', () => {
  it('is binary on both halves of the centred plane', () => {
    for (const x of [-3.8, -2.1, -0.2, 0, 0.9, 2.7]) {
      for (const y of [-4.2, -1.1, 0.3, 1.8, 5.4]) {
        expect([0, 1]).toContain(checker(x, y));
      }
    }
  });

  it('flips after one cell and repeats after two', () => {
    for (const [x, y] of [
      [-2.7, 1.2],
      [-0.2, -3.4],
      [0.35, 0.72],
      [4.1, -0.8],
    ]) {
      expect(checker(x + 1, y)).toBe(1 - checker(x, y));
      expect(checker(x + 2, y)).toBe(checker(x, y));
    }
  });

  it('does not prefer either lattice axis', () => {
    for (const [x, y] of [
      [-2.7, 1.2],
      [-0.2, -3.4],
      [0.35, 0.72],
      [4.1, -0.8],
    ]) {
      expect(checker(x, y)).toBe(checker(y, x));
    }
  });
});

describe('the ray kernel', () => {
  it('defines the origin without evaluating atan(0, 0)', () => {
    expect(ray(0, 0, 16)).toBeNull();
    expect(PATTERN_BODIES.rays).toContain('if (radius2 < 1e-10)');
    expect(PATTERN_BODIES.rays.indexOf('if (radius2 < 1e-10)')).toBeLessThan(
      PATTERN_BODIES.rays.indexOf('atan(p.y, p.x)'),
    );
  });

  it('depends on direction, not distance from the centre', () => {
    const [x, y] = pointAt(0.371);
    for (const radius of [0.0001, 0.2, 1, 19]) {
      expect(ray(x * radius, y * radius, 16)).toBe(ray(x, y, 16));
    }
  });

  it('flips after one sector and repeats after two', () => {
    for (const sectors of [8, 16, 30]) {
      const width = (2 * Math.PI) / sectors;
      // Stay away from a boundary so floating-point rounding cannot choose the
      // adjacent sector differently from the mathematical definition.
      const angle = -Math.PI + width * 2.37;
      const [x, y] = pointAt(angle);
      const current = ray(x, y, sectors)!;
      expect(ray(x, y, sectors, width)).toBe(1 - current);
      expect(ray(x, y, sectors, width * 2)).toBe(current);
    }
  });

  it('is binary away from its explicitly empty centre', () => {
    for (let i = 0; i < 64; i += 1) {
      const [x, y] = pointAt((i + 0.31) * 0.37, 0.1 + i);
      expect([0, 1]).toContain(ray(x, y, 24));
    }
  });
});

describe('the traces kernel', () => {
  it('joins neighbouring cells at the middle of every edge', () => {
    for (const reflected of [false, true]) {
      expect(traceDistance(0.5, 0, reflected)).toBeCloseTo(0);
      expect(traceDistance(0.5, 1, reflected)).toBeCloseTo(0);
      expect(traceDistance(0, 0.5, reflected)).toBeCloseTo(0);
      expect(traceDistance(1, 0.5, reflected)).toBeCloseTo(0);
    }
  });

  it('uses reflection to choose the other pairing without changing line weight', () => {
    for (const [x, y] of [[0.13, 0.22], [0.37, 0.81], [0.72, 0.46]]) {
      expect(traceDistance(x, y, false)).toBeCloseTo(traceDistance(1 - x, y, true));
    }
  });
});

describe('the GLSL pattern bodies', () => {
  it('remain constant-work and use ordered smoothstep edges', () => {
    for (const body of Object.values(PATTERN_BODIES)) {
      expect(body).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
      expect(body).not.toContain('texture(');
      expect(body).toContain('smoothstep(0.0, feather, edgeDistance)');
    }
  });
});
