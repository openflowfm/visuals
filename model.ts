/**
 * The durable vocabulary around an imported glTF binary.
 *
 * A GLB is evidence, not configuration: all facts in `ModelCapabilities` are
 * derived from bytes and may be rebuilt.  The choices in `ModelSetup` are
 * OpenFlow-owned and reusable.  A flow node stores only the setup reference,
 * a revision stamp, a small port snapshot, and its ordinary values/depths.
 */

export const MODEL_SETUP_ID = /^[a-z][a-z0-9_-]{0,63}$/;
export const MODEL_HASH = /^[a-f0-9]{64}$/;
export const MAX_MODEL_BYTES = 128 * 1024 * 1024;
export const MAX_MODEL_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_MODEL_NODES = 4096;
export const MAX_MODEL_COLLECTION = 4096;
export const MAX_MODEL_PRIMITIVES = 16384;
export const MAX_MODEL_CHANNELS = 16384;
export const MAX_MODEL_BINDINGS = 48;
/** Direct lights are looped in the bounded model fragment shader. */
export const MAX_MODEL_LIGHTS = 4;
/** Vertex attributes 2–5 are the bounded morph transport in the model pass. */
export const MAX_MODEL_MORPHS = 4;

export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

export interface ModelNodeCapability {
  index: number;
  /** Stable only within this immutable asset. Human-readable for reconciliation. */
  path: string;
  name: string;
  children: number[];
  mesh: number | null;
  skin: number | null;
  camera: number | null;
  light: number | null;
  translation: Vec3;
  rotation: Vec4;
  scale: Vec3;
  matrix: readonly number[] | null;
}

export interface ModelPrimitiveCapability {
  mode: number;
  material: number | null;
  attributes: string[];
  vertices: number;
  indices: number;
  morphTargets: string[];
}

export interface ModelMeshCapability {
  index: number;
  name: string;
  primitives: ModelPrimitiveCapability[];
  weights: number[];
}

export interface ModelMaterialCapability {
  index: number;
  name: string;
  baseColor: Vec4;
  metallic: number;
  roughness: number;
  emissive: Vec3;
  emissiveStrength: number;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  doubleSided: boolean;
}

export interface ModelSkinCapability {
  index: number;
  name: string;
  joints: number[];
  jointNames: string[];
  skeleton: number | null;
  inverseBindMatrices: number | null;
}

export interface ModelAnimationChannelCapability {
  node: number;
  nodePath: string;
  property: 'translation' | 'rotation' | 'scale' | 'weights';
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  keyframes: number;
  duration: number;
}

export interface ModelAnimationCapability {
  index: number;
  name: string;
  duration: number;
  channels: ModelAnimationChannelCapability[];
}

export interface ModelCameraCapability {
  index: number;
  name: string;
  type: 'perspective' | 'orthographic';
  yfov?: number;
  znear: number;
  zfar?: number;
  xmag?: number;
  ymag?: number;
}

export interface ModelLightCapability {
  index: number;
  name: string;
  type: 'directional' | 'point' | 'spot';
  color: Vec3;
  intensity: number;
  range: number | null;
  innerConeAngle: number;
  outerConeAngle: number;
}

export interface ModelCapabilities {
  generator: string | null;
  version: string;
  scenes: { index: number; name: string; nodes: number[] }[];
  defaultScene: number;
  nodes: ModelNodeCapability[];
  meshes: ModelMeshCapability[];
  materials: ModelMaterialCapability[];
  skins: ModelSkinCapability[];
  animations: ModelAnimationCapability[];
  cameras: ModelCameraCapability[];
  lights: ModelLightCapability[];
  warnings: string[];
}

export interface ModelAsset {
  hash: string;
  /** Original basename, informational only. The hash is the address. */
  name: string;
  bytes: number;
  importedAt: string;
  capabilities: ModelCapabilities;
}

export type ModelPaletteSource =
  | 'color-a'
  | 'color-b'
  | 'primary'
  | 'secondary'
  | 'complement'
  | 'accent'
  | 'chalk'
  | 'original';

export interface ModelMaterialMapping {
  material: number;
  source: ModelPaletteSource;
  /** Preserves authored light/dark structure while choosing its hue. */
  amount: number;
}

