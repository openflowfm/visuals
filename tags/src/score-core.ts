// The score report's working: for each tag, which scorer predicts the hand
// labels best, how sure it can be made, and whether its precision on presets
// that played no part in choosing, calibrating or thresholding it reaches what
// a shipped tag needs.
//
// Per tag:
// - The dataset is the presets with features whose latest answer is yes or no
//   (unsure answers are left out). It needs `minYes` yeses and `minNo` noes
//   (10 / 10 by default), or the tag says "not enough labels".
// - Folds are stratified group k-fold (`stratifiedGroupFolds`): every
//   near-duplicate cluster (the report's, `findDuplicates`; a preset in none
//   is its own group) lands whole in one fold, so a preset is never tested
//   against a near-copy of itself that was trained on. k = folds (5 by
//   default), lowered to the number of groups holding a yes, or holding a no,
//   when fewer, at least 2. Outer and inner folds alike.
// - The candidate scorers: each single feature (direction chosen on the
//   training folds), logistic regression over every feature, and, when the
//   tag has a rubric and rubric scores cover at least 80 % of its labelled
//   presets, the rubric score alone and logistic regression over the features
//   plus it; for a `nearest-neighbour` tag (Unique) also the distance to the
//   nearest other preset over the whole pack.
// - The recipe, run on any set of labelled presets: cross-validate every
//   candidate on that set (k folds), take the best out-of-fold average
//   precision (ties go to the simpler, earlier one), keep its k fold models,
//   fit Platt scaling on its out-of-fold scores, and take as threshold the
//   lowest confidence whose out-of-fold precision is ≥ 0.85 with ≥ 5 true
//   positives above it (none when no confidence gets there, or Platt's slope
//   isn't positive). A preset's score under the recipe is the mean of the k
//   fold models' raw scores, its confidence that score through the Platt
//   curve, and it is tagged when its confidence, rounded to 4 places as the
//   files store it, is at or over the threshold so rounded.
// - Held-out precision (what "ships" is judged on) is nested
//   cross-validation: outer folds split the dataset; on each outer training
//   set the whole recipe runs (its own inner folds choose the scorer, fit
//   Platt and pick the threshold), and the outer fold's presets, which none
//   of that saw, are scored and tagged with it. Precision and recall are
//   pooled over the outer folds: true positives over everything tagged, and
//   over every yes. The tag ships when that pooled precision is ≥ 0.85 with
//   at least MIN_POSITIVES true positives and the final recipe has a
//   threshold; the 95 % Wilson lower bound of the pooled precision is
//   reported beside it. It estimates how the recipe does on presets it never
//   saw, not one particular fitted model: the outer folds may each pick a
//   different scorer.
// - The final recipe is the recipe run on all of the tag's labels. The
//   scorer table shows its candidates' cross-validated numbers: those chose
//   the scorer, so they flatter it, and the held-out numbers above are the
//   ones to trust.
// - Shipped confidences (`tags.json`): every preset in the pack gets the mean
//   of the final recipe's k fold models' raw scores, through the Platt curve
//   fitted on those same fold models' out-of-fold scores. Shipped scores so
//   come from the same models (an average of them) the calibration and the
//   threshold were fitted on, not from a model refitted on all the labels,
//   whose scores would sit on another scale. `tags.json` keeps the k models.
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
  scoreLogistic,
  scoreThreshold,
  stratifiedGroupFolds,
  thresholdForPrecision,
  wilsonLower,
  type AtThreshold,
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
  /** Out-of-fold average precision over all the tag's labels (what the final recipe chose by). */
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
  /** Outer folds (and the final recipe's folds). */
  folds: number | null;
  /** The final recipe's candidates, cross-validated on all the tag's labels (these chose the scorer, so they flatter it). */
  scorers: ScorerReport[];
  chosen: string | null;
  /** The final recipe's fold models; a preset's raw score is the mean of theirs. */
  models: Model[] | null;
  calibration: Platt | null;
  /** The confidence at and above which a preset gets the tag (the final recipe's, rounded to 4 places); null when no confidence reaches the target. */
  threshold: number | null;
  /** Nested cross-validation, pooled over the outer folds: the precision and recall of the whole recipe on presets that played no part in choosing, calibrating or thresholding it. Precision is null when nothing was tagged. */
  precision: number | null;
  recall: number | null;
  /** 95 % Wilson lower bound on that held-out precision. */
  precisionLower: number | null;
  /** The held-out counts behind them. */
  heldOut: { tp: number; fp: number; fn: number } | null;
  /** Out-of-fold precision and recall at the final threshold on the labels that chose it: optimistic, shown for comparison. */
  selection: { precision: number; recall: number } | null;
  ships: boolean;
  diagnosis: string;
  /** What the example clips are: held out, at each outer fold's threshold, or at the best-F1 held-out confidence when nothing was tagged. Null with no examples. */
  examplesRule: string | null;
  /** Held-out examples by hash, most telling first. */
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
  /**
   * How each shipping tag's confidence is worked out, so it can be reproduced
   * from the features: the raw score is the mean of `models`' raw scores, the
   * confidence `calibration` of it (rounded to 4 places), and a preset has
   * the tag when that is ≥ `threshold`.
   */
  tags: Record<string, { scorer: string; models: Model[]; calibration: Platt; threshold: number }>;
  /** Per preset hash, its confidence for each shipping tag. */
  presets: Record<string, Record<string, number>>;
}

