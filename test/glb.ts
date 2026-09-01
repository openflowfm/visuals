import { encodePng } from './png.ts';

const pad = (bytes: Uint8Array, withByte: number): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  out.fill(withByte);
  out.set(bytes);
  return out;
};

/** Wrap a glTF JSON object and a binary chunk in the GLB container. */
export function packGlb(json: Record<string, unknown>, binary: Uint8Array): Uint8Array {
  const encoded = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const bin = pad(binary, 0);
  const out = new Uint8Array(12 + 8 + encoded.length + 8 + bin.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, encoded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(encoded, 20);
  const at = 20 + encoded.length;
  view.setUint32(at, bin.length, true);
  view.setUint32(at + 4, 0x004e4942, true);
  out.set(bin, at + 8);
  return out;
}

/**
 * A textured unit quad facing +Z with two UV sets and three embedded images:
 * a 2×2 checker base colour, a flat normal map and a 2×2 occlusion map. The
 * base colour carries a `KHR_texture_transform`, occlusion reads UV1, and
 * every image may be replaced to exercise the inspector's bounds.
 */
export function texturedGlb(options: {
  images?: { bytes: Uint8Array; mimeType?: string | null; uri?: string }[];
  json?: Record<string, unknown>;
  material?: Record<string, unknown>;
} = {}): Uint8Array {
  const checker = encodePng(2, 2, new Uint8Array([
    255, 40, 40, 255, 40, 220, 255, 255,
    40, 220, 255, 255, 255, 40, 40, 255,
  ]));
  const flatNormal = encodePng(2, 2, new Uint8Array(Array(4).fill([128, 128, 255, 255]).flat()));
  const occlusion = encodePng(2, 2, new Uint8Array([
    255, 255, 255, 255, 40, 40, 40, 255,
    40, 40, 40, 255, 255, 255, 255, 255,
  ]));
  const images = options.images ?? [
    { bytes: checker, mimeType: 'image/png' },
    { bytes: flatNormal, mimeType: 'image/png' },
    { bytes: occlusion, mimeType: 'image/png' },
  ];

  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv0 = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const uv1 = new Float32Array([0, 0.5, 0.5, 0.5, 0.5, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const parts: Uint8Array[] = [
    new Uint8Array(positions.buffer),
    new Uint8Array(normals.buffer),
    new Uint8Array(uv0.buffer),
    new Uint8Array(uv1.buffer),
    new Uint8Array(indices.buffer),
    ...images.map((image) => image.bytes),
  ];
  const bufferViews: Record<string, unknown>[] = [];
  let total = 0;
  for (const part of parts) {
    const padded = pad(part, 0);
    bufferViews.push({ buffer: 0, byteOffset: total, byteLength: part.length });
    total += padded.length;
  }
  const binary = new Uint8Array(total);
  bufferViews.forEach((view, at) => binary.set(parts[at]!, view.byteOffset as number));

  const json = {
    asset: { version: '2.0', generator: 'OpenFlow textured test' },
    extensionsUsed: ['KHR_texture_transform'],
    scene: 0,
    scenes: [{ name: 'Quad', nodes: [0] }],
    nodes: [{ name: 'Quad', mesh: 0 }],
    meshes: [{
      name: 'Quad',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 },
        indices: 4,
        material: 0,
      }],
    }],
    materials: [{
      name: 'Checker',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 0.6,
        baseColorTexture: {
          index: 0,
          extensions: { KHR_texture_transform: { offset: [0.25, 0], scale: [2, 2], rotation: 0.5 } },
        },
      },
      normalTexture: { index: 1, scale: 0.8 },
      occlusionTexture: { index: 2, texCoord: 1, strength: 0.7 },
      ...(options.material ?? {}),
    }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33648, wrapT: 33071 }],
    textures: images.map((_, index) => ({ source: index, sampler: index === 0 ? 0 : undefined })),
    images: images.map((image, index) => image.uri
      ? { uri: image.uri, ...(image.mimeType ? { mimeType: image.mimeType } : {}) }
      : { bufferView: 5 + index, ...(image.mimeType === null ? {} : { mimeType: image.mimeType ?? 'image/png' }) }),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 4, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
    ...(options.json ?? {}),
  };
  return packGlb(json, binary);
}

/** A compact metadata-rich GLB fixture with no OpenFlow sidecar. */
export function testGlb(overrides: Record<string, unknown> = {}): Uint8Array {
  const binary = new Uint8Array(32);
  new Float32Array(binary.buffer, 0, 3).set([0, 1, 2]);
  const json = {
    asset: { version: '2.0', generator: 'OpenFlow test' },
    scene: 0,
    scenes: [{ name: 'Proof', nodes: [0, 2] }],
    nodes: [
      { name: 'Root', children: [1], translation: [1, 2, 3] },
      { name: 'Ring 01', mesh: 0, skin: 0 },
      { name: 'Camera rig', camera: 0, extensions: { KHR_lights_punctual: { light: 0 } } },
    ],
    meshes: [{
      name: 'Capsule ring',
      extras: { targetNames: ['Open'] },
      weights: [0.25],
      primitives: [{ attributes: { POSITION: 1, NORMAL: 1 }, indices: 1, material: 0, targets: [{ POSITION: 1 }] }],
    }],
    materials: [{
      name: 'Ring light',
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 1], metallicFactor: 0.8, roughnessFactor: 0.2 },
      emissiveFactor: [1, 0.5, 0.1],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } },
    }],
    skins: [{ name: 'Rig', joints: [1], skeleton: 0, inverseBindMatrices: 1 }],
    animations: [{
      name: 'Pulse',
      samplers: [{ input: 0, output: 1, interpolation: 'STEP' }],
      channels: [{ sampler: 0, target: { node: 1, path: 'scale' } }],
    }],
    cameras: [{ name: 'Portrait', type: 'perspective', perspective: { yfov: 0.7, znear: 0.1, zfar: 50 } }],
    extensions: {
      KHR_lights_punctual: { lights: [{ name: 'Key', type: 'spot', intensity: 12, spot: { outerConeAngle: 0.6 } }] },
    },
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    buffers: [{ byteLength: binary.byteLength }],
    ...overrides,
  };
  return packGlb(json, binary);
}
