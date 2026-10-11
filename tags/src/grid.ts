// Which presets a labelling grid shows for one tag. Pure and seedable.
//
// Presets already answered for the tag are left out. The rest are picked as
// about a third likely positives, a third likely negatives and a third random,
// by the tag's proxy feature, so a rare tag still gets yeses to click: likely
// positives are sampled from the band of unlabelled presets furthest in the
// proxy's direction (a band, not strictly the top, so grids vary), likely
// negatives from the band furthest the other way. Unique's proxy is each
// preset's distance to its nearest neighbour in standardised feature space,
// high. With no proxy, or one the features don't have, the grid is all random.
// Presets without a proxy value can only come up as random ones. The shown
// order is shuffled, so where a clip sits says nothing about why it was picked.

import { featureNames, value, type Features, type FeatureRow } from './features.ts';
import { nearestDistances, standardise } from './matrix.ts';
import type { Tag } from './vocabulary.ts';

export const NEAREST = 'nearest-neighbour distance';

export interface Proxy {
  /** The feature's name, or `NEAREST` for Unique. */
  feature: string;
  direction: 'high' | 'low';
  /** One value per row of the features, in their order; null where missing. */
  values: (number | null)[];
}

export type Bucket = 'likely' | 'unlikely' | 'random';

export interface Picked {
  row: FeatureRow;
  /** Why it was picked; for tests and diagnostics, not for the page (it would bias the answer). */
  bucket: Bucket;
}

export interface Grid {
  picked: Picked[];
  /** Unanswered presets for the tag before this pick. */
  remaining: number;
  /** The proxy used, or null when the grid is all random. */
  proxy: string | null;
}

export interface PickOptions {
  size?: number;
  seed?: number;
  /** A proxy worked out beforehand (Unique's is costly); otherwise `proxyFor` is called. */
  proxy?: Proxy | null;
}

/** A small seeded generator (mulberry32). */
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

function shuffle<T>(xs: T[], r: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** Why a tag's grids are all random, or null when it has a usable proxy. */
export function proxyProblem(f: Features, tag: Tag): string | null {
  if (tag.scorer === 'nearest-neighbour') return f.rows.length < 2 ? 'fewer than two presets, so no nearest-neighbour distance' : null;
  if (!tag.proxy) return 'no proxy feature';
  if (!featureNames(f).includes(tag.proxy.feature)) return `its proxy feature ${tag.proxy.feature} isn't in the features`;
  if (!f.rows.some((r) => value(r, tag.proxy!.feature) !== null)) return `its proxy feature ${tag.proxy.feature} has no values`;
  return null;
}

/** Each row's nearest-neighbour distance over every feature (Unique's proxy). */
export function nearestProxy(f: Features): Proxy {
  const { distance } = nearestDistances(standardise(f.rows, featureNames(f)));
  return { feature: NEAREST, direction: 'high', values: distance };
}

/** The tag's proxy over the rows, or null when grids for it are all random. */
export function proxyFor(f: Features, tag: Tag): Proxy | null {
  if (proxyProblem(f, tag)) return null;
  if (tag.scorer === 'nearest-neighbour') return nearestProxy(f);
  const { feature, direction } = tag.proxy!;
  return { feature, direction, values: f.rows.map((r) => value(r, feature)) };
}

/** Samples `k` from the first `band` of `ordered` that aren't taken yet. */
function fromBand(ordered: number[], k: number, taken: Set<number>, r: () => number): number[] {
  const free = ordered.filter((i) => !taken.has(i));
  const band = free.slice(0, Math.min(free.length, Math.max(k * 3, Math.ceil(free.length * 0.04))));
  const out = shuffle(band, r).slice(0, k);
  for (const i of out) taken.add(i);
  return out;
}

export function pickGrid(f: Features, tag: Tag, answered: ReadonlySet<string> | ReadonlyMap<string, unknown>, opts: PickOptions = {}): Grid {
  const size = Math.max(1, Math.floor(opts.size ?? 48));
  const r = seeded(opts.seed ?? 1);
  const proxy = opts.proxy !== undefined ? opts.proxy : proxyFor(f, tag);
  const open: number[] = [];
  f.rows.forEach((row, i) => {
    if (!answered.has(row.hash)) open.push(i);
  });
  const taken = new Set<number>();
  const picked: { i: number; bucket: Bucket }[] = [];
  if (proxy) {
    const withValue = open.filter((i) => proxy.values[i] !== null && proxy.values[i] !== undefined);
    const sign = proxy.direction === 'high' ? -1 : 1;
    // Furthest in the proxy's direction first; ties by row order, so it's deterministic.
    const ordered = withValue.sort((a, b) => sign * ((proxy.values[a] as number) - (proxy.values[b] as number)) || a - b);
    const third = Math.round(size / 3);
    for (const i of fromBand(ordered, third, taken, r)) picked.push({ i, bucket: 'likely' });
    for (const i of fromBand([...ordered].reverse(), third, taken, r)) picked.push({ i, bucket: 'unlikely' });
  }
  const rest = shuffle(
    open.filter((i) => !taken.has(i)),
    r,
  ).slice(0, size - picked.length);
  for (const i of rest) picked.push({ i, bucket: 'random' });
  return {
    picked: shuffle(picked, r).map(({ i, bucket }) => ({ row: f.rows[i], bucket })),
    remaining: open.length,
    proxy: proxy ? proxy.feature : null,
  };
}
