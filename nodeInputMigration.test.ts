import { describe, expect, it } from 'vitest';
import { migrateFlowInputs, migrateNodeInputs } from './nodeInputMigration.ts';
import type { FlowDef } from './protocol.ts';

const flow = (over: Partial<FlowDef['circuit']['nodes'][number]> = {}): FlowDef => ({
  name: 'Legacy bars', circuit: { nodes: [{ id: 's', kind: 'source', op: 'bars', x: 0, y: 0, ...over }], cords: [] },
});

describe('explicit node input migration', () => {
  it('fans held zero into independent grading and shape inputs without a master driver', () => {
    const result = migrateNodeInputs(flow({ values: { energy: 0 } }));
    expect(result.inputs).toBe(2);
    expect(result.circuit.nodes).toHaveLength(1);
    expect(result.circuit.nodes[0].values).toMatchObject({ brightness: 0, contrast: 0, columns: 0 });
    expect(result.circuit.nodes[0].values).not.toHaveProperty('energy');
  });
  it('preserves modulation base and signed depth and never replaces independent inputs', () => {
    const original = flow({ values: { energy: 0.7, columns: 0.3 }, depths: { energy: -0.4 } });
    original.circuit.cords.push({ from: 'driver/n', to: 's/energy' });
    const result = migrateNodeInputs(original);
    expect(result.circuit.nodes[0].values).toMatchObject({ brightness: 0.7, contrast: 0.7, columns: 0.3 });
    expect(result.circuit.nodes[0].depths).toMatchObject({ brightness: -0.4, contrast: -0.4 });
    expect(result.circuit.cords).toEqual([{ from: 'driver/n', to: 's/brightness' }, { from: 'driver/n', to: 's/contrast' }]);
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
    expect(result.legacy.circuit.nodes[0].values).toHaveProperty('brightness', 0.4);
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
    expect(migrateNodeInputs(flow({ kind: 'colorway', op: undefined })).circuit.nodes[0].values?.amount).toBe(0.5);
    const wired = flow({ kind: 'colorway', op: undefined });
    wired.circuit.cords.push({ from: 'driver/n', to: 's/amount' });
    expect(migrateNodeInputs(wired).circuit.nodes[0].values?.amount).toBeUndefined();
  });
  it('preserves literal colour values while replacing old energy keys', () => {
    expect(migrateNodeInputs(flow({ values: { energy: 0.5 }, colors: { color: '#ff0088' } })).circuit.nodes[0].colors).toEqual({ color: '#ff0088' });
  });
});