export const MODEL_LIGHTING_PRESETS = ['studio', 'void', 'neon', 'custom'] as const;
export type ModelLightingPreset = (typeof MODEL_LIGHTING_PRESETS)[number];
export const MODEL_LIGHT_TYPES = ['directional', 'point', 'spot'] as const;
export type ModelLightType = (typeof MODEL_LIGHT_TYPES)[number];
export const MODEL_LIGHT_SPACES = ['camera', 'world', 'model'] as const;
export type ModelLightSpace = (typeof MODEL_LIGHT_SPACES)[number];
export const MODEL_LIGHT_SOURCES = ['white', 'primary', 'secondary', 'complement', 'accent', 'chalk', 'authored'] as const;
export type ModelLightSource = (typeof MODEL_LIGHT_SOURCES)[number];

export interface ModelEnvironmentSetup {
  /** Analytic HDR environment contribution; zero is deliberately black. */
  intensity: number;
  /** Rotation around the subject's vertical axis, in radians. */
  rotation: number;
  top: ModelLightSource;
  bottom: ModelLightSource;
  /** Used only when the corresponding source is `authored`. Linear RGB. */
  topColor: Vec3;
  bottomColor: Vec3;
}

export interface ModelLightSetup {
  /** Stable setup-owned address. Published bindings refer to this, not its label. */
  id: string;
  label: string;
  type: ModelLightType;
  space: ModelLightSpace;
  source: ModelLightSource;
  /** Used only when `source` is `authored`. Linear RGB. */
  color: Vec3;
  enabled: boolean;
  intensity: number;
  /** Subject-radius units, resolved around the model bounds by the renderer. */
  position: Vec3;
  /** Subject-radius units for point/spot aim. Directional lights use the same aim. */
  target: Vec3;
  /** Subject radii. Point and spot lights fade to zero here. */
  range: number;
  innerConeAngle: number;
  outerConeAngle: number;
  /** At most one directional or spot light in a setup may cast one bounded shadow. */
  shadow: boolean;
  /** PCF footprint in shadow texels. */
  softness: number;
}

export interface ModelLightingSetup {
  preset: ModelLightingPreset;
  environment: ModelEnvironmentSetup;
  lights: ModelLightSetup[];
}

const light = (
  id: string,
  label: string,
  patch: Partial<ModelLightSetup>,
): ModelLightSetup => ({
  id,
  label,
  type: 'directional',
  space: 'camera',
  source: 'white',
  color: [1, 1, 1],
  enabled: true,
  intensity: 1,
  position: [-1, 1, 2],
  target: [0, 0, 0],
  range: 6,
  innerConeAngle: 0.35,
  outerConeAngle: 0.72,
  shadow: false,
  softness: 1,
  ...patch,
});

/** Fresh setup-owned lighting; callers may edit the returned object. */
export function modelLightingPreset(preset: ModelLightingPreset = 'studio'): ModelLightingSetup {
  if (preset === 'void') {
    return {
      preset,
      environment: {
        intensity: 0.06,
        rotation: 0,
        top: 'primary',
        bottom: 'secondary',
        topColor: [1, 1, 1],
        bottomColor: [0.02, 0.02, 0.03],
      },
      lights: [
        light('key', 'Key', { source: 'primary', intensity: 3.6, position: [-1.4, 1.2, 2.2], shadow: true, softness: 1.4 }),
        light('rim', 'Rim', { source: 'accent', intensity: 4.8, position: [1.1, 1.5, -2.2] }),
      ],
    };
  }
  if (preset === 'neon') {
    return {
      preset,
      environment: {
        intensity: 0.28,
        rotation: 0.45,
        top: 'primary',
        bottom: 'secondary',
        topColor: [1, 1, 1],
        bottomColor: [0.02, 0.02, 0.03],
      },
      lights: [
        light('key', 'Key', { type: 'spot', source: 'primary', intensity: 11, position: [-1.6, 1.8, 2.2], range: 7, shadow: true, softness: 1.2 }),
        light('fill', 'Fill', { type: 'point', source: 'secondary', intensity: 8, position: [1.8, -0.4, 1.1], range: 5 }),
        light('rim', 'Rim', { source: 'accent', intensity: 3.2, position: [0.4, 1.4, -2.2] }),
      ],
    };
  }
  const studio: ModelLightingSetup = {
    preset: preset === 'custom' ? 'custom' : 'studio',
    environment: {
      intensity: 0.42,
      rotation: 0.2,
      top: 'white',
      bottom: 'primary',
      topColor: [1, 1, 1],
      bottomColor: [0.035, 0.04, 0.055],
    },
    lights: [
      light('key', 'Key', { intensity: 3.4, position: [-1.5, 1.7, 2.4], shadow: true, softness: 1.15 }),
      light('fill', 'Fill', { source: 'secondary', intensity: 0.9, position: [1.8, 0.3, 1.5] }),
      light('rim', 'Rim', { source: 'accent', intensity: 1.8, position: [0.5, 1.4, -2.3] }),
    ],
  };
  return studio;
}

