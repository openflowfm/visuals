import { describe, expect, it } from 'vitest';
import { COLOR_ROLES, type Circuit, type CircuitNode } from '../../protocol.ts';
import { NODE_SPECS, compileCircuit, inletsOf, repaired } from './circuit.ts';
import { signatureOfCircuit } from './flow.ts';
import { productionResponse } from '../../response.ts';
import { legacyEnergyTargets } from './legacyEnergy.ts';

const graph = (node: Partial<CircuitNode> = {}): Circuit => ({
  nodes: [{ id: 's', kind: 'source', op: 'solid', x: 0, y: 0, ...node }, { id: 'o', kind: 'out', x: 1, y: 0 }],
  cords: [{ from: 's/c', to: 'o/c' }],
});
const main = (c: Circuit) => compileCircuit(c).source!.split('void main() {').at(-1)!;

describe('explicit node inputs', () => {
  it('exposes no energy inlet or implicit sibling coupling in any mode', () => {
    for (const [kind, spec] of Object.entries(NODE_SPECS)) {
      for (const mode of spec.modes ?? [{ name: '' }]) {
        const node = { id: 'n', kind, op: mode.name, x: 0, y: 0 } as CircuitNode;
        for (const port of inletsOf(node)) {
          expect(port.name, `${kind}/${mode.name}`).not.toBe('energy');
          expect(port.fallbackInlet, `${kind}/${mode.name}/${port.name}`).toBeUndefined();
          if (port.colorRole) expect(COLOR_ROLES).toContain(port.colorRole);
        }
        for (const target of legacyEnergyTargets(node)) {
          expect(inletsOf(node).some(port => port.name === target.name), `${kind}/${mode.name}/${target.name}`).toBe(true);
          if (target.response === 'energy') expect(productionResponse({ kind: node.kind, mode: mode.name, inlet: target.name })).toEqual(productionResponse({ kind: node.kind, mode: mode.name, inlet: 'energy' }));
        }
      }
    }
  });
  it('compiles a literal hue, with a wire taking precedence and deletion restoring the role', () => {
    const circuit = graph({ colors: { color: '#ff0000' } });
    expect(main(circuit)).toContain('colorRGB(vec4(1.0, 0.0, 0.0, 1.0))');
    circuit.nodes.push({ id: 'palette', kind: 'colorway', x: 0, y: 0 });
    circuit.cords.push({ from: 'palette/accent', to: 's/color' });
    expect(main(circuit)).not.toContain('vec4(1.0, 0.0, 0.0, 1.0)');
    expect(main(circuit)).toContain('uColors[3]');
    expect(main(graph())).toContain('uColors[0]');
  });
  it('repairs malformed and obsolete colors while retaining valid mode ports', () => {
    const circuit = graph({ colors: { color: '#1a2b3c', highlight: '#ffffff', bad: '#ffffff', brightness: '#111111' } });
    expect(repaired(circuit).nodes[0].colors).toEqual({ color: '#1a2b3c' });
    expect(repaired(graph({ colors: { color: 'vec4(1.0)' } })).nodes[0].colors).toBeUndefined();
    expect(main(graph({ colors: { color: 'vec4(1.0)' } }))).toContain('uColors[0]');
  });
  it('invalidates shader cache for literal edits independent of property order', () => {
    const first = graph({ op: 'plasma', colors: { color: '#ff0000', secondary: '#0000ff' } });
    const ordered = graph({ op: 'plasma', colors: { secondary: '#0000ff', color: '#ff0000' } });
    const changed = graph({ op: 'plasma', colors: { color: '#00ff00', secondary: '#0000ff' } });
    expect(signatureOfCircuit(first)).toBe(signatureOfCircuit(ordered));
    expect(signatureOfCircuit(first)).not.toBe(signatureOfCircuit(changed));
  });
});
