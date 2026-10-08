#!/usr/bin/env node
// How well the bench's score separates pictures that should count as the same
// from pictures that should not. Presets are picked at random from the pack
// (seeded, so a run is reproducible) and the labelled pairs are built from them,
// all drawn by Butterchurn so the labels hold by construction:
//
// - similar: Butterchurn against Butterchurn with another rand seed (`reseed`),
//   or with the track's noise seeded differently (`hiss`);
// - different: Butterchurn of another sampled preset (`otherPreset`), the same
//   preset with its clock shifted (`shiftedClock`), to another song
//   (`swappedAudio`), or with another preset's equations (`otherEquations`).
//
// Each pair is scored exactly as the bench scores ours, against the same drift
// floor. A good metric scores every similar pair above every different one.
// Optionally (`approvals` in calibration.json) ours is scored against
// Butterchurn for the presets Ryan approved or rejected, as an extra check;
// those verdicts were given against an older engine, so they do not decide the exit.
//
//   npm run calibrate [-- --seed N] [--count N] [--rerender]
//
// Settings are in compare/calibration.json. Renders are cached in
// compare/out/calibrate/renders, so changing the metric re-scores in seconds.
// Exit 0 when the classes separate, 1 when any similar pair scores at or below
// any different pair, 2 on a usage error.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  benchDir,
  buildEngine,
  butterchurn,
  captureFrames,
  convert,
  convertText,
  floorRuns,
  idOf,
  launchBrowser,
  milkFiles,
  music,
  presetsRoot,
  runEngine,
  UsageError,
  xorshift,
  type Settings,
} from './bench.ts';
import { compareRun } from './grid.ts';

interface Calibration {
  count: number;
  seed: number;
  size: string;
  frames: number;
  captures: number;
  refresh: number;
  /** How far `shiftedClock` moves the clock, in frames. */
  shiftFrames: number;
  similar: string[];
  different: string[];
  /** Also score ours against the verdicts in approvals.json. */
  approvals: boolean;
}

const SIMILAR = ['reseed', 'hiss'];
const DIFFERENT = ['otherPreset', 'shiftedClock', 'swappedAudio', 'otherEquations'];
const outDir = path.join(benchDir, 'out', 'calibrate');
const approvalsFile = path.join(process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow'), 'visuals', 'compare', 'approvals.json');

function options(): Calibration & { rerender: boolean } {
  const config = JSON.parse(fs.readFileSync(path.join(benchDir, 'calibration.json'), 'utf8')) as Calibration;
  const argv = process.argv.slice(2);
  let rerender = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rerender') rerender = true;
    else if (a === '--seed' || a === '--count') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) throw new UsageError(`${a} must be a positive integer`);
      config[a.slice(2) as 'seed' | 'count'] = v;
    } else throw new UsageError(`unknown argument ${a}`);
  }
  for (const k of config.similar) if (!SIMILAR.includes(k)) throw new UsageError(`unknown similar perturbation ${k} (${SIMILAR.join(', ')})`);
  for (const k of config.different) if (!DIFFERENT.includes(k)) throw new UsageError(`unknown different perturbation ${k} (${DIFFERENT.join(', ')})`);
  return { ...config, rerender };
}

/** A's text with B's equations: same shaders, waves and shapes, another preset's motion. */
function withEquations(a: string, b: string): string {
  const equation = /^(per_frame_|per_pixel_|per_frame_init_)\d+\s*=/i;
  const lines = a.split(/\r?\n/).filter((l) => !equation.test(l));
  return [...lines, ...b.split(/\r?\n/).filter((l) => equation.test(l))].join('\n');
}

interface Pair {
  label: 'similar' | 'different';
  kind: string;
  id: string;
  score: number;
  floorRaw: number;
  raw: number;
  notComparable: boolean;
}