/** Old setup records acquire the same explicit neutral rig without a migration write. */
export const modelLightingOf = (setup: { lighting?: ModelLightingSetup }): ModelLightingSetup =>
  setup.lighting ?? modelLightingPreset('studio');

export type ModelBindingTarget =
  | {
      kind: 'node-transform';
      node: number;
      nodePath: string;
      property:
        | 'translation-x'
        | 'translation-y'
        | 'translation-z'
        | 'rotation-x'
        | 'rotation-y'
        | 'rotation-z'
        | 'scale-x'
        | 'scale-y'
        | 'scale-z';
    }
  | { kind: 'morph'; mesh: number; target: number; name: string }
  | { kind: 'animation'; animation: number; name: string }
  | {
      kind: 'material';
      material: number;
      property: 'metallic' | 'roughness' | 'opacity' | 'emissive-strength';
    }
  | {
      kind: 'light';
      light: string;
      property:
        | 'intensity'
        | 'position-x'
        | 'position-y'
        | 'position-z'
        | 'target-x'
        | 'target-y'
        | 'target-z'
        | 'range'
        | 'inner-cone'
        | 'outer-cone';
    }
  | { kind: 'environment'; property: 'intensity' | 'rotation' };

export interface ModelBinding {
  /** Stable address used by cords and instance values. Never derived from label. */
  id: string;
  label: string;
  group: string;
  target: ModelBindingTarget;
  /** Normalized position stored on a newly-created model node. */
  default: number;
  /** Domain value produced at normalized zero and one. */
  min: number;
  max: number;
}

export interface ModelSetup {
  id: string;
  name: string;
  assetHash: string;
  /** Content stamp of the setup metadata, not of the immutable asset. */
  revision: string;
  bindings: ModelBinding[];
  materials: ModelMaterialMapping[];
  /** Optional only so setup JSON written before lighting existed remains readable. */
  lighting?: ModelLightingSetup;
  camera: number | null;
  createdAt: string;
  updatedAt: string;
}

/** The context-free port boundary copied onto a node when a setup is selected. */
export interface ModelPortSnapshot {
  id: string;
  label: string;
  group: string;
  default: number;
}

export interface ModelLibrary {
  assets: ModelAsset[];
  setups: ModelSetup[];
  notice: string | null;
}

export interface ModelSetupDraft {
  id: string;
  name: string;
  assetHash: string;
  bindings: ModelBinding[];
  materials: ModelMaterialMapping[];
  lighting?: ModelLightingSetup;
  camera?: number | null;
}

/** Every asset-relative choice required before a setup can move to new bytes. */
export interface ModelRevisionDecision {
  /** Stable published inlet id to a discovered target in the replacement. */
  targets: Record<string, ModelBindingTarget>;
  /** Old material index (as a string key) to replacement index, or explicitly unmapped. */
  materials: Record<string, number | null>;
  /** Replacement camera index, or an explicit return to automatic framing. */
  camera: number | null;
}

export const modelPorts = (setup: ModelSetup): ModelPortSnapshot[] =>
  setup.bindings.map(({ id, label, group, default: fallback }) => ({
    id,
    label,
    group,
    default: fallback,
  }));

export const bindingDomainValue = (binding: ModelBinding, normalized: number): number => {
  const at = Math.max(0, Math.min(1, Number.isFinite(normalized) ? normalized : binding.default));
  return binding.min + (binding.max - binding.min) * at;
};

interface GlbHeader {
  json: Record<string, unknown>;
  binary: Uint8Array;
}

