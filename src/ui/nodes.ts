import {
  NODE_FAMILIES,
  TRACK_READS,
  type Circuit,
  type CircuitNode,
  type NodeKind,
  type FlowDef,
  type Scheme,
} from '../../protocol.ts';
import {
  NODE_SPECS,
  descriptionOf,
  inletsOf,
  modesOf,
  type PortSpec,
} from '../render/circuit.ts';
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
 * the set and a `flow` names a flow in the library, and those are *targets*
 * rather than presets — instances of something that exists elsewhere. They stay
 * where they were, one entry each, because collapsing "Bass meter" under a
 * generic `track` node is the same mistake in reverse.
 *
 * Presets here are **built in**. A user-saved one needs somewhere in the scheme
 * to live and a name to be saved under, and that decision is better made once
 * these have been used; nothing below is in the way of it.
 */
/** The three signals a cord may carry, in the order everything lists them. */
export type Signal = 'p' | 'n' | 'c';
export const SIGNALS: readonly Signal[] = ['p', 'n', 'c'];

/** What a node takes and what it gives, each a subset of `SIGNALS` in that order. */
export interface Ports {
  takes: readonly Signal[];
  gives: readonly Signal[];
}

/** Nothing asked. The filter's resting state, and what `passes` lets through. */
export const NO_FILTER: Ports = { takes: [], gives: [] };

export interface Pick {
  /** What it is called in the browser, and the only name anyone sees. */
  label: string;
  kind: NodeKind;
  op?: string;
  /** Which thing in the set, for a row that names one. See `CircuitNode.of`. */
  of?: string;
  /** What a preset sets on the node's own inlets. */
  values?: Record<string, number>;
  about: string;
  family: string;
  /** For the search box: everything worth matching on, lowercased. */
  terms: string;
  /**
   * What it takes and what it gives, in the three signals.
   *
   * The metadata column, and it is this rather than a category because it is
   * the one fact you need *before* you drop a node: whether the thing you are
   * holding a cord from can reach it. A browser that made you drop a node to
   * find out its inlets is a browser that costs an undo per question.
   *
   * Structured rather than the `p n → c` string it was, because the browser
   * draws **all three letters on both sides of every row** and dims the ones a
   * node has not got. A signature that changed shape row to row — `→ p` over
   * `p n → c` over `c n → c` — is six silhouettes in one column and scans as
   * noise; six fixed positions scan as a table. It is also what the filter
   * needs: "show me what takes a point" is a question about this.
   */
  ports: Ports;
}

/**
 * One row of the browser: a node, and whatever sits under it.
 *
 * A target is an entry with nothing under it rather than a third kind of thing,
 * which is what keeps a track's meter reading as a flat run of names without
 * anything here having to know they are special.
 */
export interface Entry {
  node: Pick;
  presets: Pick[];
}

/**
 * One row of the **flow** shelf, which is a different shelf on purpose.
 *
 * Flows used to sit in this list as `flow` node rows under `draw`, in the same
 * chip with the same border as `source` and `paint` — so a graph of sixteen
 * nodes and a single shipped shader were the same object to anyone reading the
 * column. That is the mistake every node editor that has one has already made
 * and undone: Blender keeps node groups in their own `Group` submenu, Unreal
 * keeps functions in a panel of their own, and Figma marks an instance with a
 * badge it never takes off.
 *
 * So a flow is not a `Pick`. It has a different row, a different mark and two
 * verbs where a node has one — **open** it to edit, or **place** it as a node
 * in the flow you already have open. Those were previously the same click in
 * two different lists, which is how you end up asking what kind of node `The
 * set` is.
 */
export interface FlowRow {
  id: string;
  name: string;
  /** `9 nodes · reads the set`, which is the whole of why it is not a node. */
  about: string;
  /** How many nodes are inside. A primitive has no answer to this. */
  size: number;
  /** Wired by a roll, and the next roll replaces it. */
  rolled: boolean;
  terms: string;
}

