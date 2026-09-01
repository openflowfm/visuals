import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode, Scheme } from '../../../protocol.ts';
import type { ModelLibrary, ModelSetup } from '../../../model.ts';
import { compileCircuit, inletsOf } from '../../render/circuit.ts';
import { synchronizeModelNodes } from '../../../server/models.ts';

const model = (id: string, setup = 'xenon-60'): CircuitNode => ({
  id,
  kind: 'model',
  setup,
  setupRevision: 'old',
  modelPorts: [
    { id: 'ring-01-spin', label: 'First ring', group: 'rings', default: 0.5 },
    { id: 'ring-02-spin', label: 'Second ring', group: 'rings', default: 0.5 },
  ],
  values: { 'ring-01-spin': 0.3, 'ring-02-spin': 0.7 },
  depths: { 'ring-01-spin': -0.4 },
  x: 0,
  y: 0,
});

const circuit = (models: CircuitNode[]): Circuit => ({
  nodes: [...models, { id: 'o', kind: 'out', x: 300, y: 0 }],
  cords: [{ from: `${models[models.length - 1].id}/c`, to: 'o/c' }],
});

describe('the reusable model node', () => {
  it('wears stable binding ids as graph addresses and cosmetic labels on its face', () => {
    const ports = inletsOf(model('m'));
    expect(ports.map((port) => port.name)).toEqual([
      'p', 'color-a', 'color-b', 'ring-01-spin', 'ring-02-spin',
    ]);
    expect(ports[3]).toMatchObject({ name: 'ring-01-spin', label: 'First ring', at: 0.5 });
    expect(ports[1].fallback).toBe('vec4(uPrimary, 1.0)');
    expect(ports[2].fallback).toBe('vec4(uSecondary, 1.0)');
  });

  it('compiles to a normal colour expression with bounded model textures', () => {
    const built = compileCircuit(circuit([model('m')]));
    expect(built.error).toBeNull();
    expect(built.models).toEqual([{ id: 'm', setup: 'xenon-60', index: 0 }]);
    expect(built.source).toContain('fromModel0(');
    expect(built.source).toContain('vec4(uPrimary, 1.0)');
    expect(built.source).toContain('uniform sampler2D uModelBase0;');
    expect(built.source).toContain('base.a + mask.a * max(a.a, b.a)');
  });

  it('refuses more than two reachable passes by name', () => {
    const nodes = [model('a'), model('b'), model('c')];
    const graph: Circuit = {
      nodes: [
        ...nodes,
        { id: 'ab', kind: 'blend', op: 'add', x: 100, y: 0 },
        { id: 'abc', kind: 'blend', op: 'add', x: 200, y: 0 },
        { id: 'o', kind: 'out', x: 300, y: 0 },
      ],
      cords: [
        { from: 'a/c', to: 'ab/base' },
        { from: 'b/c', to: 'ab/top' },
        { from: 'ab/c', to: 'abc/base' },
        { from: 'c/c', to: 'abc/top' },
        { from: 'abc/c', to: 'o/c' },
      ],
    };
    expect(compileCircuit(graph).error).toBe('more than 2 reachable model nodes');
  });

  it('synchronizes labels and revisions without moving cords, values, or depths', () => {
    const setup = {
      id: 'xenon-60',
      revision: 'new',
      bindings: [
        { id: 'ring-01-spin', label: 'Meridian one', group: 'rails', default: 0.5 },
        { id: 'ring-02-spin', label: 'Meridian two', group: 'rails', default: 0.5 },
      ],
    } as ModelSetup;
    const graph = circuit([model('m')]);
    graph.cords.unshift({ from: 'driver/n', to: 'm/ring-01-spin' });
    graph.nodes.unshift({ id: 'driver', kind: 'value', value: 0.2, x: -100, y: 0 });
    const scheme = { flows: { proof: { name: 'Proof', circuit: graph } } } as unknown as Scheme;
    const synced = synchronizeModelNodes(scheme, { assets: [], setups: [setup], textures: [], notice: null } as ModelLibrary);
    const node = synced.flows.proof.circuit.nodes.find((entry) => entry.id === 'm')!;
    expect(node.modelPorts?.[0]).toMatchObject({ id: 'ring-01-spin', label: 'Meridian one' });
    expect(node.values).toEqual({ 'ring-01-spin': 0.3, 'ring-02-spin': 0.7 });
    expect(node.depths).toEqual({ 'ring-01-spin': -0.4 });
    expect(synced.flows.proof.circuit.cords).toContainEqual({ from: 'driver/n', to: 'm/ring-01-spin' });
  });
});
