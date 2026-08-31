import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode, Show } from '../../protocol.ts';
import { createNumberEvaluator } from '../render/evaluateNumber.ts';
import {
  pushScopeSample,
  SCOPE_SAMPLE_CAP,
  scopeHead,
  scopeOutlets,
  scopeSweeps,
  type ScopeSample,
} from './scope.ts';

const SHOW: Show = {
  connected: true,
  lomReady: true,
  playing: true,
  peers: 1,
  clock: true,
  tempo: 128,
  quantum: 4,
  beat: 0,
  at: 0,
  since: 0,
  master: 0.6,
  tracks: [],
  groups: [],
  flow: null,
  pinned: false,
  colorway: null,
  colors: [0xffffff],
  song: null,
  key: null,
  role: null,
  one: 0,
  schemeError: null,
  roles: [],
  songs: [],
};

const node = (
  id: string,
  kind: CircuitNode['kind'],
  extra: Partial<CircuitNode> = {},
): CircuitNode => ({ id, kind, x: 0, y: 0, ...extra });

function scopedIn(nodes: CircuitNode[], cords: Circuit['cords'] = []): Map<string, string> {
  const circuit: Circuit = { nodes, cords };
  const sample = createNumberEvaluator().sample(circuit, {
    show: SHOW,
    beat: 2,
    seconds: 1,
    dt: 0.016,
  });
  return scopeOutlets(circuit, sample);
}

describe('which faces are scopes', () => {
  it('scopes the number outlets the CPU evaluator can answer', () => {
    const scoped = scopedIn([
      node('l', 'lfo', { op: 'sine' }),
      node('v', 'value', { value: 0.5 }),
      node('m', 'math', { op: 'add', values: { a: 0.2, b: 0.2 } }),
    ]);

    expect(scoped).toEqual(
      new Map([
        ['l', 'l/n'],
        ['v', 'v/n'],
        ['m', 'm/n'],
      ]),
    );
  });

  it('leaves pictures, points and out alone', () => {
    const scoped = scopedIn(
      [
        node('s', 'source', { op: 'plasma' }),
        node('pt', 'point'),
        node('o', 'out'),
      ],
      [{ from: 's/c', to: 'o/c' }],
    );

    expect(scoped.size).toBe(0);
  });

  it('refuses a number that only exists per pixel', () => {
    // `polar`'s radius is an `n` outlet, but its value depends on which pixel
    // is asking — there is no single number to plot, so the face stays the
    // picture the colour bridge makes of it. The refusal follows the chain: a
    // `math` fed from it has no answer either.
    const scoped = scopedIn(
      [
        node('pt', 'point'),
        node('pol', 'polar'),
        node('m', 'math', { op: 'add' }),
      ],
      [
        { from: 'pt/p', to: 'pol/p' },
        { from: 'pol/radius', to: 'm/a' },
      ],
    );

    expect(scoped.size).toBe(0);
  });

  it('follows the outlet the face would have shown', () => {
    const scoped = scopedIn(
      [node('l', 'lfo', { op: 'sine' }), node('m', 'math', { op: 'add' })],
      [{ from: 'l/n', to: 'm/a' }],
    );

    expect(scoped.get('m')).toBe('m/n');
  });
});

describe('the scope buffer', () => {
  const at = (beat: number, value: number | null = 0.5): ScopeSample => ({ beat, value });

  it('keeps exactly one window of beats', () => {
    const samples: ScopeSample[] = [];
    for (const beat of [1, 2, 3, 4, 5]) pushScopeSample(samples, at(beat), 4);

    // A sample a full window old sits under the head and is dropped with the
    // older ones, so the head never draws over a stale column.
    expect(samples.map((sample) => sample.beat)).toEqual([2, 3, 4, 5]);
  });

  it('clears when the beat jumps backwards', () => {
    const samples: ScopeSample[] = [];
    pushScopeSample(samples, at(3), 4);
    pushScopeSample(samples, at(3.5), 4);
    pushScopeSample(samples, at(0.25), 4);

    expect(samples).toEqual([at(0.25)]);
  });

  it('caps a very slow window instead of growing without bound', () => {
    const samples: ScopeSample[] = [];
    for (let tick = 0; tick < SCOPE_SAMPLE_CAP + 40; tick++) {
      pushScopeSample(samples, at(tick * 0.001), 64);
    }

    expect(samples).toHaveLength(SCOPE_SAMPLE_CAP);
    expect(samples[samples.length - 1].beat).toBeCloseTo((SCOPE_SAMPLE_CAP + 39) * 0.001);
  });
});

describe('the trace geometry', () => {
  it('splits the polyline where the sweep wraps', () => {
    const sweeps = scopeSweeps(
      [
        { beat: 3.5, value: 0.2 },
        { beat: 3.9, value: 0.4 },
        { beat: 4.1, value: 0.6 },
        { beat: 4.3, value: 0.8 },
      ],
      4,
    );

    expect(sweeps).toHaveLength(2);
    expect(sweeps[0].map((point) => point.x)).toEqual([0.875, 3.9 / 4]);
    expect(sweeps[1].map((point) => point.x)).toEqual([
      4.1 / 4 - 1,
      4.3 / 4 - 1,
    ]);
  });

  it('breaks the line over a tick with no answer instead of bridging it', () => {
    const sweeps = scopeSweeps(
      [
        { beat: 0.1, value: 0.2 },
        { beat: 0.2, value: null },
        { beat: 0.3, value: 0.6 },
      ],
      4,
    );

    expect(sweeps).toHaveLength(2);
    expect(sweeps[0]).toHaveLength(1);
    expect(sweeps[1]).toHaveLength(1);
  });

  it('pegs a number beyond the range at the edge of the frame', () => {
    // `playback`'s raw beat is 7 at beat seven. Any inlet this outlet feeds
    // clamps, so the honest drawing pegs rather than rescales.
    const sweeps = scopeSweeps([{ beat: 0.5, value: 7 }, { beat: 0.6, value: 7.1 }], 4);

    expect(sweeps[0].map((point) => point.y)).toEqual([1, 1]);
  });

  it('places the head at the current position and clamps its value', () => {
    expect(scopeHead(5, 1.5, 4)).toEqual({ x: 0.25, y: 1 });
    expect(scopeHead(5, undefined, 4)).toBeNull();
  });
});
