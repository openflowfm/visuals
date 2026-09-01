import { describe, expect, it } from 'vitest';
import {
  MAX_MODEL_IMAGES,
  MAX_MODEL_IMAGE_EDGE,
  MAX_MODEL_LIGHTS,
  MODEL_CAPABILITY_VERSION,
  MODEL_MATERIAL_PROPERTIES,
  bindingDomainValue,
  decodedImageBytes,
  inspectGlb,
  modelLightingOf,
  modelLightingPreset,
  modelRecipe,
  readGlb,
  reconcileBindings,
  setupTextureOverrides,
  sniffImage,
  type ModelSetup,
} from './model.ts';
import { testGlb, texturedGlb } from './test/glb.ts';
import { encodePng, jpegHeaderOnly, pngHeaderOnly } from './test/png.ts';

describe('embedded texture inspection', () => {
  it('discovers images, samplers, textures and every material slot without decoding a pixel', () => {
    const found = inspectGlb(texturedGlb());
    expect(found.inspector).toBe(MODEL_CAPABILITY_VERSION);
    expect(found.images).toHaveLength(3);
    expect(found.images[0]).toMatchObject({
      mimeType: 'image/png', bufferView: 5, width: 2, height: 2, unsupported: null, decodedBytes: decodedImageBytes(2, 2),
    });
    expect(found.images[0]!.bytes).toBeGreaterThan(30);
    expect(found.samplers[0]).toEqual({
      index: 0, name: 'sampler 0', magFilter: 'nearest', minFilter: 'nearest', mipmap: false, wrapS: 'mirror', wrapT: 'clamp',
    });
    expect(found.textures[0]).toEqual({ index: 0, name: 'texture 0', image: 0, sampler: 0 });
    expect(found.textures[1]).toMatchObject({ image: 1, sampler: null });
    const material = found.materials[0]!;
    expect(material.baseColorTexture).toEqual({
      texture: 0, texCoord: 0, offset: [0.25, 0], scale: [2, 2], rotation: 0.5, strength: 1,
    });
    expect(material.normalTexture).toMatchObject({ texture: 1, texCoord: 0, strength: 0.8 });
    expect(material.occlusionTexture).toMatchObject({ texture: 2, texCoord: 1, strength: 0.7 });
    expect(material.metallicRoughnessTexture).toBeNull();
    expect(material.emissiveTexture).toBeNull();
    expect(material.unlit).toBe(false);
    expect(material.unsupportedExtensions).toEqual([]);
    expect(found.meshes[0]!.primitives[0]!.attributes).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0', 'TEXCOORD_1']);
    expect(found.extensions).toEqual([{ name: 'KHR_texture_transform', required: false, supported: true }]);
    expect(found.warnings).toEqual([]);
  });

  it('reports unlit materials and inspects material extensions it will not render', () => {
    const found = inspectGlb(texturedGlb({
      material: { extensions: { KHR_materials_unlit: {}, KHR_materials_clearcoat: { clearcoatFactor: 1 } } },
      json: { extensionsUsed: ['KHR_texture_transform', 'KHR_materials_unlit', 'KHR_materials_clearcoat'] },
    }));
    expect(found.materials[0]).toMatchObject({ unlit: true, unsupportedExtensions: ['KHR_materials_clearcoat'] });
    expect(found.extensions.map((extension) => `${extension.name}:${extension.supported}`)).toEqual([
      'KHR_materials_clearcoat:false', 'KHR_materials_unlit:true', 'KHR_texture_transform:true',
    ]);
    expect(found.warnings).toContain('Inspected but not rendered: KHR_materials_clearcoat');
  });

  it('sniffs PNG and JPEG sizes from the header alone', () => {
    expect(sniffImage(pngHeaderOnly(1920, 1080))).toEqual({ mimeType: 'image/png', width: 1920, height: 1080 });
    expect(sniffImage(jpegHeaderOnly(640, 480))).toEqual({ mimeType: 'image/jpeg', width: 640, height: 480 });
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  it('refuses oversize, mistyped, external and unreadable images before any decode', () => {
    const png = encodePng(2, 2, new Uint8Array(16).fill(255));
    const found = inspectGlb(texturedGlb({
      images: [
        { bytes: pngHeaderOnly(MAX_MODEL_IMAGE_EDGE + 1, 16), mimeType: 'image/png' },
        { bytes: png, mimeType: 'image/webp' },
        { bytes: png, mimeType: 'image/jpeg' },
        { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), mimeType: 'image/png' },
        { bytes: png, uri: 'https://example.test/albedo.png' },
        { bytes: png, mimeType: null },
      ],
    }));
    expect(found.images.map((image) => image.unsupported)).toEqual([
      `${MAX_MODEL_IMAGE_EDGE + 1}×16 is larger than the ${MAX_MODEL_IMAGE_EDGE} pixel edge ceiling`,
      'image/webp is not a supported image type',
      'declared image/jpeg but the bytes are image/png',
      'the image header is not readable PNG or JPEG',
      'external image URIs are never fetched',
      null,
    ]);
    expect(found.images[0]).toMatchObject({ width: MAX_MODEL_IMAGE_EDGE + 1, height: 16, decodedBytes: 0 });
    expect(found.images[5]).toMatchObject({ mimeType: 'image/png', width: 2, height: 2 });
    expect(found.warnings).toContain('External image URIs are not fetched. Embed textures in the GLB for stage-safe playback.');
    expect(found.warnings.some((warning) => warning.startsWith('4 images will not be decoded:'))).toBe(true);
  });

  it('caps the images decoded per asset and the memory they may expand into', () => {
    const big = pngHeaderOnly(MAX_MODEL_IMAGE_EDGE, MAX_MODEL_IMAGE_EDGE);
    const many = inspectGlb(texturedGlb({
      images: Array.from({ length: MAX_MODEL_IMAGES + 2 }, () => ({ bytes: encodePng(1, 1, new Uint8Array([9, 9, 9, 255])), mimeType: 'image/png' })),
    }));
    expect(many.images.filter((image) => image.unsupported === null)).toHaveLength(MAX_MODEL_IMAGES);
    expect(many.images.at(-1)!.unsupported).toBe(`beyond the ${MAX_MODEL_IMAGES} decodable images per asset`);
    const heavy = inspectGlb(texturedGlb({
      images: Array.from({ length: 5 }, () => ({ bytes: big, mimeType: 'image/png' })),
    }));
    // Two 4096² RGBA images with mips are 171 MiB; a third would pass 256 MiB.
    expect(heavy.images.map((image) => image.unsupported)).toEqual([
      null,
      null,
      'the asset texture memory budget is already spent',
      'the asset texture memory budget is already spent',
      'the asset texture memory budget is already spent',
    ]);
    const outside = inspectGlb(texturedGlb({ json: { bufferViews: undefined } }));
    expect(outside.images.every((image) => image.unsupported === 'the image has no embedded buffer view')).toBe(true);
  });

  it('keeps recipes neutral by default and lists the local textures a setup references', () => {
    expect(modelRecipe()).toMatchObject({
      slots: { baseColor: { kind: 'authored' }, occlusion: { kind: 'authored' } },
      projection: 'uv', wrap: 'authored', uvScale: [1, 1], textureMix: 1, normalStrength: 1, rim: 0, bands: 0,
    });
    expect(modelRecipe({ rim: 0.5, slots: { baseColor: { kind: 'none' } } as never })).toMatchObject({
      rim: 0.5, slots: { baseColor: { kind: 'none' }, normal: { kind: 'authored' } },
    });
    const hash = 'c'.repeat(64);
    expect(setupTextureOverrides([
      { material: 0, source: 'original', amount: 1, recipe: modelRecipe({ slots: { baseColor: { kind: 'texture', hash }, emissive: { kind: 'texture', hash } } as never }) },
      { material: 1, source: 'original', amount: 1 },
    ])).toEqual([hash]);
    expect(MODEL_MATERIAL_PROPERTIES).toContain('normal-strength');
    expect(MODEL_MATERIAL_PROPERTIES).toContain('uv-rotation');
  });
});

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
