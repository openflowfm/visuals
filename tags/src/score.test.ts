import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureNames, type Features } from './features.ts';
import { makeFixture, type Fixture } from './fixture.ts';
import type { Label } from './labels.ts';
import { nearestDistances, standardise } from './matrix.ts';
import { renderReport } from './report-html.ts';
import { applyModel, duplicateGroups, findDuplicates, r4, scoreTags, summaryLine, tagged, type ScoreResult, type TagReport } from './score-core.ts';
import { calibrate, seeded, stratifiedGroupFolds } from './stats.ts';
import { loadVocabulary } from './vocabulary.ts';

const vocabulary = loadVocabulary();
let dir: string;
let fx: Fixture;
let result: ScoreResult;

function tag(r: ScoreResult, id: string): TagReport {
  const t = r.report.tags.find((x) => x.id === id);
  if (!t) throw new Error(`no ${id} in the report`);
  return t;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tags-score-'));
  fx = await makeFixture(dir, { n: 120, seed: 1 });
  result = scoreTags(fx.features, vocabulary, fx.labels, new Map());
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('scoreTags on the fixture', () => {
  it('ships warm and busy on the features that measure them', () => {
    const warm = tag(result, 'warm');
    const busy = tag(result, 'busy');
    expect(warm.ships).toBe(true);
    expect(busy.ships).toBe(true);
    expect(['feature:hue_red', 'feature:warmth', 'logistic']).toContain(warm.chosen);
    expect(['feature:motion', 'feature:intensity', 'logistic']).toContain(busy.chosen);
    for (const t of [warm, busy]) {
      expect(t.precision!).toBeGreaterThanOrEqual(0.85);
      expect(t.threshold!).toBeGreaterThan(0);
      expect(t.threshold!).toBeLessThan(1);
      expect(t.precisionLower!).toBeLessThan(t.precision!);
      expect(t.examples.truePositives.length).toBeGreaterThan(0);
      expect(t.calibration!.a).toBeGreaterThan(0);
      expect(t.diagnosis).toMatch(/^ships: .* held out \(nested CV\)/);
      // The held-out numbers are the pooled outer folds' counts, over every labelled preset.
      const h = t.heldOut!;
      expect(t.precision).toBeCloseTo(h.tp / (h.tp + h.fp), 12);
      expect(t.recall).toBeCloseTo(h.tp / (h.tp + h.fn), 12);
      expect(h.tp).toBeGreaterThanOrEqual(5);
      expect(h.tp + h.fn).toBe(t.counts.usableYes);
      expect(t.models!.length).toBe(t.folds);
    }
    // The chosen scorer has the best held-out AP.
    const best = Math.max(...busy.scorers.map((s) => s.ap));
    expect(busy.scorers.find((s) => s.id === busy.chosen)!.ap).toBeCloseTo(best, 9);
    // Every scorer has its held-out numbers.
    for (const s of busy.scorers) {
      expect(s.ap).toBeGreaterThan(0);
      expect(s.at).not.toBeNull();
    }
  });

  it('gives every preset a confidence for each shipping tag, and the scorer to reproduce it', () => {
    const shipping = result.report.tags.filter((t) => t.ships).map((t) => t.id);
    expect(Object.keys(result.tags.tags).sort()).toEqual(shipping.sort());
    expect(Object.keys(result.tags.presets)).toHaveLength(120);
    for (const p of Object.values(result.tags.presets)) for (const id of shipping) expect(p[id]).toBeGreaterThanOrEqual(0);
    // Confidence above the threshold mostly matches the truth for busy.
    const t = result.tags.tags.busy.threshold;
    const above = fx.features.rows.filter((r) => result.tags.presets[r.hash].busy >= t);
    const right = above.filter((r) => fx.truth[r.hash].busy).length;
    expect(right / above.length).toBeGreaterThan(0.7);
  });

  it('ships confidences from the fold models the calibration and threshold were fitted on', () => {
    const busy = tag(result, 'busy');
    const shipped = result.tags.tags.busy;
    expect(shipped.models).toEqual(busy.models);
    expect(shipped.threshold).toBe(r4(shipped.threshold));
    expect(shipped.threshold).toBe(busy.threshold);
    const col = (i: number, c: string) => fx.features.rows[i].features[c] ?? null;
    fx.features.rows.forEach((r, i) => {
      const mean = shipped.models.reduce((s, m) => s + applyModel(m, i, col), 0) / shipped.models.length;
      expect(result.tags.presets[r.hash].busy).toBe(r4(calibrate(shipped.calibration, mean)));
      expect(result.tags.presets[r.hash].busy >= shipped.threshold).toBe(tagged(calibrate(shipped.calibration, mean), shipped.threshold));
    });
  });

  it('judges a tag by held-out precision, not the precision its threshold was picked on', () => {
    // Red's 12 yeses separate perfectly on the predictions that choose its
    // scorer, but not on presets the recipe never saw.
    const red = tag(result, 'red');
    expect(red.selection!.precision).toBe(1);
    expect(red.precision!).toBeLessThan(0.85);
    expect(red.ships).toBe(false);
    expect(red.diagnosis).toMatch(
      /^hue_red, high reaches P 1\.00 on the labels that chose it, but held out \(nested CV\) only reaches P 0\.\d\d with \d+ true positives; needs more labels or a better measurement$/,
    );
    expect(result.tags.tags.red).toBeUndefined();
  });

  it('says fractal needs a measurement', () => {
    const f = tag(result, 'fractal');
    expect(f.ships).toBe(false);
    expect(f.scorers.length).toBeGreaterThan(2);
    expect(f.diagnosis).toMatch(/^best single feature \(\w+, (high|low)\) only reaches 0\.\d\d precision; logistic 0\.\d\d; no rubric scores; needs a measurement$/);
    expect(summaryLine(f)).toMatch(/^fractal\s+not yet\s+best single feature/);
  });

  it('says a tag nobody labelled has not enough labels', () => {
    expect(tag(result, 'orange').diagnosis).toBe('not enough labels: 0 yes / 0 no (needs 10 / 10)');
    expect(tag(result, 'orange').scorers).toEqual([]);
  });

  it('chooses the rubric when its scores are near-perfect', () => {
    const rubric = new Map<string, Map<string, number>>();
    fx.features.rows.forEach((r, i) => rubric.set(r.hash, new Map([['fractal', fx.truth[r.hash].fractal ? 0.8 + (i % 5) * 0.04 : 0.1 + (i % 7) * 0.03]])));
    const r = scoreTags(fx.features, vocabulary, fx.labels, rubric);
    const f = tag(r, 'fractal');
    expect(f.scorers.map((s) => s.id)).toEqual(expect.arrayContaining(['rubric', 'logistic+rubric']));
    expect(f.chosen).toBe('rubric');
    expect(f.ships).toBe(true);
    // Red has no rubric, so no rubric scorer.
    expect(tag(r, 'red').scorers.some((s) => s.kind === 'rubric')).toBe(false);
  });

  it('scores Unique by nearest-neighbour distance', () => {
    const r = scoreTags(fx.features, vocabulary, fx.labels, new Map(), { minYes: 3 });
    const u = tag(r, 'unique');
    const nn = u.scorers.find((s) => s.id === 'nearest-neighbour');
    expect(nn).toBeDefined();
    expect(nn!.label).toBe('nearest-neighbour distance, high');
    expect(u.folds).toBeLessThanOrEqual(u.counts.usableYes);
  });

  it('finds near-duplicate clusters', () => {
    // The fixture's near-copies share their traits but draw fresh feature
    // noise, so here each 17th preset copies its predecessor's features closely.
    const features: Features = structuredClone(fx.features);
    for (let i = 16; i < features.rows.length; i += 17) {
      const prev = features.rows[i - 1].features;
      features.rows[i].features = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === null ? null : v + 0.001]));
    }
    const r = scoreTags(features, vocabulary, fx.labels, new Map());
    const pairs = r.report.duplicates.clusters.map((c) => c.paths.slice().sort());
    for (let i = 16; i < features.rows.length; i += 17) expect(pairs).toContainEqual([features.rows[i - 1].path, features.rows[i].path].sort());
    expect(r.report.duplicates.cutoff).toBeGreaterThan(0);
    expect(r.report.duplicates.clusters.length).toBeLessThanOrEqual(8);
  });

  it('keeps each near-duplicate cluster in one fold, outer and inner', () => {
    const features: Features = structuredClone(fx.features);
    for (let i = 16; i < features.rows.length; i += 17) {
      const prev = features.rows[i - 1].features;
      features.rows[i].features = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === null ? null : v + 0.001]));
    }
    const rows = features.rows;
    const nn = nearestDistances(standardise(rows, featureNames(features)));
    const groups = duplicateGroups(nn);
    const clusters = findDuplicates(rows, nn).clusters;
    expect(clusters.length).toBeGreaterThanOrEqual(6);
    const index = new Map(rows.map((r, i) => [r.hash, i]));
    // Each cluster is exactly one group, and presets in no cluster are alone.
    for (const c of clusters) expect(new Set(c.hashes.map((h) => groups[index.get(h)!])).size).toBe(1);
    const clustered = new Set(clusters.flatMap((c) => c.hashes));
    rows.forEach((r, i) => {
      if (!clustered.has(r.hash)) expect(groups.filter((g) => g === groups[i])).toHaveLength(1);
    });
    const y = rows.map((r) => fx.truth[r.hash].busy);
    const spans = (fold: number[], members: number[]) => new Set(members.map((p) => fold[p])).size > 1;
    for (const seed of [1, 2, 3]) {
      const outer = stratifiedGroupFolds(y, groups, 5, seed);
      for (const c of clusters)
        expect(
          spans(
            outer,
            c.hashes.map((h) => index.get(h)!),
          ),
        ).toBe(false);
      // An inner split of one outer training set, as the recipe makes it.
      const train = rows.map((_, i) => i).filter((i) => outer[i] !== 0);
      const inner = stratifiedGroupFolds(
        train.map((i) => y[i]),
        train.map((i) => groups[i]),
        5,
        seed + 7919,
      );
      const at = new Map(train.map((i, p) => [i, p]));
      for (const c of clusters) {
        const members = c.hashes.map((h) => index.get(h)!).filter((i) => at.has(i));
        expect(
          spans(
            inner,
            members.map((i) => at.get(i)!),
          ),
        ).toBe(false);
      }
    }
  });

  it('renders every tag, its scorers and the clips as file URLs', () => {
    const html = renderReport(result.report, fx.features, dir);
    for (const t of vocabulary.tags) expect(html).toContain(`id="tag-${t.id}"`);
    expect(html).toContain('Near-duplicates');
    expect(html).toContain('needs a measurement');
    const busy = tag(result, 'busy');
    const row = fx.features.rows.find((r) => r.hash === busy.examples.truePositives[0])!;
    expect(html).toContain('Held-out precision is nested cross-validation');
    expect(html).toContain(`file://`);
    expect(html).toContain(row.clip);
    expect(html).toMatch(/steps\(var\(--frames\)\)/);
    expect(result.report.skipped).toBe(1);
  });
});

