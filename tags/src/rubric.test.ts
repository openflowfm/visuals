import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { clipFile } from './features.ts';
import { makeFixture, type Fixture } from './fixture.ts';
import { frameSheet, sheetSize } from './frames.ts';
import {
  OUTPUT_BASE,
  OUTPUT_PER_TAG,
  RUBRIC_MODEL,
  UsageError,
  buildRequest,
  costItem,
  emptyCache,
  estimateCost,
  makePrompt,
  mergeScores,
  missingPairs,
  parseResults,
  parseRubricArgs,
  readCache,
  readRubricScores,
  rubricHash,
  rubricTags,
  splitBatches,
  writeCache,
  type PendingBatch,
  type RubricCache,
} from './rubric-core.ts';
import { loadVocabulary, type Vocabulary } from './vocabulary.ts';

const TAGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = '2026-10-10T12:00:00.000Z';
const vocabulary = loadVocabulary();
const all = rubricTags(vocabulary);

let dir: string;
let fixture: Fixture;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tags-rubric-'));
  fixture = await makeFixture(dir, { n: 12 });
});

describe('which tags and pairs to ask', () => {
  it('takes the tags with a rubric, or the ones named', () => {
    expect(all.length).toBeGreaterThan(5);
    expect(all.every((t) => t.rubric)).toBe(true);
    expect(rubricTags(vocabulary, ['liquid', 'fractal']).map((t) => t.id)).toEqual(['liquid', 'fractal']);
    expect(() => rubricTags(vocabulary, ['liquid', 'nope'])).toThrow(new UsageError('unknown tag nope'));
    expect(() => rubricTags(vocabulary, ['red'])).toThrow(/red has no rubric/);
  });

  it('asks what a partial cache lacks, and again for a changed rubric', () => {
    const rows = fixture.features.rows;
    const tags = rubricTags(vocabulary, ['liquid', 'fractal', 'glow']);
    const cache: RubricCache = emptyCache();
    const rubrics = Object.fromEntries(tags.map((t) => [t.id, rubricHash(t.rubric!)]));
    // The first preset is done; the second has liquid only; the third answered an old fractal rubric; the fourth came from another model.
    mergeScores(cache, new Map([[rows[0].hash, new Map(tags.map((t) => [t.id, 0.5]))]]), rubrics, RUBRIC_MODEL, at);
    mergeScores(cache, new Map([[rows[1].hash, new Map([['liquid', 0.2]])]]), rubrics, RUBRIC_MODEL, at);
    mergeScores(cache, new Map([[rows[2].hash, new Map(tags.map((t) => [t.id, 0.5]))]]), { ...rubrics, fractal: 'old' }, RUBRIC_MODEL, at);
    mergeScores(cache, new Map([[rows[3].hash, new Map(tags.map((t) => [t.id, 0.5]))]]), rubrics, 'claude-other', at);
    const m = missingPairs([...rows, rows[5]], tags, cache);
    expect(m.has(rows[0].hash)).toBe(false);
    expect(m.get(rows[1].hash)!.map((t) => t.id)).toEqual(['fractal', 'glow']);
    expect(m.get(rows[2].hash)!.map((t) => t.id)).toEqual(['fractal']);
    expect(m.get(rows[3].hash)!.map((t) => t.id)).toEqual(['liquid', 'fractal', 'glow']);
    expect(m.size).toBe(rows.length - 1);
    expect([...m.keys()]).toEqual(rows.slice(1).map((r) => r.hash));
  });
});

