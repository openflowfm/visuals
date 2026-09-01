import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_MODEL_BINDINGS,
  MAX_MODEL_BYTES,
  MAX_MODEL_LIGHTS,
  MAX_MODEL_MORPHS,
  MODEL_LIGHTING_PRESETS,
  MODEL_LIGHT_SOURCES,
  MODEL_LIGHT_SPACES,
  MODEL_LIGHT_TYPES,
  MODEL_HASH,
  MODEL_SETUP_ID,
  bindingTargetKey,
  inspectGlb,
  modelLightingOf,
  modelLightingPreset,
  modelPorts,
  reconcileBindings,
  type ModelAsset,
  type ModelBinding,
  type ModelBindingTarget,
  type ModelLibrary,
  type ModelLightingSetup,
  type ModelMaterialMapping,
  type ModelRevisionDecision,
  type ModelSetup,
  type ModelSetupDraft,
} from '../model.ts';
import type { Scheme } from '../protocol.ts';
import { openflowHome } from './home.ts';

/** The model library deliberately does not share the media directory. */
export interface ModelPlace {
  root: string;
  assets: string;
  setups: string;
}

export function modelPlace(root = process.env.OPENFLOW_VISUALS_MODELS ?? path.join(openflowHome(), 'visuals', 'models')): ModelPlace {
  const place = { root, assets: path.join(root, 'assets'), setups: path.join(root, 'setups') };
  fs.mkdirSync(place.assets, { recursive: true });
  fs.mkdirSync(place.setups, { recursive: true });
  return place;
}

export interface ReconciliationPreview {
  setupId: string;
  fromAssetHash: string;
  toAssetHash: string;
  bindings: ReturnType<typeof reconcileBindings>;
  materials: { mapping: ModelMaterialMapping; suggestion: number | null }[];
  camera: number | null;
}

export interface ModelStore {
  library(): ModelLibrary;
  /** Store immutable bytes and their derived capability record. */
  import(bytes: Uint8Array, originalName: string): ModelAsset;
  /** Create or replace one reusable OpenFlow-owned setup. */
  save(draft: ModelSetupDraft): ModelSetup;
  /** Preview name/path matches before changing which immutable asset a setup uses. */
  previewReconciliation(setupId: string, assetHash: string): ReconciliationPreview;
  /** Explicitly accept a complete binding-id to target reconciliation. */
  reconcile(setupId: string, assetHash: string, decision: ModelRevisionDecision): ModelSetup;
  assetFile(hash: string): string | null;
  revision(): number;
}

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const setupRevision = (setup: Omit<ModelSetup, 'revision' | 'updatedAt'>): string =>
  sha(JSON.stringify({
    id: setup.id,
    name: setup.name,
    assetHash: setup.assetHash,
    bindings: setup.bindings,
    materials: setup.materials,
    lighting: modelLightingOf(setup),
    camera: setup.camera,
  })).slice(0, 16);

const cleanName = (name: string): string => {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'model.glb').slice(0, 160);
};

function ordinaryFile(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function atomicJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Litter is not allowed to hide the original write error.
    }
    throw error;
  }
}

