#!/usr/bin/env node
// The compare bench: each preset drawn by Butterchurn 2.6.7 (the reference, what
// the BlackHole visualizer runs) and by our engine from the same inputs, then
// compared section by section against Butterchurn's own drift (`grid.ts`).
// See compare/README.md.
//
//   npm run compare -- <presets or folders> [--sample N] [--frames N] [--captures N | --every N]
//                      [--size WxH] [--refresh HZ] [--seed N] [--min-score N] [--timeout S]
//   npm run compare -- --serve        # the last report as a page, with approve / reject / note
//
// Writes compare/out/: report.json (every number), frames/<preset>/f<frame>.png
// (one composite per capture) and index.html. One line per preset on stdout,
// then a summary. Exit 0 when every preset ran, 1 when ours failed to load or
// draw one or timed out (or one scored under --min-score, or none was scored),
// 2 on a usage error.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  benchDir,
  buildEngine,
  butterchurn,
  captureFrames,
  composer,
  convert,
  DT,
  factsOf,
  floorRuns,
  heat,
  idOf,
  launchBrowser,
  milkFiles,
  music,
  parseSize,
  presetsRoot,
  refreshLands,
  relaunch,
  resolvePreset,
  runEngine,
  selfDrift,
  Timeout,
  UsageError,
  atExit,
  type Facts,
  type Settings,
} from './bench.ts';
import { compareRun, regionName, SCALE, SECTIONS, type RunComparison } from './grid.ts';
import { approvalsToShow as showApprovals, readApprovals, saveVerdict } from './approvals.ts';
import { reportHtml, type Report, type ReportPreset } from './report.ts';

const outDir = path.join(benchDir, 'out');
const approvalsFile = path.join(process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow'), 'visuals', 'compare', 'approvals.json');

// --- arguments ---------------------------------------------------------------

interface Options extends Settings {
  files: string[];
  seed: bigint;
  minScore: number | null;
  serve: boolean;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const known = ['sample', 'frames', 'captures', 'every', 'size', 'refresh', 'seed', 'min-score', 'timeout'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) positional.push(a);
    else if (a === '--serve') flags.set('serve', 'true');
    else if (known.includes(a.slice(2))) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags.set(a.slice(2), argv[++i]);
    } else throw new UsageError(`unknown option ${a}`);
  }
  const int = (name: string, fallback: number) => {
    const v = Number(flags.get(name) ?? fallback);
    if (!Number.isInteger(v) || v <= 0) throw new UsageError(`--${name} must be a positive integer`);
    return v;
  };
  const frames = int('frames', 240);
  const { width, height } = parseSize(flags.get('size') ?? '640x360');
  const refresh = int('refresh', 60);
  // --every N: a capture every N frames instead of geometric spacing, even enough to watch as a video.
  const every = flags.has('every') ? int('every', 1) : 0;
  const captures = every ? Array.from({ length: Math.floor(frames / every) }, (_, i) => (i + 1) * every) : captureFrames(frames, int('captures', 8));
  if (!refreshLands(refresh, captures)) throw new UsageError(`--refresh ${refresh}: ours' refreshes must land on every capture frame (${captures.join(', ')}; Butterchurn draws 30 a second), so a multiple of 30`);
  const timeout = int('timeout', 30);
  const minScore = flags.has('min-score') ? Number(flags.get('min-score')) : null;
  if (minScore !== null && !(minScore >= 0 && minScore <= 100)) throw new UsageError('--min-score must be 0–100');
  let seed: bigint;
  try {
    seed = BigInt(flags.get('seed') ?? '1');
  } catch {
    throw new UsageError('--seed must be an integer');
  }
  const serve = flags.has('serve');
  const files = serve ? [] : choosePresets(positional, flags.has('sample') ? int('sample', 30) : positional.length ? 0 : 30);
  if (!serve && !files.length) throw new UsageError('no presets chosen');
  return { width, height, frames, refresh, captures, timeout, files, seed, minScore, serve };
}

