import * as api from './api.ts';
import type { Converted } from './convert.worker.ts';

/**
 * The converter's identity, as `server/presets.ts` and `harness/compare.ts` name
 * it: their cache and this one are the same files, so a preset converted by
 * either is not converted again here.
 */
export const CONVERTER = 'milkdrop-preset-converter@0.1.2-repaired-4';
const CACHE_DIR = CONVERTER.replace(/[^a-z0-9.@-]/gi, '_');
/** A preset the converter has not finished with by now will not be drawn. */
const TIMEOUT_MS = 10_000;

/** The file as Node's `readFileSync(file, 'latin1')` reads it: one char per byte. */
export function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

/** `createHash('sha256').update(text)`: of the string's UTF-8, as Node hashes a string. */
export async function cacheKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

function run(text: string): Promise<Converted> {
  worker ??= new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise<Converted>((resolve) => {
    const timer = window.setTimeout(() => {
      // Spinning: the only way to stop it is to throw the worker away.
      w.terminate();
      if (worker === w) worker = null;
      resolve({ ok: false, reason: `the converter took longer than ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<Converted>) => {
      window.clearTimeout(timer);
      resolve(e.data);
    };
    w.onerror = (e) => {
      window.clearTimeout(timer);
      w.terminate();
      if (worker === w) worker = null;
      resolve({ ok: false, reason: e.message || 'the converter worker failed' });
    };
    w.postMessage({ text });
  });
}

/** `path` as Butterchurn's JSON: from the shared cache, or converted (one at a time) and cached. */
export async function convert(path: string): Promise<Converted> {
  const text = latin1(new Uint8Array(await api.source(path)));
  const hash = await cacheKey(text);
  const hit = await api.cached(CACHE_DIR, hash).catch(() => null);
  if (hit) return { ok: true, json: hit };
  const result = (queue = queue.then(() => run(text), () => run(text))) as Promise<Converted>;
  const done = await result;
  if (done.ok) await api.cache(CACHE_DIR, hash, done.json).catch(() => {});
  return done;
}

export function stopConverting() {
  worker?.terminate();
  worker = null;
}
