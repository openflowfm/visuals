// The tag vocabulary (`tags/vocabulary.json`): each tag's id, name, group, the
// one question the labeller is asked, optionally a proxy feature used to pick
// which presets a labelling grid shows, a Claude rubric for tags a picture
// judgement suits, and a special scorer (Unique: nearest-neighbour distance).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Group = 'colour' | 'temperature' | 'motion' | 'texture' | 'character' | 'structure';

export interface Tag {
  id: string;
  name: string;
  group: Group;
  question: string;
  /** A feature that tends to be high (or low) on presets that have the tag. Its name is lane A's; when missing, picking falls back to random. */
  proxy?: { feature: string; direction: 'high' | 'low' };
  /** What Claude is told the tag means, with the 0–1 scale's anchors. */
  rubric?: string;
  /** `nearest-neighbour`: scored by distance to the nearest other preset in standardised feature space. */
  scorer?: 'nearest-neighbour';
}

export interface Vocabulary {
  version: 1;
  groups: Group[];
  tags: Tag[];
}

export const VOCABULARY_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vocabulary.json');

/** Everything wrong with a vocabulary, as plain sentences; empty when it's valid. */
export function vocabularyProblems(v: Vocabulary): string[] {
  const out: string[] = [];
  if (v.version !== 1) out.push(`version ${String(v.version)}, expected 1`);
  if (!Array.isArray(v.groups) || v.groups.length === 0) out.push('no groups');
  if (!Array.isArray(v.tags) || v.tags.length === 0) return [...out, 'no tags'];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [i, t] of v.tags.entries()) {
    const at = `tag ${i} (${t.id ?? '?'})`;
    if (typeof t.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(t.id)) out.push(`${at}: id must be lower-case letters, digits and dashes`);
    if (ids.has(t.id)) out.push(`${at}: duplicate id`);
    ids.add(t.id);
    if (typeof t.name !== 'string' || !t.name.trim()) out.push(`${at}: no name`);
    if (names.has(t.name)) out.push(`${at}: duplicate name`);
    names.add(t.name);
    if (!v.groups?.includes(t.group)) out.push(`${at}: group ${String(t.group)} isn't one of the groups`);
    if (typeof t.question !== 'string' || !t.question.endsWith('?') || !t.question.includes(t.name)) out.push(`${at}: the question must name the tag and end with "?"`);
    if (t.proxy !== undefined && (typeof t.proxy.feature !== 'string' || !t.proxy.feature || (t.proxy.direction !== 'high' && t.proxy.direction !== 'low'))) out.push(`${at}: proxy needs a feature and a direction (high or low)`);
    if (t.rubric !== undefined && (typeof t.rubric !== 'string' || t.rubric.length < 40 || !/\b1\b/.test(t.rubric) || !/\b0\b/.test(t.rubric))) out.push(`${at}: rubric must describe the tag and anchor 0 and 1`);
    if (t.scorer !== undefined && t.scorer !== 'nearest-neighbour') out.push(`${at}: unknown scorer ${String(t.scorer)}`);
  }
  return out;
}

export function loadVocabulary(file: string = VOCABULARY_FILE): Vocabulary {
  const v = JSON.parse(readFileSync(file, 'utf8')) as Vocabulary;
  const problems = vocabularyProblems(v);
  if (problems.length) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
  return v;
}

export function tagById(v: Vocabulary, id: string): Tag | undefined {
  return v.tags.find((t) => t.id === id);
}
