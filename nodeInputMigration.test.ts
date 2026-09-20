import { describe, expect, it } from 'vitest';
import { migrateFlowInputs, migrateNodeInputs } from './nodeInputMigration.ts';
import { compileCircuit, compileFlow, valuesOf } from './client/render/circuit.ts';
import type { FlowDef } from './protocol.ts';

const flow = (over: Partial<FlowDef['circuit']['nodes'][number]> = {}): FlowDef => ({
  name: 'Legacy bars', circuit: { nodes: [{ id: 's', kind: 'source', op: 'bars', x: 0, y: 0, ...over }], cords: [] },
});

describe('explicit node input migration', () => {
  it('fans held zero into independent grading and shape inputs without a master driver', () => {
    const result = migrateNodeInputs(flow({ values: { energy: 0 } }));
    expect(result.inputs).toBe(2);
    expect(result.circuit.nodes).toHaveLength(2);
    expect(result.circuit.nodes[1]).toMatchObject({ kind: 'value', value: 0 });
    expect(result.circuit.nodes[0].values).toMatchObject({ brightness: 0, contrast: 0, columns: 0 });
    expect(result.circuit.nodes[0].values).not.toHaveProperty('energy');
  });
  it('preserves modulation base and signed depth and never replaces independent inputs', () => {
    const original = flow({ values: { energy: 0.7, columns: 0.3 }, depths: { energy: -0.4 } });
    original.circuit.cords.push({ from: 'driver/n', to: 's/energy' });
    const result = migrateNodeInputs(original);
    expect(result.circuit.nodes[0].values).toMatchObject({ brightness: 0, contrast: 0, columns: 0.3 });
    expect(result.circuit.nodes[0].depths).toMatchObject({ brightness: 1, contrast: 1 });
    expect(result.circuit.nodes[1]).toMatchObject({ kind: 'math', op: 'curve', values: { a: 0.7 }, depths: { a: -0.4 } });
    expect(result.circuit.cords).toEqual([{ from: 'driver/n', to: '~s-control/a' }, { from: '~s-control/n', to: 's/brightness' }, { from: '~s-control/n', to: 's/contrast' }]);
    expect(original.circuit.nodes[0].values).toHaveProperty('energy', 0.7);
  });
  it('uses a collision-safe visible master driver for formerly implicit room inputs', () => {
    const original = flow();
    original.circuit.nodes.push({ id: '~master-level', kind: 'value', value: 0.2, x: 0, y: 0 });
    const result = migrateNodeInputs(original);
    expect(result.circuit.nodes.find(node => node.id === '~master-level-1')).toMatchObject({ kind: 'playback', op: 'level' });
    expect(result.circuit.cords).toContainEqual({ from: '~master-level-1/n', to: 's/columns' });
    expect(migrateNodeInputs(result)).toBe(result);
  });
  it('respects per-flow stamps over scheme defaults and keeps current graphs unchanged', () => {
    const current = { ...flow(), inputs: 2 };
    const legacy = { ...flow({ values: { energy: 0.4 } }), inputs: 1 };
    const result = migrateFlowInputs({ current, legacy }, 2);
    expect(result.current).toBe(current);
    expect(result.legacy.circuit.nodes[1]).toMatchObject({ kind: 'value', value: 0.4 });
    expect(migrateNodeInputs(flow(), 2).circuit.nodes).toHaveLength(1);
  });
  it('normalizes missing modes and preserves already-wired follower controls', () => {
    const original = flow({ op: undefined });
    original.circuit.cords.push({ from: 'other/n', to: 's/brightness' });
    const result = migrateNodeInputs(original);
    expect(result.circuit.cords.filter(cord => cord.to === 's/brightness')).toEqual([{ from: 'other/n', to: 's/brightness' }]);
    expect(result.circuit.nodes[0].values).not.toHaveProperty('energy');
  });
  it('preserves legacy Colorway opacity without adding a base to a wired amount', () => {
    const legacy = migrateNodeInputs(flow({ kind: 'colorway', op: undefined }));
    expect(legacy.circuit.nodes.find(node => node.id === '~s-opacity')).toMatchObject({ kind: 'math', op: 'average' });
    expect(legacy.circuit.cords).toContainEqual({ from: '~s-opacity/n', to: 's/amount' });
    expect(valuesOf(legacy.circuit)).toHaveLength(0);
    const wired = flow({ kind: 'colorway', op: undefined });
    wired.circuit.cords.push({ from: 'driver/n', to: 's/amount' });
    expect(migrateNodeInputs(wired).circuit.nodes[0].values?.amount).toBeUndefined();
  });
  it('keeps large legacy graphs within the parameter bank by sharing visible controls', () => {
    const original = flow();
    original.circuit.nodes = Array.from({ length: 22 }, (_, i) => ({ id: `s${i}`, kind: 'source' as const, op: 'bars', x: i * 220, y: 0, values: { energy: 0.5 } }));
    original.circuit.nodes.push({ id: 'out', kind: 'out', x: 0, y: 220 });
    original.circuit.cords = [{ from: 's0/c', to: 'out/c' }];
    const result = migrateNodeInputs(original);
    expect(valuesOf(result.circuit)).toHaveLength(22);
    expect(compileCircuit(result.circuit).error).toBeNull();
    expect(result.circuit.cords).toContainEqual({ from: '~s0-control/n', to: 's0/brightness' });
  });
  it('preserves the bank limit across nested flows', () => {
    const inner = flow();
    inner.circuit.nodes = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, kind: 'source' as const, op: 'bars', x: 0, y: i * 220, values: { energy: 0.5 } }));
    inner.circuit.nodes.push({ id: 'out', kind: 'out', x: 220, y: 0 });
    inner.circuit.cords = [{ from: 's0/c', to: 'out/c' }];
    const outer: FlowDef = { name: 'outer', circuit: { nodes: [{ id: 'a', kind: 'flow', op: 'inner', x: 0, y: 0 }, { id: 'b', kind: 'flow', op: 'inner', x: 0, y: 220 }, { id: 'out', kind: 'out', x: 220, y: 0 }], cords: [{ from: 'a/c', to: 'out/c' }] } };
    const built = compileFlow(migrateFlowInputs({ inner, outer }), 'outer');
    expect(built.error).toBeNull();
    expect(built.values).toHaveLength(22);
  });
  it('shares a wired signed range without applying its base separately at each target', () => {
    const original = flow();
    original.circuit.nodes = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, kind: 'source' as const, op: 'bars', x: i * 220, y: 0, values: { energy: 0.7 }, depths: { energy: -0.4 } }));
    original.circuit.nodes.push({ id: 'driver', kind: 'value', value: 0.2, x: 0, y: 0 }, { id: 'out', kind: 'out', x: 0, y: 220 });
    original.circuit.cords = [...Array.from({ length: 12 }, (_, i) => ({ from: 'driver/n', to: `s${i}/energy` })), { from: 's0/c', to: 'out/c' }];
    const result = migrateNodeInputs(original);
    expect(valuesOf(result.circuit)).toHaveLength(25);
    expect(result.circuit.nodes.find(node => node.id === '~s0-control')).toMatchObject({ kind: 'math', values: { a: 0.7 }, depths: { a: -0.4 } });
    expect(compileCircuit(result.circuit).error).toBeNull();
  });
  it('preserves literal colour values while replacing old energy keys', () => {
    expect(migrateNodeInputs(flow({ values: { energy: 0.5 }, colors: { color: '#ff0088' } })).circuit.nodes[0].colors).toEqual({ color: '#ff0088' });
  });
});