describe('the batch request', () => {
  it('carries the frame sheet first and the rubrics, never the path, name or style', async () => {
    const row = fixture.features.rows[3];
    const tags = rubricTags(vocabulary, ['liquid', 'tunnel']);
    const prompt = makePrompt(fixture.features.clip, 8, all);
    const sheet = await frameSheet(clipFile(dir, row), fixture.features.clip);
    const req = buildRequest(row.hash, tags, sheet, prompt);
    expect(req.custom_id).toBe(row.hash);
    expect(req.custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    const p = req.params;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p).not.toHaveProperty('fallbacks');
    expect(p.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', properties: { liquid: { type: 'number' }, tunnel: { type: 'number' } }, required: ['liquid', 'tunnel'], additionalProperties: false } },
    });
    const content = p.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(content[1]).toEqual({ type: 'text', text: 'Rate these tags from 0 to 1: liquid, tunnel.' });
    expect(p.system).toContain('8 frames');
    expect(p.system).toContain('2-second');
    for (const t of all) expect(p.system).toContain(t.rubric);
    const text = JSON.stringify({ ...p, messages: [{ ...p.messages[0], content: [{ ...content[0], source: '…' }, content[1]] }] });
    for (const leak of [row.path, 'Fixture', 'preset.milk', row.style, 'Symmetric', 'Abstract', row.hash, ...Object.values(row.features).flatMap((v) => (v === null ? [] : [String(v)]))])
      expect(text).not.toContain(leak);
  });

  it('keeps the stable text identical across presets', async () => {
    const prompt = makePrompt(fixture.features.clip, 8, all);
    const [a, b] = await Promise.all(fixture.features.rows.slice(0, 2).map(async (r) => buildRequest(r.hash, all, await frameSheet(clipFile(dir, r), fixture.features.clip), prompt)));
    expect(a.params.system).toBe(b.params.system);
  });

  it('splits batches by count and size, in order', () => {
    expect(splitBatches([1, 2, 3, 4, 5], 2, 1e9)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitBatches([5, 5, 5, 5], 10, 12, (x) => x)).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(splitBatches([20, 1], 10, 12, (x) => x)).toEqual([[20], [1]]);
  });
});

describe('the cost estimate', () => {
  it('adds image, text and output tokens at batch prices', () => {
    const c = estimateCost([
      { width: 750, height: 100, chars: 400, tags: 2 },
      { width: 75, height: 10, chars: 3, tags: 1 },
    ]);
    // 100 + 100 and 1 + 1 input tokens; (150 + 20) + (150 + 10) output.
    expect(c.inputTokens).toBe(202);
    expect(c.outputTokens).toBe(2 * OUTPUT_BASE + 3 * OUTPUT_PER_TAG);
    expect(c.dollars).toBeCloseTo((202 * 1 + c.outputTokens * 5) / 1e6, 12);
    expect(c.requests).toBe(2);
  });

  it('counts the system, user text and schema for a request', () => {
    const prompt = makePrompt(fixture.features.clip, 8, all);
    const item = costItem(prompt, all, sheetSize(fixture.features.clip));
    expect(item.width).toBe(788);
    expect(item.chars).toBeGreaterThan(prompt.system.length);
    expect(item.tags).toBe(all.length);
  });
});

function message(text: string, stop: Anthropic.Messages.StopReason = 'end_turn'): Anthropic.Messages.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: RUBRIC_MODEL,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Messages.Message;
}

function line(custom_id: string, result: Anthropic.Messages.MessageBatchResult): Anthropic.Messages.MessageBatchIndividualResponse {
  return { custom_id, result };
}

describe('reading results', () => {
  const h = (c: string) => c.repeat(64);
  const asked: PendingBatch['asked'] = {
    [h('a')]: [h('a'), ['liquid', 'glow']],
    [h('b')]: [h('b'), ['liquid']],
    [h('c')]: [h('c'), ['liquid']],
    [h('d')]: [h('d'), ['liquid', 'glow']],
    [h('e')]: [h('e'), ['glow']],
    [h('f')]: [h('f'), ['liquid', 'glow']],
    [h('0')]: [h('0'), ['liquid']],
  };

  it('stores succeeded scores clamped to 0–1 and lists what to retry, in any order', () => {
    const s = parseResults(
      [
        line(h('e'), { type: 'expired' }),
        line(h('d'), { type: 'succeeded', message: message('{"liquid": 1.7, "glow": -0.2}') }),
        line(h('b'), { type: 'errored', error: { type: 'error', request_id: null, error: { type: 'overloaded_error', message: 'Overloaded' } } as unknown as Anthropic.ErrorResponse }),
        line(h('c'), { type: 'succeeded', message: message('{"liquid": 0.4') }),
        line(h('a'), { type: 'succeeded', message: message('{"liquid": 0.25, "glow": 0.75}') }),
        line(h('f'), { type: 'succeeded', message: message('{"liquid": 0.5, "glow": "high"}') }),
        line(h('0'), { type: 'succeeded', message: message('{"liquid":', 'max_tokens') }),
        line('stranger', { type: 'canceled' }),
      ],
      asked,
    );
    expect(s.scores.get(h('a'))).toEqual(
      new Map([
        ['liquid', 0.25],
        ['glow', 0.75],
      ]),
    );
    expect(s.scores.get(h('d'))).toEqual(
      new Map([
        ['liquid', 1],
        ['glow', 0],
      ]),
    );
    expect(s.scores.get(h('f'))).toEqual(new Map([['liquid', 0.5]]));
    expect(s.scores.has(h('c'))).toBe(false);
    expect(s.counts).toEqual({ scored: 3, errored: 1, expired: 1, canceled: 0, malformed: 2, unknown: 1 });
    expect([...s.retry].sort()).toEqual([h('0'), h('b'), h('c'), h('e'), h('f')]);
    expect(s.problems.some((p) => p.includes('overloaded_error'))).toBe(true);
  });
});