/** Parse only the inert GLB container and JSON. No URI is followed here. */
export function readGlb(bytes: ArrayBuffer | Uint8Array): GlbHeader {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (raw.byteLength > MAX_MODEL_BYTES) throw new Error('GLB is larger than 128 MiB');
  if (raw.byteLength < 20) throw new Error('GLB is too short');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a binary glTF file');
  if (view.getUint32(4, true) !== 2) throw new Error('only glTF 2.0 GLBs are supported');
  const declared = view.getUint32(8, true);
  if (declared !== raw.byteLength) throw new Error('GLB length does not match its header');

  let at = 12;
  let json: Record<string, unknown> | null = null;
  let binary: Uint8Array<ArrayBufferLike> = new Uint8Array();
  while (at < raw.byteLength) {
    if (at + 8 > raw.byteLength) throw new Error('truncated GLB chunk header');
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    at += 8;
    if (length % 4 !== 0 || at + length > raw.byteLength) throw new Error('invalid GLB chunk length');
    const chunk = raw.subarray(at, at + length);
    at += length;
    if (type === 0x4e4f534a) {
      if (json) throw new Error('GLB has more than one JSON chunk');
      if (length > MAX_MODEL_JSON_BYTES) throw new Error('GLB JSON is larger than 8 MiB');
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(chunk).replace(/[\u0000 ]+$/g, '');
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        json = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(`invalid GLB JSON: ${(error as Error).message}`);
      }
    } else if (type === 0x004e4942 && binary.byteLength === 0) binary = chunk;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, binary };
}

type Json = Record<string, unknown>;
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((each): each is Json => !!each && typeof each === 'object' && !Array.isArray(each)) : [];
const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((each): each is number => typeof each === 'number' && Number.isFinite(each)) : [];
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const named = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
const vec = <N extends number>(value: unknown, length: N, fallback: readonly number[]): number[] => {
  const found = numbers(value);
  return found.length === length ? found : [...fallback];
};

/**
 * Inspect every capability glTF itself describes. The returned structure is
 * bounded and contains no executable data or external-resource resolution.
 */
