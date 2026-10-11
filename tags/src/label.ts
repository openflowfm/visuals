// `npm run label -- <features DIR> [--labels FILE] [--port N] [--size 48]`
//
// The labelling page: one tag at a time, a grid of animated clips, click the
// ones that have it. Served on 127.0.0.1 only (a free port unless --port);
// prints its URL and never opens a browser. Every answer is appended to the
// labels file (tags/labels.json by default) as it's given; the latest answer
// for a preset and tag wins, so un-marking saves a `no`.
//
// Routes: GET / (the page), GET /api/state (the vocabulary, clip info and each
// tag's counts), GET /api/grid?tag=… (the next grid), POST /api/labels
// ({tag, answers: [{hash, answer}]}), GET /clips/<name> (a row's clip only).
// Any request whose Host isn't 127.0.0.1:<port> or localhost:<port> gets a
// 403, and a POST that isn't `Content-Type: application/json` a 415.

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { clipFile, loadFeatures, type FeatureRow, type Features } from './features.ts';
import { proxyFor, proxyProblem, pickGrid, type Proxy } from './grid.ts';
import { answersFor, appendLabels, countsFor, LABELS_FILE, readLabels, type Answer, type Label } from './labels.ts';
import { loadVocabulary, tagById, type Tag, type Vocabulary } from './vocabulary.ts';

export interface ServerOptions {
  /** The features DIR (`features.json` and `clips/`). */
  dir: string;
  labels?: string;
  /** 0 (the default) for a free port. */
  port?: number;
  /** Clips per grid. */
  size?: number;
  vocabulary?: Vocabulary;
  /** Where warnings go (one per tag whose grids are all random). */
  warn?: (line: string) => void;
}

export interface Running {
  url: string;
  server: Server;
  close: () => Promise<void>;
}

