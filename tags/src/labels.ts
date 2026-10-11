// The hand labels: `tags/labels.json`, ground truth, committed. Each label is
// one answer for one preset (by content hash) and one tag, with when it was
// given; later answers for the same preset and tag replace earlier ones, so
// the file only ever grows and a correction is just another label.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Answer = 'yes' | 'no' | 'unsure';

export interface Label {
  hash: string;
  tag: string;
  answer: Answer;
  /** ISO time the answer was given. */
  at: string;
  /** The preset's path in the pack when labelled, for people reading the file. */
  path?: string;
}

export interface LabelFile {
  version: 1;
  labels: Label[];
}

export const LABELS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'labels.json');

const ANSWERS: readonly Answer[] = ['yes', 'no', 'unsure'];

export function isLabel(x: unknown): x is Label {
  const l = x as Label;
  return !!l && typeof l.hash === 'string' && l.hash.length > 0 && typeof l.tag === 'string' && ANSWERS.includes(l.answer) && typeof l.at === 'string';
}

export function readLabels(file: string = LABELS_FILE): LabelFile {
  if (!existsSync(file)) return { version: 1, labels: [] };
  const f = JSON.parse(readFileSync(file, 'utf8')) as LabelFile;
  if (f.version !== 1 || !Array.isArray(f.labels)) throw new Error(`${file}: not a version 1 labels file`);
  const bad = f.labels.findIndex((l) => !isLabel(l));
  if (bad >= 0) throw new Error(`${file}: label ${bad} is malformed`);
  return f;
}

/** One label per line, so the committed file diffs a line per answer. */
export function formatLabels(f: LabelFile): string {
  if (f.labels.length === 0) return '{\n  "version": 1,\n  "labels": []\n}\n';
  const lines = f.labels.map((l) => '    ' + JSON.stringify({ hash: l.hash, tag: l.tag, answer: l.answer, at: l.at, ...(l.path ? { path: l.path } : {}) }));
  return `{\n  "version": 1,\n  "labels": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/** Written whole to a temporary file of its own (unique per write, so two writers never share one), then renamed over the old file. */
export function writeLabels(f: LabelFile, file: string = LABELS_FILE): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, formatLabels(f));
  renameSync(tmp, file);
}

/** Appends labels and saves at once (written whole, then renamed over the old file). */
export function appendLabels(labels: Label[], file: string = LABELS_FILE): LabelFile {
  for (const l of labels) if (!isLabel(l)) throw new Error(`not a label: ${JSON.stringify(l)}`);
  const f = readLabels(file);
  f.labels.push(...labels);
  writeLabels(f, file);
  return f;
}

/** The latest answer per preset hash for one tag. */
export function answersFor(labels: Label[], tag: string): Map<string, Answer> {
  const m = new Map<string, Answer>();
  for (const l of labels) if (l.tag === tag) m.set(l.hash, l.answer);
  return m;
}

/** Counts of the latest answers for one tag. */
export function countsFor(labels: Label[], tag: string): { yes: number; no: number; unsure: number } {
  const c = { yes: 0, no: 0, unsure: 0 };
  for (const a of answersFor(labels, tag).values()) c[a]++;
  return c;
}
