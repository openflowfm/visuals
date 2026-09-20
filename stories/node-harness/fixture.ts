import type { Circuit, CircuitNode, NodeKind } from '../../protocol.ts';
import { NODE_KINDS } from '../../client/nodes/generated.ts';
import { inletsOf, NODE_SPECS } from '../../client/render/circuit.ts';
import { probeAt } from '../../client/ui/probe.ts';

// Explicit coverage: adding a kind means checking its fixture and time semantics.
// Asset, Live, flow-interface and history nodes need dedicated fixtures first.
const SUPPORTED = new Set<NodeKind>([
  'source', 'lens', 'grade', 'spread', 'displace', 'halftone', 'blend',
  'field', 'fractal', 'light', 'colorway', 'point', 'polar', 'math', 'lfo', 'read',
]);
export const HARNESS_KINDS = NODE_KINDS.filter((kind) => SUPPORTED.has(kind));
export const SUBJECT = 'subject';
export const FLOW = '~node-harness';

export function harnessFixture(
  kind: NodeKind,
  op?: string,
  values: Record<string, number> = {},
  outlet?: string,
): { node: CircuitNode; circuit: Circuit } | null {
  if (!SUPPORTED.has(kind)) return null;
  const spec = NODE_SPECS[kind];
  const mode = spec.modes?.find((mode) => mode.name === op)?.name ?? spec.modes?.[0]?.name;
  const previewOutlet = spec.outlets.find((port) => port.name === outlet)?.name ??
    spec.outlets.find((port) => port.kind === 'c')?.name ?? spec.outlets[0]?.name;
  const node: CircuitNode = { id: SUBJECT, kind, op: mode, x: 300, y: 0, values, previewOutlet };
  const colours = inletsOf(node).filter((port) => port.kind === 'c');
  const circuit: Circuit = {
    nodes: [node, ...colours.map((_, i): CircuitNode => ({
      id: `fixture-${i}`, kind: 'source', op: i % 2 === 0 ? 'checker' : 'plasma',
      x: 0, y: i * 100, values: { energy: 0.5 },
    }))],
    cords: colours.map((port, i) => ({ from: `fixture-${i}/c`, to: `${SUBJECT}/${port.name}` })),
  };
  const drawn = probeAt(circuit, SUBJECT);
  return drawn ? { node, circuit: drawn } : null;
}
