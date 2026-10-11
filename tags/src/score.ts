// `npm run score -- <features DIR> [--labels FILE] [--rubric FILE] [--out DIR] [--folds K] [--min-yes N] [--min-no N] [--seed S]`
//
// Fits and checks a scorer per tag from the features, the hand labels and
// (when cached) Claude's rubric scores, and writes `report.json` (every
// number), `report.html` (the same with the clips) and `tags.json` (each
// preset's confidence for the tags that ship, with the scorers' parameters)
// to the out folder (`tags/out/` by default). Prints one line per tag. See
// score-core.ts for what "enough labels", the cross-validation, the
// calibration, the threshold and "ships" mean. Exit 2 on a usage error, 0
// otherwise.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeatures, type Features } from './features.ts';
import { LABELS_FILE, readLabels } from './labels.ts';
import { readRubricScores } from './rubric-core.ts';
import { renderReport } from './report-html.ts';
import { DEFAULT_OPTIONS, scoreTags, summaryLine, type ScoreOptions } from './score-core.ts';
import { loadVocabulary } from './vocabulary.ts';

const USAGE = 'usage: npm run score -- <features DIR> [--labels FILE] [--rubric FILE] [--out DIR] [--folds K] [--min-yes N] [--min-no N] [--seed S]';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

function usage(why: string): never {
  console.error(`score: ${why}\n${USAGE}`);
  process.exit(2);
}

const args = process.argv.slice(2);
let dir: string | undefined;
let labelsFile = LABELS_FILE;
let rubricFile: string | undefined;
let out = OUT;
const opts: ScoreOptions = { ...DEFAULT_OPTIONS };
const int = (a: string, v: string | undefined, min: number): number => {
  const n = Number(v);
  if (v === undefined || !Number.isInteger(n) || n < min) usage(`${a} needs a whole number of at least ${min}`);
  return n;
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
    return v;
  };
  if (a === '--labels') labelsFile = next();
  else if (a === '--rubric') rubricFile = next();
  else if (a === '--out') out = next();
  else if (a === '--folds') opts.folds = int(a, args[++i], 2);
  else if (a === '--min-yes') opts.minYes = int(a, args[++i], 2);
  else if (a === '--min-no') opts.minNo = int(a, args[++i], 2);
  else if (a === '--seed') opts.seed = int(a, args[++i], 0);
  else if (a === '-h' || a === '--help') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else if (dir) usage(`one features folder only (got ${dir} and ${a})`);
  else dir = a;
}
if (!dir) usage('no features folder');

let features: Features;
try {
  features = loadFeatures(dir);
} catch (e) {
  usage((e as Error).message);
}
const vocabulary = loadVocabulary();
const labels = readLabels(labelsFile).labels;
const rubric = readRubricScores(vocabulary, rubricFile);

const started = Date.now();
const { report, tags } = scoreTags(features, vocabulary, labels, rubric, opts);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
writeFileSync(join(out, 'tags.json'), JSON.stringify(tags));
writeFileSync(join(out, 'report.html'), renderReport(report, features, resolve(dir)));

const width = Math.max(...report.tags.map((t) => t.id.length)) + 2;
for (const t of report.tags) console.log(summaryLine(t, width));
const ships = report.tags.filter((t) => t.ships).length;
console.log(
  `\n${ships} of ${report.tags.length} tags ship; ${report.presets} presets, ${labels.length} labels, ${rubric.size} with rubric scores; ${report.duplicates.clusters.length} near-duplicate clusters; ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
console.log(`wrote ${join(out, 'report.html')}, report.json and tags.json`);
