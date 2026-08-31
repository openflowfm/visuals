import type {
  CandidateDraft,
  EvidenceCandidate,
  LabEncounterDraft,
  LabSearchMethod,
  SearchEvidence,
} from '../lab.ts';
import type { Circuit, CircuitNode, NodeKind } from '../protocol.ts';
import { WORDS } from '../randomize.ts';
import {
  compileCircuit,
  inletsOf,
  modesOf,
  NODE_SPECS,
  signalOf,
  splitPort,
  strandedNodes,
  wouldFeedItself,
  type Signal,
} from '../src/render/circuit.ts';
import { NODE_KINDS } from '../src/nodes/generated.ts';

type Rng = () => number;

const pick = <T>(rng: Rng, values: readonly T[]): T =>
  values[Math.floor(rng() * values.length)];
const chance = (rng: Rng, probability: number): boolean => rng() < probability;
const rounded = (value: number): number => Math.round(value * 100) / 100;

const cloneCircuit = (circuit: Circuit): Circuit => ({
  nodes: circuit.nodes.map((node) => ({
    ...node,
    ...(node.values ? { values: { ...node.values } } : {}),
    ...(node.depths ? { depths: { ...node.depths } } : {}),
  })),
  cords: circuit.cords.map((cord) => ({ ...cord })),
});

const modeFor = (kind: NodeKind, rng: Rng, feedback = false): string | undefined => {
  const modes = modesOf(kind).filter((mode) => feedback || mode !== 'creep');
  return modes.length > 0 ? pick(rng, modes) : undefined;
};

/** One ordinary node, with only behavior-bearing defaults chosen here. */
function randomNode(kind: NodeKind, id: string, x: number, y: number, rng: Rng): CircuitNode {
  const op = modeFor(kind, rng);
  const node: CircuitNode = {
    id,
    kind,
    x,
    y,
    ...(op ? { op } : {}),
    ...(kind === 'track'
      ? { of: 'master', smooth: rounded(0.15 + rng() * 0.65) }
      : {}),
    ...(kind === 'value' ? { value: rounded(rng()), label: 'value' } : {}),
  };
  const numbers = inletsOf(node).filter((port) => port.kind === 'n');
  if (numbers.length > 0 && chance(rng, 0.55)) {
    const port = pick(rng, numbers);
    node.values = { [port.name]: rounded(0.08 + rng() * 0.84) };
  }
  return node;
}

const hasOutlet = (kind: NodeKind, signal: Signal): boolean =>
  NODE_SPECS[kind].outlets.some((port) => port.kind === signal);

const hasInlet = (node: CircuitNode, signal: Signal): boolean =>
  inletsOf(node).some((port) => port.kind === signal);

/** Pictures which make something from their own defaults, without a file or library. */
const COLOUR_TERMINALS = NODE_KINDS.filter((kind) => {
  if (['flow', 'image', 'video', 'last', 'take', 'give', 'out'].includes(kind)) return false;
  const sample: CircuitNode = { id: '~', kind, x: 0, y: 0, ...(modesOf(kind)[0] ? { op: modesOf(kind)[0] } : {}) };
  return hasOutlet(kind, 'c') && !hasInlet(sample, 'c');
});

/** Colour nodes which can be inserted into an existing picture cord. */
const COLOUR_WRAPPERS: readonly NodeKind[] = ['grade', 'lens', 'spread', 'halftone'];

/** Number sources which are useful without another node being wired into them. */
const NUMBER_TERMINALS: readonly NodeKind[] = [
  'value',
  'playback',
  'track',
  'song',
  'wave',
  'lfo',
  'polar',
];

const nextId = (circuit: Circuit): string => {
  const ids = new Set(circuit.nodes.map((node) => node.id));
  for (let at = 0; ; at++) if (!ids.has(`n${at}`)) return `n${at}`;
};

const outletOf = (node: CircuitNode, signal: Signal): string | null => {
  const port = NODE_SPECS[node.kind].outlets.find((candidate) => candidate.kind === signal);
  return port ? `${node.id}/${port.name}` : null;
};

const inletOf = (node: CircuitNode, signal: Signal): string | null => {
  const port = inletsOf(node).find((candidate) => candidate.kind === signal);
  return port ? `${node.id}/${port.name}` : null;
};

/**
 * A small graph sampled from the typed vocabulary rather than from an authored
 * visual recipe. Construction begins with any self-sufficient picture and then
 * applies generic graph edits: wrap it, move a point, drive a number, or branch.
 */
