import {
  GRADE_MODES,
  LENS_MODES,
  SPREAD_MODES,
  MATH_OPS,
  NODE_FAMILIES,
  PLAYBACK_NAMES,
  TRACK_READS,
  SONG_FACTS,
  SOURCES,
  WAVE_SHAPES,
  BLENDS,
  type Circuit,
  type NodeKind,
  type Scheme,
} from '../../protocol.ts';
import { NODE_SPECS } from '../render/circuit.ts';
import { freeNodeId } from './edits.ts';

/**
 * Everything you can drop on a canvas: **the nodes**, with presets under them.
 *
 * The browser used to list the *modes* — `plasma`, `kaleido`, `sparks` — flat,
 * one entry each, and never mentioned the node they were. That solved a real
 * problem and the solution has to keep solving it: browsing nineteen node kinds
 * and then discovering that two of them contain another twenty-three between
 * them is how a graph editor stays unusable, and nobody should have to know
 * that `plasma` is a `source` with a mode set to find it.
 *
 * What it got wrong is what it made the list *mean*. Eleven entries that are
 * all one node, each dropping that node with a mode already picked, is a
 * browser of presets pretending to be a browser of things — so the canvas you
 * end up with has a node on it you never chose, and the face says `plasma`
 * where the browser implied plasma was a kind of node.
 *
 * So it is Ableton's shape: **the browser lists the device and the presets sit
 * under it.** One `source` entry, eleven pictures beneath it; one `effect`,
 * twelve. Dropping the node gives you a default one, dropping a preset gives
 * you a configured one — a mode, and the values that make that mode read. The
 * search box is what keeps the old virtue: typing `spark` finds `sparks` under
 * `source` whether or not you knew where it lived.
 *
 * **Not every list under a node is a preset list.** A `track` names a track in
 * the set and a `look` names a look in the library, and those are *targets*
 * rather than presets — instances of something that exists elsewhere. They stay
 * where they were, one entry each, because collapsing "Bass meter" under a
 * generic `track` node is the same mistake in reverse.
 *
 * Presets here are **built in**. A user-saved one needs somewhere in the scheme
 * to live and a name to be saved under, and that decision is better made once
 * these have been used; nothing below is in the way of it.
 */
export interface Pick {
  /** What it is called in the browser, and the only name anyone sees. */
  label: string;
  kind: NodeKind;
  op?: string;
  /** Which thing in the set, for a row that names one. See `CircuitNode.of`. */
  of?: string;
  /** What a preset sets on the node's own inlets. */
  knobs?: Record<string, number>;
  about: string;
  family: string;
  /** For the search box: everything worth matching on, lowercased. */
  terms: string;
}

/**
 * One row of the browser: a node, and whatever sits under it.
 *
 * A target is an entry with nothing under it rather than a third kind of thing,
 * which is what keeps `track` and `look` reading as a flat run of names without
 * anything here having to know they are special.
 */
export interface Entry {
  node: Pick;
  presets: Pick[];
}

/** What each mode is, one line each, because a browser is where you learn these. */
const ABOUT: Record<string, string> = {
  solid: 'The colour, breathing on the bar and brightening with the sound',
  bars: 'Vertical bars whose heights are a bar of music, swept by the playhead',
  rings: 'Rings launched on the beat, expanding outward',
  noise: 'A drifting field that thickens with the sound. Weather, not a metronome',
  strobe: 'Whole-frame flashes on the beat. No shape at all, which is the point',
  grid: 'Cells, each lighting on its own beat. Structure rather than motion',
  tunnel: 'A corridor rushing toward you, on the beat',
  plasma: 'Four sines crossed. The best full-frame wash there is',
  spiral: 'Arms winding out of the centre and turning on the beat',
  scan: 'Lines with a bar of sweep passing down them. A machine, not weather',
  sparks: 'A cell per spark, each firing on its own beat and drifting as it dies',

  mirror: 'Fold the picture about a line, at any angle',
  kaleido: 'Fold it into wedges around the centre, rotating on the beat',
  shift: 'Separate the colour channels. Bites on transients, closes in the gaps',
  pixelate: 'Blocks that resolve across the bar',
  ripple: 'A wave leaving the centre on each beat, displacing what it crosses',
  smear: 'A short radial blur. Softens a picture into whatever it is over',
  bloom: 'Only what is already bright gets added back. Builds highlights',
  slice: 'Rows thrown sideways, re-diced on each beat',
  edge: 'Keep the outline and throw away the fill. Makes a busy frame less busy',
  posterize: 'Colour flattened to four steps. Turn levels up for fewer',
  twist: 'Rotation that grows with radius, swaying on the beat',
  invert: 'On the beat and off again. A switch rather than a shape',

  over: 'The ordinary stacking: the top where it is opaque',
  add: 'Both, summed. Bright and it stays bright',
  screen: 'Both, saturating at white rather than climbing past it',
  multiply: 'The base seen through the top. The only one that darkens',

  level: 'The room\'s own meter — everything, as loud as it is',
  beat: 'Continuous beats. Wire it into a wave',
  phase: 'Where you are in the bar, 0 to 1',
  pulse: 'One on the beat, decaying across it',
  time: 'Seconds — for drift that should specifically not be in time',
  random: 'A new number every beat',

  seed: 'A different number for every song. Free per-song variation',
  tempo: 'The tempo, as a number you can drive something with',
  key: 'The song\'s musical key, as a pitch class. Two songs in the same key agree',
  section: 'Where the playing section sits among the ones the set uses',
  sections: 'How many sections the set has',
};

