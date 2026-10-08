// Ryan's verdicts on the bench's presets (`~/.openflow/visuals/compare/approvals.json`):
// read, and saved from the report page. A file that exists but can't be read as
// verdicts is never written over: saving refuses, and says why.

import fs from 'node:fs';
import path from 'node:path';
import type { Approval } from './report.ts';

/**
 * The verdicts so far: none when the file doesn't exist. Throws when it exists
 * but can't be read as verdicts.
 */
export function readApprovals(file: string): Record<string, Approval> {
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message}); fix or move it, nothing is saved over it`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file} is not an object of verdicts; fix or move it, nothing is saved over it`);
  return parsed as Record<string, Approval>;
}

/** The verdicts for showing only: a broken file is warned about and shown as none. */
export function approvalsToShow(file: string, warn: (message: string) => void = (m) => console.error(m)): Record<string, Approval> {
  try {
    return readApprovals(file);
  } catch (error) {
    warn((error as Error).message);
    return {};
  }
}

function writeApprovals(file: string, all: Record<string, Approval>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(sorted, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * One verdict from the page (`{id, verdict, note, score}`; no verdict and no
 * note removes it), as an HTTP status and body. Nothing is written unless the
 * file on disk was read and the request is well-formed.
 */
export function saveVerdict(file: string, body: string, now = new Date()): { status: number; body: string } {
  let all: Record<string, Approval>;
  try {
    all = readApprovals(file);
  } catch (error) {
    return { status: 500, body: (error as Error).message };
  }
  try {
    const { id, verdict, note, score } = JSON.parse(body) as { id: string; verdict: Approval['verdict']; note: string; score: number | null };
    if (typeof id !== 'string' || !id || !['approve', 'reject', null].includes(verdict) || typeof note !== 'string') throw new Error('expected {id, verdict, note}');
    if (!verdict && !note) delete all[id];
    else all[id] = { verdict, note, score: typeof score === 'number' ? score : null, at: now.toISOString() };
    writeApprovals(file, all);
    return { status: 200, body: JSON.stringify(all[id] ?? null) };
  } catch (error) {
    return { status: 400, body: (error as Error).message };
  }
}
