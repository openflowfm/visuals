import { ARRAY_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { numberPort, pointPort, type PortSpec } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof ARRAY_MODES)[number];

const descriptions: Record<Mode, string> = {
  row: 'Copies side by side across the frame, numbered from left to right.',
  grid: 'Copies in a grid of cells, each cell holding a stable number of its own.',
  ring: 'Copies turned around the centre, each in its own wedge.',
  mirror: 'The same ring, with every other copy reflected so the seams close.',
};

const count = (at: number) =>
  numberPort('count', 'How many copies the space is repeated into.', at);

const values: Record<Mode, readonly PortSpec[]> = {
  row: [count(0.25)],
  grid: [count(0.3)],
  ring: [count(0.35), numberPort('turn', 'How far the whole arrangement is turned.', 0)],
  mirror: [count(0.35)],
};

/** The node that repeats a space and says which copy you are in. */
export const ARRAY_NODE_SPEC = {
  name: 'array',
  description: 'Repeat the space a picture is read in, and say which copy this point falls in.',
  inlets: (node) => [
    pointPort('p', 'The position to repeat.'),
    ...values[modeOfNode(node, ARRAY_MODES)],
  ],
  outlets: [
    pointPort('p', 'The position within the copy this point falls in.'),
    numberPort('which', 'A number naming the copy this point falls in.'),
  ],
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, ARRAY_MODES);
    const args = [ctx.read('p'), ...values[op].map((port) => ctx.read(port.name))];
    const repeated = `array_${op}(${args.join(', ')})`;
    // As `figure` does, and for the same reason: one of the three signals per
    // expression, so the copy number and the point inside the copy cannot ride
    // one shared line.
    const one: Record<string, string> =
      ctx.outlet === 'which' ? { which: `${repeated}.z` } : { p: `${repeated}.xy` };
    return one;
  },
} satisfies NodeSpec;
