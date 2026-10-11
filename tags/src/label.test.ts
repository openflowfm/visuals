import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture, type Fixture } from './fixture.ts';
import { startServer, type Running } from './label.ts';
import { readLabels } from './labels.ts';

let fx: Fixture;
let srv: Running;
let labelsFile: string;
const warnings: string[] = [];

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'tags-label-'));
  const dir = join(root, 'fx');
  fx = await makeFixture(dir, { n: 40 });
  labelsFile = join(root, 'labels.json');
  srv = await startServer({ dir, labels: labelsFile, port: 0, size: 12, warn: (l) => warnings.push(l) });
}, 60_000);

afterAll(async () => {
  await srv?.close();
});

const get = (path: string) => fetch(new URL(path, srv.url));
const post = (body: unknown) => fetch(new URL('/api/labels', srv.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A request with the path sent exactly as written (fetch would resolve `..`), and the headers given. */
function raw(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<number> {
  const u = new URL(srv.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('the labelling server', () => {
  it('binds 127.0.0.1 and serves the page', async () => {
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<main id="grid"');
  });

  it('warns once per tag whose grids are all random', () => {
    // The fixture has no hue_orange, and WTF has no proxy; red's hue_red is there.
    expect(warnings.filter((w) => w.includes('Orange'))).toHaveLength(1);
    expect(warnings.some((w) => w.includes('WTF'))).toBe(true);
    expect(warnings.some((w) => w.startsWith("label: Red's"))).toBe(false);
    expect(warnings.some((w) => w.includes('Unique'))).toBe(false);
  });

  it('gives the state: vocabulary, clip info and counts', async () => {
    const s = await (await get('/api/state')).json();
    expect(s.clip).toEqual({ frames: 24, fps: 12, size: [192, 144] });
    expect(s.presets).toBe(40);
    const red = s.tags.find((t: { id: string }) => t.id === 'red');
    expect(red.counts).toEqual({ yes: 0, no: 0, unsure: 0 });
    expect(red.remaining).toBe(40);
    expect(red.question).toMatch(/Red/);
    expect(s.groups).toContain('colour');
  });

  it('gives a grid, saves answers and leaves answered presets out of the next grid', async () => {
    const g = await (await get('/api/grid?tag=red&seed=1')).json();
    expect(g.items).toHaveLength(12);
    expect(g.remaining).toBe(40);
    const [a, b, c] = g.items;
    const res = await post({
      tag: 'red',
      answers: [
        { hash: a.hash, answer: 'yes' },
        { hash: b.hash, answer: 'unsure' },
        { hash: c.hash, answer: 'no' },
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).counts).toEqual({ yes: 1, no: 1, unsure: 1 });
    // Un-marking is another label: the latest answer wins.
    await post({ tag: 'red', answers: [{ hash: a.hash, answer: 'no' }] });
    const file = readLabels(labelsFile);
    expect(file.labels).toHaveLength(4);
    expect(file.labels[0]).toMatchObject({ hash: a.hash, tag: 'red', answer: 'yes', path: a.path });
    expect(file.labels[3]).toMatchObject({ hash: a.hash, answer: 'no' });
    const next = await (await get('/api/grid?tag=red&seed=2')).json();
    expect(next.remaining).toBe(37);
    expect(next.counts).toEqual({ yes: 0, no: 2, unsure: 1 });
    for (const it of next.items) expect([a.hash, b.hash, c.hash]).not.toContain(it.hash);
  });

  it('returns fewer when fewer remain', async () => {
    const answers = fx.features.rows.slice(0, 35).map((r) => ({ hash: r.hash, answer: 'no' }));
    expect((await post({ tag: 'blue', answers })).status).toBe(200);
    const g = await (await get('/api/grid?tag=blue')).json();
    expect(g.items).toHaveLength(5);
  });

  it('refuses a bad tag, hash or answer with a 400', async () => {
    const hash = fx.features.rows[0].hash;
    expect((await post({ tag: 'nope', answers: [{ hash, answer: 'yes' }] })).status).toBe(400);
    expect((await post({ tag: 'red', answers: [{ hash: 'not-a-preset', answer: 'yes' }] })).status).toBe(400);
    expect((await post({ tag: 'red', answers: [{ hash, answer: 'maybe' }] })).status).toBe(400);
    expect((await post({ tag: 'red' })).status).toBe(400);
    expect((await fetch(new URL('/api/labels', srv.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await get('/api/grid?tag=nope')).status).toBe(400);
    expect(readLabels(labelsFile).labels.some((l) => l.hash === 'not-a-preset' || l.tag === 'nope')).toBe(false);
  });

  it('answers only requests addressed to itself', async () => {
    const port = new URL(srv.url).port;
    expect(await raw('/api/state', { headers: { host: `localhost:${port}` } })).toBe(200);
    expect(await raw('/api/state', { headers: { host: `127.0.0.1:${port}` } })).toBe(200);
    expect(await raw('/api/state', { headers: { host: 'evil.example' } })).toBe(403);
    expect(await raw('/api/state', { headers: { host: `evil.example:${port}` } })).toBe(403);
    expect(await raw('/', { headers: { host: '127.0.0.1:1' } })).toBe(403);
    const hash = fx.features.rows[1].hash;
    const body = JSON.stringify({ tag: 'warm', answers: [{ hash, answer: 'yes' }] });
    expect(await raw('/api/labels', { method: 'POST', headers: { host: `rebound.example:${port}`, 'content-type': 'application/json' }, body })).toBe(403);
    expect(readLabels(labelsFile).labels.some((l) => l.tag === 'warm')).toBe(false);
  });

  it('takes only JSON posts', async () => {
    const hash = fx.features.rows[2].hash;
    const body = JSON.stringify({ tag: 'cold', answers: [{ hash, answer: 'yes' }] });
    expect(await raw('/api/labels', { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).toBe(415);
    expect(await raw('/api/labels', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })).toBe(415);
    expect(await raw('/api/labels', { method: 'POST', body })).toBe(415);
    expect(readLabels(labelsFile).labels.some((l) => l.tag === 'cold')).toBe(false);
    expect(await raw('/api/labels', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body })).toBe(200);
  });

  it("serves a row's clip as webp, and nothing else", async () => {
    const row = fx.features.rows[0];
    const res = await get(`/clips/${row.clip}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(await raw('/clips/../features.json')).toBe(404);
    expect(await raw('/clips/..%2Ffeatures.json')).toBe(404);
    expect(await raw('/clips/%2e%2e%2ftruth.json')).toBe(404);
    expect(await raw('/clips/nope.webp')).toBe(404);
  });
});