/**
 * The presets that are more than a mode.
 *
 * Most are not, and that is honest rather than lazy: the middle is where
 * these were tuned to sit, so a preset that set every one of them to a half
 * would be a preset that said nothing. `posterize` is the one where the middle
 * is plainly wrong — eight steps is invisible on a projector, and the effect is
 * named after the poster — and it is also the example that started this: an
 * effect you should be able to drop and have *do* something.
 */
const PRESET_VALUES: Record<string, Record<string, number>> = {
  posterize: { steps: 0.78 },
};

/**
 * A row's identity, which is what React keys it by.
 *
 * The **name** is in here as well as the mode, and it stays: nothing in the add
 * browser sets `of` any more, but `swapEntry` builds picks the same way and a
 * key that quietly stopped covering a field is a key that goes wrong the next
 * time something uses it. It cost one interpolation.
 */
export function keyOf(pick: Pick): string {
  return `${pick.kind}:${pick.op ?? ''}:${pick.of ?? ''}`;
}

/**
 * What a kind takes and what it gives, each a subset of `p n c` in that order.
 *
 * Deduplicated, because `n n` says nothing `n` does not: what you read off this
 * is which cords will land, not how many. Always in `p n c` order and never in
 * port order, because the browser draws all three positions on every row and a
 * column whose letters moved about would be unreadable as a column. Ports whose
 * name starts with a tilde are the flattener's own and are hidden here for the
 * same reason the canvas hides them.
 */
export function portsOf(kind: NodeKind): Ports {
  const spec = NODE_SPECS[kind];
  const modes = modesOf(kind);
  // Three kinds grow their inlets from their own mode, so the row is asked
  // about a default one — the same node the row drops.
  const bare: CircuitNode = { id: kind, kind, x: 0, y: 0, ...(modes[0] ? { op: modes[0] } : {}) };
  const side = (ports: readonly PortSpec[]): Signal[] => {
    const held = new Set(
      ports.filter((port) => !port.name.startsWith('~')).map((port) => port.kind),
    );
    return SIGNALS.filter((signal) => held.has(signal));
  };
  return { takes: side(inletsOf(bare)), gives: side(spec.outlets) };
}

/**
 * Whether a row survives the filter. An empty side is a side nobody asked about.
 *
 * Every selected signal has to be present rather than any of them, so ticking
 * *takes p* and *gives c* narrows to nodes that do both — which is the question
 * somebody with a point in one hand and an `out` in the other is asking.
 */
export function passes(ports: Ports, want: Ports): boolean {
  return (
    want.takes.every((signal) => ports.takes.includes(signal)) &&
    want.gives.every((signal) => ports.gives.includes(signal))
  );
}

/**
 * The flow library as browser rows.
 *
 * Built here rather than in the page for the reason the node list is: the two
 * shelves share a search box, and a search that reached one of them through a
 * `terms` string and the other through an ad-hoc `includes` would drift the
 * first time either grew a field.
 */
export function flowShelf(scheme: Scheme): FlowRow[] {
  return Object.entries(scheme.flows).map(([id, def]) => {
    const name = def.name || id;
    const nodes = def.circuit.nodes;
    const about = aboutFlow(def);
    return {
      id,
      name,
      about,
      size: nodes.length,
      rolled: def.rolled === true,
      terms: `${name} ${id} flow ${about}`.toLowerCase(),
    };
  });
}

/**
 * One line about what a flow is made of, which is more useful than its id.
 *
 * The node count leads because it is the whole of the difference between a flow
 * and a primitive: a `source` has no answer to "how many nodes", and a row that
 * says `9 nodes` cannot be mistaken for one. Whether it reads the set is the
 * next thing anyone asks, and how many flows are inside is the only warning
 * that opening this one is opening several.
 */
