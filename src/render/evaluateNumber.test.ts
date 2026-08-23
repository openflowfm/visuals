import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode, Show } from '../../protocol.ts';
import {
  createNumberEvaluator,
  sectionOf,
  seedOf,
  smoothTrack,
  trackReading,
  type NumberInputs,
} from './evaluateNumber.ts';

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
  master: 0.6,
  tracks: [
    {
      t: 0,
      name: 'Bass',
      color: 0x446688,
      opacity: 0.75,
      level: 0.8,
      playing: 2,
      clipName: 'Verse',
    },
  ],
  flow: null,
  pinned: false,
  colorway: null,
  colors: [0xffffff],
  song: 'Signal Fire',
  key: 0.25,
  role: 'VERSE',
  one: 0,
  schemeError: null,
  roles: ['INTRO', 'VERSE', 'OUTRO'],
  songs: ['Signal Fire'],
};

const inputs = (overrides: Partial<NumberInputs> = {}): NumberInputs => ({
  show: SHOW,
  beat: 5.25,
  seconds: 12,
  dt: 0.1,
  ...overrides,
});

const node = (
  id: string,
  kind: CircuitNode['kind'],
  extra: Partial<CircuitNode> = {},
): CircuitNode => ({ id, kind, x: 0, y: 0, ...extra });

const circuit = (nodes: CircuitNode[], cords: Circuit['cords'] = []): Circuit => ({
  nodes,
  cords,
});

const one = (subject: CircuitNode, at: Partial<NumberInputs> = {}): number | undefined =>
  createNumberEvaluator().sample(circuit([subject]), inputs(at)).outlet(`${subject.id}/n`);

