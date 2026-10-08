#!/usr/bin/env node
// Where Butterchurn's frame goes at 4K, preset by preset. Phase 0 of
// docs/milkdrop-engine.md: the baseline the native engine is measured against.
//
//   npm run harness:profile                     # 60 presets, 3840×2160
//   npm run harness:profile -- --presets 20 --size 1920x1080
//
// Butterchurn runs in Playwright's Chromium on the GPU (ANGLE on Metal), drawing
// to an offscreen canvas, so this measures the engine and not a compositor or a
// display. Two numbers per preset:
//
// - **Throughput.** Frames rendered back to back with one sync at the end: the
//   frame rate the engine sustains when nothing else is in the way.
// - **Stages.** The same frames with the GPU drained around every stage, so each
//   stage's time is its own CPU and GPU work. Draining serialises the pipeline,
//   so the stages sum to more than a throughput frame; they say where the time
//   goes, not how fast a frame is. A sync is a one-pixel read-back, which costs
//   a round trip to Chromium's GPU process, so tiny stages read high.
//
// The audio is synthetic — a kick on the beat under a chord and noise — so
// presets move as they would to music. Converted presets come from the library's
// conversion cache (`<pack>/.converted/`, filled by the old app's server); the
// bundled favourites ship with butterchurn-presets.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const COUNT = Number(arg('presets', '60'));
const [WIDTH, HEIGHT] = arg('size', '3840x2160').split('x').map(Number);
const WARMUP = 30;
const FRAMES = 90;

const cacheRoot = path.join(
  process.env.OPENFLOW_VISUALS_PRESETS ?? path.join(os.homedir(), '.openflow', 'visuals', 'presets'),
  '.converted',
);

/** A deterministic spread: some favourites, the rest from the converted pack. */
function choosePresets(): Array<{ name: string; json: string }> {
  const bundled = (require('butterchurn-presets') as { getPresets(): Record<string, unknown> }).getPresets();
  const favourites = Object.entries(bundled).map(([name, preset]) => ({ name: `@butterchurn/${name}`, json: JSON.stringify(preset) }));
  const converted: Array<{ name: string; json: string }> = [];
  if (fs.existsSync(cacheRoot)) {
    for (const version of fs.readdirSync(cacheRoot).sort().slice(-1)) {
      for (const file of fs.readdirSync(path.join(cacheRoot, version)).sort()) {
        if (file.endsWith('.json')) converted.push({ name: `cache/${file.slice(0, 12)}`, json: fs.readFileSync(path.join(cacheRoot, version, file), 'utf8') });
      }
    }
  }
  const spread = <T>(items: T[], n: number) =>
    Array.from({ length: Math.min(n, items.length) }, (_, i) => items[Math.floor((i + 0.5) * items.length / Math.min(n, items.length))]);
  const fromPack = Math.min(converted.length, Math.round(COUNT * 0.75));
  return [...spread(favourites, COUNT - fromPack), ...spread(converted, fromPack)];
}

interface Result {
  name: string;
  throughputMs: number;
  stages: Record<string, number>;
  stagedMs: number;
}

