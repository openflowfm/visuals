import type {
  Circuit,
  FlowDef,
  LabCandidate,
  LabEffect,
  LabRoom,
  LabScore,
  LabSubmission,
  Scheme,
} from './protocol.ts';
import { flowsUsedBy } from './protocol.ts';
import { palette, seeded } from './roll.ts';

/**
 * The lab: the durable evidence under the review view, and the contract both
 * ends of the wire agree on.
 *
 * The review view is one UI over this; `server/lab.ts` is its one writer. What
 * lives *here* is everything a browser and the server must not disagree about —
 * the tag vocabulary, the rubric, the submit rules, what makes two candidates
 * the same candidate, and what promotion does to a scheme. Two copies of any of
 * these would be two definitions of what a judgment means.
 *
 * See `docs/lab.md` for the reasoning; issue #28 is where the shape was argued.
 */

// --- the rubric ----------------------------------------------------------

/**
 * Five anchored choices rather than an unlabelled slider. The words matter
 * more than equal numeric distance, which is why the integer is stored beside
 * `RUBRIC_VERSION`: a 4 means "belongs in the library" only for as long as
 * this table says so.
 */
export const SCORES: readonly { score: LabScore; means: string }[] = [
  { score: 1, means: 'no useful idea here' },
  { score: 2, means: 'an idea, but not a flow to keep' },
  { score: 3, means: 'interesting enough to develop' },
  { score: 4, means: 'belongs in the library' },
  { score: 5, means: 'exceptional; preserve this' },
];

export const RUBRIC_VERSION = 1;

/** Bumped when the compiled pipeline changes what the same flow looks like. */
export const LAB_RENDERER_VERSION = 1;

// --- the tag vocabulary ---------------------------------------------------

export type TagCategory =
  | 'character'
  | 'motion'
  | 'reactivity'
  | 'composition'
  | 'piece'
  | 'use';

/**
 * A tag's direction. Category is the *topic* a tag speaks about; polarity is
 * whether it praises, faults, or merely describes. Direction lives on the tag
 * rather than on the shelf so any topic can hold all three — `musical` and
 * `too-fast` are both about motion.
 *
 * Polarity is reserved for **functional** claims — legibility, stability,
 * safety, cost, craft — where any judge who accepts the description has
 * already accepted the verdict: `broken` is never a compliment. Taste stays
 * neutral, however loaded the word — `funny`, `beautiful` and `generic`
 * describe, and the reviewer's helped/hurt stamp records what the quality did
 * *here*. Praise and fault tags carry their effect with them: the review view
 * stamps `helped` or `hurt` on the wire and offers no toggle.
 */
export type TagPolarity = 'praise' | 'fault' | 'neutral';

export interface LabTag {
  /** Stable semantic id. Labels may improve; meanings must not be repurposed. */
  id: string;
  category: TagCategory;
  polarity: TagPolarity;
  label: string;
  description: string;
  /** False for a tag whose meaning changed: deprecated, never reused. */
  active: boolean;
}

/**
 * 2: polarity became a tag property, and `reason` dissolved into `piece`.
 * 3: polarity narrowed to functional claims; `use` gained sections and energy.
 */
export const TAGS_VERSION = 3;

export const TAG_CATEGORIES: readonly { category: TagCategory; about: string }[] = [
  { category: 'character', about: 'What kind of thing it is' },
  { category: 'motion', about: 'How it moves' },
  { category: 'reactivity', about: 'How it hears the set that drives it' },
  { category: 'composition', about: 'How the frame reads, and whether a projector agrees' },
  { category: 'piece', about: 'The whole piece — what no single aspect explains' },
  { category: 'use', about: 'Where in a show it would earn its place' },
];

const shape =
  (polarity: TagPolarity) =>
  (id: string, category: TagCategory, label: string, description: string): LabTag => ({
    id,
    category,
    polarity,
    label,
    description,
    active: true,
  });