export function randomCircuit(rng: Rng, maximumNodes = 7): Circuit {
  for (let attempt = 0; attempt < 32; attempt++) {
    const first = randomNode(pick(rng, COLOUR_TERMINALS), 'n0', 40, 80, rng);
    const out: CircuitNode = { id: 'out', kind: 'out', x: 760, y: 120 };
    const circuit: Circuit = {
      nodes: [first, out],
      cords: [{ from: outletOf(first, 'c')!, to: 'out/c' }],
    };
    const target = Math.max(2, 3 + Math.floor(rng() * Math.max(1, maximumNodes - 2)));

    for (let step = 0; step < 24 && circuit.nodes.length < target; step++) {
      const room = target - circuit.nodes.length;
      const operations = ['wrap', 'point', 'driver', ...(room >= 2 ? ['branch'] : [])];
      const operation = pick(rng, operations);
      const id = nextId(circuit);

      if (operation === 'wrap') {
        const carried = circuit.cords.find((cord) => cord.to === 'out/c');
        if (!carried) continue;
        const node = randomNode(
          pick(rng, COLOUR_WRAPPERS),
          id,
          160 + circuit.nodes.length * 82,
          80,
          rng,
        );
        const inlet = inletOf(node, 'c');
        const outlet = outletOf(node, 'c');
        if (!inlet || !outlet) continue;
        circuit.nodes.splice(circuit.nodes.length - 1, 0, node);
        circuit.cords = circuit.cords.filter((cord) => cord !== carried);
        circuit.cords.push({ from: carried.from, to: inlet }, { from: outlet, to: 'out/c' });
        continue;
      }

      if (operation === 'point') {
        const targets = circuit.nodes.flatMap((node) => {
          const inlet = inletsOf(node).find((port) => port.kind === 'p');
          if (!inlet || circuit.cords.some((cord) => cord.to === `${node.id}/${inlet.name}`)) return [];
          return [{ node, inlet: `${node.id}/${inlet.name}` }];
        });
        if (targets.length === 0) continue;
        const targetNode = pick(rng, targets);
        const colourOutlets = circuit.nodes.flatMap((node) =>
          NODE_SPECS[node.kind].outlets
            .filter((port) => port.kind === 'c')
            .map((port) => `${node.id}/${port.name}`),
        );
        const displaced = colourOutlets.length > 0 && chance(rng, 0.22);
        const node = randomNode(
          displaced ? 'displace' : 'lens',
          id,
          targetNode.node.x - 150,
          targetNode.node.y + 170,
          rng,
        );
        circuit.nodes.splice(circuit.nodes.length - 1, 0, node);
        circuit.cords.push({ from: `${id}/p`, to: targetNode.inlet });
        if (displaced) {
          circuit.cords.push({ from: pick(rng, colourOutlets), to: `${id}/field` });
        }
        continue;
      }

      if (operation === 'driver') {
        const targets = circuit.nodes.flatMap((node) =>
          inletsOf(node)
            .filter(
              (port) =>
                port.kind === 'n' &&
                !circuit.cords.some((cord) => cord.to === `${node.id}/${port.name}`),
            )
            .map((port) => `${node.id}/${port.name}`),
        );
        if (targets.length === 0) continue;
        const colourOutlets = circuit.nodes.flatMap((node) =>
          NODE_SPECS[node.kind].outlets
            .filter((port) => port.kind === 'c')
            .map((port) => `${node.id}/${port.name}`),
        );
        const readsPicture = colourOutlets.length > 0 && chance(rng, 0.18);
        const node = randomNode(
          readsPicture ? 'read' : pick(rng, NUMBER_TERMINALS),
          id,
          80 + circuit.nodes.length * 70,
          300,
          rng,
        );
        const outlets = NODE_SPECS[node.kind].outlets.filter((port) => port.kind === 'n');
        if (outlets.length === 0) continue;
        circuit.nodes.splice(circuit.nodes.length - 1, 0, node);
        circuit.cords.push({ from: `${id}/${pick(rng, outlets).name}`, to: pick(rng, targets) });
        if (readsPicture) {
          circuit.cords.push({ from: pick(rng, colourOutlets), to: `${id}/c` });
        }
        continue;
      }

      const carried = circuit.cords.find((cord) => cord.to === 'out/c');
      if (!carried) continue;
      const picture = randomNode(
        chance(rng, 0.16) ? 'last' : pick(rng, COLOUR_TERMINALS),
        id,
        100 + circuit.nodes.length * 70,
        290,
        rng,
      );
      const blendId = `${id}b`;
      const blend = randomNode('blend', blendId, 560, 120, rng);
      circuit.nodes.splice(circuit.nodes.length - 1, 0, picture, blend);
      circuit.cords = circuit.cords.filter((cord) => cord !== carried);
      circuit.cords.push(
        { from: carried.from, to: `${blendId}/base` },
        { from: outletOf(picture, 'c')!, to: `${blendId}/top` },
        { from: `${blendId}/c`, to: 'out/c' },
      );
    }

    const compiled = compileCircuit(circuit);
    if (!compiled.error && compiled.source && whole(circuit)) return circuit;
  }
  // This is the smallest useful graph and a visible failure mode if the
  // vocabulary ever changes so far that the generic constructor gets stuck.
  return {
    nodes: [
      { id: 'n0', kind: 'tracks', op: 'by name', x: 40, y: 80 },
      { id: 'out', kind: 'out', x: 360, y: 80 },
    ],
    cords: [{ from: 'n0/c', to: 'out/c' }],
  };
}

