// The score report's working: for each tag, which scorer predicts the hand
// labels best on presets it wasn't fitted on, how sure it can be made, and
// whether it reaches the precision a shipped tag needs.
//
// Per tag:
// - The dataset is the presets with features whose latest answer is yes or no
//   (unsure answers are left out). It needs `minYes` yeses and `minNo` noes
//   (10 / 10 by default), or the tag says "not enough labels".
// - Scorers are compared under stratified k-fold cross-validation (k = folds,
//   5 by default, lowered to the number of yeses or noes when fewer, at least
//   2): each single feature (direction chosen on the training folds),
//   logistic regression over every feature, and, when the tag has a rubric and
//   rubric scores cover at least 80 % of its labelled presets, the rubric
//   score alone and logistic regression over the features plus it; for a
//   `nearest-neighbour` tag (Unique) also the distance to the nearest other
//   preset over the whole pack.
// - The chosen scorer has the best out-of-fold average precision (ties go to
//   the simpler, earlier one). Its out-of-fold scores are calibrated to a 0–1
//   confidence by Platt scaling, and the threshold is the lowest confidence
//   whose out-of-fold precision is ≥ 0.85 with ≥ 5 true positives above it.
//   It ships when there is such a threshold. The precision is measured on the
//   same predictions the threshold was picked on, so the Wilson lower bound
//   is reported beside it.
// - A shipping tag's scorer is refitted on all its labels and every preset in
//   the pack gets a confidence from it (with the out-of-fold calibration).
//
// Near-duplicates: each preset is joined to its nearest other preset when
// that distance is under DUPLICATE_FRACTION of the median nearest distance
// (standardised over the whole pack, as Unique's distance is); the clusters
// are the connected components of those joins.

import { featureNames, value, type FeatureRow, type Features } from './features.ts';
import { answersFor, type Label } from './labels.ts';
import { nearestDistances, standardise } from './matrix.ts';
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
  stratifiedFolds,
  thresholdForPrecision,
  wilsonLower,
  type LogisticModel,
  type Platt,
  type ThresholdModel,
} from './stats.ts';
import type { Tag, Vocabulary } from './vocabulary.ts';

export const TARGET_PRECISION = 0.85;
export const MIN_POSITIVES = 5;
export const RUBRIC_COVERAGE = 0.8;
export const DUPLICATE_FRACTION = 0.25;
/** The names the derived columns go by, beside the features'. */
export const NN_COLUMN = 'nearest-neighbour';
export const RUBRIC_COLUMN = 'rubric';

export interface ScoreOptions {
  folds: number;
  minYes: number;
  minNo: number;
  seed: number;
}

export const DEFAULT_OPTIONS: ScoreOptions = { folds: 5, minYes: 10, minNo: 10, seed: 1 };

export type Model = ThresholdModel | LogisticModel;

export type ScorerKind = 'feature' | 'nearest-neighbour' | 'rubric' | 'logistic' | 'logistic+rubric';

export interface ScorerReport {
  /** `feature:<name>`, `nearest-neighbour`, `rubric`, `logistic` or `logistic+rubric`. */
  id: string;
  kind: ScorerKind;
  /** For people: `flow, high`, `logistic over 10 features`. */
  label: string;
  /** Out-of-fold average precision. */
  ap: number;
  /** The highest out-of-fold precision with at least MIN_POSITIVES true positives. */
  maxPrecision: number;
  /** Out-of-fold precision and recall at the scorer's own threshold: the lowest reaching 0.85, or the best F1 when none does (`reached` false). */
  at: { reached: boolean; precision: number; recall: number; tp: number; fp: number } | null;
}

export interface TagReport {
  id: string;
  name: string;
  group: string;
  /** Latest answers: all of them, and the yes / no ones on presets with features (the dataset). */
  counts: { yes: number; no: number; unsure: number; usableYes: number; usableNo: number };
  folds: number | null;
  scorers: ScorerReport[];
  chosen: string | null;
  model: Model | null;
  calibration: Platt | null;
  /** The confidence at and above which a preset gets the tag. */
  threshold: number | null;
  precision: number | null;
  recall: number | null;
  /** 95 % Wilson lower bound on the precision at the threshold. */
  precisionLower: number | null;
  ships: boolean;
  diagnosis: string;
  /** Out-of-fold examples at the threshold (or the best-F1 confidence when it doesn't ship), by hash, most telling first. */
  examplesAt: number | null;
  examples: { truePositives: string[]; falsePositives: string[]; missed: string[] };
}

export interface Cluster {
  hashes: string[];
  paths: string[];
}