function assetRecord(file: string): ModelAsset | null {
  if (!ordinaryFile(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelAsset;
    if (!value || !MODEL_HASH.test(value.hash) || typeof value.name !== 'string' ||
        !Number.isFinite(value.bytes) || !value.capabilities || typeof value.capabilities !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

function setupRecord(file: string): ModelSetup | null {
  if (!ordinaryFile(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelSetup;
    if (!value || !MODEL_SETUP_ID.test(value.id) || !MODEL_HASH.test(value.assetHash) ||
        typeof value.name !== 'string' || typeof value.revision !== 'string' ||
        !Array.isArray(value.bindings) || !Array.isArray(value.materials)) return null;
    if (value.lighting !== undefined) value.lighting = checkedLighting(value.lighting);
    return value;
  } catch {
    return null;
  }
}

const readRecords = <T>(dir: string, suffix: string, read: (file: string) => T | null): T[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(suffix))
      .map((entry) => read(path.join(dir, entry.name)))
      .filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
};

function targetExists(target: ModelBindingTarget, asset: ModelAsset, lighting: ModelLightingSetup): boolean {
  const c = asset.capabilities;
  if (target.kind === 'node-transform') {
    return c.nodes[target.node]?.path === target.nodePath && [
      'translation-x', 'translation-y', 'translation-z',
      'rotation-x', 'rotation-y', 'rotation-z',
      'scale-x', 'scale-y', 'scale-z',
    ].includes(target.property);
  }
  if (target.kind === 'morph') {
    const mesh = c.meshes[target.mesh];
    return !!mesh && mesh.primitives.some((primitive) => primitive.morphTargets[target.target] === target.name);
  }
  if (target.kind === 'animation') return c.animations[target.animation]?.name === target.name;
  if (target.kind === 'material') {
    return c.materials[target.material] !== undefined &&
      ['metallic', 'roughness', 'opacity', 'emissive-strength'].includes(target.property);
  }
  if (target.kind === 'light') {
    return lighting.lights.some((light) => light.id === target.light) && [
      'intensity', 'position-x', 'position-y', 'position-z', 'target-x', 'target-y', 'target-z',
      'range', 'inner-cone', 'outer-cone',
    ].includes(target.property);
  }
  return target.kind === 'environment' && ['intensity', 'rotation'].includes(target.property);
}

function checkedBindings(
  bindings: readonly ModelBinding[],
  asset: ModelAsset,
  lighting: ModelLightingSetup,
): ModelBinding[] {
  if (bindings.length > MAX_MODEL_BINDINGS) throw new Error(`a setup may publish at most ${MAX_MODEL_BINDINGS} controls`);
  const ids = new Set<string>();
  return bindings.map((raw, index) => {
    if (!MODEL_SETUP_ID.test(raw.id)) throw new Error(`binding ${index + 1} has an invalid stable id`);
    if (ids.has(raw.id)) throw new Error(`binding id ${raw.id} is used more than once`);
    ids.add(raw.id);
    if (!raw.label.trim()) throw new Error(`binding ${raw.id} needs a display name`);
    if (!targetExists(raw.target, asset, lighting)) throw new Error(`binding ${raw.id} points outside ${asset.name} or its lighting rig`);
    if (raw.target.kind === 'morph' && raw.target.target >= MAX_MODEL_MORPHS) {
      throw new Error(`binding ${raw.id} exceeds the first ${MAX_MODEL_MORPHS} renderable morph targets`);
    }
    for (const [name, value] of [['default', raw.default], ['min', raw.min], ['max', raw.max]] as const) {
      if (!Number.isFinite(value)) throw new Error(`binding ${raw.id} has an invalid ${name}`);
    }
    if (raw.default < 0 || raw.default > 1) throw new Error(`binding ${raw.id} default must be normalized`);
    return {
      ...raw,
      label: raw.label.trim().slice(0, 80),
      group: raw.group.trim().slice(0, 80),
    };
  });
}

const checkedVec3 = (value: readonly number[], label: string): [number, number, number] => {
  if (value.length !== 3 || value.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > 64)) {
    throw new Error(`${label} must be three finite bounded numbers`);
  }
  return [value[0]!, value[1]!, value[2]!];
};

const checkedColour = (value: readonly number[], label: string): [number, number, number] => {
  const checked = checkedVec3(value, label);
  if (checked.some((entry) => entry < 0 || entry > 16)) throw new Error(`${label} must be between 0 and 16`);
  return checked;
};

function checkedLighting(raw: ModelLightingSetup | undefined): ModelLightingSetup {
  const lighting = raw ?? modelLightingPreset('studio');
  if (!MODEL_LIGHTING_PRESETS.includes(lighting.preset)) throw new Error('lighting has an invalid preset');
  const environment = lighting.environment;
  if (!environment || !Number.isFinite(environment.intensity) || environment.intensity < 0 || environment.intensity > 8) {
    throw new Error('environment intensity must be between 0 and 8');
  }
  if (!Number.isFinite(environment.rotation) || Math.abs(environment.rotation) > Math.PI * 100) {
    throw new Error('environment rotation is not finite and bounded');
  }
  if (!MODEL_LIGHT_SOURCES.includes(environment.top) || !MODEL_LIGHT_SOURCES.includes(environment.bottom)) {
    throw new Error('environment has an invalid palette source');
  }
  if (!Array.isArray(lighting.lights) || lighting.lights.length > MAX_MODEL_LIGHTS) {
    throw new Error(`a setup may contain at most ${MAX_MODEL_LIGHTS} direct lights`);
  }
  const ids = new Set<string>();
  let shadows = 0;
  const lights = lighting.lights.map((entry, index) => {
    if (!MODEL_SETUP_ID.test(entry.id) || ids.has(entry.id)) throw new Error(`light ${index + 1} needs a unique stable id`);
    ids.add(entry.id);
    if (!entry.label.trim()) throw new Error(`light ${entry.id} needs a display name`);
    if (!MODEL_LIGHT_TYPES.includes(entry.type)) throw new Error(`light ${entry.id} has an invalid type`);
    if (!MODEL_LIGHT_SPACES.includes(entry.space)) throw new Error(`light ${entry.id} has an invalid coordinate space`);
    if (!MODEL_LIGHT_SOURCES.includes(entry.source)) throw new Error(`light ${entry.id} has an invalid palette source`);
    if (!Number.isFinite(entry.intensity) || entry.intensity < 0 || entry.intensity > 64) {
      throw new Error(`light ${entry.id} intensity must be between 0 and 64`);
    }
    if (!Number.isFinite(entry.range) || entry.range <= 0 || entry.range > 64) {
      throw new Error(`light ${entry.id} range must be between 0 and 64`);
    }
    if (!Number.isFinite(entry.innerConeAngle) || !Number.isFinite(entry.outerConeAngle) ||
        entry.innerConeAngle < 0 || entry.outerConeAngle <= 0 ||
        entry.innerConeAngle > entry.outerConeAngle || entry.outerConeAngle > Math.PI / 2) {
      throw new Error(`light ${entry.id} has invalid spot cone angles`);
    }
    if (!Number.isFinite(entry.softness) || entry.softness < 0 || entry.softness > 4) {
      throw new Error(`light ${entry.id} softness must be between 0 and 4`);
    }
    if (entry.shadow) {
      shadows += 1;
      if (entry.type === 'point') throw new Error(`point light ${entry.id} cannot use the bounded single-view shadow`);
    }
    return {
      ...entry,
      label: entry.label.trim().slice(0, 80),
      color: checkedColour(entry.color, `light ${entry.id} colour`),
      position: checkedVec3(entry.position, `light ${entry.id} position`),
      target: checkedVec3(entry.target, `light ${entry.id} target`),
      enabled: entry.enabled === true,
      shadow: entry.shadow === true,
    };
  });
  if (shadows > 1) throw new Error('a setup may cast at most one model shadow');
  return {
    preset: lighting.preset,
    environment: {
      ...environment,
      topColor: checkedColour(environment.topColor, 'environment top colour'),
      bottomColor: checkedColour(environment.bottomColor, 'environment bottom colour'),
    },
    lights,
  };
}

function checkedMaterials(materials: readonly ModelMaterialMapping[], asset: ModelAsset): ModelMaterialMapping[] {
  const seen = new Set<number>();
  return materials.map((mapping) => {
    if (!asset.capabilities.materials[mapping.material]) throw new Error(`material ${mapping.material} is not in ${asset.name}`);
    if (seen.has(mapping.material)) throw new Error(`material ${mapping.material} is mapped more than once`);
    seen.add(mapping.material);
    if (!['color-a', 'color-b', 'primary', 'secondary', 'complement', 'accent', 'chalk', 'original'].includes(mapping.source)) {
      throw new Error(`material ${mapping.material} has an invalid palette source`);
    }
    if (!Number.isFinite(mapping.amount) || mapping.amount < 0 || mapping.amount > 1) {
      throw new Error(`material ${mapping.material} amount must be normalized`);
    }
    return { ...mapping };
  });
}

export function openModelStore(place: ModelPlace = modelPlace()): ModelStore {
  let rev = 0;
  let notice: string | null = null;

  const assets = (): ModelAsset[] =>
    readRecords(place.assets, '.json', assetRecord).sort((a, b) => a.name.localeCompare(b.name));
  const setups = (): ModelSetup[] =>
    readRecords(place.setups, '.json', setupRecord).sort((a, b) => a.name.localeCompare(b.name));
  const asset = (hash: string): ModelAsset | null => {
    if (!MODEL_HASH.test(hash)) return null;
    const found = assetRecord(path.join(place.assets, `${hash}.json`));
    return found?.hash === hash ? found : null;
  };
  const setup = (id: string): ModelSetup | null => {
    if (!MODEL_SETUP_ID.test(id)) return null;
    const found = setupRecord(path.join(place.setups, `${id}.json`));
    return found?.id === id ? found : null;
  };

  const save = (draft: ModelSetupDraft, original?: ModelSetup): ModelSetup => {
    if (!MODEL_SETUP_ID.test(draft.id)) throw new Error('setup id must be a safe lower-case address');
    if (!draft.name.trim()) throw new Error('setup needs a display name');
    const raw = asset(draft.assetHash);
    if (!raw) throw new Error('setup asset is not in the model library');
    const now = new Date().toISOString();
    const lighting = checkedLighting(draft.lighting);
    const base: Omit<ModelSetup, 'revision' | 'updatedAt'> = {
      id: draft.id,
      name: draft.name.trim().slice(0, 100),
      assetHash: raw.hash,
      bindings: checkedBindings(draft.bindings, raw, lighting),
      materials: checkedMaterials(draft.materials, raw),
      lighting,
      camera: draft.camera === undefined ? null : draft.camera,
      createdAt: original?.createdAt ?? now,
    };
    if (base.camera !== null && !raw.capabilities.cameras[base.camera]) throw new Error('selected camera is not in the asset');
    const value: ModelSetup = { ...base, revision: setupRevision(base), updatedAt: now };
    atomicJson(path.join(place.setups, `${draft.id}.json`), value);
    rev += 1;
    notice = null;
    return value;
  };

  return {
    library: () => ({ assets: assets(), setups: setups(), notice }),
    revision: () => rev,
    import(bytes, originalName) {
      if (bytes.byteLength === 0) throw new Error('empty GLB');
      if (bytes.byteLength > MAX_MODEL_BYTES) throw new Error('GLB is larger than 128 MiB');
      const capabilities = inspectGlb(bytes);
      const hash = sha(bytes);
      const glb = path.join(place.assets, `${hash}.glb`);
      const metadata = path.join(place.assets, `${hash}.json`);
      let record = assetRecord(metadata);
      if (ordinaryFile(glb) && sha(fs.readFileSync(glb)) !== hash) {
        throw new Error('stored model asset no longer matches its content address');
      }
      if (!ordinaryFile(glb)) {
        const temporary = `${glb}.${process.pid}.tmp`;
        try {
          fs.writeFileSync(temporary, bytes, { flag: 'wx' });
          fs.renameSync(temporary, glb);
        } catch (error) {
          try {
            fs.rmSync(temporary, { force: true });
          } catch {
            // Keep the original error.
          }
          throw error;
        }
      }
      if (!record) {
        record = {
          hash,
          name: cleanName(originalName),
          bytes: bytes.byteLength,
          importedAt: new Date().toISOString(),
          capabilities,
        };
        atomicJson(metadata, record);
      }
      rev += 1;
      notice = null;
      return record;
    },
    save(draft) {
      const held = setup(draft.id);
      if (held && held.assetHash !== draft.assetHash) {
        throw new Error('setup asset revisions must use explicit reconciliation');
      }
      return save(draft, held ?? undefined);
    },
    previewReconciliation(setupId, assetHash) {
      const held = setup(setupId);
      const next = asset(assetHash);
      if (!held) throw new Error('setup is not in the model library');
      if (!next) throw new Error('replacement asset is not in the model library');
      return {
        setupId,
        fromAssetHash: held.assetHash,
        toAssetHash: next.hash,
        bindings: reconcileBindings(held, next.capabilities),
        materials: held.materials.map((mapping) => {
          const old = asset(held.assetHash)?.capabilities.materials[mapping.material];
          const suggestion = old
            ? next.capabilities.materials.find((material) => material.name === old.name)?.index ?? null
            : null;
          return { mapping, suggestion };
        }),
        camera: held.camera === null ? null : (() => {
          const old = asset(held.assetHash)?.capabilities.cameras[held.camera!];
          return old ? next.capabilities.cameras.find((camera) => camera.name === old.name)?.index ?? null : null;
        })(),
      };
    },
    reconcile(setupId, assetHash, decision) {
      const held = setup(setupId);
      const next = asset(assetHash);
      if (!held) throw new Error('setup is not in the model library');
      if (!next) throw new Error('replacement asset is not in the model library');
      const expected = new Set(held.bindings.map((binding) => binding.id));
      if (Object.keys(decision.targets).length !== expected.size || Object.keys(decision.targets).some((id) => !expected.has(id))) {
        throw new Error('reconciliation must decide every published binding exactly once');
      }
      const materialKeys = new Set(held.materials.map((mapping) => String(mapping.material)));
      if (Object.keys(decision.materials).length !== materialKeys.size ||
          Object.keys(decision.materials).some((index) => !materialKeys.has(index))) {
        throw new Error('reconciliation must decide every material mapping exactly once');
      }
      const bindings = held.bindings.map((binding) => ({ ...binding, target: decision.targets[binding.id] }));
      const carriedMaterials = held.materials.flatMap((mapping): ModelMaterialMapping[] => {
        const target = decision.materials[String(mapping.material)];
        if (target === null) return [];
        if (!Number.isInteger(target) || !next.capabilities.materials[target]) {
          throw new Error(`reconciliation material ${mapping.material} points outside the replacement`);
        }
        return [{ ...mapping, material: target }];
      });
      if (new Set(carriedMaterials.map((mapping) => mapping.material)).size !== carriedMaterials.length) {
        throw new Error('reconciliation maps more than one material onto the same replacement material');
      }
      if (decision.camera !== null && !next.capabilities.cameras[decision.camera]) {
        throw new Error('reconciliation camera points outside the replacement');
      }
      return save({
        id: held.id,
        name: held.name,
        assetHash: next.hash,
        bindings,
        materials: carriedMaterials,
        lighting: modelLightingOf(held),
        camera: decision.camera,
      }, held);
    },
    assetFile(hash) {
      if (!MODEL_HASH.test(hash)) return null;
      const file = path.join(place.assets, `${hash}.glb`);
      if (!ordinaryFile(file)) return null;
      return sha(fs.readFileSync(file)) === hash ? file : null;
    },
  };
}

/** Useful in UI and tests: same semantics as reconciliation, compactly keyed. */
export const suggestedTargetMap = (preview: ReconciliationPreview): Record<string, ModelBindingTarget> =>
  Object.fromEntries(preview.bindings.flatMap(({ binding, suggestion }) => suggestion ? [[binding.id, suggestion]] : []));

/** A deterministic signature for tests and renderer cache keys. */
export const setupTargetSignature = (setup: ModelSetup): string =>
  setup.bindings.map((binding) => `${binding.id}:${bindingTargetKey(binding.target)}`).join('|');

/**
 * Synchronize only the context-free setup snapshot carried by flow instances.
 * Binding ids are the addresses, so a label-only setup edit changes no cord,
 * value, or modulation depth. Removed published bindings are deliberately
 * pruned at this explicit setup-edit boundary.
 */
export function synchronizeModelNodes(scheme: Scheme, library: ModelLibrary): Scheme {
  const setups = new Map(library.setups.map((setup) => [setup.id, setup]));
  let changed = false;
  const flows = Object.fromEntries(Object.entries(scheme.flows).map(([id, flow]) => {
    const allowed = new Map<string, Set<string>>();
    const nodes = flow.circuit.nodes.map((node) => {
      if (node.kind !== 'model' || !node.setup) return node;
      const setup = setups.get(node.setup);
      if (!setup) return node;
      const ports = modelPorts(setup);
      const ids = new Set(ports.map((port) => port.id));
      allowed.set(node.id, ids);
      const values = Object.fromEntries(Object.entries(node.values ?? {}).filter(([name]) => ids.has(name)));
      const depths = Object.fromEntries(Object.entries(node.depths ?? {}).filter(([name]) => ids.has(name)));
      const next = {
        ...node,
        setupRevision: setup.revision,
        modelPorts: ports,
        ...(Object.keys(values).length ? { values } : { values: undefined }),
        ...(Object.keys(depths).length ? { depths } : { depths: undefined }),
      };
      if (JSON.stringify(next) !== JSON.stringify(node)) changed = true;
      return next;
    });
    const cords = flow.circuit.cords.filter((cord) => {
      const slash = cord.to.lastIndexOf('/');
      if (slash < 0) return true;
      const node = cord.to.slice(0, slash);
      const port = cord.to.slice(slash + 1);
      const ids = allowed.get(node);
      const keep = !ids || port === 'p' || port === 'color-a' || port === 'color-b' || ids.has(port);
      if (!keep) changed = true;
      return keep;
    });
    return [id, nodes === flow.circuit.nodes && cords === flow.circuit.cords ? flow : {
      ...flow,
      circuit: { nodes, cords },
    }];
  }));
  return changed ? { ...scheme, flows } : scheme;
}