export interface AtomicMutation {
  circuit: Circuit;
  operation: string;
  data: Record<string, unknown>;
}

type Mutator = (circuit: Circuit, rng: Rng, maximumNodes: number) => AtomicMutation | null;

const changeMode: Mutator = (source, rng) => {
  const feedback = source.nodes.some((node) => node.kind === 'last');
  const candidates = source.nodes.filter((node) => {
    const modes = modesOf(node.kind).filter((mode) => feedback || mode !== 'creep');
    return modes.some((mode) => mode !== node.op);
  });
  if (candidates.length === 0) return null;
  const circuit = cloneCircuit(source);
  const chosen = pick(rng, candidates);
  const node = circuit.nodes.find((held) => held.id === chosen.id)!;
  const before = node.op ?? modesOf(node.kind)[0];
  const modes = modesOf(node.kind).filter(
    (mode) => mode !== before && (feedback || mode !== 'creep'),
  );
  node.op = pick(rng, modes);
  const inlets = new Set(inletsOf(node).map((port) => port.name));
  node.values = Object.fromEntries(
    Object.entries(node.values ?? {}).filter(([name]) => inlets.has(name)),
  );
  node.depths = Object.fromEntries(
    Object.entries(node.depths ?? {}).filter(([name]) => inlets.has(name)),
  );
  circuit.cords = circuit.cords.filter((cord) => {
    const to = splitPort(cord.to);
    return to.node !== node.id || inlets.has(to.port);
  });
  return {
    circuit,
    operation: 'mutate:mode',
    data: { node: node.id, kind: node.kind, from: before, to: node.op },
  };
};

const tuneValue: Mutator = (source, rng) => {
  const candidates = source.nodes.flatMap((node) =>
    inletsOf(node)
      .filter((port) => port.kind === 'n')
      .map((port) => ({ node, port })),
  );
  if (candidates.length === 0) return null;
  const chosen = pick(rng, candidates);
  const circuit = cloneCircuit(source);
  const node = circuit.nodes.find((held) => held.id === chosen.node.id)!;
  const before = node.values?.[chosen.port.name] ?? chosen.port.at ?? null;
  let value = rounded(rng());
  if (before !== null && Math.abs(value - before) < 0.12) value = rounded((value + 0.37) % 1);
  node.values = { ...(node.values ?? {}), [chosen.port.name]: value };
  return {
    circuit,
    operation: 'mutate:value',
    data: { node: node.id, inlet: chosen.port.name, from: before, to: value },
  };
};

const tuneDepth: Mutator = (source, rng) => {
  const candidates = source.cords.flatMap((cord) => {
    if (signalOf(source, cord.to) !== 'n') return [];
    const to = splitPort(cord.to);
    return [{ cord, node: source.nodes.find((node) => node.id === to.node)!, inlet: to.port }];
  });
  if (candidates.length === 0) return null;
  const chosen = pick(rng, candidates);
  const circuit = cloneCircuit(source);
  const node = circuit.nodes.find((held) => held.id === chosen.node.id)!;
  const before = node.depths?.[chosen.inlet] ?? 1;
  let depth = rounded(rng() * 2 - 1);
  if (Math.abs(depth - before) < 0.12) depth = rounded(depth > 0 ? depth - 0.31 : depth + 0.31);
  node.depths = { ...(node.depths ?? {}), [chosen.inlet]: depth };
  return {
    circuit,
    operation: 'mutate:depth',
    data: { node: node.id, inlet: chosen.inlet, from: before, to: depth },
  };
};

const INSERTS: Record<Signal, readonly NodeKind[]> = {
  c: ['grade', 'lens', 'spread', 'halftone'],
  p: ['lens', 'displace'],
  n: ['wave', 'math'],
};

const insertNode: Mutator = (source, rng, maximumNodes) => {
  if (source.nodes.length >= maximumNodes || source.cords.length === 0) return null;
  const cord = pick(rng, source.cords);
  const signal = signalOf(source, cord.from);
  if (!signal) return null;
  const circuit = cloneCircuit(source);
  const id = nextId(circuit);
  const node = randomNode(pick(rng, INSERTS[signal]), id, 300, 160, rng);
  const inlet = inletOf(node, signal);
  const outlet = outletOf(node, signal);
  if (!inlet || !outlet) return null;
  const fields = source.nodes.flatMap((held) =>
    NODE_SPECS[held.kind].outlets
      .filter((port) => port.kind === 'c')
      .map((port) => `${held.id}/${port.name}`),
  );
  if (node.kind === 'displace' && fields.length === 0) return null;
  circuit.nodes.splice(circuit.nodes.findIndex((held) => held.kind === 'out'), 0, node);
  circuit.cords = circuit.cords.filter(
    (held) => held.from !== cord.from || held.to !== cord.to,
  );
  circuit.cords.push({ from: cord.from, to: inlet }, { from: outlet, to: cord.to });
  const field = node.kind === 'displace' ? pick(rng, fields) : null;
  if (field) circuit.cords.push({ from: field, to: `${id}/field` });
  return {
    circuit,
    operation: 'mutate:insert',
    data: {
      node: id,
      kind: node.kind,
      mode: node.op ?? null,
      between: [cord.from, cord.to],
      ...(field ? { field } : {}),
    },
  };
};