export interface Report {
  version: 1;
  options: ScoreOptions & { target: number; minPositives: number; rubricCoverage: number };
  presets: number;
  skipped: number;
  rubricScores: number;
  tags: TagReport[];
  duplicates: { rule: string; medianDistance: number; cutoff: number; clusters: Cluster[] };
}

export interface TagsFile {
  version: 1;
  /** How each shipping tag's confidence is worked out, so it can be reproduced from the features. */
  tags: Record<string, { scorer: string; model: Model; calibration: Platt; threshold: number }>;
  /** Per preset hash, its confidence for each shipping tag. */
  presets: Record<string, Record<string, number>>;
}

const EXAMPLES = 8;

/** Rounds for the JSON files. */
function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** The value of a column (a feature or a derived one) for a row. */
type Columns = (row: number, column: string) => number | null;

interface Spec {
  id: string;
  kind: ScorerKind;
  columns: string[];
}

function fit(spec: Spec, rows: number[], y: boolean[], col: Columns): Model {
  if (spec.columns.length === 1 && spec.kind !== 'logistic')
    return fitThreshold(
      spec.columns[0],
      rows.map((i) => col(i, spec.columns[0])),
      y,
    );
  return fitLogistic(
    spec.columns,
    rows.map((i) => spec.columns.map((c) => col(i, c))),
    y,
  );
}

export function applyModel(m: Model, row: number, col: Columns): number {
  return m.kind === 'threshold'
    ? scoreThreshold(m, col(row, m.column))
    : scoreLogistic(
        m,
        m.columns.map((c) => col(row, c)),
      );
}

function describeSpec(spec: Spec, model: Model | null): string {
  if (spec.kind === 'logistic') return `logistic over ${spec.columns.length} features`;
  if (spec.kind === 'logistic+rubric') return `logistic over ${spec.columns.length - 1} features + rubric`;
  const dir = model?.kind === 'threshold' ? (model.direction === 1 ? 'high' : 'low') : 'high';
  if (spec.kind === 'rubric') return `rubric, ${dir}`;
  if (spec.kind === 'nearest-neighbour') return `nearest-neighbour distance, ${dir}`;
  return `${spec.columns[0]}, ${dir}`;
}

/** Short name for printed lines: the feature's name, or the kind. */
export function shortName(s: ScorerReport): string {
  return s.kind === 'feature' ? s.id.slice('feature:'.length) : s.id;
}

function fmt(x: number): string {
  return x.toFixed(2);
}

interface Evaluated {
  spec: Spec;
  report: ScorerReport;
  oof: number[];
}

function evaluate(spec: Spec, rows: number[], y: boolean[], fold: number[], k: number, col: Columns): Evaluated {
  const oof = new Array<number>(rows.length).fill(0);
  for (let f = 0; f < k; f++) {
    const train = rows.map((_, i) => i).filter((i) => fold[i] !== f);
    const m = fit(
      spec,
      train.map((i) => rows[i]),
      train.map((i) => y[i]),
      col,
    );
    for (let i = 0; i < rows.length; i++) if (fold[i] === f) oof[i] = applyModel(m, rows[i], col);
  }
  const full = spec.kind === 'logistic' || spec.kind === 'logistic+rubric' ? null : fit(spec, rows, y, col);
  const t = thresholdForPrecision(oof, y, TARGET_PRECISION, MIN_POSITIVES);
  const f1 = t ? null : bestF1(oof, y);
  const at = t ?? f1;
  return {
    spec,
    oof,
    report: {
      id: spec.id,
      kind: spec.kind,
      label: describeSpec(spec, full),
      ap: averagePrecision(oof, y),
      maxPrecision: maxPrecision(oof, y, MIN_POSITIVES),
      at: at ? { reached: !!t, precision: at.precision, recall: at.recall, tp: at.tp, fp: at.fp } : null,
    },
  };
}

function emptyTag(tag: Tag, counts: TagReport['counts'], diagnosis: string): TagReport {
  return {
    id: tag.id,
    name: tag.name,
    group: tag.group,
    counts,
    folds: null,
    scorers: [],
    chosen: null,
    model: null,
    calibration: null,
    threshold: null,
    precision: null,
    recall: null,
    precisionLower: null,
    ships: false,
    diagnosis,
    examplesAt: null,
    examples: { truePositives: [], falsePositives: [], missed: [] },
  };
}