const PAGE = new URL('./label.html', import.meta.url);
const ANSWERS: readonly Answer[] = ['yes', 'no', 'unsure'];
const MAX_BODY = 1 << 20;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startServer(opts: ServerOptions): Promise<Running> {
  const features: Features = loadFeatures(opts.dir);
  const vocab = opts.vocabulary ?? loadVocabulary();
  const labelsFile = opts.labels ?? LABELS_FILE;
  const size = opts.size ?? 48;
  const warn = opts.warn ?? ((l: string) => console.warn(l));
  readLabels(labelsFile); // fails now rather than on the first answer when it's malformed
  const page = readFileSync(PAGE);
  const byHash = new Map<string, FeatureRow>(features.rows.map((r) => [r.hash, r]));
  const clips = new Map<string, FeatureRow>(features.rows.map((r) => [r.clip, r]));
  for (const t of vocab.tags) {
    const why = proxyProblem(features, t);
    if (why) warn(`label: ${t.name}'s grids are all random: ${why}`);
  }
  // Proxies by tag, worked out on first use (Unique's is O(n²)).
  const proxies = new Map<string, Proxy | null>();
  const proxy = (t: Tag): Proxy | null => {
    if (!proxies.has(t.id)) proxies.set(t.id, proxyFor(features, t));
    return proxies.get(t.id)!;
  };
  let grids = 0;

  const state = () => {
    const labels = readLabels(labelsFile).labels;
    return {
      groups: vocab.groups,
      tags: vocab.tags.map((t) => {
        const counts = countsFor(labels, t.id);
        const answered = answersFor(labels, t.id);
        let remaining = 0;
        for (const r of features.rows) if (!answered.has(r.hash)) remaining++;
        return { id: t.id, name: t.name, group: t.group, question: t.question, counts, remaining };
      }),
      clip: features.clip,
      presets: features.rows.length,
      size,
    };
  };

  const tagParam = (id: unknown): Tag => {
    const t = typeof id === 'string' ? tagById(vocab, id) : undefined;
    if (!t) throw new HttpError(400, `unknown tag ${JSON.stringify(id)}`);
    return t;
  };

  // Set once listening. A page on another site can make the browser send
  // requests here (DNS rebinding, or a form posted cross-origin), so only a
  // Host naming this server is answered, and a POST must be JSON, which a
  // cross-origin form can't send without a preflight.
  let port = 0;
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, `wrong host ${JSON.stringify(host)}`);
    if (req.method === 'POST' && (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'a POST must be application/json');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return send(res, 200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, state());
    if (req.method === 'GET' && path === '/api/grid') {
      const tag = tagParam(url.searchParams.get('tag'));
      const labels = readLabels(labelsFile).labels;
      const seedParam = url.searchParams.get('seed');
      const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : (Date.now() ^ (++grids * 0x9e3779b1)) >>> 0;
      const g = pickGrid(features, tag, answersFor(labels, tag.id), { size, seed, proxy: proxy(tag) });
      return json(res, 200, {
        tag: tag.id,
        remaining: g.remaining,
        counts: countsFor(labels, tag.id),
        items: g.picked.map(({ row }) => ({ hash: row.hash, path: row.path, clip: row.clip })),
      });
    }
    if (req.method === 'POST' && path === '/api/labels') {
      let body: { tag?: unknown; answers?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'body is not JSON');
      }
      const tag = tagParam(body?.tag);
      if (!Array.isArray(body.answers)) throw new HttpError(400, 'answers must be a list');
      const at = new Date().toISOString();
      const labels: Label[] = body.answers.map((a: { hash?: unknown; answer?: unknown }, i: number) => {
        const row = typeof a?.hash === 'string' ? byHash.get(a.hash) : undefined;
        if (!row) throw new HttpError(400, `answer ${i}: unknown preset ${JSON.stringify(a?.hash)}`);
        if (!ANSWERS.includes(a.answer as Answer)) throw new HttpError(400, `answer ${i}: ${JSON.stringify(a.answer)} isn't yes, no or unsure`);
        return { hash: row.hash, tag: tag.id, answer: a.answer as Answer, at, path: row.path };
      });
      const file = labels.length ? appendLabels(labels, labelsFile) : readLabels(labelsFile);
      return json(res, 200, { saved: labels.length, counts: countsFor(file.labels, tag.id) });
    }
    if (req.method === 'GET' && path.startsWith('/clips/')) {
      let name: string;
      try {
        name = decodeURIComponent(path.slice('/clips/'.length));
      } catch {
        throw new HttpError(404, 'no such clip');
      }
      const row = clips.get(name);
      if (!row || name.includes('/') || name.includes('\\') || name.includes('..')) throw new HttpError(404, 'no such clip');
      let data: Buffer;
      try {
        data = readFileSync(clipFile(opts.dir, row));
      } catch {
        throw new HttpError(404, 'clip missing on disk');
      }
      res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff' });
      res.end(data);
      return;
    }
    throw new HttpError(404, 'not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const USAGE = 'usage: npm run label -- <features DIR> [--labels FILE] [--port N] [--size 48]';

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opts: Partial<ServerOptions> = {};
  const usage = (why: string): never => {
    console.error(`label: ${why}\n${USAGE}`);
    process.exit(2);
  };
  const int = (a: string, s: string | undefined, min: number): number => {
    const n = Number(s);
    if (s === undefined || !Number.isInteger(n) || n < min || n > 65535) usage(`${a} needs a whole number`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--labels') opts.labels = args[++i] ?? usage('--labels needs a file');
    else if (a === '--port') opts.port = int(a, args[++i], 0);
    else if (a === '--size') opts.size = int(a, args[++i], 1);
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (opts.dir) usage(`one features DIR only (got ${opts.dir} and ${a})`);
    else opts.dir = a;
  }
  if (!opts.dir) usage('no features DIR');
  let running: Running;
  try {
    running = await startServer(opts as ServerOptions);
  } catch (e) {
    // A features DIR or labels file that isn't one is a usage error; a system error (port taken…) isn't.
    console.error(`label: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(e && typeof e === 'object' && 'code' in e ? 1 : 2);
  }
  console.log(`label: ${running.url}  (answers go to ${opts.labels ?? LABELS_FILE}; ctrl-c stops)`);
  const stop = () => {
    running.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
