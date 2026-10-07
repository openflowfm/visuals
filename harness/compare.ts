#!/usr/bin/env node
// The comparison bench: each preset drawn by Butterchurn 2.6.7 (the reference,
// what the BlackHole visualizer runs) and by our engine, from the same inputs,
// scored, and laid out side by side for Ryan to approve. Recorded mode in
// docs/milkdrop-engine.md, "The harness".
//
//   npm run compare                                  # --sample 30 across the pack
//   npm run compare -- --sample 60 --frames 300 --size 960x540
//   npm run compare -- "cream-of-the-crop/Geometric/Cube" some/preset.milk
//   npm run compare -- --serve                       # reopen the last report
//
// Same inputs, frame for frame:
// - **Audio.** One synthetic track (a kick at 120 bpm under a chord, with
//   seeded noise, slightly different left and right) is turned into the three
//   1024-byte windows Butterchurn reads per frame — `timeByteArray`, `…L`, `…R` —
//   and written to a file. Butterchurn gets them through `render({audioLevels})`,
//   the engine through `Audio::update_bytes`: the same bytes.
// - **Time.** A fixed step (1/60 s) on both, from a fresh renderer per preset.
// - **Randomness.** Butterchurn's `Math.random` is replaced in its page with the
//   engine's generator (xorshift64*). It is seeded with the engine's noise seed
//   before the visualizer is made, so the noise textures are drawn from the same
//   stream, and re-seeded with the preset seed as the preset loads, so
//   `rand_start`, `rand_preset` and the init equations' `rand()` start from the
//   same numbers. After that the streams part: Butterchurn draws `rand_frame`,
//   shapes, waves and per-frame `rand()` from one global stream, the engine from
//   separate ones. docs/milkdrop-engine.md lists what cannot match.
//
// Writes harness/out/compare/: the frame PNGs, report.json and index.html.
// Approvals are not output: they live in ~/.openflow/visuals/compare/approvals.json
// (`OPENFLOW_HOME` moves it), keyed by the preset's path in the pack, and the
// page saves to it through the small server this command starts on a free port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import { chromium, type Browser } from 'playwright';
import { differenceOf, metricsOf } from '../frameMetrics.ts';
import { materialStructureDifference, materialStructureOf, structuralDifference, structureOf } from '../structuralMetrics.ts';
import { reportHtml, type Approval, type Report, type ReportPreset } from './compareReport.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) positional.push(a);
  else if (['serve', 'no-serve'].includes(a.slice(2))) flags.set(a.slice(2), 'true');
  else flags.set(a.slice(2), argv[++i] ?? '');
}
const flag = (name: string, fallback: string) => flags.get(name) ?? fallback;
const FRAMES = Number(flag('frames', '240'));
const CAPTURES = Number(flag('captures', '3'));
const [WIDTH, HEIGHT] = flag('size', '640x360').split('x').map(Number);
const SEED = BigInt(flag('seed', '1'));
const DT = 1 / 60;
/** The engine's noise textures are drawn from this seed (`Renderer::new`). */
const NOISE_SEED = 0x5eedn;
const SAMPLE = flags.has('sample') ? Number(flag('sample', '30')) : positional.length ? 0 : 30;
if (![FRAMES, CAPTURES, WIDTH, HEIGHT].every((n) => Number.isInteger(n) && n > 0)) {
  throw new Error('--frames, --captures and --size WxH must be positive integers');
}

const presetsRoot = path.resolve(
  process.env.OPENFLOW_VISUALS_PRESETS ?? path.join(os.homedir(), '.openflow', 'visuals', 'presets'),
);
const approvalsFile = path.join(process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow'), 'visuals', 'compare', 'approvals.json');
const outDir = path.join(here, 'out', 'compare');

// --- cleanup: nothing this starts outlives it --------------------------------

let engine: ChildProcess | null = null;
let browser: Browser | null = null;
let server: http.Server | null = null;
const stopAll = () => {
  engine?.kill('SIGKILL');
  server?.close();
  server?.closeAllConnections();
  // Playwright also kills its browser when this process exits; close it first
  // when there is time to.
  void browser?.close().catch(() => {});
};
process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });
}

// --- approvals ---------------------------------------------------------------

