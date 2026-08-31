import { LFO_SHAPES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { lfoIdentity } from './algorithm.ts';

const descriptions: Record<(typeof LFO_SHAPES)[number], string> = {
  sine: 'Rise and fall in one smooth sine wave.',
  triangle: 'Rise and fall linearly with no jump at the cycle boundary.',
  saw: 'Rise linearly and jump back to zero at the cycle boundary.',
  ramp: 'Fall linearly and jump back to one at the cycle boundary.',
  square: 'Stay at zero for half a cycle and one for the other half.',
  pulse: 'Strike at the cycle boundary and decay away, like something hit.',
  noise: 'Drift smoothly between random values rather than stepping between them.',
  'sample-hold': 'Choose one deterministic random value and hold it for a complete cycle.',
};

const functions: Record<(typeof LFO_SHAPES)[number], string> = {
  sine: 'cLfoSine',
  triangle: 'cLfoTriangle',
  saw: 'cLfoSaw',
  ramp: 'cLfoRamp',
  square: 'cLfoSquare',
  pulse: 'cLfoPulse',
  noise: 'cLfoNoise',
  'sample-hold': 'cLfoHold',
};

export const LFO_NODE_SPEC = {
  name: 'lfo',
  description:
    'A low-frequency oscillator that follows straight note divisions or runs freely in hertz.',
  inlets: [
    /**
     * First, because it is the signal the rest of the node is about — and
     * because `lineage.ts` splices a node into a number cord through its first
     * number inlet, which is how the lab shapes a number that already exists.
     *
     * Alive rather than settable: unwired it reads the beat, which is what
     * makes an oscillator nobody has touched run in time with the music. Wired,
     * it is the phase, and `rate` divides it rather than being ignored — one
     * cycle a bar arriving here at `1/8` is two cycles a bar leaving.
     */
    {
      name: 'clock',
      kind: 'n',
      description: 'The phase to run on. The beat, until something else is wired here.',
      fallback: 'uBeat',
    },
    {
      name: 'rate',
      kind: 'n',
      description:
        'The note period the clock is divided into when synced, or frequency from 0.05 to 20 Hz when free.',
      at: 0.5,
      fallback: '0.5',
      display: 'lfo-rate',
    },
    {
      name: 'sync',
      kind: 'n',
      description:
        'Divide the clock at one; ignore it and run on elapsed seconds at zero.',
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
    const clock = `cLfoPhase(${ctx.read('clock')}, ${ctx.read('rate')}, ${ctx.read('sync')}, ${ctx.read('phase')})`;
    const identity = lfoIdentity(ctx.node.id).toFixed(8);
    return {
      n:
        shape === 'sample-hold'
          ? `${functions[shape]}(${clock}, ${identity})`
          : `${functions[shape]}(${clock})`,
    };
  },
} satisfies NodeSpec;
