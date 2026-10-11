import { describe, expect, it } from 'vitest';
import type { FeatureRow } from './features.ts';
import { nearestDistances, standardise } from './matrix.ts';

function row(hash: string, features: Record<string, number | null>): FeatureRow {
  return { path: `${hash}.milk`, hash, style: '', features, clip: `${hash}.webp` };
}

describe('standardise', () => {
  it('centres and scales each feature, imputes missing values as the mean, drops constant ones', () => {
    const rows = [row('a', { x: 1, c: 5, m: null }), row('b', { x: 3, c: 5, m: null }), row('c', { x: null, c: 5, m: 2 })];
    const s = standardise(rows, ['x', 'c', 'm', 'absent']);
    expect(s.names).toEqual(['x']);
    expect(s.mean).toEqual([2]);
    expect(s.sd).toEqual([1]);
    expect(s.x).toEqual([[-1], [1], [0]]);
    expect(s.present).toEqual([[true], [true], [false]]);
  });
});

describe('nearestDistances', () => {
  it('finds each preset’s nearest other and its distance', () => {
    const rows = [row('a', { x: 0, y: 0 }), row('b', { x: 0.1, y: 0 }), row('c', { x: 5, y: 5 }), row('d', { x: 0, y: 0.2 })];
    const s = standardise(rows, ['x', 'y']);
    const { distance, nearest } = nearestDistances(s);
    expect(nearest).toEqual([1, 0, 3, 0]);
    expect(distance[2]).toBeGreaterThan(5 * distance[0]);
  });
});
