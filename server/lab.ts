import { createHash } from 'node:crypto';
import type { DatabaseSync as Database } from 'node:sqlite';

// Through `getBuiltinModule` rather than an import statement, because the
// vite that vitest transforms server files with predates `node:sqlite` and
// tries to bundle it as a package. Type-only imports are erased, so the types
// still come from the real module.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
import type {
  FlowDef,
  LabArchiveSubmission,
  LabArchiveState,
  LabBatchSubmission,
  LabBookmarkSubmission,
  LabCandidate,
  LabComparisonSubmission,
  LabDevelopRequest,
  LabDevelopState,
  LabEncounter,
  LabEncounterPhase,
  LabExploreState,
  LabFinalsState,
  LabFinalsSubmission,
  LabLineageFinalistSubmission,
  LabReviewRow,
  LabRoom,
  LabSeedSubmission,
  LabSelection,
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
  type EncounterSideDraft,
  type ArchiveDecisionEvidence,
  type EvidenceCandidate,
  type EvidenceComparison,
  type FinalsComparisonEvidence,
  type FinalsNomineeEvidence,
  type LabEncounterDraft,
  type LabMethod,
  type LabSearchMethod,
  type SearchEvidence,
} from '../lab.ts';
import { compileFlow } from '../client/render/circuit.ts';
import {
  FINALS_WINNERS,
  finalsRooms,
  nextFinalsPair,
  nominateFinalists,
  rankFinalists,
} from './finals.ts';
import {
  BATCH_ROUNDS,
  BATCH_SIZES,
  nextBatchPair,
  rankBatch,
  type BatchComparisonEvidence,
  type BatchEntrantEvidence,
  type BatchStandingEvidence,
} from './batch.ts';
import { batchDrafts, seedDraft } from './lineage.ts';

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
  `
  CREATE TABLE selections (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX selections_experiment ON selections (experiment_id, id);
  `,
  `
  CREATE TABLE search_encounters (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    phase TEXT NOT NULL CHECK (phase IN ('explore', 'refine')),
    anchor_candidate_id TEXT REFERENCES candidates(id),
    left_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    right_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    depth INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'pending'
      CHECK (disposition IN ('pending', 'compared', 'skipped')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    CHECK (left_candidate_id <> right_candidate_id)
  );
  CREATE INDEX search_encounters_pending
    ON search_encounters (experiment_id, disposition, id);
  CREATE TABLE search_comparisons (
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL UNIQUE REFERENCES search_encounters(id),
    choice TEXT NOT NULL CHECK (choice IN ('left', 'right', 'both', 'neither')),
    renderer_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE search_encounters ADD COLUMN priority INTEGER NOT NULL DEFAULT 0
    CHECK (priority IN (0, 1));
  `,
  `
  CREATE TABLE finals_runs (
    id INTEGER PRIMARY KEY,
    source_experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    target_count INTEGER NOT NULL,
    configuration_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'judging'
      CHECK (status IN ('judging', 'complete')),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE finals_nominees (
    run_id INTEGER NOT NULL REFERENCES finals_runs(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    family_id TEXT NOT NULL,
    seed_score REAL NOT NULL,
    selected_order INTEGER NOT NULL,
    UNIQUE (run_id, candidate_id),
    UNIQUE (run_id, selected_order)
  );
  CREATE TABLE finals_encounters (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES finals_runs(id),
    left_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    right_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    room_index INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'pending'
      CHECK (disposition IN ('pending', 'compared', 'skipped')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    CHECK (left_candidate_id <> right_candidate_id)
  );
  CREATE INDEX finals_encounters_pending
    ON finals_encounters (run_id, disposition, id);
  CREATE TABLE finals_comparisons (
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL UNIQUE REFERENCES finals_encounters(id),
    choice TEXT NOT NULL CHECK (choice IN ('left', 'right', 'both', 'neither')),
    left_show_ready INTEGER NOT NULL CHECK (left_show_ready IN (0, 1)),
    right_show_ready INTEGER NOT NULL CHECK (right_show_ready IN (0, 1)),
    renderer_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE archive_decisions (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('keep', 'pass', 'clear')),
    source TEXT NOT NULL CHECK (source IN ('search', 'archive')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX archive_decisions_candidate
    ON archive_decisions (experiment_id, candidate_id, id);
  `,
  `
  CREATE TABLE lineage_finalist_decisions (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    family_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX lineage_finalist_decisions_family
    ON lineage_finalist_decisions (experiment_id, family_id, id);
  `,
  `
  CREATE TABLE seed_encounters (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    disposition TEXT NOT NULL DEFAULT 'pending'
      CHECK (disposition IN ('pending', 'judged', 'skipped')),
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX seed_encounters_pending
    ON seed_encounters (experiment_id, disposition, id);
  CREATE TABLE seed_verdicts (
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL UNIQUE REFERENCES seed_encounters(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('yes', 'no')),
    renderer_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE batches (
    id INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    parent_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    rounds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'judging'
      CHECK (status IN ('judging', 'complete', 'abandoned', 'closed')),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX batches_experiment ON batches (experiment_id, status, id);
  CREATE TABLE batch_entrants (
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    is_parent INTEGER NOT NULL CHECK (is_parent IN (0, 1)),
    entered_order INTEGER NOT NULL,
    UNIQUE (batch_id, candidate_id),
    UNIQUE (batch_id, entered_order)
  );
  CREATE TABLE batch_encounters (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    left_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    right_candidate_id TEXT NOT NULL REFERENCES candidates(id),
    round INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'pending'
      CHECK (disposition IN ('pending', 'compared', 'skipped')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    CHECK (left_candidate_id <> right_candidate_id)
  );
  CREATE INDEX batch_encounters_pending
    ON batch_encounters (batch_id, disposition, id);
  CREATE TABLE batch_comparisons (
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL UNIQUE REFERENCES batch_encounters(id),
    choice TEXT NOT NULL CHECK (choice IN ('left', 'right', 'both', 'neither')),
    renderer_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  -- The room a batch match was answered under, which is the batch's until
  -- somebody changes the colourway mid-field. Nullable, and null means the
  -- batch's own: every comparison recorded before this column existed was
  -- answered under the dealt room, and writing that id in retroactively would
  -- be inventing a fact rather than recording one.
  ALTER TABLE batch_comparisons ADD COLUMN challenge_id TEXT REFERENCES challenges(id);
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

export interface StoredEncounter {
  id: number;
  phase: LabEncounterPhase;
  anchorId: string | null;
  leftId: string;
  rightId: string;
  room: LabRoom;
  depth: number;
}

export interface StoredFinalsRun {
  id: number;
  status: 'judging' | 'complete';
  targetCount: number;
  rooms: ReturnType<typeof finalsRooms>;
}

export interface StoredFinalsEncounter {
  id: number;
  leftId: string;
  rightId: string;
  room: LabRoom;
  roomIndex: number;
}

export interface StoredArchiveCandidate {
  candidateId: string;
  room: LabRoom;
  discoveredAt: number;
}

export interface StoredLineageFinalist {
  cohort: string;
  candidateId: string;
}

export interface StoredSeedEncounter {
  id: number;
  candidateId: string;
  room: LabRoom;
}

export interface StoredBatch {
  id: number;
  parentId: string;
  room: LabRoom;
  rounds: number;
  /**
   * `judging` while matches remain, `complete` once every round is answered,
   * and then one of two endings. **abandoned** is walking away mid-batch;
   * **closed** is reading the result and leaving. They are separate because a
   * batch nobody finished is not evidence of the same thing as a batch that
   * ran out of matches, and collapsing them would make "how often does a
   * developed node actually get developed" unanswerable.
   */
  status: 'judging' | 'complete' | 'abandoned' | 'closed';
}

export interface StoredBatchEncounter {
  id: number;
  leftId: string;
  rightId: string;
  round: number;
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
  origin(candidateId: string, experimentId: number): {
    operation: string;
    json: unknown;
    parent: string | null;
    generation: number;
  } | null;
  /** Every candidate and binary decision visible to one generation method. */
  evidence(experimentId: number): EvidenceCandidate[];
  /** Persist one whole pair after both candidates compile. */
  addEncounter(encounter: {
    experimentId: number;
    phase: LabEncounterPhase;
    anchorId: string | null;
    leftId: string;
    rightId: string;
    room: LabRoom;
    depth: number;
    /** Manual focus is presentation order, not candidate provenance. */
    priority?: boolean;
  }): number;
  /** A manually offered pair first, otherwise the oldest unanswered pair. */
  nextEncounter(experimentId: number): StoredEncounter | null;
  /** Raise an existing question around this candidate instead of duplicating it. */
  focusEncounter(candidateId: string, experimentId: number): boolean;
  /** Every pair and answer available to the recursive scheduler. */
  encounterEvidence(experimentId: number): EvidenceComparison[];
  searchCounts(experimentId: number): {
    comparisons: number;
    explores: number;
    refines: number;
    skipped: number;
    pending: number;
  };
  compare(
    comparison: LabComparisonSubmission,
    at: { experimentId: number; rendererVersion: string },
  ): { ok: true } | { ok: false; problem: string };
  skipEncounter(encounterId: number, experimentId: number): void;
  /** Every work ever staged by search or given an explicit archive mark. */
  archiveCandidates(experimentId: number): StoredArchiveCandidate[];
  /** Latest absolute judgment per candidate; clear restores it to the replay queue. */
  archiveDecisions(experimentId: number): ArchiveDecisionEvidence[];
  archiveDecide(
    decision: LabArchiveSubmission,
    at: { experimentId: number; room: LabRoom },
  ): { ok: true } | { ok: false; problem: string };
  lineageFinalists(experimentId: number): StoredLineageFinalist[];
  lineageFinalist(
    decision: LabLineageFinalistSubmission,
    experimentId: number,
  ): { ok: true } | { ok: false; problem: string };
  finalsNominations(experimentId: number): string[];
  /** Latest frozen playoff for this search experiment, if one has begun. */
  finalsRun(experimentId: number): StoredFinalsRun | null;
  createFinalsRun(input: {
    experimentId: number;
    targetCount: number;
    rooms: ReturnType<typeof finalsRooms>;
    nominees: readonly FinalsNomineeEvidence[];
  }): number;
  finalsNominees(runId: number, experimentId: number): FinalsNomineeEvidence[];
  addFinalsEncounter(input: {
    runId: number;
    leftId: string;
    rightId: string;
    roomIndex: number;
    room: LabRoom;
  }): number;
  nextFinalsEncounter(runId: number): StoredFinalsEncounter | null;
  finalsEvidence(runId: number): FinalsComparisonEvidence[];
  finalsCompare(
    comparison: LabFinalsSubmission,
    at: { runId: number; rendererVersion: string },
  ): { ok: true } | { ok: false; problem: string };
  skipFinalsEncounter(encounterId: number, runId: number): void;
  completeFinals(runId: number): void;
  /** Stage one fresh root to be judged alone, under a frozen room. */
  addSeedEncounter(input: {
    experimentId: number;
    candidateId: string;
    room: LabRoom;
  }): number;
  nextSeedEncounter(experimentId: number): StoredSeedEncounter | null;
  judgeSeed(
    submission: LabSeedSubmission,
    at: { experimentId: number; rendererVersion: string },
  ): { ok: true } | { ok: false; problem: string };
  skipSeedEncounter(encounterId: number, experimentId: number): void;
  seedCounts(experimentId: number): {
    seen: number;
    admitted: number;
    declined: number;
    skipped: number;
  };
  /** Every root ever admitted by Explore, oldest first. */
  admittedSeeds(experimentId: number): string[];
  /** Whether this root has already been staged for a seed judgment. */
  seedSeen(experimentId: number, candidateId: string): boolean;
  /** One batch, its field frozen at the moment it was asked for. */
  createBatch(input: {
    experimentId: number;
    parentId: string;
    room: LabRoom;
    rounds: number;
    entrants: readonly { candidateId: string; isParent: boolean }[];
  }): number;
  /** The batch currently being judged in this experiment, if there is one. */
  openBatch(experimentId: number): StoredBatch | null;
  batchEntrants(batchId: number): BatchEntrantEvidence[];
  addBatchEncounter(input: {
    batchId: number;
    leftId: string;
    rightId: string;
    round: number;
  }): number;
  nextBatchEncounter(batchId: number): StoredBatchEncounter | null;
  batchEvidence(batchId: number): BatchComparisonEvidence[];
  batchCompare(
    comparison: LabBatchSubmission,
    at: { batchId: number; rendererVersion: string; room: LabRoom },
  ): { ok: true } | { ok: false; problem: string };
  skipBatchEncounter(encounterId: number, batchId: number): void;
  completeBatch(batchId: number): void;
  /** Walk away from a batch mid-way; its answered matches stay evidence. */
  abandonBatch(batchId: number): void;
  /** Dismiss a finished batch after reading its standings. */
  closeBatch(batchId: number): void;
  /** How many batches every node has ever been developed with. */
  batchCounts(experimentId: number): Map<string, number>;
  /**
   * Every batch that ran to the end, with what it takes to rank one.
   *
   * Settled means `complete` or `closed` — every match answered. A batch
   * somebody walked away from has a leader too, and it is not a result: half a
   * field judged once is exactly the thin evidence the old scheduler acted on.
   *
   * In bulk, and without circuits, because the forest ranks every one of these
   * on each state push to mark the winners.
   */
  settledBatches(
    experimentId: number,
  ): { id: number; entrants: BatchStandingEvidence[]; evidence: BatchComparisonEvidence[] }[];
  /** Times staged in a batch match, and times chosen, per candidate. */
  batchAppearances(
    experimentId: number,
  ): { candidateId: string; appearances: number; chosen: number }[];
  /** Put a candidate in the queue. */
  serve(candidateId: string, experimentId: number): void;
  /** The oldest undecided candidate, or null for an empty queue. */
  nextPending(experimentId: number): string | null;
  counts(experimentId: number): {
    liked: number;
    rejected: number;
    reviewed: number;
    skipped: number;
    pending: number;
  };
  /**
   * One judgment, recorded whole in one transaction, or refused whole.
   * Refusal reasons are the shared `submissionProblems` plus what only the
   * store can know: an unknown candidate, an unknown or deprecated tag.
   */
  submit(
    review: LabSubmission,
    at: { experimentId: number; rendererVersion: string },
  ): { ok: true } | { ok: false; problem: string };
  /** One fast train decision, separate from the anchored review rubric. */
  select(
    selection: LabSelection,
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
   * Replace one review's tag set whole. Score, tags and note are the
   * assessment, and the assessment may be revised; what it assesses —
   * candidate, room, when — has no verb here that can touch it.
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
  /** Replace one review's score, against the same rubric it was given under. */
  rescore(
    reviewId: number,
    score: LabSubmission['score'],
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
          `SELECT parent_candidate_id, operation, operation_json, generation FROM candidate_origins
           WHERE candidate_id = ? AND experiment_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(candidateId, experimentId) as
        | {
            parent_candidate_id: string | null;
            operation: string;
            operation_json: string;
            generation: number;
          }
        | undefined;
      return row
        ? {
            operation: row.operation,
            json: JSON.parse(row.operation_json),
            parent: row.parent_candidate_id,
            generation: Number(row.generation),
          }
        : null;
    },

    evidence(experimentId) {
      const rows = db
        .prepare(
          `SELECT c.id AS id, c.flow_json AS flow, c.dependency_bundle_json AS bundle,
                  o.parent_candidate_id AS parent, o.operation AS operation,
                  o.operation_json AS operation_json, o.generation AS generation,
                  s.id AS selection_id, s.verdict AS verdict
           FROM candidate_origins o
           JOIN candidates c ON c.id = o.candidate_id
           LEFT JOIN selections s ON s.id = (
             SELECT MAX(chosen.id) FROM selections chosen
             JOIN evaluations e ON e.id = chosen.evaluation_id
             WHERE chosen.experiment_id = o.experiment_id
               AND e.candidate_id = o.candidate_id
           )
           WHERE o.experiment_id = ? ORDER BY o.rowid`,
        )
        .all(experimentId) as {
        id: string;
        flow: string;
        bundle: string;
        parent: string | null;
        operation: string;
        operation_json: string;
        generation: number;
        selection_id: number | null;
        verdict: 'up' | 'down' | null;
      }[];
      return rows.map((row) => {
        const detail = JSON.parse(row.operation_json) as { cohort?: string };
        return {
          id: row.id,
          flow: JSON.parse(row.flow) as FlowDef,
          bundle: JSON.parse(row.bundle) as Record<string, FlowDef>,
          parentId: row.parent,
          operation: row.operation,
          generation: Number(row.generation),
          cohort: detail.cohort ?? `room:${row.id}`,
          verdict: row.verdict,
          selectedAt: row.selection_id === null ? null : Number(row.selection_id),
        };
      });
    },

    addEncounter(encounter) {
      return transaction(() => {
        const roomJson = JSON.stringify(encounter.room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const wrote = db
          .prepare(
            `INSERT INTO search_encounters
             (experiment_id, phase, anchor_candidate_id, left_candidate_id,
              right_candidate_id, challenge_id, depth, disposition, created_at, priority)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(
            encounter.experimentId,
            encounter.phase,
            encounter.anchorId,
            encounter.leftId,
            encounter.rightId,
            challengeId,
            encounter.depth,
            now(),
            encounter.priority ? 1 : 0,
          );
        return Number(wrote.lastInsertRowid);
      });
    },

    nextEncounter(experimentId) {
      const row = db
        .prepare(
          `SELECT e.id AS id, e.phase AS phase, e.anchor_candidate_id AS anchor,
                  e.left_candidate_id AS left_id, e.right_candidate_id AS right_id,
                  e.depth AS depth, c.room_json AS room
           FROM search_encounters e
           JOIN challenges c ON c.id = e.challenge_id
           WHERE e.experiment_id = ? AND e.disposition = 'pending'
           ORDER BY e.priority DESC, e.id LIMIT 1`,
        )
        .get(experimentId) as
        | {
            id: number;
            phase: LabEncounterPhase;
            anchor: string | null;
            left_id: string;
            right_id: string;
            depth: number;
            room: string;
          }
        | undefined;
      return row
        ? {
            id: Number(row.id),
            phase: row.phase,
            anchorId: row.anchor,
            leftId: row.left_id,
            rightId: row.right_id,
            room: JSON.parse(row.room) as LabRoom,
            depth: Number(row.depth),
          }
        : null;
    },

    focusEncounter(candidateId, experimentId) {
      const wrote = db
        .prepare(
          `UPDATE search_encounters SET priority = 1 WHERE id = (
             SELECT id FROM search_encounters
             WHERE experiment_id = ? AND anchor_candidate_id = ?
               AND disposition = 'pending'
             ORDER BY id LIMIT 1
           )`,
        )
        .run(experimentId, candidateId);
      return Number(wrote.changes) > 0;
    },

    encounterEvidence(experimentId) {
      const rows = db
        .prepare(
          `SELECT e.id AS id, e.phase AS phase, e.anchor_candidate_id AS anchor,
                  e.left_candidate_id AS left_id, e.right_candidate_id AS right_id,
                  e.depth AS depth, e.disposition AS disposition,
                  c.id AS comparison_id, c.choice AS choice
           FROM search_encounters e
           LEFT JOIN search_comparisons c ON c.encounter_id = e.id
           WHERE e.experiment_id = ? ORDER BY e.id`,
        )
        .all(experimentId) as {
        id: number;
        phase: LabEncounterPhase;
        anchor: string | null;
        left_id: string;
        right_id: string;
        depth: number;
        disposition: EvidenceComparison['disposition'];
        comparison_id: number | null;
        choice: EvidenceComparison['choice'];
      }[];
      return rows.map((row) => ({
        id: Number(row.id),
        phase: row.phase,
        anchorId: row.anchor,
        leftId: row.left_id,
        rightId: row.right_id,
        depth: Number(row.depth),
        disposition: row.disposition,
        choice: row.choice,
        decidedAt: row.comparison_id === null ? null : Number(row.comparison_id),
      }));
    },

    searchCounts(experimentId) {
      const rows = db
        .prepare(
          `SELECT phase, disposition, COUNT(*) AS n FROM search_encounters
           WHERE experiment_id = ? GROUP BY phase, disposition`,
        )
        .all(experimentId) as { phase: LabEncounterPhase; disposition: string; n: number }[];
      const count = (phase: LabEncounterPhase | null, disposition: string) =>
        rows
          .filter((row) => (phase === null || row.phase === phase) && row.disposition === disposition)
          .reduce((sum, row) => sum + Number(row.n), 0);
      return {
        comparisons: count(null, 'compared'),
        explores: count('explore', 'compared'),
        refines: count('refine', 'compared'),
        skipped: count(null, 'skipped'),
        pending: count(null, 'pending'),
      };
    },

    compare(comparison, at) {
      if (!['left', 'right', 'both', 'neither'].includes(comparison.choice)) {
        return { ok: false, problem: 'choose left, right, both, or neither' };
      }
      const pending = db
        .prepare(
          `SELECT id FROM search_encounters
           WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
        )
        .get(comparison.encounterId, at.experimentId);
      if (!pending) return { ok: false, problem: 'that comparison is not waiting for an answer' };
      transaction(() => {
        db.prepare(
          `INSERT INTO search_comparisons
           (encounter_id, choice, renderer_version, created_at) VALUES (?, ?, ?, ?)`,
        ).run(comparison.encounterId, comparison.choice, at.rendererVersion, now());
        db.prepare(
          `UPDATE search_encounters SET disposition = 'compared', decided_at = ?
           WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
        ).run(now(), comparison.encounterId, at.experimentId);
      });
      return { ok: true };
    },

    skipEncounter(encounterId, experimentId) {
      db.prepare(
        `UPDATE search_encounters SET disposition = 'skipped', decided_at = ?
         WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
      ).run(now(), encounterId, experimentId);
    },

    archiveCandidates(experimentId) {
      const rows = db
        .prepare(
          `WITH appearances AS (
             SELECT e.left_candidate_id AS candidate_id, e.challenge_id AS challenge_id,
                    e.id * 2 AS discovered_at
             FROM search_encounters e
             WHERE e.experiment_id = ?
             UNION ALL
             SELECT e.right_candidate_id, e.challenge_id, e.id * 2 + 1
             FROM search_encounters e
             WHERE e.experiment_id = ?
             UNION ALL
             SELECT s.candidate_id, s.challenge_id, 500000000 + s.id
             FROM seed_encounters s
             WHERE s.experiment_id = ?
             UNION ALL
             SELECT en.candidate_id, b.challenge_id, 700000000 + b.id * 1000 + en.entered_order
             FROM batch_entrants en
             JOIN batches b ON b.id = en.batch_id
             WHERE b.experiment_id = ?
             UNION ALL
             SELECT d.candidate_id, d.challenge_id, 1000000000 + d.id
             FROM archive_decisions d
             WHERE d.experiment_id = ?
           ), first_appearance AS (
             SELECT candidate_id, challenge_id, discovered_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY candidate_id ORDER BY discovered_at, challenge_id
                    ) AS pick
             FROM appearances
           )
           SELECT f.candidate_id AS candidate_id, ch.room_json AS room,
                  f.discovered_at AS discovered_at
           FROM first_appearance f
           JOIN challenges ch ON ch.id = f.challenge_id
           WHERE f.pick = 1
           ORDER BY f.discovered_at, f.candidate_id`,
        )
        .all(
          experimentId,
          experimentId,
          experimentId,
          experimentId,
          experimentId,
        ) as {
        candidate_id: string;
        room: string;
        discovered_at: number;
      }[];
      return rows.map((row) => ({
        candidateId: row.candidate_id,
        room: JSON.parse(row.room) as LabRoom,
        discoveredAt: Number(row.discovered_at),
      }));
    },

    archiveDecisions(experimentId) {
      const rows = db
        .prepare(
          `SELECT d.candidate_id AS candidate_id, d.verdict AS verdict,
                  d.source AS source, d.id AS decided_at
           FROM archive_decisions d
           WHERE d.experiment_id = ? AND d.id = (
             SELECT MAX(latest.id) FROM archive_decisions latest
             WHERE latest.experiment_id = d.experiment_id
               AND latest.candidate_id = d.candidate_id
           )
           ORDER BY d.id`,
        )
        .all(experimentId) as {
        candidate_id: string;
        verdict: ArchiveDecisionEvidence['verdict'];
        source: ArchiveDecisionEvidence['source'];
        decided_at: number;
      }[];
      return rows.map((row) => ({
        candidateId: row.candidate_id,
        verdict: row.verdict,
        source: row.source,
        decidedAt: Number(row.decided_at),
      }));
    },

    archiveDecide(decision, at) {
      if (!['keep', 'pass', 'clear'].includes(decision.verdict)) {
        return { ok: false, problem: 'archive judgment is keep, pass, or clear' };
      }
      if (!['search', 'archive'].includes(decision.source)) {
        return { ok: false, problem: 'archive judgment has no known source' };
      }
      const held = db
        .prepare(
          `SELECT 1 AS held FROM candidate_origins
           WHERE experiment_id = ? AND candidate_id = ? LIMIT 1`,
        )
        .get(at.experimentId, decision.candidateId);
      if (!held) return { ok: false, problem: 'that candidate is not in this search' };
      const roomJson = JSON.stringify(at.room);
      const challengeId = sha(roomJson);
      transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        db.prepare(
          `INSERT INTO archive_decisions
           (experiment_id, candidate_id, challenge_id, verdict, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          at.experimentId,
          decision.candidateId,
          challengeId,
          decision.verdict,
          decision.source,
          now(),
        );
      });
      return { ok: true };
    },

    lineageFinalists(experimentId) {
      const rows = db
        .prepare(
          `SELECT d.family_id AS family, d.candidate_id AS candidate_id,
                  d.selected AS selected
           FROM lineage_finalist_decisions d
           WHERE d.experiment_id = ? AND d.id = (
             SELECT MAX(latest.id) FROM lineage_finalist_decisions latest
             WHERE latest.experiment_id = d.experiment_id
               AND latest.family_id = d.family_id
           )
           ORDER BY d.id`,
        )
        .all(experimentId) as { family: string; candidate_id: string; selected: number }[];
      return rows.flatMap((row) =>
        row.selected === 1 ? [{ cohort: row.family, candidateId: row.candidate_id }] : [],
      );
    },

    lineageFinalist(decision, experimentId) {
      const origin = db
        .prepare(
          `SELECT operation_json FROM candidate_origins
           WHERE experiment_id = ? AND candidate_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(experimentId, decision.candidateId) as { operation_json: string } | undefined;
      if (!origin) return { ok: false, problem: 'that candidate is not in this search' };
      const detail = JSON.parse(origin.operation_json) as { cohort?: string };
      const cohort = detail.cohort ?? `family:${decision.candidateId}`;
      if (!decision.finalist) {
        const current = db.prepare(
          `SELECT candidate_id, selected FROM lineage_finalist_decisions
           WHERE experiment_id = ? AND family_id = ? ORDER BY id DESC LIMIT 1`,
        ).get(experimentId, cohort) as { candidate_id: string; selected: number } | undefined;
        if (current?.selected !== 1 || current.candidate_id !== decision.candidateId) {
          return { ok: false, problem: 'that work is not the current lineage finalist' };
        }
      }
      db.prepare(
        `INSERT INTO lineage_finalist_decisions
         (experiment_id, family_id, candidate_id, selected, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(experimentId, cohort, decision.candidateId, decision.finalist ? 1 : 0, now());
      return { ok: true };
    },

    finalsNominations(experimentId) {
      return (
        db.prepare(
          `SELECT n.candidate_id AS candidate_id
           FROM finals_nominees n
           JOIN finals_runs r ON r.id = n.run_id
           WHERE r.source_experiment_id = ? ORDER BY n.run_id, n.selected_order`,
        ).all(experimentId) as { candidate_id: string }[]
      ).map((row) => row.candidate_id);
    },

    finalsRun(experimentId) {
      const row = db
        .prepare(
          `SELECT id, status, target_count, configuration_json FROM finals_runs
           WHERE source_experiment_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(experimentId) as
        | { id: number; status: 'judging' | 'complete'; target_count: number; configuration_json: string }
        | undefined;
      if (!row) return null;
      const configuration = JSON.parse(row.configuration_json) as {
        rooms: ReturnType<typeof finalsRooms>;
      };
      return {
        id: Number(row.id),
        status: row.status,
        targetCount: Number(row.target_count),
        rooms: configuration.rooms,
      };
    },

    createFinalsRun(input) {
      return transaction(() => {
        const wrote = db
          .prepare(
            `INSERT INTO finals_runs
             (source_experiment_id, target_count, configuration_json, status, created_at)
             VALUES (?, ?, ?, 'judging', ?)`,
          )
          .run(
            input.experimentId,
            input.targetCount,
            JSON.stringify({ rooms: input.rooms }),
            now(),
          );
        const runId = Number(wrote.lastInsertRowid);
        const insert = db.prepare(
          `INSERT INTO finals_nominees
           (run_id, candidate_id, family_id, seed_score, selected_order)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const nominee of input.nominees) {
          insert.run(
            runId,
            nominee.candidate.id,
            nominee.candidate.cohort,
            nominee.seedScore,
            nominee.selectedOrder,
          );
        }
        return runId;
      });
    },

    finalsNominees(runId, experimentId) {
      const rows = db
        .prepare(
          `SELECT n.candidate_id AS id, n.family_id AS family,
                  n.seed_score AS seed_score, n.selected_order AS selected_order,
                  c.flow_json AS flow, c.dependency_bundle_json AS bundle,
                  o.parent_candidate_id AS parent, o.operation AS operation,
                  o.operation_json AS operation_json, o.generation AS generation
           FROM finals_nominees n
           JOIN finals_runs r ON r.id = n.run_id
           JOIN candidates c ON c.id = n.candidate_id
           JOIN candidate_origins o ON o.candidate_id = n.candidate_id
             AND o.experiment_id = r.source_experiment_id
             AND o.rowid = (
               SELECT MAX(latest.rowid) FROM candidate_origins latest
               WHERE latest.candidate_id = n.candidate_id
                 AND latest.experiment_id = r.source_experiment_id
             )
           WHERE n.run_id = ? AND r.source_experiment_id = ?
           ORDER BY n.selected_order`,
        )
        .all(runId, experimentId) as {
        id: string;
        family: string;
        seed_score: number;
        selected_order: number;
        flow: string;
        bundle: string;
        parent: string | null;
        operation: string;
        operation_json: string;
        generation: number;
      }[];
      return rows.map((row) => ({
        candidate: {
          id: row.id,
          flow: JSON.parse(row.flow) as FlowDef,
          bundle: JSON.parse(row.bundle) as Record<string, FlowDef>,
          parentId: row.parent,
          operation: row.operation,
          generation: Number(row.generation),
          cohort: row.family,
          verdict: null,
          selectedAt: null,
        },
        seedScore: Number(row.seed_score),
        selectedOrder: Number(row.selected_order),
      }));
    },

    addFinalsEncounter(input) {
      return transaction(() => {
        const roomJson = JSON.stringify(input.room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const wrote = db
          .prepare(
            `INSERT INTO finals_encounters
             (run_id, left_candidate_id, right_candidate_id, challenge_id,
              room_index, disposition, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          )
          .run(
            input.runId,
            input.leftId,
            input.rightId,
            challengeId,
            input.roomIndex,
            now(),
          );
        return Number(wrote.lastInsertRowid);
      });
    },

    nextFinalsEncounter(runId) {
      const row = db
        .prepare(
          `SELECT e.id, e.left_candidate_id AS left_id,
                  e.right_candidate_id AS right_id, e.room_index AS room_index,
                  c.room_json AS room
           FROM finals_encounters e
           JOIN challenges c ON c.id = e.challenge_id
           WHERE e.run_id = ? AND e.disposition = 'pending'
           ORDER BY e.id LIMIT 1`,
        )
        .get(runId) as
        | { id: number; left_id: string; right_id: string; room_index: number; room: string }
        | undefined;
      return row
        ? {
            id: Number(row.id),
            leftId: row.left_id,
            rightId: row.right_id,
            room: JSON.parse(row.room) as LabRoom,
            roomIndex: Number(row.room_index),
          }
        : null;
    },

    finalsEvidence(runId) {
      const rows = db
        .prepare(
          `SELECT e.id, e.left_candidate_id AS left_id,
                  e.right_candidate_id AS right_id, e.room_index AS room_index,
                  e.disposition AS disposition, c.choice AS choice,
                  c.left_show_ready AS left_ready, c.right_show_ready AS right_ready
           FROM finals_encounters e
           LEFT JOIN finals_comparisons c ON c.encounter_id = e.id
           WHERE e.run_id = ? ORDER BY e.id`,
        )
        .all(runId) as {
        id: number;
        left_id: string;
        right_id: string;
        room_index: number;
        disposition: FinalsComparisonEvidence['disposition'];
        choice: FinalsComparisonEvidence['choice'];
        left_ready: number | null;
        right_ready: number | null;
      }[];
      return rows.map((row) => ({
        id: Number(row.id),
        leftId: row.left_id,
        rightId: row.right_id,
        roomIndex: Number(row.room_index),
        disposition: row.disposition,
        choice: row.choice,
        leftShowReady: row.left_ready === 1,
        rightShowReady: row.right_ready === 1,
      }));
    },

    finalsCompare(comparison, at) {
      if (!['left', 'right', 'both', 'neither'].includes(comparison.choice)) {
        return { ok: false, problem: 'choose left, right, both, or neither' };
      }
      const pending = db
        .prepare(
          `SELECT id FROM finals_encounters
           WHERE id = ? AND run_id = ? AND disposition = 'pending'`,
        )
        .get(comparison.encounterId, at.runId);
      if (!pending) return { ok: false, problem: 'that Finals match is not waiting for an answer' };
      transaction(() => {
        db.prepare(
          `INSERT INTO finals_comparisons
           (encounter_id, choice, left_show_ready, right_show_ready,
            renderer_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          comparison.encounterId,
          comparison.choice,
          comparison.leftShowReady ? 1 : 0,
          comparison.rightShowReady ? 1 : 0,
          at.rendererVersion,
          now(),
        );
        db.prepare(
          `UPDATE finals_encounters SET disposition = 'compared', decided_at = ?
           WHERE id = ? AND run_id = ? AND disposition = 'pending'`,
        ).run(now(), comparison.encounterId, at.runId);
      });
      return { ok: true };
    },

    skipFinalsEncounter(encounterId, runId) {
      db.prepare(
        `UPDATE finals_encounters SET disposition = 'skipped', decided_at = ?
         WHERE id = ? AND run_id = ? AND disposition = 'pending'`,
      ).run(now(), encounterId, runId);
    },

    completeFinals(runId) {
      db.prepare(
        `UPDATE finals_runs SET status = 'complete', completed_at = ?
         WHERE id = ? AND status = 'judging'`,
      ).run(now(), runId);
    },

    addSeedEncounter(input) {
      return transaction(() => {
        const roomJson = JSON.stringify(input.room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const wrote = db
          .prepare(
            `INSERT INTO seed_encounters
             (experiment_id, candidate_id, challenge_id, disposition, created_at)
             VALUES (?, ?, ?, 'pending', ?)`,
          )
          .run(input.experimentId, input.candidateId, challengeId, now());
        return Number(wrote.lastInsertRowid);
      });
    },

    nextSeedEncounter(experimentId) {
      const row = db
        .prepare(
          `SELECT e.id, e.candidate_id AS candidate_id, c.room_json AS room
           FROM seed_encounters e
           JOIN challenges c ON c.id = e.challenge_id
           WHERE e.experiment_id = ? AND e.disposition = 'pending'
           ORDER BY e.id LIMIT 1`,
        )
        .get(experimentId) as { id: number; candidate_id: string; room: string } | undefined;
      return row
        ? {
            id: Number(row.id),
            candidateId: row.candidate_id,
            room: JSON.parse(row.room) as LabRoom,
          }
        : null;
    },

    judgeSeed(submission, at) {
      if (!['yes', 'no'].includes(submission.verdict)) {
        return { ok: false, problem: 'a seed is admitted or declined' };
      }
      const pending = db
        .prepare(
          `SELECT id FROM seed_encounters
           WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
        )
        .get(submission.encounterId, at.experimentId);
      if (!pending) return { ok: false, problem: 'that seed is not waiting for an answer' };
      transaction(() => {
        db.prepare(
          `INSERT INTO seed_verdicts (encounter_id, verdict, renderer_version, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(submission.encounterId, submission.verdict, at.rendererVersion, now());
        db.prepare(
          `UPDATE seed_encounters SET disposition = 'judged', decided_at = ?
           WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
        ).run(now(), submission.encounterId, at.experimentId);
      });
      return { ok: true };
    },

    skipSeedEncounter(encounterId, experimentId) {
      // A skip says no seed was judged, never that the seed was declined. It
      // settles the question and leaves no preference behind.
      db.prepare(
        `UPDATE seed_encounters SET disposition = 'skipped', decided_at = ?
         WHERE id = ? AND experiment_id = ? AND disposition = 'pending'`,
      ).run(now(), encounterId, experimentId);
    },

    seedCounts(experimentId) {
      const row = db
        .prepare(
          `SELECT
             SUM(CASE WHEN e.disposition = 'judged' THEN 1 ELSE 0 END) AS seen,
             SUM(CASE WHEN v.verdict = 'yes' THEN 1 ELSE 0 END) AS admitted,
             SUM(CASE WHEN v.verdict = 'no' THEN 1 ELSE 0 END) AS declined,
             SUM(CASE WHEN e.disposition = 'skipped' THEN 1 ELSE 0 END) AS skipped
           FROM seed_encounters e
           LEFT JOIN seed_verdicts v ON v.encounter_id = e.id
           WHERE e.experiment_id = ?`,
        )
        .get(experimentId) as {
        seen: number | null;
        admitted: number | null;
        declined: number | null;
        skipped: number | null;
      };
      return {
        seen: Number(row.seen ?? 0),
        admitted: Number(row.admitted ?? 0),
        declined: Number(row.declined ?? 0),
        skipped: Number(row.skipped ?? 0),
      };
    },

    admittedSeeds(experimentId) {
      const rows = db
        .prepare(
          `SELECT e.candidate_id AS candidate_id
           FROM seed_encounters e
           JOIN seed_verdicts v ON v.encounter_id = e.id
           WHERE e.experiment_id = ? AND v.verdict = 'yes'
           ORDER BY e.id`,
        )
        .all(experimentId) as { candidate_id: string }[];
      return rows.map((row) => row.candidate_id);
    },

    seedSeen(experimentId, candidateId) {
      const row = db
        .prepare(
          `SELECT 1 AS held FROM seed_encounters
           WHERE experiment_id = ? AND candidate_id = ? LIMIT 1`,
        )
        .get(experimentId, candidateId);
      return !!row;
    },

    createBatch(input) {
      return transaction(() => {
        const roomJson = JSON.stringify(input.room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const wrote = db
          .prepare(
            `INSERT INTO batches
             (experiment_id, parent_candidate_id, challenge_id, rounds, status, created_at)
             VALUES (?, ?, ?, ?, 'judging', ?)`,
          )
          .run(input.experimentId, input.parentId, challengeId, input.rounds, now());
        const batchId = Number(wrote.lastInsertRowid);
        const insert = db.prepare(
          `INSERT INTO batch_entrants (batch_id, candidate_id, is_parent, entered_order)
           VALUES (?, ?, ?, ?)`,
        );
        input.entrants.forEach((entrant, order) => {
          insert.run(batchId, entrant.candidateId, entrant.isParent ? 1 : 0, order);
        });
        return batchId;
      });
    },

    openBatch(experimentId) {
      const row = db
        .prepare(
          `SELECT b.id, b.parent_candidate_id AS parent_id, b.rounds AS rounds,
                  b.status AS status, c.room_json AS room
           FROM batches b
           JOIN challenges c ON c.id = b.challenge_id
           WHERE b.experiment_id = ? AND b.status IN ('judging', 'complete')
           ORDER BY b.id DESC LIMIT 1`,
        )
        .get(experimentId) as
        | { id: number; parent_id: string; rounds: number; status: StoredBatch['status']; room: string }
        | undefined;
      return row
        ? {
            id: Number(row.id),
            parentId: row.parent_id,
            room: JSON.parse(row.room) as LabRoom,
            rounds: Number(row.rounds),
            status: row.status,
          }
        : null;
    },

    batchEntrants(batchId) {
      const rows = db
        .prepare(
          `SELECT e.candidate_id AS candidate_id, e.is_parent AS is_parent,
                  e.entered_order AS entered_order, c.flow_json AS flow
           FROM batch_entrants e
           JOIN candidates c ON c.id = e.candidate_id
           WHERE e.batch_id = ?
           ORDER BY e.entered_order`,
        )
        .all(batchId) as {
        candidate_id: string;
        is_parent: number;
        entered_order: number;
        flow: string;
      }[];
      return rows.map((row) => ({
        candidateId: row.candidate_id,
        isParent: row.is_parent === 1,
        order: Number(row.entered_order),
        circuit: (JSON.parse(row.flow) as FlowDef).circuit,
      }));
    },

    addBatchEncounter(input) {
      const wrote = db
        .prepare(
          `INSERT INTO batch_encounters
           (batch_id, left_candidate_id, right_candidate_id, round, disposition, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(input.batchId, input.leftId, input.rightId, input.round, now());
      return Number(wrote.lastInsertRowid);
    },

    nextBatchEncounter(batchId) {
      const row = db
        .prepare(
          `SELECT id, left_candidate_id AS left_id, right_candidate_id AS right_id,
                  round AS round
           FROM batch_encounters
           WHERE batch_id = ? AND disposition = 'pending'
           ORDER BY id LIMIT 1`,
        )
        .get(batchId) as
        | { id: number; left_id: string; right_id: string; round: number }
        | undefined;
      return row
        ? {
            id: Number(row.id),
            leftId: row.left_id,
            rightId: row.right_id,
            round: Number(row.round),
          }
        : null;
    },

    settledBatches(experimentId) {
      const settled = `b.experiment_id = ? AND b.status IN ('complete', 'closed')`;
      const entrantRows = db
        .prepare(
          `SELECT e.batch_id AS batch_id, e.candidate_id AS candidate_id,
                  e.is_parent AS is_parent, e.entered_order AS entered_order
           FROM batch_entrants e
           JOIN batches b ON b.id = e.batch_id
           WHERE ${settled}
           ORDER BY e.batch_id, e.entered_order`,
        )
        .all(experimentId) as {
        batch_id: number;
        candidate_id: string;
        is_parent: number;
        entered_order: number;
      }[];
      const evidenceRows = db
        .prepare(
          `SELECT e.batch_id AS batch_id, e.id AS id,
                  e.left_candidate_id AS left_id, e.right_candidate_id AS right_id,
                  e.round AS round, e.disposition AS disposition, c.choice AS choice
           FROM batch_encounters e
           JOIN batches b ON b.id = e.batch_id
           LEFT JOIN batch_comparisons c ON c.encounter_id = e.id
           WHERE ${settled}
           ORDER BY e.batch_id, e.id`,
        )
        .all(experimentId) as {
        batch_id: number;
        id: number;
        left_id: string;
        right_id: string;
        round: number;
        disposition: BatchComparisonEvidence['disposition'];
        choice: BatchComparisonEvidence['choice'];
      }[];

      const batches = new Map<
        number,
        { id: number; entrants: BatchStandingEvidence[]; evidence: BatchComparisonEvidence[] }
      >();
      const at = (id: number) => {
        const held = batches.get(id);
        if (held) return held;
        const made = { id, entrants: [], evidence: [] };
        batches.set(id, made);
        return made;
      };
      for (const row of entrantRows) {
        at(Number(row.batch_id)).entrants.push({
          candidateId: row.candidate_id,
          isParent: row.is_parent === 1,
          order: Number(row.entered_order),
        });
      }
      for (const row of evidenceRows) {
        at(Number(row.batch_id)).evidence.push({
          id: Number(row.id),
          leftId: row.left_id,
          rightId: row.right_id,
          round: Number(row.round),
          disposition: row.disposition,
          choice: row.choice,
        });
      }
      return [...batches.values()];
    },

    batchEvidence(batchId) {
      const rows = db
        .prepare(
          `SELECT e.id, e.left_candidate_id AS left_id, e.right_candidate_id AS right_id,
                  e.round AS round, e.disposition AS disposition, c.choice AS choice
           FROM batch_encounters e
           LEFT JOIN batch_comparisons c ON c.encounter_id = e.id
           WHERE e.batch_id = ?
           ORDER BY e.id`,
        )
        .all(batchId) as {
        id: number;
        left_id: string;
        right_id: string;
        round: number;
        disposition: BatchComparisonEvidence['disposition'];
        choice: BatchComparisonEvidence['choice'];
      }[];
      return rows.map((row) => ({
        id: Number(row.id),
        leftId: row.left_id,
        rightId: row.right_id,
        round: Number(row.round),
        disposition: row.disposition,
        choice: row.choice,
      }));
    },

    batchCompare(comparison, at) {
      if (!['left', 'right', 'both', 'neither'].includes(comparison.choice)) {
        return { ok: false, problem: 'choose left, right, both, or neither' };
      }
      const pending = db
        .prepare(
          `SELECT id FROM batch_encounters
           WHERE id = ? AND batch_id = ? AND disposition = 'pending'`,
        )
        .get(comparison.encounterId, at.batchId);
      if (!pending) return { ok: false, problem: 'that match is not waiting for an answer' };
      const roomJson = JSON.stringify(at.room);
      const challengeId = sha(roomJson);
      transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        db.prepare(
          `INSERT INTO batch_comparisons
           (encounter_id, choice, renderer_version, challenge_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          comparison.encounterId,
          comparison.choice,
          at.rendererVersion,
          challengeId,
          now(),
        );
        db.prepare(
          `UPDATE batch_encounters SET disposition = 'compared', decided_at = ?
           WHERE id = ? AND batch_id = ? AND disposition = 'pending'`,
        ).run(now(), comparison.encounterId, at.batchId);
      });
      return { ok: true };
    },

    skipBatchEncounter(encounterId, batchId) {
      db.prepare(
        `UPDATE batch_encounters SET disposition = 'skipped', decided_at = ?
         WHERE id = ? AND batch_id = ? AND disposition = 'pending'`,
      ).run(now(), encounterId, batchId);
    },

    completeBatch(batchId) {
      db.prepare(
        `UPDATE batches SET status = 'complete', completed_at = ?
         WHERE id = ? AND status = 'judging'`,
      ).run(now(), batchId);
    },

    abandonBatch(batchId) {
      // Abandoned rather than deleted. The children were generated, staged and
      // in some cases already compared; throwing the rows away would take those
      // answers with them and make the forest forget works it had drawn.
      db.prepare(
        `UPDATE batches SET status = 'abandoned', completed_at = ?
         WHERE id = ? AND status = 'judging'`,
      ).run(now(), batchId);
    },

    closeBatch(batchId) {
      db.prepare(
        `UPDATE batches SET status = 'closed' WHERE id = ? AND status = 'complete'`,
      ).run(batchId);
    },

    batchCounts(experimentId) {
      const rows = db
        .prepare(
          `SELECT parent_candidate_id AS parent_id, COUNT(*) AS batches
           FROM batches WHERE experiment_id = ? GROUP BY parent_candidate_id`,
        )
        .all(experimentId) as { parent_id: string; batches: number }[];
      return new Map(rows.map((row) => [row.parent_id, Number(row.batches)]));
    },

    batchAppearances(experimentId) {
      const rows = db
        .prepare(
          `WITH sides AS (
             SELECT e.left_candidate_id AS candidate_id,
                    CASE WHEN c.choice IN ('left', 'both') THEN 1 ELSE 0 END AS chosen
             FROM batch_encounters e
             JOIN batches b ON b.id = e.batch_id
             JOIN batch_comparisons c ON c.encounter_id = e.id
             WHERE b.experiment_id = ?
             UNION ALL
             SELECT e.right_candidate_id,
                    CASE WHEN c.choice IN ('right', 'both') THEN 1 ELSE 0 END
             FROM batch_encounters e
             JOIN batches b ON b.id = e.batch_id
             JOIN batch_comparisons c ON c.encounter_id = e.id
             WHERE b.experiment_id = ?
           )
           SELECT candidate_id, COUNT(*) AS appearances, SUM(chosen) AS chosen
           FROM sides GROUP BY candidate_id`,
        )
        .all(experimentId, experimentId) as {
        candidate_id: string;
        appearances: number;
        chosen: number;
      }[];
      return rows.map((row) => ({
        candidateId: row.candidate_id,
        appearances: Number(row.appearances),
        chosen: Number(row.chosen ?? 0),
      }));
    },

    serve(candidateId, experimentId) {
      // Never pending twice: re-serving a decided candidate is a deliberate
      // re-judgment, where a second pending row is only ever a double click.
      db.prepare(
        `INSERT INTO served (candidate_id, experiment_id, disposition, created_at)
         SELECT ?, ?, 'pending', ?
         WHERE NOT EXISTS (
           SELECT 1 FROM served
           WHERE candidate_id = ? AND experiment_id = ? AND disposition = 'pending'
         )`,
      ).run(candidateId, experimentId, now(), candidateId, experimentId);
    },

    nextPending(experimentId) {
      // Manual offers first: a person who offered a flow is standing there
      // waiting to judge it, where the dealt supply is infinite and patient.
      const row = db
        .prepare(
          `SELECT s.candidate_id AS candidate_id FROM served s
           WHERE s.experiment_id = ? AND s.disposition = 'pending'
           ORDER BY EXISTS (
             SELECT 1 FROM candidate_origins o
             WHERE o.candidate_id = s.candidate_id AND o.experiment_id = s.experiment_id
               AND o.operation = 'manual'
           ) DESC, s.created_at, s.rowid LIMIT 1`,
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
      const choices = db
        .prepare(
          `SELECT verdict, COUNT(*) AS n FROM selections
           WHERE experiment_id = ? GROUP BY verdict`,
        )
        .all(experimentId) as { verdict: string; n: number }[];
      const chosen = (which: string) =>
        Number(choices.find((row) => row.verdict === which)?.n ?? 0);
      return {
        liked: chosen('up'),
        rejected: chosen('down'),
        reviewed: of('reviewed'),
        skipped: of('skipped'),
        pending: of('pending'),
      };
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

    select(selection, at) {
      if (selection.verdict !== 'up' && selection.verdict !== 'down') {
        return { ok: false, problem: 'a train decision is up or down' };
      }
      const held = db
        .prepare('SELECT id FROM candidates WHERE id = ?')
        .get(selection.candidateId);
      if (!held) return { ok: false, problem: 'that candidate is not in the lab' };
      const pending = db
        .prepare(
          `SELECT 1 AS held FROM served
           WHERE candidate_id = ? AND experiment_id = ? AND disposition = 'pending' LIMIT 1`,
        )
        .get(selection.candidateId, at.experimentId);
      if (!pending) return { ok: false, problem: 'that candidate is not waiting for a decision' };

      const origin = db
        .prepare(
          `SELECT operation_json FROM candidate_origins
           WHERE candidate_id = ? AND experiment_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(selection.candidateId, at.experimentId) as
        | { operation_json: string }
        | undefined;
      if (!origin) return { ok: false, problem: 'that candidate has no origin in this experiment' };
      const detail = JSON.parse(origin.operation_json) as { cohort?: string };
      // Binary Train is a controlled comparison: only the graph may change.
      // Derive the room here rather than trusting a browser to echo it back.
      const room = dealRoom(detail.cohort ?? `room:${selection.candidateId}`);

      transaction(() => {
        const roomJson = JSON.stringify(room);
        const challengeId = sha(roomJson);
        db.prepare(
          'INSERT OR IGNORE INTO challenges (id, room_json, challenge_version) VALUES (?, ?, 1)',
        ).run(challengeId, roomJson);
        const evaluation = db
          .prepare(
            `INSERT INTO evaluations (candidate_id, challenge_id, renderer_version, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(selection.candidateId, challengeId, at.rendererVersion, now());
        db.prepare(
          `INSERT INTO selections (experiment_id, evaluation_id, verdict, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(
          at.experimentId,
          Number(evaluation.lastInsertRowid),
          selection.verdict,
          now(),
        );
        // `reviewed` predates binary train. At the queue level it means
        // "decided"; the selection table preserves which decision it was.
        db.prepare(
          `UPDATE served SET disposition = 'reviewed', decided_at = ?
           WHERE candidate_id = ? AND experiment_id = ? AND disposition = 'pending'`,
        ).run(now(), selection.candidateId, at.experimentId);
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

    rescore(reviewId, score) {
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        return { ok: false, problem: 'a score is 1 through 5' };
      }
      const held = rowOf(reviewId);
      if (!held) return { ok: false, problem: 'that review is not in the lab' };
      db.prepare('UPDATE reviews SET score = ? WHERE id = ?').run(score, reviewId);
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
        JSON.stringify({ t: 'lab', v: 7, rubric: RUBRIC_VERSION, tags: TAGS_VERSION }),
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
      dump('selection', 'SELECT * FROM selections ORDER BY id');
      dump('encounter', 'SELECT * FROM search_encounters ORDER BY id');
      dump('comparison', 'SELECT * FROM search_comparisons ORDER BY id');
      dump('archive_decision', 'SELECT * FROM archive_decisions ORDER BY id');
      dump('lineage_finalist', 'SELECT * FROM lineage_finalist_decisions ORDER BY id');
      dump('finals_run', 'SELECT * FROM finals_runs ORDER BY id');
      dump('finals_nominee', 'SELECT * FROM finals_nominees ORDER BY run_id, selected_order');
      dump('finals_encounter', 'SELECT * FROM finals_encounters ORDER BY id');
      dump('finals_comparison', 'SELECT * FROM finals_comparisons ORDER BY id');
      dump('seed_encounter', 'SELECT * FROM seed_encounters ORDER BY id');
      dump('seed_verdict', 'SELECT * FROM seed_verdicts ORDER BY id');
      dump('batch', 'SELECT * FROM batches ORDER BY id');
      dump('batch_entrant', 'SELECT * FROM batch_entrants ORDER BY batch_id, entered_order');
      dump('batch_encounter', 'SELECT * FROM batch_encounters ORDER BY id');
      dump('batch_comparison', 'SELECT * FROM batch_comparisons ORDER BY id');
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
        selection: 'selections',
        encounter: 'search_encounters',
        comparison: 'search_comparisons',
        archive_decision: 'archive_decisions',
        lineage_finalist: 'lineage_finalist_decisions',
        finals_run: 'finals_runs',
        finals_nominee: 'finals_nominees',
        finals_encounter: 'finals_encounters',
        finals_comparison: 'finals_comparisons',
        seed_encounter: 'seed_encounters',
        seed_verdict: 'seed_verdicts',
        batch: 'batches',
        batch_entrant: 'batch_entrants',
        batch_encounter: 'batch_encounters',
        batch_comparison: 'batch_comparisons',
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
  compare(comparison: LabComparisonSubmission): LabState;
  skipEncounter(encounterId: number): LabState;
  archiveOpen(): LabState;
  archiveSelect(candidateId: string): LabState;
  archiveDecide(decision: LabArchiveSubmission): LabState;
  lineageFinalist(decision: LabLineageFinalistSubmission): LabState;
  exploreOpen(): LabState;
  exploreJudge(submission: LabSeedSubmission): LabState;
  exploreSkip(encounterId: number): LabState;
  bookmark(decision: LabBookmarkSubmission): LabState;
  developOpen(candidateId: string): LabState;
  developDeal(request: LabDevelopRequest): LabState;
  developCompare(comparison: LabBatchSubmission): LabState;
  developSkip(encounterId: number): LabState;
  developClose(): LabState;
  finalsOpen(): LabState;
  finalsNew(): LabState;
  finalsCompare(comparison: LabFinalsSubmission): LabState;
  finalsSkip(encounterId: number): LabState;
  select(selection: LabSelection): LabState;
  submit(review: LabSubmission): LabState;
  skip(candidateId: string): LabState;
  /**
   * A flow built by hand, frozen and put at the front of the queue — the
   * person who offered it is waiting to judge it, where the dealt supply is
   * infinite and patient. Same identity, same evidence, origin `manual`.
   */
  offer(flow: FlowDef, bundle: Record<string, FlowDef>): LabState;
  /**
   * The review tab's verbs, passed through to the store untouched: the engine
   * owns the queue, and browsing the log neither deals nor advances it.
   */
  log(before?: number): { reviews: LabReviewRow[]; more: boolean };
  rescore(
    reviewId: number,
    score: LabSubmission['score'],
  ): { ok: true; review: LabReviewRow } | { ok: false; problem: string };
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
    const evidence = { ...counts, candidates: store.evidence(experimentId) };
    // A method may deal an invalid or already-served graph; a few redraws is
    // the honest budget before saying the deck is stuck rather than looping.
    for (let attempt = 0; attempt < 8; attempt++) {
      const dealt = counts.reviewed + counts.skipped + counts.pending + attempt;
      const dealSeed = `${seed}:${dealt}`;
      const drafts = method.next(state, evidence, 1, seeded(dealSeed));
      const draft = drafts.find(compiles);
      if (!draft) continue;
      const id = sha(canonicalCandidate(draft.flow, draft.bundle));
      // A method proposing behavior it already proposed in this experiment is
      // stuck on that attempt, not asking the person to judge the same picture
      // twice under a different seed.
      if (store.origin(id, experimentId)) continue;
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
        operationJson: {
          seed: dealSeed,
          cohort: draft.cohort ?? `room:${id}`,
          ...(draft.operationData === undefined ? {} : { detail: draft.operationData }),
        },
        generation: draft.generation ?? (draft.parents.length > 0 ? 1 : 0),
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
      // An offered flow says so: its provenance is the person, not the deck.
      const manual = origin?.operation === 'manual';
      candidate = {
        id,
        flow: held.flow,
        bundle: held.bundle,
        method: manual ? 'manual' : method.id,
        methodVersion: manual ? 1 : method.version,
        seed: String((origin?.json as { seed?: string })?.seed ?? ''),
        parentId: origin?.parent ?? null,
        operation: origin?.operation ?? 'unknown',
        generation: origin?.generation ?? 0,
        cohort: String((origin?.json as { cohort?: string })?.cohort ?? `room:${id}`),
      };
      // Mutations in one cohort share a challenge, so a changed picture is the
      // only changed variable. Fresh candidates own a cohort of their own.
      room = dealRoom(candidate.cohort);
    }
    return {
      encounter: null,
      explore: null,
      develop: null,
      archive: null,
      finals: null,
      candidate,
      room,
      method: method.id,
      liked: counts.liked,
      rejected: counts.rejected,
      reviewed: counts.reviewed,
      skipped: counts.skipped,
      pending: counts.pending,
      comparisons: 0,
      explores: 0,
      refines: 0,
      frontier: 0,
      maxGeneration: 0,
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
    compare() {
      notice = 'this historical method deals one candidate rather than a comparison';
      return labState();
    },
    skipEncounter() {
      notice = 'this historical method has no comparison to skip';
      return labState();
    },
    archiveOpen() {
      notice = 'Archive replay needs a recursive comparison experiment';
      return labState();
    },
    archiveDecide() {
      notice = 'Archive replay needs a recursive comparison experiment';
      return labState();
    },
    archiveSelect() {
      notice = 'Archive replay needs a recursive comparison experiment';
      return labState();
    },
    lineageFinalist() {
      notice = 'Lineage finalists need a recursive comparison experiment';
      return labState();
    },
    exploreOpen() {
      notice = 'Explore needs a lineage experiment';
      return labState();
    },
    exploreJudge() {
      notice = 'Explore needs a lineage experiment';
      return labState();
    },
    exploreSkip() {
      notice = 'Explore needs a lineage experiment';
      return labState();
    },
    bookmark() {
      notice = 'Bookmarks need a lineage experiment';
      return labState();
    },
    developOpen() {
      notice = 'Develop needs a lineage experiment';
      return labState();
    },
    developDeal() {
      notice = 'Develop needs a lineage experiment';
      return labState();
    },
    developCompare() {
      notice = 'Develop needs a lineage experiment';
      return labState();
    },
    developSkip() {
      notice = 'Develop needs a lineage experiment';
      return labState();
    },
    developClose() {
      notice = 'Develop needs a lineage experiment';
      return labState();
    },
    finalsOpen() {
      notice = 'Finals needs a recursive comparison experiment';
      return labState();
    },
    finalsNew() {
      notice = 'Finals needs a recursive comparison experiment';
      return labState();
    },
    finalsCompare() {
      notice = 'this historical method has no Finals run';
      return labState();
    },
    finalsSkip() {
      notice = 'this historical method has no Finals run';
      return labState();
    },
    submit(review) {
      const answer = store.submit(review, { experimentId, rendererVersion: RENDERER });
      if (!answer.ok) {
        notice = answer.problem;
        return labState();
      }
      notice = null;
      state = method.observe(state, [{ kind: 'review', score: review.score }]);
      if (!store.nextPending(experimentId)) deal();
      return labState();
    },
    select(selection) {
      const answer = store.select(selection, { experimentId, rendererVersion: RENDERER });
      if (!answer.ok) {
        notice = answer.problem;
        return labState();
      }
      notice = null;
      state = method.observe(state, [{ kind: 'selection', verdict: selection.verdict }]);
      if (!store.nextPending(experimentId)) deal();
      return labState();
    },
    skip(candidateId) {
      notice = null;
      store.skip(candidateId, experimentId);
      if (!store.nextPending(experimentId)) deal();
      return labState();
    },
    offer(flow, bundle) {
      if (!compiles({ flow, bundle })) {
        notice = 'that flow does not compile';
        return labState();
      }
      notice = null;
      const id = sha(canonicalCandidate(flow, bundle));
      store.addCandidate({ id, flow, bundle, generatorVersion: 'manual@1' });
      if (!store.origin(id, experimentId)) {
        store.addOrigin({
          candidateId: id,
          experimentId,
          operation: 'manual',
          operationJson: { cohort: `room:${id}` },
        });
      }
      store.serve(id, experimentId);
      return labState();
    },
    log: (before) => store.reviewLog(50, before),
    rescore: (reviewId, score) => store.rescore(reviewId, score),
    retag: (reviewId, tags) => store.retag(reviewId, tags),
    renote: (reviewId, note) => store.renote(reviewId, note),
    candidate: (id) => store.candidate(id),
    close() {
      store.close();
    },
  };
}

/**
 * The recursive pair engine. Kept beside the legacy queue engine because both
 * write the same immutable candidate/review corpus, while their presentation
 * facts are intentionally different: an encounter is not two single votes.
 */
export function labSearchEngine<State>(
  store: LabStore,
  method: LabSearchMethod<State>,
  seed: string,
): LabEngine {
  const experimentId = store.openExperiment(method.id, method.version, seed);
  let state = method.start();
  let notice: string | null = null;
  let archiveNotice: string | null = null;
  let archiveFocus: string | null = null;
  let finalsNotice: string | null = null;
  let exploreNotice: string | null = null;
  let developNotice: string | null = null;

  const compiles = (draft: { flow: FlowDef; bundle: Record<string, FlowDef> }): boolean => {
    const compiled = compileFlow({ ...draft.bundle, '~deal': draft.flow }, '~deal');
    return compiled.source !== null && !compiled.error;
  };

  const evidence = (): SearchEvidence => ({
    ...store.counts(experimentId),
    candidates: store.evidence(experimentId),
    comparisons: store.encounterEvidence(experimentId),
  });

  const asCandidate = (id: string): LabCandidate | null => {
    const held = store.candidate(id);
    if (!held) return null;
    const origin = store.origin(id, experimentId);
    const manual = origin?.operation === 'manual';
    return {
      id,
      flow: held.flow,
      bundle: held.bundle,
      method: manual ? 'manual' : method.id,
      methodVersion: manual ? 1 : method.version,
      seed: String((origin?.json as { seed?: string })?.seed ?? ''),
      parentId: origin?.parent ?? null,
      operation: origin?.operation ?? 'unknown',
      generation: origin?.generation ?? 0,
      cohort: String((origin?.json as { cohort?: string })?.cohort ?? `family:${id}`),
    };
  };

  const materialize = (
    side: EncounterSideDraft,
    dealSeed: string,
  ): string | null => {
    if (side.kind === 'existing') {
      return store.origin(side.candidateId, experimentId) && store.candidate(side.candidateId)
        ? side.candidateId
        : null;
    }
    const draft = side.candidate;
    if (!compiles(draft)) return null;
    const id = sha(canonicalCandidate(draft.flow, draft.bundle));
    store.addCandidate({
      id,
      flow: draft.flow,
      bundle: draft.bundle,
      generatorVersion: `${method.id}@${method.version}`,
    });
    if (!store.origin(id, experimentId)) {
      store.addOrigin({
        candidateId: id,
        experimentId,
        parent: draft.parents[0],
        operation: draft.operation,
        operationJson: {
          seed: dealSeed,
          cohort: draft.cohort ?? `family:${id}`,
          ...(draft.operationData === undefined ? {} : { detail: draft.operationData }),
        },
        generation: draft.generation ?? (draft.parents.length > 0 ? 1 : 0),
      });
    }
    return id;
  };

  const persist = (
    draft: LabEncounterDraft,
    dealSeed: string,
    roomSeed: string,
    priority = false,
  ): number | null => {
    const leftId = materialize(draft.left, `${dealSeed}:left`);
    const rightId = materialize(draft.right, `${dealSeed}:right`);
    if (!leftId || !rightId || leftId === rightId) return null;
    const repeated = store.encounterEvidence(experimentId).some(
      (encounter) =>
        encounter.phase === draft.phase &&
        encounter.anchorId === draft.anchorId &&
        ((encounter.leftId === leftId && encounter.rightId === rightId) ||
          (encounter.leftId === rightId && encounter.rightId === leftId)),
    );
    if (repeated) return null;
    return store.addEncounter({
      experimentId,
      phase: draft.phase,
      anchorId: draft.anchorId,
      leftId,
      rightId,
      room: dealRoom(roomSeed),
      depth: draft.depth,
      priority,
    });
  };

  const deal = (): number | null => {
    const counts = store.searchCounts(experimentId);
    for (let attempt = 0; attempt < 12; attempt++) {
      const at = counts.comparisons + counts.skipped + counts.pending + attempt;
      const dealSeed = `${seed}:encounter:${at}`;
      const draft = method.next(state, evidence(), seeded(dealSeed));
      if (!draft) continue;
      const id = persist(draft, dealSeed, `${seed}:room:${at}`);
      if (id !== null) return id;
    }
    return null;
  };

  const advanceFinals = (run: StoredFinalsRun): void => {
    if (run.status === 'complete' || store.nextFinalsEncounter(run.id)) return;
    const nominees = store.finalsNominees(run.id, experimentId);
    const facts = store.finalsEvidence(run.id);
    const pair = nextFinalsPair(
      nominees,
      facts,
      run.rooms.length,
      seeded(`${seed}:finals:${run.id}:${facts.length}`),
    );
    if (!pair) {
      store.completeFinals(run.id);
      return;
    }
    const room = run.rooms[pair.roomIndex];
    if (!room) {
      finalsNotice = 'the Finals room deck is incomplete';
      return;
    }
    store.addFinalsEncounter({
      runId: run.id,
      leftId: pair.leftId,
      rightId: pair.rightId,
      roomIndex: pair.roomIndex,
      room: room.room,
    });
  };

  const createFinals = (): StoredFinalsRun | null => {
    const kept = store.archiveDecisions(experimentId)
      .filter((decision) => decision.verdict === 'keep')
      .map((decision) => decision.candidateId);
    const lineage = store.lineageFinalists(experimentId).map((held) => held.candidateId);
    const protectedIds = [...new Set([...lineage, ...kept])];
    const nominees = nominateFinalists(evidence(), undefined, protectedIds);
    if (nominees.length < 4) {
      finalsNotice = 'Finals needs at least four accepted or kept works';
      return null;
    }
    if (nominees.length % 2 === 1) {
      finalsNotice = 'Finals needs one more staged work to pair every protected work';
      return null;
    }
    store.createFinalsRun({
      experimentId,
      targetCount: Math.min(FINALS_WINNERS, nominees.length),
      rooms: finalsRooms(`${seed}:edition:${(store.finalsRun(experimentId)?.id ?? 0) + 1}`),
      nominees,
    });
    return store.finalsRun(experimentId);
  };

  const ensureFinals = (): StoredFinalsRun | null => {
    let run = store.finalsRun(experimentId);
    if (!run) run = createFinals();
    if (run) advanceFinals(run);
    return store.finalsRun(experimentId);
  };

  /**
   * Explore's whole loop: keep exactly one unjudged seed staged.
   *
   * One at a time on purpose. A queue of them would be a queue of pictures
   * nobody has looked at, which is the pairing problem again in a different
   * shape — work generated ahead of the attention that justifies it. The
   * database opens when Train is opened and deals one root; closing the tab
   * leaves exactly one seed pending and nothing running.
   */
  const advanceExplore = (): void => {
    if (store.nextSeedEncounter(experimentId)) return;
    const counts = store.seedCounts(experimentId);
    for (let attempt = 0; attempt < 12; attempt++) {
      const at = counts.seen + counts.skipped + attempt;
      const dealSeed = `${seed}:seed:${at}`;
      const draft = seedDraft(seeded(dealSeed));
      const id = materialize({ kind: 'draft', candidate: draft }, dealSeed);
      // A root already judged is not a question. Two seeds producing one graph
      // is rare but not impossible, and asking again would put a duplicate
      // answer in the corpus about a picture that already has one.
      if (!id || store.seedSeen(experimentId, id)) continue;
      store.addSeedEncounter({
        experimentId,
        candidateId: id,
        room: dealRoom(`${seed}:seed-room:${at}`),
      });
      return;
    }
    exploreNotice = 'the dealer could not make a fresh root that compiles';
  };

  const exploreState = (): LabExploreState => {
    const held = store.nextSeedEncounter(experimentId);
    const candidate = held ? asCandidate(held.candidateId) : null;
    const counts = store.seedCounts(experimentId);
    return {
      encounter:
        held && candidate ? { id: held.id, candidate, room: held.room } : null,
      seen: counts.seen,
      admitted: counts.admitted,
      declined: counts.declined,
      skipped: counts.skipped,
      notice: exploreNotice,
    };
  };

  /** Keep one match staged in the open batch, and close it when every round is answered. */
  const advanceBatch = (batch: StoredBatch): void => {
    if (batch.status !== 'judging' || store.nextBatchEncounter(batch.id)) return;
    const entrants = store.batchEntrants(batch.id);
    const facts = store.batchEvidence(batch.id);
    const pair = nextBatchPair(
      entrants,
      facts,
      batch.rounds,
      seeded(`${seed}:batch:${batch.id}:${facts.length}`),
    );
    if (!pair) {
      store.completeBatch(batch.id);
      return;
    }
    store.addBatchEncounter({
      batchId: batch.id,
      leftId: pair.leftId,
      rightId: pair.rightId,
      round: pair.round,
    });
  };

  const developState = (): LabDevelopState | null => {
    // No batch is not an error state with an empty batch in it. A refusal to
    // deal one belongs on the shared notice, where the forest can say it.
    const batch = store.openBatch(experimentId);
    if (!batch) return null;
    const parent = asCandidate(batch.parentId);
    if (!parent) return null;
    const entrants = store.batchEntrants(batch.id);
    const facts = store.batchEvidence(batch.id);
    const standing = rankBatch(entrants, facts);
    const standings = standing.flatMap((row, rank) => {
      const candidate = asCandidate(row.candidateId);
      return candidate
        ? [{
            rank: rank + 1,
            candidate,
            isParent: row.isParent,
            matches: row.matches,
            preference: row.preference,
            score: row.score,
            uncertainty: row.uncertainty,
          }]
        : [];
    });
    const held = store.nextBatchEncounter(batch.id);
    const left = held ? asCandidate(held.leftId) : null;
    const right = held ? asCandidate(held.rightId) : null;
    const answered = facts.filter((fact) => fact.disposition === 'compared').length;
    const leader = standings[0];
    return {
      batchId: batch.id,
      parent,
      room: batch.room,
      status: batch.status === 'judging' && held ? 'judging' : 'complete',
      size: entrants.length,
      compared: answered,
      total: (entrants.length * batch.rounds) / 2,
      encounter:
        held && left && right
          ? {
              id: held.id,
              left,
              right,
              round: held.round,
              rounds: batch.rounds,
            }
          : null,
      standings,
      // The result the old Refine phase could not state: a leader that is the
      // parent says this node is already at its local peak, and that is worth
      // knowing before another batch is spent on it.
      improved: !!leader && !leader.isParent && leader.matches > 0,
      notice: developNotice,
    };
  };

  const archiveState = (): LabArchiveState => {
    const candidates = store.archiveCandidates(experimentId);
    const decisions = store.archiveDecisions(experimentId);
    const search = evidence();
    const latest = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
    const focused = archiveFocus && candidateIds.has(archiveFocus)
      ? candidates.find((candidate) => candidate.candidateId === archiveFocus) ?? null
      : null;
    const next = candidates.find((candidate) => {
      const decision = latest.get(candidate.candidateId);
      return !decision || decision.verdict === 'clear';
    }) ?? null;
    const current = focused ?? next;
    const keptCandidateIds = decisions
      .filter((decision) => decision.verdict === 'keep')
      .map((decision) => decision.candidateId);
    const kept = new Set(keptCandidateIds);
    const finalists = new Set(
      store.lineageFinalists(experimentId).map((held) => held.candidateId),
    );
    const finalsCounts = new Map<string, number>();
    for (const id of store.finalsNominations(experimentId)) {
      finalsCounts.set(id, (finalsCounts.get(id) ?? 0) + 1);
    }
    const appearances = new Map<string, number>();
    const chosen = new Map<string, number>();
    for (const comparison of search.comparisons) {
      appearances.set(comparison.leftId, (appearances.get(comparison.leftId) ?? 0) + 1);
      appearances.set(comparison.rightId, (appearances.get(comparison.rightId) ?? 0) + 1);
      if (!comparison.choice) continue;
      if (comparison.choice === 'left' || comparison.choice === 'both') {
        chosen.set(comparison.leftId, (chosen.get(comparison.leftId) ?? 0) + 1);
      }
      if (comparison.choice === 'right' || comparison.choice === 'both') {
        chosen.set(comparison.rightId, (chosen.get(comparison.rightId) ?? 0) + 1);
      }
    }
    const byId = new Map(search.candidates.map((candidate) => [candidate.id, candidate]));
    const batches = store.batchCounts(experimentId);
    // A batch match is an appearance too, so a child developed under the new
    // shape accumulates the same evidence a paired one used to. Without this
    // the forest would rank every recent work as never having been looked at.
    for (const fact of store.batchAppearances(experimentId)) {
      appearances.set(fact.candidateId, (appearances.get(fact.candidateId) ?? 0) + fact.appearances);
      chosen.set(fact.candidateId, (chosen.get(fact.candidateId) ?? 0) + fact.chosen);
    }
    // Who led each batch that ran to the end. Derived from the answers every
    // time, like every other standing in here, and never written down: a
    // stored winner is a score, and the day the ranking changes it becomes a
    // claim about a judgment nobody made.
    const wins = new Map<string, number>();
    for (const batch of store.settledBatches(experimentId)) {
      const top = rankBatch(batch.entrants, batch.evidence)[0];
      // A batch closed without a single answer has a leader by entry order
      // alone, which is not a thing anybody decided.
      if (top && top.matches > 0) wins.set(top.candidateId, (wins.get(top.candidateId) ?? 0) + 1);
    }
    const childCounts = new Map<string, number>();
    for (const candidate of search.candidates) {
      if (!candidate.parentId) continue;
      childCounts.set(candidate.parentId, (childCounts.get(candidate.parentId) ?? 0) + 1);
    }
    const nodes = candidates.flatMap((candidate) => {
      const held = byId.get(candidate.candidateId);
      return held ? [{
        id: held.id,
        name: held.flow.name,
        parentId: held.parentId,
        generation: held.generation,
        cohort: held.cohort,
        operation: held.operation,
        appearances: appearances.get(held.id) ?? 0,
        chosen: chosen.get(held.id) ?? 0,
        finals: finalsCounts.get(held.id) ?? 0,
        reviewed: latest.get(held.id)?.verdict === 'keep' || latest.get(held.id)?.verdict === 'pass',
        bookmarked: kept.has(held.id) || finalists.has(held.id),
        batches: batches.get(held.id) ?? 0,
        wins: wins.get(held.id) ?? 0,
        children: childCounts.get(held.id) ?? 0,
      }] : [];
    });
    const reviewed = candidates.filter((candidate) => {
      const verdict = latest.get(candidate.candidateId)?.verdict;
      return verdict === 'keep' || verdict === 'pass';
    }).length;
    return {
      nodes,
      candidate: current ? asCandidate(current.candidateId) : null,
      room: current?.room ?? null,
      reviewed,
      total: candidates.length,
      kept: keptCandidateIds.length,
      keptCandidateIds,
      complete: candidates.length > 0 && current === null,
      notice:
        archiveNotice ??
        (candidates.length === 0
          ? 'The forest fills as Explore admits roots and batches stage their children'
          : null),
    };
  };

  const finalsState = (): LabFinalsState | null => {
    const run = store.finalsRun(experimentId);
    if (!run) return null;
    const nominees = store.finalsNominees(run.id, experimentId);
    const facts = store.finalsEvidence(run.id);
    const standing = rankFinalists(nominees, facts);
    const leaders = standing.slice(0, run.targetCount).flatMap((row, rank) => {
      const candidate = asCandidate(row.candidateId);
      return candidate
        ? [{
            rank: rank + 1,
            candidate,
            matches: row.matches,
            showReady: row.showReady,
            preference: row.preference,
            score: row.score,
            uncertainty: row.uncertainty,
          }]
        : [];
    });
    const held = store.nextFinalsEncounter(run.id);
    const left = held ? asCandidate(held.leftId) : null;
    const right = held ? asCandidate(held.rightId) : null;
    const room = held ? run.rooms[held.roomIndex] : null;
    return {
      runId: run.id,
      status: run.status,
      nominees: nominees.length,
      compared: facts.filter((fact) => fact.disposition === 'compared').length,
      total: (nominees.length * run.rooms.length) / 2,
      encounter:
        held && left && right && room
          ? {
              id: held.id,
              left,
              right,
              room: held.room,
              roomIndex: held.roomIndex,
              roomName: room.name,
            }
          : null,
      leaders,
      notice: finalsNotice,
    };
  };

  const labState = (): LabState => {
    const held = store.nextEncounter(experimentId);
    let encounter: LabEncounter | null = null;
    if (held) {
      const left = asCandidate(held.leftId);
      const right = asCandidate(held.rightId);
      if (left && right) {
        encounter = {
          id: held.id,
          phase: held.phase,
          anchorId: held.anchorId,
          left,
          right,
          room: held.room,
          depth: held.depth,
        };
      }
    }
    const old = store.counts(experimentId);
    const search = store.searchCounts(experimentId);
    const summary = method.summarize(evidence());
    return {
      encounter,
      explore: exploreState(),
      develop: developState(),
      archive: archiveState(),
      finals: finalsState(),
      candidate: null,
      room: null,
      method: method.id,
      liked: old.liked,
      rejected: old.rejected,
      reviewed: old.reviewed,
      skipped: search.skipped,
      pending: search.pending,
      comparisons: search.comparisons,
      explores: search.explores,
      refines: search.refines,
      frontier: summary.frontier,
      maxGeneration: summary.maxGeneration,
      notice,
    };
  };

  const advance = () => {
    if (!store.nextEncounter(experimentId) && deal() === null) {
      notice = 'the search could not make a distinct pair that compiles';
    }
  };

  return {
    open() {
      notice = null;
      advance();
      return labState();
    },
    compare(comparison) {
      const active = store.nextEncounter(experimentId);
      if (!active || active.id !== comparison.encounterId) {
        notice = 'that comparison is no longer the one on screen';
        return labState();
      }
      const answer = store.compare(comparison, { experimentId, rendererVersion: RENDERER });
      if (!answer.ok) {
        notice = answer.problem;
        return labState();
      }
      notice = null;
      if (active) {
        state = method.observe(state, [{ phase: active.phase, choice: comparison.choice }]);
      }
      advance();
      return labState();
    },
    skipEncounter(encounterId) {
      const active = store.nextEncounter(experimentId);
      if (!active || active.id !== encounterId) {
        notice = 'that comparison is no longer the one on screen';
        return labState();
      }
      notice = null;
      store.skipEncounter(encounterId, experimentId);
      advance();
      return labState();
    },
    archiveOpen() {
      archiveNotice = null;
      return labState();
    },
    archiveSelect(candidateId) {
      archiveNotice = null;
      if (!store.archiveCandidates(experimentId).some((held) => held.candidateId === candidateId)) {
        archiveNotice = 'that work is not in this lineage map';
        return labState();
      }
      archiveFocus = candidateId;
      return labState();
    },
    archiveDecide(decision) {
      archiveNotice = null;
      let room: LabRoom | null = null;
      if (decision.source === 'search') {
        const active = store.nextEncounter(experimentId);
        if (
          active &&
          (active.leftId === decision.candidateId || active.rightId === decision.candidateId)
        ) {
          room = active.room;
        }
      } else {
        const archive = archiveState();
        if (archive.candidate?.id === decision.candidateId) room = archive.room;
      }
      if (!room) {
        archiveNotice = 'that work is no longer the one being preserved';
        return labState();
      }
      const answer = store.archiveDecide(decision, { experimentId, room });
      if (!answer.ok) archiveNotice = answer.problem;
      // A map focus stays put so keep can be followed by "make lineage
      // finalist". With no focus, the latest decision naturally advances the
      // derived chronological candidate.
      return labState();
    },
    lineageFinalist(decision) {
      archiveNotice = null;
      const archive = archiveState();
      if (archive.candidate?.id !== decision.candidateId) {
        archiveNotice = 'select that work in the lineage map first';
        return labState();
      }
      const answer = store.lineageFinalist(decision, experimentId);
      if (!answer.ok) archiveNotice = answer.problem;
      return labState();
    },
    exploreOpen() {
      exploreNotice = null;
      advanceExplore();
      return labState();
    },
    exploreJudge(submission) {
      exploreNotice = null;
      const active = store.nextSeedEncounter(experimentId);
      if (!active || active.id !== submission.encounterId) {
        exploreNotice = 'that seed is no longer the one on screen';
        return labState();
      }
      const answer = store.judgeSeed(submission, {
        experimentId,
        rendererVersion: RENDERER,
      });
      if (!answer.ok) {
        exploreNotice = answer.problem;
        return labState();
      }
      // Admitting a root bookmarks it, because "yes, worth developing" and
      // "come back to this" are the same intention said once. Declining marks
      // nothing: a no is not a judgment worth carrying around, only a seed not
      // taken, and the work stays in the forest where it can be reconsidered.
      if (submission.verdict === 'yes') {
        store.archiveDecide(
          { candidateId: active.candidateId, verdict: 'keep', source: 'search' },
          { experimentId, room: active.room },
        );
      }
      advanceExplore();
      return labState();
    },
    exploreSkip(encounterId) {
      exploreNotice = null;
      const active = store.nextSeedEncounter(experimentId);
      if (!active || active.id !== encounterId) {
        exploreNotice = 'that seed is no longer the one on screen';
        return labState();
      }
      store.skipSeedEncounter(encounterId, experimentId);
      advanceExplore();
      return labState();
    },
    bookmark(decision) {
      archiveNotice = null;
      // Any work in the corpus, from wherever it is being looked at. A bookmark
      // is navigation, so requiring it to be the staged one — as keep did —
      // made the forest's own marks depend on what the queue happened to be
      // showing.
      const held = store
        .archiveCandidates(experimentId)
        .find((candidate) => candidate.candidateId === decision.candidateId);
      if (!held) {
        archiveNotice = 'that work is not in this lineage forest';
        return labState();
      }
      const answer = store.archiveDecide(
        {
          candidateId: decision.candidateId,
          verdict: decision.marked ? 'keep' : 'pass',
          source: 'archive',
        },
        { experimentId, room: held.room },
      );
      if (!answer.ok) archiveNotice = answer.problem;
      return labState();
    },
    developOpen(candidateId) {
      developNotice = null;
      archiveNotice = null;
      if (!store.archiveCandidates(experimentId).some((held) => held.candidateId === candidateId)) {
        archiveNotice = 'that work is not in this lineage forest';
        return labState();
      }
      archiveFocus = candidateId;
      return labState();
    },
    developDeal(request) {
      developNotice = null;
      notice = null;
      const open = store.openBatch(experimentId);
      if (open) {
        notice =
          open.status === 'complete'
            ? 'read the finished batch and close it before dealing another'
            : 'finish or discard the open batch before dealing another';
        return labState();
      }
      if (!BATCH_SIZES.includes(request.size)) {
        notice = `a batch is ${BATCH_SIZES.join(', ')} works including the parent`;
        return labState();
      }
      const parent = evidence().candidates.find(
        (candidate) => candidate.id === request.candidateId,
      );
      if (!parent) {
        notice = 'that work is not in this lineage forest';
        return labState();
      }
      const at = store.batchCounts(experimentId).get(parent.id) ?? 0;
      const dealSeed = `${seed}:batch:${parent.id}:${at}`;
      const drafts = batchDrafts(parent, request.size - 1, seeded(dealSeed));
      const entrants: { candidateId: string; isParent: boolean }[] = [
        { candidateId: parent.id, isParent: true },
      ];
      drafts.forEach((draft, index) => {
        const id = materialize({ kind: 'draft', candidate: draft }, `${dealSeed}:${index}`);
        if (id && !entrants.some((entrant) => entrant.candidateId === id)) {
          entrants.push({ candidateId: id, isParent: false });
        }
      });
      // A round is a perfect matching, so an odd field would leave somebody
      // unjudged in every round. Dropping the last child is honest where
      // manufacturing a bye would put a free win in the standings.
      if (entrants.length % 2 === 1) entrants.pop();
      if (entrants.length < 4) {
        notice = 'the dealer could not make enough distinct children for a batch';
        return labState();
      }
      const batchId = store.createBatch({
        experimentId,
        parentId: parent.id,
        // One room for the whole batch. Different rooms would make a child look
        // better for a reason that has nothing to do with the edit that made it.
        room: dealRoom(`${dealSeed}:room`),
        rounds: BATCH_ROUNDS,
        entrants,
      });
      const batch = store.openBatch(experimentId);
      if (batch && batch.id === batchId) advanceBatch(batch);
      archiveFocus = parent.id;
      return labState();
    },
    developCompare(comparison) {
      developNotice = null;
      const batch = store.openBatch(experimentId);
      const active = batch ? store.nextBatchEncounter(batch.id) : null;
      if (!batch || !active || active.id !== comparison.encounterId) {
        developNotice = 'that match is no longer the one on screen';
        return labState();
      }
      const answer = store.batchCompare(comparison, {
        batchId: batch.id,
        rendererVersion: RENDERER,
        // The room the person says they answered under, and the batch's when
        // they say nothing. Never read back off the client as the batch's own
        // room: that one is the field's control and only the dealer sets it.
        room: comparison.room ?? batch.room,
      });
      if (!answer.ok) {
        developNotice = answer.problem;
        return labState();
      }
      advanceBatch(batch);
      return labState();
    },
    developSkip(encounterId) {
      developNotice = null;
      const batch = store.openBatch(experimentId);
      const active = batch ? store.nextBatchEncounter(batch.id) : null;
      if (!batch || !active || active.id !== encounterId) {
        developNotice = 'that match is no longer the one on screen';
        return labState();
      }
      store.skipBatchEncounter(encounterId, batch.id);
      advanceBatch(batch);
      return labState();
    },
    developClose() {
      developNotice = null;
      const batch = store.openBatch(experimentId);
      if (!batch) return labState();
      // Leaving a finished batch is reading its result; leaving an unfinished
      // one is walking away from it. The store keeps those apart.
      if (batch.status === 'complete') store.closeBatch(batch.id);
      else store.abandonBatch(batch.id);
      return labState();
    },
    finalsOpen() {
      finalsNotice = null;
      ensureFinals();
      return labState();
    },
    finalsNew() {
      finalsNotice = null;
      const current = store.finalsRun(experimentId);
      if (current?.status === 'judging') {
        finalsNotice = 'finish the current Finals before starting another edition';
        return labState();
      }
      const run = createFinals();
      if (run) advanceFinals(run);
      return labState();
    },
    finalsCompare(comparison) {
      finalsNotice = null;
      const run = ensureFinals();
      const active = run ? store.nextFinalsEncounter(run.id) : null;
      if (!run || !active || active.id !== comparison.encounterId) {
        finalsNotice = 'that Finals match is no longer the one on screen';
        return labState();
      }
      const answer = store.finalsCompare(comparison, {
        runId: run.id,
        rendererVersion: RENDERER,
      });
      if (!answer.ok) {
        finalsNotice = answer.problem;
        return labState();
      }
      advanceFinals(run);
      return labState();
    },
    finalsSkip(encounterId) {
      finalsNotice = null;
      const run = ensureFinals();
      const active = run ? store.nextFinalsEncounter(run.id) : null;
      if (!run || !active || active.id !== encounterId) {
        finalsNotice = 'that Finals match is no longer the one on screen';
        return labState();
      }
      store.skipFinalsEncounter(encounterId, run.id);
      advanceFinals(run);
      return labState();
    },
    select() {
      notice = 'Train now records explicit comparisons rather than single-candidate votes';
      return labState();
    },
    submit(review) {
      const answer = store.submit(review, { experimentId, rendererVersion: RENDERER });
      notice = answer.ok ? null : answer.problem;
      return labState();
    },
    skip() {
      notice = 'Train now skips a whole comparison rather than one side';
      return labState();
    },
    offer(flow, bundle) {
      if (!compiles({ flow, bundle })) {
        notice = 'that flow does not compile';
        return labState();
      }
      notice = null;
      const id = sha(canonicalCandidate(flow, bundle));
      store.addCandidate({ id, flow, bundle, generatorVersion: 'manual@1' });
      if (!store.origin(id, experimentId)) {
        store.addOrigin({
          candidateId: id,
          experimentId,
          operation: 'manual',
          operationJson: { cohort: `family:${id}` },
        });
      }
      if (!store.focusEncounter(id, experimentId)) {
        const held = evidence().candidates.find((candidate) => candidate.id === id);
        const at = store.searchCounts(experimentId);
        const dealSeed = `${seed}:manual:${at.comparisons + at.skipped + at.pending}`;
        const draft = held ? method.around?.(held, evidence(), seeded(dealSeed)) : null;
        if (draft) persist(draft, dealSeed, `${dealSeed}:room`, true);
      }
      if (!store.nextEncounter(experimentId)) advance();
      return labState();
    },
    log: (before) => store.reviewLog(50, before),
    rescore: (reviewId, score) => store.rescore(reviewId, score),
    retag: (reviewId, tags) => store.retag(reviewId, tags),
    renote: (reviewId, note) => store.renote(reviewId, note),
    candidate: (id) => store.candidate(id),
    close: () => store.close(),
  };
}
