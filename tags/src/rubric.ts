// `npm run rubric -- <features DIR> [--tags a,b] [--yes] [--limit N]`
//
// Asks Claude (Sonnet 5.5, through the Message Batches API) to rate each
// rubric tag 0–1 for each preset, from a sheet of 8 frames of its clip and the
// rubrics alone. Scores are cached by content hash in `tags/out/rubric.json`,
// so a rerun only sends presets and tags that are new, or whose rubric
// changed. It prints the estimated cost first and sends nothing without
// `ANTHROPIC_API_KEY` (exit 2) or without `--yes` (exit 0). A sent batch is
// remembered in `tags/out/rubric-pending.json` until its results are read, so
// a rerun after an interruption waits for it instead of sending again.

import { existsSync, unlinkSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { clipFile, loadFeatures, type Features } from './features.ts';
import { frameSheet, pickFrames, sheetSize } from './frames.ts';
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_REQUESTS,
  PENDING_FILE,
  RUBRIC_FILE,
  RUBRIC_MODEL,
  USAGE,
  UsageError,
  addResult,
  buildRequest,
  costItem,
  emptySummary,
  estimateCost,
  makePrompt,
  mergeScores,
  missingPairs,
  parseResult,
  parseRubricArgs,
  readCache,
  readPending,
  rubricHash,
  rubricTags,
  writeCache,
  writePending,
  type PendingBatch,
  type PendingFile,
  type RubricCache,
} from './rubric-core.ts';
import { loadVocabulary, type Tag } from './vocabulary.ts';

const POLL_MS = 30_000;
const SAVE_EVERY = 500;