const addDriver: Mutator = (source, rng, maximumNodes) => {
  if (source.nodes.length >= maximumNodes) return null;
  const candidates = source.nodes.flatMap((node) =>
    inletsOf(node)
      .filter(
        (port) =>
          port.kind === 'n' &&
          !source.cords.some((cord) => cord.to === `${node.id}/${port.name}`),
      )
      .map((port) => `${node.id}/${port.name}`),
  );
  if (candidates.length === 0) return null;
  const circuit = cloneCircuit(source);
  const target = pick(rng, candidates);
  const id = nextId(circuit);
  const colourOutlets = source.nodes.flatMap((node) =>
    NODE_SPECS[node.kind].outlets
      .filter((port) => port.kind === 'c')
      .map((port) => `${node.id}/${port.name}`),
  );
  const readsPicture = colourOutlets.length > 0 && chance(rng, 0.2);
  const node = randomNode(
    readsPicture ? 'read' : pick(rng, NUMBER_TERMINALS),
    id,
    140,
    330,
    rng,
  );
  const outlets = NODE_SPECS[node.kind].outlets.filter((port) => port.kind === 'n');
  if (outlets.length === 0) return null;
  const outlet = pick(rng, outlets).name;
  circuit.nodes.splice(circuit.nodes.findIndex((held) => held.kind === 'out'), 0, node);
  circuit.cords.push({ from: `${id}/${outlet}`, to: target });
  const picture = readsPicture ? pick(rng, colourOutlets) : null;
  if (picture) circuit.cords.push({ from: picture, to: `${id}/c` });
  return {
    circuit,
    operation: 'mutate:drive',
    data: {
      node: id,
      kind: node.kind,
      mode: node.op ?? null,
      outlet,
      target,
      ...(picture ? { picture } : {}),
    },
  };
};

const removeNode: Mutator = (source, rng) => {
  const candidates = source.nodes.flatMap((node) => {
    if (node.kind === 'out') return [];
    const incoming = source.cords.filter((cord) => splitPort(cord.to).node === node.id);
    const outgoing = source.cords.filter((cord) => splitPort(cord.from).node === node.id);
    if (incoming.length !== 1 || outgoing.length === 0) return [];
    const signal = signalOf(source, incoming[0].from);
    if (!signal || outgoing.some((cord) => signalOf(source, cord.from) !== signal)) return [];
    return [{ node, incoming, outgoing }];
  });
  if (candidates.length === 0) return null;
  const chosen = pick(rng, candidates);
  const circuit = cloneCircuit(source);
  circuit.nodes = circuit.nodes.filter((node) => node.id !== chosen.node.id);
  circuit.cords = circuit.cords.filter(
    (cord) =>
      splitPort(cord.from).node !== chosen.node.id && splitPort(cord.to).node !== chosen.node.id,
  );
  for (const outgoing of chosen.outgoing) {
    circuit.cords.push({ from: chosen.incoming[0].from, to: outgoing.to });
  }
  return {
    circuit,
    operation: 'mutate:remove',
    data: { node: chosen.node.id, kind: chosen.node.kind },
  };
};

const rewire: Mutator = (source, rng) => {
  const candidates = source.cords.flatMap((cord) => {
    const signal = signalOf(source, cord.to);
    if (!signal) return [];
    const without = {
      nodes: source.nodes,
      cords: source.cords.filter((held) => held !== cord),
    };
    const alternatives = source.nodes.flatMap((node) =>
      NODE_SPECS[node.kind].outlets
        .filter((port) => port.kind === signal)
        .map((port) => `${node.id}/${port.name}`)
        .filter(
          (from) =>
            from !== cord.from && !wouldFeedItself(without, from, cord.to),
        ),
    );
    return alternatives.length > 0 ? [{ cord, alternatives }] : [];
  });
  if (candidates.length === 0) return null;
  const chosen = pick(rng, candidates);
  const circuit = cloneCircuit(source);
  const cord = circuit.cords.find(
    (held) => held.from === chosen.cord.from && held.to === chosen.cord.to,
  )!;
  const before = cord.from;
  cord.from = pick(rng, chosen.alternatives);
  return {
    circuit,
    operation: 'mutate:rewire',
    data: { target: cord.to, from: before, to: cord.from },
  };
};

