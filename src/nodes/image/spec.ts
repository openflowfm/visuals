import { IMAGE_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';

const descriptions: Record<(typeof IMAGE_MODES)[number], string> = {
  cover: 'Fill the frame without distortion, cropping the image at its long edges.',
  contain: 'Show the whole image without distortion, leaving uncovered space transparent.',
};

/** The still-image node's compiler contract, beside its discovered descriptor. */
export const IMAGE_NODE_SPEC = {
  name: 'image',
  description: 'A still image from the server media folder, uploaded once while its flow is drawn.',
  inlets: [
    {
      name: 'p',
      kind: 'p',
      description: 'Where in the image to read.',
    },
  ],
  outlets: [
    {
      name: 'c',
      kind: 'c',
      description: 'The selected image in the chosen framing mode.',
      fallback: 'vec4(0.0)',
    },
  ],
  modes: IMAGE_MODES.map((name) => ({ name, description: descriptions[name] })),
  asset: 'image',
  work: 1,
  // The compiler replaces this with the sampler slot assigned to this node.
  emit: () => ({ c: 'vec4(0.0)' }),
} satisfies NodeSpec;
