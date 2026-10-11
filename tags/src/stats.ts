// The statistics the score report needs, written out: no numerical library.
//
// Rankings are judged by average precision; models are a single feature with
// a direction, or L2-regularised logistic regression on standardised inputs;
// a model's raw score becomes a 0–1 confidence by Platt scaling (a sigmoid of
// the score, fitted by Newton's method on out-of-fold scores); a tag's
// threshold is the lowest confidence whose out-of-fold precision reaches the
// target. Everything takes plain arrays; `y[i]` is true for a "yes".

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** A seeded uniform [0, 1) generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Indices sorted by score, highest first (stable, so ties keep their order). */
function byScoreDesc(scores: number[]): number[] {
  return scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
}

/**
 * Average precision: the precision at each distinct score, weighted by the
 * recall it adds (scikit-learn's definition, so tied scores count as one
 * step). 1 for a perfect ranking; about the share of positives for a random one.
 */
export function averagePrecision(scores: number[], y: boolean[]): number {
  const pos = y.filter(Boolean).length;
  if (pos === 0) return 0;
  const order = byScoreDesc(scores);
  let tp = 0;
  let fp = 0;
  let ap = 0;
  let lastRecall = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (y[i]) tp++;
    else fp++;
    const next = order[k + 1];
    if (next !== undefined && scores[next] === scores[i]) continue;
    const recall = tp / pos;
    ap += (recall - lastRecall) * (tp / (tp + fp));
    lastRecall = recall;
  }
  return ap;
}

export interface AtThreshold {
  threshold: number;
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
}

/** Precision and recall when everything scoring at or above `threshold` is called a yes. Precision is 0 when nothing is. */
export function precisionRecallAt(scores: number[], y: boolean[], threshold: number): AtThreshold {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] >= threshold) {
      if (y[i]) tp++;
      else fp++;
    } else if (y[i]) fn++;
  }
  return { threshold, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, tp, fp, fn };
}

/** Every distinct threshold's precision and recall, highest threshold first. */
export function curve(scores: number[], y: boolean[]): AtThreshold[] {
  const pos = y.filter(Boolean).length;
  const order = byScoreDesc(scores);
  const out: AtThreshold[] = [];
  let tp = 0;
  let fp = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (y[i]) tp++;
    else fp++;
    const next = order[k + 1];
    if (next !== undefined && scores[next] === scores[i]) continue;
    out.push({ threshold: scores[i], precision: tp / (tp + fp), recall: pos ? tp / pos : 0, tp, fp, fn: pos - tp });
  }
  return out;
}

/**
 * The threshold giving the most recall while precision stays at least
 * `target`, with at least `minPositives` true positives above it: the lowest
 * such threshold, except that it never goes lower only to take in more noes
 * (among equal recall, the highest threshold). Null when none gets there.
 */
export function thresholdForPrecision(scores: number[], y: boolean[], target = 0.85, minPositives = 5): AtThreshold | null {
  let best: AtThreshold | null = null;
  for (const p of curve(scores, y)) if (p.precision >= target && p.tp >= minPositives && (!best || p.tp > best.tp)) best = p;
  return best;
}

/** The highest precision any threshold with at least `minPositives` true positives reaches (0 when none has that many). */
export function maxPrecision(scores: number[], y: boolean[], minPositives = 5): number {
  let m = 0;
  for (const p of curve(scores, y)) if (p.tp >= minPositives && p.precision > m) m = p.precision;
  return m;
}

/** The threshold with the best F1; null when there are no positives. */
export function bestF1(scores: number[], y: boolean[]): (AtThreshold & { f1: number }) | null {
  let best: (AtThreshold & { f1: number }) | null = null;
  for (const p of curve(scores, y)) {
    const f1 = p.precision + p.recall ? (2 * p.precision * p.recall) / (p.precision + p.recall) : 0;
    if (f1 > 0 && (!best || f1 > best.f1)) best = { ...p, f1 };
  }
  return best;
}

/**
 * Stratified k-fold: the fold (0..k-1) of each sample. Yeses and noes are
 * shuffled apart (seeded) and dealt round-robin, so each fold gets its share
 * of both; the noes' deal starts where the yeses' left off, to even out sizes.
 */