/**
 * The presets that are more than a mode.
 *
 * Most are not, and that is honest rather than lazy: a knob's middle is where
 * these were tuned to sit, so a preset that set every one of them to a half
 * would be a preset that said nothing. `posterize` is the one where the middle
 * is plainly wrong — eight steps is invisible on a projector, and the effect is
 * named after the poster — and it is also the example that started this: an
 * effect you should be able to drop and have *do* something.
 */
const PRESET_KNOBS: Record<string, Record<string, number>> = {
  posterize: { steps: 0.78 },
};

/**
 * A row's identity, which is what React keys it by.
 *
 * The **name** is in here as well as the mode, and it has to be: a `track` row
 * carries a mode now — every one of them drops a meter — so three tracks would
 * be three rows spelling `track:level`, and children under one key may be
 * duplicated or dropped. That is not a cosmetic bug; it is a node you cannot
 * add. A test pins it, because a real set is where it shows up and a two-track
 * fixture is where it does not.
 */
export function keyOf(pick: Pick): string {
  return `${pick.kind}:${pick.op ?? ''}:${pick.of ?? ''}`;
}

/** The whole browser, built from the vocabulary rather than typed out beside it. */
export function palette(scheme: Scheme, tracks: readonly string[]): Entry[] {
  const out: Entry[] = [];
  const family = (kind: NodeKind) =>
    NODE_FAMILIES.find((each) => each.kinds.includes(kind))?.name ?? 'other';

  const pick = (
    kind: NodeKind,
    op: string | undefined,
    label: string,
    about: string,
    knobs?: Record<string, number>,
    of?: string,
  ): Pick => ({
    label,
    kind,
    op,
    ...(of ? { of } : {}),
    ...(knobs ? { knobs } : {}),
    about,
    family: family(kind),
    // The kind is in here as well as the mode, so `sine wave` and `song key`
    // find what is now labelled just `sine` and just `key` under their node.
    terms: `${label} ${kind} ${op ?? ''} ${about}`.toLowerCase(),
  });

  const node = (
    kind: NodeKind,
    op: string | undefined,
    label: string,
    about: string,
    of?: string,
  ) => {
    out.push({ node: pick(kind, op, label, about, undefined, of), presets: [] });
  };

  // Values only here, because only a *mode* is a preset. A track called
  // `posterize` is a target that happens to spell one, and handing it a set of
  // knobs an inlet has never heard of is the kind of coincidence that survives
  // into a file.
  const modes = (kind: NodeKind, label: string, ops: readonly string[]) => {
    out.push({
      node: pick(kind, undefined, label, NODE_SPECS[kind].about),
      presets: ops.map((op) => pick(kind, op, op, ABOUT[op] ?? '', PRESET_KNOBS[op])),
    });
  };

  // Pictures. The set first, because a rig that reads a Live set should offer
  // the Live set before it offers a plasma. It has modes and no presets: `by
  // name` is the answer this rig is for, and the other eleven are one dropdown
  // away on the face rather than eleven rows here saying "all of them as a
  // tunnel".
  node('tracks', 'by name', 'every playing track', NODE_SPECS.tracks.about);
  modes('source', 'source', SOURCES);
  node('paint', undefined, 'paint', NODE_SPECS.paint.about);
  // A look is a target, not a preset — an instance of something in the library,
  // which is why each one is its own row and searchable by its own name.
  for (const [id, def] of Object.entries(scheme.looks)) {
    node('look', id, def.name || id, 'Another look, whole, as one node');
  }

  // Colour, and only what is actually colour: `grade` changes it where it is
  // and `spread` reads around it. The six modes that used to sit beside them
  // under `effect` never touched a colour at all — they are `lens` now, down in
  // geometry with the five kinds they were already the same functions as.
  modes('grade', 'grade', GRADE_MODES);
  modes('spread', 'spread', SPREAD_MODES);
  modes('blend', 'blend', BLENDS);

  // Geometry.
  node('point', undefined, 'point', NODE_SPECS.point.about);
  modes('lens', 'lens', LENS_MODES);
  node('polar', undefined, NODE_SPECS.polar.name, NODE_SPECS.polar.about);

  // The room: three questions you can ask the set, and nothing else can answer.
  modes('playback', 'playback', PLAYBACK_NAMES);
  // Targets again, and the reason the search box has to reach them: a name from
  // the set is the one thing in this browser nobody could guess.
  //
  // Distinct, and not merely because the caller ought to hand them over that
  // way. A `track` node addresses a track by *name*, so two tracks called `MIDI`
  // are one target however many of them the set has — a second row would offer a
  // chip that does exactly what the first one does, under the same key.
  //
  // The row drops a **meter**, because that is what anybody reaching for a track
  // wants first. Which of its numbers is a dropdown on the face rather than
  // three rows per track here, which for a real set would be seventy-eight.
  for (const name of new Set(tracks)) {
    node('track', TRACK_READS[0], `${name} meter`, "That track's own numbers, by name", name);
  }
  modes('song', 'song', SONG_FACTS);

  // Numbers.
  node('value', undefined, 'knob', NODE_SPECS.value.about);
  modes('math', 'math', MATH_OPS);
  modes('wave', 'wave', WAVE_SHAPES);

  // No `out`. Every look has exactly one, it arrives with the look, and it
  // cannot be deleted — so a browser offering another one is offering the only
  // node in the vocabulary that makes a look refuse to compile. It was there
  // because the browser is built from the vocabulary and `out` is part of it;
  // being part of the vocabulary and being something you add are different
  // questions, and only the second one a drawer answers.
  return out;
}

