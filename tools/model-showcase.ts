#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  modelLightingPreset,
  modelPorts,
  modelRecipe,
  type ModelAnimationCapability,
  type ModelBinding,
  type ModelMaterialProperty,
  type ModelSetup,
} from '../model.ts';
import type { CircuitNode, FlowDef, Scheme } from '../protocol.ts';
import { RESPONSE_SET_VERSION } from '../response.ts';
import { openflowHome } from '../server/home.ts';
import { merge } from '../server/scheme.ts';
import { modelPlace, openModelStore } from '../server/models.ts';

/**
 * Install a stronger, redistributable model showcase through the same storage
 * boundary as the product UI. Network access happens only in this explicit
 * authoring command; the resulting show renders solely from local immutable
 * assets and remains safe when the stage has no network.
 */

const SOURCES = {
  fox: {
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb',
    sha256: 'd97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7',
    file: 'Fox.glb',
  },
  car: {
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb',
    sha256: '01a60862de55cd4b9f3acfab0b0def86451800f9c42467fcd61052c16cb9838c',
    file: 'ToyCar.glb',
  },
  helmet: {
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
    sha256: 'a1e3b04de97b11de564ce6e53b95f02954a297f0008183ac63a4f5974f6b32d8',
    file: 'DamagedHelmet.glb',
  },
} as const;

const arg = (name: string): string | null => {
  const found = process.argv.find((each) => each.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};
const installing = process.argv.includes('--install');
const scratch = path.resolve(arg('root') ?? '/private/tmp/openflow-model-showcase');
const visualHome = path.join(openflowHome(), 'visuals');
const modelRoot = path.resolve(arg('models') ?? (installing ? path.join(visualHome, 'models') : path.join(scratch, 'models')));
const schemeFile = path.resolve(arg('scheme') ?? (installing
  ? path.join(visualHome, 'schemes', 'model-showcase.json')
  : path.join(scratch, 'scheme.json')));
const downloadRoot = path.join(scratch, 'downloads');

const digest = (bytes: Uint8Array): string => crypto.createHash('sha256').update(bytes).digest('hex');

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function pngChunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, 'ascii');
  const body = Buffer.from(data);
  const crcInput = Buffer.concat([type, body]);
  let crc = 0xffffffff;
  for (const byte of crcInput) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  const result = Buffer.alloc(12 + body.length);
  result.writeUInt32BE(body.length, 0);
  type.copy(result, 4);
  body.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + body.length);
  return result;
}

