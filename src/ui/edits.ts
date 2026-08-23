import type { Circuit, FlowDef, Scheme } from '../../protocol.ts';
import { bareCircuit, inletsOf, keepValues, splitPort, starterCircuit } from '../render/circuit.ts';

/**
 * How a scheme gets changed.
 *
 * Every change returns a whole new scheme rather than mutating one, because that
 * is what goes on the wire: the editor sends the scheme entire, the server
 * writes it, and the resolved answer comes back. See `protocol.ts` on why it is
 * whole rather than a patch.
 */

/** Every flow, by id, in the order a browser should list them. */
export function flowList(scheme: Scheme): { id: string; def: FlowDef }[] {
  return Object.entries(scheme.flows)
    .map(([id, def]) => ({ id, def }))
    .sort((a, b) => (a.def.name || a.id).localeCompare(b.def.name || b.id));
}

/** Add or remove one id, keeping the order the rest were already in. */
export function toggleId(list: readonly string[] | undefined, id: string, on: boolean): string[] {
  const held = list ?? [];
  return on ? (held.includes(id) ? [...held] : [...held, id]) : held.filter((x) => x !== id);
}

/** The next free `flow*` id. Ids are stable and never shown; names are neither. */
export function freeFlowId(scheme: Scheme): string {
  for (let n = 1; ; n++) {
    const id = `flow${n}`;
    if (!scheme.flows[id]) return id;
  }
}

/**
 * A new flow, and which of the two starts it gets.
 *
 * Neither is an empty canvas. An empty canvas asks you to know the vocabulary
 * before you have seen it work, and the first thing anyone wants is to move one
 * number and watch the frame change.
 *
 * Both start with the **set** in them, which is a claim about what this rig is
 * for: the picture should already be reacting to whoever is playing before you
 * have decided anything, and taking the tracks node out should be a deliberate
 * act rather than the default state.
 */
export function addFlow(scheme: Scheme, shape: 'full' | 'bare' = 'full'): {
  scheme: Scheme;
  id: string;
} {
  const id = freeFlowId(scheme);
  const used = new Set(Object.values(scheme.flows).map((def) => def.name));
  let name = 'New flow';
  for (let n = 2; used.has(name); n++) name = `New flow ${n}`;
  const circuit = shape === 'bare' ? bareCircuit() : starterCircuit();
  return { id, scheme: { ...scheme, flows: { ...scheme.flows, [id]: { name, circuit } } } };
}

/** A copy, to take apart without losing the one it came from. */
export function forkFlow(scheme: Scheme, from: string): { scheme: Scheme; id: string } {
  const def = scheme.flows[from];
  if (!def) return addFlow(scheme);
  const id = freeFlowId(scheme);
  const used = new Set(Object.values(scheme.flows).map((each) => each.name));
  let name = `${def.name} copy`;
  for (let n = 2; used.has(name); n++) name = `${def.name} copy ${n}`;
  return {
    id,
    scheme: {
      ...scheme,
      flows: {
        ...scheme.flows,
        // Deep enough that editing the copy cannot reach the original. A shallow
        // one shares the node array, and the first drag moves both.
        [id]: {
          name,
          circuit: {
            // The values as well as the node, because a spread is one level
            // deep and the map they live in would otherwise be the same object
            // in both flows — one control turning two graphs.
            nodes: def.circuit.nodes.map((node) => ({
              ...node,
              ...(node.values ? { values: { ...node.values } } : {}),
            })),
            cords: def.circuit.cords.map((cord) => ({ ...cord })),
          },
        },
      },
    },
  };
}

/**
 * Delete a flow, and every reference to it.
 *
 * References are in two places now: the rotation's pool and any song that pinned
 * it — and, since a flow can contain a flow, in other graphs. A `flow` node
 * pointing at nothing draws nothing rather than failing, so those are left
 * where they are and the node says so on its face. Deleting them would silently
 * rewire somebody's graph.
 */
export function dropFlow(scheme: Scheme, id: string): Scheme {
  const flows = { ...scheme.flows };
  delete flows[id];
  const songs: Scheme['songs'] = {};
  for (const [name, spec] of Object.entries(scheme.songs)) {
    const kept = { ...spec };
    if (kept.flows) kept.flows = kept.flows.filter((each) => each !== id);
    if (kept.flows?.length === 0) delete kept.flows;
    if (Object.keys(kept).length > 0) songs[name] = kept;
  }
  return {
    ...scheme,
    flows,
    songs,
    rotation: { ...scheme.rotation, flows: scheme.rotation.flows.filter((each) => each !== id) },
    defaults: {
      ...scheme.defaults,
      flow: scheme.defaults.flow === id ? (Object.keys(flows)[0] ?? id) : scheme.defaults.flow,
    },
  };
}

