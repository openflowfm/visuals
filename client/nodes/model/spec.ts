import type { NodeSpec } from '../../render/circuit.ts';

/** A reusable setup's stable published controls become this node's number inlets. */
export const MODEL_NODE_SPEC = {
  name: 'model',
  description: 'A reusable setup made from an inspected GLB in the model library.',
  inlets: (node) => [
    {
      name: 'p',
      kind: 'p' as const,
      description: 'Where in the rendered model picture to read.',
    },
    {
      name: 'color-a',
      kind: 'c' as const,
      description: 'The setup’s first externally controllable material colour.',
      fallback: 'vec4(uPrimary, 1.0)',
    },
    {
      name: 'color-b',
      kind: 'c' as const,
      description: 'The setup’s second externally controllable material colour.',
      fallback: 'vec4(uSecondary, 1.0)',
    },
    ...(node.modelPorts ?? []).map((port) => ({
      name: port.id,
      label: port.label,
      group: port.group,
      kind: 'n' as const,
      description: `${port.label}, published by the selected reusable model setup.`,
      fallback: Number.isInteger(port.default) ? port.default.toFixed(1) : String(port.default),
      at: port.default,
    })),
  ],
  outlets: [{ name: 'c', kind: 'c' as const, description: 'The depth-rendered model as a colour source.' }],
  work: 1,
  // Replaced by the compiler with the bounded model texture slot.
  emit: () => ({ c: 'vec4(0.0)' }),
} satisfies NodeSpec;
