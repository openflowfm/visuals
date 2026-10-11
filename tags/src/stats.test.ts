import { describe, expect, it } from 'vitest';
import {
  averagePrecision,
  bestF1,
  calibrate,
  fitLogistic,
  fitPlatt,
  fitThreshold,
  maxPrecision,
  precisionRecallAt,
  scoreLogistic,
  scoreThreshold,
  seeded,
  sigmoid,
  stratifiedFolds,
  thresholdForPrecision,
  wilsonLower,
} from './stats.ts';

describe('averagePrecision', () => {
  it('is 1 for a perfect ranking and the known value for a reversed one', () => {
    const y = [true, true, false, false, false];
    expect(averagePrecision([5, 4, 3, 2, 1], y)).toBe(1);
    // Reversed: the yeses come 4th and 5th: (1/4 + 2/5) / 2.
    expect(averagePrecision([1, 2, 3, 4, 5], y)).toBeCloseTo((1 / 4 + 2 / 5) / 2, 12);
  });

  it('counts tied scores as one step', () => {
    // All tied: precision is the share of yeses at the one step.
    expect(averagePrecision([1, 1, 1, 1], [true, false, false, false])).toBeCloseTo(0.25, 12);
  });

  it('is 0 without positives', () => {
    expect(averagePrecision([1, 2], [false, false])).toBe(0);
  });
});

describe('precision and recall', () => {
  it('at a threshold', () => {
    const r = precisionRecallAt([0.9, 0.8, 0.7, 0.2, 0.1], [true, false, true, true, false], 0.5);
    expect(r).toMatchObject({ tp: 2, fp: 1, fn: 1 });
    expect(r.precision).toBeCloseTo(2 / 3, 12);
    expect(r.recall).toBeCloseTo(2 / 3, 12);
  });

  it('finds the lowest threshold reaching the target precision with enough positives', () => {
    // 10 yeses on top, then alternating: precision stays ≥ 0.85 down to some point.
    const scores = Array.from({ length: 30 }, (_, i) => 30 - i);
    const y = scores.map((_, i) => i < 10 || (i >= 10 && i % 2 === 0));
    const t = thresholdForPrecision(scores, y, 0.85, 5)!;
    expect(t.precision).toBeGreaterThanOrEqual(0.85);
    // Going one step lower drops below 0.85.
    const lower = precisionRecallAt(scores, y, t.threshold - 1);
    expect(lower.precision).toBeLessThan(0.85);
    // Indices 0-10 yes, then no, yes, no, yes: 13/15 = 0.867 at score 16; 13/16 and 14/17 fall under.
    expect(t.threshold).toBe(16);
    expect(maxPrecision(scores, y, 5)).toBe(1);
  });

  it('never goes lower only to take in more noes', () => {
    // A perfect ranking: 6 yeses then noes; precision stays ≥ 0.85 one no further, but recall can't grow.
    const scores = [10, 9, 8, 7, 6, 5, 4, 3];
    const y = [true, true, true, true, true, true, false, false];
    expect(thresholdForPrecision(scores, y, 0.85, 5)).toMatchObject({ threshold: 5, precision: 1, recall: 1 });
  });

  it('says when no threshold gets there', () => {
    const scores = [6, 5, 4, 3, 2, 1];
    const y = [true, false, true, false, true, false];
    expect(thresholdForPrecision(scores, y, 0.85, 1)).not.toBeNull(); // the top one alone
    expect(thresholdForPrecision(scores, y, 0.85, 2)).toBeNull();
    expect(bestF1(scores, y)!.f1).toBeGreaterThan(0.5);
  });
});

describe('stratifiedFolds', () => {
  it('are disjoint, cover everything and keep the yes share in each fold', () => {
    const y = Array.from({ length: 103 }, (_, i) => i % 4 === 0);
    const k = 5;
    const fold = stratifiedFolds(y, k, 7);
    expect(fold).toHaveLength(103);
    expect(fold.every((f) => f >= 0 && f < k)).toBe(true);
    const yes = y.filter(Boolean).length;
    for (let f = 0; f < k; f++) {
      const idx = fold.map((g, i) => (g === f ? i : -1)).filter((i) => i >= 0);
      const p = idx.filter((i) => y[i]).length;
      expect(Math.abs(p - yes / k)).toBeLessThanOrEqual(1);
      expect(Math.abs(idx.length - 103 / k)).toBeLessThanOrEqual(1);
    }
    expect(stratifiedFolds(y, k, 7)).toEqual(fold);
    expect(stratifiedFolds(y, k, 8)).not.toEqual(fold);
  });
});

