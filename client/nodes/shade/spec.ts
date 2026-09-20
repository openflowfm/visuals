import { SHADE_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { colourPort, roleColorPort, numberPort } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof SHADE_MODES)[number];

const descriptions: Record<Mode, string> = {
  across: 'Walk the whole colourway, from the first role through to the last.',
  heat: 'Out of the dark, through the colour, into the accent and up to white.',
  filament:
    'One colour from unlit to blown out, so the number reads as how hard it is lit.',
};

/** The node that turns a number into a colour, beside its discovered descriptor. */
export const SHADE_NODE_SPEC = {
  name: 'shade',
  description: 'Turn a number into a colour by walking it along the colourway.',
  inlets: (node) => [
    numberPort('n', 'The number to look the colour up with.', 0.5),
    numberPort('amount', 'The brightness and opacity of the colour that comes out.', 1),
    numberPort('brightness', 'How brightly the colours are drawn.'),
    numberPort('contrast', 'How strongly light and dark colours separate.'),
    ...(modeOfNode(node, SHADE_MODES) === 'across' ? ['primary', 'secondary', 'complement', 'accent', 'chalk'] as const
      : modeOfNode(node, SHADE_MODES) === 'heat' ? ['primary', 'secondary', 'accent', 'chalk'] as const
      : ['primary', 'chalk'] as const).map(role => roleColorPort(role, `The ${role} colour stop.`, role)),
  ],
  outlets: [colourPort('c', 'The colour this number lands on.')],
  modes: SHADE_MODES.map((name) => ({ name, description: descriptions[name] })),
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, SHADE_MODES);
    const roles = op === 'across' ? ['primary', 'secondary', 'complement', 'accent', 'chalk'] : op === 'heat' ? ['primary', 'secondary', 'accent', 'chalk'] : ['primary', 'chalk'];
    return {
      c: `finishColor(shade_${op}(${ctx.read('n')}, ${ctx.read('amount')}, ${roles.map(role => `colorRGB(${ctx.read(role)})`).join(', ')}), ${ctx.read('brightness')}, ${ctx.read('contrast')})`,
    };
  },
} satisfies NodeSpec;
