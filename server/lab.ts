import { createHash } from 'node:crypto';
import type { DatabaseSync as Database } from 'node:sqlite';

// Through `getBuiltinModule` rather than an import statement, because the
// vite that vitest transforms server files with predates `node:sqlite` and
// tries to bundle it as a package. Type-only imports are erased, so the types
// still come from the real module.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
import type {
  FlowDef,
  LabCandidate,
  LabReviewRow,
  LabRoom,
  LabState,
  LabSubmission,
} from '../protocol.ts';
import {
  LAB_RENDERER_VERSION,
  RUBRIC_VERSION,
  TAG_BY_ID,
  TAGS,
  TAGS_VERSION,
  canonicalCandidate,
  dealRoom,
  seeded,
  submissionProblems,
  type LabMethod,
} from '../lab.ts';
import { compileFlow } from '../src/render/circuit.ts';

const RENDERER = `pipeline@${LAB_RENDERER_VERSION}`;

/**
 * The lab's evidence, and the one process allowed to hold the pen.
 *
 * SQLite where everything else here is JSON, and the difference is the data:
 * a scheme is a document a person owns and edits, where a review corpus is an
 * append-mostly ledger whose whole value is that nothing in it is ever
 * silently rewritten. Browsers never open this database — they send one coarse
 * message and receive coarse state, and this module is the only writer.
 *
 * `node:sqlite` stays behind `LabStore`: the rest of the application depends
 * on these verbs, never on that driver's API.
 *
 * **Reviews are facts; scores are derived.** There is no mutable score on a
 * candidate anywhere in this schema. An aggregate is a named, versioned
 * calculation (`aggregate`, `snapshotRatings`) that can be rebuilt from raw
 * reviews at any time, and updating one never touches a review.
 */

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE experiments (
    id INTEGER PRIMARY KEY,
    method TEXT NOT NULL,
    method_version INTEGER NOT NULL,
    seed TEXT NOT NULL,
    configuration_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (method, method_version, seed)
  );
  CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    flow_json TEXT NOT NULL,
    dependency_bundle_json TEXT NOT NULL,
    generator_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE candidate_origins (
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    parent_candidate_id TEXT REFERENCES candidates(id),
    operation TEXT NOT NULL,
    operation_json TEXT NOT NULL DEFAULT '{}',
    generation INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    room_json TEXT NOT NULL,
    challenge_version INTEGER NOT NULL
  );
  CREATE TABLE evaluations (
    id INTEGER PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    renderer_version TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '{}',
    artifact_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    rubric_version INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE review_tags (
    review_id INTEGER NOT NULL REFERENCES reviews(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    effect TEXT NOT NULL CHECK (effect IN ('helped', 'hurt', 'neutral')),
    UNIQUE (review_id, tag_id)
  );
  CREATE TABLE served (
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    disposition TEXT NOT NULL CHECK (disposition IN ('pending', 'reviewed', 'skipped')),
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX served_pending ON served (experiment_id, disposition, created_at);
  CREATE TABLE rating_snapshots (
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    rating_method TEXT NOT NULL,
    rating_version INTEGER NOT NULL,
    score REAL NOT NULL,
    uncertainty REAL,
    review_count INTEGER NOT NULL,
    calculated_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE tags ADD COLUMN polarity TEXT NOT NULL DEFAULT 'neutral'
    CHECK (polarity IN ('praise', 'fault', 'neutral'));
  `,
  `
  CREATE TABLE review_tags_plain (
    review_id INTEGER NOT NULL REFERENCES reviews(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    UNIQUE (review_id, tag_id)
  );
  INSERT INTO review_tags_plain (review_id, tag_id)
    SELECT review_id, tag_id FROM review_tags;
  DROP TABLE review_tags;
  ALTER TABLE review_tags_plain RENAME TO review_tags;
  `,
];

export interface StoredCandidate {
  id: string;
  flow: FlowDef;
  bundle: Record<string, FlowDef>;
  generatorVersion: string;
}

export interface CandidateAggregate {
  count: number;
  mean: number | null;
  /** Reviews per anchored score, 1 through 5. */
  distribution: Record<number, number>;
  tags: { id: string; count: number }[];
}

export interface LabStore {
  openExperiment(method: string, methodVersion: number, seed: string): number;
  /** The newest experiment's seed for a method, so a restart resumes its deck. */
  experimentSeed(method: string, methodVersion: number): string | null;
  /** Record a candidate. False when this behaviour was already known. */
  addCandidate(candidate: StoredCandidate): boolean;
  addOrigin(origin: {
    candidateId: string;
    experimentId: number;
    parent?: string;
    operation: string;
    operationJson?: unknown;
    generation?: number;
  }): void;
  candidate(id: string): StoredCandidate | null;
  origin(candidateId: string, experimentId: number): { operation: string; json: unknown } | null;
  /** Put a candidate in the queue. */
  serve(candidateId: string, experimentId: number): void;
  /** The oldest undecided candidate, or null for an empty queue. */
  nextPending(experimentId: number): string | null;
  counts(experimentId: number): { reviewed: number; skipped: number; pending: number };
  /**
   * One judgment, recorded whole in one transaction, or refused whole.
   * Refusal reasons are the shared `submissionProblems` plus what only the
   * store can know: an unknown candidate, an unknown or deprecated tag.
   */
  submit(
    review: LabSubmission,
    at: { experimentId: number; rendererVersion: string },
  ): { ok: true } | { ok: false; problem: string };
  /** "I did not judge this." Never a score, and preserved as its own fact. */
  skip(candidateId: string, experimentId: number): void;
  /**
   * A page of past judgments, newest first; `before` pages by review id.
   * `more` says the log continues past the oldest row returned.
   */
  reviewLog(limit: number, before?: number): { reviews: LabReviewRow[]; more: boolean };
  /**
   * Replace one review's tag set whole. Tags and the note are the living
   * description around a judgment; the judgment itself — score, room,
   * candidate, when — has no verb here that can touch it.
   */
  retag(
    reviewId: number,
    tags: string[],
  ): { ok: true; review: LabReviewRow } | { ok: false; problem: string };
  /** Replace one review's note. Blank becomes null, as on submit. */
  renote(
    reviewId: number,
    note: string,
  ): { ok: true; review: LabReviewRow } | { ok: false; problem: string };
  /** Rebuilt from raw reviews on every call. Never stored, never trusted stale. */
  aggregate(candidateId: string): CandidateAggregate;
  /** Write one derived rating row per reviewed candidate, named and versioned. */
  snapshotRatings(ratingMethod: string, ratingVersion: number): number;
  reviews(candidateId: string): {
    score: number;
    rubricVersion: number;
    note: string | null;
    room: LabRoom;
    rendererVersion: string;
    tags: string[];
  }[];
  /** Every durable fact as JSONL, render artifacts excepted. */
  exportJsonl(): string;
  /** The other half of the round trip. Only into an empty store. */
  importJsonl(text: string): void;
  close(): void;
}

const now = () => new Date().toISOString();

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function openLab(file: string): LabStore {
  const db: Database = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const version = () =>
    Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  while (version() < MIGRATIONS.length) {
    const at = version();
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[at]);
      db.exec(`PRAGMA user_version = ${at + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // The vocabulary rides the code; the table makes old reviews legible without
  // it. Labels, descriptions, shelving and polarity may improve in place —
  // meanings may not, which is why a changed meaning is a new id and
  // `active = 0` on the old one.
  const seedTag = db.prepare(
    `INSERT INTO tags (id, category, polarity, label, description, active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET category = excluded.category,
       polarity = excluded.polarity, label = excluded.label,
       description = excluded.description, active = excluded.active`,
  );
  for (const tag of TAGS) {
    seedTag.run(tag.id, tag.category, tag.polarity, tag.label, tag.description, tag.active ? 1 : 0);
  }

  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = work();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const aggregateOf = (candidateId: string): CandidateAggregate => {
    const rows = db
      .prepare(
        `SELECT r.score AS score FROM reviews r
         JOIN evaluations e ON e.id = r.evaluation_id
         WHERE e.candidate_id = ?`,
      )
      .all(candidateId) as { score: number }[];
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    for (const row of rows) {
      distribution[row.score] += 1;
      total += row.score;
    }
    const tags = db
      .prepare(
        `SELECT rt.tag_id AS id, COUNT(*) AS count
         FROM review_tags rt
         JOIN reviews r ON r.id = rt.review_id
         JOIN evaluations e ON e.id = r.evaluation_id
         WHERE e.candidate_id = ?
         GROUP BY rt.tag_id ORDER BY rt.tag_id`,
      )
      .all(candidateId) as { id: string; count: number }[];
    return {
      count: rows.length,
      mean: rows.length ? total / rows.length : null,
      distribution,
      tags: tags.map((row) => ({ id: row.id, count: Number(row.count) })),
    };
  };

  const tagsOfReview = db.prepare(
    'SELECT tag_id FROM review_tags WHERE review_id = ? ORDER BY tag_id',
  );

  /** One review as the log lists it, or null for an id nothing holds. */
  const rowOf = (reviewId: number): LabReviewRow | null => {
    const row = db
      .prepare(
        `SELECT r.id AS id, r.score AS score, r.note AS note, r.created_at AS created,
                e.candidate_id AS candidate, c.flow_json AS flow, ch.room_json AS room
         FROM reviews r
         JOIN evaluations e ON e.id = r.evaluation_id
         JOIN candidates c ON c.id = e.candidate_id
         JOIN challenges ch ON ch.id = e.challenge_id
         WHERE r.id = ?`,
      )
      .get(reviewId) as
      | {
          id: number;
          score: number;
          note: string | null;
          created: string;
          candidate: string;
          flow: string;
          room: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      candidateId: row.candidate,
      flowName: (JSON.parse(row.flow) as FlowDef).name,
      score: row.score as LabReviewRow['score'],
      tags: (tagsOfReview.all(row.id) as { tag_id: string }[]).map((tag) => tag.tag_id),
      note: row.note,
      room: JSON.parse(row.room) as LabRoom,
      createdAt: row.created,
    };
  };

  return {
    openExperiment(method, methodVersion, seed) {
      db.prepare(
        `INSERT OR IGNORE INTO experiments (method, method_version, seed, configuration_json, created_at)
         VALUES (?, ?, ?, '{}', ?)`,
      ).run(method, methodVersion, seed, now());
      const row = db
        .prepare('SELECT id FROM experiments WHERE method = ? AND method_version = ? AND seed = ?')
        .get(method, methodVersion, seed) as { id: number };
      return Number(row.id);
    },

    experimentSeed(method, methodVersion) {
      const row = db
        .prepare(
          'SELECT seed FROM experiments WHERE method = ? AND method_version = ? ORDER BY id DESC LIMIT 1',
        )
        .get(method, methodVersion) as { seed: string } | undefined;
      return row?.seed ?? null;
    },

    addCandidate(candidate) {
      const done = db
        .prepare(
          `INSERT OR IGNORE INTO candidates (id, flow_json, dependency_bundle_json, generator_version, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.id,
          JSON.stringify(candidate.flow),
          JSON.stringify(candidate.bundle),
          candidate.generatorVersion,
          now(),
        );
      return Number(done.changes) > 0;
    },

    addOrigin(origin) {
      db.prepare(
        `INSERT INTO candidate_origins
         (candidate_id, experiment_id, parent_candidate_id, operation, operation_json, generation)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        origin.candidateId,
        origin.experimentId,
        origin.parent ?? null,
        origin.operation,
        JSON.stringify(origin.operationJson ?? {}),
        origin.generation ?? 0,
      );
    },

    candidate(id) {
      const row = db
        .prepare('SELECT id, flow_json, dependency_bundle_json, generator_version FROM candidates WHERE id = ?')
        .get(id) as
        | { id: string; flow_json: string; dependency_bundle_json: string; generator_version: string }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        flow: JSON.parse(row.flow_json) as FlowDef,
        bundle: JSON.parse(row.dependency_bundle_json) as Record<string, FlowDef>,
        generatorVersion: row.generator_version,
      };
    },

    origin(candidateId, experimentId) {
      const row = db
        .prepare(
          `SELECT operation, operation_json FROM candidate_origins
           WHERE candidate_id = ? AND experiment_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(candidateId, experimentId) as { operation: string; operation_json: string } | undefined;
      return row ? { operation: row.operation, json: JSON.parse(row.operation_json) } : null;
    },

    serve(candidateId, experimentId) {
      db.prepare(
        `INSERT INTO served (candidate_id, experiment_id, disposition, created_at) VALUES (?, ?, 'pending', ?)`,
      ).run(candidateId, experimentId, now());
    },

    nextPending(experimentId) {
      const row = db
        .prepare(
          `SELECT candidate_id FROM served WHERE experiment_id = ? AND disposition = 'pending'
           ORDER BY created_at, rowid LIMIT 1`,
        )
        .get(experimentId) as { candidate_id: string } | undefined;
      return row?.candidate_id ?? null;
    },

    counts(experimentId) {
      const rows = db
        .prepare(
          `SELECT disposition, COUNT(*) AS n FROM served WHERE experiment_id = ? GROUP BY disposition`,
        )
        .all(experimentId) as { disposition: string; n: number }[];
      const of = (which: string) => Number(rows.find((row) => row.disposition === which)?.n ?? 0);
      return { reviewed: of('reviewed'), skipped: of('skipped'), pending: of('pending') };
    },

    submit(review, at) {
      const problems = submissionProblems(review);
      if (problems.length > 0) return { ok: false, problem: problems.join('; ') };
      for (const id of review.tags) {
        const known = TAG_BY_ID.get(id);
        if (!known) return { ok: false, problem: `no tag called ${id}` };
        if (!known.active) return { ok: false, problem: `${known.label} is deprecated` };
      }
      const held = db.prepare('SELECT id FROM candidates WHERE id = ?').get(review.candidateId);
      if (!held) return { ok: false, problem: 'that candidate is not in the lab' };

      transaction(() => {
        const roomJson = JSON.stringify(review.room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const evaluation = db
          .prepare(
            `INSERT INTO evaluations (candidate_id, challenge_id, renderer_version, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(review.candidateId, challengeId, at.rendererVersion, now());
        const wrote = db
          .prepare(
            `INSERT INTO reviews (experiment_id, evaluation_id, score, rubric_version, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            at.experimentId,
            Number(evaluation.lastInsertRowid),
            review.score,
            RUBRIC_VERSION,
            review.note?.trim() ? review.note.trim() : null,
            now(),
          );
        const tagIn = db.prepare('INSERT INTO review_tags (review_id, tag_id) VALUES (?, ?)');
        for (const id of review.tags) {
          tagIn.run(Number(wrote.lastInsertRowid), id);
        }
        db.prepare(
          `UPDATE served SET disposition = 'reviewed', decided_at = ?
           WHERE candidate_id = ? AND experiment_id = ? AND disposition = 'pending'`,
        ).run(now(), review.candidateId, at.experimentId);
      });
      return { ok: true };
    },

    skip(candidateId, experimentId) {
      db.prepare(
        `UPDATE served SET disposition = 'skipped', decided_at = ?
         WHERE candidate_id = ? AND experiment_id = ? AND disposition = 'pending'`,
      ).run(now(), candidateId, experimentId);
    },

    reviewLog(limit, before) {
      const rows = (
        before === undefined
          ? db.prepare('SELECT id FROM reviews ORDER BY id DESC LIMIT ?').all(limit + 1)
          : db
              .prepare('SELECT id FROM reviews WHERE id < ? ORDER BY id DESC LIMIT ?')
              .all(before, limit + 1)
      ) as { id: number }[];
      const more = rows.length > limit;
      return {
        reviews: rows.slice(0, limit).flatMap((row) => rowOf(Number(row.id)) ?? []),
        more,
      };
    },

    retag(reviewId, tags) {
      for (const id of tags) {
        const known = TAG_BY_ID.get(id);
        if (!known) return { ok: false, problem: `no tag called ${id}` };
        if (!known.active) return { ok: false, problem: `${known.label} is deprecated` };
      }
      const held = rowOf(reviewId);
      if (!held) return { ok: false, problem: 'that review is not in the lab' };
      transaction(() => {
        db.prepare('DELETE FROM review_tags WHERE review_id = ?').run(reviewId);
        const tagIn = db.prepare('INSERT INTO review_tags (review_id, tag_id) VALUES (?, ?)');
        for (const id of new Set(tags)) tagIn.run(reviewId, id);
      });
      return { ok: true, review: rowOf(reviewId)! };
    },

    renote(reviewId, note) {
      const held = rowOf(reviewId);
      if (!held) return { ok: false, problem: 'that review is not in the lab' };
      db.prepare('UPDATE reviews SET note = ? WHERE id = ?').run(
        note.trim() ? note.trim() : null,
        reviewId,
      );
      return { ok: true, review: rowOf(reviewId)! };
    },

    aggregate: aggregateOf,

    snapshotRatings(ratingMethod, ratingVersion) {
      const ids = db
        .prepare(
          `SELECT DISTINCT e.candidate_id AS id FROM reviews r
           JOIN evaluations e ON e.id = r.evaluation_id`,
        )
        .all() as { id: string }[];
      const write = db.prepare(
        `INSERT INTO rating_snapshots
         (candidate_id, rating_method, rating_version, score, uncertainty, review_count, calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      return transaction(() => {
        for (const { id } of ids) {
          const held = aggregateOf(id);
          write.run(id, ratingMethod, ratingVersion, held.mean!, null, held.count, now());
        }
        return ids.length;
      });
    },

    reviews(candidateId) {
      const rows = db
        .prepare(
          `SELECT r.id AS id, r.score AS score, r.rubric_version AS rubric, r.note AS note,
             c.room_json AS room, e.renderer_version AS renderer
           FROM reviews r
           JOIN evaluations e ON e.id = r.evaluation_id
           JOIN challenges c ON c.id = e.challenge_id
           WHERE e.candidate_id = ? ORDER BY r.id`,
        )
        .all(candidateId) as {
        id: number;
        score: number;
        rubric: number;
        note: string | null;
        room: string;
        renderer: string;
      }[];
      const tagsOf = db.prepare(
        'SELECT tag_id FROM review_tags WHERE review_id = ? ORDER BY tag_id',
      );
      return rows.map((row) => ({
        score: row.score,
        rubricVersion: row.rubric,
        note: row.note,
        room: JSON.parse(row.room) as LabRoom,
        rendererVersion: row.renderer,
        tags: (tagsOf.all(row.id) as { tag_id: string }[]).map((tag) => tag.tag_id),
      }));
    },

    exportJsonl() {
      const lines: string[] = [
        JSON.stringify({ t: 'lab', v: 1, rubric: RUBRIC_VERSION, tags: TAGS_VERSION }),
      ];
      const dump = (t: string, sql: string) => {
        for (const row of db.prepare(sql).all()) {
          lines.push(JSON.stringify({ t, ...(row as Record<string, unknown>) }));
        }
      };
      dump('experiment', 'SELECT * FROM experiments ORDER BY id');
      dump('candidate', 'SELECT * FROM candidates ORDER BY id');
      dump('origin', 'SELECT * FROM candidate_origins ORDER BY rowid');
      dump('challenge', 'SELECT * FROM challenges ORDER BY id');
      dump('evaluation', 'SELECT * FROM evaluations ORDER BY id');
      dump('review', 'SELECT * FROM reviews ORDER BY id');
      dump('tag', 'SELECT * FROM tags ORDER BY id');
      dump('review_tag', 'SELECT * FROM review_tags ORDER BY rowid');
      dump('served', 'SELECT * FROM served ORDER BY rowid');
      dump('rating', 'SELECT * FROM rating_snapshots ORDER BY rowid');
      return `${lines.join('\n')}\n`;
    },

    importJsonl(text) {
      const empty = db.prepare('SELECT COUNT(*) AS n FROM candidates').get() as { n: number };
      const held = db.prepare('SELECT COUNT(*) AS n FROM experiments').get() as { n: number };
      if (Number(empty.n) > 0 || Number(held.n) > 0) {
        throw new Error('import only fills an empty lab — this one holds evidence');
      }
      const into: Record<string, string> = {
        experiment: 'experiments',
        candidate: 'candidates',
        origin: 'candidate_origins',
        challenge: 'challenges',
        evaluation: 'evaluations',
        review: 'reviews',
        tag: 'tags',
        review_tag: 'review_tags',
        served: 'served',
        rating: 'rating_snapshots',
      };
      transaction(() => {
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const { t, ...row } = JSON.parse(line) as { t: string } & Record<string, unknown>;
          const table = into[t];
          if (!table) continue;
          const keys = Object.keys(row);
          db.prepare(
            `INSERT OR REPLACE INTO ${table} (${keys.join(', ')})
             VALUES (${keys.map(() => '?').join(', ')})`,
          ).run(...(keys.map((key) => row[key]) as (string | number | null)[]));
        }
      });
    },

    close() {
      db.close();
    },
  };
}

// --- the engine -----------------------------------------------------------

export interface LabEngine {
  /** Current state, dealing a candidate first if the queue is empty. */
  open(): LabState;
  submit(review: LabSubmission): LabState;
  skip(candidateId: string): LabState;
  /**
   * The review tab's verbs, passed through to the store untouched: the engine
   * owns the queue, and browsing the log neither deals nor advances it.
   */
  log(before?: number): { reviews: LabReviewRow[]; more: boolean };
  retag(
    reviewId: number,
    tags: string[],
  ): { ok: true; review: LabReviewRow } | { ok: false; problem: string };
  renote(
    reviewId: number,
    note: string,
  ): { ok: true; review: LabReviewRow } | { ok: false; problem: string };
  /** One frozen candidate's graph, for re-staging a judgment. */
  candidate(id: string): StoredCandidate | null;
  close(): void;
}

/**
 * The queue, tied to one method through the `LabMethod` boundary and nothing
 * wider: what the engine hands a method is a snapshot of evidence, a budget
 * and an rng — never the store, never a scheme, never a renderer.
 *
 * Deals are seeded `${experiment seed}:${how many were ever served}`, so a
 * restarted server continues the same experiment from the same deck instead
 * of re-dealing the candidates it already served.
 */
export function labEngine<State>(
  store: LabStore,
  method: LabMethod<State>,
  seed: string,
): LabEngine {
  const experimentId = store.openExperiment(method.id, method.version, seed);
  let state = method.start();
  let notice: string | null = null;

  const compiles = (draft: { flow: FlowDef; bundle: Record<string, FlowDef> }): boolean => {
    const compiled = compileFlow({ ...draft.bundle, '~deal': draft.flow }, '~deal');
    return compiled.source !== null && !compiled.error;
  };

  const deal = (): string | null => {
    const counts = store.counts(experimentId);
    const evidence = { reviewed: counts.reviewed, skipped: counts.skipped };
    // A method may deal an invalid or already-served graph; a few redraws is
    // the honest budget before saying the deck is stuck rather than looping.
    for (let attempt = 0; attempt < 8; attempt++) {
      const dealt = counts.reviewed + counts.skipped + counts.pending + attempt;
      const dealSeed = `${seed}:${dealt}`;
      const drafts = method.next(state, evidence, 1, seeded(dealSeed));
      const draft = drafts.find(compiles);
      if (!draft) continue;
      const id = sha(canonicalCandidate(draft.flow, draft.bundle));
      store.addCandidate({
        id,
        flow: draft.flow,
        bundle: draft.bundle,
        generatorVersion: `${method.id}@${method.version}`,
      });
      store.addOrigin({
        candidateId: id,
        experimentId,
        parent: draft.parents[0],
        operation: draft.operation,
        operationJson: { seed: dealSeed },
        generation: draft.parents.length > 0 ? 1 : 0,
      });
      store.serve(id, experimentId);
      return id;
    }
    return null;
  };

  const labState = (): LabState => {
    const counts = store.counts(experimentId);
    const id = store.nextPending(experimentId);
    const held = id ? store.candidate(id) : null;
    let candidate: LabCandidate | null = null;
    let room: LabRoom | null = null;
    if (id && held) {
      const origin = store.origin(id, experimentId);
      candidate = {
        id,
        flow: held.flow,
        bundle: held.bundle,
        method: method.id,
        methodVersion: method.version,
        seed: String((origin?.json as { seed?: string })?.seed ?? ''),
      };
      // From the candidate id, so the room a judgment is staged under is the
      // same one however many restarts sit between dealing and judging.
      room = dealRoom(`room:${id}`);
    }
    return {
      candidate,
      room,
      method: method.id,
      reviewed: counts.reviewed,
      skipped: counts.skipped,
      pending: counts.pending,
      notice,
    };
  };

  return {
    open() {
      notice = null;
      if (!store.nextPending(experimentId)) {
        if (deal() === null) notice = 'the method dealt nothing that compiles';
      }
      return labState();
    },
    submit(review) {
      const answer = store.submit(review, { experimentId, rendererVersion: RENDERER });
      if (!answer.ok) {
        notice = answer.problem;
        return labState();
      }
      notice = null;
      state = method.observe(state, [{ score: review.score }]);
      if (!store.nextPending(experimentId)) deal();
      return labState();
    },
    skip(candidateId) {
      notice = null;
      store.skip(candidateId, experimentId);
      if (!store.nextPending(experimentId)) deal();
      return labState();
    },
    log: (before) => store.reviewLog(50, before),
    retag: (reviewId, tags) => store.retag(reviewId, tags),
    renote: (reviewId, note) => store.renote(reviewId, note),
    candidate: (id) => store.candidate(id),
    close() {
      store.close();
    },
  };
}
