// What the compare bench and its calibration share: the inputs both engines are
// given, Butterchurn in headless Chromium, the engine's bin, the composite
// pictures, and the cleanup that keeps nothing running after the bench ends.
//
// Same inputs, frame for frame:
// - **Audio.** One synthetic track (a kick at 120 bpm under a chord, with seeded
//   noise, slightly different left and right) is turned into the three 1024-byte
//   windows Butterchurn reads per frame — `timeByteArray`, `…L`, `…R` — and
//   written to a file. Butterchurn gets them through `render({audioLevels})`, the
//   engine through `Audio::update_bytes`: the same bytes.
// - **Time.** A fresh renderer per preset. Butterchurn makes one frame per preset
//   step, 1/30 s apart (MilkDrop's pace in Winamp, the engine's `PRESET_RATE`);
//   ours draws `refresh` pictures a second, feeding back once a step and drawing
//   between steps in between, and is captured at the refreshes that land on
//   Butterchurn's frames.
// - **Randomness.** Butterchurn's `Math.random` is replaced in its page with the
//   engine's generator (xorshift64*). It is seeded with the engine's noise seed
//   before the visualizer is made, so the noise textures are drawn from the same
//   stream, and re-seeded with the preset seed as the preset loads, so
//   `rand_start`, `rand_preset` and the init equations' `rand()` start from the
//   same numbers. After that the streams part: Butterchurn draws `rand_frame`,
//   shapes, waves and per-frame `rand()` from one global stream, the engine from
//   separate ones. That is what the drift floor (`grid.ts`) is for.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The `compare/` folder. */
export const benchDir = path.resolve(here, '..');
/** The repository: the Cargo workspace. */
export const repoRoot = path.resolve(benchDir, '..');
const require = createRequire(import.meta.url);

/** One Butterchurn frame is one preset step: 1/30 s, MilkDrop's pace in Winamp (`PRESET_RATE`). */
export const DT = 1 / 30;
/** The engine's noise textures are drawn from this seed (`textures::noise_data`). */
export const NOISE_SEED = 0x5eedn;
/**
 * The drift floor's Butterchurn re-runs: another rand seed, and another rand
 * seed with the track's noise seeded differently too. Everything a re-run
 * changes should count as "the same picture"; the floor is the furthest of them.
 */
export const floorRuns = (seed: bigint): { seed: bigint; hiss?: bigint }[] => [{ seed: seed ^ 0x9e3779b97f4a7c15n }, { seed: seed ^ 0x2545f4914f6cdd1dn, hiss: 0xf100dn }];

/**
 * The candidate's own re-run (ours in the bench): another rand seed, drawn
 * about 2.5% larger. Every pixel lands a fraction of a texel elsewhere, the
 * size of difference WebGL and wgpu make, and a preset that feeds back strongly
 * amplifies it as it amplifies theirs; the sections compare at any size.
 */
export const selfDrift = (seed: bigint, width: number, height: number) => ({
  seed: seed ^ 0x5bd1e9955bd1e995n,
  width: width + Math.max(2, Math.round(width / 40)),
  height: height + Math.max(1, Math.round(height / 40)),
});

/** `WxH`, both whole and from 16 to 4096. */
export function parseSize(text: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(text);
  const [width, height] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
  if (![width, height].every((n) => Number.isInteger(n) && n >= 16 && n <= 4096)) throw new UsageError(`size must be WxH, each 16–4096, e.g. 640x360 (got ${text})`);
  return { width, height };
}

/**
 * Whether ours, drawing `refresh` pictures a second, has a refresh landing on
 * every capture frame (Butterchurn's frames are 1/30 s apart): it must, or the
 * capture is never drawn.
 */
export function refreshLands(refresh: number, captures: number[]): boolean {
  return captures.every((frame) => {
    const at = frame * refresh * DT;
    return Math.abs(at - Math.round(at)) < 1e-6;
  });
}

export const presetsRoot = path.resolve(process.env.OPENFLOW_VISUALS_PRESETS ?? path.join(os.homedir(), '.openflow', 'visuals', 'presets'));

/** A mistake in how the bench was called: exit 2. */
export class UsageError extends Error {}