/** Replace one flow's graph. */
export function setCircuit(scheme: Scheme, id: string, circuit: Circuit): Scheme {
  const def = scheme.flows[id];
  if (!def) return scheme;
  return { ...scheme, flows: { ...scheme.flows, [id]: { ...def, circuit } } };
}

/** Rename it. Ids are stable so nothing pointing at it has to be found. */
export function renameFlow(scheme: Scheme, id: string, name: string): Scheme {
  const def = scheme.flows[id];
  if (!def) return scheme;
  return { ...scheme, flows: { ...scheme.flows, [id]: { ...def, name } } };
}

/** The next free id for a node of this kind, within one graph. */
export function freeNodeId(circuit: Circuit, kind: string): string {
  const taken = new Set(circuit.nodes.map((node) => node.id));
  for (let n = 1; ; n++) {
    const id = `${kind}${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Change one node, and cut whatever that leaves hanging.
 *
 * **A mode change moves the inlets.** A `ripple` has `waves`, `depth` and
 * `speed`; a `posterize` has `levels` and nothing else. Nothing used to cut the
 * cords between them, so switching mode left cords addressed to inlets that no
 * longer existed — which the compiler ignores and the canvas cannot draw,
 * because there is no port to draw them to. What that reaches a person as is an
 * outlet lit up with no wire leaving it, and a node visibly wired to something
 * that has no effect on the picture. Switching back made them reappear, which
 * makes it look like the editor rather than the graph.
 *
 * Cords are kept **by name**, so the inlets a mode has in common with the one it
 * replaced stay wired: `bloom` and `smear` both have a `reach`, and it is the
 * same number in both. **Numbers set on an inlet keep the same company** — the
 * same rule, one step quieter, since a number stranded on an inlet that is not
 * there cannot even be seen, let alone cleared.
 */
export function setNode(
  circuit: Circuit,
  id: string,
  next: Partial<Circuit['nodes'][number]>,
): Circuit {
  const nodes = circuit.nodes.map((node) => (node.id === id ? { ...node, ...next } : node));
  // Only a mode can move an inlet, and a drag emits on every pointer move, so
  // this is the one change worth walking the cords for.
  if (next.op === undefined) return { ...circuit, nodes };
  const held = nodes.find((node) => node.id === id);
  if (!held) return { ...circuit, nodes };
  const ports = new Set(inletsOf(held).map((port) => port.name));
  return {
    nodes: nodes.map((node) => (node.id === id ? keepValues(node) : node)),
    cords: circuit.cords.filter((cord) => {
      const to = splitPort(cord.to);
      return to.node !== id || ports.has(to.port);
    }),
  };
}

/**
 * Set one inlet's own number.
 *
 * Its own edit rather than a `setNode` call, because the value lives in a map
 * and a caller merging that map by hand is a caller who can drop the rest of
 * it. The control emits on every pointer move, so this is on the hot path and does
 * exactly one thing.
 */
/**
 * How far a cord may carry one inlet, signed.
 *
 * Beside `setValue` and not folded into it, because they are two numbers on one
 * inlet and a caller always means exactly one of them. A depth of one is the
 * default and the way a cord behaved before there were ranges, so it is written
 * down rather than dropped — an absent depth and a depth of one mean the same
 * thing to the compiler, and leaving the file to say which is how the two drift.
 */
export function setDepth(circuit: Circuit, id: string, inlet: string, depth: number): Circuit {
  return {
    ...circuit,
    nodes: circuit.nodes.map((node) =>
      node.id === id ? { ...node, depths: { ...node.depths, [inlet]: depth } } : node,
    ),
  };
}

export function setValue(circuit: Circuit, id: string, inlet: string, value: number): Circuit {
  return {
    ...circuit,
    nodes: circuit.nodes.map((node) =>
      node.id === id ? { ...node, values: { ...node.values, [inlet]: value } } : node,
    ),
  };
}

/**
 * Take a node off the canvas, with everything it was wired to.
 *
 * **Except `out`.** Every flow has exactly one and it is not optional: it is
 * what leaves, and a flow without one is not a smaller flow, it is not a flow.
 * The faceplate has no delete button on it for that reason, and the rule lives
 * here as well so that it is the model's rather than the button's.
 */
export function dropNode(circuit: Circuit, id: string): Circuit {
  if (circuit.nodes.find((node) => node.id === id)?.kind === 'out') return circuit;
  return {
    nodes: circuit.nodes.filter((node) => node.id !== id),
    cords: circuit.cords.filter(
      (cord) => splitPort(cord.from).node !== id && splitPort(cord.to).node !== id,
    ),
  };
}

/** One cord in. An inlet takes one thing, so an existing one is replaced. */
export function connect(circuit: Circuit, from: string, to: string): Circuit {
  return { ...circuit, cords: [...circuit.cords.filter((cord) => cord.to !== to), { from, to }] };
}

export function disconnect(circuit: Circuit, to: string): Circuit {
  return { ...circuit, cords: circuit.cords.filter((cord) => cord.to !== to) };
}