export function stratifiedFolds(y: boolean[], k: number, seed: number): number[] {
  const r = seeded(seed);
  const pos = shuffle(
    y.map((_, i) => i).filter((i) => y[i]),
    r,
  );
  const neg = shuffle(
    y.map((_, i) => i).filter((i) => !y[i]),
    r,
  );
  const fold = new Array<number>(y.length).fill(0);
  let c = 0;
  for (const i of [...pos, ...neg]) fold[i] = c++ % k;
  return fold;
}

/**
 * Stratified group k-fold: the fold (0..k-1) of each sample, with every
 * sample of a group (`groups[i]`, any number; near-duplicates share one) in
 * the same fold, so no group is both trained and tested on. Groups are
 * shuffled (seeded), then taken most yeses first, biggest first, each into
 * the fold where it brings the yes and no counts closest to an even share
 * (ties: the fold with fewest samples, then the lowest). With every group a
 * single sample this deals like `stratifiedFolds`.
 */
export function stratifiedGroupFolds(y: boolean[], groups: number[], k: number, seed: number): number[] {
  const r = seeded(seed);
  const members = new Map<number, number[]>();
  y.forEach((_, i) => {
    const m = members.get(groups[i]);
    if (m) m.push(i);
    else members.set(groups[i], [i]);
  });
  const yesIn = (g: number[]) => g.filter((i) => y[i]).length;
  const list = shuffle([...members.values()], r).sort((a, b) => yesIn(b) - yesIn(a) || b.length - a.length);
  const P = Math.max(1, y.filter(Boolean).length);
  const N = Math.max(1, y.length - y.filter(Boolean).length);
  const pos = new Array<number>(k).fill(0);
  const neg = new Array<number>(k).fill(0);
  const fold = new Array<number>(y.length).fill(0);
  for (const g of list) {
    const gp = yesIn(g);
    const gn = g.length - gp;
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < k; f++) {
      const off = (p: number, n: number) => (p / P - 1 / k) ** 2 + (n / N - 1 / k) ** 2;
      const cost = off(pos[f] + gp, neg[f] + gn) - off(pos[f], neg[f]);
      const size = pos[f] + neg[f];
      if (cost < bestCost - 1e-12 || (Math.abs(cost - bestCost) <= 1e-12 && size < pos[best] + neg[best])) {
        best = f;
        bestCost = cost;
      }
    }
    for (const i of g) fold[i] = best;
    pos[best] += gp;
    neg[best] += gn;
  }
  return fold;
}

function meanOf(xs: (number | null)[]): number {
  let s = 0;
  let c = 0;
  for (const v of xs) if (v !== null) ((s += v), c++);
  return c ? s / c : 0;
}

// --- A single feature with a direction ---------------------------------------

export interface ThresholdModel {
  kind: 'threshold';
  column: string;
  /** 1: high values mean yes; -1: low values do. */
  direction: 1 | -1;
  /** What a missing value is taken as: the training mean. */
  fill: number;
}

/** Fits one column's direction on the training samples: whichever of high or low ranks the yeses better (by average precision). */
export function fitThreshold(column: string, x: (number | null)[], y: boolean[]): ThresholdModel {
  const fill = meanOf(x);
  const s = x.map((v) => v ?? fill);
  const up = averagePrecision(s, y);
  const down = averagePrecision(
    s.map((v) => -v),
    y,
  );
  return { kind: 'threshold', column, direction: down > up ? -1 : 1, fill };
}

export function scoreThreshold(m: ThresholdModel, v: number | null): number {
  return m.direction * (v ?? m.fill);
}

// --- Logistic regression ------------------------------------------------------

export interface LogisticModel {
  kind: 'logistic';
  columns: string[];
  /** Each column's training mean and standard deviation; inputs are standardised with them, a missing value becoming 0 (the mean). */
  mean: number[];
  sd: number[];
  w: number[];
  b: number;
  lambda: number;
}

export interface LogisticOptions {
  /** L2 strength on the weights (not the intercept), on the mean log loss. */
  lambda?: number;
  iterations?: number;
  /** Stop when the gradient's largest component falls under this. */
  tolerance?: number;
}

/**
 * L2-regularised logistic regression by Nesterov-accelerated gradient
 * descent on mean log loss + λ/2·|w|², inputs standardised on the training
 * samples (missing values imputed as the mean, so they pull neither way).
 * The step is 1/L with L the loss's Lipschitz bound for standardised inputs.
 */
