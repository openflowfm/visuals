import { describe, expect, it } from 'vitest';
import { cyclicMotion, differenceOf, metricsOf } from './frameMetrics.ts';

const frame = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

describe('frame metrics', () => {
  it('distinguishes compression-dark pixels from exact black and locates light', () => {
    const pixels = frame([0, 0, 0, 255], [8, 4, 2, 255], [255, 255, 255, 255], [0, 255, 255, 255]);
    const measured = metricsOf(pixels, 2, 2);
    expect(measured.black).toBe(0.25);
    expect(measured.dark).toBe(0.5);
    expect(measured.coverage).toBe(0.5);
    expect(measured.white).toBe(0.25);
    expect(measured.peak).toBe(255);
    expect(measured.centreY).toBeGreaterThan(0);
    expect(measured.chroma).toBeGreaterThan(0);
  });

  it('reports mirror symmetry and an asymmetric bright point', () => {
    const symmetric = frame(
      [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
    );
    expect(metricsOf(symmetric, 4, 1).mirrorX).toBe(1);
    const right = frame(
      [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
    );
    expect(metricsOf(right, 4, 1).centreX).toBeGreaterThan(0.5);
    expect(metricsOf(right, 4, 1).mirrorX).toBeLessThan(1);
  });

  it('measures per-channel change and includes the loop seam', () => {
    const black = frame([0, 0, 0, 255]);
    const white = frame([255, 255, 255, 255]);
    expect(differenceOf(black, white)).toBe(1);
    expect(cyclicMotion([black, white])).toBe(1);
    expect(cyclicMotion([black])).toBe(0);
  });
});
