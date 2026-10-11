import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Features } from './features.ts';
import { makeFixture, type Fixture } from './fixture.ts';
import { renderReport } from './report-html.ts';
import { scoreTags, summaryLine, type ScoreResult, type TagReport } from './score-core.ts';
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
  it('ships red and busy on the features that measure them', () => {
    const red = tag(result, 'red');
    const busy = tag(result, 'busy');
    expect(red.ships).toBe(true);
    expect(busy.ships).toBe(true);
    expect(['feature:hue_red', 'feature:warmth', 'logistic']).toContain(red.chosen);
    expect(['feature:motion', 'feature:intensity', 'logistic']).toContain(busy.chosen);
    for (const t of [red, busy]) {
      expect(t.precision!).toBeGreaterThanOrEqual(0.85);
      expect(t.threshold!).toBeGreaterThan(0);
      expect(t.threshold!).toBeLessThan(1);
      expect(t.precisionLower!).toBeLessThan(t.precision!);
      expect(t.examples.truePositives.length).toBeGreaterThan(0);
      expect(t.calibration!.a).toBeGreaterThan(0);
      expect(t.diagnosis).toMatch(/^ships: /);
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
    // Confidence above the threshold mostly matches the truth for red.
    const t = result.tags.tags.red.threshold;
    const above = fx.features.rows.filter((r) => result.tags.presets[r.hash].red >= t);
    const right = above.filter((r) => fx.truth[r.hash].red).length;
    expect(right / above.length).toBeGreaterThan(0.7);
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

  it('renders every tag, its scorers and the clips as file URLs', () => {
    const html = renderReport(result.report, fx.features, dir);
    for (const t of vocabulary.tags) expect(html).toContain(`id="tag-${t.id}"`);
    expect(html).toContain('Near-duplicates');
    expect(html).toContain('needs a measurement');
    const red = tag(result, 'red');
    const row = fx.features.rows.find((r) => r.hash === red.examples.truePositives[0])!;
    expect(html).toContain(`file://`);
    expect(html).toContain(row.clip);
    expect(html).toMatch(/steps\(var\(--frames\)\)/);
    expect(result.report.skipped).toBe(1);
  });
});

describe('score CLI', () => {
  it('exits 2 on a usage error', () => {
    const p = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'score.ts'), '--folds'], { encoding: 'utf8' });
    expect(p.status).toBe(2);
    expect(p.stderr).toMatch(/usage: npm run score/);
  });
});