const readApprovals = (): Record<string, Approval> => {
  try {
    return JSON.parse(fs.readFileSync(approvalsFile, 'utf8'));
  } catch {
    return {};
  }
};
const writeApprovals = (all: Record<string, Approval>) => {
  fs.mkdirSync(path.dirname(approvalsFile), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(`${approvalsFile}.tmp`, `${JSON.stringify(sorted, null, 1)}\n`);
  fs.renameSync(`${approvalsFile}.tmp`, approvalsFile);
};

/** Serve the report and take approvals, on a free port, until interrupted. */
async function serve(): Promise<void> {
  const saved = path.join(outDir, 'report.json');
  if (!fs.existsSync(saved)) throw new Error(`no report in ${path.relative(root, outDir)} — run npm run compare first`);
  // Rewritten from the run's data, so the page is current and carries today's approvals.
  fs.writeFileSync(path.join(outDir, 'index.html'), reportHtml({ ...(JSON.parse(fs.readFileSync(saved, 'utf8')) as Report), approvalsFile, approvals: readApprovals() }));
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/approvals' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(readApprovals()));
      return;
    }
    if (url.pathname === '/approvals' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const { id, verdict, note, score } = JSON.parse(body) as { id: string; verdict: Approval['verdict']; note: string; score: number | null };
          if (typeof id !== 'string' || !id || !['approve', 'reject', null].includes(verdict) || typeof note !== 'string') throw new Error('expected {id, verdict, note}');
          const all = readApprovals();
          if (!verdict && !note) delete all[id];
          else all[id] = { verdict, note, score: typeof score === 'number' ? score : null, at: new Date().toISOString() };
          writeApprovals(all);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(all[id] ?? null));
        } catch (error) {
          res.writeHead(400);
          res.end((error as Error).message);
        }
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
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  console.log(`\nreport: http://127.0.0.1:${port}/  (approvals save to ${approvalsFile}; Ctrl-C to stop)`);
  await new Promise(() => {});
}

if (flags.has('serve')) {
  await serve();
}

// --- which presets -----------------------------------------------------------

function milkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    // Directories only, not symlinks to them: the pack links its categories
    // at the top as well, and each preset should be found once.
    if (entry.isDirectory()) out.push(...milkFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.milk')) out.push(full);
  }
  return out.sort();
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

function choosePresets(): string[] {
  const chosen: string[] = [];
  const pool: string[] = [];
  for (const arg of positional) {
    const candidates = [path.resolve(arg), path.resolve(presetsRoot, arg)];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new Error(`no preset or folder at ${arg} (looked in . and ${presetsRoot})`);
    if (fs.statSync(found).isDirectory()) pool.push(...milkFiles(found));
    else chosen.push(found);
  }
  if (!positional.length) {
    if (!fs.existsSync(presetsRoot)) throw new Error(`no presets at ${presetsRoot} (OPENFLOW_VISUALS_PRESETS overrides)`);
    pool.push(...milkFiles(presetsRoot));
  }
  const base = positional.length === 1 && pool.length ? path.resolve(presetsRoot, positional[0]) : presetsRoot;
  chosen.push(...(SAMPLE ? sample(pool, SAMPLE, fs.existsSync(base) ? base : presetsRoot) : pool));
  return [...new Set(chosen)];
}

const idOf = (file: string) => {
  const rel = path.relative(presetsRoot, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
};

// --- the shared inputs -------------------------------------------------------

/** The engine's generator (`eel::Memory::random`): xorshift64*, 53 bits. */
function xorshift(seed: bigint) {
  const mask = (1n << 64n) - 1n;
  let s = seed | 1n;
  return () => {
    s ^= s >> 12n;
    s = (s ^ (s << 25n)) & mask;
    s ^= s >> 27n;
    return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
  };
}

/** The track, as the three byte windows per frame both engines read. */
function music(frames: number): Buffer {
  const out = Buffer.alloc(frames * 3 * 1024);
  const noise = xorshift(0xa0d10n);
  const rate = 44_100;
  const hop = rate / 60; // 735 new samples a frame at 60 fps
  const total = Math.ceil(frames * hop) + 1024;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let s = 0; s < total; s++) {
    const t = s / rate;
    const since = (t % 0.5) / 0.5; // a beat every half second
    const kick = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-since * 6);
    const a = Math.sin(2 * Math.PI * 220 * t), cs = Math.sin(2 * Math.PI * 277 * t), e = Math.sin(2 * Math.PI * 330 * t);
    const hiss = (noise() * 2 - 1) * 0.12;
    left[s] = Math.max(-1, Math.min(1, 0.6 * kick + 0.3 * 0.25 * (2 * a + cs + e) + hiss));
    right[s] = Math.max(-1, Math.min(1, 0.6 * kick + 0.3 * 0.25 * (a + cs + 2 * e) - hiss));
  }
  // The engine's `Audio::update`: -1..1 to an unsigned byte centred on 128.
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(128 + Math.max(-1, Math.min(1, v)) * 127)));
  for (let f = 0; f < frames; f++) {
    const end = Math.round((f + 1) * hop) + 1024 - 735;
    for (let i = 0; i < 1024; i++) {
      const s = end - 1024 + i;
      out[(f * 3) * 1024 + i] = byte((left[s] + right[s]) * 0.5);
      out[(f * 3 + 1) * 1024 + i] = byte(left[s]);
      out[(f * 3 + 2) * 1024 + i] = byte(right[s]);
    }
  }
  return out;
}

