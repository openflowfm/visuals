import { VIDEO_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';

const descriptions: Record<(typeof VIDEO_MODES)[number], string> = {
  loop: 'Play continuously, returning to the first frame at the end.',
  once: 'Play once and hold the final decoded frame.',
};

/** The video node's compiler contract, kept beside its discovered descriptor. */
export const VIDEO_NODE_SPEC = {
  name: 'video',
  description:
    'A muted video from the server media folder, decoded only while this flow is being drawn.',
  inlets: [
    {
      name: 'p',
      kind: 'p',
      description: 'Where in the video frame to read.',
    },
    {
      name: 'pace',
      kind: 'n',
      description: 'Playback speed from half speed through double speed.',
      at: 0.5,
      fallback: '0.5',
    },
  ],
  outlets: [
    {
      name: 'c',
      kind: 'c',
      description: 'The current decoded video frame.',
      fallback: 'vec4(0.0)',
    },
  ],
  modes: VIDEO_MODES.map((name) => ({ name, description: descriptions[name] })),
  asset: true,
  // One external texture read per evaluation. Multi-tap effects multiply it
  // just like any other picture, and the ordinary graph budget sees that.
  work: 1,
  // The compiler replaces this with the sampler slot assigned to this node.
  emit: () => ({ c: 'vec4(0.0)' }),
} satisfies NodeSpec;