/** A deterministic local override: thick cyan/magenta rails over a dark scan grid. */
function neonGridPng(): Buffer {
  const width = 256;
  const height = 256;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 4;
      const major = x % 64 < 5 || y % 64 < 5;
      const minor = x % 16 === 0 || y % 16 === 0;
      const slash = (x + y) % 128 < 5;
      const cyan = x % 128 < 64;
      raw[at] = major || slash ? (cyan ? 18 : 255) : minor ? 24 : 3;
      raw[at + 1] = major || slash ? (cyan ? 238 : 16) : minor ? 40 : 5;
      raw[at + 2] = major || slash ? (cyan ? 255 : 186) : minor ? 58 : 12;
      raw[at + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

async function bytesFor(kind: keyof typeof SOURCES): Promise<Buffer> {
  const source = SOURCES[kind];
  const supplied = arg(kind);
  const cached = path.join(downloadRoot, source.file);
  let bytes: Buffer;
  if (supplied) bytes = fs.readFileSync(path.resolve(supplied));
  else if (fs.existsSync(cached)) bytes = fs.readFileSync(cached);
  else {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.file}: download returned HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.writeFileSync(cached, bytes);
  }
  const actual = digest(bytes);
  if (actual !== source.sha256) throw new Error(`${source.file}: expected ${source.sha256}, received ${actual}`);
  return bytes;
}

const store = openModelStore(modelPlace(modelRoot));
const fox = store.import(await bytesFor('fox'), SOURCES.fox.file);
const car = store.import(await bytesFor('car'), SOURCES.car.file);
const helmet = store.import(await bytesFor('helmet'), SOURCES.helmet.file);
const grid = store.importTexture(neonGridPng(), 'neon-scan-grid.png', 'image/png');

const foxRoot = fox.capabilities.nodes.find((node) => node.name === 'root');
const run = fox.capabilities.animations.find((animation) => animation.name === 'Run');
const survey = fox.capabilities.animations.find((animation) => animation.name === 'Survey');
if (!foxRoot || !run || !survey || fox.capabilities.skins.length === 0) {
  throw new Error('Fox did not expose its expected root, skin, Run and Survey capabilities');
}
const carRoot = car.capabilities.nodes.find((node) => node.name === 'ToyCar');
const carMaterial = car.capabilities.materials.find((material) => material.name === 'ToyCar');
const fabricMaterial = car.capabilities.materials.find((material) => material.name === 'Fabric');
const glassMaterial = car.capabilities.materials.find((material) => material.name === 'Glass');
if (!carRoot || !carMaterial || !fabricMaterial || !glassMaterial || car.capabilities.cameras.length < 2) {
  throw new Error('Toy Car did not expose its expected parts, materials and cameras');
}
const helmetRoot = helmet.capabilities.nodes[0];
const helmetMaterial = helmet.capabilities.materials.find((material) => material.name === 'Material_MR');
if (!helmetRoot || !helmetMaterial || helmet.capabilities.images.length !== 5 || helmet.capabilities.images.some((image) => image.unsupported)) {
  throw new Error('Damaged Helmet did not expose its expected root, PBR material and five supported images');
}

const animationBinding = (animation: ModelAnimationCapability): ModelBinding => ({
  id: 'motion',
  label: `${animation.name} position`,
  group: 'animation',
  target: { kind: 'animation', animation: animation.index, name: animation.name },
  default: 0,
  min: 0,
  max: animation.duration,
});
const foxTurn: ModelBinding = {
  id: 'turn',
  label: 'Turn',
  group: 'pose',
  target: {
    kind: 'node-transform',
    node: foxRoot.index,
    nodePath: foxRoot.path,
    property: 'rotation-y',
  },
  default: 0.5,
  min: -Math.PI,
  max: Math.PI,
};
const foxScale = (axis: 'x' | 'y' | 'z'): ModelBinding => ({
  id: `scale-${axis}`,
  label: `Scale ${axis.toUpperCase()}`,
  group: 'framing',
  target: {
    kind: 'node-transform',
    node: foxRoot.index,
    nodePath: foxRoot.path,
    property: `scale-${axis}`,
  },
  default: 0.7,
  min: 0.6,
  max: 2.4,
});

const lightStrength = (max: number, fallback: number): ModelBinding => ({
  id: 'key-strength',
  label: 'Key strength',
  group: 'lighting',
  target: { kind: 'light', light: 'key', property: 'intensity' },
  default: fallback,
  min: 0,
  max,
});

function foxSetup(id: string, label: string, animation: ModelAnimationCapability): ModelSetup {
  return store.save({
    id,
    name: label,
    assetHash: fox.hash,
    bindings: [animationBinding(animation), foxTurn, foxScale('x'), foxScale('y'), foxScale('z'), lightStrength(12, 0.58)],
    materials: [{ material: 0, source: 'color-a', amount: 1 }],
    lighting: modelLightingPreset(id.endsWith('run') ? 'neon' : 'void'),
    camera: null,
  });
}

const foxRun = foxSetup('showcase-fox-run', 'Fox / run cycle', run);
const foxSurvey = foxSetup('showcase-fox-survey', 'Fox / survey cycle', survey);
const toyCar = store.save({
  id: 'showcase-toy-car',
  name: 'Toy Car / palette body',
  assetHash: car.hash,
  bindings: [
    {
      id: 'turn',
      label: 'Turn',
      group: 'pose',
      target: {
        kind: 'node-transform',
        node: carRoot.index,
        nodePath: carRoot.path,
        property: 'rotation-z',
      },
      default: 0.5,
      min: -Math.PI,
      max: Math.PI,
    },
    {
      id: 'glass',
      label: 'Glass presence',
      group: 'materials',
      target: { kind: 'material', material: glassMaterial.index, property: 'opacity' },
      default: 0.72,
      min: 0.08,
      max: 1,
    },
    {
      id: 'body-shine',
      label: 'Body shine',
      group: 'materials',
      target: { kind: 'material', material: carMaterial.index, property: 'roughness' },
      default: 0.16,
      min: 0.05,
      max: 0.9,
    },
    {
      id: 'fabric',
      label: 'Display cloth',
      group: 'materials',
      target: { kind: 'material', material: fabricMaterial.index, property: 'opacity' },
      default: 0,
      min: 0,
      max: 0.7,
    },
    lightStrength(18, 0.52),
  ],
  materials: [
    { material: carMaterial.index, source: 'color-a', amount: 1 },
    { material: fabricMaterial.index, source: 'color-b', amount: 0.82 },
    { material: glassMaterial.index, source: 'accent', amount: 0.72 },
  ],
  lighting: modelLightingPreset('neon'),
  // Camera002 is the model author's recommended composed showcase angle.
  camera: car.capabilities.cameras[1]!.index,
});

const helmetTurn = (id = 'turn'): ModelBinding => ({
  id,
  label: 'Turn',
  group: 'pose',
  target: {
    kind: 'node-transform',
    node: helmetRoot.index,
    nodePath: helmetRoot.path,
    property: 'rotation-z',
  },
  default: 0.5,
  min: -Math.PI,
  max: Math.PI,
});
const materialBinding = (
  id: string,
  label: string,
  property: ModelMaterialProperty,
  min: number,
  max: number,
  fallback: number,
): ModelBinding => ({
  id,
  label,
  group: 'materials',
  target: { kind: 'material', material: helmetMaterial.index, property },
  default: (fallback - min) / (max - min),
  min,
  max,
});

const helmetAuthored = store.save({
  id: 'showcase-helmet-authored',
  name: 'Damaged Helmet / authored PBR',
  assetHash: helmet.hash,
  bindings: [
    helmetTurn(),
    materialBinding('surface', 'Surface roughness', 'roughness', 0.05, 1, helmetMaterial.roughness),
    materialBinding('normal-detail', 'Normal detail', 'normal-strength', 0, 4, 1),
    lightStrength(12, 3.4 / 12),
  ],
  materials: [{
    material: helmetMaterial.index,
    source: 'original',
    amount: 0,
    recipe: modelRecipe(),
  }],
  lighting: modelLightingPreset('studio'),
  camera: null,
});

const helmetNeon = store.save({
  id: 'showcase-helmet-neon',
  name: 'Damaged Helmet / neon scan',
  assetHash: helmet.hash,
  bindings: [
    helmetTurn(),
    materialBinding('grid-mix', 'Grid presence', 'texture-mix', 0, 1, 0.78),
    materialBinding('grid-turn', 'Grid rotation', 'uv-rotation', -Math.PI, Math.PI, 0.28),
    materialBinding('normal-detail', 'Normal detail', 'normal-strength', 0, 4, 0.72),
    materialBinding('emission', 'Emission', 'emissive-strength', 0, 10, 5.6),
    materialBinding('rim-glow', 'Rim glow', 'rim', 0, 1, 0.84),
    materialBinding('scan', 'Scan', 'scan', 0, 1, 0.72),
    materialBinding('bands', 'Graphic bands', 'bands', 0, 1, 0.42),
    lightStrength(20, 11 / 20),
  ],
  materials: [{
    material: helmetMaterial.index,
    source: 'color-a',
    amount: 0.82,
    recipe: modelRecipe({
      slots: {
        baseColor: { kind: 'texture', hash: grid.hash },
        metallicRoughness: { kind: 'authored' },
        normal: { kind: 'authored' },
        occlusion: { kind: 'authored' },
        emissive: { kind: 'texture', hash: grid.hash },
      },
      projection: 'triplanar',
      wrap: 'mirror',
      uvScale: [2.6, 2.6],
      uvRotation: 0.28,
      textureMix: 0.78,
      normalStrength: 0.72,
      occlusionStrength: 0.58,
      rim: 0.84,
      scan: 0.72,
      bands: 0.42,
    }),
  }],
  lighting: modelLightingPreset('neon'),
  camera: null,
});

const model = (id: string, setup: ModelSetup, x: number, y: number, values: Record<string, number> = {}): CircuitNode => ({
  id,
  kind: 'model',
  x,
  y,
  setup: setup.id,
  setupRevision: setup.revision,
  modelPorts: modelPorts(setup),
  values,
});

const foxDuet: FlowDef = {
  name: 'Models / kinetic fox duet',
  circuit: {
    nodes: [
      { id: 'palette', kind: 'colorway', x: 20, y: 20, values: { amount: 1, energy: 0.58 } },
      { id: 'run-clock', kind: 'lfo', op: 'saw', x: 20, y: 250, values: { rate: 0.53, sync: 1, phase: 0.08 } },
      { id: 'survey-clock', kind: 'lfo', op: 'saw', x: 20, y: 460, values: { rate: 0.39, sync: 1, phase: 0.61 } },
      model('runner', foxRun, 280, 20, { turn: 0.44, 'scale-x': 0.45, 'scale-y': 0.45, 'scale-z': 0.45 }),
      model('watcher', foxSurvey, 280, 330, { turn: 0.58, 'scale-x': 0.45, 'scale-y': 0.45, 'scale-z': 0.45 }),
      { id: 'mirror', kind: 'lens', op: 'mirror', x: 560, y: 330, values: { angle: 0.62, offset: 0.57 } },
      { id: 'pair', kind: 'blend', op: 'screen', x: 800, y: 130, values: { amount: 0.68 } },
      { id: 'bloom', kind: 'spread', op: 'bloom', x: 1030, y: 130, values: { reach: 0.04, floor: 0.72 } },
      { id: 'out', kind: 'out', x: 1260, y: 130 },
    ],
    cords: [
      { from: 'palette/primary', to: 'runner/color-a' },
      { from: 'palette/complement', to: 'watcher/color-a' },
      { from: 'run-clock/n', to: 'runner/motion' },
      { from: 'survey-clock/n', to: 'watcher/motion' },
      { from: 'runner/c', to: 'pair/base' },
      { from: 'watcher/c', to: 'mirror/c' },
      { from: 'mirror/c', to: 'pair/top' },
      { from: 'pair/c', to: 'bloom/c' },
      { from: 'bloom/c', to: 'out/c' },
    ],
  },
};

const carTrails: FlowDef = {
  name: 'Models / toy car light trails',
  circuit: {
    nodes: [
      { id: 'palette', kind: 'colorway', x: 20, y: 20, values: { amount: 1, energy: 0.7 } },
      { id: 'turn', kind: 'lfo', op: 'saw', x: 20, y: 245, values: { rate: 0.32, sync: 1, phase: 0.12 } },
      { id: 'glass', kind: 'lfo', op: 'sine', x: 20, y: 455, values: { rate: 0.42, sync: 1, phase: 0.38 } },
      { id: 'light', kind: 'lfo', op: 'sine', x: 20, y: 660, values: { rate: 0.2, sync: 1, phase: 0.72 } },
      { id: 'copies', kind: 'array', op: 'mirror', x: 280, y: 45, values: { count: 0.3 } },
      model('car', toyCar, 505, 45, { 'body-shine': 0.12, fabric: 0 }),
      { id: 'last', kind: 'last', x: 505, y: 430 },
      { id: 'drift', kind: 'lens', op: 'zoom', x: 760, y: 430, values: { amount: 0.48 } },
      { id: 'trail', kind: 'blend', op: 'screen', x: 995, y: 160, values: { amount: 0.56 } },
      { id: 'bloom', kind: 'spread', op: 'bloom', x: 1225, y: 160, values: { reach: 0.035, floor: 0.74 } },
      { id: 'finish', kind: 'grade', op: 'highlights', x: 1455, y: 160, values: { knee: 0.7, amount: 0.38 } },
      { id: 'out', kind: 'out', x: 1685, y: 160 },
    ],
    cords: [
      { from: 'palette/primary', to: 'car/color-a' },
      { from: 'palette/secondary', to: 'car/color-b' },
      { from: 'turn/n', to: 'car/turn' },
      { from: 'glass/n', to: 'car/glass' },
      { from: 'light/n', to: 'car/key-strength' },
      { from: 'copies/p', to: 'car/p' },
      { from: 'car/c', to: 'trail/base' },
      { from: 'last/c', to: 'drift/c' },
      { from: 'drift/c', to: 'trail/top' },
      { from: 'trail/c', to: 'bloom/c' },
      { from: 'bloom/c', to: 'finish/c' },
      { from: 'finish/c', to: 'out/c' },
    ],
  },
};

const helmetDual: FlowDef = {
  name: 'Models / helmet material duality',
  circuit: {
    nodes: [
      { id: 'palette', kind: 'colorway', x: 20, y: 20, values: { amount: 1, energy: 0.78 } },
      { id: 'auth-turn', kind: 'lfo', op: 'saw', x: 20, y: 245, values: { rate: 0.24, sync: 1, phase: 0.08 } },
      { id: 'neon-turn', kind: 'lfo', op: 'saw', x: 20, y: 455, values: { rate: 0.31, sync: 1, phase: 0.54 } },
      { id: 'scan-pulse', kind: 'lfo', op: 'sine', x: 20, y: 665, values: { rate: 0.67, sync: 1, phase: 0.2 } },
      model('authored', helmetAuthored, 285, 20, { surface: 0.66, 'normal-detail': 0.28 }),
      model('neon', helmetNeon, 285, 390, { 'grid-mix': 0.8, 'normal-detail': 0.2, emission: 0.58, 'rim-glow': 0.88 }),
      { id: 'facet', kind: 'lens', op: 'mirror', x: 555, y: 390, values: { angle: 0.58, offset: 0.51 } },
      { id: 'merge', kind: 'blend', op: 'screen', x: 810, y: 170, values: { amount: 0.62 } },
      { id: 'finish', kind: 'grade', op: 'highlights', x: 1050, y: 170, values: { knee: 0.68, amount: 0.34 } },
      { id: 'out', kind: 'out', x: 1285, y: 170 },
    ],
    cords: [
      { from: 'palette/primary', to: 'authored/color-a' },
      { from: 'palette/secondary', to: 'authored/color-b' },
      { from: 'palette/complement', to: 'neon/color-a' },
      { from: 'palette/accent', to: 'neon/color-b' },
      { from: 'auth-turn/n', to: 'authored/turn' },
      { from: 'neon-turn/n', to: 'neon/turn' },
      { from: 'scan-pulse/n', to: 'neon/scan' },
      { from: 'authored/c', to: 'merge/base' },
      { from: 'neon/c', to: 'facet/c' },
      { from: 'facet/c', to: 'merge/top' },
      { from: 'merge/c', to: 'finish/c' },
      { from: 'finish/c', to: 'out/c' },
    ],
  },
};

const helmetEcho: FlowDef = {
  name: 'Models / helmet scan echoes',
  circuit: {
    nodes: [
      { id: 'palette', kind: 'colorway', x: 20, y: 20, values: { amount: 1, energy: 0.86 } },
      { id: 'turn-a', kind: 'lfo', op: 'saw', x: 20, y: 245, values: { rate: 0.28, sync: 1, phase: 0.05 } },
      { id: 'turn-b', kind: 'lfo', op: 'saw', x: 20, y: 455, values: { rate: 0.37, sync: 1, phase: 0.63 } },
      { id: 'grid', kind: 'lfo', op: 'sine', x: 20, y: 665, values: { rate: 0.49, sync: 1, phase: 0.31 } },
      model('left', helmetNeon, 285, 20, { emission: 0.22, 'rim-glow': 0.68, bands: 0.34 }),
      model('right', helmetNeon, 285, 390, { emission: 0.34, 'rim-glow': 0.82, bands: 0.62 }),
      { id: 'reflect', kind: 'lens', op: 'mirror', x: 555, y: 390, values: { angle: 0.46, offset: 0.6 } },
      { id: 'pair', kind: 'blend', op: 'screen', x: 800, y: 155, values: { amount: 0.58 } },
      { id: 'last', kind: 'last', x: 800, y: 480 },
      { id: 'drift', kind: 'lens', op: 'zoom', x: 1040, y: 480, values: { amount: 0.46 } },
      { id: 'echo', kind: 'blend', op: 'screen', x: 1280, y: 220, values: { amount: 0.34 } },
      { id: 'finish', kind: 'grade', op: 'highlights', x: 1515, y: 220, values: { knee: 0.7, amount: 0.26 } },
      { id: 'out', kind: 'out', x: 1750, y: 220 },
    ],
    cords: [
      { from: 'palette/primary', to: 'left/color-a' },
      { from: 'palette/secondary', to: 'left/color-b' },
      { from: 'palette/complement', to: 'right/color-a' },
      { from: 'palette/accent', to: 'right/color-b' },
      { from: 'turn-a/n', to: 'left/turn' },
      { from: 'turn-b/n', to: 'right/turn' },
      { from: 'grid/n', to: 'left/grid-turn' },
      { from: 'grid/n', to: 'right/grid-mix' },
      { from: 'left/c', to: 'pair/base' },
      { from: 'right/c', to: 'reflect/c' },
      { from: 'reflect/c', to: 'pair/top' },
      { from: 'pair/c', to: 'echo/base' },
      { from: 'last/c', to: 'drift/c' },
      { from: 'drift/c', to: 'echo/top' },
      { from: 'echo/c', to: 'finish/c' },
      { from: 'finish/c', to: 'out/c' },
    ],
  },
};

const scheme = merge({
  responses: RESPONSE_SET_VERSION,
  flows: {
    'model-helmet-dual': helmetDual,
    'model-helmet-echo': helmetEcho,
    'model-fox-duet': foxDuet,
    'model-toy-car': carTrails,
  },
  colorways: {
    'Electric fauna': ['#ff5d38', '#18d6ff', '#7a3cff', '#f7e65d', '#ffffff'],
    'Midnight circuit': ['#26fff2', '#ff2f92', '#4338ff', '#ffc857', '#f4fbff'],
  },
  moods: { 'Electric fauna': 'flare', 'Midnight circuit': 'neon' },
  rotation: { flows: ['model-helmet-dual', 'model-helmet-echo', 'model-fox-duet', 'model-toy-car'], colorways: ['Electric fauna', 'Midnight circuit'], bars: 8, onClip: false, colorEvery: 1 },
  songs: {},
  defaults: { flow: 'model-helmet-dual', colorway: 'Midnight circuit', pace: 0, draws: 'showcase' },
} satisfies Partial<Scheme>);

fs.mkdirSync(path.dirname(schemeFile), { recursive: true });
fs.writeFileSync(schemeFile, `${JSON.stringify(scheme, null, 2)}\n`);
console.log(JSON.stringify({
  assets: [
    { name: fox.name, hash: fox.hash, bytes: fox.bytes, skins: fox.capabilities.skins.length, animations: fox.capabilities.animations.map((clip) => clip.name) },
    { name: car.name, hash: car.hash, bytes: car.bytes, materials: car.capabilities.materials.length, cameras: car.capabilities.cameras.length },
    { name: helmet.name, hash: helmet.hash, bytes: helmet.bytes, materials: helmet.capabilities.materials.length, images: helmet.capabilities.images.length },
  ],
  textures: [{ name: grid.name, hash: grid.hash, bytes: grid.bytes, size: `${grid.width}x${grid.height}` }],
  setups: [helmetAuthored.id, helmetNeon.id, foxRun.id, foxSurvey.id, toyCar.id],
  flows: Object.keys(scheme.flows),
  modelRoot,
  scheme: schemeFile,
  installed: installing,
}, null, 2));