const captures = Array.from({ length: CAPTURES }, (_, i) => Math.max(1, Math.round((FRAMES * (i + 1)) / CAPTURES)));

// --- Butterchurn's presets: .milk to JSON, as the app converts them -----------

const CONVERTER = 'milkdrop-preset-converter@0.1.2-repaired-4'; // server/presets.ts
const convertedCache = path.join(presetsRoot, '.converted', CONVERTER.replace(/[^a-z0-9.@-]/gi, '_'));

async function convert(file: string): Promise<{ ok: true; json: string } | { ok: false; reason: string }> {
  const text = fs.readFileSync(file, 'latin1');
  const cached = path.join(convertedCache, `${createHash('sha256').update(text).digest('hex')}.json`);
  if (fs.existsSync(cached)) return { ok: true, json: fs.readFileSync(cached, 'utf8') };
  // The app's own worker, so a preset the HLSL converter spins on can be stopped.
  const worker = new Worker(new URL('../server/presetWorker.ts', import.meta.url));
  try {
    const result = await Promise.race([
      new Promise<{ ok: true; json: string } | { ok: false; reason: string }>((resolve) => {
        worker.once('message', resolve);
        worker.once('error', (error: Error) => resolve({ ok: false, reason: error.message }));
        worker.postMessage({ text });
      }),
      new Promise<{ ok: false; reason: string }>((resolve) => setTimeout(() => resolve({ ok: false, reason: 'the converter took longer than 10s' }), 10_000).unref()),
    ]);
    if (result.ok) {
      fs.mkdirSync(convertedCache, { recursive: true });
      fs.writeFileSync(`${cached}.tmp`, result.json);
      fs.renameSync(`${cached}.tmp`, cached);
    }
    return result;
  } finally {
    await worker.terminate();
  }
}

// --- PNG ---------------------------------------------------------------------

function png(rgba: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- scoring -----------------------------------------------------------------

/** Area-average down to at most 320 wide: the metrics judge the picture, not its aliasing. */
function shrink(rgba: Uint8Array, width: number, height: number): { pixels: Uint8Array; width: number; height: number } {
  const factor = Math.max(1, Math.floor(width / 320));
  if (factor === 1) return { pixels: rgba, width, height };
  const w = Math.floor(width / factor), h = Math.floor(height / factor);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += rgba[((y * factor + dy) * width + x * factor + dx) * 4 + c];
        out[(y * w + x) * 4 + c] = Math.round(sum / (factor * factor));
      }
    }
  }
  return { pixels: out, width: w, height: h };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/**
 * One frame pair, 0–100, from the repo's own metrics. Each part is 1 when the
 * pictures agree:
 * - pixels: mean per-channel difference (`differenceOf`), 0 at a third of full scale;
 * - shape: luminous silhouette IoU (`structuralDifference`);
 * - contours: mean contour distance, 0 at a tenth of the diagonal;
 * - colour: coarse chromaticity by region (`materialStructureDifference`), 0 at 0.5;
 * - light: mean luma and lit coverage (`metricsOf`), 0 at 64 levels / half the frame.
 */
const WEIGHTS = { pixels: 0.3, shape: 0.2, contours: 0.2, colour: 0.15, light: 0.15 };
function score(a: Uint8Array, b: Uint8Array): { score: number; parts: Record<string, number> } {
  const A = shrink(a, WIDTH, HEIGHT), B = shrink(b, WIDTH, HEIGHT);
  const { width, height } = A;
  const structure = structuralDifference(structureOf(A.pixels, width, height), structureOf(B.pixels, width, height), width, height);
  const ma = metricsOf(A.pixels, width, height), mb = metricsOf(B.pixels, width, height);
  const parts = {
    pixels: clamp01(1 - 3 * differenceOf(A.pixels, B.pixels)),
    shape: structure.silhouetteIoU,
    contours: clamp01(1 - structure.contourDistance / 0.1),
    colour: clamp01(1 - 2 * materialStructureDifference(materialStructureOf(A.pixels, width, height), materialStructureOf(B.pixels, width, height))),
    light: clamp01(1 - Math.abs(ma.lum - mb.lum) / 64 - Math.abs(ma.coverage - mb.coverage) / 2),
  };
  const total = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * parts[k as keyof typeof parts], 0);
  return { score: Math.round(total * 1000) / 10, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) };
}