/**
 * Drop one on the canvas, somewhere free-ish.
 *
 * Free-ish rather than clever. Every node drags, and a layout algorithm would
 * fight whatever you did by hand — which on a canvas you are actively arranging
 * is worse than a node landing somewhere you have to move it from.
 */
export function drop(circuit: Circuit, pick: Pick): Circuit {
  const at = circuit.nodes.length;
  // A node dropped from its own row still lands with a mode written on it —
  // the first one, which is what it would have compiled as anyway. Leaving it
  // off would put a node on the canvas whose title said `source` and whose
  // dropdown said `solid`, which is the two-things-to-learn-one the faceplate
  // spent its own rule getting rid of.
  const op = pick.op ?? NODE_SPECS[pick.kind].ops?.[0];
  return {
    ...circuit,
    nodes: [
      ...circuit.nodes,
      {
        id: freeNodeId(circuit, pick.kind),
        kind: pick.kind,
        ...(op ? { op } : {}),
        // Copied, or every node dropped from that preset would share one map
        // and turning a knob on one would turn it on all of them.
        ...(pick.knobs ? { knobs: { ...pick.knobs } } : {}),
        ...(pick.of ? { of: pick.of } : {}),
        ...(pick.kind === 'value' ? { value: 0.5, label: 'knob' } : {}),
        x: 60 + (at % 4) * 200,
        y: 60 + Math.floor(at / 4) * 220,
      },
    ],
  };
}

/**
 * The browser, filtered by what somebody typed.
 *
 * A node matching keeps everything under it, because "show me the effects" is a
 * real thing to type. A preset matching keeps its node with **only** the
 * matching presets under it, so typing `spark` gives one row rather than a
 * `source` you then have to go looking inside. Either way the entry that comes
 * back is drawn open, which is the whole of how search reaches a preset.
 */
export function matching(all: readonly Entry[], typed: string): Entry[] {
  const want = typed.trim().toLowerCase();
  if (!want) return [...all];
  const out: Entry[] = [];
  for (const entry of all) {
    if (entry.node.terms.includes(want)) {
      out.push(entry);
      continue;
    }
    const hits = entry.presets.filter((each) => each.terms.includes(want));
    if (hits.length > 0) out.push({ node: entry.node, presets: hits });
  }
  return out;
}
