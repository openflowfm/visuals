#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Author the ordinary GLB used by the Xenon 60 proof.
 *
 * There is deliberately no OpenFlow extension, extras manifest, or sidecar.
 * Its semantics are normal glTF names: twelve separate scene nodes and twelve
 * separate materials around one shared equal-radius capsule-meridian mesh.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../assets/models/xenon-60.glb');

const PATH_SEGMENTS = 128;
const TUBE_SEGMENTS = 10;
const STRAIGHT = 0.72;
const RADIUS = 0.56;
const TUBE = 0.0065;
const RINGS = 12;

type Point = { x: number; y: number; tx: number; ty: number };

function centreline(distance: number): Point {
  const straightLength = STRAIGHT * 2;
  const capLength = Math.PI * RADIUS;
  const perimeter = straightLength * 2 + capLength * 2;
  let d = ((distance % perimeter) + perimeter) % perimeter;
  if (d < straightLength) {
    return { x: -STRAIGHT + d, y: RADIUS, tx: 1, ty: 0 };
  }
  d -= straightLength;
  if (d < capLength) {
    const angle = Math.PI / 2 - d / RADIUS;
    return {
      x: STRAIGHT + Math.cos(angle) * RADIUS,
      y: Math.sin(angle) * RADIUS,
      tx: Math.sin(angle),
      ty: -Math.cos(angle),
    };
  }
  d -= capLength;
  if (d < straightLength) {
    return { x: STRAIGHT - d, y: -RADIUS, tx: -1, ty: 0 };
  }
  d -= straightLength;
  const angle = -Math.PI / 2 - d / RADIUS;
  return {
    x: -STRAIGHT + Math.cos(angle) * RADIUS,
    y: Math.sin(angle) * RADIUS,
    tx: Math.sin(angle),
    ty: -Math.cos(angle),
  };
}

const perimeter = STRAIGHT * 4 + Math.PI * RADIUS * 2;
const positions: number[] = [];
const normals: number[] = [];
for (let ring = 0; ring < PATH_SEGMENTS; ring++) {
  const point = centreline((ring / PATH_SEGMENTS) * perimeter);
  const nx = -point.ty;
  const ny = point.tx;
  for (let side = 0; side < TUBE_SEGMENTS; side++) {
    const angle = (side / TUBE_SEGMENTS) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    positions.push(point.x + nx * c * TUBE, point.y + ny * c * TUBE, s * TUBE);
    normals.push(nx * c, ny * c, s);
  }
}

const indices: number[] = [];
for (let ring = 0; ring < PATH_SEGMENTS; ring++) {
  const next = (ring + 1) % PATH_SEGMENTS;
  for (let side = 0; side < TUBE_SEGMENTS; side++) {
    const after = (side + 1) % TUBE_SEGMENTS;
    const a = ring * TUBE_SEGMENTS + side;
    const b = next * TUBE_SEGMENTS + side;
    const c = next * TUBE_SEGMENTS + after;
    const d = ring * TUBE_SEGMENTS + after;
    indices.push(a, b, d, b, c, d);
  }
}

const chunks: Buffer[] = [];
let offset = 0;
const append = (array: Float32Array | Uint16Array): { byteOffset: number; byteLength: number } => {
  const aligned = Math.ceil(offset / 4) * 4;
  if (aligned > offset) chunks.push(Buffer.alloc(aligned - offset));
  offset = aligned;
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  chunks.push(bytes);
  const view = { byteOffset: offset, byteLength: bytes.length };
  offset += bytes.length;
  return view;
};

const positionView = append(new Float32Array(positions));
const normalView = append(new Float32Array(normals));
const indexView = append(new Uint16Array(indices));
const timeView = append(new Float32Array([0, 4]));
// A half turn is enough to establish authored animation channels without the
// quaternion ambiguity of two identical endpoints around a complete turn.
const rotationView = append(new Float32Array([0, 0, 0, 1, 1, 0, 0, 0]));
const binary = Buffer.concat(chunks);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], positions[i + axis]);
    max[axis] = Math.max(max[axis], positions[i + axis]);
  }
}

