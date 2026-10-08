import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvalsToShow, readApprovals, saveVerdict } from './approvals.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-approvals-'));
  file = path.join(dir, 'compare', 'approvals.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const body = (id: string, verdict: 'approve' | 'reject' | null, note = '') => JSON.stringify({ id, verdict, note, score: 90 });

describe('approvals', () => {
  it('starts from none and saves a verdict', () => {
    expect(readApprovals(file)).toEqual({});
    const saved = saveVerdict(file, body('a.milk', 'approve'), new Date('2026-01-01T00:00:00Z'));
    expect(saved.status).toBe(200);
    expect(readApprovals(file)).toEqual({ 'a.milk': { verdict: 'approve', note: '', score: 90, at: '2026-01-01T00:00:00.000Z' } });
    expect(saveVerdict(file, body('a.milk', null)).status).toBe(200);
    expect(readApprovals(file)).toEqual({});
  });

  it('never writes over a file it cannot read', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const broken of ['{"a.milk": {"verdict": "approve"', '[1, 2]']) {
      fs.writeFileSync(file, broken);
      const saved = saveVerdict(file, body('b.milk', 'reject'));
      expect(saved.status).toBe(500);
      expect(saved.body).toContain(file);
      expect(fs.readFileSync(file, 'utf8')).toBe(broken);
      expect(() => readApprovals(file)).toThrow(/nothing is saved over it/);
      const warnings: string[] = [];
      expect(approvalsToShow(file, (m) => warnings.push(m))).toEqual({});
      expect(warnings).toHaveLength(1);
    }
  });

  it('refuses a malformed request without touching the file', () => {
    saveVerdict(file, body('a.milk', 'approve'));
    const before = fs.readFileSync(file, 'utf8');
    expect(saveVerdict(file, '{"id": 3}').status).toBe(400);
    expect(saveVerdict(file, 'not json').status).toBe(400);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});