/** `n` presets spread over the pack's categories, the same ones every run. */
function sample(files: string[], n: number, base: string): string[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = path.relative(base, file).split(path.sep);
    const key = parts.slice(0, Math.min(2, parts.length - 1)).join('/');
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const keys = [...groups.keys()].sort();
  const quota = new Map(keys.map((k) => [k, 0]));
  for (let given = 0, i = 0; given < Math.min(n, files.length); i++) {
    const key = keys[i % keys.length];
    if (quota.get(key)! < groups.get(key)!.length) {
      quota.set(key, quota.get(key)! + 1);
      given++;
    }
  }
  return keys.flatMap((key) => {
    const list = groups.get(key)!;
    const q = quota.get(key)!;
    return Array.from({ length: q }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / q)]);
  });
}

function choosePresets(positional: string[], n: number): string[] {
  const chosen: string[] = [];
  const pool: string[] = [];
  for (const arg of positional) {
    const found = resolvePreset(arg);
    if (fs.statSync(found).isDirectory()) pool.push(...milkFiles(found));
    else chosen.push(found);
  }
  if (!positional.length) {
    if (!fs.existsSync(presetsRoot)) throw new UsageError(`no presets at ${presetsRoot} (OPENFLOW_VISUALS_PRESETS overrides)`);
    pool.push(...milkFiles(presetsRoot));
  }
  const base = positional.length === 1 && pool.length ? resolvePreset(positional[0]) : presetsRoot;
  chosen.push(...(n ? sample(pool, n, base) : pool));
  return [...new Set(chosen)];
}

// --- approvals and the page --------------------------------------------------

const approvalsToShow = () => showApprovals(approvalsFile, (m) => console.error(`compare: ${m}`));

