// Claude's 0–1 rating per rubric tag per preset: the pure parts of
// `npm run rubric`. Which (preset, tag) pairs the cache lacks, one batch
// request per preset covering all its missing tags, the cost estimate,
// reading batch results into scores and merging them into the cache.
//
// A request carries the frame sheet and the rubrics, nothing else: no path,
// name, author, style or measured feature reaches the API. The cache
// (`tags/out/rubric.json`) is keyed by content hash, and each score records a
// short hash of the rubric text it answered, so editing one rubric re-asks
// just that tag.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import type { Clip, Sheet } from './frames.ts';
import type { FeatureRow } from './features.ts';
import type { Tag, Vocabulary } from './vocabulary.ts';

/** The owner's choice; not to be changed here. */
export const RUBRIC_MODEL = 'claude-sonnet-5-5';
export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
export const RUBRIC_FILE = join(OUT_DIR, 'rubric.json');
export const PENDING_FILE = join(OUT_DIR, 'rubric-pending.json');

/** Batch prices for Sonnet 5.5, dollars per million tokens (half of $2 / $10). */
export const PRICE_IN = 1;
export const PRICE_OUT = 5;
/** Output tokens guessed per request: a little low-effort thinking and the JSON's braces, plus a few per tag. */
export const OUTPUT_BASE = 150;
export const OUTPUT_PER_TAG = 10;
export const MAX_TOKENS = 2048;
/** The Batches API takes up to 100,000 requests or 256 MB per batch; stay well under the size. */
export const BATCH_MAX_REQUESTS = 100_000;
export const BATCH_MAX_BYTES = 200 * 1024 * 1024;

export class UsageError extends Error {}

// ---------------------------------------------------------------- the cache

export interface CachedScore {
  score: number;
  /** `rubricHash` of the rubric text the score answered. */
  rubric: string;
  model: string;
  /** ISO time the result was read. */
  at: string;
}

export interface RubricCache {
  version: 1;
  /** Preset content hash → tag id → score. */
  scores: Record<string, Record<string, CachedScore>>;
}

export function rubricHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function emptyCache(): RubricCache {
  return { version: 1, scores: {} };
}

export function readCache(file: string = RUBRIC_FILE): RubricCache {
  if (!existsSync(file)) return emptyCache();
  const c = JSON.parse(readFileSync(file, 'utf8')) as RubricCache;
  if (c.version !== 1 || typeof c.scores !== 'object' || c.scores === null) throw new Error(`${file}: not a version 1 rubric cache`);
  return c;
}

/** Written whole, then renamed over the old file, so a crash never leaves half a cache. */
export function writeCache(c: RubricCache, file: string = RUBRIC_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(c));
  renameSync(tmp, file);
}

/** Puts scores into the cache (replacing older ones for the same preset and tag); returns how many. */
export function mergeScores(c: RubricCache, scores: Map<string, Map<string, number>>, rubrics: Record<string, string>, model: string, at: string): number {
  let n = 0;
  for (const [hash, tags] of scores) {
    const entry = (c.scores[hash] ??= {});
    for (const [tag, score] of tags) {
      const rubric = rubrics[tag];
      if (rubric === undefined) continue;
      entry[tag] = { score, rubric, model, at };
      n++;
    }
  }
  return n;
}

/**
 * What the score command reads: preset hash → tag id → score, for the rubric
 * texts in `vocabulary` as they are now (a score that answered an older
 * rubric is left out). Empty when the file doesn't exist.
 */
export function readRubricScores(vocabulary: Vocabulary, file: string = RUBRIC_FILE): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!existsSync(file)) return out;
  const current = new Map<string, string>();
  for (const t of vocabulary.tags) if (t.rubric) current.set(t.id, rubricHash(t.rubric));
  for (const [hash, tags] of Object.entries(readCache(file).scores)) {
    for (const [tag, s] of Object.entries(tags)) {
      if (current.get(tag) !== s.rubric || typeof s.score !== 'number') continue;
      let m = out.get(hash);
      if (!m) out.set(hash, (m = new Map()));
      m.set(tag, s.score);
    }
  }
  return out;
}

// ---------------------------------------------------------------- what to ask

