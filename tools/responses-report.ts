#!/usr/bin/env node
// What carrying a scheme across a response set would change, before it does.
//
// The migration itself runs inside `server/scheme.ts`'s `merge`, on load, and
// nothing is written until something saves — so the picture changes before the
// file does. That is the wrong order to find out in, on a library somebody
// dialled by eye, so this prints the whole of it first.
//
// It also answers the question a single stamp cannot. A scheme is saved whole
// and authored a flow at a time, so a library that spans a response change has
// flows dialled either side of it and no record of which. What this has instead
// is a **reference**: a copy of the same library from before the change. A flow
// identical to its reference has not been touched since, and is safe to carry;
// one that differs, or that the reference has never heard of, was authored at
// some point in between and only its author knows which side.
//
//   node visuals/tools/responses-report.ts [scheme.json] [--reference old.json] [--write]
//
// Default scheme is the open one under ~/.openflow; default reference is the
// repo's `visuals/scheme.json`, frozen before responses existed.
//
// `--write` records what it could place, as `responses` on each flow it is sure
// about. It moves no stored value: the carry itself still happens in `merge`,
// on the next load, and now skips the flows this marked as already current.
// Anything it could not place is left alone and named, because guessing at one
// is worse than asking.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowDef, Scheme } from '../protocol.ts';
import { RESPONSE_SET_VERSION } from '../response.ts';
import { DatabaseSync } from 'node:sqlite';
import { labPlace, schemePlace } from '../server/home.ts';
import {
  OLDEST_RESPONSE_SET_VERSION,
  migrateFlowResponses,
  versionAt,
  type ResponseChange,
} from '../responseMigration.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const schemeFile = positional[0] ?? schemePlace().file;
const referenceFile = flag('reference') ?? path.resolve(here, '../scheme.json');

const read = (file: string): Partial<Scheme> => JSON.parse(fs.readFileSync(file, 'utf8'));

const scheme = read(schemeFile);
const flows = scheme.flows ?? {};
const stamp = scheme.responses ?? OLDEST_RESPONSE_SET_VERSION;

console.log(`scheme     ${schemeFile}`);
console.log(`stamped    ${scheme.responses ?? '(none — read as version 1)'}`);
console.log(`this build response set ${RESPONSE_SET_VERSION}\n`);

if (stamp >= RESPONSE_SET_VERSION) {
  console.log('Already current. Nothing to carry.');
  process.exit(0);
}

/** How sure we are that a flow's numbers predate the change. */
type Confidence =
  | 'dated by the lab'
  | 'unchanged since the reference'
  | 'edited or created since the reference'
  | 'not in the reference';

/**
 * When the lab made each candidate it still has, by the flow id a saved one takes.
 *
 * The lab is the only author here that writes down when it worked. A flow it
 * generated can therefore be placed either side of a promotion exactly, which is
 * twenty-five fewer judgment calls than the file alone can settle. A missing
 * database is not an error — it means those flows join everything else in
 * needing a decision.
 */
function labDates(): Map<string, number> {
  const dates = new Map<string, number>();
  try {
    const db = new DatabaseSync(labPlace().file, { readOnly: true });
    for (const row of db.prepare('select id, created_at from candidates').all() as {
      id: string;
      created_at: string;
    }[]) {
      dates.set(row.id, Date.parse(row.created_at));
    }
    db.close();
  } catch (err) {
    if (process.env.OPENFLOW_DEBUG) console.error('lab dates unavailable:', (err as Error).message);
    return dates;
  }
  return dates;
}

const made = labDates();

/**
 * A `lab-<candidateId>` flow, and the copies a save can make of one.
 *
 * The id in a scheme is the candidate's, shortened — so the match is the
 * candidate starting with what the flow carries, not the other way about. A
 * saved copy adds a `-2` after that, which the same prefix still finds.
 */
function labMadeAt(id: string): number | undefined {
  if (!id.startsWith('lab-')) return undefined;
  const bare = id.slice(4);
  const exact = made.get(bare);
  if (exact !== undefined) return exact;
  const stem = bare.split('-')[0]!;
  for (const [candidate, at] of made) if (candidate.startsWith(stem)) return at;
  return undefined;
}

let reference: Record<string, FlowDef> = {};
let referenceRead = true;
try {
  reference = read(referenceFile).flows ?? {};
} catch {
  referenceRead = false;
}