describe('the cache', () => {
  it('round-trips, and the score command reads only current rubrics', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tags-rubric-cache-')), 'out', 'rubric.json');
    expect(readRubricScores(vocabulary, file)).toEqual(new Map());
    expect(readCache(file)).toEqual(emptyCache());
    const c = emptyCache();
    const rubrics = Object.fromEntries(all.map((t) => [t.id, rubricHash(t.rubric!)]));
    expect(
      mergeScores(
        c,
        new Map([
          [
            'p1',
            new Map([
              ['liquid', 0.9],
              ['glow', 0.1],
            ]),
          ],
        ]),
        rubrics,
        RUBRIC_MODEL,
        at,
      ),
    ).toBe(2);
    mergeScores(c, new Map([['p2', new Map([['liquid', 0.3]])]]), { liquid: 'stale' }, RUBRIC_MODEL, at);
    writeCache(c, file);
    expect(existsSync(file)).toBe(true);
    expect(readCache(file)).toEqual(c);
    expect(readCache(file).scores.p1.liquid).toEqual({ score: 0.9, rubric: rubrics.liquid, model: RUBRIC_MODEL, at });
    expect(readRubricScores(vocabulary, file)).toEqual(
      new Map([
        [
          'p1',
          new Map([
            ['liquid', 0.9],
            ['glow', 0.1],
          ]),
        ],
      ]),
    );
    // Editing the glow rubric drops just glow.
    const edited: Vocabulary = { ...vocabulary, tags: vocabulary.tags.map((t) => (t.id === 'glow' ? { ...t, rubric: `${t.rubric} Edited.` } : t)) };
    expect(readRubricScores(edited, file)).toEqual(new Map([['p1', new Map([['liquid', 0.9]])]]));
  });
});

describe('the command', () => {
  it('parses its arguments, and usage errors are UsageErrors', () => {
    expect(parseRubricArgs(['d', '--tags', 'liquid,glow', '--yes', '--limit', '3'])).toEqual({ dir: 'd', tags: ['liquid', 'glow'], yes: true, limit: 3 });
    expect(parseRubricArgs(['d'])).toEqual({ dir: 'd', tags: undefined, yes: false, limit: undefined });
    for (const bad of [[], ['d', '--limit', '0'], ['d', '--tags'], ['d', '--frob'], ['d', 'e']]) expect(() => parseRubricArgs(bad)).toThrow(UsageError);
  });

  const run = (...args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' };
    delete env.ANTHROPIC_API_KEY;
    return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/rubric.ts', ...args], { cwd: TAGS_DIR, env, encoding: 'utf8', timeout: 60_000 });
  };

  it('prints the estimate and exits 2 without ANTHROPIC_API_KEY, sending nothing', () => {
    const r = run(dir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('12 presets to ask (12 requests');
    expect(r.stdout).toMatch(/estimated cost: .* about \$\d/);
    expect(r.stdout).toContain('ANTHROPIC_API_KEY is not set: nothing sent');
  });

  it('exits 2 naming an unknown tag or one without a rubric', () => {
    const a = run(dir, '--tags', 'liquid,nope');
    expect(a.status).toBe(2);
    expect(a.stderr).toContain('unknown tag nope');
    const b = run(dir, '--tags', 'red');
    expect(b.status).toBe(2);
    expect(b.stderr).toContain('tag red has no rubric');
  });
});