export interface Settings {
  width: number;
  height: number;
  frames: number;
  refresh: number;
  /** 1-based frames to capture, ascending. */
  captures: number[];
  /** Seconds one preset may take on either side before it is stopped and reported as timed out. */
  timeout: number;
}

/** A preset that took longer than `Settings.timeout`. */
export class Timeout extends Error {}

/** `n` captures from frame 1 to the last, spaced geometrically: early frames, before streams part, say the most. */
export function captureFrames(frames: number, n: number): number[] {
  if (n <= 1) return [frames];
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(Math.max(1, Math.min(frames, Math.round(frames ** (i / (n - 1))))));
  return [...out].sort((a, b) => a - b);
}

// --- cleanup: nothing this starts outlives it --------------------------------

const children = new Set<ChildProcess>();
const browsers = new Set<Browser>();
const onExit = new Set<() => void>();
export const atExit = (stop: () => void) => onExit.add(stop);
const stopAll = () => {
  for (const child of children) child.kill('SIGKILL');
  for (const stop of onExit) stop();
  // Playwright also kills its browser when this process exits; close it first
  // when there is time to.
  for (const browser of browsers) void browser.close().catch(() => {});
};
process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });
}

// --- presets -----------------------------------------------------------------

export function milkFiles(dir: string): string[] {
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

/** A preset named by its path, absolute, relative to here, or in the pack. */
export function resolvePreset(arg: string): string {
  const found = [path.resolve(arg), path.resolve(presetsRoot, arg)].find((c) => fs.existsSync(c));
  if (!found) throw new UsageError(`no preset or folder at ${arg} (looked in . and ${presetsRoot})`);
  return found;
}

/** The path in the pack: what approvals and the calibration set are keyed by. */
export const idOf = (file: string) => {
  const rel = path.relative(presetsRoot, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
};

export interface Facts {
  /** Which random sources the preset reads: why it drifts. */
  uses: { rand: boolean; rand_frame: boolean; rand_start: boolean; rand_preset: boolean };
  /** `fDecay` and whether the picture feeds back strongly (decay ≥ 0.98 with a warp shader or per-pixel equations): chaos amplifies small differences. */
  feedback: { decay: number; strong: boolean };
}

export function factsOf(text: string): Facts {
  const equations = text
    .split(/\r?\n/)
    .filter((l) => /^(per_frame|per_pixel|per_frame_init|shape_\d+_|wave_\d+_|shapecode_\d+_|wavecode_\d+_)/i.test(l) && !/^(shapecode|wavecode)_\d+_[a-z_]+=[-\d.e]+\s*$/i.test(l))
    .join('\n');
  const decay = Number(/^fDecay\s*=\s*([-\d.e]+)/im.exec(text)?.[1] ?? '0.98');
  const warpShader = /^warp_1\s*=/im.test(text);
  const perPixel = /^per_pixel_\d+\s*=/im.test(text);
  return {
    uses: { rand: /\brand\s*\(/i.test(equations), rand_frame: /\brand_frame\b/i.test(text), rand_start: /\brand_start\b/i.test(text), rand_preset: /\brand_preset\b/i.test(text) },
    feedback: { decay, strong: decay >= 0.98 && (warpShader || perPixel) },
  };
}

// --- the shared inputs -------------------------------------------------------

/** The engine's generator (`eel::Memory::random`): xorshift64*, 53 bits. */
export function xorshift(seed: bigint) {
  const mask = (1n << 64n) - 1n;
  let s = seed | 1n;
  return () => {
    s ^= s >> 12n;
    s = (s ^ (s << 25n)) & mask;
    s ^= s >> 27n;
    return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
  };
}

/**
 * The track, as the three byte windows per frame both engines read. `hiss`
 * seeds its noise; `other` is a different song (90 bpm, another chord, louder
 * highs), which calibration uses as a broken input.
 */
export function music(frames: number, { hiss: hissSeed = 0xa0d10n, other = false }: { hiss?: bigint; other?: boolean } = {}): Buffer {
  const out = Buffer.alloc(frames * 3 * 1024);
  const noise = xorshift(hissSeed);
  const beat = other ? 60 / 90 : 0.5;
  const [n1, n2, n3] = other ? [392, 494, 587] : [220, 277, 330];
  const rate = 44_100;
  const hop = rate * DT; // 1470 new samples a step at 30 a second
  const total = Math.ceil(frames * hop) + 1024;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let s = 0; s < total; s++) {
    const t = s / rate;
    const since = (t % beat) / beat; // a beat every half second
    const kick = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-since * 6);
    const a = Math.sin(2 * Math.PI * n1 * t), cs = Math.sin(2 * Math.PI * n2 * t), e = Math.sin(2 * Math.PI * n3 * t);
    const hiss = (noise() * 2 - 1) * (other ? 0.3 : 0.12);
    left[s] = Math.max(-1, Math.min(1, 0.6 * kick + 0.3 * 0.25 * (2 * a + cs + e) + hiss));
    right[s] = Math.max(-1, Math.min(1, 0.6 * kick + 0.3 * 0.25 * (a + cs + 2 * e) - hiss));
  }
  // The engine's `audio::to_byte`, as a browser's AnalyserNode makes bytes: 128 × (v + 1), truncated.
  const byte = (v: number) => Math.max(0, Math.min(255, Math.floor(128 * (v + 1))));
  for (let f = 0; f < frames; f++) {
    const end = Math.round((f + 1) * hop) + 1024 - Math.round(hop);
    for (let i = 0; i < 1024; i++) {
      const s = end - 1024 + i;
      out[f * 3 * 1024 + i] = byte((left[s] + right[s]) * 0.5);
      out[(f * 3 + 1) * 1024 + i] = byte(left[s]);
      out[(f * 3 + 2) * 1024 + i] = byte(right[s]);
    }
  }
  return out;
}

// --- Butterchurn's presets: .milk to JSON, as the app converted them ----------

const CONVERTER = 'milkdrop-preset-converter@0.1.2-repaired-4';
const convertedCache = path.join(presetsRoot, '.converted', CONVERTER.replace(/[^a-z0-9.@-]/gi, '_'));

export const convert = (file: string) => convertText(fs.readFileSync(file, 'latin1'));

/** A preset's text into Butterchurn's JSON, cached by the text's hash beside the pack. */
export async function convertText(text: string): Promise<{ ok: true; json: string } | { ok: false; reason: string }> {
  const cached = path.join(convertedCache, `${createHash('sha256').update(text).digest('hex')}.json`);
  if (fs.existsSync(cached)) return { ok: true, json: fs.readFileSync(cached, 'utf8') };
  const worker = new Worker(new URL('./convertWorker.ts', import.meta.url));
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

// --- Butterchurn -------------------------------------------------------------

export async function launchBrowser(): Promise<Browser> {
  try {
    const browser = await chromium.launch({
      channel: 'chromium',
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
    });
    browsers.add(browser);
    browser.on('disconnected', () => browsers.delete(browser));
    return browser;
  } catch (error) {
    throw new Error(`Chromium did not start (run \`npx playwright install chromium\` in compare/): ${(error as Error).message.split('\n')[0]}`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/** A fresh Chromium in place of one a stuck page may have left busy; the old one is closed (killed if it won't close). */
export async function relaunch(browser: Browser): Promise<Browser> {
  await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
  return launchBrowser();
}

export interface Drawn {
  /** RGBA rows, top to bottom, by 1-based frame. */
  captures: Map<number, Uint8Array>;
  notes: string[];
}

/**
 * Butterchurn in its own fresh page, so its clock starts where ours does.
 * Throws `Timeout` when it takes longer than `settings.timeout`; the page is
 * closed then, and the caller should `relaunch` the browser in case it is stuck.
 */
export async function butterchurn(browser: Browser, json: string, settings: Settings, seed: bigint, audio: Buffer): Promise<Drawn> {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`timed out after ${settings.timeout} s`)), settings.timeout * 1000);
  });
  try {
    return await Promise.race([drawButterchurn(page, json, settings, seed, audio), expired]);
  } finally {
    clearTimeout(timer);
    await Promise.race([page.close().catch(() => {}), sleep(5000)]);
  }
}

