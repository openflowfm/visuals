import type { DatabaseSync as Database } from 'node:sqlite';

// Kept behind the same boundary as the lab: Vitest's transformer otherwise
// tries to resolve `node:sqlite` as an npm package.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

import type {
  CalibrationDecisionRow,
  CalibrationState,
  CalibrationSubmission,
  CalibrationTrial,
} from '../protocol.ts';
import { CALIBRATION_RENDERER_VERSION, calibrationProblems } from '../calibration.ts';
import { scaleResponse, type ParameterResponse } from '../response.ts';

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE trials (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    batch TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    question TEXT NOT NULL,
    target_json TEXT NOT NULL,
    flow_json TEXT NOT NULL,
    room_json TEXT NOT NULL,
    initial_value REAL NOT NULL,
    renderer_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id, version)
  );
  CREATE TABLE options (
    trial_id TEXT NOT NULL,
    trial_version INTEGER NOT NULL,
    id TEXT NOT NULL,
    position INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    PRIMARY KEY (trial_id, trial_version, id),
    UNIQUE (trial_id, trial_version, position),
    FOREIGN KEY (trial_id, trial_version) REFERENCES trials(id, version)
  );
  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    trial_id TEXT NOT NULL,
    trial_version INTEGER NOT NULL,
    selected_option_id TEXT,
    response_json TEXT,
    extent REAL NOT NULL,
    room_json TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (trial_id, trial_version),
    FOREIGN KEY (trial_id, trial_version) REFERENCES trials(id, version),
    CHECK (
      (selected_option_id IS NULL AND response_json IS NULL) OR
      (selected_option_id IS NOT NULL AND response_json IS NOT NULL)
    )
  );
  CREATE INDEX trials_queue ON trials (active, ordinal);
  CREATE INDEX decisions_recent ON decisions (id DESC);
  `,
  `
  ALTER TABLE decisions RENAME TO decisions_once;
  DROP INDEX decisions_recent;
  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    trial_id TEXT NOT NULL,
    trial_version INTEGER NOT NULL,
    selected_option_id TEXT,
    response_json TEXT,
    extent REAL NOT NULL,
    room_json TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (trial_id, trial_version) REFERENCES trials(id, version),
    CHECK (
      (selected_option_id IS NULL AND response_json IS NULL) OR
      (selected_option_id IS NOT NULL AND response_json IS NOT NULL)
    )
  );
  INSERT INTO decisions (
    id, trial_id, trial_version, selected_option_id, response_json,
    extent, room_json, note, created_at
  ) SELECT
    id, trial_id, trial_version, selected_option_id, response_json,
    extent, room_json, note, created_at
  FROM decisions_once;
  DROP TABLE decisions_once;
  CREATE INDEX decisions_recent ON decisions (id DESC);
  CREATE INDEX decisions_by_trial ON decisions (trial_id, trial_version, id DESC);
  `,
];

const now = () => new Date().toISOString();

interface TrialRow {
  id: string;
  version: number;
  batch: string;
  name: string;
  question: string;
  target_json: string;
  flow_json: string;
  room_json: string;
  initial_value: number;
  ordinal?: number;
}

interface OptionRow {
  id: string;
  response_json: string;
}

interface DecisionDbRow {
  id: number;
  trial_id: string;
  trial_version: number;
  selected_option_id: string | null;
  response_json: string | null;
  extent: number;
  room_json: string;
  note: string | null;
  created_at: string;
  name: string;
  target_json: string;
}

export interface CalibrationStore {
  state(selection?: { trialId: string; trialVersion: number }): CalibrationState;
  decide(submission: CalibrationSubmission): CalibrationState;
  exportJsonl(): string;
  close(): void;
}

export function openCalibration(
  file: string,
  manifest: readonly CalibrationTrial[],
): CalibrationStore {
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
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const insertTrial = db.prepare(
    `INSERT INTO trials (
       id, version, batch, ordinal, active, name, question, target_json,
       flow_json, room_json, initial_value, renderer_version, created_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, version) DO UPDATE SET active = 1, ordinal = excluded.ordinal`,
  );
  const insertOption = db.prepare(
    `INSERT OR IGNORE INTO options (
       trial_id, trial_version, id, position, response_json
     ) VALUES (?, ?, ?, ?, ?)`,
  );

  transaction(() => {
    db.exec('UPDATE trials SET active = 0');
    manifest.forEach((trial, ordinal) => {
      insertTrial.run(
        trial.id,
        trial.version,
        trial.batch,
        ordinal,
        trial.name,
        trial.question,
        JSON.stringify(trial.target),
        JSON.stringify(trial.flow),
        JSON.stringify(trial.room),
        trial.initialValue,
        `pipeline@${CALIBRATION_RENDERER_VERSION}`,
        now(),
      );
      trial.options.forEach((option, position) => {
        insertOption.run(
          trial.id,
          trial.version,
          option.id,
          position,
          JSON.stringify(option.response),
        );
      });
    });
  });

  let notice: string | null = null;

  const trialFrom = (row: TrialRow): CalibrationTrial => {
    const options = db
      .prepare(
        `SELECT id, response_json FROM options
         WHERE trial_id = ? AND trial_version = ? ORDER BY position`,
      )
      .all(row.id, row.version) as unknown as OptionRow[];
    return {
      id: row.id,
      version: row.version,
      batch: row.batch,
      name: row.name,
      question: row.question,
      target: JSON.parse(row.target_json) as CalibrationTrial['target'],
      flow: JSON.parse(row.flow_json) as CalibrationTrial['flow'],
      room: JSON.parse(row.room_json) as CalibrationTrial['room'],
      initialValue: row.initial_value,
      options: options.map((option) => ({
        id: option.id,
        response: JSON.parse(option.response_json) as CalibrationTrial['options'][number]['response'],
      })),
    };
  };

  const trialColumns = `t.id, t.version, t.batch, t.ordinal, t.name, t.question,
                        t.target_json, t.flow_json, t.room_json, t.initial_value`;

  const trialRow = (
    selection?: { trialId: string; trialVersion: number },
    afterOrdinal?: number,
  ): TrialRow | undefined => {
    if (selection) {
      const selected = db
        .prepare(
          `SELECT ${trialColumns} FROM trials t
           WHERE t.active = 1 AND t.id = ? AND t.version = ?`,
        )
        .get(selection.trialId, selection.trialVersion) as TrialRow | undefined;
      if (selected) return selected;
      notice = 'that calibration parameter is no longer active';
    }

    const pending = db
      .prepare(
        `SELECT ${trialColumns} FROM trials t
         WHERE t.active = 1
           AND NOT EXISTS (
             SELECT 1 FROM decisions d
             WHERE d.trial_id = t.id AND d.trial_version = t.version
           )
         ORDER BY CASE WHEN t.ordinal > ? THEN 0 ELSE 1 END, t.ordinal
         LIMIT 1`,
      )
      .get(afterOrdinal ?? -1) as TrialRow | undefined;
    if (pending) return pending;

    // A complete matrix stays browsable instead of becoming a dead-end page.
    return db
      .prepare(`SELECT ${trialColumns} FROM trials t WHERE t.active = 1 ORDER BY t.ordinal LIMIT 1`)
      .get() as TrialRow | undefined;
  };

  const decisionFrom = (row: DecisionDbRow): CalibrationDecisionRow => ({
    id: row.id,
    trialId: row.trial_id,
    trialVersion: row.trial_version,
    name: row.name,
    target: JSON.parse(row.target_json) as CalibrationDecisionRow['target'],
    room: JSON.parse(row.room_json) as CalibrationDecisionRow['room'],
    selectedOptionId: row.selected_option_id,
    response: row.response_json
      ? (JSON.parse(row.response_json) as CalibrationDecisionRow['response'])
      : null,
    extent: row.extent,
    note: row.note,
    createdAt: row.created_at,
  });

  const history = (): CalibrationDecisionRow[] => {
    const rows = db
      .prepare(
        `SELECT d.id, d.trial_id, d.trial_version, d.selected_option_id,
                d.response_json, d.extent, d.room_json, d.note, d.created_at,
                t.name, t.target_json
         FROM decisions d JOIN trials t
           ON t.id = d.trial_id AND t.version = d.trial_version
         WHERE d.id = (
           SELECT MAX(latest.id) FROM decisions latest
           WHERE latest.trial_id = d.trial_id AND latest.trial_version = d.trial_version
         )
         ORDER BY d.id DESC LIMIT 100`,
      )
      .all() as unknown as DecisionDbRow[];
    return rows.map(decisionFrom);
  };

  const decisionFor = (trial: CalibrationTrial | null): CalibrationDecisionRow | null => {
    if (!trial) return null;
    const row = db
      .prepare(
        `SELECT d.id, d.trial_id, d.trial_version, d.selected_option_id,
                d.response_json, d.extent, d.room_json, d.note, d.created_at,
                t.name, t.target_json
         FROM decisions d JOIN trials t
           ON t.id = d.trial_id AND t.version = d.trial_version
         WHERE d.trial_id = ? AND d.trial_version = ?
         ORDER BY d.id DESC LIMIT 1`,
      )
      .get(trial.id, trial.version) as DecisionDbRow | undefined;
    return row ? decisionFrom(row) : null;
  };

  const catalog = (): CalibrationState['trials'] => {
    const rows = db
      .prepare(
        `SELECT t.id, t.version, t.batch, t.ordinal, t.name, t.target_json,
                EXISTS(
                  SELECT 1 FROM decisions d
                  WHERE d.trial_id = t.id AND d.trial_version = t.version
                ) AS decided
         FROM trials t WHERE t.active = 1 ORDER BY t.ordinal`,
      )
      .all() as unknown as Array<{
      id: string;
      version: number;
      batch: string;
      ordinal: number;
      name: string;
      target_json: string;
      decided: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      batch: row.batch,
      name: row.name,
      target: JSON.parse(row.target_json) as CalibrationState['trials'][number]['target'],
      ordinal: row.ordinal,
      decided: row.decided === 1,
    }));
  };

  const makeState = (
    selection?: { trialId: string; trialVersion: number },
    afterOrdinal?: number,
  ): CalibrationState => {
    const trials = catalog();
    const row = trialRow(selection, afterOrdinal);
    const trial = row ? trialFrom(row) : null;
    return {
      trial,
      decision: decisionFor(trial),
      trials,
      total: trials.length,
      decided: trials.filter((candidate) => candidate.decided).length,
      history: history(),
      notice,
    };
  };

  const state = (selection?: { trialId: string; trialVersion: number }): CalibrationState => {
    notice = null;
    return makeState(selection);
  };

  return {
    state,
    decide(submission) {
      const problems = calibrationProblems(submission);
      if (problems.length > 0) {
        notice = problems.join(' · ');
        return makeState({ trialId: submission.trialId, trialVersion: submission.trialVersion });
      }
      const current = db
        .prepare('SELECT active, ordinal FROM trials WHERE id = ? AND version = ?')
        .get(submission.trialId, submission.trialVersion) as
        | { active: number; ordinal: number }
        | undefined;
      if (!current || current.active !== 1) {
        notice = 'that calibration trial is no longer active';
        return makeState();
      }
      if (submission.selectedOptionId !== null) {
        const option = db
          .prepare(
            'SELECT response_json FROM options WHERE trial_id = ? AND trial_version = ? AND id = ?',
          )
          .get(submission.trialId, submission.trialVersion, submission.selectedOptionId) as
          | { response_json: string }
          | undefined;
        if (!option) {
          notice = 'that response was not offered in this trial';
          return makeState({ trialId: submission.trialId, trialVersion: submission.trialVersion });
        }
        const expected = scaleResponse(
          JSON.parse(option.response_json) as ParameterResponse,
          submission.extent,
        );
        if (JSON.stringify(submission.response) !== JSON.stringify(expected)) {
          notice = 'that adjusted response does not match the chosen option and maximum reach';
          return makeState({ trialId: submission.trialId, trialVersion: submission.trialVersion });
        }
      }
      db.prepare(
        `INSERT INTO decisions (
           trial_id, trial_version, selected_option_id, response_json, extent, room_json, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        submission.trialId,
        submission.trialVersion,
        submission.selectedOptionId,
        submission.response ? JSON.stringify(submission.response) : null,
        submission.extent,
        JSON.stringify(submission.room),
        submission.note?.trim() || null,
        now(),
      );
      notice = null;
      return makeState(undefined, current.ordinal);
    },
    exportJsonl() {
      const lines = [JSON.stringify({ t: 'calibration', v: 2 })];
      const dump = (type: string, sql: string) => {
        for (const row of db.prepare(sql).all()) {
          lines.push(JSON.stringify({ t: type, ...(row as Record<string, unknown>) }));
        }
      };
      dump('trial', 'SELECT * FROM trials ORDER BY id, version');
      dump('option', 'SELECT * FROM options ORDER BY trial_id, trial_version, position');
      dump('decision', 'SELECT * FROM decisions ORDER BY id');
      return `${lines.join('\n')}\n`;
    },
    close() {
      db.close();
    },
  };
}