describe('labels that are pure noise', () => {
  // 30 random features, 10 yes / 10 no labels unrelated to them: picking the
  // best of ~30 scorers on the same predictions that measure it would often
  // find one that looks precise; held out it must not ship.
  function noise(seed: number): { features: Features; labels: Label[] } {
    const r = seeded(seed);
    const names = Array.from({ length: 30 }, (_, j) => `f${j}`);
    const rows = Array.from({ length: 60 }, (_, i) => ({
      path: `Noise/${i}.milk`,
      hash: `noise-${seed}-${i}`,
      style: 'Abstract',
      features: Object.fromEntries(names.map((n) => [n, r()])),
      clip: `${i}.webp`,
    }));
    const features: Features = { ...fx.features, names: Object.fromEntries(names.map((n) => [n, n])), rows, skipped: [] };
    const picked = rows
      .map((_, i) => [r(), i] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => i);
    const labels: Label[] = picked.slice(0, 20).map((i, k) => ({ hash: rows[i].hash, tag: 'red', answer: k < 10 ? 'yes' : 'no', at: '2026-10-10T00:00:00.000Z' }));
    return { features, labels };
  }

  it('never ships, whatever the seed', () => {
    let looksPrecise = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { features, labels } = noise(seed);
      const red = tag(scoreTags(features, vocabulary, labels, new Map(), { seed }), 'red');
      expect(red.counts.usableYes).toBe(10);
      expect(red.scorers.length).toBeGreaterThanOrEqual(30);
      expect(red.ships, `seed ${seed}: ${red.diagnosis}`).toBe(false);
      if (red.selection) looksPrecise++;
    }
    // On the predictions that chose the scorer, noise often reaches the
    // target (about half the seeds): judged there, as before, it would ship.
    expect(looksPrecise).toBeGreaterThanOrEqual(10);
  });
});

describe('score CLI', () => {
  it('exits 2 on a usage error', () => {
    const p = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'score.ts'), '--folds'], { encoding: 'utf8' });
    expect(p.status).toBe(2);
    expect(p.stderr).toMatch(/usage: npm run score/);
  });
});