async function drawButterchurn(page: Page, json: string, settings: Settings, seed: bigint, audio: Buffer): Promise<Drawn> {
  const { width, height } = settings;
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().split('\n')[0].slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.split('\n')[0].slice(0, 200)));
  {
    await page.setContent(`<canvas id="c" width="${width}" height="${height}"></canvas>`);
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
      { width, height, seed: String(seed), noiseSeed: String(NOISE_SEED) },
    );
    // Butterchurn's two built-in images (`clouds2`, which every unknown sampler
    // reads, and `empty`) decode asynchronously; the first frame must not come before them.
    await page.waitForFunction(
      () => {
        const samplers = (window as any).__bench.viz.renderer.image.samplers;
        return !!samplers.clouds2 && !!samplers.empty;
      },
      undefined,
      { timeout: 5000 },
    );
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
          notes.push(`butterchurn: ${broken.join(' and ')} shader would not link (BlackHole draws black); compared with MilkDrop's default`);
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
      { json, width, height, frames: settings.frames, dt: DT, captures: settings.captures, audio: audio.subarray(0, settings.frames * 3072).toString('base64'), seed: String(seed) },
    );
    const captures = new Map(Object.entries(result.captures).map(([frame, b64]) => [Number(frame), new Uint8Array(Buffer.from(b64, 'base64'))]));
    return { captures, notes: [...result.notes, ...[...new Set(consoleErrors)].slice(0, 3).map((e) => `butterchurn console: ${e}`)] };
  }
}

