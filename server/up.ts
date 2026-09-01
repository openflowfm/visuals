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

const SELECTION = z.object({
  candidateId: z.string(),
  verdict: z.union([z.literal('up'), z.literal('down')]),
});

const COMPARISON = z.object({
  encounterId: z.number().int().positive(),
  choice: z.union([
    z.literal('left'),
    z.literal('right'),
    z.literal('both'),
    z.literal('neither'),
  ]),
});

/**
 * A batch match, and the room it was answered under.
 *
 * Optional, and only here: the legacy search's `lab-compare` takes the plain
 * shape, because nothing can change the room under it any more and a field
 * that is never sent is a field that will be wrong the day somebody reads it.
 */
const BATCH_COMPARISON = COMPARISON.extend({ room: ROOM.optional() });

const FINALS_COMPARISON = COMPARISON.extend({
  leftShowReady: z.boolean(),
  rightShowReady: z.boolean(),
});

const ARCHIVE_DECISION = z.object({
  candidateId: z.string(),
  verdict: z.union([z.literal('keep'), z.literal('pass'), z.literal('clear')]),
  source: z.union([z.literal('search'), z.literal('archive')]),
});

const LINEAGE_FINALIST = z.object({
  candidateId: z.string(),
  finalist: z.boolean(),
});

const SEED_VERDICT = z.object({
  encounterId: z.number().int().positive(),
  verdict: z.union([z.literal('yes'), z.literal('no')]),
});

const BOOKMARK = z.object({
  candidateId: z.string(),
  marked: z.boolean(),
});

// The size is checked here for shape and in the engine for whether it is one of
// the offered fields, which is the engine's to know — this door only refuses a
// number that could never be a field at all.
const DEVELOP_REQUEST = z.object({
  candidateId: z.string(),
  size: z.number().int().min(2).max(64),
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

const MODEL_TARGET = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('node-transform'),
    node: z.number().int().nonnegative(),
    nodePath: z.string(),
    property: z.enum([
      'translation-x', 'translation-y', 'translation-z',
      'rotation-x', 'rotation-y', 'rotation-z',
      'scale-x', 'scale-y', 'scale-z',
    ]),
  }),
  z.object({
    kind: z.literal('morph'),
    mesh: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    name: z.string(),
  }),
  z.object({ kind: z.literal('animation'), animation: z.number().int().nonnegative(), name: z.string() }),
  z.object({
    kind: z.literal('material'),
    material: z.number().int().nonnegative(),
    property: z.enum(['metallic', 'roughness', 'opacity', 'emissive-strength']),
  }),
]);

const MODEL_BINDING = z.object({
  id: z.string(),
  label: z.string(),
  group: z.string(),
  target: MODEL_TARGET,
  default: z.number(),
  min: z.number(),
  max: z.number(),
});

const MODEL_SETUP = z.object({
  id: z.string(),
  name: z.string(),
  assetHash: z.string(),
  bindings: z.array(MODEL_BINDING),
  materials: z.array(z.object({
    material: z.number().int().nonnegative(),
    source: z.enum(['color-a', 'color-b', 'primary', 'secondary', 'complement', 'accent', 'chalk', 'original']),
    amount: z.number(),
  })),
  camera: z.number().int().nonnegative().nullable().optional(),
});

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
  z.object({ kind: z.literal('model-save'), setup: MODEL_SETUP }),
  z.object({
    kind: z.literal('model-reconcile'),
    setupId: z.string(),
    assetHash: z.string(),
    decision: z.object({
      targets: z.record(z.string(), MODEL_TARGET),
      materials: z.record(z.string(), z.number().int().nonnegative().nullable()),
      camera: z.number().int().nonnegative().nullable(),
    }),
  }),
  z.object({ kind: z.literal('lab-open') }),
  z.object({ kind: z.literal('lab-compare'), comparison: COMPARISON }),
  z.object({ kind: z.literal('lab-skip-encounter'), encounterId: z.number().int().positive() }),
  z.object({ kind: z.literal('lab-archive-open') }),
  z.object({ kind: z.literal('lab-archive-select'), candidateId: z.string() }),
  z.object({ kind: z.literal('lab-archive-decide'), decision: ARCHIVE_DECISION }),
  z.object({ kind: z.literal('lab-lineage-finalist'), decision: LINEAGE_FINALIST }),
  z.object({ kind: z.literal('lab-explore-open') }),
  z.object({ kind: z.literal('lab-explore-judge'), submission: SEED_VERDICT }),
  z.object({ kind: z.literal('lab-explore-skip'), encounterId: z.number().int().positive() }),
  z.object({ kind: z.literal('lab-bookmark'), decision: BOOKMARK }),
  z.object({ kind: z.literal('lab-develop-open'), candidateId: z.string() }),
  z.object({ kind: z.literal('lab-develop-deal'), request: DEVELOP_REQUEST }),
  z.object({ kind: z.literal('lab-develop-compare'), comparison: BATCH_COMPARISON }),
  z.object({ kind: z.literal('lab-develop-skip'), encounterId: z.number().int().positive() }),
  z.object({ kind: z.literal('lab-develop-close') }),
  z.object({ kind: z.literal('lab-finals-open') }),
  z.object({ kind: z.literal('lab-finals-new') }),
  z.object({ kind: z.literal('lab-finals-compare'), comparison: FINALS_COMPARISON }),
  z.object({ kind: z.literal('lab-finals-skip'), encounterId: z.number().int().positive() }),
  z.object({ kind: z.literal('lab-select'), selection: SELECTION }),
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

/**
 * The two unions must name exactly the same messages, and this is what says so.
 *
 * `readUp` casts a schema-validated frame to `Up`, which quietly assumes the
 * schema and the protocol agree. They can drift in both directions and both are
 * silent at the point of the mistake. A kind added to `protocol.ts` and not
 * here is **dropped** — the client sends it, the server logs one line about an
 * invalid discriminator, and the feature simply does nothing. A kind here and
 * not there is a cast to a type that does not describe the value.
 *
 * So the drift is made a type error instead. `Exhaustive` is satisfiable only
 * when its two arguments are mutually assignable, so adding a message to either
 * union without the other fails `npm run typecheck` at the line below rather
 * than at runtime in front of somebody.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _MessagesAgree = Assert<Same<z.infer<typeof UP>['kind'], Up['kind']>>;

/** Every kind this door admits, for a test that walks all of them. */
export const UP_KINDS: readonly Up['kind'][] = UP.options.map(
  (option) => option.shape.kind.value as Up['kind'],
);

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