const describe = shape('neutral');
const praise = shape('praise');
const fault = shape('fault');

export const TAGS: readonly LabTag[] = [
  describe('geometric', 'character', 'geometric', 'Lines, tiles, folds; built rather than grown'),
  describe('organic', 'character', 'organic', 'Reads as grown or fluid rather than constructed'),
  describe('textural', 'character', 'textural', 'A surface more than a shape'),
  describe('funny', 'character', 'funny', 'It has a joke in it, and the joke lands'),
  describe('severe', 'character', 'severe', 'Austere, hard-edged, unsmiling'),
  describe('dreamy', 'character', 'dreamy', 'Soft, slow, half-remembered'),
  describe('chaotic', 'character', 'chaotic', 'Deliberately too much at once'),
  describe('restrained', 'character', 'restrained', 'Does one thing and declines the rest'),
  describe('hypnotic', 'character', 'hypnotic', 'Rewards staring; the loop is the point'),

  describe('still', 'motion', 'still', 'Holds; change is the exception'),
  describe('breathing', 'motion', 'breathing', 'Swells and settles on an envelope'),
  describe('rhythmic', 'motion', 'rhythmic', 'Moves on the beat and says so'),
  describe('building', 'motion', 'building', 'Accumulates somewhere rather than cycling'),
  describe('twitchy', 'motion', 'twitchy', 'Follows the raw meter; nervous'),
  describe('repetitive', 'motion', 'repetitive', 'The same gesture past the point of reading as a loop'),
  describe('musical', 'motion', 'musical', 'Motion that reads as phrasing rather than as a meter'),
  fault('too-twitchy', 'motion', 'too twitchy', 'Meter noise passed straight to the eye'),
  fault('too-fast', 'motion', 'too fast', 'Outruns the eye; nothing lands'),
  fault('seizure-risk', 'motion', 'seizure risk', 'Flashing in the photosensitive band; unsafe to put on a wall'),

  describe('set-forward', 'reactivity', 'set-forward', 'The set is the picture; the flow frames it'),
  describe('loosely-reactive', 'reactivity', 'loosely reactive', 'Hears the set without depending on it'),
  describe('autonomous', 'reactivity', 'autonomous', 'Ignores the set, and means to'),
  praise('reads-energy', 'reactivity', 'reads energy', 'Level changes read on the wall'),
  fault('obscures', 'reactivity', 'obscures the performance', 'Buries what the players are doing'),
  fault('silence-blind', 'reactivity', 'disappears in silence', 'Nothing playing leaves nothing showing'),
  fault('beat-blind', 'reactivity', 'fights the beat', 'Moves against the tempo in a way that reads as wrong'),

  describe('layered', 'composition', 'layered', 'Depths that read as depths'),
  describe('immersive', 'composition', 'immersive', 'Fills the frame as a field rather than a figure'),
  praise('clear-focus', 'composition', 'clear focus', 'One thing to look at, found immediately'),
  praise('balanced', 'composition', 'balanced', 'Weight sits where it should'),
  praise('projector-readable', 'composition', 'projector-readable', 'Survives a cheap lamp and ambient light'),
  fault('muddy', 'composition', 'muddy', 'Mixes to grey; edges lost'),
  fault('flat', 'composition', 'flat', 'No depth where depth was wanted'),
  fault('harsh', 'composition', 'harsh', 'Contrast or strobe past what a room enjoys'),
  fault('too-dark', 'composition', 'too dark', 'Reads as a dark screen on a lamp'),

  describe('distinctive', 'piece', 'distinctive', 'Not a thing the library already has'),
  describe('surprising', 'piece', 'surprising', 'Did something the recipe did not promise'),
  describe('beautiful', 'piece', 'beautiful', 'The looks alone would keep it'),
  describe('generic', 'piece', 'generic', 'Any roll could have made it'),
  describe('gimmicky', 'piece', 'gimmicky', 'One trick, and the trick is the whole flow'),
  praise('coherent', 'piece', 'coherent', 'Its parts belong to one idea'),
  praise('economical', 'piece', 'economical', 'A small graph doing a lot'),
  praise('versatile', 'piece', 'versatile', 'Would read in most rooms, not just this one'),
  praise('sustains', 'piece', 'sustains', 'Still good on the third minute'),
  fault('one-moment', 'piece', 'only one good moment', 'A single alignment carries it'),
  fault('expensive', 'piece', 'too expensive', 'Costs GPU beyond what the picture repays'),
  fault('broken', 'piece', 'broken', 'Not a look; a malfunction'),
  fault('fragile', 'piece', 'fragile', 'Works in this room and would break in another'),
  fault('overbuilt', 'piece', 'overbuilt', 'More graph than the idea needs'),

  describe('background', 'use', 'background', 'Runs long behind the music without demanding'),
  describe('transition', 'use', 'transition', 'A bridge between two things that both read'),
  describe('peak', 'use', 'peak', 'For the loudest minute in the set'),
  describe('interlude', 'use', 'interlude', 'A rest the room can feel'),
  describe('wildcard', 'use', 'wildcard', 'Kept for the moment nobody can plan'),
  describe('nesting', 'use', 'good for nesting', 'Stronger as a part than as a whole'),
  describe('intro', 'use', 'intro', 'Best while the song is arriving'),
  describe('verse', 'use', 'verse', 'Carries the verses without stealing them'),
  describe('chorus', 'use', 'chorus', 'Best when the hook lands'),
  describe('bridge', 'use', 'bridge', 'For the turn away from home'),
  describe('jam', 'use', 'jam', 'Best while the players stretch out'),
  describe('outro', 'use', 'outro', 'Best while the song is leaving'),
  describe('low-energy', 'use', 'low energy', 'Earns its place when the room is quiet'),
  describe('high-energy', 'use', 'high energy', 'Earns its place when the room is loud'),
];

