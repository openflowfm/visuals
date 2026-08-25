import { LFO_SHAPES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { lfoIdentity } from './algorithm.ts';

const descriptions: Record<(typeof LFO_SHAPES)[number], string> = {
  sine: 'Rise and fall in one smooth sinusoidal cycle.',
  triangle: 'Rise and fall linearly with no jump at the cycle boundary.',
  saw: 'Rise linearly and jump back to zero at the cycle boundary.',
  square: 'Stay at zero for half a cycle and one for the other half.',
  'sample-hold': 'Choose one deterministic random value and hold it for a complete cycle.',
};

const functions: Record<(typeof LFO_SHAPES)[number], string> = {
  sine: 'cLfoSine',
  triangle: 'cLfoTriangle',
  saw: 'cLfoSaw',
  square: 'cLfoSquare',
  'sample-hold': 'cLfoHold',
};

export const LFO_NODE_SPEC = {
  name: 'lfo',
  description:
    'A low-frequency oscillator that follows straight note divisions or runs freely in hertz.',
  inlets: [
    {
      name: 'rate',
      kind: 'n',
      description: 'The note period when synced, or frequency from 0.05 to 20 Hz when free.',
      at: 0.5,
      fallback: '0.5',
      display: 'lfo-rate',
    },
    {
      name: 'sync',
      kind: 'n',
      description: 'Follow Link beat at one; run on elapsed seconds at zero.',
      at: 1,
      fallback: '1.0',
      control: 'toggle',
    },
    {
      name: 'phase',
      kind: 'n',
      description: 'Offset the oscillator by zero to one complete cycle.',
      at: 0,
      fallback: '0.0',
      display: 'phase',
    },
  ],
  outlets: [{ name: 'n', kind: 'n', description: 'The oscillator value from zero to one.' }],
  modes: LFO_SHAPES.map((name) => ({ name, description: descriptions[name] })),
  emit: (ctx) => {
    const shape = LFO_SHAPES.includes((ctx.node.op ?? '') as (typeof LFO_SHAPES)[number])
      ? ((ctx.node.op ?? LFO_SHAPES[0]) as (typeof LFO_SHAPES)[number])
      : LFO_SHAPES[0];
    const clock = `cLfoPhase(${ctx.read('rate')}, ${ctx.read('sync')}, ${ctx.read('phase')})`;
    const identity = lfoIdentity(ctx.node.id).toFixed(8);
    return {
      n:
        shape === 'sample-hold'
          ? `${functions[shape]}(${clock}, ${identity})`
          : `${functions[shape]}(${clock})`,
    };
  },
} satisfies NodeSpec;
