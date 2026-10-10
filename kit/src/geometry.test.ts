import { describe, expect, it } from 'vitest';
import { CORNER_ROUNDED, CORNER_SMOOTH, ovalPath, parsePoint, pointsPath, roundedRectPath } from './geometry.ts';

describe('roundedRectPath', () => {
  it('draws a plain rectangle when no corner is rounded', () => {
    expect(roundedRectPath(10, 4, [0])).toBe('M0 0H10V4H0Z');
  });

  it('holds radii to half the shorter side, as Sketch writes "fully round" as 3.4e38', () => {
    expect(roundedRectPath(54, 24, [3.4e38])).toBe(roundedRectPath(54, 24, [12]));
  });

  it('takes one radius for every corner or four in order', () => {
    expect(roundedRectPath(20, 20, [4])).toBe(roundedRectPath(20, 20, [4, 4, 4, 4]));
    expect(roundedRectPath(20, 20, [1, 2, 3, 4])).not.toBe(roundedRectPath(20, 20, [4]));
  });

  it('starts each round corner a radius from the end of the side', () => {
    expect(roundedRectPath(20, 10, [3], CORNER_ROUNDED)).toBe('M17 0a3 3 0 0 1 3 3L20 7a3 3 0 0 1 -3 3L3 10a3 3 0 0 1 -3 -3L0 3a3 3 0 0 1 3 -3Z');
  });

  it('spends (1 + smoothing) × r along each side on a smooth corner', () => {
    const d = roundedRectPath(100, 100, [10], CORNER_SMOOTH, 0.6);
    expect(d.startsWith('M84 0c')).toBe(true);
  });

  it('gives up smoothing where the side is too short for it', () => {
    // A 16 pt checkbox with 5.5 pt corners has 8 pt per corner: 1.6 × 5.5 doesn't fit.
    const d = roundedRectPath(16, 16, [5.5], CORNER_SMOOTH, 0.6);
    expect(d.startsWith('M8 0c')).toBe(true);
    // A capsule has no room at all, so it is round.
    expect(roundedRectPath(54, 24, [12], CORNER_SMOOTH, 0.6)).toBe(roundedRectPath(54, 24, [12]));
  });

  it('can be placed away from the origin, for a shadow grown by its spread', () => {
    expect(roundedRectPath(12, 6, [0], CORNER_ROUNDED, 0, -1, -1)).toBe('M-1 -1H11V5H-1Z');
  });
});

describe('ovalPath', () => {
  it('is two half arcs through the top and bottom', () => {
    expect(ovalPath(4.8, 4.8)).toBe('M2.4 0A2.4 2.4 0 1 1 2.4 4.8A2.4 2.4 0 1 1 2.4 0Z');
  });
});

describe('pointsPath', () => {
  const pt = (point: string, extra: Partial<{ curveFrom: string; curveTo: string; hasCurveFrom: boolean; hasCurveTo: boolean; cornerRadius: number }> = {}) => ({
    point,
    curveFrom: point,
    curveTo: point,
    hasCurveFrom: false,
    hasCurveTo: false,
    cornerRadius: 0,
    ...extra,
  });

  it('scales fractions of the frame into points', () => {
    expect(parsePoint('{0.5, 0.25}')).toEqual([0.5, 0.25]);
    expect(pointsPath([pt('{0, 0}'), pt('{1, 0}'), pt('{1, 1}')], 10, 20, true).d).toBe('M0 0L10 0L10 20L0 0Z');
  });

  it('draws a cubic where either end has a handle', () => {
    const { d } = pointsPath([pt('{0, 0}', { curveFrom: '{0.5, 0}', hasCurveFrom: true }), pt('{1, 1}')], 10, 10, false);
    expect(d).toBe('M0 0C5 0 10 10 10 10');
  });

  it('says when points have corner radii it leaves out', () => {
    expect(pointsPath([pt('{0, 0}', { cornerRadius: 2 }), pt('{1, 0}')], 1, 1, false).rounded).toBe(true);
  });
});
