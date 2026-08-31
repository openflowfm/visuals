import { GLOW_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { colourPort, energyPort, livePort, numberPort, type PortSpec } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof GLOW_MODES)[number];

const descriptions: Record<Mode, string> = {
  neon: 'A blown white filament inside a coloured halo, the way a lit tube reads.',
  soft: 'A plain falloff that keeps its colour, with no filament in the middle.',
  band: 'Brightest at a distance from the shape rather than on it, standing an outline off it.',
};

/**
 * What each falloff takes beyond the distance and the energy.
 *
 * `halo` is on all three because it is the same number in all three — how far
 * the light carries — and flicking between modes with a picture up should
 * change the *shape* of the falloff without resetting its size.
 */
const values: Record<Mode, readonly PortSpec[]> = {
  neon: [
    numberPort('core', 'How much of the light is blown filament against outer halo.', 0.35),
    numberPort('halo', 'How far the light carries, from a hairline to a soft wash.', 0.35),
  ],
  soft: [numberPort('halo', 'How far the light carries, from a hairline to a soft wash.', 0.45)],
  band: [
    numberPort('away', 'How far off the shape the brightest part of the band stands.', 0.25),
    numberPort('halo', 'How far the light carries, from a hairline to a soft wash.', 0.3),
  ],
};

/** The node that turns a number into light, beside its discovered descriptor. */
export const GLOW_NODE_SPEC = {
  name: 'glow',
  description: 'Turn a number that is near at zero into a lit stroke, with a halo around it.',
  inlets: (node) => {
    const op = modeOfNode(node, GLOW_MODES);
    return [
      // Unwired it is the distance from the middle of the frame, so a glow
      // dropped on its own is a lamp rather than a black rectangle. Every
      // other inlet in this vocabulary answers something when nothing is
      // wired to it; a draw node whose resting answer is "nothing" reads as
      // broken, and this one has an obvious honest answer available.
      livePort(
        'd',
        'How far this point is from the thing being lit. Nothing at zero.',
        'length(centred())',
      ),
      energyPort(),
      ...values[op],
    ];
  },
  outlets: [colourPort('c', 'The light this distance makes, as a picture.')],
  modes: GLOW_MODES.map((name) => ({ name, description: descriptions[name] })),
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, GLOW_MODES);
    const e = ctx.read('energy');
    const args = [ctx.read('d'), e, ...values[op].map((port) => ctx.read(port.name))];
    return { c: `laid(glow_${op}(${args.join(', ')}), ${e})` };
  },
} satisfies NodeSpec;