const sameAsReference = (id: string, def: FlowDef): boolean =>
  referenceRead &&
  Boolean(reference[id]) &&
  JSON.stringify(reference[id]!.circuit) === JSON.stringify(def.circuit);

const confidenceOf = (id: string, def: FlowDef): Confidence =>
  labMadeAt(id) !== undefined
    ? 'dated by the lab'
    : sameAsReference(id, def)
      ? 'unchanged since the reference'
      : reference[id]
        ? 'edited or created since the reference'
        : 'not in the reference';

// A flow the lab dated speaks for itself, which is what `FlowDef.responses` is
// for — so it is filled in here rather than left for the migration to guess.
const placed: Record<string, FlowDef> = {};
for (const [id, def] of Object.entries(flows)) {
  const at = labMadeAt(id);
  placed[id] = at === undefined ? def : { ...def, responses: versionAt(at) };
}

const { changes } = migrateFlowResponses(placed, stamp);
const byFlow = new Map<string, ResponseChange[]>();
for (const change of changes) {
  const list = byFlow.get(change.flow) ?? [];
  list.push(change);
  byFlow.set(change.flow, list);
}

console.log(`reference  ${referenceFile}${referenceRead ? '' : '  (unreadable — every flow reads as unknown)'}`);
console.log(
  `${changes.length} stored number${changes.length === 1 ? '' : 's'} in ${byFlow.size} of ${Object.keys(flows).length} flows would move.\n`,
);

const groups: Record<Confidence, string[]> = {
  'dated by the lab': [],
  'unchanged since the reference': [],
  'edited or created since the reference': [],
  'not in the reference': [],
};
for (const id of byFlow.keys()) groups[confidenceOf(id, flows[id]!)].push(id);

const order: Confidence[] = [
  'dated by the lab',
  'unchanged since the reference',
  'edited or created since the reference',
  'not in the reference',
];

for (const confidence of order) {
  const ids = groups[confidence];
  if (ids.length === 0) continue;
  const safe = confidence === 'dated by the lab' || confidence === 'unchanged since the reference';
  console.log(`${safe ? '## SAFE TO CARRY' : '## NEEDS A DECISION'} — ${confidence} (${ids.length})\n`);
  for (const id of ids.sort()) {
    const list = byFlow.get(id)!;
    console.log(`  ${flows[id]!.name} (${id})`);
    for (const change of list) {
      const warn = change.exact ? '' : '   [the new range cannot reach this — closest shown]';
      console.log(
        `      ${`${change.node}.${change.inlet}`.padEnd(22)} ${change.was.toFixed(4).padStart(8)} -> ` +
          `${change.now.toFixed(4).padStart(8)}   keeps delivering ${change.delivers.toFixed(4)}` +
          `${change.unit ? ` ${change.unit}` : ''}${warn}`,
      );
    }
    console.log();
  }
}

const dated = Object.keys(flows).filter((id) => labMadeAt(id) !== undefined).length;
if (dated > 0) {
  console.log(
    `${dated} flow${dated === 1 ? '' : 's'} placed exactly by the lab's own record of when it made them.\n`,
  );
}

if (argv.includes('--write')) {
  // Only the flows something other than a guess placed. An ambiguous one keeps
  // no stamp, so it stays visible as a question rather than being answered by
  // whichever default this tool happened to pick.
  const marked: Record<string, FlowDef> = {};
  let count = 0;
  for (const [id, def] of Object.entries(flows)) {
    const at = labMadeAt(id);
    const version = at !== undefined ? versionAt(at) : sameAsReference(id, def) ? stamp : undefined;
    if (version === undefined || def.responses === version) {
      marked[id] = def;
      continue;
    }
    marked[id] = { ...def, responses: version };
    count += 1;
  }
  const next = { ...scheme, flows: marked };
  fs.writeFileSync(schemeFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Stamped ${count} flow${count === 1 ? '' : 's'} in ${schemeFile}.`);
  console.log('No stored value was moved — that happens on the next load, and is what the carry is.\n');
}

const undecided = groups['edited or created since the reference'].length + groups['not in the reference'].length;
if (undecided > 0) {
  console.log(
    `${undecided} flow${undecided === 1 ? '' : 's'} cannot be placed either side of the change from the file alone.\n` +
      `Mark any that were authored after it with "responses": ${RESPONSE_SET_VERSION} on the flow and they will be left alone.`,
  );
}
