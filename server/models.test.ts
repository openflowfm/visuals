import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testGlb } from '../test/glb.ts';
import { modelPlace, openModelStore, setupTargetSignature, suggestedTargetMap } from './models.ts';

const made: string[] = [];
const place = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-models-'));
  made.push(root);
  return modelPlace(root);
};

afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('the content-addressed model library', () => {
  it('imports one ordinary GLB once and never treats its filename as an address', () => {
    const root = place();
    const store = openModelStore(root);
    const bytes = testGlb();
    const first = store.import(bytes, '../../Xenon 60.glb');
    const second = store.import(bytes, 'renamed.glb');
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.name).toBe('Xenon 60.glb');
    expect(second.hash).toBe(first.hash);
    expect(store.library().assets).toHaveLength(1);
    expect(fs.readFileSync(store.assetFile(first.hash)!)).toEqual(Buffer.from(bytes));
    expect(store.assetFile('../scheme')).toBeNull();
  });

  it('does not serve or silently replace bytes which no longer match their content address', () => {
    const store = openModelStore(place());
    const bytes = testGlb();
    const asset = store.import(bytes, 'fixed.glb');
    fs.writeFileSync(store.assetFile(asset.hash)!, testGlb({ asset: { version: '2.0', generator: 'tampered' } }));
    expect(store.assetFile(asset.hash)).toBeNull();
    expect(() => store.import(bytes, 'fixed.glb')).toThrow('no longer matches its content address');
  });

  it('keeps multiple reusable setups beside one immutable asset', () => {
    const store = openModelStore(place());
    const asset = store.import(testGlb(), 'capsule.glb');
    const binding = {
      id: 'ring-01-spin', label: 'Ring 01 spin', group: 'rings', default: 0.5, min: -3.14, max: 3.14,
      target: { kind: 'node-transform' as const, node: 1, nodePath: 'Root/Ring 01', property: 'rotation-z' as const },
    };
    const a = store.save({
      id: 'xenon-60', name: 'Xenon 60', assetHash: asset.hash, bindings: [binding],
      materials: [{ material: 0, source: 'color-a', amount: 1 }], camera: 0,
    });
    const b = store.save({
      id: 'quiet-capsule', name: 'Quiet capsule', assetHash: asset.hash,
      bindings: [{ ...binding, id: 'turn', label: 'Turn' }],
      materials: [{ material: 0, source: 'color-b', amount: 0.4 }], camera: null,
    });
    expect(store.library().setups.map((setup) => setup.id)).toEqual(['quiet-capsule', 'xenon-60']);
    expect(a.assetHash).toBe(b.assetHash);
    const renamed = store.save({ ...a, name: 'Xenon sixty', bindings: [{ ...binding, label: 'Rail one' }] });
    expect(renamed.bindings[0].id).toBe('ring-01-spin');
    expect(renamed.revision).not.toBe(a.revision);
  });

  it('refuses traversal, duplicate ids, missing targets, and symlinked records', () => {
    const root = place();
    const store = openModelStore(root);
    const asset = store.import(testGlb(), 'safe.glb');
    const binding = {
      id: 'turn', label: 'Turn', group: '', default: 0.5, min: -1, max: 1,
      target: { kind: 'node-transform' as const, node: 1, nodePath: 'Root/Ring 01', property: 'rotation-z' as const },
    };
    expect(() => store.save({ id: '../bad', name: 'bad', assetHash: asset.hash, bindings: [], materials: [] }))
      .toThrow('safe lower-case address');
    expect(() => store.save({ id: `a${'b'.repeat(64)}`, name: 'bad', assetHash: asset.hash, bindings: [], materials: [] }))
      .toThrow('safe lower-case address');
    expect(() => store.save({ id: 'bad', name: 'bad', assetHash: asset.hash, bindings: [binding, binding], materials: [] }))
      .toThrow('more than once');
    expect(() => store.save({
      id: 'bad', name: 'bad', assetHash: asset.hash,
      bindings: [{ ...binding, target: { ...binding.target, nodePath: 'Somewhere else' } }], materials: [],
    })).toThrow('points outside');
    expect(() => store.save({
      id: 'bad', name: 'bad', assetHash: asset.hash, bindings: [],
      materials: [{ material: 0, source: 'unknown' as never, amount: 1 }],
    })).toThrow('invalid palette source');

    const manyMorphs = store.import(testGlb({
      meshes: [{
        name: 'Many shapes', extras: { targetNames: ['one', 'two', 'three', 'four', 'five'] },
        primitives: [{
          attributes: { POSITION: 1 }, material: 0,
          targets: Array.from({ length: 5 }, () => ({ POSITION: 1 })),
        }],
      }],
    }), 'many-morphs.glb');
    expect(() => store.save({
      id: 'too-many-morphs', name: 'Too many morphs', assetHash: manyMorphs.hash,
      bindings: [{
        id: 'fifth', label: 'Fifth', group: 'shape', default: 0, min: 0, max: 1,
        target: { kind: 'morph', mesh: 0, target: 4, name: 'five' },
      }],
      materials: [],
    })).toThrow('first 4 renderable morph targets');

    const poison = path.join(root.setups, 'poison.json');
    fs.symlinkSync(path.join(root.assets, `${asset.hash}.json`), poison);
    expect(store.library().setups).toEqual([]);
  });

  it('makes asset replacement an explicit complete reconciliation', () => {
    const store = openModelStore(place());
    const first = store.import(testGlb(), 'v1.glb');
    const changed = store.import(testGlb({ asset: { version: '2.0', generator: 'revision two' } }), 'v2.glb');
    const original = store.save({
      id: 'xenon-60', name: 'Xenon 60', assetHash: first.hash,
      bindings: [{
        id: 'ring-01-spin', label: 'Spin', group: 'rings', default: 0.5, min: -1, max: 1,
        target: { kind: 'node-transform', node: 1, nodePath: 'Root/Ring 01', property: 'rotation-z' },
      }],
      materials: [{ material: 0, source: 'color-a', amount: 1 }],
      camera: 0,
    });
    const preview = store.previewReconciliation('xenon-60', changed.hash);
    expect(preview.bindings[0].status).toBe('matched');
    expect(store.library().setups[0].assetHash).toBe(first.hash);
    expect(() => store.save({ ...original, assetHash: changed.hash }))
      .toThrow('must use explicit reconciliation');
    expect(() => store.reconcile('xenon-60', changed.hash, {
      targets: {}, materials: { 0: 0 }, camera: 0,
    })).toThrow('decide every');
    expect(preview.materials[0].suggestion).toBe(0);
    expect(preview.camera).toBe(0);
    expect(() => store.reconcile('xenon-60', changed.hash, {
      targets: suggestedTargetMap(preview), materials: {}, camera: 0,
    })).toThrow('decide every material');
    const reconciled = store.reconcile('xenon-60', changed.hash, {
      targets: suggestedTargetMap(preview),
      materials: { 0: 0 },
      camera: 0,
    });
    expect(reconciled.assetHash).toBe(changed.hash);
    expect(reconciled.bindings[0].id).toBe('ring-01-spin');
    expect(reconciled.materials[0]).toMatchObject({ material: 0, source: 'color-a' });
    expect(reconciled.camera).toBe(0);
    expect(setupTargetSignature(reconciled)).toBe(setupTargetSignature(original));
  });
});
