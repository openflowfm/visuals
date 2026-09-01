#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelLightingPreset, modelPorts, type ModelBinding } from '../model.ts';
import type { CircuitNode, FlowDef, Scheme } from '../protocol.ts';
import { RESPONSE_SET_VERSION } from '../response.ts';
import { openflowHome } from '../server/home.ts';
import { merge } from '../server/scheme.ts';
import { modelPlace, openModelStore } from '../server/models.ts';

/**
 * Reproduce the Xenon 60 proof from an ordinary metadata-free GLB.
 *
 * This is not a sidecar consumed by the renderer. It makes the same two
 * OpenFlow-owned records the product UI makes after import: immutable bytes in
 * the model store, then a separately editable reusable setup. The emitted
 * scratch scheme keeps only per-flow setup references, values, depths and
 * cords, and can be handed straight to the hidden frames/benchmark tools.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: string): string => {
  const found = process.argv.find((each) => each.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const installing = process.argv.includes('--install');
const proofHome = path.join(openflowHome(), 'visuals');
const root = path.resolve(arg('models', installing
  ? path.join(proofHome, 'models')
  : '/private/tmp/openflow-xenon-model-proof/models'));
const schemeFile = path.resolve(arg('scheme', installing
  ? path.join(proofHome, 'schemes', 'xenon-60-model-proof.json')
  : '/private/tmp/openflow-xenon-model-proof/scheme.json'));
const glbFile = path.resolve(arg('glb', path.resolve(here, '../assets/models/xenon-60.glb')));
const setupId = arg('setup', installing ? 'xenon-60-model-proof' : 'xenon-60');

const store = openModelStore(modelPlace(root));
const asset = store.import(fs.readFileSync(glbFile), path.basename(glbFile));
const rings = asset.capabilities.nodes
  .filter((node) => /^Meridian \d\d$/.test(node.name) && node.mesh !== null)
  .sort((a, b) => a.name.localeCompare(b.name));
if (rings.length !== 12) throw new Error(`Xenon proof needs 12 named meridians; inspected ${rings.length}`);
if (asset.capabilities.materials.length !== 12) {
  throw new Error(`Xenon proof needs 12 independently mapped materials; inspected ${asset.capabilities.materials.length}`);
}
const clip = asset.capabilities.animations.find((animation) => animation.name === 'Capsule roll');
if (!clip) throw new Error('Xenon proof GLB did not expose its named animation clip');
const lighting = modelLightingPreset('studio');
// The reference's topology is emissive railwork suspended in black. A cast
// shadow invents broken contour endpoints which are foreign to that pack, so
// this reusable rig keeps a broad neutral environment, palette accents and a
// published key but no caster or brittle high-intensity highlight.
lighting.preset = 'custom';
lighting.environment = {
  ...lighting.environment,
  intensity: 0.95,
  top: 'white',
  bottom: 'white',
};
lighting.lights = lighting.lights.map((light) => ({
  ...light,
  shadow: false,
  intensity: light.id === 'key' ? 1.4 : light.id === 'fill' ? 0.25 : 0.45,
}));

const bindings: ModelBinding[] = [
  ...rings.map((node, index): ModelBinding => ({
    id: `ring-${String(index + 1).padStart(2, '0')}-rotation`,
    label: `${node.name} rotation`,
    group: 'meridian transforms',
    target: {
      kind: 'node-transform',
      node: node.index,
      nodePath: node.path,
      property: 'rotation-x',
    },
    default: index / rings.length,
    min: 0,
    max: Math.PI,
  })),
  ...asset.capabilities.materials.map((material): ModelBinding => ({
    id: `ring-${String(material.index + 1).padStart(2, '0')}-light`,
    label: `${material.name} light`,
    group: 'meridian materials',
    target: { kind: 'material', material: material.index, property: 'emissive-strength' },
    default: 0.25,
    min: 0.1,
    max: 2.3,
  })),
  {
    id: 'capsule-roll',
    label: 'Capsule roll',
    group: 'motion',
    target: { kind: 'animation', animation: clip.index, name: clip.name },
    default: 0,
    min: 0,
    max: clip.duration,
  },
  {
    id: 'key-strength',
    label: 'Key strength',
    group: 'lighting',
    target: { kind: 'light', light: 'key', property: 'intensity' },
    default: 0.55,
    min: 0,
    max: 4,
  },
];

const setup = store.save({
  id: setupId,
  name: 'Xenon 60 meridians',
  assetHash: asset.hash,
  bindings,
  materials: asset.capabilities.materials.map((material) => ({
    material: material.index,
    source: material.index % 2 === 0 ? 'color-a' : 'color-b',
    amount: 1,
  })),
  lighting,
  camera: asset.capabilities.cameras[0]?.index ?? null,
});

const model = (
  id: string,
  x: number,
  y: number,
  values: Record<string, number>,
  depths: Record<string, number>,
): CircuitNode => ({
  id,
  kind: 'model',
  x,
  y,
  setup: setup.id,
  setupRevision: setup.revision,
  modelPorts: modelPorts(setup),
  // Unchanged published controls read their setup snapshot defaults. Keeping
  // only instance overrides here is both the layer boundary and what prevents
  // a richly published setup from consuming the graph's uniform bank merely
  // by being selected.
  values,
  depths,
});

function instanceFlow(name: string, phase: number, alternate: boolean): FlowDef {
  const named = alternate ? 'model-b' : 'model-a';
  const ring = alternate ? 'ring-08-rotation' : 'ring-03-rotation';
  const light = alternate ? 'ring-11-light' : 'ring-06-light';
  return {
    name,
    circuit: {
      nodes: [
        { id: 'palette', kind: 'colorway', x: 30, y: 20, values: { amount: 1, energy: 0.42 } },
        { id: 'ring', kind: 'lfo', op: 'sine', x: 30, y: 250, values: { rate: 0.37, sync: 1, phase: (phase + 0.21) % 1 } },
        { id: 'light', kind: 'lfo', op: 'pulse', x: 30, y: 470, values: { rate: 0.31, sync: 1, phase: (phase + 0.57) % 1 } },
        model(named, 300, 70, {
          [ring]: alternate ? 7 / 12 : 2 / 12,
          [light]: 0.12,
        }, {
          [ring]: alternate ? -0.24 : 0.24,
          [light]: 0.35,
        }),
        { id: 'bloom', kind: 'spread', op: 'bloom', x: 590, y: 70, values: { reach: 0.03, floor: 0.84 } },
        { id: 'finish', kind: 'grade', op: 'highlights', x: 810, y: 70, values: { knee: 0.76, amount: 0.3 } },
        { id: 'out', kind: 'out', x: 1030, y: 70 },
      ],
      cords: [
        { from: alternate ? 'palette/secondary' : 'palette/primary', to: `${named}/color-a` },
        { from: alternate ? 'palette/primary' : 'palette/secondary', to: `${named}/color-b` },
        { from: 'ring/n', to: `${named}/${ring}` },
        { from: 'light/n', to: `${named}/${light}` },
        { from: 'light/n', to: `${named}/key-strength` },
        { from: `${named}/c`, to: 'bloom/c' },
        { from: 'bloom/c', to: 'finish/c' },
        { from: 'finish/c', to: 'out/c' },
      ],
    },
  };
}

const first = instanceFlow('Xenon 60 / violet', 0.02, false);
const second = instanceFlow('Xenon 60 / cyan', 0.43, true);
const proof: FlowDef = {
  name: 'Xenon 60 / two reusable instances',
  circuit: {
    nodes: [
      { id: 'a', kind: 'flow', op: 'xenon-60-a', x: 30, y: 30 },
      { id: 'b', kind: 'flow', op: 'xenon-60-b', x: 30, y: 270 },
      { id: 'screen', kind: 'blend', op: 'screen', x: 290, y: 100, values: { amount: 0.72 } },
      { id: 'out', kind: 'out', x: 520, y: 100 },
    ],
    cords: [
      { from: 'a/c', to: 'screen/base' },
      { from: 'b/c', to: 'screen/top' },
      { from: 'screen/c', to: 'out/c' },
    ],
  },
};

const scheme = merge({
  responses: RESPONSE_SET_VERSION,
  flows: { 'xenon-60-a': first, 'xenon-60-b': second, 'xenon-60-proof': proof },
  colorways: { Xenon: ['#dcffff', '#00aee8', '#1748ff', '#ff9b38', '#ffffff'] },
  moods: { Xenon: 'neon' },
  rotation: { flows: ['xenon-60-proof'], colorways: ['Xenon'], bars: 8, onClip: false, colorEvery: 1 },
  songs: {},
  defaults: { flow: 'xenon-60-proof', colorway: 'Xenon', pace: 0, draws: 'rings' },
} satisfies Partial<Scheme>);

fs.mkdirSync(path.dirname(schemeFile), { recursive: true });
fs.writeFileSync(schemeFile, `${JSON.stringify(scheme, null, 2)}\n`);
console.log(JSON.stringify({
  asset: {
    hash: asset.hash,
    bytes: asset.bytes,
    capabilities: {
      nodes: asset.capabilities.nodes.length,
      meshes: asset.capabilities.meshes.length,
      materials: asset.capabilities.materials.length,
      animations: asset.capabilities.animations.length,
      cameras: asset.capabilities.cameras.length,
      lights: asset.capabilities.lights.length,
    },
  },
  setup: { id: setup.id, revision: setup.revision, bindings: setup.bindings.length },
  instances: 2,
  modelRoot: root,
  scheme: schemeFile,
}, null, 2));