const addBlend: Mutator = (source, rng, maximumNodes) => {
  if (source.nodes.length >= maximumNodes) return null;
  const cords = source.cords.filter((cord) => signalOf(source, cord.from) === 'c');
  if (cords.length === 0) return null;
  const carried = pick(rng, cords);
  const without = {
    nodes: source.nodes,
    cords: source.cords.filter((cord) => cord !== carried),
  };
  const alternatives = source.nodes.flatMap((node) =>
    NODE_SPECS[node.kind].outlets
      .filter((port) => port.kind === 'c')
      .map((port) => `${node.id}/${port.name}`)
      .filter(
        (from) =>
          from !== carried.from && !wouldFeedItself(without, from, carried.to),
      ),
  );
  if (alternatives.length === 0) return null;
  const circuit = cloneCircuit(source);
  const id = nextId(circuit);
  const node = randomNode('blend', id, 420, 150, rng);
  const top = pick(rng, alternatives);
  circuit.nodes.splice(circuit.nodes.findIndex((held) => held.kind === 'out'), 0, node);
  circuit.cords = circuit.cords.filter(
    (cord) => cord.from !== carried.from || cord.to !== carried.to,
  );
  circuit.cords.push(
    { from: carried.from, to: `${id}/base` },
    { from: top, to: `${id}/top` },
    { from: `${id}/c`, to: carried.to },
  );
  return {
    circuit,
    operation: 'mutate:blend',
    data: { node: id, mode: node.op ?? null, base: carried.from, top, target: carried.to },
  };
};

const MUTATORS: readonly Mutator[] = [
  changeMode,
  tuneValue,
  tuneDepth,
  insertNode,
  addDriver,
  removeNode,
  rewire,
  addBlend,
];

/**
 * Nothing in this circuit is doing nothing.
 *
 * A branch that never reaches a door draws no pixel, so a graph carrying one is
 * *visually identical* to the same graph without it. Three things go wrong if
 * one becomes a candidate anyway. Its id is a hash of the whole circuit, so the
 * same picture enters the corpus twice under two ids. It arrives as its own dot
 * and its own comparison, spending the scarcest thing here — attention — on a
 * work already judged. And it eats the generation's node ceiling with nodes
 * that draw nothing.
 *
 * The check belongs to the **candidate**, never to the edit. See `leap`: the
 * steps inside one exploratory jump may strand whatever they like, because that
 * jump is judged whole and is the one place where stranding a branch and
 * blending it back in is a change somebody can actually see. Gating each step
 * instead would delete that path and bias the operator set, which is a much
 * larger loss than the duplicates it would save.
 */
const whole = (circuit: Circuit): boolean => strandedNodes(circuit).length === 0;

/**
 * One atomic edit whose result is a candidate: valid, and with nothing
 * stranded. Resampled rather than repaired — pruning the branch would make the
 * recorded operation stop describing what actually happened.
 */
function wholeMutation(
  circuit: Circuit,
  rng: Rng,
  maximumNodes: number,
  avoid?: ReadonlySet<string>,
): AtomicMutation | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const mutation = mutateCircuit(circuit, rng, maximumNodes, avoid);
    if (!mutation) return null;
    if (whole(mutation.circuit)) return mutation;
  }
  return null;
}

/** One behavior-changing edit. An addition introduces at most one node. */
export function mutateCircuit(
  circuit: Circuit,
  rng: Rng,
  maximumNodes = 8,
  avoid: ReadonlySet<string> = new Set(),
): AtomicMutation | null {
  for (let attempt = 0; attempt < MUTATORS.length * 3; attempt++) {
    const mutation = pick(rng, MUTATORS)(circuit, rng, maximumNodes);
    if (
      mutation &&
      !avoid.has(mutation.operation) &&
      compileCircuit(mutation.circuit).error === null
    ) {
      return mutation;
    }
  }
  return null;
}

const name = (rng: Rng): string => {
  const word = () => pick(rng, WORDS);
  const first = word();
  return `${first[0].toUpperCase()}${first.slice(1)} ${word()}`;
};

const FRONTIER_SIZE = 8;
const IMMIGRANT_INTERVAL = 5;
const GLOBAL_SAMPLES = 12;
const LOCAL_SAMPLES = 10;

const setDistance = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return 1 - shared / union.size;
};

/**
 * A transport-free structural distance. It is intentionally made from graph
 * facts rather than named visual genres: node/mode vocabulary, typed topology,
 * scale and held controls. The scheduler can seek novelty without deciding in
 * advance what a visual personality is called.
 */