/** Serve the last report and take approvals, on a free port, until interrupted. */
async function serve(): Promise<void> {
  const saved = path.join(outDir, 'report.json');
  if (!fs.existsSync(saved)) throw new UsageError('no report in compare/out: run npm run compare first');
  fs.writeFileSync(path.join(outDir, 'index.html'), reportHtml({ ...(JSON.parse(fs.readFileSync(saved, 'utf8')) as Report), approvalsFile, approvals: approvalsToShow() }));
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/approvals' && req.method === 'GET') {
      try {
        const all = readApprovals(approvalsFile);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(all));
      } catch (error) {
        res.writeHead(500);
        res.end((error as Error).message);
      }
      return;
    }
    if (url.pathname === '/approvals' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const saved = saveVerdict(approvalsFile, body);
        res.writeHead(saved.status, saved.status === 200 ? { 'content-type': 'application/json' } : {});
        res.end(saved.body);
      });
      return;
    }
    const file = path.resolve(outDir, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!file.startsWith(outDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  atExit(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  console.log(`report: http://127.0.0.1:${port}/  (approvals save to ${approvalsFile}; Ctrl-C to stop)`);
  await new Promise(() => {});
}

// --- run ---------------------------------------------------------------------

const round3 = (_: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);

async function run(o: Options): Promise<number> {
  const settings: Settings = o;
  for (const stale of ['frames', 'work', 'report.json', 'index.html']) fs.rmSync(path.join(outDir, stale), { recursive: true, force: true });
  const work = path.join(outDir, 'work');
  fs.mkdirSync(work, { recursive: true });
  console.error(`compare: ${o.files.length} presets, ${o.frames} frames at ${o.width}×${o.height}, captures at frames ${o.captures.join(', ')}`);

  const audio = music(o.frames);
  const audioFile = path.join(work, 'audio.bin');
  fs.writeFileSync(audioFile, audio);
  const bin = buildEngine();
  const engine = runEngine(
    bin,
    work,
    'ours',
    o.files.map((file, i) => ({ file, prefix: path.join(work, `ours-${i}`) })),
    settings,
    o.seed,
    audioFile,
  );
  // Ours again, re-seeded and slightly larger: how far ours drifts from itself.
  const self = selfDrift(o.seed, o.width, o.height);
  const selfEngine = runEngine(
    bin,
    work,
    'self',
    o.files.map((file, i) => ({ file, prefix: path.join(work, `self-${i}`) })),
    { ...settings, width: self.width, height: self.height },
    self.seed,
    audioFile,
  );

  let browser = await launchBrowser();
  const theirs: ({ notes: string[] } | { failed: string })[] = [];
  for (const [i, file] of o.files.entries()) {
    const converted = await convert(file);
    if (!converted.ok) {
      theirs.push({ failed: `the converter failed: ${converted.reason}` });
    } else {
      try {
        const ref = await butterchurn(browser, converted.json, settings, o.seed, audio);
        for (const [frame, pixels] of ref.captures) fs.writeFileSync(path.join(work, `ref-${i}-${frame}.rgba`), pixels);
        for (const [k, run] of floorRuns(o.seed).entries()) {
          const drift = await butterchurn(browser, converted.json, settings, run.seed, run.hiss ? music(o.frames, { hiss: run.hiss }) : audio);
          for (const [frame, pixels] of drift.captures) fs.writeFileSync(path.join(work, `drift${k}-${i}-${frame}.rgba`), pixels);
        }
        theirs.push({ notes: ref.notes });
      } catch (error) {
        // A stuck page may leave Chromium busy: the next preset gets a fresh one.
        if (error instanceof Timeout) browser = await relaunch(browser);
        theirs.push({ failed: `butterchurn failed: ${(error as Error).message.split('\n')[0]}` });
      }
    }
    console.error(`butterchurn ${i + 1}/${o.files.length}`);
  }
  console.error('waiting for the engine…');
  const ours = await engine;
  const selfRuns = await selfEngine;

  const compose = await composer(browser);
  const panelWidth = Math.min(o.width, 400);
  const presets: ReportPreset[] = [];
  const lines: string[] = [];
  for (const [i, file] of o.files.entries()) {
    const id = idOf(file);
    const name = path.basename(file, path.extname(file));
    const slug = `${String(i).padStart(3, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`;
    const facts: Facts = factsOf(fs.readFileSync(file, 'latin1'));
    const their = theirs[i];
    const our = ours[i];
    const entry: ReportPreset = {
      id,
      name,
      folder: path.dirname(id),
      status: 'ok',
      score: null,
      raw: null,
      floorRaw: null,
      sentence: '',
      worst: null,
      facts,
      fallbacks: our.fallbacks,
      failures: [],
      notes: 'failed' in their ? [] : their.notes,
      captures: [],
    };
    if (!our.ok) {
      entry.status = 'failed';
      entry.failures.push(`ours: ${our.failure ?? 'did not finish'}`);
    }
    if ('failed' in their) {
      if (entry.status === 'ok') entry.status = 'reference-failed';
      entry.notes.push(their.failed);
    }
    if (entry.status === 'ok' && !selfRuns[i].ok) entry.notes.push(`ours' own re-run failed (${selfRuns[i].failure ?? 'did not finish'}): the floor is Butterchurn's re-runs only`);
    if (entry.status === 'ok') {
      const read = (kind: string, frame: number) => new Uint8Array(fs.readFileSync(path.join(work, `${kind}-${i}-${frame}.rgba`)));
      const captured = o.captures.map((frame) => ({
        frame,
        ref: read('ref', frame),
        ours: read('ours', frame),
        drifts: floorRuns(o.seed).map((_, k) => read(`drift${k}`, frame)),
        oursDrifts: selfRuns[i].ok ? [{ rgba: read('self', frame), width: self.width, height: self.height }] : [],
      }));
      const result: RunComparison = compareRun(captured, o.width, o.height);
      entry.score = result.score;
      entry.raw = result.raw;
      entry.floorRaw = result.floorRaw;
      entry.sentence = result.sentence;
      if (result.notComparable) entry.status = 'not-comparable';
      else if (o.minScore !== null && result.score < o.minScore) entry.status = 'low';
      fs.mkdirSync(path.join(outDir, 'frames', slug), { recursive: true });
      for (const [k, c] of result.captures.entries()) {
        const image = `frames/${slug}/f${c.frame}.png`;
        const grid = (values: number[]) => ({ rgba: heat(values, SECTIONS.cols, SECTIONS.rows), width: SECTIONS.cols, height: SECTIONS.rows, blocky: true });
        const picture = (rgba: Uint8Array) => ({ rgba, width: o.width, height: o.height });
        const title = `${name} · frame ${c.frame} (${(c.frame * DT).toFixed(2)} s) · score ${c.score} (ours ${c.raw}, floor ${c.floorRaw} similar)`;
        const composite = await compose(
          [
            { label: 'Butterchurn', ...picture(captured[k].ref) },
            { label: 'ours', ...picture(captured[k].ours) },
            { label: `ours beyond the drift floor (white = ${SCALE} or more beyond)`, ...grid(c.excess) },
            { label: 'Butterchurn re-seeded (normal drift)', ...picture(captured[k].drifts[0]) },
            { label: 'drift floor: re-runs vs their own side', ...grid(c.floor.map((d) => d.total * 2)) },
            { label: 'ours vs Butterchurn (same scale)', ...grid(c.ours.map((d) => d.total * 2)) },
          ],
          3,
          panelWidth,
          title,
        );
        fs.writeFileSync(path.join(outDir, image), composite);
        entry.captures.push({
          frame: c.frame,
          time: Math.round(c.frame * DT * 100) / 100,
          weight: c.weight,
          image,
          score: c.score,
          raw: c.raw,
          floorRaw: c.floorRaw,
          whole: c.whole,
          palette: c.palette,
          sides: c.sides,
          sections: c.ours.map((d, s) => ({ section: s, region: regionName(s), ours: d, floor: c.floor[s], excess: c.excess[s] })),
        });
      }
      const worst = [...entry.captures].sort((a, b) => a.score - b.score)[0];
      entry.worst = { frame: worst.frame, score: worst.score, image: worst.image };
    }
    presets.push(entry);
    const tag = { ok: 'ok', low: 'LOW', failed: 'FAIL', 'not-comparable': 'n/c', 'reference-failed': 'ref?' }[entry.status];
    const uses = Object.entries(facts.uses)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const why = [...uses, ...(facts.feedback.strong ? ['strong-feedback'] : [])].join(',') || '-';
    const score = entry.score === null ? '    -' : entry.score.toFixed(1).padStart(5);
    const worst = entry.worst ? `worst f${entry.worst.frame} ${entry.worst.score.toFixed(1)} ${entry.worst.image}` : '';
    const extra = [...entry.failures, ...entry.fallbacks.map((f) => `fallback ${f}`), ...entry.notes].map((n) => n.slice(0, 160));
    lines.push(
      [tag.padEnd(4), score, entry.floorRaw === null ? '' : `floor ${entry.floorRaw.toFixed(1)}`, worst, `[${why}]`, id, entry.sentence ? `— ${entry.sentence}` : '', extra.length ? `{${extra.join('; ')}}` : '']
        .filter(Boolean)
        .join('  '),
    );
  }
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });

  const report: Report = {
    generated: new Date().toISOString(),
    settings: { width: o.width, height: o.height, frames: o.frames, dt: DT, refresh: o.refresh, seed: String(o.seed), floorRuns: floorRuns(o.seed).map((r) => ({ seed: String(r.seed), hiss: r.hiss === undefined ? null : String(r.hiss) })), selfDrift: { ...self, seed: String(self.seed) }, captures: o.captures, presetsRoot, minScore: o.minScore, timeout: o.timeout },
    approvalsFile,
    presets,
    approvals: approvalsToShow(),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, round3, 1));
  fs.writeFileSync(path.join(outDir, 'index.html'), reportHtml(report));

  for (const line of lines) console.log(line);
  const scored = presets.filter((p) => p.score !== null && p.status !== 'not-comparable').map((p) => p.score!);
  const count = (s: ReportPreset['status']) => presets.filter((p) => p.status === s).length;
  const mean = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1) : '-';
  console.log(
    `\nsummary: ${presets.length} presets; scored ${scored.length} (mean ${mean}, min ${scored.length ? Math.min(...scored) : '-'}); ` +
      `not comparable ${count('not-comparable')}; ours failed ${count('failed')}; under --min-score ${count('low')}; Butterchurn failed ${count('reference-failed')}`,
  );
  console.log(`report: ${path.join(outDir, 'report.json')}  composites: ${path.join(outDir, 'frames')}/`);
  if (!scored.length) {
    console.log(`no preset was scored: of ${presets.length}, ${count('not-comparable')} not comparable (Butterchurn drifts too far from itself), ${count('reference-failed')} Butterchurn could not draw, ${count('failed')} ours could not draw`);
    return 1;
  }
  return count('failed') || count('low') ? 1 : 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.serve) await serve();
  else process.exitCode = await run(options);
} catch (error) {
  console.error(`compare: ${(error as Error).message}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
process.exit();
