import type { Circuit, CircuitNode, FlowDef } from './protocol.ts';
import { NODE_SPECS } from './client/render/circuit.ts';
import { legacyEnergyTargets } from './client/render/legacyEnergy.ts';

export const NODE_INPUT_VERSION = 2;

/** Expand old implicit coupling once, into ordinary visible controls and cords. */
export function migrateNodeInputs(flow: FlowDef, inheritedVersion = 1): FlowDef {
  if ((flow.inputs ?? inheritedVersion) >= NODE_INPUT_VERSION) {
    return flow.inputs === undefined ? { ...flow, inputs: NODE_INPUT_VERSION } : flow;
  }
  const circuit = flow.circuit;
  const feeds = new Map(circuit.cords.map(cord => [cord.to, cord.from]));
  const ids = new Set(circuit.nodes.map(node => node.id));
  let masterId = '~master-level';
  for (let n = 1; ids.has(masterId); n++) masterId = `~master-level-${n}`;
  let needsMaster = false;
  const added: Circuit['cords'] = [];
  const controls: CircuitNode[] = [];
  const unique = (stem: string) => { let id = stem; for (let n = 1; ids.has(id); n++) id = `${stem}-${n}`; ids.add(id); return id; };
  const removed = new Set<string>();
  const nodes = circuit.nodes.map(original => {
    const op = original.op ?? NODE_SPECS[original.kind]?.modes?.[0]?.name;
    const targets = legacyEnergyTargets({ kind: original.kind, op });
    if (!targets.length) return original;
    const values = { ...original.values };
    const depths = { ...original.depths };
    if (original.kind === 'colorway' && values.amount === undefined && !feeds.has(`${original.id}/amount`)) {
      const id = unique(`~${original.id}-opacity`);
      // Average's two default midpoints preserve old opacity without a parameter slot.
      controls.push({ id, kind: 'math', op: 'average', label: 'Legacy opacity', x: original.x - 220, y: original.y + 220 });
      values.amount = 0;
      depths.amount = 1;
      added.push({ from: `${id}/n`, to: `${original.id}/amount` });
    }
    const energy = original.values?.energy;
    const depth = original.depths?.energy;
    const from = feeds.get(`${original.id}/energy`);
    let shared: string | undefined;
    for (const target of targets) {
      const address = `${original.id}/${target.name}`;
      // An independently set input already meant something; migration cannot take it over.
      if (original.values?.[target.name] !== undefined || feeds.has(address)) continue;
      if (energy !== undefined || (from && depth !== undefined && depth !== 1)) {
        if (!shared) {
          const id = unique(`~${original.id}-control`);
          shared = `${id}/n`;
          controls.push(from
            ? { id, kind: 'math', op: 'curve', x: original.x - 220, y: original.y, values: { a: energy ?? 0 }, depths: { a: depth ?? 1 } }
            : { id, kind: 'value', value: energy, x: original.x - 220, y: original.y });
          if (from) added.push({ from, to: `${id}/a` });
        }
        values[target.name] = 0;
        depths[target.name] = 1;
        added.push({ from: shared, to: address });
        continue;
      }
      if (depth !== undefined) depths[target.name] = depth;
      if (from) added.push({ from, to: address });
      else {
        needsMaster = true;
        added.push({ from: `${masterId}/n`, to: address });
        values[target.name] = 0;
        depths[target.name] = 1;
      }
    }
    delete values.energy;
    delete depths.energy;
    removed.add(`${original.id}/energy`);
    const node: CircuitNode = { ...original };
    if (Object.keys(values).length) node.values = values; else delete node.values;
    if (Object.keys(depths).length) node.depths = depths; else delete node.depths;
    return node;
  });
  nodes.push(...controls);
  if (needsMaster) nodes.push({ id: masterId, kind: 'playback', op: 'level',
    x: 0, y: Math.max(0, ...nodes.map(node => node.y)) + 220 });
  return { ...flow, inputs: NODE_INPUT_VERSION, circuit: {
    nodes, cords: [...circuit.cords.filter(cord => !removed.has(cord.to)), ...added],
  } };
}

export function migrateFlowInputs(flows: Record<string, FlowDef>, inheritedVersion = 1): Record<string, FlowDef> {
  return Object.fromEntries(Object.entries(flows).map(([id, flow]) => [id, migrateNodeInputs(flow, inheritedVersion)]));
}
