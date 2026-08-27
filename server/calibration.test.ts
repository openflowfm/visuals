import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CALIBRATION_TRIALS } from '../calibration.ts';
import type { CalibrationSubmission } from '../protocol.ts';
import { scaleResponse } from '../response.ts';
import { openCalibration, type CalibrationStore } from './calibration.ts';

const dirs: string[] = [];
const stores: CalibrationStore[] = [];

function open(): CalibrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-calibration-'));
  dirs.push(dir);
  const store = openCalibration(path.join(dir, 'calibration.sqlite3'), CALIBRATION_TRIALS);
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may already have closed it.
    }
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the calibration store', () => {
  it('seeds the source-controlled queue and advances after a decision', () => {
    const store = open();
    const first = store.state();
    expect(first.total).toBe(CALIBRATION_TRIALS.length);
    expect(first.decided).toBe(0);
    const trial = first.trial!;
    const option = trial.options[0]!;
    const decision: CalibrationSubmission = {
      trialId: trial.id,
      trialVersion: trial.version,
      room: trial.room,
      selectedOptionId: option.id,
      response: scaleResponse(option.response, 0.7),
      extent: 0.7,
      note: 'the middle finally has room',
    };
    const next = store.decide(decision);
    expect(next.decided).toBe(1);
    expect(next.trial?.id).not.toBe(trial.id);
    expect(next.history[0]).toMatchObject({
      trialId: trial.id,
      selectedOptionId: option.id,
      extent: 0.7,
      note: decision.note,
    });
  });

  it('opens any device parameter directly and keeps recalibration append-only', () => {
    const store = open();
    const wanted = CALIBRATION_TRIALS.at(-1)!;
    const selected = store.state({ trialId: wanted.id, trialVersion: wanted.version });
    expect(selected.trial?.id).toBe(wanted.id);
    expect(selected.trials).toHaveLength(CALIBRATION_TRIALS.length);
    const option = selected.trial!.options[0]!;
    const submission: CalibrationSubmission = {
      trialId: wanted.id,
      trialVersion: wanted.version,
      room: wanted.room,
      selectedOptionId: option.id,
      response: scaleResponse(option.response, 0.8),
      extent: 0.8,
    };
    store.decide(submission);
    const reopened = store.state({ trialId: wanted.id, trialVersion: wanted.version });
    expect(reopened.decision).toMatchObject({ selectedOptionId: option.id, extent: 0.8 });
    store.decide({ ...submission, extent: 0.9, response: scaleResponse(option.response, 0.9) });
    const revised = store.state({ trialId: wanted.id, trialVersion: wanted.version });
    expect(revised.decided).toBe(1);
    expect(revised.decision).toMatchObject({ selectedOptionId: option.id, extent: 0.9 });
    const decisions = store
      .exportJsonl()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((row) => row.t === 'decision' && row.trial_id === wanted.id);
    expect(decisions).toHaveLength(2);
  });

  it('keeps reject-all as a decision only when it has an explanation', () => {
    const store = open();
    const trial = store.state().trial!;
    const bare = store.decide({
      trialId: trial.id,
      trialVersion: trial.version,
      room: trial.room,
      selectedOptionId: null,
      response: null,
      extent: 1,
    });
    expect(bare.decided).toBe(0);
    expect(bare.notice).toContain('say why');
    const rejected = store.decide({
      trialId: trial.id,
      trialVersion: trial.version,
      room: trial.room,
      selectedOptionId: null,
      response: null,
      extent: 1,
      note: 'all three snap too quickly',
    });
    expect(rejected.decided).toBe(1);
    expect(rejected.history[0]?.selectedOptionId).toBeNull();
  });

  it('refuses a response that does not belong to the selected option and extent', () => {
    const store = open();
    const trial = store.state().trial!;
    const option = trial.options[0]!;
    const result = store.decide({
      trialId: trial.id,
      trialVersion: trial.version,
      room: trial.room,
      selectedOptionId: option.id,
      response: { ...option.response, exponent: 99 } as typeof option.response,
      extent: 1,
      note: 'forged',
    });
    expect(result.decided).toBe(0);
    expect(result.notice).toContain('does not match');
  });

  it('exports the frozen trial, offered responses, and judgment', () => {
    const store = open();
    const trial = store.state().trial!;
    store.decide({
      trialId: trial.id,
      trialVersion: trial.version,
      room: trial.room,
      selectedOptionId: null,
      response: null,
      extent: 1,
      note: 'try a piecewise response',
    });
    const records = store.exportJsonl().trim().split('\n').map((line) => JSON.parse(line));
    expect(records.some((row) => row.t === 'trial' && row.id === trial.id)).toBe(true);
    expect(records.filter((row) => row.t === 'option')).toHaveLength(CALIBRATION_TRIALS.length * 3);
    expect(records.some((row) => row.t === 'decision' && row.note === 'try a piecewise response')).toBe(true);
  });
});
