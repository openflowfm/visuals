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
// floor: Butterchurn's re-runs of the reference, and the candidate drawn again
// re-seeded and slightly larger (as the bench draws ours again). A good metric
// scores every similar pair above every different one.
//
// Beside the random sample, `known` cases in calibration.json are ours against
// Butterchurn, drawn as the bench draws them, with a label from a person who
// looked at the composites: a preset that looks the same (similar) or clearly
// doesn't (different). They count in the separation like any other pair.
// Optionally (`approvals`) ours is also scored against Butterchurn for the
// presets Ryan approved or rejected, as an extra check; those verdicts were
// given against an older engine, so they do not decide the exit.
//
//   npm run calibrate [-- --seed N] [--count N] [--rerender]
//
// Settings are in compare/calibration.json. Renders are cached in
// compare/out/calibrate/renders (ours keyed by the engine bin too), so changing
// the metric re-scores in seconds. Exit 0 when the classes separate, 1 when
// any similar pair scores at or below any different pair or either class is
// empty, 2 on a usage error.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvalsToShow } from './approvals.ts';
import {
  benchDir,
  buildEngine,
  butterchurn,
  captureFrames,
  convertText,
  floorRuns,
  idOf,
  launchBrowser,
  milkFiles,
  music,
  parseSize,
  presetsRoot,
  refreshLands,
  relaunch,
  runEngine,
  selfDrift,
  Timeout,
  UsageError,
  xorshift,
  type Settings,
} from './bench.ts';
import { compareRun, type Captured } from './grid.ts';

interface Known {
  /** A path in the pack. */
  preset: string;
  label: 'similar' | 'different';
  /** Why, for whoever reads the output. */
  why: string;
}

interface Calibration {
  count: number;
  seed: number;
  size: string;
  frames: number;
  captures: number;
  refresh: number;
  /** Seconds one render may take before it is reported as timed out. */
  timeout: number;
  /** How far `shiftedClock` moves the clock, in frames. */
  shiftFrames: number;
  similar: string[];
  different: string[];
  /** Ours against Butterchurn with a person's label, at the bench's own settings. */
  known: { size: string; frames: number; captures: number; cases: Known[] };
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
  for (const k of config.known?.cases ?? []) if (k.label !== 'similar' && k.label !== 'different') throw new UsageError(`known case ${k.preset}: label must be similar or different`);
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
  worst: { frame: number; score: number };
  /** For a different pair: how far the perturbation moved the pixels, mean per channel out of 255. */
  moved?: number;
}