export function circuitDistance(left: Circuit, right: Circuit): number {
  const vocabulary = (circuit: Circuit) =>
    new Set(circuit.nodes.flatMap((node) => [`kind:${node.kind}`, `mode:${node.kind}:${node.op ?? ''}`]));
  const topology = (circuit: Circuit) => {
    const nodes = new Map(circuit.nodes.map((node) => [node.id, node]));
    return new Set(
      circuit.cords.map((cord) => {
        const from = splitPort(cord.from);
        const to = splitPort(cord.to);
        return `${nodes.get(from.node)?.kind ?? '?'}:${from.port}>${nodes.get(to.node)?.kind ?? '?'}:${to.port}`;
      }),
    );
  };
  const scale =
    Math.abs(left.nodes.length - right.nodes.length) /
      Math.max(left.nodes.length, right.nodes.length, 1) +
    Math.abs(left.cords.length - right.cords.length) /
      Math.max(left.cords.length, right.cords.length, 1);
  const controls = (circuit: Circuit) =>
    new Map(
      circuit.nodes.flatMap((node) => [
        ...Object.entries(node.values ?? {}).map(([key, value]) => [`${node.id}:v:${key}`, value] as const),
        ...Object.entries(node.depths ?? {}).map(([key, value]) => [`${node.id}:d:${key}`, value] as const),
      ]),
    );
  const leftControls = controls(left);
  const rightControls = controls(right);
  const controlKeys = new Set([...leftControls.keys(), ...rightControls.keys()]);
  let controlDistance = 0;
  for (const key of controlKeys) {
    const a = leftControls.get(key);
    const b = rightControls.get(key);
    controlDistance += a === undefined || b === undefined ? 1 : Math.min(1, Math.abs(a - b));
  }
  if (controlKeys.size > 0) controlDistance /= controlKeys.size;
  return Math.min(
    1,
    setDistance(vocabulary(left), vocabulary(right)) * 0.45 +
      setDistance(topology(left), topology(right)) * 0.25 +
      Math.min(1, scale / 2) * 0.15 +
      controlDistance * 0.15,
  );
}

const family = (rng: Rng): string =>
  `family-${Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0')}`;

const randomDraft = (rng: Rng): CandidateDraft => ({
  flow: { name: name(rng), circuit: randomCircuit(rng) },
  bundle: {},
  parents: [],
  operation: 'random',
  operationData: { maximumNodes: 7 },
  generation: 0,
  cohort: family(rng),
});

/**
 * One fresh root, judged alone.
 *
 * The whole of Explore's generation policy, and the interesting thing about it
 * is what it no longer does. `globalExplore` sampled twelve of these and showed
 * the two most structurally distant, which meant ten new ideas were discarded
 * unseen for every question asked — a pairing cost paid in exactly the currency
 * the search is shortest on. A seed judged on its own merits is one look and
 * one key, so every sample reaches a person, and "what fraction of random roots
 * are worth anything" becomes a number the corpus can answer about its own
 * generator rather than a thing nobody can see.
 */
export const seedDraft = (rng: Rng): CandidateDraft => randomDraft(rng);

/**
 * How many mutations are drawn for every one that is kept.
 *
 * Oversampling is what makes a batch a spread of directions rather than a
 * handful of near-duplicates: the survivors are chosen for being unlike each
 * other, and a pool the size of the batch would leave nothing to choose from.
 */
const BATCH_OVERSAMPLE = 4;

/** Batches mix one-step and several-step children; this is the share of leaps. */
const BATCH_LEAP_SHARE = 0.45;

/**
 * A parent's children, generated together and judged together.
 *
 * Deliberately mixed. A one-step child answers *which knob* — it is the causal
 * question the old Refine phase asked, and its operand names the single edit
 * responsible for any difference. A leap answers *which future*, and is the
 * only path where stranding a branch and blending it back in is a change
 * somebody can see, because the steps are judged as one jump. Running both in
 * one field means a single set of comparisons answers both questions against
 * the same parent under the same room, which is the control the scattered
 * pairwise record never had.
 *
 * The survivors are picked for being unlike one another rather than for being
 * good: nothing here has been judged yet, and letting a distance metric guess
 * at quality is how a dealer's opinion gets in front of the person's. What it
 * may legitimately do is refuse to ask the same question twice.
 */
export function batchDrafts(
  parent: EvidenceCandidate,
  count: number,
  rng: Rng,
): CandidateDraft[] {
  const limit = nodeLimit(parent.generation + 1);
  const pool: CandidateDraft[] = [];
  const seen = new Set<string>([JSON.stringify(parent.flow.circuit)]);

  const admit = (draft: CandidateDraft | null) => {
    if (!draft) return;
    const key = JSON.stringify(draft.flow.circuit);
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(draft);
  };

  for (let attempt = 0; attempt < count * BATCH_OVERSAMPLE * 3 && pool.length < count * BATCH_OVERSAMPLE; attempt++) {
    if (chance(rng, BATCH_LEAP_SHARE)) {
      const made = leap(parent, rng);
      admit(made?.draft ?? null);
      continue;
    }
    const mutation = wholeMutation(parent.flow.circuit, rng, limit);
    if (!mutation) continue;
    admit({
      flow: { name: name(rng), circuit: mutation.circuit },
      bundle: parent.bundle,
      parents: [parent.id],
      operation: mutation.operation,
      operationData: mutation.data,
      generation: parent.generation + 1,
      cohort: parent.cohort,
    });
  }

  // A greedy spread: take one, then repeatedly take whichever remaining child
  // is least like everything already taken. The same beam the frontier used,
  // with the quality term removed, because there is no evidence yet to weigh.
  const chosen: CandidateDraft[] = [];
  while (pool.length > 0 && chosen.length < count) {
    let bestAt = 0;
    let best = -Infinity;
    for (let at = 0; at < pool.length; at++) {
      const novelty =
        chosen.length === 0
          ? 0
          : Math.min(
              ...chosen.map((other) =>
                circuitDistance(pool[at].flow.circuit, other.flow.circuit),
              ),
            );
      if (novelty > best) {
        best = novelty;
        bestAt = at;
      }
    }
    chosen.push(pool.splice(bestAt, 1)[0]);
  }
  return chosen;
}