function difference(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, 2 * Math.abs(a[i + c] - b[i + c]));
    out[i + 3] = 255;
  }
  return out;
}

// --- run ---------------------------------------------------------------------

const files = choosePresets();
if (!files.length) throw new Error('no presets chosen');
fs.rmSync(outDir, { recursive: true, force: true });
const work = path.join(outDir, 'work');
fs.mkdirSync(work, { recursive: true });
console.log(`compare: ${files.length} presets, ${FRAMES} frames at ${WIDTH}×${HEIGHT}, captures at frames ${captures.join(', ')}`);

const audio = music(FRAMES);
const audioFile = path.join(work, 'audio.bin');
fs.writeFileSync(audioFile, audio);

// Ours: built, then run over the whole plan while Butterchurn renders.
const build = spawnSync('cargo', ['build', '--release', '-q', '-p', 'visuals-engine', '--bin', 'compare'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) throw new Error('cargo build of the compare binary failed');
const metadata = JSON.parse(spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).stdout);
const engineBin = path.join(metadata.target_directory, 'release', 'compare');
const plan = [
  `size\t${WIDTH}\t${HEIGHT}`,
  `frames\t${FRAMES}`,
  `dt\t${DT}`,
  `seed\t${SEED}`,
  `audio\t${audioFile}`,
  `captures\t${captures.join('\t')}`,
  ...files.map((file, i) => `preset\t${i}\t${file}\t${path.join(work, `ours-${i}`)}`),
].join('\n');
fs.writeFileSync(path.join(work, 'plan.txt'), `${plan}\n`);