function diagnose(tag: Tag, scorers: ScorerReport[], chosen: ScorerReport, ships: boolean, rubricUsed: boolean, precision: number | null, recall: number | null, threshold: number | null): string {
  if (ships) return `ships: ${chosen.label} reaches P ${fmt(precision!)} R ${fmt(recall!)} at confidence ${fmt(threshold!)}`;
  const parts: string[] = [];
  const singles = scorers.filter((s) => s.kind === 'feature').sort((a, b) => b.maxPrecision - a.maxPrecision || b.ap - a.ap);
  if (singles.length) parts.push(`best single feature (${singles[0].label}) only reaches ${fmt(singles[0].maxPrecision)} precision`);
  for (const kind of ['nearest-neighbour', 'logistic', 'rubric', 'logistic+rubric'] as const) {
    const s = scorers.find((x) => x.kind === kind);
    if (s) parts.push(`${kind} ${fmt(s.maxPrecision)}`);
  }
  if (tag.rubric && !rubricUsed) parts.push('no rubric scores');
  parts.push('needs a measurement');
  return parts.join('; ');
}

export interface ScoreResult {
  report: Report;
  tags: TagsFile;
}

/**
 * Scores every tag in the vocabulary. `rubric` is hash → tag id → 0–1 score
 * (empty when there are none).
 */
export function scoreTags(features: Features, vocabulary: Vocabulary, labels: Label[], rubric: Map<string, Map<string, number>>, options: Partial<ScoreOptions> = {}): ScoreResult {
  const opts: ScoreOptions = { ...DEFAULT_OPTIONS, ...options };
  const rows = features.rows;
  const names = featureNames(features);
  const byHash = new Map<string, number>();
  rows.forEach((r, i) => byHash.set(r.hash, i));

  // Standardised once over the whole pack: Unique's distance and the duplicates.
  const std = standardise(rows, names);
  const nn = nearestDistances(std);
  const duplicates = findDuplicates(rows, nn);

  let rubricTag = '';
  const col: Columns = (i, c) => {
    if (c === NN_COLUMN) return nn.distance[i];
    if (c === RUBRIC_COLUMN) return rubric.get(rows[i].hash)?.get(rubricTag) ?? null;
    return value(rows[i], c);
  };

  const tagReports: TagReport[] = [];
  const tagsFile: TagsFile = { version: 1, tags: {}, presets: {} };
  for (const r of rows) tagsFile.presets[r.hash] = {};

  for (const tag of vocabulary.tags) {
    rubricTag = tag.id;
    const answers = answersFor(labels, tag.id);
    const counts = { yes: 0, no: 0, unsure: 0, usableYes: 0, usableNo: 0 };
    const data: number[] = [];
    const y: boolean[] = [];
    for (const [hash, a] of answers) {
      counts[a]++;
      const i = byHash.get(hash);
      if (i === undefined || a === 'unsure') continue;
      data.push(i);
      y.push(a === 'yes');
      if (a === 'yes') counts.usableYes++;
      else counts.usableNo++;
    }
    if (counts.usableYes < opts.minYes || counts.usableNo < opts.minNo) {
      const missing = counts.yes + counts.no > counts.usableYes + counts.usableNo ? ` (${counts.yes + counts.no - counts.usableYes - counts.usableNo} labelled presets have no features)` : '';
      tagReports.push(emptyTag(tag, counts, `not enough labels: ${counts.usableYes} yes / ${counts.usableNo} no (needs ${opts.minYes} / ${opts.minNo})${missing}`));
      continue;
    }
    const k = Math.max(2, Math.min(opts.folds, counts.usableYes, counts.usableNo));
    const fold = stratifiedFolds(y, k, opts.seed);

    // Features worth trying: present on at least half the dataset and not constant on it.
    const usable = names.filter((n) => {
      const vs = data.map((i) => value(rows[i], n)).filter((v): v is number => v !== null);
      return vs.length >= data.length / 2 && Math.max(...vs) - Math.min(...vs) > 1e-12;
    });
    const covered = data.filter((i) => col(i, RUBRIC_COLUMN) !== null).length;
    const rubricUsed = !!tag.rubric && covered >= RUBRIC_COVERAGE * data.length;
    const specs: Spec[] = usable.map((n) => ({ id: `feature:${n}`, kind: 'feature', columns: [n] }));
    if (tag.scorer === 'nearest-neighbour') specs.push({ id: 'nearest-neighbour', kind: 'nearest-neighbour', columns: [NN_COLUMN] });
    if (rubricUsed) specs.push({ id: 'rubric', kind: 'rubric', columns: [RUBRIC_COLUMN] });
    if (usable.length) specs.push({ id: 'logistic', kind: 'logistic', columns: usable });
    if (rubricUsed && usable.length) specs.push({ id: 'logistic+rubric', kind: 'logistic+rubric', columns: [...usable, RUBRIC_COLUMN] });
    if (!specs.length) {
      tagReports.push(emptyTag(tag, counts, 'no usable features' + (tag.rubric ? ' and no rubric scores' : '') + '; needs a measurement'));
      continue;
    }

    const evaluated = specs.map((s) => evaluate(s, data, y, fold, k, col));
    let best = evaluated[0];
    for (const e of evaluated) if (e.report.ap > best.report.ap + 1e-9) best = e;

    const calibration = fitPlatt(best.oof, y);
    const conf = best.oof.map((s) => calibrate(calibration, s));
    const t = thresholdForPrecision(conf, y, TARGET_PRECISION, MIN_POSITIVES);
    const ships = !!t && calibration.a > 0;
    const f1 = ships ? null : bestF1(conf, y);
    const at = ships ? t : f1;
    const examplesAt = at ? at.threshold : null;

    const examples = { truePositives: [] as string[], falsePositives: [] as string[], missed: [] as string[] };
    if (examplesAt !== null) {
      const order = conf.map((c, i) => [c, i] as const).sort((a, b) => b[0] - a[0]);
      for (const [c, i] of order) {
        const hash = rows[data[i]].hash;
        if (c >= examplesAt && y[i] && examples.truePositives.length < EXAMPLES) examples.truePositives.push(hash);
        if (c >= examplesAt && !y[i] && examples.falsePositives.length < EXAMPLES) examples.falsePositives.push(hash);
      }
      // Missed ones least confident first: the clearest misses.
      for (const [c, i] of order.slice().reverse()) if (c < examplesAt && y[i] && examples.missed.length < EXAMPLES) examples.missed.push(rows[data[i]].hash);
    }

    const model = fit(best.spec, data, y, col);
    const scorers = evaluated.map((e) => e.report);
    const chosen = best.report;
    tagReports.push({
      id: tag.id,
      name: tag.name,
      group: tag.group,
      counts,
      folds: k,
      scorers,
      chosen: chosen.id,
      model,
      calibration,
      threshold: at ? at.threshold : null,
      precision: at ? at.precision : null,
      recall: at ? at.recall : null,
      precisionLower: at ? wilsonLower(at.tp, at.tp + at.fp) : null,
      ships,
      diagnosis: diagnose(tag, scorers, chosen, ships, rubricUsed, at?.precision ?? null, at?.recall ?? null, at?.threshold ?? null),
      examplesAt,
      examples,
    });

    if (ships) {
      tagsFile.tags[tag.id] = { scorer: chosen.id, model, calibration, threshold: t!.threshold };
      rows.forEach((r, i) => (tagsFile.presets[r.hash][tag.id] = r4(calibrate(calibration, applyModel(model, i, col)))));
    }
  }

  return {
    report: {
      version: 1,
      options: { ...opts, target: TARGET_PRECISION, minPositives: MIN_POSITIVES, rubricCoverage: RUBRIC_COVERAGE },
      presets: rows.length,
      skipped: features.skipped.length,
      rubricScores: rubric.size,
      tags: tagReports,
      duplicates,
    },
    tags: tagsFile,
  };
}

