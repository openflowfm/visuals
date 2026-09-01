#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  modelPorts,
  type ModelAnimationCapability,
  type ModelBinding,
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

function foxSetup(id: string, label: string, animation: ModelAnimationCapability): ModelSetup {
  return store.save({
    id,
    name: label,
    assetHash: fox.hash,
    bindings: [animationBinding(animation), foxTurn, foxScale('x'), foxScale('y'), foxScale('z')],
    materials: [{ material: 0, source: 'color-a', amount: 1 }],
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
  ],
  materials: [
    { material: carMaterial.index, source: 'color-a', amount: 1 },
    { material: fabricMaterial.index, source: 'color-b', amount: 0.82 },
    { material: glassMaterial.index, source: 'accent', amount: 0.72 },
  ],
  // Camera002 is the model author's recommended composed showcase angle.
  camera: car.capabilities.cameras[1]!.index,
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

const scheme = merge({
  responses: RESPONSE_SET_VERSION,
  flows: { 'model-fox-duet': foxDuet, 'model-toy-car': carTrails },
  colorways: {
    'Electric fauna': ['#ff5d38', '#18d6ff', '#7a3cff', '#f7e65d', '#ffffff'],
    'Midnight circuit': ['#26fff2', '#ff2f92', '#4338ff', '#ffc857', '#f4fbff'],
  },
  moods: { 'Electric fauna': 'flare', 'Midnight circuit': 'neon' },
  rotation: { flows: ['model-fox-duet', 'model-toy-car'], colorways: ['Electric fauna', 'Midnight circuit'], bars: 8, onClip: false, colorEvery: 1 },
  songs: {},
  defaults: { flow: 'model-fox-duet', colorway: 'Electric fauna', pace: 0, draws: 'showcase' },
} satisfies Partial<Scheme>);

fs.mkdirSync(path.dirname(schemeFile), { recursive: true });
fs.writeFileSync(schemeFile, `${JSON.stringify(scheme, null, 2)}\n`);
console.log(JSON.stringify({
  assets: [
    { name: fox.name, hash: fox.hash, bytes: fox.bytes, skins: fox.capabilities.skins.length, animations: fox.capabilities.animations.map((clip) => clip.name) },
    { name: car.name, hash: car.hash, bytes: car.bytes, materials: car.capabilities.materials.length, cameras: car.capabilities.cameras.length },
  ],
  setups: [foxRun.id, foxSurvey.id, toyCar.id],
  flows: Object.keys(scheme.flows),
  modelRoot,
  scheme: schemeFile,
  installed: installing,
}, null, 2));
