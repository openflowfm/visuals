const pad = (bytes: Uint8Array, withByte: number): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  out.fill(withByte);
  out.set(bytes);
  return out;
};

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
