import type { CircuitNode } from '../../protocol.ts';

/**
 * Which mode a node is in, given whatever its `op` says.
 *
 * One reading, used by a spec's inlets and by its emit. They must not answer
 * this differently: an `op` nobody recognises — which is a thing a hand-edited
 * file can say — would otherwise produce a node with one mode's inlets and
 * another mode's shader, calling for numbers that are therefore always zero.
 */
export const modeOfNode = <const Modes extends readonly string[]>(
  node: CircuitNode,
  modes: Modes,
): Modes[number] => (modes.includes(node.op ?? '') ? node.op! : modes[0]) as Modes[number];