export const TAG_BY_ID: ReadonlyMap<string, LabTag> = new Map(TAGS.map((t) => [t.id, t]));

// --- the submit rules -----------------------------------------------------

/**
 * Why a submission cannot land yet, as sentences, or nothing when it can.
 *
 * One function for the button and for the server, so the UI can never learn a
 * different rule from the one the store enforces. Evidence without force-fed
 * answers: every review needs a score and two tags that describe rather than
 * judge; what else the score demands is a matter of effect. A praise or fault
 * tag carries its effect in its polarity, a neutral tag carries the
 * reviewer's stamp — so a 5 can rest on `funny, helped` as squarely as on
 * `coherent` — and a use tag never gates, because where a flow belongs is not
 * why it scored.
 */
export function submissionProblems(submission: {
  score: LabScore | null;
  tags: readonly { id: string; effect: LabEffect }[];
}): string[] {
  const problems: string[] = [];
  const { score, tags } = submission;
  if (score === null) problems.push('a review requires a score');

  const known = tags.flatMap((each) => {
    const tag = TAG_BY_ID.get(each.id);
    return tag ? [{ tag, effect: each.effect }] : [];
  });
  const describing = known.filter(
    ({ tag }) => tag.polarity === 'neutral' && tag.category !== 'use',
  );
  if (describing.length < 2) {
    problems.push('at least two tags that describe rather than judge');
  }

  const weighed = known.filter(({ tag }) => tag.category !== 'use');
  const helped = weighed.some(
    ({ tag, effect }) => tag.polarity === 'praise' || (tag.polarity === 'neutral' && effect === 'helped'),
  );
  const hurt = weighed.some(
    ({ tag, effect }) => tag.polarity === 'fault' || (tag.polarity === 'neutral' && effect === 'hurt'),
  );
  const uses = known.some(({ tag }) => tag.category === 'use');

  if (score !== null && score >= 4) {
    if (!helped) problems.push('a 4 or 5 needs something that helped');
    if (!uses) problems.push('a 4 or 5 needs an intended use');
  }
  if (score !== null && score <= 2 && !hurt) {
    problems.push('a 1 or 2 needs something that hurt');
  }
  if (score === 3 && !helped && !hurt) {
    problems.push('a 3 needs something that helped or hurt');
  }
  return problems;
}

