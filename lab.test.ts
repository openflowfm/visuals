import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  canonicalCandidate,
  dealRoom,
  promoteCandidate,
  submissionProblems,
} from './lab.ts';
import type { FlowDef, LabCandidate, LabScore, Scheme } from './protocol.ts';

const flow = (name: string, over: Partial<FlowDef['circuit']> = {}): FlowDef => ({
  name,
  circuit: {
    nodes: [
      { id: 's1', kind: 'source', op: 'rings', x: 20, y: 20, values: { scale: 0.4 } },
      { id: 'out1', kind: 'out', x: 200, y: 20 },
    ],
    cords: [{ from: 's1/c', to: 'out1/c' }],
    ...over,
  },
});

describe('candidate identity', () => {
  it('ignores everything the editor owns', () => {
    const a = flow('One');
    const b: FlowDef = {
      name: 'Utterly different name',
      circuit: {
        nodes: [
          { id: 'zz', kind: 'source', op: 'rings', x: 900, y: -40, values: { scale: 0.4 }, previewOutlet: 'c' },
          { id: 'end', kind: 'out', x: 0, y: 0 },
        ],
        cords: [{ from: 'zz/c', to: 'end/c' }],
      },
    };
    expect(canonicalCandidate(a, {})).toBe(canonicalCandidate(b, {}));
  });

  it('hears every behaviour-bearing field', () => {
    const base = canonicalCandidate(flow('One'), {});
    const value = flow('One');
    value.circuit.nodes[0] = { ...value.circuit.nodes[0], values: { scale: 0.5 } };
    expect(canonicalCandidate(value, {})).not.toBe(base);

    const mode = flow('One');
    mode.circuit.nodes[0] = { ...mode.circuit.nodes[0], op: 'plasma' };
    expect(canonicalCandidate(mode, {})).not.toBe(base);

    const depth = flow('One');
    depth.circuit.nodes[0] = { ...depth.circuit.nodes[0], depths: { scale: -0.5 } };
    expect(canonicalCandidate(depth, {})).not.toBe(base);
  });

  it('freezes nested flows by content, not by name', () => {
    const inner = flow('Inner');
    const outer: FlowDef = {
      name: 'Outer',
      circuit: {
        nodes: [
          { id: 'f1', kind: 'flow', op: 'libname', x: 0, y: 0 },
          { id: 'out1', kind: 'out', x: 100, y: 0 },
        ],
        cords: [{ from: 'f1/c', to: 'out1/c' }],
      },
    };
    const renamed: FlowDef = {
      ...outer,
      circuit: {
        ...outer.circuit,
        nodes: outer.circuit.nodes.map((node) =>
          node.kind === 'flow' ? { ...node, op: 'other-id' } : node,
        ),
      },
    };
    expect(canonicalCandidate(outer, { libname: inner })).toBe(
      canonicalCandidate(renamed, { 'other-id': inner }),
    );

    const edited = flow('Inner');
    edited.circuit.nodes[0] = { ...edited.circuit.nodes[0], op: 'noise' };
    expect(canonicalCandidate(outer, { libname: inner })).not.toBe(
      canonicalCandidate(outer, { libname: edited }),
    );
  });
});

describe('the dependency bundle', () => {
  it('walks the whole transitive reach', () => {
    const leaf = flow('Leaf');
    const mid: FlowDef = {
      name: 'Mid',
      circuit: {
        nodes: [
          { id: 'f1', kind: 'flow', op: 'leaf', x: 0, y: 0 },
          { id: 'out1', kind: 'out', x: 100, y: 0 },
        ],
        cords: [{ from: 'f1/c', to: 'out1/c' }],
      },
    };
    const top: FlowDef = {
      name: 'Top',
      circuit: {
        nodes: [
          { id: 'f1', kind: 'flow', op: 'mid', x: 0, y: 0 },
          { id: 'out1', kind: 'out', x: 100, y: 0 },
        ],
        cords: [{ from: 'f1/c', to: 'out1/c' }],
      },
    };
    const bundle = bundleOf({ leaf, mid, top, unrelated: flow('No') }, top);
    expect(Object.keys(bundle).sort()).toEqual(['leaf', 'mid']);
  });
});

describe('the submit rules', () => {
  it('requires a score and nothing else', () => {
    expect(submissionProblems({ score: null, tags: [] })).toHaveLength(1);
    expect(submissionProblems({ score: 2 as LabScore, tags: [] })).toEqual([]);
    expect(
      submissionProblems({ score: 3 as LabScore, tags: ['geometric', 'eerie', 'muddy'] }),
    ).toEqual([]);
  });
});

describe('the room dealer', () => {
  it('is a pure function of its seed', () => {
    expect(dealRoom('a')).toEqual(dealRoom('a'));
    expect(dealRoom('a')).not.toEqual(dealRoom('b'));
  });

  it('deals a complete room', () => {
    const room = dealRoom('complete');
    expect(room.colors).toHaveLength(5);
    expect(room.sections).toContain(room.section);
    expect(room.tempo).toBeGreaterThanOrEqual(80);
    expect(room.seed).toBe('complete');
  });
});

describe('promotion', () => {
  const scheme: Scheme = {
    flows: { held: flow('Held') },
    colorways: { day: ['#fff'] },
    rotation: { flows: [], colorways: [], bars: 8, onClip: true, colorEvery: 8 },
    songs: {},
    defaults: { colorway: 'day', flow: 'held', pace: 0, draws: 'by name' },
  };

  const candidate: LabCandidate = {
    id: 'abcdef1234567890',
    flow: {
      name: 'Held',
      circuit: {
        nodes: [
          { id: 'f1', kind: 'flow', op: 'inner', x: 0, y: 0 },
          { id: 'out1', kind: 'out', x: 100, y: 0 },
        ],
        cords: [{ from: 'f1/c', to: 'out1/c' }],
      },
    },
    bundle: { held: flow('Bundled inner') },
    method: 'fresh',
    methodVersion: 1,
    seed: 'x:0',
  };

  it('adds the candidate and its bundle and touches nothing else', () => {
    const shaped = { ...candidate, flow: { ...candidate.flow }, bundle: { inner: flow('Inner') } };
    const { scheme: next, id } = promoteCandidate(scheme, shaped);
    expect(next.flows[id].name).toBe('Held 2');
    expect(Object.keys(next.flows)).toContain('inner');
    expect(next.rotation).toEqual(scheme.rotation);
    expect(next.defaults).toEqual(scheme.defaults);
    expect(scheme.flows[id]).toBeUndefined();
  });

  it('lands a colliding bundle id somewhere free and rewires the graph to it', () => {
    const { scheme: next, id } = promoteCandidate(scheme, {
      ...candidate,
      flow: {
        ...candidate.flow,
        circuit: {
          ...candidate.flow.circuit,
          nodes: candidate.flow.circuit.nodes.map((node) =>
            node.kind === 'flow' ? { ...node, op: 'held' } : node,
          ),
        },
      },
    });
    expect(next.flows['held'].name).toBe('Held');
    expect(next.flows['held-2'].name).toBe('Bundled inner');
    const promoted = next.flows[id];
    const flowNode = promoted.circuit.nodes.find((node) => node.kind === 'flow');
    expect(flowNode?.op).toBe('held-2');
  });
});