export function inspectGlb(bytes: ArrayBuffer | Uint8Array): ModelCapabilities {
  const { json, binary } = readGlb(bytes);
  const warnings: string[] = [];
  const asset = (json.asset && typeof json.asset === 'object' ? json.asset : {}) as Json;
  if (asset.version !== '2.0') throw new Error('GLB does not declare glTF 2.0');
  const accessors = records(json.accessors);
  const bufferViews = records(json.bufferViews);
  const rawNodes = records(json.nodes);
  const lightExt = ((json.extensions as Json | undefined)?.KHR_lights_punctual as Json | undefined);
  const rawLights = records(lightExt?.lights);
  if (rawNodes.length > MAX_MODEL_NODES) throw new Error(`GLB has more than ${MAX_MODEL_NODES} nodes`);
  for (const [name, values] of [
    ['accessors', accessors],
    ['buffer views', bufferViews],
    ['meshes', records(json.meshes)],
    ['materials', records(json.materials)],
    ['skins', records(json.skins)],
    ['animations', records(json.animations)],
    ['cameras', records(json.cameras)],
    ['scenes', records(json.scenes)],
    ['images', records(json.images)],
    ['buffers', records(json.buffers)],
    ['lights', rawLights],
  ] as const) {
    if (values.length > MAX_MODEL_COLLECTION) throw new Error(`GLB has more than ${MAX_MODEL_COLLECTION} ${name}`);
  }
  const primitiveCount = records(json.meshes).reduce((sum, mesh) => sum + records(mesh.primitives).length, 0);
  if (primitiveCount > MAX_MODEL_PRIMITIVES) throw new Error(`GLB has more than ${MAX_MODEL_PRIMITIVES} primitives`);
  const channelCount = records(json.animations).reduce((sum, animation) => sum + records(animation.channels).length, 0);
  if (channelCount > MAX_MODEL_CHANNELS) throw new Error(`GLB has more than ${MAX_MODEL_CHANNELS} animation channels`);

  const accessorCount = (index: unknown): number => {
    const at = integer(index);
    return at === null ? 0 : Math.max(0, Math.floor(finite(accessors[at]?.count, 0)));
  };
  const accessorDuration = (index: unknown): number => {
    const at = integer(index);
    if (at === null) return 0;
    const accessor = accessors[at];
    const max = numbers(accessor?.max);
    if (max.length > 0) return Math.max(0, max[0]);
    // A valid file should state accessor bounds, but reading tightly packed
    // float timestamps is a safe fallback that keeps ordinary exporters useful.
    const viewAt = integer(accessor?.bufferView);
    const count = accessorCount(at);
    if (viewAt === null || accessor?.componentType !== 5126 || accessor?.type !== 'SCALAR' || count === 0) return 0;
    const view = bufferViews[viewAt];
    if (!view) return 0;
    const stride = Math.max(4, Math.floor(finite(view.byteStride, 4)));
    const offset = Math.floor(finite(view.byteOffset, 0) + finite(accessor.byteOffset, 0));
    if (offset + (count - 1) * stride + 4 > binary.byteLength) return 0;
    const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    // glTF animation input accessors are monotonically increasing. Reading the
    // final timestamp avoids letting a declared count turn inspection into a
    // multi-million-iteration scan while keeping the missing-bounds fallback.
    const duration = data.getFloat32(offset + (count - 1) * stride, true);
    return Number.isFinite(duration) ? duration : 0;
  };

  const parents = new Map<number, number>();
  rawNodes.forEach((node, parent) => {
    for (const child of numbers(node.children).filter(Number.isInteger)) {
      if (child >= 0 && child < rawNodes.length && !parents.has(child)) parents.set(child, parent);
    }
  });
  const nodeName = (index: number) => named(rawNodes[index]?.name, `node ${index}`);
  const pathOf = (index: number): string => {
    const chain: string[] = [];
    const seen = new Set<number>();
    let at: number | undefined = index;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      chain.unshift(nodeName(at));
      at = parents.get(at);
    }
    return chain.join('/');
  };

  const lights: ModelLightCapability[] = rawLights.map((light, index) => {
    const spot = (light.spot && typeof light.spot === 'object' ? light.spot : {}) as Json;
    const type = light.type === 'directional' || light.type === 'spot' ? light.type : 'point';
    return {
      index,
      name: named(light.name, `light ${index}`),
      type,
      color: vec(light.color, 3, [1, 1, 1]) as unknown as Vec3,
      intensity: finite(light.intensity, 1),
      range: light.range === undefined ? null : finite(light.range, 0),
      innerConeAngle: finite(spot.innerConeAngle, 0),
      outerConeAngle: finite(spot.outerConeAngle, Math.PI / 4),
    };
  });

  const nodes: ModelNodeCapability[] = rawNodes.map((node, index) => {
    const ext = (node.extensions && typeof node.extensions === 'object' ? node.extensions : {}) as Json;
    const punctual = (ext.KHR_lights_punctual && typeof ext.KHR_lights_punctual === 'object' ? ext.KHR_lights_punctual : {}) as Json;
    const children = numbers(node.children)
      .filter((each) => Number.isInteger(each) && each >= 0 && each < rawNodes.length)
      .map(Math.floor);
    return {
      index,
      path: pathOf(index),
      name: nodeName(index),
      children,
      mesh: integer(node.mesh),
      skin: integer(node.skin),
      camera: integer(node.camera),
      light: integer(punctual.light),
      translation: vec(node.translation, 3, [0, 0, 0]) as unknown as Vec3,
      rotation: vec(node.rotation, 4, [0, 0, 0, 1]) as unknown as Vec4,
      scale: vec(node.scale, 3, [1, 1, 1]) as unknown as Vec3,
      matrix: numbers(node.matrix).length === 16 ? numbers(node.matrix) : null,
    };
  });

  const meshes: ModelMeshCapability[] = records(json.meshes).map((mesh, index) => {
    const extras = (mesh.extras && typeof mesh.extras === 'object' ? mesh.extras : {}) as Json;
    const targetNames = Array.isArray(extras.targetNames)
      ? extras.targetNames.map((name, at) => named(name, `morph ${at}`))
      : [];
    return {
      index,
      name: named(mesh.name, `mesh ${index}`),
      weights: numbers(mesh.weights),
      primitives: records(mesh.primitives).map((primitive) => {
        const attrs = (primitive.attributes && typeof primitive.attributes === 'object' ? primitive.attributes : {}) as Json;
        const targets = records(primitive.targets);
        return {
          mode: Math.floor(finite(primitive.mode, 4)),
          material: integer(primitive.material),
          attributes: Object.keys(attrs).sort(),
          vertices: accessorCount(attrs.POSITION),
          indices: accessorCount(primitive.indices),
          morphTargets: targets.map((_, at) => targetNames[at] ?? `morph ${at}`),
        };
      }),
    };
  });

  const materials: ModelMaterialCapability[] = records(json.materials).map((material, index) => {
    const pbr = (material.pbrMetallicRoughness && typeof material.pbrMetallicRoughness === 'object'
      ? material.pbrMetallicRoughness : {}) as Json;
    const ext = (material.extensions && typeof material.extensions === 'object' ? material.extensions : {}) as Json;
    const emissiveExt = (ext.KHR_materials_emissive_strength && typeof ext.KHR_materials_emissive_strength === 'object'
      ? ext.KHR_materials_emissive_strength : {}) as Json;
    const mode = material.alphaMode === 'MASK' || material.alphaMode === 'BLEND' ? material.alphaMode : 'OPAQUE';
    return {
      index,
      name: named(material.name, `material ${index}`),
      baseColor: vec(pbr.baseColorFactor, 4, [1, 1, 1, 1]) as unknown as Vec4,
      metallic: finite(pbr.metallicFactor, 1),
      roughness: finite(pbr.roughnessFactor, 1),
      emissive: vec(material.emissiveFactor, 3, [0, 0, 0]) as unknown as Vec3,
      emissiveStrength: finite(emissiveExt.emissiveStrength, 1),
      alphaMode: mode,
      alphaCutoff: finite(material.alphaCutoff, 0.5),
      doubleSided: material.doubleSided === true,
    };
  });

  const skins: ModelSkinCapability[] = records(json.skins).map((skin, index) => {
    const joints = numbers(skin.joints)
      .filter((each) => Number.isInteger(each) && each >= 0 && each < rawNodes.length)
      .map(Math.floor);
    return {
      index,
      name: named(skin.name, `skin ${index}`),
      joints,
      jointNames: joints.map(nodeName),
      skeleton: integer(skin.skeleton),
      inverseBindMatrices: integer(skin.inverseBindMatrices),
    };
  });

  const animations: ModelAnimationCapability[] = records(json.animations).map((animation, index) => {
    const samplers = records(animation.samplers);
    const channels = records(animation.channels).flatMap((channel): ModelAnimationChannelCapability[] => {
      const samplerAt = integer(channel.sampler);
      const target = (channel.target && typeof channel.target === 'object' ? channel.target : {}) as Json;
      const node = integer(target.node);
      const property = target.path;
      if (samplerAt === null || node === null || node >= rawNodes.length ||
          !['translation', 'rotation', 'scale', 'weights'].includes(String(property))) return [];
      const sampler = samplers[samplerAt] ?? {};
      const interpolation = sampler.interpolation === 'STEP' || sampler.interpolation === 'CUBICSPLINE'
        ? sampler.interpolation : 'LINEAR';
      return [{
        node,
        nodePath: pathOf(node),
        property: property as ModelAnimationChannelCapability['property'],
        interpolation,
        keyframes: accessorCount(sampler.input),
        duration: accessorDuration(sampler.input),
      }];
    });
    return {
      index,
      name: named(animation.name, `animation ${index}`),
      duration: channels.reduce((longest, channel) => Math.max(longest, channel.duration), 0),
      channels,
    };
  });

  const cameras: ModelCameraCapability[] = records(json.cameras).map((camera, index) => {
    const perspective = (camera.perspective && typeof camera.perspective === 'object' ? camera.perspective : {}) as Json;
    const orthographic = (camera.orthographic && typeof camera.orthographic === 'object' ? camera.orthographic : {}) as Json;
    if (camera.type === 'orthographic') {
      return {
        index,
        name: named(camera.name, `camera ${index}`),
        type: 'orthographic',
        znear: finite(orthographic.znear, 0.01),
        zfar: finite(orthographic.zfar, 1000),
        xmag: finite(orthographic.xmag, 1),
        ymag: finite(orthographic.ymag, 1),
      };
    }
    return {
      index,
      name: named(camera.name, `camera ${index}`),
      type: 'perspective',
      yfov: finite(perspective.yfov, Math.PI / 4),
      znear: finite(perspective.znear, 0.01),
      ...(perspective.zfar === undefined ? {} : { zfar: finite(perspective.zfar, 1000) }),
    };
  });

  const buffers = records(json.buffers);
  if (buffers.length !== 1 || typeof buffers[0]?.uri === 'string') {
    warnings.push('Only the embedded GLB buffer is rendered; external glTF resources are not fetched.');
  }
  if (records(json.images).some((image) => typeof image.uri === 'string')) {
    warnings.push('External image URIs are not fetched. Embed textures in the GLB for stage-safe playback.');
  }
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired.map(String) : [];
  const unsupported = required.filter((name) =>
    !['KHR_lights_punctual', 'KHR_materials_emissive_strength', 'KHR_materials_unlit'].includes(name),
  );
  if (unsupported.length) warnings.push(`Required extensions may not render: ${unsupported.join(', ')}`);

  return {
    generator: typeof asset.generator === 'string' ? asset.generator : null,
    version: '2.0',
    scenes: records(json.scenes).map((scene, index) => ({
      index,
      name: named(scene.name, `scene ${index}`),
      nodes: numbers(scene.nodes).filter((each) => Number.isInteger(each) && each >= 0 && each < nodes.length).map(Math.floor),
    })),
    defaultScene: integer(json.scene) ?? 0,
    nodes,
    meshes,
    materials,
    skins,
    animations,
    cameras,
    lights,
    warnings,
  };
}

