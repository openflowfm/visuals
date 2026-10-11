// `npm run fixture -- <DIR> [--n N] [--seed S] [--labels FILE]`
//
// Writes a made-up features DIR in lane A's shape (`features.json` and
// `clips/<hash16>.webp`), for trying the tool and for its tests until real
// features exist. Each preset has hidden traits (hue, saturation, motion,
// flow, symmetry) that its features measure with noise and its clip shows; a
// few are outliers (Unique) and a few near-copies of one another. The truth
// per tag is written to `DIR/truth.json`; with `--labels FILE`, simulated
// hand labels (most presets, some unsure) are written there too, so the
// score report can be tried without labelling. Fractal has no feature that
// measures it, to show what a missing measurement looks like.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Features, FeatureRow } from './features.ts';
import { formatLabels, type Label } from './labels.ts';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Traits {
  hue: number; // 0..360
  sat: number; // 0..1
  motion: number; // 0..1
  flow: number; // 0..1
  sym: boolean;
  outlier: boolean;
  fractal: boolean;
}

export const FIXTURE_TAGS = ['red', 'blue', 'warm', 'cold', 'mono', 'busy', 'still', 'liquid', 'symmetric', 'unique', 'fractal'] as const;

function truthOf(t: Traits): Record<string, boolean> {
  const warmHue = t.hue < 60 || t.hue > 330;
  return {
    red: t.sat > 0.3 && (t.hue < 20 || t.hue > 340),
    blue: t.sat > 0.3 && t.hue > 200 && t.hue < 250,
    warm: t.sat > 0.3 && warmHue,
    cold: t.sat > 0.3 && t.hue > 150 && t.hue < 260,
    mono: t.sat <= 0.3,
    busy: t.motion > 0.7,
    still: t.motion < 0.15,
    liquid: t.flow > 0.65,
    symmetric: t.sym,
    unique: t.outlier,
    fractal: t.fractal,
  };
}

function hueShare(hue: number, centre: number): number {
  const d = Math.min(Math.abs(hue - centre), 360 - Math.abs(hue - centre));
  return Math.max(0, 1 - d / 40);
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

/** A 24-frame sprite sheet: a field of the preset's colour with bands moving at its speed, mirrored when symmetric. */
async function clip(t: Traits, frames: number, w: number, h: number): Promise<Buffer> {
  const W = w * frames;
  const px = Buffer.alloc(W * h * 3);
  const freq = t.outlier ? 0.31 : 0.06;
  for (let f = 0; f < frames; f++) {
    const phase = f * t.motion * 1.2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xx = t.sym ? Math.abs(x - w / 2) : x;
        const wob = t.flow * 6 * Math.sin(y * 0.08 + phase);
        const band = 0.5 + 0.5 * Math.sin((xx + wob) * freq + phase * 3 + (t.fractal ? Math.sin(xx * 0.4) * 2 : 0));
        const [r, g, b] = hsv(t.hue, t.sat, 0.15 + 0.85 * band);
        const i = (y * W + f * w + x) * 3;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
    }
  }
  return sharp(px, { raw: { width: W, height: h, channels: 3 } })
    .webp({ quality: 60 })
    .toBuffer();
}

export interface FixtureOptions {
  n?: number;
  seed?: number;
  /** Where to write simulated labels, if anywhere. */
  labels?: string;
}

export interface Fixture {
  features: Features;
  truth: Record<string, Record<string, boolean>>;
  labels: Label[];
}