export function fitLogistic(columns: string[], X: (number | null)[][], y: boolean[], opts: LogisticOptions = {}): LogisticModel {
  const lambda = opts.lambda ?? 0.05;
  const iterations = opts.iterations ?? 1500;
  const tolerance = opts.tolerance ?? 1e-6;
  const d = columns.length;
  const n = X.length;
  const mean: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < d; j++) {
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (const row of X) {
      const v = row[j];
      if (v === null) continue;
      s += v;
      s2 += v * v;
      c++;
    }
    const m = c ? s / c : 0;
    const variance = c ? Math.max(0, s2 / c - m * m) : 0;
    mean.push(m);
    sd.push(variance > 1e-12 ? Math.sqrt(variance) : 1);
  }
  const Z = X.map((row) => row.map((v, j) => (v === null ? 0 : (v - mean[j]) / sd[j])));
  const t = y.map((v) => (v ? 1 : 0));
  const step = 1 / (0.25 * (d + 1) + lambda);
  // Parameters: w (d) then b; v is the look-ahead point.
  let p = new Array<number>(d + 1).fill(0);
  let prev = p.slice();
  const grad = new Array<number>(d + 1);
  for (let it = 0; it < iterations && n > 0; it++) {
    const mom = it / (it + 3);
    const v = p.map((pi, j) => pi + mom * (pi - prev[j]));
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let s = v[d];
      for (let j = 0; j < d; j++) s += v[j] * z[j];
      const e = sigmoid(s) - t[i];
      for (let j = 0; j < d; j++) grad[j] += e * z[j];
      grad[d] += e;
    }
    let big = 0;
    for (let j = 0; j <= d; j++) {
      grad[j] /= n;
      if (j < d) grad[j] += lambda * v[j];
      big = Math.max(big, Math.abs(grad[j]));
    }
    prev = p;
    p = v.map((vj, j) => vj - step * grad[j]);
    if (big < tolerance) break;
  }
  return { kind: 'logistic', columns, mean, sd, w: p.slice(0, d), b: p[d], lambda };
}

/** The model's log-odds for one sample (its raw score; the sigmoid of it is the model's own probability). */
export function scoreLogistic(m: LogisticModel, row: (number | null)[]): number {
  let s = m.b;
  for (let j = 0; j < m.w.length; j++) {
    const v = row[j];
    if (v !== null) s += m.w[j] * ((v - m.mean[j]) / m.sd[j]);
  }
  return s;
}

// --- Calibration --------------------------------------------------------------

export interface Platt {
  a: number;
  b: number;
}

/**
 * Platt scaling: confidence = sigmoid(a·score + b), fitted by Newton's
 * method on the log loss with Platt's smoothed targets ((N₊+1)/(N₊+2) for a
 * yes, 1/(N₋+2) for a no), so a perfectly separated set doesn't send a to
 * infinity. Monotone in the score (increasing when a > 0).
 */
export function fitPlatt(scores: number[], y: boolean[]): Platt {
  const np = y.filter(Boolean).length;
  const nn = y.length - np;
  const hi = (np + 1) / (np + 2);
  const lo = 1 / (nn + 2);
  const t = y.map((v) => (v ? hi : lo));
  // Centre and scale the scores for a well-conditioned fit, then map back.
  const m = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, scores.length)) || 1;
  const z = scores.map((v) => (v - m) / sd);
  let a = 0;
  let b = Math.log((np + 1) / (nn + 1));
  for (let it = 0; it < 100; it++) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-9;
    let hab = 0;
    let hbb = 1e-9;
    for (let i = 0; i < z.length; i++) {
      const p = sigmoid(a * z[i] + b);
      const e = p - t[i];
      const w = p * (1 - p);
      ga += e * z[i];
      gb += e;
      haa += w * z[i] * z[i];
      hab += w * z[i];
      hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-15) break;
    let da = (hbb * ga - hab * gb) / det;
    let db = (haa * gb - hab * ga) / det;
    // Damp big steps; Newton on log loss can overshoot from a poor start.
    const big = Math.max(Math.abs(da), Math.abs(db));
    if (big > 5) ((da *= 5 / big), (db *= 5 / big));
    a -= da;
    b -= db;
    if (big < 1e-10) break;
  }
  return { a: a / sd, b: b - (a * m) / sd };
}

export function calibrate(c: Platt, score: number): number {
  return sigmoid(c.a * score + c.b);
}

// --- Intervals ----------------------------------------------------------------

/** The Wilson score interval's lower bound for `successes` out of `n` (z = 1.96: 95 %). 0 when n is 0. */
export function wilsonLower(successes: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}