async function main(): Promise<number> {
  const o = options();
  const [width, height] = o.size.split('x').map(Number);
  const settings: Settings = { width, height, frames: o.frames, refresh: o.refresh, captures: captureFrames(o.frames, o.captures) };
  const seed = BigInt(o.seed);
  if (!fs.existsSync(presetsRoot)) throw new UsageError(`no presets at ${presetsRoot}`);
  const pool = milkFiles(presetsRoot);
  const random = xorshift(BigInt(o.seed) * 0x9e3779b1n + 7n);

  const renders = path.join(outDir, 'renders');
  if (o.rerender) fs.rmSync(renders, { recursive: true, force: true });
  fs.mkdirSync(renders, { recursive: true });
  const track = music(o.frames + o.shiftFrames);
  const hissTrack = music(o.frames, { hiss: 0xb1e55n });
  const otherTrack = music(o.frames, { other: true });

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  /** Butterchurn's captures for one variant, from the cache or drawn now. */
  const draw = async (key: object, text: string, opts: { seed: bigint; audio?: Buffer; shift?: number }): Promise<Map<number, Uint8Array> | null> => {
    const dir = path.join(renders, createHash('sha256').update(JSON.stringify({ key, settings, text: createHash('sha256').update(text).digest('hex'), seed: String(opts.seed), shift: opts.shift ?? 0 })).digest('hex').slice(0, 20));
    const read = () => new Map(settings.captures.map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, `${f}.rgba`)))]));
    if (fs.existsSync(path.join(dir, 'done'))) return read();
    if (fs.existsSync(path.join(dir, 'failed'))) return null;
    fs.mkdirSync(dir, { recursive: true });
    const converted = await convertText(text);
    if (!converted.ok) {
      fs.writeFileSync(path.join(dir, 'failed'), converted.reason);
      return null;
    }
    browser ??= await launchBrowser();
    const shift = opts.shift ?? 0;
    try {
      const drawn = await butterchurn(browser, converted.json, { ...settings, frames: settings.frames + shift, captures: settings.captures.map((f) => f + shift) }, opts.seed, opts.audio ?? track);
      for (const f of settings.captures) fs.writeFileSync(path.join(dir, `${f}.rgba`), drawn.captures.get(f + shift)!);
    } catch (error) {
      fs.writeFileSync(path.join(dir, 'failed'), (error as Error).message);
      return null;
    }
    fs.writeFileSync(path.join(dir, 'done'), '');
    return read();
  };

  // The sample: random presets that Butterchurn can draw.
  type Captures = Map<number, Uint8Array>;
  const floors = floorRuns(seed).map((run) => ({ seed: run.seed, audio: run.hiss ? music(o.frames, { hiss: run.hiss }) : undefined }));
  /** The drift floor's re-runs, or null when Butterchurn cannot draw the preset. */
  const driftsOf = async (text: string): Promise<Captures[] | null> => {
    const out: Captures[] = [];
    for (const [k, run] of floors.entries()) {
      const drawn = await draw({ v: `drift${k}` }, text, run);
      if (!drawn) return null;
      out.push(drawn);
    }
    return out;
  };
  const chosen: { file: string; text: string; ref: Captures; drifts: Captures[] }[] = [];
  const tried = new Set<number>();
  while (chosen.length < o.count && tried.size < pool.length) {
    const at = Math.floor(random() * pool.length);
    if (tried.has(at)) continue;
    tried.add(at);
    const file = pool[at];
    const text = fs.readFileSync(file, 'latin1');
    const ref = await draw({ v: 'ref' }, text, { seed });
    const drifts = ref && (await driftsOf(text));
    if (ref && drifts) chosen.push({ file, text, ref, drifts });
    console.error(`sampled ${chosen.length}/${o.count}`);
  }

  const pairs: Pair[] = [];
  /** Pairs labelled different whose perturbation changed nothing visible: the preset ignores that input. */
  const noEffect: string[] = [];
  /** Mean per-channel difference, 0–1: only to check that a perturbation took, never in the score. */
  const changed = (a: Captures, b: Captures) => {
    let sum = 0, n = 0;
    for (const f of settings.captures) {
      const x = a.get(f)!, y = b.get(f)!;
      for (let i = 0; i < x.length; i += 4) for (let c = 0; c < 3; c++, n++) sum += Math.abs(x[i + c] - y[i + c]);
    }
    return sum / n / 255;
  };
  /** Pairs labelled different whose perturbation moved the pixels no more than re-seeding does: within drift, so no evidence either way. */
  const withinDrift: Pair[] = [];
  const score = (label: Pair['label'], kind: string, id: string, ref: Captures, cand: Captures, drifts: Captures[]) => {
    const moved = label === 'different' ? changed(ref, cand) : 0;
    if (label === 'different' && moved < 2 / 255) {
      noEffect.push(`${kind} ${id}`);
      return;
    }
    const result = compareRun(
      settings.captures.map((frame) => ({ frame, ref: ref.get(frame)!, ours: cand.get(frame)!, drifts: drifts.map((d) => d.get(frame)!) })),
      width,
      height,
    );
    const pair = { label, kind, id, score: result.score, raw: result.raw, floorRaw: result.floorRaw, notComparable: result.notComparable };
    // The label check is pixel-level on purpose: independent of the metric being calibrated.
    if (label === 'different' && moved <= Math.max(...drifts.map((d) => changed(ref, d)))) withinDrift.push(pair);
    else pairs.push(pair);
  };
  for (const [i, a] of chosen.entries()) {
    const b = chosen[(i + 1) % chosen.length];
    const id = idOf(a.file);
    const variants: Record<string, () => Promise<Map<number, Uint8Array> | null>> = {
      reseed: () => draw({ v: 'reseed' }, a.text, { seed: seed ^ 0x51ed27n }),
      hiss: () => draw({ v: 'hiss' }, a.text, { seed, audio: hissTrack }),
      otherPreset: async () => b.ref,
      shiftedClock: () => draw({ v: 'shift' }, a.text, { seed, shift: o.shiftFrames }),
      swappedAudio: () => draw({ v: 'swappedAudio' }, a.text, { seed, audio: otherTrack }),
      otherEquations: () => draw({ v: 'otherEquations' }, withEquations(a.text, b.text), { seed }),
    };
    for (const [label, kinds] of [['similar', o.similar], ['different', o.different]] as const) {
      for (const kind of kinds) {
        const cand = await variants[kind]();
        if (cand) score(label, kind, id, a.ref, cand, a.drifts);
      }
    }
    console.error(`scored ${i + 1}/${chosen.length}`);
  }

  // The extra check: ours against Ryan's verdicts.
  const verdictPairs: Pair[] = [];
  if (o.approvals && fs.existsSync(approvalsFile)) {
    const verdicts = Object.entries(JSON.parse(fs.readFileSync(approvalsFile, 'utf8')) as Record<string, { verdict: string | null }>)
      .filter(([id, v]) => (v.verdict === 'approve' || v.verdict === 'reject') && fs.existsSync(path.join(presetsRoot, id)))
      .map(([id, v]) => ({ id, verdict: v.verdict as 'approve' | 'reject', file: path.join(presetsRoot, id) }));
    if (verdicts.length) {
      const work = path.join(outDir, 'work');
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const audioFile = path.join(work, 'audio.bin');
      fs.writeFileSync(audioFile, track.subarray(0, o.frames * 3072));
      const engine = runEngine(buildEngine(), work, 'ours', verdicts.map((v, i) => ({ file: v.file, prefix: path.join(work, `ours-${i}`) })), settings, seed, audioFile);
      const sides = [];
      for (const v of verdicts) {
        const text = fs.readFileSync(v.file, 'latin1');
        sides.push({ ref: await draw({ v: 'ref' }, text, { seed }), drifts: await driftsOf(text) });
      }
      const runs = await engine;
      for (const [i, v] of verdicts.entries()) {
        const { ref, drifts } = sides[i];
        if (!ref || !drifts || !runs[i].ok) continue;
        const ours = new Map(settings.captures.map((f) => [f, new Uint8Array(fs.readFileSync(path.join(work, `ours-${i}-${f}.rgba`)))]));
        const result = compareRun(settings.captures.map((frame) => ({ frame, ref: ref.get(frame)!, ours: ours.get(frame)!, drifts: drifts.map((d) => d.get(frame)!) })), width, height);
        verdictPairs.push({ label: v.verdict === 'approve' ? 'similar' : 'different', kind: v.verdict, id: v.id, score: result.score, raw: result.raw, floorRaw: result.floorRaw, notComparable: result.notComparable });
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  if (browser) await (browser as Awaited<ReturnType<typeof launchBrowser>>).close();

  // --- how well they separate ------------------------------------------------
  const line = (p: Pair) => `${p.label.padEnd(9)} ${p.kind.padEnd(14)} ${p.score.toFixed(1).padStart(5)}  (ours ${p.raw.toFixed(1)}, floor ${p.floorRaw.toFixed(1)}${p.notComparable ? ', n/c' : ''})  ${p.id}`;
  // Pairs on a preset the bench calls not comparable say nothing either way: the bench draws no conclusion there.
  const separation = (list: Pair[]) => {
    const similar = list.filter((p) => p.label === 'similar' && !p.notComparable).map((p) => p.score);
    const different = list.filter((p) => p.label === 'different' && !p.notComparable).map((p) => p.score);
    let overlaps = 0;
    for (const s of similar) for (const d of different) if (s <= d) overlaps++;
    return { similarMin: Math.min(...similar), differentMax: Math.max(...different), overlaps, of: similar.length * different.length, similar: similar.length, different: different.length };
  };
  for (const p of [...pairs].sort((a, b) => a.score - b.score)) console.log(line(p));
  const kinds = [...new Set(pairs.map((p) => p.kind))];
  console.log('\nmean by kind: ' + kinds.map((k) => `${k} ${(pairs.filter((p) => p.kind === k).reduce((s, p) => s + p.score, 0) / pairs.filter((p) => p.kind === k).length).toFixed(1)}`).join(', '));
  const sep = separation(pairs);
  console.log(`separation: ${sep.similar} similar, min ${sep.similarMin}; ${sep.different} different, max ${sep.differentMax}; overlapping pairs ${sep.overlaps} of ${sep.of}`);
  if (noEffect.length) console.log(`left out, the perturbation changed nothing visible (the preset ignores that input): ${noEffect.join('; ')}`);
  if (withinDrift.length) {
    console.log('left out, the perturbation moved the pixels no more than re-seeding does (within drift; shown for reference):');
    for (const p of withinDrift) console.log(`  ${line(p)}`);
  }
  if (verdictPairs.length) {
    console.log('\nextra check, ours against the verdicts in approvals.json (given against an older engine; not in the exit code):');
    for (const p of [...verdictPairs].sort((a, b) => a.score - b.score)) console.log(line(p));
    const v = separation(verdictPairs);
    console.log(`approved min ${v.similarMin}, rejected max ${v.differentMax}; overlapping pairs ${v.overlaps} of ${v.of}`);
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ settings: o, captures: settings.captures, pairs, verdictPairs, noEffect, withinDrift, separation: sep }, null, 1));
  return sep.overlaps ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`calibrate: ${(error as Error).message}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
process.exit();