const farthest = <T>(values: readonly T[], distance: (a: T, b: T) => number): [T, T] | null => {
  let best: [T, T] | null = null;
  let bestDistance = -1;
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) {
      const held = distance(values[left], values[right]);
      if (held > bestDistance) {
        bestDistance = held;
        best = [values[left], values[right]];
      }
    }
  }
  return best;
};

const globalExplore = (rng: Rng): LabEncounterDraft | null => {
  const samples = Array.from({ length: GLOBAL_SAMPLES }, () => randomDraft(rng));
  const pair = farthest(samples, (a, b) => circuitDistance(a.flow.circuit, b.flow.circuit));
  if (!pair) return null;
  return {
    phase: 'explore',
    anchorId: null,
    left: { kind: 'draft', candidate: pair[0] },
    right: { kind: 'draft', candidate: pair[1] },
    depth: 0,
  };
};

interface Leap {
  draft: CandidateDraft;
  distance: number;
}

const nodeLimit = (generation: number): number => Math.min(18, 8 + Math.floor(generation / 2));

/** A visible exploratory leap: several exact atomic operations, all retained. */
function leap(parent: EvidenceCandidate, rng: Rng): Leap | null {
  let circuit = parent.flow.circuit;
  const steps: { operation: string; data: Record<string, unknown> }[] = [];
  const used = new Set<string>();
  const target = 2 + Math.floor(rng() * 3);
  for (let at = 0; at < target; at++) {
    let mutation = mutateCircuit(circuit, rng, nodeLimit(parent.generation + 1), used);
    if (!mutation) mutation = mutateCircuit(circuit, rng, nodeLimit(parent.generation + 1));
    if (!mutation) break;
    circuit = mutation.circuit;
    used.add(mutation.operation);
    steps.push({ operation: mutation.operation, data: mutation.data });
  }
  // The steps above were free to strand a branch; the jump they add up to is
  // not. This is the one path where stranding something and blending it back in
  // is a single visible change, which is exactly why it is checked here and not
  // inside the loop.
  if (steps.length < 2 || !whole(circuit)) return null;
  const distance = circuitDistance(parent.flow.circuit, circuit);
  return {
    distance,
    draft: {
      flow: { name: name(rng), circuit },
      bundle: parent.bundle,
      parents: [parent.id],
      operation: 'explore:leap',
      operationData: { distance, steps },
      generation: parent.generation + 1,
      cohort: parent.cohort,
    },
  };
}

const localExplore = (parent: EvidenceCandidate, rng: Rng): LabEncounterDraft | null => {
  const samples: Leap[] = [];
  for (let at = 0; at < LOCAL_SAMPLES; at++) {
    const made = leap(parent, rng);
    if (made) samples.push(made);
  }
  const pair = farthest(
    samples,
    (a, b) =>
      circuitDistance(a.draft.flow.circuit, b.draft.flow.circuit) +
      (a.distance + b.distance) * 0.2,
  );
  if (!pair) return null;
  return {
    phase: 'explore',
    anchorId: parent.id,
    left: { kind: 'draft', candidate: pair[0].draft },
    right: { kind: 'draft', candidate: pair[1].draft },
    depth: parent.generation + 1,
  };
};

const refine = (
  parent: EvidenceCandidate,
  evidence: SearchEvidence,
  rng: Rng,
): LabEncounterDraft | null => {
  const tried = new Set(
    evidence.comparisons
      .filter((comparison) => comparison.phase === 'refine' && comparison.anchorId === parent.id)
      .flatMap((comparison) => {
        const childId = comparison.leftId === parent.id ? comparison.rightId : comparison.leftId;
        const child = evidence.candidates.find((candidate) => candidate.id === childId);
        return child ? [child.operation] : [];
      }),
  );
  let mutation = wholeMutation(parent.flow.circuit, rng, nodeLimit(parent.generation + 1), tried);
  if (!mutation) mutation = wholeMutation(parent.flow.circuit, rng, nodeLimit(parent.generation + 1));
  if (!mutation) return null;
  return {
    phase: 'refine',
    anchorId: parent.id,
    left: { kind: 'existing', candidateId: parent.id },
    right: {
      kind: 'draft',
      candidate: {
        flow: { name: name(rng), circuit: mutation.circuit },
        bundle: parent.bundle,
        parents: [parent.id],
        operation: mutation.operation,
        operationData: mutation.data,
        generation: parent.generation + 1,
        cohort: parent.cohort,
      },
    },
    depth: parent.generation + 1,
  };
};