const EXAMPLES = 8;

/** Rounds for the JSON files; confidences and thresholds alike, so `>=` reads the same in the files as here. */
export function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** Whether a confidence gets the tag at a threshold, both as the files store them. */
export function tagged(confidence: number, threshold: number): boolean {
  return r4(confidence) >= r4(threshold);
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

/** A preset's raw score under a recipe: the mean of its fold models' raw scores. */
export function applyModels(models: Model[], row: number, col: Columns): number {
  let s = 0;
  for (const m of models) s += applyModel(m, row, col);
  return s / models.length;
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

/** Folds for a set: the configured number, but no more than the groups holding a yes, or holding a no; at least 2. */
function foldCount(y: boolean[], groups: number[], folds: number): number {
  const withYes = new Set(groups.filter((_, i) => y[i])).size;
  const withNo = new Set(groups.filter((_, i) => !y[i])).size;
  return Math.max(2, Math.min(folds, withYes, withNo));
}

interface Evaluated {
  spec: Spec;
  report: ScorerReport;
  oof: number[];
  models: Model[];
}

/** Cross-validates one scorer on `rows` (pack indices) under the given folds. */
function evaluate(spec: Spec, rows: number[], y: boolean[], fold: number[], k: number, col: Columns): Evaluated {
  const oof = new Array<number>(rows.length).fill(0);
  const models: Model[] = [];
  for (let f = 0; f < k; f++) {
    const train = rows.map((_, i) => i).filter((i) => fold[i] !== f);
    if (!train.length) continue;
    const m = fit(
      spec,
      train.map((i) => rows[i]),
      train.map((i) => y[i]),
      col,
    );
    models.push(m);
    for (let i = 0; i < rows.length; i++) if (fold[i] === f) oof[i] = applyModel(m, rows[i], col);
  }
  const full = spec.kind === 'logistic' || spec.kind === 'logistic+rubric' ? null : fit(spec, rows, y, col);
  const t = thresholdForPrecision(oof, y, TARGET_PRECISION, MIN_POSITIVES);
  const f1 = t ? null : bestF1(oof, y);
  const at = t ?? f1;
  return {
    spec,
    oof,
    models,
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

interface Recipe {
  best: Evaluated;
  evaluated: Evaluated[];
  calibration: Platt;
  /** Null when no confidence reaches the target. */
  threshold: number | null;
  /** Out-of-fold precision and recall at the threshold. */
  at: AtThreshold | null;
  k: number;
}

/**
 * The recipe on one set of labelled presets (`rows`, pack indices, with their
 * answers and duplicate groups): choose the scorer by cross-validated AP, keep
 * its fold models, fit Platt on its out-of-fold scores and pick the threshold
 * on the calibrated out-of-fold confidences.
 */
function runRecipe(specs: Spec[], rows: number[], y: boolean[], groups: number[], folds: number, seed: number, col: Columns): Recipe {
  const k = foldCount(y, groups, folds);
  const fold = stratifiedGroupFolds(y, groups, k, seed);
  const evaluated = specs.map((s) => evaluate(s, rows, y, fold, k, col));
  let best = evaluated[0];
  for (const e of evaluated) if (e.report.ap > best.report.ap + 1e-9) best = e;
  const calibration = fitPlatt(best.oof, y);
  const conf = best.oof.map((s) => r4(calibrate(calibration, s)));
  const at = calibration.a > 0 ? thresholdForPrecision(conf, y, TARGET_PRECISION, MIN_POSITIVES) : null;
  return { best, evaluated, calibration, threshold: at ? r4(at.threshold) : null, at, k };
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
    models: null,
    calibration: null,
    threshold: null,
    precision: null,
    recall: null,
    precisionLower: null,
    heldOut: null,
    selection: null,
    ships: false,
    diagnosis,
    examplesRule: null,
    examples: { truePositives: [], falsePositives: [], missed: [] },
  };
}

interface HeldOut {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number;
}

function diagnose(tag: Tag, scorers: ScorerReport[], chosen: ScorerReport, ships: boolean, rubricUsed: boolean, held: HeldOut, final: Recipe): string {
  if (ships) return `ships: ${chosen.label} reaches P ${fmt(held.precision!)} R ${fmt(held.recall)} held out (nested CV) at confidence ${fmt(final.threshold!)}`;
  const parts: string[] = [];
  if (final.threshold !== null) {
    const p = held.precision === null ? 'tags nothing' : `only reaches P ${fmt(held.precision)} with ${held.tp} true positives`;
    parts.push(`${chosen.label} reaches P ${fmt(final.at!.precision)} on the labels that chose it, but held out (nested CV) ${p}`);
    parts.push('needs more labels or a better measurement');
    return parts.join('; ');
  }
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

  // Standardised once over the whole pack: Unique's distance, the duplicates and the folds' groups.
  const std = standardise(rows, names);
  const nn = nearestDistances(std);
  const duplicates = findDuplicates(rows, nn);
  const groupOf = duplicateGroups(nn);

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
    const groups = data.map((i) => groupOf[i]);

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

    // Nested cross-validation: the recipe runs on each outer training set and tags the outer fold.
    const outerK = foldCount(y, groups, opts.folds);
    const outerFold = stratifiedGroupFolds(y, groups, outerK, opts.seed);
    const heldConf = new Array<number>(data.length).fill(0);
    const heldTagged = new Array<boolean>(data.length).fill(false);
    for (let f = 0; f < outerK; f++) {
      const train = data.map((_, p) => p).filter((p) => outerFold[p] !== f);
      const recipe = runRecipe(
        specs,
        train.map((p) => data[p]),
        train.map((p) => y[p]),
        train.map((p) => groups[p]),
        opts.folds,
        opts.seed + 7919 * (f + 1),
        col,
      );
      for (let p = 0; p < data.length; p++) {
        if (outerFold[p] !== f) continue;
        heldConf[p] = r4(calibrate(recipe.calibration, applyModels(recipe.best.models, data[p], col)));
        heldTagged[p] = recipe.threshold !== null && tagged(heldConf[p], recipe.threshold);
      }
    }
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let p = 0; p < data.length; p++) {
      if (heldTagged[p]) {
        if (y[p]) tp++;
        else fp++;
      } else if (y[p]) fn++;
    }
    const held: HeldOut = { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : 0 };

    // The final recipe, on all the labels: what ships.
    const final = runRecipe(specs, data, y, groups, opts.folds, opts.seed, col);
    const ships = final.threshold !== null && held.precision !== null && held.precision >= TARGET_PRECISION && held.tp >= MIN_POSITIVES;

    // Examples from the held-out predictions: as tagged, or at the best-F1 held-out confidence when nothing was.
    let isTagged = heldTagged;
    let examplesRule: string | null = 'held out: tagged or not by the recipe fitted without them';
    if (tp + fp === 0) {
      const f1 = bestF1(heldConf, y);
      isTagged = f1 ? heldConf.map((c) => c >= f1.threshold) : heldTagged;
      examplesRule = f1 ? `held out, at the best-F1 confidence ${fmt(f1.threshold)} (no outer fold reached the target)` : null;
    }
    const examples = { truePositives: [] as string[], falsePositives: [] as string[], missed: [] as string[] };
    if (examplesRule !== null) {
      const order = heldConf.map((c, p) => [c, p] as const).sort((a, b) => b[0] - a[0]);
      for (const [, p] of order) {
        const hash = rows[data[p]].hash;
        if (isTagged[p] && y[p] && examples.truePositives.length < EXAMPLES) examples.truePositives.push(hash);
        if (isTagged[p] && !y[p] && examples.falsePositives.length < EXAMPLES) examples.falsePositives.push(hash);
      }
      // Missed ones least confident first: the clearest misses.
      for (const [, p] of order.slice().reverse()) if (!isTagged[p] && y[p] && examples.missed.length < EXAMPLES) examples.missed.push(rows[data[p]].hash);
    }

    const scorers = final.evaluated.map((e) => e.report);
    const chosen = final.best.report;
    const models = final.best.models;
    tagReports.push({
      id: tag.id,
      name: tag.name,
      group: tag.group,
      counts,
      folds: outerK,
      scorers,
      chosen: chosen.id,
      models,
      calibration: final.calibration,
      threshold: final.threshold,
      precision: held.precision,
      recall: held.recall,
      precisionLower: wilsonLower(tp, tp + fp),
      heldOut: { tp, fp, fn },
      selection: final.at ? { precision: final.at.precision, recall: final.at.recall } : null,
      ships,
      diagnosis: diagnose(tag, scorers, chosen, ships, rubricUsed, held, final),
      examplesRule,
      examples,
    });

    if (ships) {
      tagsFile.tags[tag.id] = { scorer: chosen.id, models, calibration: final.calibration, threshold: final.threshold! };
      rows.forEach((r, i) => (tagsFile.presets[r.hash][tag.id] = r4(calibrate(final.calibration, applyModels(models, i, col)))));
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

function duplicateCutoff(nn: { distance: number[] }): { median: number; cutoff: number } {
  const sorted = nn.distance.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  return { median, cutoff: median * DUPLICATE_FRACTION };
}

/** Each preset's near-duplicate group (an index of a member; a preset in no cluster is alone in its own), joined as `findDuplicates` joins them. */
export function duplicateGroups(nn: { distance: number[]; nearest: number[] }): number[] {
  const { cutoff } = duplicateCutoff(nn);
  const parent = nn.distance.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  nn.distance.forEach((d, i) => {
    const j = nn.nearest[i];
    if (j >= 0 && d < cutoff) parent[find(i)] = find(j);
  });
  return parent.map((_, i) => find(i));
}

/** Near-duplicate clusters: components of the nearest-neighbour joins shorter than DUPLICATE_FRACTION of the median nearest distance. */
export function findDuplicates(rows: FeatureRow[], nn: { distance: number[]; nearest: number[] }): Report['duplicates'] {
  const { median, cutoff } = duplicateCutoff(nn);
  const group = duplicateGroups(nn);
  const groups = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const g = group[i];
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
    return `${id} ships    ${shortName(c).padEnd(14)} AP ${fmt(c.ap)}  held-out P ${fmt(t.precision!)} (≥ ${fmt(t.precisionLower!)}) R ${fmt(t.recall!)} @ ${fmt(t.threshold!)}   ${counts}`;
  }
  return `${id} not yet  ${t.diagnosis}   ${counts}`;
}
