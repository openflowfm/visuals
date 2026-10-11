import { describe, expect, it } from 'vitest';
import type { Features, FeatureRow } from './features.ts';
import { NEAREST, pickGrid, proxyFor, proxyProblem } from './grid.ts';
import type { Tag } from './vocabulary.ts';

// n presets whose `glow` is i (so high glow = late rows), some with it missing.
function features(n: number, opts: { missingEvery?: number; outlier?: number } = {}): Features {
  const rows: FeatureRow[] = [];
  for (let i = 0; i < n; i++) {
    const glow = opts.missingEvery && i % opts.missingEvery === 0 ? null : i;
    const odd = i === opts.outlier ? 1000 : (i % 7) * 0.1;
    rows.push({ path: `P/${i}.milk`, hash: `h${i}`, style: 'Abstract', features: { glow, odd, other: (i * 37) % 11 }, clip: `c${i}.webp` });
  }
  return { version: 1, analysis: 1, size: [384, 288], seconds: 10, conditions: [], clip: { frames: 24, fps: 12, size: [192, 144] }, names: {}, rows, skipped: [] };
}

const glowHigh: Tag = { id: 'glow', name: 'Glow', group: 'texture', question: 'Which of these Glow?', proxy: { feature: 'glow', direction: 'high' } };
const glowLow: Tag = { ...glowHigh, id: 'dim', name: 'Dim', proxy: { feature: 'glow', direction: 'low' } };
const unique: Tag = { id: 'unique', name: 'Unique', group: 'character', question: 'Which of these are Unique?', scorer: 'nearest-neighbour' };
const missing: Tag = { ...glowHigh, id: 'x', name: 'X', proxy: { feature: 'not_measured', direction: 'high' } };
const none: Tag = { id: 'wtf', name: 'WTF', group: 'character', question: 'Which of these are WTF?' };

const index = (p: { row: FeatureRow }) => Number(p.row.hash.slice(1));

describe('grid picking', () => {
  it('leaves out presets already answered for the tag', () => {
    const f = features(200);
    const answered = new Set(f.rows.filter((_, i) => i % 2 === 0).map((r) => r.hash));
    const g = pickGrid(f, glowHigh, answered, { size: 48, seed: 3 });
    expect(g.remaining).toBe(100);
    expect(g.picked).toHaveLength(48);
    for (const p of g.picked) expect(answered.has(p.row.hash)).toBe(false);
    expect(new Set(g.picked.map((p) => p.row.hash)).size).toBe(48);
  });

  it('mixes likely positives, likely negatives and random ones, by the proxy and its direction', () => {
    const f = features(1000);
    const g = pickGrid(f, glowHigh, new Set(), { size: 48, seed: 1 });
    const by = (b: string) => g.picked.filter((p) => p.bucket === b).map(index);
    expect(by('likely')).toHaveLength(16);
    expect(by('unlikely')).toHaveLength(16);
    expect(by('random')).toHaveLength(16);
    // From the top band (not strictly the top 16), and the bottom band.
    for (const i of by('likely')) expect(i).toBeGreaterThanOrEqual(1000 - 48);
    for (const i of by('unlikely')) expect(i).toBeLessThan(48);
    expect(by('likely').sort((a, b) => a - b)).not.toEqual(Array.from({ length: 16 }, (_, k) => 984 + k));

    const low = pickGrid(f, glowLow, new Set(), { size: 48, seed: 1 });
    for (const p of low.picked.filter((p) => p.bucket === 'likely')) expect(index(p)).toBeLessThan(48);
    expect(low.proxy).toBe('glow');
  });

  it('shuffles the shown order', () => {
    const g = pickGrid(features(1000), glowHigh, new Set(), { size: 48, seed: 2 });
    const buckets = g.picked.map((p) => p.bucket).join();
    expect(buckets).not.toMatch(/^(likely,){16}/);
  });

  it('counts presets without a proxy value as random only', () => {
    const f = features(600, { missingEvery: 2 });
    const g = pickGrid(f, glowHigh, new Set(), { size: 48, seed: 4 });
    for (const p of g.picked.filter((p) => p.bucket !== 'random')) expect(p.row.features.glow).not.toBeNull();
  });

  it("uses nearest-neighbour distance as Unique's proxy, high", () => {
    const f = features(300, { outlier: 123 });
    const proxy = proxyFor(f, unique)!;
    expect(proxy.feature).toBe(NEAREST);
    expect(proxy.values[123]).toBe(Math.max(...(proxy.values as number[])));
    const band = [...(proxy.values as number[])].sort((a, b) => b - a)[47];
    const g = pickGrid(f, unique, new Set(), { size: 48, seed: 1 });
    expect(g.proxy).toBe(NEAREST);
    const likely = g.picked.filter((p) => p.bucket === 'likely');
    expect(likely).toHaveLength(16);
    for (const p of likely) expect(proxy.values[index(p)]).toBeGreaterThanOrEqual(band);
  });

  it("falls back to all random with no proxy, or one the features don't have", () => {
    const f = features(300);
    expect(proxyProblem(f, missing)).toMatch(/not_measured/);
    expect(proxyProblem(f, none)).toMatch(/no proxy/);
    expect(proxyProblem(f, glowHigh)).toBeNull();
    for (const tag of [missing, none]) {
      const g = pickGrid(f, tag, new Set(), { size: 48, seed: 5 });
      expect(g.proxy).toBeNull();
      expect(g.picked).toHaveLength(48);
      expect(g.picked.every((p) => p.bucket === 'random')).toBe(true);
    }
  });

  it('returns fewer when fewer remain, and none when all are answered', () => {
    const f = features(30);
    const answered = new Set(f.rows.slice(0, 20).map((r) => r.hash));
    const g = pickGrid(f, glowHigh, answered, { size: 48, seed: 6 });
    expect(g.picked).toHaveLength(10);
    expect(g.remaining).toBe(10);
    const all = pickGrid(f, glowHigh, new Set(f.rows.map((r) => r.hash)), { size: 48 });
    expect(all.picked).toEqual([]);
    expect(all.remaining).toBe(0);
  });

  it('is deterministic by seed', () => {
    const f = features(800);
    const a = pickGrid(f, glowHigh, new Set(), { size: 48, seed: 9 }).picked.map(index);
    const b = pickGrid(f, glowHigh, new Set(), { size: 48, seed: 9 }).picked.map(index);
    const c = pickGrid(f, glowHigh, new Set(), { size: 48, seed: 10 }).picked.map(index);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
