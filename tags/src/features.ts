// Lane A's output, read as it comes: `DIR/features.json` (one row per preset
// with its measurements) and `DIR/clips/<hash16>.webp` (a horizontal sprite
// sheet of the preset's clip). Feature names are not fixed: everything here
// treats them generically, as the union of `names` and what the rows carry.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FeatureRow {
  path: string;
  hash: string;
  style: string;
  features: Record<string, number | null>;
  clip: string;
}

export interface Features {
  version: 1;
  analysis: number;
  size: [number, number];
  seconds: number;
  conditions: string[];
  clip: { frames: number; fps: number; size: [number, number] };
  names: Record<string, string>;
  rows: FeatureRow[];
  skipped: { path: string; why: string }[];
}

/** Reads and checks `DIR/features.json`; throws with a plain reason when it isn't one. */
export function loadFeatures(dir: string): Features {
  const file = join(dir, 'features.json');
  if (!existsSync(file)) throw new Error(`${file} doesn't exist (run lane A's features bin, or \`npm run fixture -- ${dir}\`)`);
  const f = JSON.parse(readFileSync(file, 'utf8')) as Features;
  if (f.version !== 1) throw new Error(`${file}: version ${String(f.version)}, expected 1`);
  if (!Array.isArray(f.rows)) throw new Error(`${file}: no rows`);
  if (!f.clip || !(f.clip.frames > 0) || !Array.isArray(f.clip.size)) throw new Error(`${file}: no clip description`);
  f.names ??= {};
  f.skipped ??= [];
  for (const r of f.rows) {
    if (typeof r.hash !== 'string' || typeof r.path !== 'string') throw new Error(`${file}: a row without a path or hash`);
    r.features ??= {};
  }
  return f;
}

/** Every feature name, sorted: those described in `names` plus any a row carries. */
export function featureNames(f: Features): string[] {
  const s = new Set(Object.keys(f.names));
  for (const r of f.rows) for (const k of Object.keys(r.features)) s.add(k);
  return [...s].sort();
}

/** A row's feature value as a finite number, or null (missing, null, NaN). */
export function value(row: FeatureRow, name: string): number | null {
  const v = row.features[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function clipFile(dir: string, row: FeatureRow): string {
  return join(dir, 'clips', row.clip);
}
