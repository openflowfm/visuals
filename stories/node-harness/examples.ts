import type { NodeKind } from '../../protocol.ts';
import { NODE_SPECS } from '../../client/render/circuit.ts';
import type { GraphExample } from './NodeHarness.tsx';
import { harnessFixture } from './fixture.ts';

export function exampleFor(kind: NodeKind, mode?: string): GraphExample {
  const fixture = harnessFixture(kind, mode);
  if (!fixture) throw new Error(`No graph example for ${kind}`);
  const outlet = NODE_SPECS[kind].outlets.find(port => port.name === fixture.node.previewOutlet)!;
  return {
    title: `${kind} · ${fixture.node.op ?? 'basic use'}`,
    description: `${NODE_SPECS[kind].description} ${outlet.kind === 'n'
      ? 'The number drives colorway brightness before reaching the output.'
      : outlet.kind === 'p' ? 'The point drives where a plasma source is sampled.'
      : 'Follow the colour connections through to the output.'}`,
    circuit: fixture.circuit,
  };
}

export const animatedRipple: GraphExample = {
  title: 'A ripple driven by an oscillator',
  description: 'The checker feeds the lens while a sine LFO controls ripple depth. Animate to see the modulation; change the rate on the LFO itself.',
  circuit: {
    nodes: [
      { id: 'checker', kind: 'source', op: 'checker', x: 30, y: 30 },
      { id: 'wave', kind: 'lfo', op: 'sine', x: 30, y: 360 },
      { id: 'lens', kind: 'lens', op: 'ripple', x: 270, y: 30 },
      { id: 'output', kind: 'out', x: 510, y: 30 },
    ],
    cords: [
      { from: 'checker/c', to: 'lens/c' },
      { from: 'wave/n', to: 'lens/depth' },
      { from: 'lens/c', to: 'output/c' },
    ],
  },
};

export const trackBrightness: GraphExample = {
  title: 'Drums drive brightness',
  description: 'A simulated Drums meter drives colorway brightness. Change the local meter or playback switch, then experiment with the track node’s own mode and envelope controls.',
  track: true,
  circuit: {
    nodes: [
      { id: 'drums', kind: 'track', op: 'level', of: 'Drums', x: 30, y: 30 },
      { id: 'palette', kind: 'colorway', x: 270, y: 30, values: { energy: 0.5 } },
      { id: 'output', kind: 'out', x: 510, y: 30 },
    ],
    cords: [ { from: 'drums/n', to: 'palette/amount' }, { from: 'palette/primary', to: 'output/c' } ],
  },
};