/** Near-duplicate clusters: components of the nearest-neighbour joins shorter than DUPLICATE_FRACTION of the median nearest distance. */
export function findDuplicates(rows: FeatureRow[], nn: { distance: number[]; nearest: number[] }): Report['duplicates'] {
  const sorted = nn.distance.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const cutoff = median * DUPLICATE_FRACTION;
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  nn.distance.forEach((d, i) => {
    const j = nn.nearest[i];
    if (j >= 0 && d < cutoff) parent[find(i)] = find(j);
  });
  const groups = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });
  const clusters = [...groups.values()].filter((g) => g.length > 1).map((g) => ({ hashes: g.map((i) => rows[i].hash), paths: g.map((i) => rows[i].path) }));
  clusters.sort((a, b) => b.paths.length - a.paths.length || a.paths[0].localeCompare(b.paths[0]));
  return {
    rule: `joined to its nearest other preset when closer than ${DUPLICATE_FRACTION} × the median nearest distance (standardised features over the whole pack)`,
    medianDistance: r4(median),
    cutoff: r4(cutoff),
    clusters,
  };
}

/** One line per tag for the terminal. */
export function summaryLine(t: TagReport, width = 12): string {
  const id = t.id.padEnd(width);
  const counts = `${t.counts.usableYes} yes / ${t.counts.usableNo} no`;
  if (t.ships) {
    const c = t.scorers.find((s) => s.id === t.chosen)!;
    return `${id} ships    ${shortName(c).padEnd(14)} AP ${fmt(c.ap)}  P ${fmt(t.precision!)} R ${fmt(t.recall!)} @ ${fmt(t.threshold!)}   ${counts}`;
  }
  return `${id} not yet  ${t.diagnosis}   ${counts}`;
}
