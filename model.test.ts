import { describe, expect, it } from 'vitest';
import {
  MAX_MODEL_LIGHTS,
  bindingDomainValue,
  inspectGlb,
  modelLightingOf,
  modelLightingPreset,
  readGlb,
  reconcileBindings,
  type ModelSetup,
} from './model.ts';
import { testGlb } from './test/glb.ts';

describe('metadata-free GLB inspection', () => {
  it('reads the inert container and discovers the authored capability tree', () => {
    const glb = testGlb();
    expect(readGlb(glb).binary.byteLength).toBe(32);
    const found = inspectGlb(glb);
    expect(found.generator).toBe('OpenFlow test');
    expect(found.scenes[0]).toEqual({ index: 0, name: 'Proof', nodes: [0, 2] });
    expect(found.nodes[1]).toMatchObject({ path: 'Root/Ring 01', mesh: 0, skin: 0 });
    expect(found.meshes[0].primitives[0]).toMatchObject({
      vertices: 3,
      indices: 3,
      morphTargets: ['Open'],
      attributes: ['NORMAL', 'POSITION'],
    });
    expect(found.materials[0]).toMatchObject({ name: 'Ring light', metallic: 0.8, emissiveStrength: 3 });
    expect(found.skins[0]).toMatchObject({ joints: [1], jointNames: ['Ring 01'] });
    expect(found.animations[0]).toMatchObject({ name: 'Pulse', duration: 2 });
    expect(found.animations[0].channels[0]).toMatchObject({ nodePath: 'Root/Ring 01', property: 'scale', interpolation: 'STEP' });
    expect(found.cameras[0]).toMatchObject({ type: 'perspective', yfov: 0.7 });
    expect(found.lights[0]).toMatchObject({ name: 'Key', type: 'spot', intensity: 12 });
  });

  it('refuses malformed containers without following a URI', () => {
    const wrong = testGlb({ buffers: [{ byteLength: 32, uri: 'https://example.test/model.bin' }] });
    expect(inspectGlb(wrong).warnings).toContain(
      'Only the embedded GLB buffer is rendered; external glTF resources are not fetched.',
    );
    const truncated = wrong.slice(0, wrong.length - 1);
    expect(() => readGlb(truncated)).toThrow('length does not match');
    const magic = wrong.slice();
    magic[0] = 0;
    expect(() => readGlb(magic)).toThrow('not a binary glTF');
    const tooManyNodes = testGlb({ nodes: Array.from({ length: 4097 }, (_, index) => ({ name: `node ${index}` })) });
    expect(() => inspectGlb(tooManyNodes)).toThrow('more than 4096 nodes');
  });

  it('keeps normalized instance values separate from setup domain ranges', () => {
    const setup = {
      bindings: [{
        id: 'ring-01-spin', label: 'Ring 01 spin', group: 'rings', default: 0.5,
        min: -Math.PI, max: Math.PI,
        target: { kind: 'node-transform', node: 1, nodePath: 'Root/Ring 01', property: 'rotation-z' },
      }],
    } as ModelSetup;
    expect(bindingDomainValue(setup.bindings[0], 0)).toBeCloseTo(-Math.PI);
    expect(bindingDomainValue(setup.bindings[0], 0.5)).toBeCloseTo(0);
    expect(bindingDomainValue(setup.bindings[0], 1)).toBeCloseTo(Math.PI);
  });

  it('reconciles by semantic path without changing stable binding ids or labels', () => {
    const capabilities = inspectGlb(testGlb());
    const setup = {
      bindings: [
        {
          id: 'ring-01-spin', label: 'First rail', group: 'rings', default: 0.5, min: -1, max: 1,
          target: { kind: 'node-transform', node: 99, nodePath: 'Root/Ring 01', property: 'rotation-z' },
        },
        {
          id: 'gone', label: 'Old morph', group: 'shape', default: 0, min: 0, max: 1,
          target: { kind: 'morph', mesh: 99, target: 0, name: 'Gone' },
        },
      ],
    } as ModelSetup;
    const preview = reconcileBindings(setup, capabilities);
    expect(preview[0]).toMatchObject({ status: 'matched', binding: { id: 'ring-01-spin', label: 'First rail' } });
    expect(preview[0].suggestion).toMatchObject({ node: 1, nodePath: 'Root/Ring 01' });
    expect(preview[1]).toMatchObject({ status: 'missing', suggestion: null });
  });

  it('provides bounded reusable lighting presets without sharing mutable rig state', () => {
    const first = modelLightingPreset('neon');
    const second = modelLightingPreset('neon');
    expect(first.lights.length).toBeLessThanOrEqual(MAX_MODEL_LIGHTS);
    expect(first.lights.filter((light) => light.shadow)).toHaveLength(1);
    expect(first.lights.map((light) => light.source)).toEqual(['primary', 'secondary', 'accent']);
    first.lights[0]!.intensity = 0;
    expect(second.lights[0]!.intensity).toBeGreaterThan(0);
    expect(modelLightingOf({}).preset).toBe('studio');
  });

  it('keeps setup-owned lighting bindings stable across GLB reconciliation', () => {
    const capabilities = inspectGlb(testGlb());
    const setup = {
      lighting: modelLightingPreset('studio'),
      bindings: [
        {
          id: 'key-strength', label: 'Key strength', group: 'lighting', default: 0.5, min: 0, max: 8,
          target: { kind: 'light', light: 'key', property: 'intensity' },
        },
        {
          id: 'environment', label: 'Environment', group: 'lighting', default: 0.25, min: 0, max: 8,
          target: { kind: 'environment', property: 'intensity' },
        },
      ],
    } as ModelSetup;
    const preview = reconcileBindings(setup, capabilities);
    expect(preview.map(({ status }) => status)).toEqual(['matched', 'matched']);
    expect(preview.map(({ suggestion }) => suggestion)).toEqual(setup.bindings.map(({ target }) => target));
  });
});
