import type { Circuit, EffectDef } from '../../protocol.ts';
import { NODE_SPECS } from '../render/circuit.ts';

/**
 * The circuit as it stands at one node's outlet — what that node has made.
 *
 * This is what a picture on every node actually *is*. A node face showing a
 * thumbnail of the finished effect would be the same image a dozen times over
 * and would teach nothing; one showing what has been built *so far* turns the
 * canvas into a series of steps you can read along the chain, which is how
 * anyone reasons about signal flow anyway.
 *
 * Only `out` takes a colour, so a number or a point has to be brought back to
 * one before it can be looked at. `paint` and `sample` are exactly the two
 * crossings the vocabulary already has, so the bridge is the circuit's own
 * rather than a rendering trick: a number is shown the way `paint` would show
 * it, which is how it will look if you wire it that way yourself.
 */
export function probeAt(circuit: Circuit, nodeId: string): Circuit | null {
  const node = circuit.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  // `out` has no outlet of its own, so its picture is the whole circuit's.
  if (node.kind === 'out') return circuit;

  const outlet = NODE_SPECS[node.kind].outlets[0];
  if (!outlet) return null;

  const from = `${nodeId}/${outlet.name}`;
  // Ids a user cannot type, because a node called "out" is perfectly legal and
  // this has to survive one.
  const END = '~probe-out';
  const BRIDGE = '~probe-bridge';

  const kept = circuit.nodes.filter((n) => n.kind !== 'out');
  const ends = new Set(circuit.nodes.filter((n) => n.kind === 'out').map((n) => n.id));
  const cords = circuit.cords.filter((c) => !ends.has(c.to.slice(0, c.to.lastIndexOf('/'))));
  const nodes = [...kept, { id: END, kind: 'out' as const, x: node.x + 200, y: node.y }];

  if (outlet.kind === 'c') {
    return { nodes, cords: [...cords, { from, to: `${END}/c` }] };
  }
  const bridge = outlet.kind === 'n' ? ('paint' as const) : ('sample' as const);
  const inlet = outlet.kind === 'n' ? 'amount' : 'p';
  return {
    nodes: [...nodes, { id: BRIDGE, kind: bridge, x: node.x + 100, y: node.y }],
    cords: [
      ...cords,
      { from, to: `${BRIDGE}/${inlet}` },
      { from: `${BRIDGE}/c`, to: `${END}/c` },
    ],
  };
}

/** That circuit, as something the bench can draw. */
export function probeDef(def: EffectDef, nodeId: string): EffectDef | null {
  if (!def.circuit) return null;
  const circuit = probeAt(def.circuit, nodeId);
  return circuit ? { name: def.name, circuit } : null;
}
