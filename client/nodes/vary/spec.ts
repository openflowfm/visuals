import { VARY_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { numberPort } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof VARY_MODES)[number];

const descriptions: Record<Mode, string> = {
  even: 'Every copy as likely to land high as low.',
  few: 'Most copies near nothing and a few of them right up, the way a bank of lights has favourites.',
};

/** The node that turns an ordered number into an unordered but stable one. */
export const VARY_NODE_SPEC = {
  name: 'vary',
  description: 'Turn a copy number or a position along a curve into a stable number per copy.',
  inlets: [
    numberPort('n', 'The number naming the copy, or the position along the curve.', 0.5),
    numberPort(
      'steps',
      'How many copies to cut the number into before rolling. At zero every value gets its own.',
      0,
    ),
  ],
  outlets: [numberPort('n', 'The number this copy was dealt, the same on every frame.')],
  modes: VARY_MODES.map((name) => ({ name, description: descriptions[name] })),
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, VARY_MODES);
    return { n: `vary_${op}(${ctx.read('n')}, ${ctx.read('steps')})` };
  },
} satisfies NodeSpec;