/** The tags with a rubric, or those named (each must exist and have one). */
export function rubricTags(v: Vocabulary, ids?: string[]): Tag[] {
  if (!ids) return v.tags.filter((t) => t.rubric);
  const out: Tag[] = [];
  for (const id of ids) {
    const t = v.tags.find((x) => x.id === id);
    if (!t) throw new UsageError(`unknown tag ${id}`);
    if (!t.rubric) throw new UsageError(`tag ${id} has no rubric`);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Per preset hash (each once, in row order), the tags whose score is missing,
 * answered an older rubric, or came from another model.
 */
export function missingPairs(rows: FeatureRow[], tags: Tag[], c: RubricCache, model: string = RUBRIC_MODEL): Map<string, Tag[]> {
  const out = new Map<string, Tag[]>();
  for (const r of rows) {
    if (out.has(r.hash)) continue;
    const have = c.scores[r.hash] ?? {};
    const miss = tags.filter((t) => {
      const s = have[t.id];
      return !s || s.rubric !== rubricHash(t.rubric!) || s.model !== model;
    });
    if (miss.length) out.set(r.hash, miss);
  }
  return out;
}

// ---------------------------------------------------------------- the request

export interface Prompt {
  /** The system text: the instruction and every rubric asked in this run; identical across the run's requests. */
  system: string;
}

/** The run's stable text, from the clip's description and the tags asked. Nothing preset-specific. */
export function makePrompt(clip: Clip, frames: number, tags: Tag[]): Prompt {
  const seconds = clip.fps > 0 ? Math.round((clip.frames / clip.fps) * 10) / 10 : null;
  const system = [
    `You rate pictures from an abstract music visualizer (MilkDrop presets). Each image is a sheet of ${frames} frames, in order left to right then top to bottom, taken evenly from a${seconds ? ` ${seconds}-second` : ''} clip of one preset playing to music.`,
    'Rate each tag you are asked about from 0 to 1 by its rubric below, judging the frames together (motion shows as change between them). Use the whole range: 0 and 1 for clear cases, values between for partial or uncertain ones. Answer with the JSON object only.',
    '',
    'Rubrics:',
    ...tags.map((t) => `- ${t.id}: ${t.rubric}`),
  ].join('\n');
  return { system };
}

export function scoreSchema(tags: Tag[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(tags.map((t) => [t.id, { type: 'number' }])),
    required: tags.map((t) => t.id),
    additionalProperties: false,
  };
}

export function userText(tags: Tag[]): string {
  return `Rate these tags from 0 to 1: ${tags.map((t) => t.id).join(', ')}.`;
}

/** One batch request: custom_id is the preset's content hash (64 hex), so results map straight back. */
export function buildRequest(hash: string, tags: Tag[], sheet: Pick<Sheet, 'data' | 'mediaType'>, prompt: Prompt, model: string = RUBRIC_MODEL): Anthropic.Messages.BatchCreateParams.Request {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(hash)) throw new Error(`hash ${hash} can't be a custom_id`);
  return {
    custom_id: hash,
    params: {
      model,
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: sheet.mediaType, data: sheet.data.toString('base64') } },
            { type: 'text', text: userText(tags) },
          ],
        },
      ],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: scoreSchema(tags) } },
    },
  };
}