type Captures = Map<number, Uint8Array>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function main(): Promise<number> {
  const o = options();
  const sized = (text: string, frames: number, captures: number): Settings => {
    const settings = { ...parseSize(text), frames, refresh: o.refresh, captures: captureFrames(frames, captures), timeout: o.timeout };
    if (!refreshLands(settings.refresh, settings.captures)) throw new UsageError(`refresh ${settings.refresh} does not land on every capture frame (${settings.captures.join(', ')})`);
    return settings;
  };
  const settings = sized(o.size, o.frames, o.captures);
  const knownSettings = o.known?.cases.length ? sized(o.known.size, o.known.frames, o.known.captures) : null;
  const seed = BigInt(o.seed);
  if (!fs.existsSync(presetsRoot)) throw new UsageError(`no presets at ${presetsRoot}`);
  const pool = milkFiles(presetsRoot);
  const random = xorshift(BigInt(o.seed) * 0x9e3779b1n + 7n);

  const renders = path.join(outDir, 'renders');
  if (o.rerender) fs.rmSync(renders, { recursive: true, force: true });
  fs.mkdirSync(renders, { recursive: true });
  const longest = Math.max(o.frames + o.shiftFrames, knownSettings?.frames ?? 0);
  const track = music(longest);
  const hissTrack = music(o.frames, { hiss: 0xb1e55n });
  const otherTrack = music(o.frames, { other: true });

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  interface Spec {
    key: object;
    text: string;
    seed: bigint;
    audio?: Buffer;
    shift?: number;
  }
  /** Butterchurn's captures for one variant, from the cache or drawn now. */
  const draw = async (at: Settings, spec: Spec): Promise<Captures | null> => {
    const { key, text, seed, audio, shift = 0 } = spec;
    // `timeout` is left out of the key: it never changes a picture.
    const { timeout: _, ...picture } = at;
    const dir = path.join(renders, hash(JSON.stringify({ key, settings: picture, text: hash(text), seed: String(seed), shift })).slice(0, 20));
    const read = () => new Map(at.captures.map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, `${f}.rgba`)))]));
    if (fs.existsSync(path.join(dir, 'done'))) return read();
    if (fs.existsSync(path.join(dir, 'failed'))) return null;
    fs.mkdirSync(dir, { recursive: true });
    const converted = await convertText(text);
    if (!converted.ok) {
      fs.writeFileSync(path.join(dir, 'failed'), converted.reason);
      return null;
    }
    browser ??= await launchBrowser();
    try {
      const drawn = await butterchurn(browser, converted.json, { ...at, frames: at.frames + shift, captures: at.captures.map((f) => f + shift) }, seed, audio ?? track);
      for (const f of at.captures) fs.writeFileSync(path.join(dir, `${f}.rgba`), drawn.captures.get(f + shift)!);
    } catch (error) {
      // A timeout isn't cached: the next run tries again, on a fresh Chromium now.
      if (error instanceof Timeout) browser = await relaunch(browser);
      else fs.writeFileSync(path.join(dir, 'failed'), (error as Error).message);
      console.error(`calibrate: butterchurn failed on ${(key as { v?: string }).v ?? 'a render'}: ${(error as Error).message.split('\n')[0]}`);
      return null;
    }
    fs.writeFileSync(path.join(dir, 'done'), '');
    return read();
  };
  /** The same variant drawn again as the bench draws ours again: re-seeded, slightly larger. */
  const drawSelf = async (at: Settings, spec: Spec) => {
    const self = selfDrift(spec.seed, at.width, at.height);
    const drawn = await draw({ ...at, width: self.width, height: self.height }, { ...spec, key: { ...spec.key, self: true }, seed: self.seed });
    return drawn && { drawn, width: self.width, height: self.height };
  };

  // The sample: random presets that Butterchurn can draw.
  const floorsAt = (at: Settings) => floorRuns(seed).map((run) => ({ seed: run.seed, audio: run.hiss ? music(at.frames, { hiss: run.hiss }) : undefined }));
  /** The drift floor's re-runs, or null when Butterchurn cannot draw the preset. */
  const driftsOf = async (at: Settings, text: string): Promise<Captures[] | null> => {
    const out: Captures[] = [];
    for (const [k, run] of floorsAt(at).entries()) {
      const drawn = await draw(at, { key: { v: `drift${k}` }, text, ...run });
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
    const ref = await draw(settings, { key: { v: 'ref' }, text, seed });
    const drifts = ref && (await driftsOf(settings, text));
    if (ref && drifts) chosen.push({ file, text, ref, drifts });
    console.error(`sampled ${chosen.length}/${o.count}`);
  }

  const pairs: Pair[] = [];
  /** Pairs labelled different whose perturbation changed nothing visible: the preset ignores that input. */
  const noEffect: string[] = [];
  /** Mean per-channel difference, 0–1: only to check that a perturbation took, never in the score. */
  const changed = (at: Settings, a: Captures, b: Captures) => {
    let sum = 0, n = 0;
    for (const f of at.captures) {
      const x = a.get(f)!, y = b.get(f)!;
      for (let i = 0; i < x.length; i += 4) for (let c = 0; c < 3; c++, n++) sum += Math.abs(x[i + c] - y[i + c]);
    }
    return sum / n / 255;
  };
  const compare = (at: Settings, ref: Captures, cand: Captures, drifts: Captures[], self: { drawn: Captures; width: number; height: number } | null) =>
    compareRun(
      at.captures.map(
        (frame): Captured => ({
          frame,
          ref: ref.get(frame)!,
          ours: cand.get(frame)!,
          drifts: drifts.map((d) => d.get(frame)!),
          oursDrifts: self ? [{ rgba: self.drawn.get(frame)!, width: self.width, height: self.height }] : [],
        }),
      ),
      at.width,
      at.height,
    );
  const pairOf = (label: Pair['label'], kind: string, id: string, result: ReturnType<typeof compareRun>): Pair => {
    const worst = result.captures.reduce((a, b) => (b.score < a.score ? b : a));
    return { label, kind, id, score: result.score, raw: result.raw, floorRaw: result.floorRaw, notComparable: result.notComparable, worst: { frame: worst.frame, score: worst.score } };
  };
  /** Pairs labelled different whose perturbation moved the pixels no more than re-seeding does: within drift, so no evidence either way. */
  const withinDrift: Pair[] = [];
  for (const [i, a] of chosen.entries()) {
    const b = chosen[(i + 1) % chosen.length];
    const id = idOf(a.file);
    const variants: Record<string, Spec> = {
      reseed: { key: { v: 'reseed' }, text: a.text, seed: seed ^ 0x51ed27n },
      hiss: { key: { v: 'hiss' }, text: a.text, seed, audio: hissTrack },
      otherPreset: { key: { v: 'ref' }, text: b.text, seed },
      shiftedClock: { key: { v: 'shift' }, text: a.text, seed, shift: o.shiftFrames },
      swappedAudio: { key: { v: 'swappedAudio' }, text: a.text, seed, audio: otherTrack },
      otherEquations: { key: { v: 'otherEquations' }, text: withEquations(a.text, b.text), seed },
    };
    for (const [label, kinds] of [['similar', o.similar], ['different', o.different]] as const) {
      for (const kind of kinds) {
        const cand = await draw(settings, variants[kind]);
        if (!cand) continue;
        const moved = label === 'different' ? changed(settings, a.ref, cand) : 0;
        if (label === 'different' && moved < 2 / 255) {
          noEffect.push(`${kind} ${id}`);
          continue;
        }
        const pair = { ...pairOf(label, kind, id, compare(settings, a.ref, cand, a.drifts, await drawSelf(settings, variants[kind]))), moved: label === 'different' ? moved * 255 : undefined };
        // The label check is pixel-level on purpose: independent of the metric being calibrated.
        if (label === 'different' && moved <= Math.max(...a.drifts.map((d) => changed(settings, a.ref, d)))) withinDrift.push(pair);
        else pairs.push(pair);
      }
    }
    console.error(`scored ${i + 1}/${chosen.length}`);
  }

  // --- ours against Butterchurn: the known cases and the extra check -----------
  let bin: string | null = null;
  /** Ours (and ours re-run, re-seeded and larger) for each file, cached by the bin it was drawn with. */
  const drawOurs = async (at: Settings, files: string[]) => {
    bin ??= buildEngine();
    const stat = fs.statSync(bin);
    const self = selfDrift(seed, at.width, at.height);
    const { timeout: _, ...picture } = at;
    const dirOf = (file: string, which: string) => path.join(renders, hash(JSON.stringify({ v: `ours-${which}`, bin: `${stat.size}-${stat.mtimeMs}`, settings: picture, text: hash(fs.readFileSync(file, 'latin1')), seed: String(seed) })).slice(0, 20));
    const readAt = (dir: string) => new Map(at.captures.map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, `${f}.rgba`)))]));
    const out: ({ ours: Captures; self: { drawn: Captures; width: number; height: number } | null } | null)[] = files.map(() => null);
    for (const [which, s, runSeed] of [['main', at, seed], ['self', { ...at, width: self.width, height: self.height }, self.seed]] as const) {
      const todo = files.flatMap((file, i) => (fs.existsSync(path.join(dirOf(file, which), 'done')) ? [] : [{ file, i, dir: dirOf(file, which) }]));
      if (todo.length) {
        const work = path.join(outDir, 'work');
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work, { recursive: true });
        const audioFile = path.join(work, 'audio.bin');
        fs.writeFileSync(audioFile, track.subarray(0, at.frames * 3072));
        for (const t of todo) fs.mkdirSync(t.dir, { recursive: true });
        const runs = await runEngine(bin, work, which, todo.map((t) => ({ file: t.file, prefix: path.join(t.dir, 'ours') })), s, runSeed, audioFile);
        for (const [k, t] of todo.entries()) {
          if (!runs[k].ok) {
            console.error(`calibrate: ours failed on ${idOf(t.file)}: ${runs[k].failure ?? 'did not finish'}`);
            continue;
          }
          for (const f of at.captures) fs.renameSync(path.join(t.dir, `ours-${f}.rgba`), path.join(t.dir, `${f}.rgba`));
          fs.writeFileSync(path.join(t.dir, 'done'), '');
        }
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
    for (const [i, file] of files.entries()) {
      const main = dirOf(file, 'main'), other = dirOf(file, 'self');
      if (!fs.existsSync(path.join(main, 'done'))) continue;
      out[i] = { ours: readAt(main), self: fs.existsSync(path.join(other, 'done')) ? { drawn: readAt(other), width: self.width, height: self.height } : null };
    }
    return out;
  };
  /** Ours against Butterchurn for these presets, as the bench scores it. */
  const oursAgainst = async (at: Settings, entries: { id: string; label: Pair['label']; kind: string }[]): Promise<Pair[]> => {
    const files = entries.map((e) => path.join(presetsRoot, e.id));
    const ours = await drawOurs(at, files);
    const out: Pair[] = [];
    for (const [i, e] of entries.entries()) {
      const text = fs.readFileSync(files[i], 'latin1');
      const ref = await draw(at, { key: { v: 'ref' }, text, seed });
      const drifts = ref && (await driftsOf(at, text));
      if (!ref || !drifts || !ours[i]) {
        console.error(`calibrate: left out ${e.id}: ${!ours[i] ? 'ours' : 'Butterchurn'} could not draw it`);
        continue;
      }
      out.push(pairOf(e.label, e.kind, e.id, compare(at, ref, ours[i]!.ours, drifts, ours[i]!.self)));
    }
    return out;
  };

  const known = knownSettings ? await oursAgainst(knownSettings, o.known.cases.filter((k) => fs.existsSync(path.join(presetsRoot, k.preset))).map((k) => ({ id: k.preset, label: k.label, kind: `known-${k.label}` }))) : [];
  for (const k of o.known?.cases ?? []) if (!fs.existsSync(path.join(presetsRoot, k.preset))) console.error(`calibrate: known case ${k.preset} is not in the pack`);
  pairs.push(...known);

  // The extra check: ours against Ryan's verdicts. A verdicts file that can't be read is warned about and skipped.
  let verdictPairs: Pair[] = [];
  if (o.approvals) {
    const verdicts = Object.entries(approvalsToShow(approvalsFile, (m) => console.error(`calibrate: ${m}; skipping the extra check`)))
      .filter(([id, v]) => (v?.verdict === 'approve' || v?.verdict === 'reject') && fs.existsSync(path.join(presetsRoot, id)))
      .map(([id, v]) => ({ id, label: (v.verdict === 'approve' ? 'similar' : 'different') as Pair['label'], kind: v.verdict as string }));
    if (verdicts.length) verdictPairs = await oursAgainst(settings, verdicts);
  }
  if (browser) await (browser as Awaited<ReturnType<typeof launchBrowser>>).close();

  // --- how well they separate ------------------------------------------------
  const line = (p: Pair) =>
    `${p.label.padEnd(9)} ${p.kind.padEnd(16)} ${p.score.toFixed(1).padStart(5)}  (worst f${p.worst.frame} ${p.worst.score.toFixed(1)}; ours ${p.raw.toFixed(1)}, floor ${p.floorRaw.toFixed(1)}${p.notComparable ? ', n/c' : ''}${p.moved === undefined ? '' : `, moved ${p.moved.toFixed(1)}/255`})  ${p.id}`;
  // Pairs on a preset the bench calls not comparable say nothing either way: the bench draws no conclusion there.
  const separation = (list: Pair[]) => {
    const similar = list.filter((p) => p.label === 'similar' && !p.notComparable).map((p) => p.score);
    const different = list.filter((p) => p.label === 'different' && !p.notComparable).map((p) => p.score);
    let overlaps = 0;
    for (const s of similar) for (const d of different) if (s <= d) overlaps++;
    return { similarMin: similar.length ? Math.min(...similar) : null, differentMax: different.length ? Math.max(...different) : null, overlaps, of: similar.length * different.length, similar: similar.length, different: different.length };
  };
  for (const p of [...pairs].sort((a, b) => a.score - b.score)) console.log(line(p));
  const kinds = [...new Set(pairs.map((p) => p.kind))];
  console.log('\nmean by kind: ' + kinds.map((k) => `${k} ${(pairs.filter((p) => p.kind === k).reduce((s, p) => s + p.score, 0) / pairs.filter((p) => p.kind === k).length).toFixed(1)}`).join(', '));
  if (known.length) {
    console.log('known cases (ours against Butterchurn, labelled by eye):');
    for (const p of known) console.log(`  ${line(p)}`);
  }
  const sep = separation(pairs);
  const margin = sep.similarMin !== null && sep.differentMax !== null ? ` (margin ${(sep.similarMin - sep.differentMax).toFixed(1)})` : '';
  console.log(`separation: ${sep.similar} similar, min ${sep.similarMin ?? '-'}; ${sep.different} different, max ${sep.differentMax ?? '-'}${margin}; overlapping pairs ${sep.overlaps} of ${sep.of}`);
  if (noEffect.length) console.log(`left out, the perturbation changed nothing visible (the preset ignores that input): ${noEffect.join('; ')}`);
  if (withinDrift.length) {
    console.log('left out, the perturbation moved the pixels no more than re-seeding does (within drift; shown for reference):');
    for (const p of withinDrift) console.log(`  ${line(p)}`);
  }
  if (verdictPairs.length) {
    console.log('\nextra check, ours against the verdicts in approvals.json (given against an older engine; not in the exit code):');
    for (const p of [...verdictPairs].sort((a, b) => a.score - b.score)) console.log(line(p));
    const v = separation(verdictPairs);
    console.log(`approved min ${v.similarMin ?? '-'}, rejected max ${v.differentMax ?? '-'}; overlapping pairs ${v.overlaps} of ${v.of}`);
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ settings: o, captures: settings.captures, pairs, verdictPairs, noEffect, withinDrift, separation: sep }, null, 1));
  if (!sep.similar || !sep.different) {
    console.log(`calibrate: nothing to separate: ${sep.similar} similar and ${sep.different} different pairs were scored (every other pair failed to draw, changed nothing, or is not comparable)`);
    return 1;
  }
  return sep.overlaps ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`calibrate: ${(error as Error).message}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
process.exit();
