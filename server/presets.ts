import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
// A static import, so the app's server bundle carries them — see `tools/electron.ts`.
import butterchurnPresets from 'butterchurn-presets';
import type { PresetEntry, PresetShelf } from '../protocol.ts';
import { BUNDLED } from '../milk.ts';
import { openflowHome } from './home.ts';

/**
 * The MilkDrop library: `.milk` files on disk, and the favourites that ship.
 *
 * **The `.milk` file is the source of truth.** It is what other players read,
 * what preset authors wrote, and what an editor will one day save — so it is
 * what the library keeps. Butterchurn draws JSON, so a preset is converted the
 * first time it is asked for and the JSON is cached beside the files, keyed by
 * the file's content and the converter's version. Nothing converts at startup,
 * so a library of ten thousand presets costs a directory walk.
 *
 * The bundled favourites are the exception: `butterchurn-presets` ships them
 * already converted and without their sources. They are drawable and not
 * editable, and say so by their `@butterchurn/` prefix.
 *
 * See `docs/milkdrop.md`.
 */

export function presetsRoot(): string {
  return process.env.OPENFLOW_VISUALS_PRESETS ?? path.join(openflowHome(), 'visuals', 'presets');
}

/** Bump with the converter, or when what is cached changes shape. */
const CONVERTER = 'milkdrop-preset-converter@0.1.2-repaired-4';
/** A preset the converter has not finished with by now is not going to be drawn tonight. */
const CONVERT_MS = 10_000;
const RESCAN_MS = 10_000;

export interface PresetLibrary {
  shelf(): PresetShelf;
  /** Every id, stable in identity until the library changes — `resolve.ts` memoises on it. */
  ids(): readonly string[];
  known(): ReadonlySet<string>;
  /** Whether the last scan moved anything, so the server knows to re-send the shelf. */
  revision(): number;
  serve(res: http.ServerResponse, encodedId: string): void;
  close(): void;
}

interface Bundled {
  getPresets(): Record<string, unknown>;
}