/** Splits requests into batches under the API's count and size limits, keeping order. */
export function splitBatches<T>(requests: T[], maxCount = BATCH_MAX_REQUESTS, maxBytes = BATCH_MAX_BYTES, size: (r: T) => number = (r) => Buffer.byteLength(JSON.stringify(r))): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of requests) {
    const b = size(r);
    if (cur.length && (cur.length >= maxCount || bytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- the cost

export interface CostItem {
  /** The image's pixel size. */
  width: number;
  height: number;
  /** Characters of text sent: system, user text and the schema. */
  chars: number;
  /** Tags asked. */
  tags: number;
}

export interface Cost {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  dollars: number;
}

/** Image tokens ≈ width×height/750, text ≈ chars/4, output ≈ OUTPUT_BASE + OUTPUT_PER_TAG per tag; at the batch prices. */
export function estimateCost(items: CostItem[]): Cost {
  let input = 0;
  let output = 0;
  for (const i of items) {
    input += Math.ceil((i.width * i.height) / 750) + Math.ceil(i.chars / 4);
    output += OUTPUT_BASE + OUTPUT_PER_TAG * i.tags;
  }
  return { requests: items.length, inputTokens: input, outputTokens: output, dollars: (input * PRICE_IN + output * PRICE_OUT) / 1e6 };
}

/** The cost item for one preset's request, without building the image. */
export function costItem(prompt: Prompt, tags: Tag[], size: { width: number; height: number }): CostItem {
  return { width: size.width, height: size.height, chars: prompt.system.length + userText(tags).length + JSON.stringify(scoreSchema(tags)).length, tags: tags.length };
}

// ---------------------------------------------------------------- results

/** What was sent, kept in `rubric-pending.json` until the batch is read. */
export interface PendingBatch {
  id: string;
  created: string;
  model: string;
  /** Tag id → rubric hash of the text sent. */
  rubrics: Record<string, string>;
  /** custom_id → [preset hash, tag ids asked]. */
  asked: Record<string, [string, string[]]>;
}

export interface PendingFile {
  version: 1;
  batches: PendingBatch[];
}

export function readPending(file: string = PENDING_FILE): PendingFile | null {
  if (!existsSync(file)) return null;
  const p = JSON.parse(readFileSync(file, 'utf8')) as PendingFile;
  if (p.version !== 1 || !Array.isArray(p.batches)) throw new Error(`${file}: not a version 1 pending file`);
  return p;
}

export function writePending(p: PendingFile, file: string = PENDING_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(p));
  renameSync(tmp, file);
}

export type Outcome =
  | { kind: 'scored'; hash: string; scores: Map<string, number>; /** Asked tags the answer lacked or gave as a non-number. */ missing: string[] }
  | { kind: 'errored' | 'expired' | 'canceled' | 'malformed' | 'unknown'; hash: string | null; why: string };

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** One result line: the scores for the tags asked (clamped to 0–1), or why there are none. */
export function parseResult(r: Anthropic.Messages.MessageBatchIndividualResponse, asked: PendingBatch['asked']): Outcome {
  const a = asked[r.custom_id];
  if (!a) return { kind: 'unknown', hash: null, why: `custom_id ${r.custom_id} wasn't sent in this batch` };
  const [hash, tags] = a;
  const res = r.result;
  if (res.type === 'errored') return { kind: 'errored', hash, why: `${res.error.error.type}: ${res.error.error.message}` };
  if (res.type === 'expired' || res.type === 'canceled') return { kind: res.type, hash, why: res.type };
  const msg = res.message;
  if (msg.stop_reason !== 'end_turn') return { kind: 'malformed', hash, why: `stopped with ${msg.stop_reason}` };
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'malformed', hash, why: `not JSON: ${text.slice(0, 80)}` };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { kind: 'malformed', hash, why: 'not a JSON object' };
  const scores = new Map<string, number>();
  const missing: string[] = [];
  for (const t of tags) {
    const v = (json as Record<string, unknown>)[t];
    if (typeof v === 'number' && Number.isFinite(v)) scores.set(t, clamp(v));
    else missing.push(t);
  }
  if (scores.size === 0) return { kind: 'malformed', hash, why: 'no tag answered with a number' };
  return { kind: 'scored', hash, scores, missing };
}

export interface ResultSummary {
  scores: Map<string, Map<string, number>>;
  counts: Record<'scored' | 'errored' | 'expired' | 'canceled' | 'malformed' | 'unknown', number>;
  /** Preset hashes to send again (the next run does it by itself). */
  retry: Set<string>;
  /** Plain lines on what went wrong, one per failed result. */
  problems: string[];
}

export function emptySummary(): ResultSummary {
  return { scores: new Map(), counts: { scored: 0, errored: 0, expired: 0, canceled: 0, malformed: 0, unknown: 0 }, retry: new Set(), problems: [] };
}

/** Adds one result to a summary. */
export function addResult(s: ResultSummary, o: Outcome): void {
  s.counts[o.kind]++;
  if (o.kind === 'scored') {
    s.scores.set(o.hash, o.scores);
    if (o.missing.length) {
      s.retry.add(o.hash);
      s.problems.push(`${o.hash.slice(0, 16)}: no number for ${o.missing.join(', ')}`);
    }
    return;
  }
  if (o.hash) s.retry.add(o.hash);
  s.problems.push(`${o.hash ? o.hash.slice(0, 16) : '?'}: ${o.kind} (${o.why})`);
}

/** Every result of a batch (in any order) into one summary. */
export function parseResults(results: Iterable<Anthropic.Messages.MessageBatchIndividualResponse>, asked: PendingBatch['asked']): ResultSummary {
  const s = emptySummary();
  for (const r of results) addResult(s, parseResult(r, asked));
  return s;
}

// ---------------------------------------------------------------- arguments

export interface RubricArgs {
  dir: string;
  tags?: string[];
  yes: boolean;
  limit?: number;
}

export const USAGE = 'usage: npm run rubric -- <features DIR> [--tags a,b] [--yes] [--limit N]';

export function parseRubricArgs(argv: string[]): RubricArgs {
  let dir: string | undefined;
  let tags: string[] | undefined;
  let yes = false;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') yes = true;
    else if (a === '--tags') {
      const v = argv[++i];
      if (!v) throw new UsageError('--tags needs a comma-separated list');
      tags = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!tags.length) throw new UsageError('--tags needs a comma-separated list');
    } else if (a === '--limit') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new UsageError('--limit needs a whole number of presets, 1 or more');
      limit = v;
    } else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else if (dir) throw new UsageError(`one features DIR only (got ${dir} and ${a})`);
    else dir = a;
  }
  if (!dir) throw new UsageError('no features DIR');
  return { dir, tags, yes, limit };
}
