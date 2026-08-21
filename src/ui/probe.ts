import type { Circuit } from '../../protocol.ts';
import { NODE_SPECS } from '../render/circuit.ts';

/**
 * The graph as it stands at one node's outlet — what that node has made.
 *
 * This is what a picture on every node actually *is*. Only `out` takes a colour,
 * so a number or a point has to be brought back to one before it can be looked
 * at, and the bridge is the vocabulary's own rather than a rendering trick: a
 * number is shown the way `paint` would show it, and a point the way a picture
 * read at it would look. Which is how it will look if you wire it that way.
 */
export function probeAt(circuit: Circuit, nodeId: string): Circuit | null {
  const node = circuit.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  // `out` has no outlet of its own, so its picture is the whole graph's.
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

  // A number becomes brightness; a point becomes somewhere to read a picture.
  // `plasma` rather than the set, because a point's whole job is to move a
  // picture about and a picture with structure in it is one you can see moving.
  const bridge =
    outlet.kind === 'n'
      ? { id: BRIDGE, kind: 'paint' as const, x: node.x + 100, y: node.y }
      : { id: BRIDGE, kind: 'source' as const, op: 'plasma', x: node.x + 100, y: node.y };
  const inlet = outlet.kind === 'n' ? 'amount' : 'p';
  return {
    nodes: [...nodes, bridge],
    cords: [
      ...cords,
      { from, to: `${BRIDGE}/${inlet}` },
      { from: `${BRIDGE}/c`, to: `${END}/c` },
    ],
  };
}