export function openPresets(root = presetsRoot(), options: { bundled?: boolean } = {}): PresetLibrary {
  const cache = path.join(root, '.converted', CONVERTER.replace(/[^a-z0-9.@-]/gi, '_'));
  const bundled = new Map<string, string>();
  if (options.bundled !== false) {
    try {
      const presets = (butterchurnPresets as Bundled).getPresets();
      for (const [name, preset] of Object.entries(presets)) {
        bundled.set(`${BUNDLED}${name}`, JSON.stringify(preset));
      }
    } catch (error) {
      console.warn(`visuals: bundled presets unavailable — ${(error as Error).message}`);
    }
  }

  let entries: PresetEntry[] = [];
  let ids: readonly string[] = [];
  let known: ReadonlySet<string> = new Set();
  let notice: string | null = null;
  let revision = 0;
  let signature = '';
  /** Conversions that failed, by id and content, so a broken file is not retried every turn. */
  const failed = new Map<string, string>();

  const publish = (files: PresetEntry[]) => {
    const all = [
      ...[...bundled.keys()].map((id) => ({
        id,
        name: id.slice(BUNDLED.length),
        group: 'butterchurn',
      })),
      ...files,
    ];
    all.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    const next = all.map((entry) => entry.id).join('\n');
    if (next === signature) return;
    signature = next;
    entries = all;
    ids = all.map((entry) => entry.id);
    known = new Set(ids);
    revision++;
  };

  /**
   * Asynchronous on purpose. A synchronous walk of ten thousand files is tens
   * of milliseconds of a thread that also sends the wall its clock.
   */
  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await fs.promises.mkdir(root, { recursive: true });
      const found: PresetEntry[] = [];
      const walk = async (dir: string, prefix: string) => {
        let dirents: fs.Dirent[];
        try {
          dirents = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of dirents) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
          const id = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), id);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith('.milk')) {
            found.push({ id, name: entry.name.slice(0, -'.milk'.length), group: prefix || '—' });
          }
        }
      };
      await walk(root, '');
      notice = null;
      publish(found);
    } catch (error) {
      notice = `presets: could not read ${root} — ${(error as Error).message}`;
    } finally {
      scanning = false;
    }
  };
  publish([]);
  void scan();
  const timer = setInterval(() => void scan(), RESCAN_MS);
  timer.unref();

  // --- conversion -------------------------------------------------------

  let worker: Worker | null = null;
  const queue: Array<() => void> = [];
  let busy = false;
  const workerUrl = () => {
    // Bundled beside `server.mjs` in the app, from source beside this file.
    const built = new URL('./presetWorker.mjs', import.meta.url);
    return fs.existsSync(built) ? built : new URL('./presetWorker.ts', import.meta.url);
  };
  const convert = (text: string) =>
    new Promise<{ ok: true; json: string } | { ok: false; reason: string }>((resolve) => {
      const run = () => {
        busy = true;
        const active = (worker ??= new Worker(workerUrl()));
        const finish = (result: { ok: true; json: string } | { ok: false; reason: string }) => {
          clearTimeout(timer);
          active.removeAllListeners('message');
          active.removeAllListeners('error');
          active.removeAllListeners('exit');
          busy = false;
          resolve(result);
          queue.shift()?.();
        };
        const timer = setTimeout(() => {
          worker = null;
          void active.terminate();
          finish({ ok: false, reason: `conversion took longer than ${CONVERT_MS / 1000}s` });
        }, CONVERT_MS);
        active.once('message', finish);
        active.once('error', (error: Error) => {
          worker = null;
          finish({ ok: false, reason: error.message });
        });
        active.once('exit', (code) => {
          worker = null;
          finish({ ok: false, reason: `the converter exited (${code})` });
        });
        active.postMessage({ text });
      };
      if (busy) queue.push(run);
      else run();
    });

  const answer = (res: http.ServerResponse, status: number, body: string, json = false) => {
    res.writeHead(status, {
      'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  };

  /** A file id, refused unless the last scan found it — which rules out traversal by construction. */
  const fileOf = (id: string): string | null => {
    if (!known.has(id) || id.startsWith(BUNDLED)) return null;
    const parts = id.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return null;
    return path.join(root, ...parts);
  };

  return {
    shelf: () => ({ entries, root, notice }),
    ids: () => ids,
    known: () => known,
    revision: () => revision,
    serve(res, encodedId) {
      let id: string;
      try {
        id = encodedId.split('/').map(decodeURIComponent).join('/');
      } catch {
        answer(res, 400, 'bad preset id');
        return;
      }
      const shipped = bundled.get(id);
      if (shipped) {
        answer(res, 200, shipped, true);
        return;
      }
      const file = fileOf(id);
      if (!file) {
        answer(res, 404, 'preset not found');
        return;
      }
      void (async () => {
        let text: string;
        try {
          text = await fs.promises.readFile(file, 'latin1');
        } catch (error) {
          answer(res, 404, `preset unreadable — ${(error as Error).message}`);
          return;
        }
        const hash = createHash('sha256').update(text).digest('hex');
        const cached = path.join(cache, `${hash}.json`);
        try {
          answer(res, 200, await fs.promises.readFile(cached, 'utf8'), true);
          return;
        } catch {
          // Not converted yet.
        }
        const was = failed.get(`${id}#${hash}`);
        if (was) {
          answer(res, 422, was);
          return;
        }
        const result = await convert(text);
        if (!result.ok) {
          failed.set(`${id}#${hash}`, result.reason);
          answer(res, 422, result.reason);
          return;
        }
        try {
          await fs.promises.mkdir(cache, { recursive: true });
          await fs.promises.writeFile(`${cached}.tmp`, result.json);
          await fs.promises.rename(`${cached}.tmp`, cached);
        } catch (error) {
          console.warn(`visuals: preset cache not written — ${(error as Error).message}`);
        }
        answer(res, 200, result.json, true);
      })().catch((error) => {
        if (!res.headersSent) answer(res, 500, (error as Error).message);
      });
    },
    close() {
      clearInterval(timer);
      void worker?.terminate();
      worker = null;
    },
  };
}
