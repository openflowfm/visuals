import { VIDEO_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';

const descriptions: Record<(typeof VIDEO_MODES)[number], string> = {
  loop: 'Play continuously, returning to the first frame at the end.',
  once: 'Play once and hold the final decoded frame.',
  scrub: 'Stop playing and sit wherever the position inlet points, one pass across the whole clip.',
};

/**
 * What a clip is told, and why the two lists of it cannot both be mounted.
 *
 * A playing clip takes a speed and a freeze; a scrubbed one takes a position
 * and can take neither, because both are answers to the question its position
 * inlet has already answered. That is a mode moving the trim, which is the rule
 * working: `p` stays wired across the flick and the cord that has nowhere to go
 * is the one that stopped meaning anything.
 */
const PLAYING = [
  {
    name: 'pace',
    kind: 'n',
    description: 'Playback speed from half speed through double speed.',
    at: 0.5,
    fallback: '0.5',
  },
  {
    name: 'freeze',
    kind: 'n',
    description: 'Hold the current frame while this is over a half, and run again when it falls.',
    at: 0,
    fallback: '0.0',
  },
] as const;

const SCRUBBING = [
  {
    name: 'position',
    kind: 'n',
    description: 'Where in the clip to sit, from its first frame to its last.',
    at: 0,
    fallback: '0.0',
  },
] as const;

/** The video node's compiler contract, kept beside its discovered descriptor. */
export const VIDEO_NODE_SPEC = {
  name: 'video',
  description:
    'A muted video from the server media folder, decoded only while this flow is being drawn.',
  inlets: (node) => [
    {
      name: 'p',
      kind: 'p',
      description: 'Where in the video frame to read.',
    },
    ...(node.op === 'scrub' ? SCRUBBING : PLAYING),
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
  asset: 'video',
  // One external texture read per evaluation. Multi-tap effects multiply it
  // just like any other picture, and the ordinary graph budget sees that.
  work: 1,
  // The compiler replaces this with the sampler slot assigned to this node.
  emit: () => ({ c: 'vec4(0.0)' }),
} satisfies NodeSpec;
