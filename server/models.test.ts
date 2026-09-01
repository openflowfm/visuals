import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testGlb, texturedGlb } from '../test/glb.ts';
import { encodePng, pngHeaderOnly } from '../test/png.ts';
import {
  MAX_MODEL_IMAGE_EDGE,
  MAX_MODEL_TEXTURE_OVERRIDES,
  MODEL_CAPABILITY_VERSION,
  MODEL_SLOTS,
  modelLightingPreset,
  modelPorts,
  modelRecipe,
  type ModelMaterialRecipe,
  type ModelSetupDraft,
} from '../model.ts';
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

  it('persists setup-owned lighting and validates its bounded published controls', () => {
    const store = openModelStore(place());
    const asset = store.import(testGlb(), 'lit.glb');
    const lighting = modelLightingPreset('neon');
    const first = store.save({
      id: 'lit', name: 'Lit', assetHash: asset.hash, materials: [], lighting,
      bindings: [{
        id: 'key-strength', label: 'Key strength', group: 'lighting', default: 0.5, min: 0, max: 16,
        target: { kind: 'light', light: 'key', property: 'intensity' },
      }],
    });
    expect(first.lighting?.preset).toBe('neon');
    expect(first.lighting?.lights[0]).toMatchObject({ id: 'key', shadow: true });
    const changed = store.save({
      ...first,
      lighting: { ...lighting, environment: { ...lighting.environment, intensity: 0.9 } },
    });
    expect(changed.revision).not.toBe(first.revision);

    expect(() => store.save({
      id: 'missing-light', name: 'Missing', assetHash: asset.hash, materials: [], lighting,
      bindings: [{
        id: 'gone', label: 'Gone', group: 'lighting', default: 0, min: 0, max: 1,
        target: { kind: 'light', light: 'gone', property: 'intensity' },
      }],
    })).toThrow('outside');
    expect(() => store.save({
      id: 'too-many-lights', name: 'Many', assetHash: asset.hash, materials: [], bindings: [],
      lighting: { ...lighting, lights: [...lighting.lights, lighting.lights[0]!, lighting.lights[1]!] },
    })).toThrow('at most 4');
    expect(() => store.save({
      id: 'two-shadows', name: 'Two shadows', assetHash: asset.hash, materials: [], bindings: [],
      lighting: { ...lighting, lights: lighting.lights.map((light, index) => ({ ...light, shadow: index !== 1 })) },
    })).toThrow('at most one');
    expect(() => store.save({
      id: 'point-shadow', name: 'Point shadow', assetHash: asset.hash, materials: [], bindings: [],
      lighting: { ...lighting, lights: [{ ...lighting.lights[0]!, type: 'point', shadow: true }] },
    })).toThrow('point light');
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

describe('material recipes and local textures', () => {
  const png = (seed: number) => encodePng(2, 2, new Uint8Array(16).map((_, at) => (at * 37 + seed) & 0xff));

  it('imports a PNG once as an immutable content-addressed override and refuses foreign bytes', () => {
    const store = openModelStore(place());
    const bytes = png(1);
    const first = store.importTexture(bytes, '../Neon grid.png', 'image/png');
    const second = store.importTexture(bytes, 'copy.png', null);
    expect(first).toMatchObject({ name: 'Neon grid.png', mimeType: 'image/png', width: 2, height: 2, bytes: bytes.byteLength });
    expect(second.hash).toBe(first.hash);
    expect(store.library().textures).toHaveLength(1);
    const stored = store.textureFile(first.hash)!;
    expect(stored.mimeType).toBe('image/png');
    expect(fs.readFileSync(stored.file)).toEqual(Buffer.from(bytes));
    expect(store.textureFile('../scheme')).toBeNull();
    expect(() => store.importTexture(pngHeaderOnly(MAX_MODEL_IMAGE_EDGE + 1, 8), 'huge.png', 'image/png'))
      .toThrow('larger than the 4096 pixel edge ceiling');
    expect(() => store.importTexture(bytes, 'photo.webp', 'image/webp')).toThrow('not a supported image type');
    expect(() => store.importTexture(bytes, 'photo.jpg', 'image/jpeg')).toThrow('declared image/jpeg but the bytes are image/png');
    expect(() => store.importTexture(new Uint8Array([1, 2, 3]), 'junk.png', null)).toThrow('not readable PNG or JPEG');
    fs.writeFileSync(stored.file, png(2));
    expect(store.textureFile(first.hash)).toBeNull();
  });

  it('validates recipes against the library, fills their defaults and bounds their numbers', () => {
    const store = openModelStore(place());
    const asset = store.import(texturedGlb(), 'quad.glb');
    const texture = store.importTexture(png(3), 'grid.png', 'image/png');
    const draft = (recipe: Partial<ModelMaterialRecipe>): ModelSetupDraft => ({
      id: 'quad', name: 'Quad', assetHash: asset.hash, bindings: [],
      materials: [{ material: 0, source: 'color-a', amount: 1, recipe: modelRecipe(recipe) }],
      camera: null,
    });
    expect(() => store.save(draft({ slots: { baseColor: { kind: 'texture', hash: 'd'.repeat(64) } } as never })))
      .toThrow('not in the model library');
    expect(() => store.save(draft({ projection: 'spherical' as never }))).toThrow('invalid projection');
    expect(() => store.save(draft({ textureMix: 2 }))).toThrow('texture mix must be between 0 and 1');
    expect(() => store.save(draft({ uvScale: [1, Number.NaN] }))).toThrow('UV scale');
    const saved = store.save(draft({ slots: { emissive: { kind: 'texture', hash: texture.hash } } as never, rim: 0.4 }));
    expect(saved.materials[0]!.recipe).toMatchObject({
      slots: { baseColor: { kind: 'authored' }, emissive: { kind: 'texture', hash: texture.hash } },
      projection: 'uv', wrap: 'authored', rim: 0.4, bands: 0, normalStrength: 1,
    });
    const plain = store.save({ ...draft({}), materials: [{ material: 0, source: 'original', amount: 1 }] });
    expect(plain.materials[0]).not.toHaveProperty('recipe');
    const overrides = Array.from({ length: MAX_MODEL_TEXTURE_OVERRIDES + 1 }, (_, at) => store.importTexture(png(10 + at), `t${at}.png`, null).hash);
    const pair = store.import(texturedGlb({
      json: { materials: [{ name: 'One', pbrMetallicRoughness: {} }, { name: 'Two', pbrMetallicRoughness: {} }] },
    }), 'pair.glb');
    const slots = (hashes: string[]) => Object.fromEntries(
      MODEL_SLOTS.slice(0, hashes.length).map((slot, at) => [slot, { kind: 'texture', hash: hashes[at] }]),
    );
    const spread = (count: number): ModelSetupDraft => ({
      id: 'pair', name: 'Pair', assetHash: pair.hash, bindings: [], camera: null,
      materials: [
        { material: 0, source: 'original', amount: 1, recipe: modelRecipe({ slots: slots(overrides.slice(0, 5)) as never }) },
        { material: 1, source: 'original', amount: 1, recipe: modelRecipe({ slots: slots(overrides.slice(5, count)) as never }) },
      ],
    });
    expect(store.save(spread(MAX_MODEL_TEXTURE_OVERRIDES)).materials).toHaveLength(2);
    expect(() => store.save(spread(MAX_MODEL_TEXTURE_OVERRIDES + 1)))
      .toThrow(`at most ${MAX_MODEL_TEXTURE_OVERRIDES} local textures`);
  });

  it('publishes the new numeric recipe properties as stable bindings and refuses unknown ones', () => {
    const store = openModelStore(place());
    const asset = store.import(texturedGlb(), 'quad.glb');
    const binding = (property: string): ModelSetupDraft => ({
      id: 'quad', name: 'Quad', assetHash: asset.hash, camera: null, materials: [],
      bindings: [{
        id: 'grain', label: 'Grain', group: 'surface', default: 0.5, min: 0, max: 2,
        target: { kind: 'material', material: 0, property: property as never },
      }],
    });
    for (const property of ['normal-strength', 'texture-mix', 'uv-rotation', 'uv-offset-x', 'rim', 'bands']) {
      expect(store.save(binding(property)).bindings[0]!.target).toMatchObject({ kind: 'material', property });
    }
    expect(() => store.save(binding('sparkle'))).toThrow('points outside');
    expect(modelPorts(store.save(binding('scan')))).toEqual([{ id: 'grain', label: 'Grain', group: 'surface', default: 0.5 }]);
  });

  it('rebuilds capability records written by an older inspector from their bytes', () => {
    const root = place();
    const store = openModelStore(root);
    const asset = store.import(texturedGlb(), 'quad.glb');
    const record = path.join(root.assets, `${asset.hash}.json`);
    const old = JSON.parse(fs.readFileSync(record, 'utf8'));
    delete old.capabilities.inspector;
    delete old.capabilities.images;
    delete old.capabilities.textures;
    fs.writeFileSync(record, JSON.stringify(old));
    const listed = store.library().assets[0]!;
    expect(listed.capabilities.inspector).toBe(MODEL_CAPABILITY_VERSION);
    expect(listed.capabilities.images).toHaveLength(3);
    expect(JSON.parse(fs.readFileSync(record, 'utf8')).capabilities.images).toHaveLength(3);
  });

  it('flags authored slots the replacement material no longer carries during reconciliation', () => {
    const store = openModelStore(place());
    const textured = store.import(texturedGlb(), 'v1.glb');
    const flat = store.import(texturedGlb({
      json: { asset: { version: '2.0', generator: 'flat' } },
      material: { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] }, normalTexture: undefined, occlusionTexture: undefined },
    }), 'v2.glb');
    store.save({
      id: 'quad', name: 'Quad', assetHash: textured.hash, bindings: [], camera: null,
      materials: [{ material: 0, source: 'original', amount: 1, recipe: modelRecipe({ slots: { normal: { kind: 'none' } } as never }) }],
    });
    const preview = store.previewReconciliation('quad', flat.hash);
    expect(preview.materials[0]).toMatchObject({ suggestion: 0, missingSlots: ['baseColor', 'occlusion'] });
    const reconciled = store.reconcile('quad', flat.hash, { targets: {}, materials: { 0: 0 }, camera: null });
    expect(reconciled.materials[0]!.recipe!.slots.normal).toEqual({ kind: 'none' });
  });

  it('locates embedded image bytes for thumbnails without handing out unsupported ones', () => {
    const store = openModelStore(place());
    const asset = store.import(texturedGlb({
      images: [
        { bytes: png(5), mimeType: 'image/png' },
        { bytes: pngHeaderOnly(MAX_MODEL_IMAGE_EDGE * 2, 2), mimeType: 'image/png' },
      ],
    }), 'quad.glb');
    const image = store.assetImage(asset.hash, 0)!;
    expect(image.mimeType).toBe('image/png');
    const handle = fs.openSync(image.file, 'r');
    const slice = Buffer.alloc(image.bytes);
    fs.readSync(handle, slice, 0, image.bytes, image.byteOffset);
    fs.closeSync(handle);
    expect(slice).toEqual(Buffer.from(png(5)));
    expect(store.assetImage(asset.hash, 1)).toBeNull();
    expect(store.assetImage(asset.hash, 7)).toBeNull();
    expect(store.assetImage('z'.repeat(64), 0)).toBeNull();
  });
});