// --- ours --------------------------------------------------------------------

/** Build the engine's half (`cargo build --release -p visuals-compare`) and return its path. */
export function buildEngine(): string {
  const build = spawnSync('cargo', ['build', '--release', '-q', '-p', 'visuals-compare'], { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] });
  if (build.status !== 0) throw new Error('cargo build --release -p visuals-compare failed');
  const metadata = JSON.parse(spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 << 20 }).stdout);
  return path.join(metadata.target_directory, 'release', 'visuals-compare');
}

export interface OurRun {
  ok: boolean;
  fallbacks: string[];
  failure: string | null;
}

/**
 * Ours over a whole plan, in the background. Each capture lands at
 * `<prefix>-<frame>.rgba`. A preset that takes longer than `settings.timeout`
 * is reported as timed out: the bin is killed and started again on the presets
 * after it. Resolves when every preset has reported; rejects when the bin
 * fails as a whole.
 */
export function runEngine(bin: string, workDir: string, name: string, presets: { file: string; prefix: string }[], settings: Settings, seed: bigint, audioFile: string): Promise<OurRun[]> {
  const runs: (OurRun & { reported: boolean })[] = presets.map(() => ({ ok: false, fallbacks: [], failure: null, reported: false }));
  /** One bin over the presets not yet reported; resolves true when it was killed for taking too long. */
  const pass = (attempt: number) =>
    new Promise<boolean>((resolve, reject) => {
      const planFile = path.join(workDir, `${name}.plan${attempt ? `.${attempt}` : ''}.txt`);
      const plan = [
        `size\t${settings.width}\t${settings.height}`,
        `frames\t${settings.frames}`,
        `dt\t${DT}`,
        `refresh\t${settings.refresh}`,
        `seed\t${seed}`,
        `audio\t${audioFile}`,
        `captures\t${settings.captures.join('\t')}`,
        ...presets.flatMap((p, i) => (runs[i].reported ? [] : [`preset\t${i}\t${p.file}\t${p.prefix}`])),
      ];
      fs.writeFileSync(planFile, `${plan.join('\n')}\n`);
      // stdin stays open while this process lives: the bin ends when it closes.
      const child = spawn(bin, [planFile, '--parent-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let current: number | null = null;
      let stuck: number | null = null;
      let timer: NodeJS.Timeout | undefined;
      // The clock starts with the bin (its GPU setup counts towards the first preset) and again at each preset.
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          stuck = current ?? runs.findIndex((r) => !r.reported);
          child.kill('SIGKILL');
        }, settings.timeout * 1000);
      };
      arm();
      let buffered = '';
      child.stdout!.on('data', (chunk) => {
        buffered += chunk;
        const lines = buffered.split('\n');
        buffered = lines.pop()!;
        for (const line of lines) {
          const [kind, index, ...rest] = line.split('\t');
          const run = runs[Number(index)];
          if (!run) continue;
          if (kind === 'start') {
            current = Number(index);
            arm();
          } else if (kind === 'ok') {
            run.ok = true;
            run.reported = true;
          } else if (kind === 'fallback') run.fallbacks.push(`${rest[0]}: ${rest[1] ?? ''}`.trim());
          else if (kind === 'fail') {
            run.failure = rest.join(' ');
            run.reported = true;
          }
        }
      });
      let stderr = '';
      child.stderr!.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
      child.on('exit', (code) => {
        clearTimeout(timer);
        children.delete(child);
        if (stuck !== null && stuck >= 0) {
          runs[stuck].failure = `timed out after ${settings.timeout} s`;
          runs[stuck].reported = true;
          resolve(true);
        } else if (code === 0) resolve(false);
        else reject(new Error(`the engine exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
      });
    });
  const done = (async () => {
    for (let attempt = 0; runs.some((r) => !r.reported) && (await pass(attempt)); attempt++);
    return runs.map(({ ok, fallbacks, failure }) => ({ ok, fallbacks, failure }));
  })();
  // Keep a failure from surfacing as an unhandled rejection before it is awaited.
  done.catch(() => {});
  return done;
}

// --- pictures ----------------------------------------------------------------

export function png(rgba: Uint8Array, width: number, height: number): Buffer {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A grid of 0–1 values as RGBA, black through red and yellow to white. */
export function heat(values: number[], cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows * 4);
  values.forEach((v, i) => {
    const t = Math.max(0, Math.min(1, v));
    out[i * 4] = Math.round(255 * Math.min(1, 3 * t));
    out[i * 4 + 1] = Math.round(255 * Math.max(0, Math.min(1, 3 * t - 1)));
    out[i * 4 + 2] = Math.round(255 * Math.max(0, Math.min(1, 3 * t - 2)));
    out[i * 4 + 3] = 255;
  });
  return out;
}

export interface Panel {
  label: string;
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Draw cells as blocks: a section grid, upscaled nearest-neighbour. */
  blocky?: boolean;
}

/** A page that lays panels out in a labelled grid; one per run. */
export async function composer(browser: Browser): Promise<(panels: Panel[], columns: number, panelWidth: number, title: string) => Promise<Buffer>> {
  const page: Page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  return async (panels, columns, panelWidth, title) => {
    const first = panels.find((p) => !p.blocky) ?? panels[0];
    const panelHeight = Math.round((first.height * panelWidth) / first.width);
    const data = panels.map((p) => ({ label: p.label, blocky: !!p.blocky, src: `data:image/png;base64,${png(p.rgba, p.width, p.height).toString('base64')}` }));
    const url = await page.evaluate(
      async ({ data, columns, panelWidth, panelHeight, title }) => {
        const strip = 18, head = 20, gap = 4;
        const rows = Math.ceil(data.length / columns);
        const canvas = document.getElementById('c') as HTMLCanvasElement;
        canvas.width = columns * panelWidth + (columns - 1) * gap;
        canvas.height = head + rows * (strip + panelHeight) + (rows - 1) * gap;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '12px -apple-system, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#eee';
        ctx.fillText(title, 4, head / 2, canvas.width - 8);
        for (const [i, p] of data.entries()) {
          const x = (i % columns) * (panelWidth + gap), y = head + Math.floor(i / columns) * (strip + panelHeight + gap);
          const img = new Image();
          img.src = p.src;
          await img.decode();
          ctx.fillStyle = '#bbb';
          ctx.fillText(p.label, x + 3, y + strip / 2, panelWidth - 6);
          ctx.imageSmoothingEnabled = !p.blocky;
          ctx.drawImage(img, x, y + strip, panelWidth, panelHeight);
        }
        return canvas.toDataURL('image/png');
      },
      { data, columns, panelWidth, panelHeight, title },
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };
}