// --- candidate identity ---------------------------------------------------

/**
 * The canonical form a candidate id is a hash of.
 *
 * Identity is **visual behaviour**: node kinds, modes, named targets, held
 * values, depths, smoothing, the wiring, and the complete transitive bundle of
 * nested flows. It excludes — by whitelisting, so a field added for the editor
 * tomorrow cannot silently change every id — the display name, canvas
 * positions, value labels, preview outlets and creation time.
 *
 * Node ids are renamed to their position in the node list, so authored ids
 * carry no weight. Node *order* still does: recognising two differently-ordered
 * but identical graphs would need canonical graph isomorphism, and a missed
 * duplicate costs one redundant review where a wrong match would corrupt one.
 *
 * Bundle flows are renamed the same way, in first-reference order, and every
 * `flow` node's op is rewritten to the renamed id — so what two candidates are
 * compared on is the graphs they contain, never what those graphs were called.
 */
export function canonicalCandidate(
  flow: FlowDef,
  bundle: Record<string, FlowDef>,
): string {
  const renamed = new Map<string, string>();
  const queue: string[] = [];

  const claim = (id: string): string => {
    const held = renamed.get(id);
    if (held) return held;
    const name = `b${renamed.size}`;
    renamed.set(id, name);
    queue.push(id);
    return name;
  };

  const circuitOf = (circuit: Circuit): unknown => {
    const ids = new Map(circuit.nodes.map((node, at) => [node.id, `n${at}`]));
    const port = (at: string): string => {
      const slash = at.indexOf('/');
      const node = slash < 0 ? at : at.slice(0, slash);
      const rest = slash < 0 ? '' : at.slice(slash);
      return `${ids.get(node) ?? node}${rest}`;
    };
    return {
      nodes: circuit.nodes.map((node) => ({
        kind: node.kind,
        ...(node.op !== undefined
          ? { op: node.kind === 'flow' ? claim(node.op) : node.op }
          : {}),
        ...(node.of !== undefined ? { of: node.of } : {}),
        ...(node.value !== undefined ? { value: node.value } : {}),
        ...(node.smooth !== undefined ? { smooth: node.smooth } : {}),
        ...(node.values
          ? { values: Object.fromEntries(Object.entries(node.values).sort()) }
          : {}),
        ...(node.depths
          ? { depths: Object.fromEntries(Object.entries(node.depths).sort()) }
          : {}),
      })),
      cords: circuit.cords
        .map((cord) => `${port(cord.from)}>${port(cord.to)}`)
        .sort(),
    };
  };

  const top = circuitOf(flow.circuit);
  const nested: Record<string, unknown> = {};
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at];
    const def = bundle[id];
    nested[renamed.get(id)!] = def ? circuitOf(def.circuit) : null;
  }
  return JSON.stringify({ v: 1, flow: top, bundle: nested });
}

/** Every flow `flow` reaches through `flows`, frozen — the dependency bundle. */
export function bundleOf(
  flows: Record<string, FlowDef>,
  flow: FlowDef,
): Record<string, FlowDef> {
  const bundle: Record<string, FlowDef> = {};
  const queue = flowsUsedBy(flow.circuit);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (bundle[id]) continue;
    const def = flows[id];
    if (!def) continue;
    bundle[id] = def;
    queue.push(...flowsUsedBy(def.circuit));
  }
  return bundle;
}

// --- the room dealer ------------------------------------------------------

/**
 * Alphabetical for the reason `useRoom`'s stand-ins are: `sectionOf` reports a
 * role's position in a sorted list, so any other order would hand the number a
 * different meaning in the lab from the one it has on stage.
 */
