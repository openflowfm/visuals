// Features as a standardised matrix, shared by the scorers, Unique's
// nearest-neighbour distance and the labelling grid's picking.
//
// Each feature is centred on its mean and divided by its standard deviation
// over the presets that have it; a missing value becomes 0 (the mean), so it
// pulls neither way. A feature that is constant or missing everywhere is
// dropped, since it can't tell presets apart.

import { value, type FeatureRow } from './features.ts';

export interface Standardised {
  /** The features kept, in column order. */
  names: string[];
  mean: number[];
  sd: number[];
  /** One row per preset, in the order given. */
  x: number[][];
  /** Whether each value was present (false where it was imputed). */
  present: boolean[][];
}

export function standardise(rows: FeatureRow[], names: string[]): Standardised {
  const kept: string[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  for (const n of names) {
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (const r of rows) {
      const v = value(r, n);
      if (v === null) continue;
      s += v;
      s2 += v * v;
      c++;
    }
    if (c < 2) continue;
    const m = s / c;
    const variance = Math.max(0, s2 / c - m * m);
    if (variance < 1e-12) continue;
    kept.push(n);
    mean.push(m);
    sd.push(Math.sqrt(variance));
  }
  const x: number[][] = [];
  const present: boolean[][] = [];
  for (const r of rows) {
    const xr: number[] = [];
    const pr: boolean[] = [];
    kept.forEach((n, j) => {
      const v = value(r, n);
      xr.push(v === null ? 0 : (v - mean[j]) / sd[j]);
      pr.push(v !== null);
    });
    x.push(xr);
    present.push(pr);
  }
  return { names: kept, mean, sd, x, present };
}

/**
 * Each preset's distance to its nearest other preset in standardised feature
 * space, divided by √(number of features) so it reads the same however many
 * features there are. Brute force: O(n²·d), fine for the pack (9,795 presets,
 * tens of features: a few seconds).
 */
export function nearestDistances(s: Standardised): { distance: number[]; nearest: number[] } {
  const n = s.x.length;
  const d = Math.max(1, s.names.length);
  const best = new Array<number>(n).fill(Infinity);
  const nearest = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const xi = s.x[i];
    for (let j = i + 1; j < n; j++) {
      const xj = s.x[j];
      let sum = 0;
      for (let k = 0; k < xi.length; k++) {
        const t = xi[k] - xj[k];
        sum += t * t;
      }
      if (sum < best[i]) {
        best[i] = sum;
        nearest[i] = j;
      }
      if (sum < best[j]) {
        best[j] = sum;
        nearest[j] = i;
      }
    }
  }
  return { distance: best.map((b) => (Number.isFinite(b) ? Math.sqrt(b / d) : 0)), nearest };
}