const materials = Array.from({ length: RINGS }, (_, index) => ({
  name: `Ring ${String(index + 1).padStart(2, '0')}`,
  pbrMetallicRoughness: {
    baseColorFactor: index % 2 === 0 ? [0.12, 0.04, 0.2, 1] : [0.02, 0.12, 0.2, 1],
    metallicFactor: 0.72,
    roughnessFactor: 0.24,
  },
  emissiveFactor: index % 2 === 0 ? [0.9, 0.12, 1] : [0.08, 0.7, 1],
  extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2.2 } },
}));

const meshes = Array.from({ length: RINGS }, (_, index) => ({
  name: `Capsule Meridian ${String(index + 1).padStart(2, '0')}`,
  primitives: [{
    attributes: { POSITION: 0, NORMAL: 1 },
    indices: 2,
    material: index,
  }],
}));

const ringNodes = Array.from({ length: RINGS }, (_, index) => ({
  name: `Meridian ${String(index + 1).padStart(2, '0')}`,
  mesh: index,
  rotation: [Math.sin((index * Math.PI) / (RINGS * 2)), 0, 0, Math.cos((index * Math.PI) / (RINGS * 2))],
}));

const gltf = {
  asset: { version: '2.0', generator: 'OpenFlow Xenon 60 model authoring proof' },
  extensionsUsed: ['KHR_materials_emissive_strength', 'KHR_lights_punctual'],
  scene: 0,
  scenes: [{ name: 'Xenon 60', nodes: [0, RINGS + 1, RINGS + 2] }],
  nodes: [
    { name: 'Xenon 60 capsule', children: Array.from({ length: RINGS }, (_, index) => index + 1) },
    ...ringNodes,
    // Framed close enough that the equal-radius cap meridians reach the edge,
    // as the Xenon 60 reference does, while the depth target clips neither cap.
    { name: 'Xenon camera', camera: 0, translation: [0, 0, 2.25] },
    {
      name: 'Xenon key',
      rotation: [-0.32, 0.18, 0.04, 0.93],
      extensions: { KHR_lights_punctual: { light: 0 } },
    },
  ],
  meshes,
  materials,
  cameras: [{
    name: 'Xenon camera',
    type: 'perspective',
    perspective: { yfov: 0.58, znear: 0.01, zfar: 50 },
  }],
  animations: [{
    name: 'Capsule roll',
    samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
  }],
  extensions: {
    KHR_lights_punctual: {
      lights: [{ name: 'Xenon key', type: 'directional', color: [0.8, 0.9, 1], intensity: 3 }],
    },
  },
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [4] },
    { bufferView: 4, componentType: 5126, count: 2, type: 'VEC4' },
  ],
  bufferViews: [
    { buffer: 0, ...positionView, target: 34962 },
    { buffer: 0, ...normalView, target: 34962 },
    { buffer: 0, ...indexView, target: 34963 },
    { buffer: 0, ...timeView },
    { buffer: 0, ...rotationView },
  ],
  buffers: [{ byteLength: binary.length }],
};

const jsonRaw = Buffer.from(JSON.stringify(gltf));
const jsonLength = Math.ceil(jsonRaw.length / 4) * 4;
const binLength = Math.ceil(binary.length / 4) * 4;
const json = Buffer.alloc(jsonLength, 0x20);
jsonRaw.copy(json);
const bin = Buffer.alloc(binLength);
binary.copy(bin);
const file = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
file.writeUInt32LE(0x46546c67, 0);
file.writeUInt32LE(2, 4);
file.writeUInt32LE(file.length, 8);
file.writeUInt32LE(json.length, 12);
file.writeUInt32LE(0x4e4f534a, 16);
json.copy(file, 20);
const binAt = 20 + json.length;
file.writeUInt32LE(bin.length, binAt);
file.writeUInt32LE(0x004e4942, binAt + 4);
bin.copy(file, binAt + 8);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, file);
console.log(`${output} (${(file.length / 1024).toFixed(1)} KiB, ${RINGS} independently addressable meridians)`);