const ROOM_SECTIONS: readonly string[] = ['BRIDGE', 'CHORUS', 'INTRO', 'JAM', 'OUTRO', 'VERSE'];

/**
 * An invented room, dealt whole from a seed.
 *
 * Deliberately the same dealer for the first room and a re-dealt one: a room
 * is reproducible because it is a pure function of its seed, and the seed is
 * stored on the room so a judgment can be re-staged years later.
 */
export function dealRoom(seed: string): LabRoom {
  const rng = seeded(seed);
  const colors = palette(rng);
  return {
    tempo: Math.round(80 + rng() * 60),
    quantum: 4,
    energy: Math.round((0.25 + rng() * 0.7) * 100) / 100,
    section: ROOM_SECTIONS[Math.floor(rng() * ROOM_SECTIONS.length)],
    sections: [...ROOM_SECTIONS],
    key: rng() < 0.2 ? null : Math.floor(rng() * 12),
    colors,
    seed,
  };
}

// --- promotion ------------------------------------------------------------

/**
 * Copy a frozen candidate into a scheme, and touch nothing else.
 *
 * Through the ordinary edit path: the result is a new in-memory scheme for the
 * console to publish, which makes the scheme dirty and is saved by the existing
 * save control — the lab never writes a scheme. The candidate's bundle comes
 * with it under fresh ids, `flow` nodes rewritten to match, so the promoted
 * flow keeps drawing what was judged even where the library already had a
 * different flow under the bundled id.
 */
export function promoteCandidate(
  scheme: Scheme,
  candidate: LabCandidate,
): { scheme: Scheme; id: string } {
  const taken = new Set(Object.keys(scheme.flows));
  const free = (want: string): string => {
    let id = want;
    for (let n = 2; taken.has(id); n++) id = `${want}-${n}`;
    taken.add(id);
    return id;
  };

  const landed = new Map<string, string>();
  for (const held of Object.keys(candidate.bundle)) {
    landed.set(held, free(held));
  }

  const rewire = (def: FlowDef): FlowDef => ({
    name: def.name,
    circuit: {
      nodes: def.circuit.nodes.map((node) =>
        node.kind === 'flow' && node.op && landed.has(node.op)
          ? { ...node, op: landed.get(node.op)! }
          : { ...node },
      ),
      cords: def.circuit.cords.map((cord) => ({ ...cord })),
    },
  });

  const names = new Set(Object.values(scheme.flows).map((def) => def.name));
  let name = candidate.flow.name;
  for (let n = 2; names.has(name); n++) name = `${candidate.flow.name} ${n}`;

  const flows = { ...scheme.flows };
  for (const [held, at] of landed) flows[at] = rewire(candidate.bundle[held]);
  const id = free(`lab-${candidate.id.slice(0, 8)}`);
  flows[id] = { ...rewire(candidate.flow), name };

  return { id, scheme: { ...scheme, flows } };
}

// --- the method boundary --------------------------------------------------

/** What a method reads about the corpus. Grows; never lets a method write. */
export interface EvidenceView {
  reviewed: number;
  skipped: number;
}

export interface CandidateDraft {
  flow: FlowDef;
  bundle: Record<string, FlowDef>;
  /** Parent candidate ids, oldest first. Empty for a fresh deal. */
  parents: string[];
  /** The generation operation, e.g. `fresh`, `mutate:swap-mode`. */
  operation: string;
}

/**
 * Generation policy, behind the one boundary the lab admits it through.
 *
 * A method may read a snapshot of evidence and propose work; it may not
 * render, persist judgments, or edit a scheme — nothing in this interface can
 * reach any of those. A second methodology should be one module and its
 * tests, not a new persistence path or a new review UI.
 */
export interface LabMethod<State> {
  readonly id: string;
  readonly version: number;
  start(): State;
  next(
    state: State,
    evidence: EvidenceView,
    budget: number,
    rng: () => number,
  ): CandidateDraft[];
  observe(state: State, completed: { score: LabScore }[]): State;
}

export { seeded };
