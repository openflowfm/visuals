import { SHADE_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { colourPort, energyPort, numberPort } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof SHADE_MODES)[number];

const descriptions: Record<Mode, string> = {
  across: 'Walk the whole colourway, from the first role through to the last.',
  heat: 'Out of the dark, through the colour, into the accent and up to white.',
};

/** The node that turns a number into a colour, beside its discovered descriptor. */
export const SHADE_NODE_SPEC = {
  name: 'shade',
  description: 'Turn a number into a colour by walking it along the colourway.',
  inlets: [
    numberPort('n', 'The number to look the colour up with.', 0.5),
    numberPort('amount', 'The brightness and opacity of the colour that comes out.', 1),
    energyPort(),
  ],
  outlets: [colourPort('c', 'The colour this number lands on.')],
  modes: SHADE_MODES.map((name) => ({ name, description: descriptions[name] })),
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, SHADE_MODES);
    return {
      c: `laid(shade_${op}(${ctx.read('n')}, ${ctx.read('amount')}), ${ctx.read('energy')})`,
    };
  },
} satisfies NodeSpec;