/** Semantic key used to suggest matches across immutable asset revisions. */
export function bindingTargetKey(target: ModelBindingTarget): string {
  if (target.kind === 'node-transform') return `node:${target.nodePath}:${target.property}`;
  if (target.kind === 'morph') return `morph:${target.mesh}:${target.name}`;
  if (target.kind === 'animation') return `animation:${target.name}`;
  if (target.kind === 'material') return `material:${target.material}:${target.property}`;
  if (target.kind === 'light') return `light:${target.light}:${target.property}`;
  return `environment:${target.property}`;
}

export function reconcileBindings(
  setup: ModelSetup,
  capabilities: ModelCapabilities,
): { binding: ModelBinding; status: 'matched' | 'missing'; suggestion: ModelBindingTarget | null }[] {
  const candidates: ModelBindingTarget[] = [
    ...capabilities.nodes.flatMap((node) =>
      ['translation-x', 'translation-y', 'translation-z', 'rotation-x', 'rotation-y', 'rotation-z', 'scale-x', 'scale-y', 'scale-z']
        .map((property) => ({ kind: 'node-transform', node: node.index, nodePath: node.path, property }) as ModelBindingTarget),
    ),
    ...capabilities.meshes.flatMap((mesh) =>
      [...new Set(mesh.primitives.flatMap((primitive) => primitive.morphTargets))].map((name) => ({
        kind: 'morph', mesh: mesh.index, target: mesh.primitives.flatMap((primitive) => primitive.morphTargets).indexOf(name), name,
      }) as ModelBindingTarget),
    ),
    ...capabilities.animations.map((animation) => ({ kind: 'animation', animation: animation.index, name: animation.name }) as ModelBindingTarget),
    ...capabilities.materials.flatMap((material) =>
      ['metallic', 'roughness', 'opacity', 'emissive-strength'].map((property) => ({
        kind: 'material', material: material.index, property,
      }) as ModelBindingTarget),
    ),
  ];
  const byKey = new Map(candidates.map((target) => [bindingTargetKey(target), target]));
  return setup.bindings.map((binding) => {
    const target = binding.target;
    if (target.kind === 'environment') {
      return { binding, status: 'matched' as const, suggestion: { ...target } };
    }
    if (target.kind === 'light') {
      const exists = modelLightingOf(setup).lights.some((light) => light.id === target.light);
      return {
        binding,
        status: exists ? 'matched' as const : 'missing' as const,
        suggestion: exists ? { ...target } : null,
      };
    }
    const suggestion = byKey.get(bindingTargetKey(target)) ?? null;
    return { binding, status: suggestion ? 'matched' : 'missing', suggestion };
  });
}