function synthetic(n: number, seed: number) {
  const r = seeded(seed);
  const X: number[][] = [];
  const y: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * 2 - 1;
    const b = r() * 2 - 1;
    const c = r() * 2 - 1;
    X.push([a * 10, b, c]);
    y.push(b - 0.5 * c > 0);
  }
  return { X, y };
}

describe('fitThreshold', () => {
  it('picks the direction that ranks the yeses first and imputes the mean', () => {
    const x = [1, 2, 3, null, 10, 11, 12];
    const y = [true, true, true, false, false, false, false];
    const m = fitThreshold('f', x, y);
    expect(m.direction).toBe(-1);
    expect(m.fill).toBeCloseTo(39 / 6, 12);
    expect(scoreThreshold(m, 1)).toBeGreaterThan(scoreThreshold(m, 10));
    expect(
      fitThreshold(
        'f',
        x,
        y.map((v) => !v),
      ).direction,
    ).toBe(1);
  });
});

describe('fitLogistic', () => {
  it('recovers a separable direction, whatever the inputs’ scales', () => {
    const { X, y } = synthetic(300, 3);
    const m = fitLogistic(['a', 'b', 'c'], X, y, { lambda: 0.001 });
    // Weights are on standardised inputs: b positive, c negative about half of b, a near 0.
    expect(m.w[1]).toBeGreaterThan(0);
    expect(m.w[2]).toBeLessThan(0);
    expect(m.w[2] / m.w[1]).toBeCloseTo(-0.5, 0);
    expect(Math.abs(m.w[0])).toBeLessThan(0.2 * m.w[1]);
    const s = X.map((row) => scoreLogistic(m, row));
    expect(averagePrecision(s, y)).toBeGreaterThan(0.98);
  });

  it('shrinks the weights under a stronger L2', () => {
    const { X, y } = synthetic(200, 4);
    const weak = fitLogistic(['a', 'b', 'c'], X, y, { lambda: 0.001 });
    const strong = fitLogistic(['a', 'b', 'c'], X, y, { lambda: 1 });
    const norm = (w: number[]) => Math.hypot(...w);
    expect(norm(strong.w)).toBeLessThan(0.5 * norm(weak.w));
  });

  it('treats a missing value as the mean', () => {
    const X = [[0], [1], [2], [3], [null]];
    const m = fitLogistic(['a'], X, [false, false, true, true, true]);
    expect(scoreLogistic(m, [null])).toBeCloseTo(m.b, 12);
  });
});

describe('fitPlatt', () => {
  it('is monotone and roughly calibrated on synthetic probabilities', () => {
    const r = seeded(11);
    const scores: number[] = [];
    const y: boolean[] = [];
    for (let i = 0; i < 4000; i++) {
      const s = r() * 8 - 4;
      scores.push(s);
      y.push(r() < sigmoid(2 * s - 1));
    }
    const c = fitPlatt(scores, y);
    expect(c.a).toBeCloseTo(2, 0);
    expect(c.b).toBeCloseTo(-1, 0);
    let last = -1;
    for (let s = -5; s <= 5; s += 0.25) {
      const p = calibrate(c, s);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    // Bins of confidence match their observed rate.
    for (const [lo, hi] of [
      [0.1, 0.3],
      [0.4, 0.6],
      [0.7, 0.9],
    ]) {
      const idx = scores.map((s, i) => [calibrate(c, s), i] as const).filter(([p]) => p >= lo && p < hi);
      const rate = idx.filter(([, i]) => y[i]).length / idx.length;
      expect(Math.abs(rate - (lo + hi) / 2)).toBeLessThan(0.08);
    }
  });

  it('stays finite on perfectly separated scores', () => {
    const c = fitPlatt([1, 2, 3, 10, 11, 12], [false, false, false, true, true, true]);
    expect(Number.isFinite(c.a) && Number.isFinite(c.b)).toBe(true);
    expect(calibrate(c, 12)).toBeGreaterThan(0.7);
    expect(calibrate(c, 1)).toBeLessThan(0.3);
  });
});

describe('wilsonLower', () => {
  it('matches known values', () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(10, 10)).toBeCloseTo(0.7225, 4);
    expect(wilsonLower(85, 100)).toBeCloseTo(0.7672, 3);
    expect(wilsonLower(50, 100)).toBeCloseTo(0.4038, 3);
  });
});