export async function makeFixture(dir: string, opts: FixtureOptions = {}): Promise<Fixture> {
  const n = opts.n ?? 120;
  const r = rng(opts.seed ?? 1);
  const noise = (s: number) => (r() + r() + r() - 1.5) * s;
  const clipSize: [number, number] = [192, 144];
  const frames = 24;
  mkdirSync(join(dir, 'clips'), { recursive: true });
  const rows: FeatureRow[] = [];
  const truth: Record<string, Record<string, boolean>> = {};
  let base: Traits | null = null;
  for (let i = 0; i < n; i++) {
    let t: Traits = {
      hue: r() * 360,
      sat: r() < 0.15 ? r() * 0.25 : 0.35 + r() * 0.65,
      motion: r(),
      flow: r(),
      sym: r() < 0.3,
      outlier: i % 29 === 7,
      fractal: r() < 0.2,
    };
    // Every 17th preset copies the one before it closely: near-duplicates.
    if (i % 17 === 16 && base) t = { ...base, hue: (base.hue + 2) % 360, motion: Math.min(1, base.motion + 0.01), outlier: false };
    base = t;
    const path = `Fixture/${String(i).padStart(3, '0')} ${t.outlier ? 'odd' : 'preset'}.milk`;
    const hash = createHash('sha256').update(path).digest('hex');
    const warmth = (hueShare(t.hue, 0) + hueShare(t.hue, 30) + hueShare(t.hue, 60) * 0.5 - hueShare(t.hue, 200) - hueShare(t.hue, 230)) * t.sat;
    const features: Record<string, number | null> = {
      hue_red: hueShare(t.hue, 0) * t.sat + noise(0.08),
      hue_blue: hueShare(t.hue, 225) * t.sat + noise(0.08),
      saturation: t.sat + noise(0.05),
      warmth: warmth + noise(0.1),
      motion: t.motion + noise(0.08),
      flow: t.flow + noise(0.15),
      symmetry: (t.sym ? 0.8 : 0.3) + noise(0.25),
      brightness: 0.5 + noise(0.2),
      oddity: t.outlier ? 3 + noise(0.5) : noise(0.4),
      intensity: i % 11 === 3 ? null : t.motion * 0.5 + noise(0.2),
    };
    const clipName = `${hash.slice(0, 16)}.webp`;
    writeFileSync(join(dir, 'clips', clipName), await clip(t, frames, clipSize[0], clipSize[1]));
    rows.push({ path, hash, style: t.sym ? 'Symmetric' : 'Abstract', features, clip: clipName });
    truth[hash] = truthOf(t);
  }
  const features: Features = {
    version: 1,
    analysis: 1,
    size: [384, 288],
    seconds: 10,
    conditions: ['music', 'silence', 'no_waves', 'no_shapes'],
    clip: { frames, fps: 12, size: clipSize },
    names: {
      hue_red: 'share of saturated red pixels',
      hue_blue: 'share of saturated blue pixels',
      saturation: 'mean saturation',
      warmth: 'warm hues minus cold hues, weighted by saturation',
      motion: 'mean block motion between frames',
      flow: 'smoothness of the motion field',
      symmetry: 'left-right mirror similarity',
      brightness: 'mean brightness',
      oddity: 'a made-up outlier measure',
      intensity: 'loudness of the picture (missing on some rows)',
    },
    rows,
    skipped: [{ path: 'Fixture/broken.milk', why: 'made-up failure' }],
  };
  writeFileSync(join(dir, 'features.json'), JSON.stringify(features, null, 1));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 1));
  const labels: Label[] = [];
  const at = new Date(Date.UTC(2026, 9, 1)).toISOString();
  for (const row of rows) {
    for (const tag of FIXTURE_TAGS) {
      const u = r();
      if (u < 0.15) continue; // not labelled
      const answer = u < 0.18 ? 'unsure' : truth[row.hash][tag] ? 'yes' : 'no';
      labels.push({ hash: row.hash, tag, answer, at, path: row.path });
    }
  }
  if (opts.labels) writeFileSync(opts.labels, formatLabels({ version: 1, labels }));
  return { features, truth, labels };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opts: FixtureOptions = {};
  let dir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--n') opts.n = Number(args[++i]);
    else if (a === '--seed') opts.seed = Number(args[++i]);
    else if (a === '--labels') opts.labels = args[++i];
    else if (a.startsWith('--')) {
      console.error(`fixture: unknown option ${a}\nusage: npm run fixture -- <DIR> [--n N] [--seed S] [--labels FILE]`);
      process.exit(2);
    } else dir = a;
  }
  if (!dir || (opts.n !== undefined && !(opts.n > 0))) {
    console.error('usage: npm run fixture -- <DIR> [--n N] [--seed S] [--labels FILE]');
    process.exit(2);
  }
  const f = await makeFixture(dir, opts);
  console.log(`fixture: ${f.features.rows.length} presets in ${dir}${opts.labels ? `, ${f.labels.length} simulated labels in ${opts.labels}` : ''}`);
}