const log = (s: string) => console.log(`rubric: ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (d: number) => `$${d < 10 ? d.toFixed(2) : d.toFixed(0)}`;

function savePending(p: PendingFile): void {
  if (p.batches.length) writePending(p);
  else if (existsSync(PENDING_FILE)) unlinkSync(PENDING_FILE);
}

/** Waits for one batch to end, reads its results into the cache as they arrive, and reports what failed. */
async function finishBatch(client: Anthropic, b: PendingBatch, cache: RubricCache, pathOf: Map<string, string>): Promise<void> {
  for (;;) {
    const s = await client.messages.batches.retrieve(b.id);
    const c = s.request_counts;
    if (s.processing_status === 'ended') {
      log(`batch ${b.id} ended: ${c.succeeded} succeeded, ${c.errored} errored, ${c.expired} expired, ${c.canceled} canceled`);
      break;
    }
    log(`batch ${b.id} ${s.processing_status}: ${c.processing} waiting, ${c.succeeded} succeeded, ${c.errored} errored (checking every ${POLL_MS / 1000} s)`);
    await sleep(POLL_MS);
  }
  const summary = emptySummary();
  let unsaved = 0;
  for await (const r of await client.messages.batches.results(b.id)) {
    const o = parseResult(r, b.asked);
    addResult(summary, o);
    if (o.kind === 'scored') {
      unsaved += mergeScores(cache, new Map([[o.hash, o.scores]]), b.rubrics, b.model, new Date().toISOString());
      if (unsaved >= SAVE_EVERY) {
        writeCache(cache);
        unsaved = 0;
      }
    }
  }
  writeCache(cache);
  const k = summary.counts;
  log(
    `batch ${b.id}: ${k.scored} presets scored into ${RUBRIC_FILE}; ${k.errored} errored, ${k.expired} expired, ${k.canceled} canceled, ${k.malformed} unusable answers${k.unknown ? `, ${k.unknown} unknown ids` : ''}`,
  );
  if (summary.retry.size) {
    const list = [...summary.retry].map((h) => pathOf.get(h) ?? h);
    log(`${list.length} presets to retry (the next run sends them again):`);
    for (const p of list.slice(0, 20)) console.log(`  ${p}`);
    if (list.length > 20) console.log(`  … and ${list.length - 20} more`);
    for (const p of summary.problems.slice(0, 10)) console.log(`  ${p}`);
  }
}

async function finishPending(client: Anthropic, pending: PendingFile, cache: RubricCache, pathOf: Map<string, string>): Promise<void> {
  while (pending.batches.length) {
    const b = pending.batches[0];
    try {
      await finishBatch(client, b, cache, pathOf);
    } catch (e) {
      // Results are kept 29 days; a batch that is gone can't be read, so forget it and its presets are asked again.
      if (!(e instanceof Anthropic.NotFoundError)) throw e;
      log(`batch ${b.id} is gone (${e.message}); its presets will be sent again`);
    }
    pending.batches.shift();
    savePending(pending);
  }
}

async function send(client: Anthropic, features: Features, dir: string, todo: [string, Tag[]][], tags: Tag[], pending: PendingFile): Promise<void> {
  const prompt = makePrompt(features.clip, pickFrames(features.clip.frames, 8).length, tags);
  const rubrics = Object.fromEntries(tags.map((t) => [t.id, rubricHash(t.rubric!)]));
  const rowOf = new Map(features.rows.map((r) => [r.hash, r]));
  let requests: Anthropic.Messages.BatchCreateParams.Request[] = [];
  let asked: PendingBatch['asked'] = {};
  let bytes = 0;
  const flush = async () => {
    const batch = await client.messages.batches.create({ requests });
    pending.batches.push({ id: batch.id, created: batch.created_at, model: RUBRIC_MODEL, rubrics, asked });
    writePending(pending);
    log(`sent batch ${batch.id}: ${requests.length} requests (${(bytes / 1024 / 1024).toFixed(0)} MB)`);
    requests = [];
    asked = {};
    bytes = 0;
  };
  for (const [hash, t] of todo) {
    const sheet = await frameSheet(clipFile(dir, rowOf.get(hash)!), features.clip);
    const req = buildRequest(hash, t, sheet, prompt);
    const b = Buffer.byteLength(JSON.stringify(req));
    if (requests.length && (requests.length >= BATCH_MAX_REQUESTS || bytes + b > BATCH_MAX_BYTES)) await flush();
    requests.push(req);
    asked[req.custom_id] = [hash, t.map((x) => x.id)];
    bytes += b;
  }
  if (requests.length) await flush();
}

async function main(argv: string[]): Promise<number> {
  let args;
  let tags: Tag[];
  let features: Features;
  const vocabulary = loadVocabulary();
  try {
    args = parseRubricArgs(argv);
    tags = rubricTags(vocabulary, args.tags);
    if (!tags.length) throw new UsageError('no tag in the vocabulary has a rubric');
    features = loadFeatures(args.dir);
  } catch (e) {
    console.error(`rubric: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const cache = readCache();
  const pathOf = new Map(features.rows.map((r) => [r.hash, r.path]));
  const key = process.env.ANTHROPIC_API_KEY;
  let client: Anthropic | null = null;

  const pending = readPending() ?? { version: 1, batches: [] };
  if (pending.batches.length) {
    if (!key) {
      log(`${pending.batches.length} sent batch(es) wait in ${PENDING_FILE}; set ANTHROPIC_API_KEY to read their results`);
      return 2;
    }
    client = new Anthropic();
    log(`resuming ${pending.batches.length} sent batch(es) from ${PENDING_FILE}`);
    await finishPending(client, pending, cache, pathOf);
  }

  const missing = missingPairs(features.rows, tags, cache);
  let todo: [string, Tag[]][] = [];
  let noClip = 0;
  const rowOf = new Map(features.rows.map((r) => [r.hash, r]));
  for (const [hash, t] of missing) {
    if (existsSync(clipFile(args.dir, rowOf.get(hash)!))) todo.push([hash, t]);
    else noClip++;
  }
  if (args.limit !== undefined) todo = todo.slice(0, args.limit);
  const presets = new Set(features.rows.map((r) => r.hash)).size;
  if (noClip) log(`${noClip} presets have no clip file and are left out`);
  if (!todo.length) {
    log(`nothing to send: all ${presets} presets have current scores for ${tags.map((t) => t.id).join(', ')}`);
    return 0;
  }

  const prompt = makePrompt(features.clip, pickFrames(features.clip.frames, 8).length, tags);
  const size = sheetSize(features.clip);
  const cost = estimateCost(todo.map(([, t]) => costItem(prompt, t, size)));
  const pairs = todo.reduce((n, [, t]) => n + t.length, 0);
  log(`${todo.length} presets to ask (${todo.length} requests, ${pairs} preset-tag pairs; ${presets - missing.size} of ${presets} already done) with ${RUBRIC_MODEL}`);
  log(`${tags.length} tags: ${tags.map((t) => t.id).join(', ')}`);
  log(`each request: one ${size.width}×${size.height} sheet of 8 frames and the rubrics`);
  log(
    `estimated cost: ~${cost.inputTokens.toLocaleString('en')} input and ~${cost.outputTokens.toLocaleString('en')} output tokens, about ${money(cost.dollars)} at batch prices ($1 / $5 per million)`,
  );
  if (!key) {
    log('ANTHROPIC_API_KEY is not set: nothing sent');
    return 2;
  }
  if (!args.yes) {
    log('add --yes to send');
    return 0;
  }
  client ??= new Anthropic();
  await send(client, features, args.dir, todo, tags, pending);
  await finishPending(client, pending, cache, pathOf);
  return 0;
}

if (import.meta.main) {
  let code: number;
  try {
    code = await main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error(`rubric: the API failed${e.status ? ` (${e.status})` : ''}: ${e.message}`);
      code = 1;
    } else throw e;
  }
  process.exit(code);
}