const ours = new Map<number, { ok: boolean; notes: string[] }>(files.map((_, i) => [i, { ok: false, notes: [] }]));
const engineDone = new Promise<void>((resolve, reject) => {
  engine = spawn(engineBin, [path.join(work, 'plan.txt')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  engine.stdout!.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop()!;
    for (const line of lines) {
      const [kind, index, ...rest] = line.split('\t');
      const entry = ours.get(Number(index));
      if (!entry) continue;
      if (kind === 'ok') entry.ok = true;
      else if (kind === 'fallback') entry.notes.push(`ours: ${rest[0]} shader fell back to the default — ${rest[1] ?? ''}`.trim());
      else if (kind === 'fail') entry.notes.push(`ours failed: ${rest.join(' ')}`);
    }
  });
  let stderr = '';
  engine.stderr!.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  engine.on('exit', (code) => {
    engine = null;
    if (code === 0) resolve();
    else reject(new Error(`the engine exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
  });
});
// Keep an engine failure from surfacing as an unhandled rejection before it is awaited.
engineDone.catch(() => {});

interface Theirs {
  captures: Record<number, string>;
  notes: string[];
}

/** Butterchurn in its own fresh page per preset, so its clock starts where ours does. */
async function butterchurn(json: string): Promise<Theirs> {
  const page = await browser!.newPage({ viewport: { width: 320, height: 200 } });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().split('\n')[0].slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.split('\n')[0].slice(0, 200)));
  try {
    await page.setContent(`<canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>`);
    await page.addScriptTag({ path: require.resolve('butterchurn/lib/butterchurn.min.js') });
    await page.evaluate(
      ({ width, height, seed, noiseSeed }) => {
        // The engine's generator, as `Math.random`.
        const mask = (1n << 64n) - 1n;
        let s = 1n;
        const reseed = (to: string) => (s = BigInt(to) | 1n);
        const random = () => {
          s ^= s >> 12n;
          s = (s ^ (s << 25n)) & mask;
          s ^= s >> 27n;
          return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
        };
        Math.random = random;
        reseed(noiseSeed);
        const B = (window as any).butterchurn.default ?? (window as any).butterchurn;
        const canvas = document.getElementById('c') as HTMLCanvasElement;
        const viz = B.createVisualizer(null, canvas, { width, height, pixelRatio: 1, textureRatio: 1 });
        // `loadPreset` makes a blend pattern first, then rand_start, rand_preset
        // and the init equations: re-seed between the two, where the engine's
        // preset seed starts.
        const pattern = viz.renderer.blendPattern;
        const makePattern = pattern.createBlendPattern.bind(pattern);
        pattern.createBlendPattern = () => {
          makePattern();
          reseed(seed);
        };
        (window as any).__bench = { viz, reseed, random };
      },
      { width: WIDTH, height: HEIGHT, seed: String(SEED), noiseSeed: String(NOISE_SEED) },
    );
    // Butterchurn's two built-in images (`clouds2`, which every unknown sampler
    // reads, and `empty`) decode asynchronously. In the app they are long ready
    // by the first preset; here the first frame would come before them.
    await page.waitForFunction(() => {
      const samplers = (window as any).__bench.viz.renderer.image.samplers;
      return !!samplers.clouds2 && !!samplers.empty;
    }, undefined, { timeout: 5000 });
    const result = await page.evaluate(
      ({ json, width, height, frames, dt, captures, audio, seed }) => {
        const { viz, reseed, random } = (window as any).__bench as { viz: any; reseed: (to: string) => void; random: () => number };
        const r = viz.renderer;
        const gl = r.gl as WebGL2RenderingContext;
        const notes: string[] = [];
        const preset = JSON.parse(json);
        viz.loadPreset(structuredClone(preset), 0);
        // Check the re-seed took: rand_start must be the generator's first four.
        reseed(seed);
        const expected = [random(), random(), random(), random()].map((v) => Math.fround(v));
        const got = Array.from(r.presetEquationRunner.mdVS.rand_start as Float32Array);
        if (expected.some((v, i) => v !== got[i])) notes.push('butterchurn: rand_start did not come from the shared seed');
        // Butterchurn draws black for a shader that will not link; MilkDrop and
        // our engine draw the default. Compare against the default, and say so.
        const linked = (shader: any) => !!shader && !!gl.getProgramParameter(shader.shaderProgram, gl.LINK_STATUS);
        const broken = [!linked(r.warpShader) && 'warp', !linked(r.compShader) && 'comp'].filter(Boolean) as string[];
        if (broken.length) {
          notes.push(`butterchurn: ${broken.join(' and ')} shader would not link (BlackHole draws black) — compared with MilkDrop's default`);
          viz.loadPreset({ ...structuredClone(preset), ...Object.fromEntries(broken.map((k) => [k, ''])) }, 0);
        }
        const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
        const levels = { timeByteArray: new Uint8Array(1024), timeByteArrayL: new Uint8Array(1024), timeByteArrayR: new Uint8Array(1024) };
        const out: Record<number, string> = {};
        const pixels = new Uint8Array(width * height * 4);
        const flipped = new Uint8Array(width * height * 4);
        for (let f = 0; f < frames; f++) {
          levels.timeByteArray.set(bytes.subarray(f * 3072, f * 3072 + 1024));
          levels.timeByteArrayL.set(bytes.subarray(f * 3072 + 1024, f * 3072 + 2048));
          levels.timeByteArrayR.set(bytes.subarray(f * 3072 + 2048, f * 3072 + 3072));
          viz.render({ audioLevels: levels, elapsedTime: dt });
          if (captures.includes(f + 1)) {
            // The canvas, read in the same task as the draw, before it is presented.
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            // GL rows run bottom to top; the files run top to bottom.
            for (let y = 0; y < height; y++) flipped.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
            for (let i = 3; i < flipped.length; i += 4) flipped[i] = 255;
            let text = '';
            for (let i = 0; i < flipped.length; i += 0x8000) text += String.fromCharCode(...flipped.subarray(i, i + 0x8000));
            out[f + 1] = btoa(text);
          }
        }
        return { captures: out, notes };
      },
      { json, width: WIDTH, height: HEIGHT, frames: FRAMES, dt: DT, captures, audio: audio.toString('base64'), seed: String(SEED) },
    );
    return { captures: result.captures, notes: [...result.notes, ...[...new Set(consoleErrors)].slice(0, 3).map((e) => `butterchurn console: ${e}`)] };
  } finally {
    await page.close();
  }
}

const theirs = new Map<number, Theirs | { failed: string }>();
browser = await chromium.launch({
  channel: 'chromium',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
try {
  for (const [i, file] of files.entries()) {
    const converted = await convert(file);
    if (!converted.ok) {
      theirs.set(i, { failed: `the converter failed: ${converted.reason}` });
    } else {
      try {
        theirs.set(i, await butterchurn(converted.json));
      } catch (error) {
        theirs.set(i, { failed: `butterchurn failed: ${(error as Error).message.split('\n')[0]}` });
      }
    }
    if (process.stdout.isTTY) process.stdout.write(`\rbutterchurn ${i + 1}/${files.length}`);
    else if ((i + 1) % 10 === 0 || i + 1 === files.length) console.log(`butterchurn ${i + 1}/${files.length}`);
  }
} finally {
  await browser.close();
  browser = null;
}
process.stdout.write('\nwaiting for the engine… ');
await engineDone;
console.log('done');

// --- score and report --------------------------------------------------------

const presets: ReportPreset[] = [];
for (const [i, file] of files.entries()) {
  const id = idOf(file);
  const slug = `${String(i).padStart(3, '0')}-${path.basename(file, path.extname(file)).replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`;
  const theirSide = theirs.get(i)!;
  const ourSide = ours.get(i)!;
  const entry: ReportPreset = {
    id,
    name: path.basename(file, path.extname(file)),
    folder: path.dirname(id),
    score: null,
    frames: [],
    notes: [...('failed' in theirSide ? [theirSide.failed] : theirSide.notes), ...ourSide.notes],
  };
  if (!('failed' in theirSide) && ourSide.ok) {
    fs.mkdirSync(path.join(outDir, 'frames', slug), { recursive: true });
    for (const frame of captures) {
      const a = new Uint8Array(Buffer.from(theirSide.captures[frame], 'base64'));
      const b = new Uint8Array(fs.readFileSync(path.join(work, `ours-${i}-${frame}.rgba`)));
      for (let k = 3; k < b.length; k += 4) b[k] = 255;
      const rel = (kind: string) => `frames/${slug}/${frame}-${kind}.png`;
      fs.writeFileSync(path.join(outDir, rel('butterchurn')), png(a, WIDTH, HEIGHT));
      fs.writeFileSync(path.join(outDir, rel('ours')), png(b, WIDTH, HEIGHT));
      fs.writeFileSync(path.join(outDir, rel('diff')), png(difference(a, b), WIDTH, HEIGHT));
      entry.frames.push({ frame, time: Math.round(frame * DT * 100) / 100, butterchurn: rel('butterchurn'), ours: rel('ours'), diff: rel('diff'), ...score(a, b) });
    }
    entry.score = Math.round((entry.frames.reduce((s, f) => s + f.score, 0) / entry.frames.length) * 10) / 10;
  }
  presets.push(entry);
}
fs.rmSync(work, { recursive: true, force: true });

const report: Report = {
  generated: new Date().toISOString(),
  settings: { width: WIDTH, height: HEIGHT, frames: FRAMES, dt: DT, seed: String(SEED), captures, presetsRoot },
  weights: WEIGHTS,
  approvalsFile,
  presets,
  approvals: readApprovals(),
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(outDir, 'index.html'), reportHtml(report));

// --- summary -----------------------------------------------------------------

const scored = presets.filter((p) => p.score !== null).sort((a, b) => a.score! - b.score!);
const scores = scored.map((p) => p.score!);
const at = (q: number) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
console.log(`\nscored ${scored.length}/${presets.length}` + (scores.length ? `   min ${scores[0]}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  max ${scores.at(-1)}` : ''));
const bands = [0, 20, 40, 60, 80, 100];
for (let b = 0; b < bands.length - 1; b++) {
  const n = scores.filter((s) => s >= bands[b] && (s < bands[b + 1] || (b === bands.length - 2 && s <= 100))).length;
  console.log(`  ${String(bands[b]).padStart(3)}–${String(bands[b + 1]).padEnd(3)} ${'#'.repeat(n)} ${n}`);
}
console.log('\nworst');
for (const p of scored.slice(0, 8)) console.log(`${String(p.score).padStart(5)}  ${p.id}${p.notes.length ? `  [${p.notes[0].slice(0, 90)}]` : ''}`);
for (const p of presets.filter((p) => p.score === null)) console.log(`  —    ${p.id}  [${p.notes.join('; ').slice(0, 120)}]`);
console.log(`\nwrote ${path.relative(root, path.join(outDir, 'index.html'))}`);

if (flags.has('no-serve') || !process.stdout.isTTY) {
  console.log('approve and reject in the report: npm run compare -- --serve');
  process.exit(0);
}
await serve();