const presets = choosePresets();
console.log(`harness: profiling ${presets.length} presets at ${WIDTH}×${HEIGHT}, ${FRAMES} frames each`);

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const results: Result[] = [];
let renderer = '';
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<canvas id="c" width="${WIDTH}" height="${HEIGHT}" style="width:400px;height:225px"></canvas>`);
  await page.addScriptTag({ path: path.join(root, 'node_modules/butterchurn/lib/butterchurn.min.js') });
  renderer = await page.evaluate(({ width, height }) => {
    const B = (window as any).butterchurn.default ?? (window as any).butterchurn;
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const viz = B.createVisualizer(null, canvas, { width, height, pixelRatio: 1, textureRatio: 1 });
    const gl = canvas.getContext('webgl2')!;
    const r = viz.renderer;
    const levels = { timeByteArray: new Uint8Array(1024), timeByteArrayL: new Uint8Array(1024), timeByteArrayR: new Uint8Array(1024) };
    let frame = 0;
    const music = () => {
      // 120 bpm at 60 fps: a beat every 30 frames.
      const since = (frame % 30) / 30;
      for (let i = 0; i < 1024; i++) {
        const t = (frame * 735 + i) / 44100;
        const kick = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-since * 6);
        const chord = 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
        const noise = (Math.random() * 2 - 1) * 0.15;
        const v = Math.max(-1, Math.min(1, 0.6 * kick + 0.3 * chord + noise));
        const b = Math.round(128 + v * 120);
        levels.timeByteArray[i] = levels.timeByteArrayL[i] = levels.timeByteArrayR[i] = b;
      }
      frame++;
    };

    // Stage timing: wrap each stage so the GPU is drained before and after it.
    const times: Record<string, number> = {};
    let timing = false;
    // `gl.finish()` returns without waiting in Chromium — it measured a 4K pass at
    // faster than the GPU's memory bandwidth allows. Reading a pixel back cannot
    // return until every command before it has run.
    const pixel = new Uint8Array(4);
    const sync = () => {
      const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
    };
    const wrap = (owner: any, key: string, stage: string) => {
      const proto = Object.getPrototypeOf(owner);
      const original = proto[key];
      if (!original || original.__wrapped) return;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        if (!timing) return original.apply(this, args);
        sync();
        const t0 = performance.now();
        const out = original.apply(this, args);
        sync();
        times[stage] = (times[stage] ?? 0) + performance.now() - t0;
        return out;
      };
      (wrapped as any).__wrapped = true;
      proto[key] = wrapped;
    };
    const glMipmap = gl.generateMipmap.bind(gl);
    gl.generateMipmap = (target: number) => {
      if (!timing) return glMipmap(target);
      sync();
      const t0 = performance.now();
      glMipmap(target);
      sync();
      times.mipmaps = (times.mipmaps ?? 0) + performance.now() - t0;
    };
    const instrument = () => {
      wrap(r.presetEquationRunner, 'runFrameEquations', 'frame equations');
      wrap(r, 'runPixelEquations', 'vertex equations');
      wrap(r.warpShader, 'renderQuadTexture', 'warp');
      wrap(r.blurShader1, 'renderBlurTexture', 'blur');
      wrap(r.motionVectors, 'drawMotionVectors', 'motion vectors');
      if (r.customShapes[0]) wrap(r.customShapes[0], 'drawCustomShape', 'shapes');
      if (r.customWaveforms[0]) wrap(r.customWaveforms[0], 'drawCustomWaveform', 'waves');
      wrap(r.basicWaveform, 'drawBasicWaveform', 'basic wave');
      wrap(r.darkenCenter, 'drawDarkenCenter', 'darken centre');
      wrap(r.outerBorder, 'drawBorder', 'borders');
      wrap(r, 'renderToScreen', 'comp');
    };

    (window as any).__profile = (json: string, frames: number, warmup: number) => {
      viz.loadPreset(JSON.parse(json), 0);
      instrument();
      for (let i = 0; i < warmup; i++) { music(); viz.render({ audioLevels: levels, elapsedTime: 1 / 60 }); }
      sync();
      // Throughput: back to back, one sync at the end.
      let t0 = performance.now();
      for (let i = 0; i < frames; i++) { music(); viz.render({ audioLevels: levels, elapsedTime: 1 / 60 }); }
      sync();
      const throughputMs = (performance.now() - t0) / frames;
      // Stages: drained around each one.
      for (const key of Object.keys(times)) delete times[key];
      timing = true;
      t0 = performance.now();
      for (let i = 0; i < frames; i++) { music(); viz.render({ audioLevels: levels, elapsedTime: 1 / 60 }); }
      sync();
      const stagedMs = (performance.now() - t0) / frames;
      timing = false;
      const stages: Record<string, number> = {};
      for (const [k, v] of Object.entries(times)) stages[k] = v / frames;
      return { throughputMs, stagedMs, stages };
    };
    return String(gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  }, { width: WIDTH, height: HEIGHT });

  for (const [i, preset] of presets.entries()) {
    try {
      const out = await page.evaluate(([json, frames, warmup]) => (window as any).__profile(json, frames, warmup), [preset.json, FRAMES, WARMUP] as const);
      results.push({ name: preset.name, ...out });
      process.stdout.write(`\r${i + 1}/${presets.length}`);
    } catch (error) {
      console.log(`\n${preset.name}: ${(error as Error).message.slice(0, 120)}`);
    }
  }
} finally {
  await browser.close();
}

// --- report ----------------------------------------------------------------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const p90 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : 0;
};
const fps = (ms: number) => (1000 / ms).toFixed(0);
const throughput = results.map((r) => r.throughputMs);
const stageNames = [...new Set(results.flatMap((r) => Object.keys(r.stages)))];

console.log(`\n\nrenderer: ${renderer}`);
console.log(`throughput  median ${median(throughput).toFixed(1)} ms (${fps(median(throughput))} fps)  p90 ${p90(throughput).toFixed(1)} ms (${fps(p90(throughput))} fps)`);
console.log(`at 60 fps   ${results.filter((r) => r.throughputMs <= 1000 / 60).length}/${results.length} presets`);
console.log('\nstage (drained)        median ms   p90 ms   share of staged frame');
const stagedMedian = median(results.map((r) => r.stagedMs));
for (const stage of stageNames.sort((a, b) => median(results.map((r) => r.stages[b] ?? 0)) - median(results.map((r) => r.stages[a] ?? 0)))) {
  const xs = results.map((r) => r.stages[stage] ?? 0);
  console.log(`${stage.padEnd(22)} ${median(xs).toFixed(2).padStart(9)} ${p90(xs).toFixed(2).padStart(8)}   ${((median(xs) / stagedMedian) * 100).toFixed(0).padStart(3)}%`);
}
console.log('\nslowest');
for (const r of [...results].sort((a, b) => b.throughputMs - a.throughputMs).slice(0, 8)) {
  const top = Object.entries(r.stages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
  console.log(`${r.throughputMs.toFixed(1).padStart(6)} ms  ${r.name.slice(0, 50).padEnd(50)}  ${top}`);
}

const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `profile-${WIDTH}x${HEIGHT}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`);
fs.writeFileSync(file, JSON.stringify({ renderer, width: WIDTH, height: HEIGHT, frames: FRAMES, results }, null, 1));
console.log(`\nwrote ${path.relative(root, file)}`);
