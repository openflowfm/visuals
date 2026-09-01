import { describe, expect, it } from 'vitest';
import { structuralDifference, structureOf } from './structuralMetrics.ts';

const image = (width: number, height: number, lit: (x: number, y: number) => boolean) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const value = lit(x, y) ? 255 : 0;
      pixels.set([value, value, value, 255], at);
    }
  }
  return pixels;
};

describe('structural frame comparison', () => {
  it('ignores exposure while preserving the same silhouette', () => {
    const bright = image(20, 20, (x, y) => x >= 4 && x <= 15 && (y === 4 || y === 15));
    const dim = new Uint8ClampedArray(bright.map((value, at) => at % 4 === 3 ? value : value * 0.3));
    const compared = structuralDifference(
      structureOf(bright, 20, 20),
      structureOf(dim, 20, 20),
      20,
      20,
    );
    expect(compared.silhouetteIoU).toBe(1);
    expect(compared.contourDistance).toBe(0);
  });

  it('finds the enclosed region and penalizes a shifted contour', () => {
    const ring = image(32, 32, (x, y) => x >= 7 && x <= 24 && y >= 7 && y <= 24 &&
      (x <= 9 || x >= 22 || y <= 9 || y >= 22));
    const shifted = image(32, 32, (x, y) => x >= 10 && x <= 27 && y >= 7 && y <= 24 &&
      (x <= 12 || x >= 25 || y <= 9 || y >= 22));
    const left = structureOf(ring, 32, 32);
    const right = structureOf(shifted, 32, 32);
    expect(left.holes).toBe(1);
    expect(right.holes).toBe(1);
    expect(left.endpoints).toBe(0);
    const compared = structuralDifference(left, right, 32, 32);
    expect(compared.silhouetteIoU).toBeLessThan(0.6);
    expect(compared.contourDistance).toBeGreaterThan(0);
  });

  it('counts curve endpoints and one junction cluster', () => {
    const plus = image(31, 31, (x, y) =>
      (Math.abs(x - 15) <= 1 && y >= 4 && y <= 26) ||
      (Math.abs(y - 15) <= 1 && x >= 4 && x <= 26));
    const held = structureOf(plus, 31, 31);
    expect(held.endpoints).toBe(4);
    expect(held.junctions).toBe(1);
  });
});