export function aboutFlow(def: FlowDef): string {
  const nodes = def.circuit.nodes;
  const inside = nodes.filter((node) => node.kind === 'flow').length;
  return [
    `${nodes.length} node${nodes.length === 1 ? '' : 's'}`,
    nodes.some((node) => node.kind === 'tracks') ? 'reads the set' : null,
    inside > 0 ? `${inside} flow${inside === 1 ? '' : 's'} inside` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A flow shelf row as the thing that gets dropped on a canvas.
 *
 * Here rather than in the page because `drop` takes a `Pick` and there should be
 * exactly one place that knows a flow becomes a `flow` node whose `op` is its
 * id — the shelf row deliberately does not carry node fields, so that fact has
 * to live somewhere and this is the only somewhere that already knows both.
 */
export function pickOf(row: FlowRow): Pick {
  return {
    label: row.name,
    kind: 'flow',
    op: row.id,
    about: row.about,
    family: NODE_FAMILIES.find((each) => each.kinds.includes('flow'))?.name ?? 'other',
    terms: row.terms,
    ports: portsOf('flow'),
  };
}

/** The flow shelf, filtered by what somebody typed. One box, two shelves. */
export function matchingFlows(
  all: readonly FlowRow[],
  typed: string,
  want: Ports = NO_FILTER,
): FlowRow[] {
  // Every flow compiles to a `flow` node, so every flow has that node's ports.
  // The shelf answers the signal filter for the same reason it answers the
  // search box: two shelves under one set of controls, or the controls are
  // lying about what they cover.
  if (!passes(portsOf('flow'), want)) return [];
  const typing = typed.trim().toLowerCase();
  if (!typing) return [...all];
  return all.filter((row) => row.terms.includes(typing));
}

/** The whole browser, built from the vocabulary rather than typed out beside it. */
export function palette(): Entry[] {
  const out: Entry[] = [];
  const family = (kind: NodeKind) =>
    NODE_FAMILIES.find((each) => each.kinds.includes(kind))?.name ?? 'other';

  const pick = (
    kind: NodeKind,
    op: string | undefined,
    label: string,
    about: string,
    values?: Record<string, number>,
    of?: string,
  ): Pick => ({
    label,
    kind,
    op,
    ...(of ? { of } : {}),
    ...(values ? { values } : {}),
    about,
    family: family(kind),
    // The kind is in here as well as the mode, so `sine wave` and `song key`
    // find what is now labelled just `sine` and just `key` under their node.
    terms: `${label} ${kind} ${op ?? ''} ${about}`.toLowerCase(),
    ports: portsOf(kind),
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
  // numbers an inlet has never heard of is the kind of coincidence that survives
  // into a file.
  const modes = (kind: NodeKind, label: string) => {
    const spec = NODE_SPECS[kind];
    out.push({
      node: pick(kind, undefined, label, spec.description),
      presets: (spec.modes ?? []).map((mode) =>
        pick(kind, mode.name, mode.name, mode.description, PRESET_VALUES[mode.name]),
      ),
    });
  };

  // Pictures. The set first, because a rig that reads a Live set should offer
  // the Live set before it offers a plasma. It has modes and no presets: `by
  // name` is the answer this rig is for, and the other eleven are one hot-swap
  // away rather than eleven rows here saying "all of them as a tunnel".
  node('tracks', 'by name', 'every playing track', NODE_SPECS.tracks.description);
  modes('source', 'source');
  modes('fractal', 'fractal');
  node('paint', undefined, 'paint', NODE_SPECS.paint.description);
  // No flows. Every flow in the library used to be a row here, in the same chip
  // as `source` and `paint`, which put a graph of sixteen nodes and a shipped
  // shader side by side under one heading as if they were the same sort of
  // thing. They have a shelf of their own now — see `flowShelf`.

  // Colour, and only what is actually colour: `grade` changes it where it is
  // and `spread` reads around it. The six modes that used to sit beside them
  // under `effect` never touched a colour at all — they are `lens` now, down in
  // geometry with the five kinds they were already the same functions as.
  modes('grade', 'grade');
  modes('spread', 'spread');
  modes('blend', 'blend');

  // Geometry. `place` sits next to `point` rather than next to `polar`,
  // because the two of them are what a canvas gets a point *from* and `polar`
  // is what it turns one back into.
  node('point', undefined, 'point', NODE_SPECS.point.description);
  node('place', undefined, NODE_SPECS.place.name, NODE_SPECS.place.description);
  modes('lens', 'lens');
  node('polar', undefined, NODE_SPECS.polar.name, NODE_SPECS.polar.description);

  // The room: three questions you can ask the set, and nothing else can answer.
  modes('playback', 'playback');
  // **One `track` row**, not one per name in the set. It was one each, on the
  // argument that a name from the set is the thing in this browser nobody could
  // guess — which is true and is the search box's job, not the list's. A set
  // with twenty-six tracks put twenty-six near-identical rows under one heading
  // and buried `playback` and `song` beneath them, and the node has carried a
  // chooser for which track the whole time. So the row drops a meter and you
  // pick the track on its face, the way you pick a flow on a `flow` node.
  node('track', TRACK_READS[0], 'track', NODE_SPECS.track.description);
  modes('song', 'song');

  // Numbers.
  node('value', undefined, 'value', NODE_SPECS.value.description);
  modes('math', 'math');
  modes('wave', 'wave');

  // No `out`. Every flow has exactly one, it arrives with the flow, and it
  // cannot be deleted — so a browser offering another one is offering the only
  // node in the vocabulary that makes a flow refuse to compile. It was there
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
  const op = pick.op ?? modesOf(pick.kind)[0];
  return {
    ...circuit,
    nodes: [
      ...circuit.nodes,
      {
        id: freeNodeId(circuit, pick.kind),
        kind: pick.kind,
        ...(op ? { op } : {}),
        // Copied, or every node dropped from that preset would share one map
        // and turning one of them would turn it on all of them.
        ...(pick.values ? { values: { ...pick.values } } : {}),
        ...(pick.of ? { of: pick.of } : {}),
        ...(pick.kind === 'value' ? { value: 0.5, label: 'value' } : {}),
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
export function matching(
  all: readonly Entry[],
  typed: string,
  want: Ports = NO_FILTER,
): Entry[] {
  const typing = typed.trim().toLowerCase();
  // The signal filter runs on the **node** rather than on each preset, because
  // a mode never changes what a kind takes or gives — the ports come off the
  // spec, and every preset under a row shares them.
  const all2 = all.filter((entry) => passes(entry.node.ports, want));
  if (!typing) return all2;
  const out: Entry[] = [];
  for (const entry of all2) {
    if (entry.node.terms.includes(typing)) {
      out.push(entry);
      continue;
    }
    const hits = entry.presets.filter((each) => each.terms.includes(typing));
    if (hits.length > 0) out.push({ node: entry.node, presets: hits });
  }
  return out;
}

/**
 * One kind's modes, for the hot-swap button on a face.
 *
 * This is deliberately not the ordinary palette filtered by kind. A `track`
 * row there is a target — one per name in the set — while hot-swap changes the
 * fixed reading on the node and must offer `level`, `fader` and `playing` once.
 * `tracks` has the inverse wrinkle: its alternative drawings stay folded out
 * of the add browser, but have to be reachable now that the face has no mode
 * dropdown of its own.
 */
export function swapEntry(kind: NodeKind): Entry | null {
  const spec = NODE_SPECS[kind];
  if (!spec.modes || spec.modes.length === 0) return null;
  const family = NODE_FAMILIES.find((each) => each.kinds.includes(kind))?.name ?? 'other';
  const pick = (op: string, label: string, values?: Record<string, number>): Pick => ({
    label,
    kind,
    op,
    ...(values ? { values } : {}),
    about: descriptionOf(kind, op),
    family,
    terms: `${label} ${kind} ${op} ${descriptionOf(kind, op)}`.toLowerCase(),
    ports: portsOf(kind),
  });
  return {
    node: pick(spec.modes[0].name, spec.name),
    presets: spec.modes.map((mode) => pick(mode.name, mode.name, PRESET_VALUES[mode.name])),
  };
}