describe('CPU number evaluation', () => {
  it('reads value nodes and latched parameters with the same ids as the uniform bank', () => {
    const graph = circuit(
      [
        node('v', 'value', { value: 0.2 }),
        node('other', 'value', { value: 0.4 }),
        node('m', 'math', { op: 'add', values: { a: 0.3, b: 0.3 } }),
      ],
      [
        { from: 'v/n', to: 'm/a' },
        // A malformed raw circuit agrees with the compiler: last cord wins.
        { from: 'other/n', to: 'm/a' },
      ],
    );
    const sample = createNumberEvaluator().sample(
      graph,
      inputs({ params: { v: 0.7, other: 0.6, 'm/a': 0.99, 'm/b': 0.1 } }),
    );

    expect(sample.outlet('v/n')).toBe(0.7);
    // 0.3 + 1 × 0.6. A cord scales and offsets its inlet rather than replacing
    // it, so the number under the cord is the floor the signal is carried up
    // from. A raw circuit is read exactly as written; a *file* has been through
    // `ranged` in `scheme.ts`, which puts an old dormant number at zero so the
    // flow drawn before any of this existed still draws the same.
    expect(sample.inlet('m/a')).toBeCloseTo(0.9);
    expect(sample.inlet('m/b')).toBe(0.1);
    // 0.9 and 0.1, and `add` clamps.
    expect(sample.outlet('m/n')).toBeCloseTo(1);
  });

  it('matches every playback uniform, including quantum phase and a seeded random hold', () => {
    expect(one(node('p', 'playback', { op: 'level' }))).toBe(0.6);
    expect(one(node('p', 'playback', { op: 'beat' }))).toBe(5.25);
    expect(one(node('p', 'playback', { op: 'phase' }))).toBe(0.3125);
    expect(one(node('p', 'playback', { op: 'time' }))).toBe(12);
    expect(one(node('p', 'playback', { op: 'pulse' }), { beat: 0 })).toBe(1);

    const random = one(node('p', 'playback', { op: 'random' }), { beat: 5.25, seed: 9 });
    expect(random).toBe(one(node('p', 'playback', { op: 'random' }), { beat: 5.99, seed: 9 }));
    expect(random).not.toBe(one(node('p', 'playback', { op: 'random' }), { beat: 6, seed: 9 }));
    expect(one(node('p', 'playback', { op: 'not-a-mode' }))).toBe(0.6);
  });

  it('uses a positive quantum phase for a beat before zero', () => {
    expect(one(node('p', 'playback', { op: 'phase' }), { beat: -0.5 })).toBe(0.875);
  });

  it('reads all song facts with the renderer defaults', () => {
    expect(one(node('s', 'song', { op: 'tempo' }))).toBe(0.64);
    expect(one(node('s', 'song', { op: 'key' }))).toBe(0.25);
    expect(one(node('s', 'song', { op: 'section' }))).toBe(0.5);
    expect(one(node('s', 'song', { op: 'sections' }))).toBe(0.375);
    expect(one(node('s', 'song', { op: 'seed' }))).toBe(seedOf('Signal Fire'));
    expect(one(node('s', 'song', { op: 'not-a-fact' }))).toBe(seedOf('Signal Fire'));

    const empty = { ...SHOW, song: null, key: null, role: 'MISSING' };
    expect(one(node('s', 'song', { op: 'seed' }), { show: empty })).toBe(0.5);
    expect(one(node('s', 'song', { op: 'key' }), { show: empty })).toBe(0.5);
    expect(one(node('s', 'song', { op: 'section' }), { show: empty })).toBe(0.5);
  });

  it.each([
    ['add', 1],
    ['subtract', 0.4],
    ['multiply', 0.32],
    ['min', 0.4],
    ['max', 0.8],
    ['average', 0.6],
  ])('evaluates %s math with the shader clamp rules', (op, expected) => {
    expect(one(node('m', 'math', { op, values: { a: 0.8, b: 0.4 } }))).toBeCloseTo(expected);
  });

  it('falls back unknown math to add and clamps subtraction at zero', () => {
    expect(one(node('m', 'math', { op: 'unknown', values: { a: 0.8, b: 0.4 } }))).toBe(1);
    expect(one(node('m', 'math', { op: 'subtract', values: { a: 0.2, b: 0.4 } }))).toBe(0);
  });

  it.each([
    ['sine', 1],
    ['saw', 0.25],
    ['ramp', 0.75],
    ['square', 0],
    ['pulse', 0.31640625],
  ])('evaluates the %s wave expression used by the shader', (op, expected) => {
    expect(one(node('w', 'wave', { op }), { beat: 0.25 })).toBeCloseTo(expected);
  });

  it('evaluates seeded noise deterministically and keeps it in range', () => {
    const wave = node('w', 'wave', { op: 'noise' });
    const a = one(wave, { beat: 0.25, seed: 2 });
    const again = one(wave, { beat: 0.25, seed: 2 });
    const other = one(wave, { beat: 0.25, seed: 3 });
    expect(a).toBe(again);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(a).not.toBe(other);
  });

  it('walks a nested number chain and exposes the answer arriving at any row', () => {
    const graph = circuit(
      [
        node('a', 'value', { value: 0.2 }),
        node('b', 'value', { value: 0.3 }),
        node('sum', 'math', { op: 'add' }),
        node('shape', 'wave', { op: 'saw' }),
        node('paint', 'paint'),
      ],
      [
        { from: 'a/n', to: 'sum/a' },
        { from: 'b/n', to: 'sum/b' },
        { from: 'sum/n', to: 'shape/phase' },
        { from: 'shape/n', to: 'paint/amount' },
      ],
    );
    const sample = createNumberEvaluator().sample(graph, inputs());

    expect(sample.outlet('shape/n')).toBe(0.5);
    expect(sample.inlet('paint/amount')).toBe(0.5);
    expect(sample.inlet('paint/energy')).toBe(0.6);
  });

  it('returns undefined for per-fragment polar numbers and anything they drive', () => {
    const graph = circuit(
      [node('polar', 'polar'), node('math', 'math', { values: { b: 0.2 } })],
      [{ from: 'polar/angle', to: 'math/a' }],
    );
    const sample = createNumberEvaluator().sample(graph, inputs());

    expect(sample.outlet('polar/radius')).toBeUndefined();
    expect(sample.outlet('polar/angle')).toBeUndefined();
    expect(sample.inlet('math/a')).toBeUndefined();
    expect(sample.outlet('math/n')).toBeUndefined();
  });

  it('reads named and master tracks, and makes a renamed track harmlessly quiet', () => {
    expect(trackReading(SHOW, 'Bass', 'level')).toBe(0.8);
    expect(trackReading(SHOW, 'Bass', 'fader')).toBe(0.75);
    expect(trackReading(SHOW, 'Bass', 'playing')).toBe(1);
    expect(trackReading(SHOW, 'master', 'level')).toBe(0.6);
    expect(trackReading(SHOW, 'master', 'fader')).toBe(1);
    expect(trackReading(SHOW, 'master', 'playing')).toBe(1);
    expect(trackReading(SHOW, 'Renamed', 'level')).toBe(0);
    expect(one(node('t', 'track', { of: 'Renamed', op: 'level' }))).toBe(0);
  });

  it('holds one fast-attack, slow-release track envelope across display ticks', () => {
    const evaluator = createNumberEvaluator();
    const graph = circuit([node('t', 'track', { of: 'Bass', op: 'level', smooth: 0.5 })]);
    const high = { ...SHOW, tracks: [{ ...SHOW.tracks[0], level: 1 }] };
    const low = { ...SHOW, tracks: [{ ...SHOW.tracks[0], level: 0 }] };

    expect(evaluator.sample(graph, inputs({ show: high })).outlet('t/n')).toBe(1);
    const first = evaluator.sample(graph, inputs({ show: low })).outlet('t/n');
    const expected = smoothTrack(1, 0, 0.5, 0.1);
    expect(first).toBeCloseTo(expected);
    // A latched sample does not advance once per consumer.
    const held = evaluator.sample(graph, inputs({ show: low }));
    const second = held.outlet('t/n');
    expect(held.outlet('t/n')).toBe(second);
    expect(second).toBeCloseTo(smoothTrack(expected, 0, 0.5, 0.1));

    evaluator.reset();
    expect(evaluator.sample(graph, inputs({ show: low })).outlet('t/n')).toBe(0);
    const raw = circuit([node('t', 'track', { of: 'Bass', op: 'level', smooth: 0 })]);
    expect(evaluator.sample(raw, inputs({ show: high })).outlet('t/n')).toBe(1);
    expect(evaluator.sample(raw, inputs({ show: low })).outlet('t/n')).toBe(0);
  });

  it('defends against a number cycle without recursing forever', () => {
    const graph = circuit(
      [
        node('a', 'math', { values: { b: 0.2 } }),
        node('b', 'math', { values: { b: 0.3 } }),
      ],
      [
        { from: 'a/n', to: 'b/a' },
        { from: 'b/n', to: 'a/a' },
      ],
    );
    const sample = createNumberEvaluator().sample(graph, inputs());
    expect(sample.outlet('a/n')).toBeUndefined();
    expect(sample.outlet('b/n')).toBeUndefined();
  });

  it('returns undefined for absent, non-number, and unsupported outlets', () => {
    const graph = circuit([node('source', 'source'), node('point', 'point')]);
    const sample = createNumberEvaluator().sample(graph, inputs());
    expect(sample.outlet('missing/n')).toBeUndefined();
    expect(sample.outlet('source/c')).toBeUndefined();
    expect(sample.inlet('source/p')).toBeUndefined();
    expect(sample.inlet('missing/n')).toBeUndefined();
  });
});

describe('shared number facts', () => {
  it('keeps song section and seed defaults stable', () => {
    expect(sectionOf(SHOW)).toBe(0.5);
    expect(sectionOf({ ...SHOW, role: null })).toBe(0.5);
    expect(seedOf(null)).toBe(0.5);
    expect(seedOf('Signal Fire')).toBe(seedOf('Signal Fire'));
    expect(seedOf('Signal Fire')).not.toBe(seedOf('Another Song'));
  });

  it('uses fast attack, exponential release, and a raw zero-smooth reading', () => {
    expect(smoothTrack(0.2, 0.9, 1, 0.1)).toBe(0.9);
    expect(smoothTrack(0.9, 0.2, 0, 0.1)).toBe(0.2);
    expect(smoothTrack(0.9, 0.2, 1, 0.1)).toBeLessThan(0.9);
    expect(smoothTrack(0.9, 0.2, 1, 0.1)).toBeGreaterThan(0.2);
  });
});
