import { z } from 'zod';
import type { Up } from '../protocol.ts';

/**
 * The input boundary: what a browser is allowed to have sent.
 *
 * The server binds `0.0.0.0` on purpose — the renderer is meant to be on another
 * machine — so the socket answers anyone who can reach the port, and there is no
 * authentication in front of it. Past `JSON.parse` every handler read its
 * message's fields bare, which made a single malformed frame the whole show:
 * `lab-review` without `tags` reaches `tags.join` in the store, `lab-retag` with
 * a string reaches `tags.map`, and both throw inside a `'message'` listener
 * nothing catches. That is process exit, and process exit is a black wall.
 *
 * So one schema per message kind, checked before any of them is dispatched, and
 * anything that does not match is dropped with a line rather than acted on. A
 * skewed client — a wall tab left open across a server restart — is the ordinary
 * case this covers, not an attacker.
 *
 * **Validation only.** The message that comes back out is the one that went in,
 * so nothing a schema does not name is silently stripped on its way to a
 * handler.
 */

const NAMES = z.array(z.string());

/** 1–5, and the anchored ends are what make a corpus comparable — see `docs/lab.md`. */
const SCORE = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

/**
 * The room a judgment was made in, by value.
 *
 * Every field of it is written into the corpus, so a room in the wrong shape is
 * a row that cannot be read back — and `key` is genuinely nullable, which is a
 * room that states no key rather than a room missing one.
 */
const ROOM = z.object({
  tempo: z.number(),
  quantum: z.number(),
  energy: z.number(),
  section: z.string(),
  sections: NAMES,
  key: z.number().nullable(),
  colors: NAMES,
  seed: z.string(),
});

const SUBMISSION = z.object({
  candidateId: z.string(),
  room: ROOM,
  score: SCORE,
  tags: NAMES,
  note: z.string().optional(),
});

const RESPONSE = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear'), min: z.number(), max: z.number(), unit: z.string() }),
  z.object({
    kind: z.literal('exponential'),
    min: z.number().positive(),
    max: z.number().positive(),
    unit: z.string(),
  }),
  z.object({
    kind: z.literal('centered-power'),
    center: z.number().min(0).max(1),
    min: z.number(),
    neutral: z.number(),
    max: z.number(),
    exponent: z.number().positive(),
    unit: z.string(),
  }),
  z.object({
    kind: z.literal('steps'),
    values: z.array(z.number()).min(1),
    unit: z.string(),
  }),
]);

const CALIBRATION_DECISION = z.object({
  trialId: z.string(),
  trialVersion: z.number().int().positive(),
  room: ROOM,
  selectedOptionId: z.string().nullable(),
  response: RESPONSE.nullable(),
  extent: z.number().min(0.01).max(2),
  note: z.string().optional(),
});

const UP = z.discriminatedUnion('kind', [
  // The whole scheme, an object and no more than that here. What it is made of
  // is `merge`'s question, and it is the one door for both a file and an edit —
  // so checking the graph twice, in two vocabularies, is how the two drift.
  z.object({ kind: z.literal('scheme'), scheme: z.looseObject({}) }),
  z.object({ kind: z.literal('save-scheme') }),
  z.object({ kind: z.literal('save-scheme-as'), id: z.string() }),
  z.object({ kind: z.literal('load-scheme'), id: z.string() }),
  z.object({ kind: z.literal('downbeat') }),
  z.object({ kind: z.literal('next-flow') }),
  z.object({ kind: z.literal('next-colorway') }),
  z.object({ kind: z.literal('lab-open') }),
  z.object({ kind: z.literal('lab-review'), review: SUBMISSION }),
  z.object({ kind: z.literal('lab-skip'), candidateId: z.string() }),
  z.object({ kind: z.literal('lab-offer'), flowId: z.string() }),
  z.object({ kind: z.literal('lab-log'), before: z.number().optional() }),
  z.object({ kind: z.literal('lab-rescore'), reviewId: z.number(), score: SCORE }),
  z.object({ kind: z.literal('lab-retag'), reviewId: z.number(), tags: NAMES }),
  z.object({ kind: z.literal('lab-renote'), reviewId: z.number(), note: z.string() }),
  z.object({ kind: z.literal('lab-candidate'), candidateId: z.string() }),
  z.object({
    kind: z.literal('calibration-open'),
    trialId: z.string().optional(),
    trialVersion: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('calibration-decide'), decision: CALIBRATION_DECISION }),
]);

export type UpRead = { ok: true; up: Up } | { ok: false; why: string };

/** One frame off the socket, as a message or as the reason it is not one. */
export function readUp(raw: string): UpRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, why: 'not json' };
  }
  const read = UP.safeParse(parsed);
  if (read.success) {
    const up = parsed as Up;
    if (
      up.kind === 'calibration-open' &&
      ((up.trialId === undefined) !== (up.trialVersion === undefined))
    ) {
      return { ok: false, why: 'trial id and version must be sent together' };
    }
    return { ok: true, up };
  }
  const first = read.error.issues[0];
  const at = first.path.join('.');
  return { ok: false, why: at ? `${at}: ${first.message.toLowerCase()}` : first.message };
}