interface RankedCandidate {
  candidate: EvidenceCandidate;
  quality: number;
  acceptedAt: number;
  uses: number;
  lastUsed: number;
}

const selected = (choice: NonNullable<SearchEvidence['comparisons'][number]['choice']>) => ({
  left: choice === 'left' || choice === 'both',
  right: choice === 'right' || choice === 'both',
});

/** A bounded, novelty-preserving beam derived entirely from durable comparisons. */
export function frontierFor(evidence: SearchEvidence): EvidenceCandidate[] {
  const candidates = new Map(evidence.candidates.map((candidate) => [candidate.id, candidate]));
  const ranked = new Map<string, RankedCandidate>();
  const held = (id: string): RankedCandidate | null => {
    const candidate = candidates.get(id);
    if (!candidate) return null;
    let row = ranked.get(id);
    if (!row) {
      row = { candidate, quality: 0, acceptedAt: 0, uses: 0, lastUsed: 0 };
      ranked.set(id, row);
    }
    return row;
  };
  for (const comparison of evidence.comparisons) {
    if (comparison.anchorId) {
      const anchor = held(comparison.anchorId);
      if (anchor) {
        anchor.uses += 1;
        anchor.lastUsed = comparison.id;
      }
    }
    if (!comparison.choice) continue;
    const choice = selected(comparison.choice);
    for (const [id, chosen] of [
      [comparison.leftId, choice.left],
      [comparison.rightId, choice.right],
    ] as const) {
      const row = held(id);
      if (!row) continue;
      row.quality += chosen ? (comparison.choice === 'both' ? 1 : 2) : comparison.choice === 'neither' ? -2 : -0.5;
      if (chosen) row.acceptedAt = Math.max(row.acceptedAt, comparison.id);
    }
  }
  const pool = [...ranked.values()].filter((row) => row.acceptedAt > 0 && row.quality > -2);
  pool.sort((a, b) => b.quality - a.quality || b.acceptedAt - a.acceptedAt);
  const beam: RankedCandidate[] = [];
  while (pool.length > 0 && beam.length < FRONTIER_SIZE) {
    let bestAt = 0;
    let best = -Infinity;
    for (let at = 0; at < pool.length; at++) {
      const row = pool[at];
      const novelty =
        beam.length === 0
          ? 1
          : Math.min(
              ...beam.map((other) =>
                circuitDistance(row.candidate.flow.circuit, other.candidate.flow.circuit),
              ),
            );
      const score = novelty * 2 + row.quality * 0.25 - row.uses * 0.08;
      if (score > best) {
        best = score;
        bestAt = at;
      }
    }
    beam.push(pool.splice(bestAt, 1)[0]);
  }
  return beam.map((row) => row.candidate);
}

const phaseFor = (candidate: EvidenceCandidate, evidence: SearchEvidence): 'explore' | 'refine' => {
  const anchored = evidence.comparisons.filter((comparison) => comparison.anchorId === candidate.id);
  const explores = anchored.filter((comparison) => comparison.phase === 'explore').length;
  const refines = anchored.filter((comparison) => comparison.phase === 'refine').length;
  if (explores === refines) return candidate.operation === 'explore:leap' ? 'refine' : 'explore';
  return explores < refines ? 'explore' : 'refine';
};

const anchorFor = (evidence: SearchEvidence): EvidenceCandidate | null => {
  const frontier = frontierFor(evidence);
  const use = (candidate: EvidenceCandidate) => {
    const encounters = evidence.comparisons.filter((comparison) => comparison.anchorId === candidate.id);
    return {
      candidate,
      count: encounters.length,
      last: Math.max(0, ...encounters.map((comparison) => comparison.id)),
    };
  };
  return (
    frontier
      .map(use)
      .sort(
        (a, b) =>
          a.count - b.count || a.last - b.last || a.candidate.generation - b.candidate.generation,
      )[0]?.candidate ?? null
  );
};

/** Recursive divergent/convergent search with a novelty-preserving frontier. */
export function lineageMethod(): LabSearchMethod<null> {
  return {
    id: 'lineage',
    version: 2,
    start: () => null,
    next(_state, evidence, rng) {
      const settled = evidence.comparisons.filter(
        (comparison) => comparison.disposition !== 'pending',
      ).length;
      const anchor = anchorFor(evidence);
      if (!anchor || settled % IMMIGRANT_INTERVAL === 0) return globalExplore(rng);
      return phaseFor(anchor, evidence) === 'explore'
        ? localExplore(anchor, rng)
        : refine(anchor, evidence, rng);
    },
    around: (candidate, evidence, rng) => refine(candidate, evidence, rng),
    observe: (state) => state,
    summarize(evidence) {
      const frontier = frontierFor(evidence);
      return {
        frontier: frontier.length,
        maxGeneration: Math.max(0, ...frontier.map((candidate) => candidate.generation)),
      };
    },
  };
}
