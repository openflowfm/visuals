import { useEffect, useMemo, useRef, useState } from 'react';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Scheme, Show } from '../../protocol.ts';
import './models.css';
import {
  MAX_MODEL_LIGHTS,
  MODEL_LIGHTING_PRESETS,
  MODEL_LIGHT_SOURCES,
  MODEL_LIGHT_SPACES,
  MODEL_LIGHT_TYPES,
  MODEL_MATERIAL_PROPERTIES,
  MODEL_PROJECTIONS,
  MODEL_RECIPE_WRAPS,
  MODEL_SETUP_ID,
  MODEL_SLOTS,
  bindingTargetKey,
  materialTextureUse,
  modelLightingOf,
  modelLightingPreset,
  modelRecipe,
  modelRecipeOf,
  reconcileBindings,
  type ModelAsset,
  type ModelBinding,
  type ModelBindingTarget,
  type ModelLightSetup,
  type ModelLightingSetup,
  type ModelLightingPreset,
  type ModelLibrary,
  type ModelMaterialCapability,
  type ModelMaterialMapping,
  type ModelMaterialProperty,
  type ModelNodeCapability,
  type ModelPaletteSource,
  type ModelRevisionDecision,
  type ModelSetup,
  type ModelSetupDraft,
  type ModelSlot,
  type ModelSlotSource,
} from '../../model.ts';
import { ModelSetupPreview } from './ModelSetupPreview.tsx';

const SOURCES: ModelPaletteSource[] = [
  'color-a', 'color-b', 'primary', 'secondary', 'complement', 'accent', 'chalk', 'original',
];

const SLOT_LABEL: Record<ModelSlot, string> = {
  baseColor: 'base colour',
  metallicRoughness: 'metal / rough',
  normal: 'normal',
  occlusion: 'occlusion',
  emissive: 'emissive',
};

const slug = (value: string): string => {
  const made = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(made) ? made : `control-${made || 'one'}`;
};

const normalized = (value: number, min: number, max: number): number =>
  Math.max(0, Math.min(1, (value - min) / (max - min)));

const transformNumber = (value: number): string => {
  const magnitude = Math.abs(value);
  if (value !== 0 && (magnitude < 0.01 || magnitude >= 1000)) return value.toExponential(2);
  return value.toFixed(2);
};

function transformOf(node: ModelNodeCapability): { translation: number[]; rotation: number[]; scale: number[] } {
  const position = new Vector3(...node.translation);
  const quaternion = new Quaternion(...node.rotation);
  const scale = new Vector3(...node.scale);
  if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion);
  return {
    translation: position.toArray(),
    rotation: euler.toArray().slice(0, 3) as number[],
    scale: scale.toArray(),
  };
}

const freeBindingId = (bindings: readonly ModelBinding[], label: string): string => {
  const base = slug(label);
  const used = new Set(bindings.map((binding) => binding.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
};

function targetLabel(target: ModelBindingTarget, asset: ModelAsset): string {
  if (target.kind === 'node-transform') return `${target.nodePath} · ${target.property}`;
  if (target.kind === 'morph') return `${asset.capabilities.meshes[target.mesh]?.name ?? `mesh ${target.mesh}`} · ${target.name}`;
  if (target.kind === 'animation') return `animation · ${target.name}`;
  if (target.kind === 'material') return `${asset.capabilities.materials[target.material]?.name ?? `material ${target.material}`} · ${target.property}`;
  if (target.kind === 'light') return `${target.light} · ${target.property}`;
  return `environment · ${target.property}`;
}

function materialRange(
  material: ModelMaterialCapability,
  property: ModelMaterialProperty,
  mapping: ModelMaterialMapping,
): readonly [number, number, number] {
  const recipe = modelRecipeOf(mapping);
  if (property === 'emissive-strength') {
    const max = Math.max(8, material.emissiveStrength * 2);
    return [0, max, material.emissiveStrength / max];
  }
  if (property === 'normal-strength') return [0, 4, recipe.normalStrength / 4];
  if (property === 'uv-scale') return [0.05, 8, normalized(1, 0.05, 8)];
  if (property === 'uv-rotation') return [-Math.PI, Math.PI, normalized(recipe.uvRotation, -Math.PI, Math.PI)];
  if (property === 'uv-offset-x') return [-4, 4, normalized(recipe.uvOffset[0], -4, 4)];
  if (property === 'uv-offset-y') return [-4, 4, normalized(recipe.uvOffset[1], -4, 4)];
  const value = property === 'metallic'
    ? material.metallic
    : property === 'roughness'
      ? material.roughness
      : property === 'opacity'
        ? material.baseColor[3]
        : property === 'texture-mix'
          ? recipe.textureMix
          : property === 'occlusion-strength'
            ? recipe.occlusionStrength
            : property === 'rim'
              ? recipe.rim
              : property === 'scan'
                ? recipe.scan
                : recipe.bands;
  return [0, 1, value];
}

function allTargets(asset: ModelAsset, lighting?: ModelLightingSetup): ModelBindingTarget[] {
  const properties = [
    'translation-x', 'translation-y', 'translation-z',
    'rotation-x', 'rotation-y', 'rotation-z',
    'scale-x', 'scale-y', 'scale-z',
  ] as const;
  return [
    ...asset.capabilities.nodes.flatMap((node) => properties.map((property) => ({
      kind: 'node-transform' as const,
      node: node.index,
      nodePath: node.path,
      property,
    }))),
    ...asset.capabilities.meshes.flatMap((mesh) => {
      const names = [...new Set(mesh.primitives.flatMap((primitive) => primitive.morphTargets))];
      return names.map((name, target) => ({ kind: 'morph' as const, mesh: mesh.index, target, name }));
    }),
    ...asset.capabilities.animations.map((animation) => ({
      kind: 'animation' as const,
      animation: animation.index,
      name: animation.name,
    })),
    ...asset.capabilities.materials.flatMap((material) =>
      MODEL_MATERIAL_PROPERTIES.map((property) => ({
        kind: 'material' as const,
        material: material.index,
        property,
      })),
    ),
    ...((lighting?.lights ?? []).flatMap((light) =>
      (['intensity', 'position-x', 'position-y', 'position-z', 'target-x', 'target-y', 'target-z', 'range', 'inner-cone', 'outer-cone'] as const)
        .map((property) => ({ kind: 'light' as const, light: light.id, property })),
    )),
    { kind: 'environment' as const, property: 'intensity' as const },
    { kind: 'environment' as const, property: 'rotation' as const },
  ];
}

const cloneLighting = (lighting: ModelLightingSetup): ModelLightingSetup => ({
  preset: lighting.preset,
  environment: {
    ...lighting.environment,
    topColor: [...lighting.environment.topColor],
    bottomColor: [...lighting.environment.bottomColor],
  },
  lights: lighting.lights.map((light) => ({
    ...light,
    color: [...light.color],
    position: [...light.position],
    target: [...light.target],
  })),
});

const bindingFor = (
  bindings: readonly ModelBinding[],
  target: ModelBindingTarget,
  label: string,
  group: string,
  range: readonly [number, number, number],
): ModelBinding => ({
  id: freeBindingId(bindings, label),
  label,
  group,
  target,
  min: range[0],
  max: range[1],
  default: range[2],
});

function draftFor(asset: ModelAsset): ModelSetupDraft {
  let bindings: ModelBinding[] = [];
  for (const mesh of asset.capabilities.meshes) {
    const names = [...new Set(mesh.primitives.flatMap((primitive) => primitive.morphTargets))];
    names.forEach((name, target) => {
      const fallback = Math.max(0, Math.min(1, mesh.weights[target] ?? 0));
      bindings.push(bindingFor(bindings, { kind: 'morph', mesh: mesh.index, target, name }, name, 'shape', [0, 1, fallback]));
    });
  }
  for (const animation of asset.capabilities.animations) {
    bindings.push(bindingFor(
      bindings,
      { kind: 'animation', animation: animation.index, name: animation.name },
      animation.name,
      'animation',
      [0, Math.max(animation.duration, 1), 0],
    ));
  }
  const name = asset.name.replace(/\.glb$/i, '');
  return {
    id: slug(name),
    name,
    assetHash: asset.hash,
    bindings,
    materials: asset.capabilities.materials.map((material) => ({
      material: material.index,
      source: material.index % 2 === 0 ? 'color-a' : 'color-b',
      amount: 1,
    })),
    lighting: modelLightingPreset('studio'),
    camera: asset.capabilities.cameras.length ? 0 : null,
  };
}

function asDraft(setup: ModelSetup): ModelSetupDraft {
  return {
    id: setup.id,
    name: setup.name,
    assetHash: setup.assetHash,
    bindings: setup.bindings.map((binding) => ({ ...binding, target: { ...binding.target } })),
    materials: setup.materials.map((mapping) => ({
      ...mapping,
      ...(mapping.recipe ? { recipe: modelRecipe(mapping.recipe) } : {}),
    })),
    lighting: cloneLighting(modelLightingOf(setup)),
    camera: setup.camera,
  };
}

export function ModelLibraryView({
  library,
  scheme,
  show,
  onImport,
  onImportTexture,
  onSave,
  onReconcile,
}: {
  library: ModelLibrary;
  scheme: Scheme;
  show: Show;
  onImport(file: File): Promise<void>;
  onImportTexture(file: File): Promise<void>;
  onSave(setup: ModelSetupDraft): void;
  onReconcile(setupId: string, assetHash: string, decision: ModelRevisionDecision): void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const textureInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ModelSetupDraft | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [revisionHash, setRevisionHash] = useState('');
  const [reconciled, setReconciled] = useState<Record<string, ModelBindingTarget>>({});
  const [materialReconciled, setMaterialReconciled] = useState<Record<string, number | null>>({});
  const [revisionCamera, setRevisionCamera] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [authoredPreview, setAuthoredPreview] = useState(false);

  const asset = draft ? library.assets.find((entry) => entry.hash === draft.assetHash) ?? null : null;
  const saved = savedId ? library.setups.find((entry) => entry.id === savedId) ?? null : null;
  const revision = library.assets.find((entry) => entry.hash === revisionHash) ?? null;
  const preview = saved && revision ? reconcileBindings(saved, revision.capabilities) : null;
  const candidates = useMemo(
    () => revision ? allTargets(revision, saved ? modelLightingOf(saved) : undefined) : [],
    [revision, saved],
  );
  const candidateMap = useMemo(() => new Map(candidates.map((target) => [bindingTargetKey(target), target])), [candidates]);
  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flow of Object.values(scheme.flows)) {
      for (const node of flow.circuit.nodes) {
        if (node.kind === 'model' && node.setup) counts.set(node.setup, (counts.get(node.setup) ?? 0) + 1);
      }
    }
    return counts;
  }, [scheme.flows]);
  const needle = query.trim().toLowerCase();
  const visibleSetups = library.setups.filter((setup) =>
    !needle || setup.name.toLowerCase().includes(needle) || setup.id.includes(needle),
  );
  const visibleAssets = library.assets.filter((entry) =>
    !needle || entry.name.toLowerCase().includes(needle) || entry.hash.includes(needle),
  );
  const previewDraft = draft && authoredPreview ? {
    ...draft,
    materials: draft.materials.map((mapping) => ({
      ...mapping,
      source: 'original' as const,
      amount: 1,
      recipe: modelRecipe(),
    })),
  } : draft;

  useEffect(() => {
    if (!preview) {
      setReconciled({});
      setMaterialReconciled({});
      setRevisionCamera(null);
      return;
    }
    setReconciled(Object.fromEntries(preview.flatMap(({ binding, suggestion }) =>
      suggestion ? [[binding.id, suggestion]] : [],
    )));
    const oldAsset = library.assets.find((entry) => entry.hash === saved?.assetHash);
    setMaterialReconciled(Object.fromEntries((saved?.materials ?? []).map((mapping) => {
      const name = oldAsset?.capabilities.materials[mapping.material]?.name;
      const suggestion = name
        ? revision?.capabilities.materials.find((material) => material.name === name)?.index ?? null
        : null;
      return [String(mapping.material), suggestion];
    })));
    const cameraName = saved?.camera === null || saved?.camera === undefined
      ? null : oldAsset?.capabilities.cameras[saved.camera]?.name;
    setRevisionCamera(cameraName
      ? revision?.capabilities.cameras.find((camera) => camera.name === cameraName)?.index ?? null
      : null);
  }, [revisionHash, savedId, library.assets]);

  // The server sends a new revision after save. Re-open it so its authoritative
  // revision and any normalization replace the optimistic draft.
  useEffect(() => {
    if (!savedId) return;
    const next = library.setups.find((entry) => entry.id === savedId);
    if (next) setDraft(asDraft(next));
  }, [library, savedId]);

  const chooseSetup = (id: string) => {
    const setup = library.setups.find((entry) => entry.id === id);
    if (!setup) return;
    setSavedId(setup.id);
    setDraft(asDraft(setup));
    setAuthoredPreview(false);
    setRevisionHash('');
  };

  const start = (picked = library.assets[0]) => {
    if (!picked) return;
    setSavedId(null);
    setDraft(draftFor(picked));
    setAuthoredPreview(false);
    setRevisionHash('');
  };

  const updateBinding = (id: string, patch: Partial<ModelBinding>) => {
    if (!draft) return;
    setDraft({ ...draft, bindings: draft.bindings.map((binding) => binding.id === id ? { ...binding, ...patch } : binding) });
  };

  const publish = (
    target: ModelBindingTarget,
    label: string,
    group: string,
    range: readonly [number, number, number],
  ) => {
    if (!draft) return;
    if (draft.bindings.some((binding) => bindingTargetKey(binding.target) === bindingTargetKey(target))) return;
    setDraft({ ...draft, bindings: [...draft.bindings, bindingFor(draft.bindings, target, label, group, range)] });
  };

  const setMaterial = (material: number, patch: Partial<ModelMaterialMapping>) => {
    if (!draft) return;
    const held = draft.materials.find((mapping) => mapping.material === material) ?? {
      material, source: 'original' as const, amount: 1,
    };
    setDraft({
      ...draft,
      materials: [
        ...draft.materials.filter((mapping) => mapping.material !== material),
        { ...held, ...patch },
      ].sort((a, b) => a.material - b.material),
    });
  };

  const setRecipe = (material: number, patch: Parameters<typeof modelRecipe>[0]) => {
    const held = draft?.materials.find((mapping) => mapping.material === material);
    setMaterial(material, { recipe: modelRecipe({ ...modelRecipeOf(held), ...patch }) });
  };

  const setSlot = (material: number, slot: ModelSlot, source: ModelSlotSource) => {
    const held = draft?.materials.find((mapping) => mapping.material === material);
    const recipe = modelRecipeOf(held);
    setRecipe(material, { slots: { ...recipe.slots, [slot]: source } });
  };

  const changeLighting = (change: (lighting: ModelLightingSetup) => ModelLightingSetup) => {
    if (!draft) return;
    setDraft({ ...draft, lighting: change(cloneLighting(draft.lighting ?? modelLightingPreset('studio'))) });
  };

  const chooseLightingPreset = (preset: ModelLightingPreset) => {
    if (!draft) return;
    const lighting = modelLightingPreset(preset);
    const ids = new Set(lighting.lights.map((light) => light.id));
    setDraft({
      ...draft,
      lighting,
      bindings: draft.bindings.filter((binding) => binding.target.kind !== 'light' || ids.has(binding.target.light)),
    });
  };

  const updateLight = (id: string, patch: Partial<ModelLightSetup>) => changeLighting((lighting) => ({
    ...lighting,
    preset: 'custom',
    lights: lighting.lights.map((light) => light.id === id ? { ...light, ...patch } : light),
  }));

  const removeLight = (id: string) => {
    if (!draft) return;
    const lighting = cloneLighting(draft.lighting ?? modelLightingPreset('studio'));
    setDraft({
      ...draft,
      lighting: { ...lighting, preset: 'custom', lights: lighting.lights.filter((light) => light.id !== id) },
      bindings: draft.bindings.filter((binding) => binding.target.kind !== 'light' || binding.target.light !== id),
    });
  };

  const addLight = (candidate?: ModelLightSetup) => changeLighting((lighting) => {
    if (lighting.lights.length >= MAX_MODEL_LIGHTS) return lighting;
    const base = slug(candidate?.label ?? 'Light');
    const usedIds = new Set(lighting.lights.map((light) => light.id));
    let id = base;
    for (let at = 2; usedIds.has(id); at++) id = `${base}-${at}`;
    const light: ModelLightSetup = candidate
      ? { ...candidate, id }
      : {
          id,
          label: 'Light',
          type: 'point',
          space: 'camera',
          source: 'primary',
          color: [1, 1, 1],
          enabled: true,
          intensity: 2,
          position: [1.5, 1, 2],
          target: [0, 0, 0],
          range: 6,
          innerConeAngle: 0.35,
          outerConeAngle: 0.72,
          shadow: false,
          softness: 1,
        };
    return { ...lighting, preset: 'custom', lights: [...lighting.lights, light] };
  });

  const setLightVector = (
    id: string,
    property: 'position' | 'target' | 'color',
    axis: number,
    value: number,
  ) => changeLighting((lighting) => ({
    ...lighting,
    preset: 'custom',
    lights: lighting.lights.map((light) => {
      if (light.id !== id) return light;
      const vector = [...light[property]] as [number, number, number];
      vector[axis] = value;
      return { ...light, [property]: vector };
    }),
  }));

  const setEnvironmentColor = (
    property: 'topColor' | 'bottomColor',
    axis: number,
    value: number,
  ) => changeLighting((lighting) => {
    const vector = [...lighting.environment[property]] as [number, number, number];
    vector[axis] = value;
    return {
      ...lighting,
      preset: 'custom',
      environment: { ...lighting.environment, [property]: vector },
    };
  });

  const setShadow = (id: string, enabled: boolean) => changeLighting((lighting) => ({
    ...lighting,
    preset: 'custom',
    lights: lighting.lights.map((light) => ({
      ...light,
      shadow: enabled ? light.id === id : (light.id === id ? false : light.shadow),
    })),
  }));

  const draftLighting = draft ? (draft.lighting ?? modelLightingPreset('studio')) : null;

  return (
    <section className="model-workspace">
      <aside className="model-catalog">
        <div className="model-catalog-head">
          <span className="model-eyebrow">model library</span>
          <h2>Reusable GLB setups</h2>
          <p>Import inert model bytes once, then publish only the controls a flow should see.</p>
          <div className="model-actions">
            <Button tone="quiet" onPress={() => input.current?.click()}>import GLB</Button>
            <Button tone="quiet" onPress={() => textureInput.current?.click()}>import texture</Button>
            <Button tone="quiet" disabled={library.assets.length === 0} onPress={() => start()}>new setup</Button>
            <input
              ref={input}
              type="file"
              accept=".glb,model/gltf-binary"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setImporting(`importing ${file.name}…`);
                void onImport(file)
                  .then(() => setImporting(`${file.name} imported`))
                  .catch((error: unknown) => setImporting((error as Error).message));
              }}
            />
            <input
              ref={textureInput}
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setImporting(`importing ${file.name}…`);
                void onImportTexture(file)
                  .then(() => setImporting(`${file.name} imported`))
                  .catch((error: unknown) => setImporting((error as Error).message));
              }}
            />
          </div>
          {importing && <p className="model-notice">{importing}</p>}
          {library.notice && <p className="model-notice bad">{library.notice}</p>}
          <input
            className="model-search"
            type="search"
            value={query}
            placeholder="Find a setup or GLB"
            aria-label="Find a model setup or GLB"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div className="model-catalog-scroll">
          <section className="model-catalog-group">
            <h3>setups <span>{visibleSetups.length}</span></h3>
            {visibleSetups.length === 0 && <p className="model-empty-small">No reusable setups{needle ? ' match this search' : ' yet'}.</p>}
            {visibleSetups.map((setup) => {
              const source = library.assets.find((entry) => entry.hash === setup.assetHash);
              return (
                <button
                  type="button"
                  className="model-catalog-card"
                  data-selected={savedId === setup.id ? '' : undefined}
                  key={setup.id}
                  onClick={() => chooseSetup(setup.id)}
                >
                  <b>{setup.name}</b>
                  <span>{setup.bindings.length} inlet{setup.bindings.length === 1 ? '' : 's'} · {used.get(setup.id) ?? 0} flow instance{used.get(setup.id) === 1 ? '' : 's'}</span>
                  <small>{source?.name ?? setup.assetHash.slice(0, 10)} · revision {setup.revision.slice(0, 8)}</small>
                </button>
              );
            })}
          </section>

          <section className="model-catalog-group">
            <h3>immutable GLBs <span>{visibleAssets.length}</span></h3>
            {visibleAssets.length === 0 && <p className="model-empty-small">{needle ? 'No GLBs match this search.' : 'Import an ordinary .glb to begin.'}</p>}
            {visibleAssets.map((entry) => {
              const setupCount = library.setups.filter((setup) => setup.assetHash === entry.hash).length;
              return (
                <button
                  type="button"
                  className="model-catalog-card asset"
                  data-selected={asset?.hash === entry.hash && savedId === null ? '' : undefined}
                  key={entry.hash}
                  onClick={() => start(entry)}
                >
                  <b>{entry.name}</b>
                  <span>{entry.capabilities.nodes.length} nodes · {entry.capabilities.meshes.length} meshes · {(entry.bytes / 1024).toFixed(0)} KiB</span>
                  <small>{setupCount} setup{setupCount === 1 ? '' : 's'} · {entry.hash.slice(0, 10)}</small>
                </button>
              );
            })}
          </section>

          <section className="model-catalog-group">
            <h3>local textures <span>{library.textures.length}</span></h3>
            {library.textures.length === 0 && <p className="model-empty-small">PNG/JPEG overrides appear here.</p>}
            {library.textures.map((texture) => (
              <div className="model-texture-catalog" key={texture.hash}>
                <img src={`/models/textures/${texture.hash}`} alt="" />
                <span><b>{texture.name}</b><small>{texture.width}×{texture.height} · {(texture.bytes / 1024).toFixed(0)} KiB</small></span>
              </div>
            ))}
          </section>
        </div>
      </aside>

      <main className="model-studio">
        {!draft && (
          <div className="model-welcome">
            <span className="model-eyebrow">asset → setup → flow instance</span>
            <h2>Make the useful surface.</h2>
            <p>The GLB stays immutable. A setup names the materials, animation, morphs and transforms worth wiring. Every model node then keeps its own values and cords.</p>
            <Button onPress={() => library.assets.length ? start() : input.current?.click()}>
              {library.assets.length ? 'make a setup' : 'import your first GLB'}
            </Button>
          </div>
        )}
          {draft && asset && (
            <div className="model-editor">
              <header className="model-editor-head">
                <div>
                  <span className="model-eyebrow">{savedId ? 'reusable setup' : 'new setup'}</span>
                  <h2>{draft.name || 'Untitled setup'}</h2>
                </div>
                <div className="model-actions">
                  <Button
                    disabled={!MODEL_SETUP_ID.test(draft.id) || !draft.name.trim()}
                    onPress={() => {
                      onSave(draft);
                      setSavedId(draft.id);
                    }}
                  >save setup</Button>
                  <Button tone="quiet" onPress={() => { setDraft(null); setSavedId(null); }}>close</Button>
                </div>
              </header>
              <div className="model-preview-compare">
                <ModelSetupPreview
                  draft={previewDraft ?? draft}
                  asset={asset}
                  scheme={scheme}
                  show={show}
                  textures={library.textures}
                />
                <button
                  type="button"
                  aria-pressed={authoredPreview}
                  onClick={() => setAuthoredPreview((held) => !held)}
                >{authoredPreview ? 'show edited look' : 'hold authored look'}</button>
              </div>
              <div className="model-fields two">
                <label className="model-field">
                  <span>setup name</span>
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </label>
                <label className="model-field">
                  <span>stable id</span>
                  <input
                    value={draft.id}
                    disabled={savedId !== null}
                    data-bad={!MODEL_SETUP_ID.test(draft.id) ? '' : undefined}
                    onChange={(event) => setDraft({ ...draft, id: slug(event.target.value) })}
                  />
                </label>
              </div>
              {!savedId && library.assets.length > 1 && (
                <label className="model-field">
                  <span>immutable GLB</span>
                  <select value={draft.assetHash} onChange={(event) => {
                    const next = library.assets.find((entry) => entry.hash === event.target.value);
                    if (next) setDraft(draftFor(next));
                  }}>
                    {library.assets.map((entry) => <option key={entry.hash} value={entry.hash}>{entry.name}</option>)}
                  </select>
                </label>
              )}

              <p className="model-summary">
                {asset.name} · {asset.capabilities.nodes.length} nodes · {asset.capabilities.materials.length} materials ·{' '}
                {asset.capabilities.animations.length} clips · {asset.hash.slice(0, 10)}
              </p>
              {asset.capabilities.warnings.map((warning) => <p className="model-notice" key={warning}>{warning}</p>)}

              <details className="model-inspector">
                <summary>scenes</summary>
                {asset.capabilities.scenes.map((scene) => (
                  <p key={scene.index}>
                    <b>{scene.name}</b>{scene.index === asset.capabilities.defaultScene ? ' · default' : ''} · roots{' '}
                    {scene.nodes.map((node) => asset.capabilities.nodes[node]?.name ?? node).join(', ') || 'none'}
                  </p>
                ))}
              </details>

              <details className="model-inspector" open>
                <summary>scene nodes & transforms</summary>
                {asset.capabilities.nodes.map((node) => {
                  const transform = transformOf(node);
                  return <div className="model-capability" key={node.index}>
                    <span title={node.path}>
                      {node.path}<small> T {transform.translation.map(transformNumber).join(', ')} · R {transform.rotation.map(transformNumber).join(', ')} · S {transform.scale.map(transformNumber).join(', ')}{node.matrix ? ' · matrix' : ''}</small>
                    </span>
                    <span className="model-publish">
                      {(['rotation-x', 'rotation-y', 'rotation-z'] as const).map((property, axis) => (
                        <button
                          type="button"
                          key={property}
                          title={`Publish ${node.path} ${property}`}
                          onClick={() => publish(
                            { kind: 'node-transform', node: node.index, nodePath: node.path, property },
                            `${node.name} ${property.slice(-1).toUpperCase()}`,
                            'transforms',
                            [-Math.PI, Math.PI, normalized(transform.rotation[axis], -Math.PI, Math.PI)],
                          )}
                        >R{property.slice(-1).toUpperCase()}</button>
                      ))}
                      {(['translation-x', 'translation-y', 'translation-z'] as const).map((property, axis) => {
                        const reach = Math.max(1, Math.abs(transform.translation[axis]) * 2);
                        return (
                          <button
                            type="button"
                            key={property}
                            title={`Publish ${node.path} ${property}`}
                            onClick={() => publish(
                              { kind: 'node-transform', node: node.index, nodePath: node.path, property },
                              `${node.name} ${property.slice(-1).toUpperCase()}`,
                              'transforms',
                              [-reach, reach, normalized(transform.translation[axis], -reach, reach)],
                            )}
                          >T{property.slice(-1).toUpperCase()}</button>
                        );
                      })}
                      {(['scale-x', 'scale-y', 'scale-z'] as const).map((property, axis) => {
                        const reach = Math.max(2, Math.abs(transform.scale[axis]) * 2);
                        return (
                          <button
                            type="button"
                            key={property}
                            title={`Publish ${node.path} ${property}`}
                            onClick={() => publish(
                              { kind: 'node-transform', node: node.index, nodePath: node.path, property },
                              `${node.name} scale ${property.slice(-1).toUpperCase()}`,
                              'transforms',
                              [0, reach, normalized(transform.scale[axis], 0, reach)],
                            )}
                          >S{property.slice(-1).toUpperCase()}</button>
                        );
                      })}
                    </span>
                  </div>
                })}
              </details>

              <details className="model-inspector">
                <summary>meshes & named morphs</summary>
                {asset.capabilities.meshes.map((mesh) => (
                  <div className="model-capability stack" key={mesh.index}>
                    <span>{mesh.name} · {mesh.primitives.reduce((sum, primitive) => sum + primitive.vertices, 0)} vertices</span>
                    {[...new Set(mesh.primitives.flatMap((primitive) => primitive.morphTargets))].map((name, target) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() => publish(
                          { kind: 'morph', mesh: mesh.index, target, name },
                          name,
                          'shape',
                          [0, 1, Math.max(0, Math.min(1, mesh.weights[target] ?? 0))],
                        )}
                      >publish {name}</button>
                    ))}
                  </div>
                ))}
              </details>

              <details className="model-inspector">
                <summary>skins & joints</summary>
                {asset.capabilities.skins.length === 0 && <p>none</p>}
                {asset.capabilities.skins.map((skin) => (
                  <p key={skin.index}><b>{skin.name}</b> · {skin.jointNames.join(', ')}</p>
                ))}
              </details>

              <details className="model-inspector">
                <summary>animation clips & channels</summary>
                {asset.capabilities.animations.length === 0 && <p>none</p>}
                {asset.capabilities.animations.map((animation) => (
                  <div className="model-capability stack" key={animation.index}>
                    <span>{animation.name} · {animation.duration.toFixed(2)}s · {animation.channels.length} channels</span>
                    {animation.channels.map((channel, index) => (
                      <small key={`${channel.node}-${channel.property}-${index}`}>
                        {channel.nodePath} · {channel.property} · {channel.interpolation} · {channel.keyframes} keys
                      </small>
                    ))}
                    <button
                      type="button"
                      onClick={() => publish(
                        { kind: 'animation', animation: animation.index, name: animation.name },
                        animation.name,
                        'animation',
                        [0, Math.max(animation.duration, 1), 0],
                      )}
                    >publish</button>
                  </div>
                ))}
              </details>

              <details className="model-inspector model-images">
                <summary>images, textures & extensions</summary>
                <div className="model-image-grid">
                  {asset.capabilities.images.map((image) => (
                    <div className="model-image-card" data-bad={image.unsupported ? '' : undefined} key={image.index}>
                      {image.unsupported === null
                        ? <img src={`/models/assets/${asset.hash}/images/${image.index}`} alt={`Embedded ${image.name}`} />
                        : <span className="model-image-empty">not decoded</span>}
                      <b>{image.name}</b>
                      <small>{image.width && image.height ? `${image.width}×${image.height}` : 'unknown size'} · {image.mimeType ?? 'unknown type'}</small>
                      {image.unsupported && <small>{image.unsupported}</small>}
                    </div>
                  ))}
                </div>
                {asset.capabilities.images.length === 0 && <p>no embedded images</p>}
                {asset.capabilities.extensions.length > 0 && <p>{asset.capabilities.extensions.map((extension) => (
                  `${extension.name} · ${extension.supported ? 'rendered' : 'inspected only'}${extension.required ? ' · required' : ''}`
                )).join(' / ')}</p>}
              </details>

              <details className="model-inspector model-materials" open>
                <summary>material laboratory</summary>
                <p>Choose each slot's immutable picture, then shape one bounded recipe. Hold the authored look above to compare without losing this working copy.</p>
                {asset.capabilities.materials.map((material) => {
                  const mapping = draft.materials.find((entry) => entry.material === material.index) ?? {
                    material: material.index, source: 'original' as const, amount: 1,
                  };
                  const recipe = modelRecipeOf(mapping);
                  return (
                    <div className="model-material" key={material.index}>
                      <header className="model-material-head">
                        <b>{material.name}<small>base {material.baseColor.map((value) => value.toFixed(2)).join(', ')} · metal {material.metallic.toFixed(2)} · rough {material.roughness.toFixed(2)} · {material.alphaMode}{material.doubleSided ? ' · double-sided' : ''}{material.unlit ? ' · unlit' : ''}</small></b>
                        <label>palette source <select value={mapping.source} onChange={(event) => setMaterial(material.index, { source: event.target.value as ModelPaletteSource })}>
                          {SOURCES.map((source) => <option key={source}>{source}</option>)}
                        </select></label>
                        <label>palette amount <input
                          type="range" min="0" max="1" step="0.01" value={mapping.amount}
                          aria-label={`${material.name} mapping amount`}
                          onChange={(event) => setMaterial(material.index, { amount: Number(event.target.value) })}
                        /></label>
                      </header>

                      <div className="model-material-slots">
                        {MODEL_SLOTS.map((slot) => {
                          const authored = materialTextureUse(material, slot);
                          const texture = authored ? asset.capabilities.textures[authored.texture] : undefined;
                          const image = texture?.image === null || texture?.image === undefined
                            ? undefined : asset.capabilities.images[texture.image];
                          const source = recipe.slots[slot];
                          const override = source.kind === 'texture'
                            ? library.textures.find((entry) => entry.hash === source.hash) : undefined;
                          const address = source.kind === 'texture' ? `texture:${source.hash}` : source.kind;
                          const picture = source.kind === 'authored' && image?.unsupported === null
                            ? `/models/assets/${asset.hash}/images/${image.index}`
                            : override ? `/models/textures/${override.hash}` : null;
                          return (
                            <label className="model-slot" key={slot}>
                              <span>{SLOT_LABEL[slot]}</span>
                              {picture
                                ? <img src={picture} alt={`${material.name} ${SLOT_LABEL[slot]}`} />
                                : <span className="model-image-empty">flat</span>}
                              <select
                                value={address}
                                aria-label={`${material.name} ${SLOT_LABEL[slot]} source`}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setSlot(material.index, slot, value === 'authored' || value === 'none'
                                    ? { kind: value }
                                    : { kind: 'texture', hash: value.slice('texture:'.length) });
                                }}
                              >
                                <option value="authored" disabled={!authored}>authored{authored ? ` · UV${authored.texCoord}` : ' · unavailable'}</option>
                                <option value="none">flat / none</option>
                                {library.textures.map((entry) => <option key={entry.hash} value={`texture:${entry.hash}`}>{entry.name} · local</option>)}
                              </select>
                              <small>{override
                                ? `${override.width}×${override.height} local override`
                                : image
                                  ? image.unsupported ?? `${image.width}×${image.height} · UV${authored?.texCoord ?? 0}`
                                  : 'no authored map'}</small>
                            </label>
                          );
                        })}
                      </div>

                      <div className="model-recipe-fields">
                        <label>projection <select value={recipe.projection} onChange={(event) => setRecipe(material.index, { projection: event.currentTarget.value as typeof recipe.projection })}>{MODEL_PROJECTIONS.map((projection) => <option key={projection}>{projection}</option>)}</select></label>
                        <label>wrap <select value={recipe.wrap} onChange={(event) => setRecipe(material.index, { wrap: event.currentTarget.value as typeof recipe.wrap })}>{MODEL_RECIPE_WRAPS.map((wrap) => <option key={wrap}>{wrap}</option>)}</select></label>
                        <label>texture mix <input type="number" min="0" max="1" step="0.05" value={recipe.textureMix} onChange={(event) => setRecipe(material.index, { textureMix: Number(event.currentTarget.value) })} /></label>
                        <label>normal <input type="number" min="0" max="4" step="0.05" value={recipe.normalStrength} onChange={(event) => setRecipe(material.index, { normalStrength: Number(event.currentTarget.value) })} /></label>
                        <label>occlusion <input type="number" min="0" max="1" step="0.05" value={recipe.occlusionStrength} onChange={(event) => setRecipe(material.index, { occlusionStrength: Number(event.currentTarget.value) })} /></label>
                        <label>UV scale X <input type="number" step="0.05" value={recipe.uvScale[0]} onChange={(event) => setRecipe(material.index, { uvScale: [Number(event.currentTarget.value), recipe.uvScale[1]] })} /></label>
                        <label>UV scale Y <input type="number" step="0.05" value={recipe.uvScale[1]} onChange={(event) => setRecipe(material.index, { uvScale: [recipe.uvScale[0], Number(event.currentTarget.value)] })} /></label>
                        <label>UV offset X <input type="number" step="0.05" value={recipe.uvOffset[0]} onChange={(event) => setRecipe(material.index, { uvOffset: [Number(event.currentTarget.value), recipe.uvOffset[1]] })} /></label>
                        <label>UV offset Y <input type="number" step="0.05" value={recipe.uvOffset[1]} onChange={(event) => setRecipe(material.index, { uvOffset: [recipe.uvOffset[0], Number(event.currentTarget.value)] })} /></label>
                        <label>UV rotation <input type="number" step="0.05" value={recipe.uvRotation} onChange={(event) => setRecipe(material.index, { uvRotation: Number(event.currentTarget.value) })} /></label>
                        <label>rim <input type="number" min="0" max="1" step="0.05" value={recipe.rim} onChange={(event) => setRecipe(material.index, { rim: Number(event.currentTarget.value) })} /></label>
                        <label>scan <input type="number" min="0" max="1" step="0.05" value={recipe.scan} onChange={(event) => setRecipe(material.index, { scan: Number(event.currentTarget.value) })} /></label>
                        <label>bands <input type="number" min="0" max="1" step="0.05" value={recipe.bands} onChange={(event) => setRecipe(material.index, { bands: Number(event.currentTarget.value) })} /></label>
                      </div>

                      <span className="model-publish">
                        {MODEL_MATERIAL_PROPERTIES.map((property) => {
                          const target = { kind: 'material' as const, material: material.index, property };
                          const published = draft.bindings.some((binding) => bindingTargetKey(binding.target) === bindingTargetKey(target));
                          return <button
                            type="button"
                            key={property}
                            disabled={published}
                            onClick={() => publish(target, `${material.name} ${property}`, 'materials', materialRange(material, property, mapping))}
                          >{published ? 'published · ' : 'publish · '}{property}</button>;
                        })}
                      </span>
                    </div>
                  );
                })}
              </details>

              {draftLighting && (
                <details className="model-inspector model-lighting" open>
                  <summary>reusable lighting rig</summary>
                  <div className="model-lighting-head">
                    <label className="model-field">
                      <span>starting rig</span>
                      <select
                        value={draftLighting.preset}
                        onChange={(event) => chooseLightingPreset(event.currentTarget.value as ModelLightingPreset)}
                      >
                        {MODEL_LIGHTING_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                      </select>
                    </label>
                    <p>Up to {MAX_MODEL_LIGHTS} direct lights, one bounded shadow, plus a palette-aware HDR environment.</p>
                  </div>

                  <div className="model-environment">
                    <b>environment</b>
                    <label>strength <input
                      type="number" min="0" max="8" step="0.05"
                      value={draftLighting.environment.intensity}
                      onChange={(event) => changeLighting((lighting) => ({
                        ...lighting,
                        preset: 'custom',
                        environment: { ...lighting.environment, intensity: Number(event.currentTarget.value) },
                      }))}
                    /></label>
                    <label>rotation <input
                      type="number" step="0.05"
                      value={draftLighting.environment.rotation}
                      onChange={(event) => changeLighting((lighting) => ({
                        ...lighting,
                        preset: 'custom',
                        environment: { ...lighting.environment, rotation: Number(event.currentTarget.value) },
                      }))}
                    /></label>
                    <label>top <select
                      value={draftLighting.environment.top}
                      onChange={(event) => changeLighting((lighting) => ({
                        ...lighting,
                        preset: 'custom',
                        environment: { ...lighting.environment, top: event.currentTarget.value as ModelLightSetup['source'] },
                      }))}
                    >{MODEL_LIGHT_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                    <label>bottom <select
                      value={draftLighting.environment.bottom}
                      onChange={(event) => changeLighting((lighting) => ({
                        ...lighting,
                        preset: 'custom',
                        environment: { ...lighting.environment, bottom: event.currentTarget.value as ModelLightSetup['source'] },
                      }))}
                    >{MODEL_LIGHT_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                    <span className="model-publish">
                      <button type="button" onClick={() => publish(
                        { kind: 'environment', property: 'intensity' },
                        'Environment strength',
                        'lighting',
                        [0, 8, draftLighting.environment.intensity / 8],
                      )}>publish strength</button>
                      <button type="button" onClick={() => publish(
                        { kind: 'environment', property: 'rotation' },
                        'Environment rotation',
                        'lighting',
                        [-Math.PI, Math.PI, normalized(draftLighting.environment.rotation, -Math.PI, Math.PI)],
                      )}>publish rotation</button>
                    </span>
                    {draftLighting.environment.top === 'authored' && (
                      <div className="model-vector"><span>top RGB</span>{draftLighting.environment.topColor.map((value, axis) => <input key={axis} type="number" min="0" max="16" step="0.05" value={value} aria-label={`Environment top color ${'xyz'[axis]}`} onChange={(event) => setEnvironmentColor('topColor', axis, Number(event.currentTarget.value))} />)}</div>
                    )}
                    {draftLighting.environment.bottom === 'authored' && (
                      <div className="model-vector"><span>bottom RGB</span>{draftLighting.environment.bottomColor.map((value, axis) => <input key={axis} type="number" min="0" max="16" step="0.05" value={value} aria-label={`Environment bottom color ${'xyz'[axis]}`} onChange={(event) => setEnvironmentColor('bottomColor', axis, Number(event.currentTarget.value))} />)}</div>
                    )}
                  </div>

                  <div className="model-lights">
                    {draftLighting.lights.map((light) => (
                      <div className="model-light-card" key={light.id}>
                        <div className="model-light-title">
                          <label><input type="checkbox" checked={light.enabled} onChange={(event) => updateLight(light.id, { enabled: event.currentTarget.checked })} /> enabled</label>
                          <input aria-label={`${light.id} light label`} value={light.label} onChange={(event) => updateLight(light.id, { label: event.currentTarget.value })} />
                          <code>{light.id}</code>
                          <button type="button" onClick={() => removeLight(light.id)}>remove</button>
                        </div>
                        <div className="model-light-fields">
                          <label>type <select value={light.type} onChange={(event) => {
                            const type = event.currentTarget.value as ModelLightSetup['type'];
                            updateLight(light.id, { type, shadow: type === 'point' ? false : light.shadow });
                          }}>{MODEL_LIGHT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
                          <label>space <select value={light.space} onChange={(event) => updateLight(light.id, { space: event.currentTarget.value as ModelLightSetup['space'] })}>{MODEL_LIGHT_SPACES.map((space) => <option key={space}>{space}</option>)}</select></label>
                          <label>colour <select value={light.source} onChange={(event) => updateLight(light.id, { source: event.currentTarget.value as ModelLightSetup['source'] })}>{MODEL_LIGHT_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                          <label>strength <input type="number" min="0" max="64" step="0.1" value={light.intensity} onChange={(event) => updateLight(light.id, { intensity: Number(event.currentTarget.value) })} /></label>
                          <label>range <input type="number" min="0.01" max="64" step="0.1" value={light.range} onChange={(event) => updateLight(light.id, { range: Number(event.currentTarget.value) })} /></label>
                          <label>softness <input type="number" min="0" max="4" step="0.1" value={light.softness} onChange={(event) => updateLight(light.id, { softness: Number(event.currentTarget.value) })} /></label>
                        </div>
                        {light.source === 'authored' && (
                          <div className="model-vector"><span>linear RGB</span>{light.color.map((value, axis) => <input key={axis} type="number" min="0" max="16" step="0.05" value={value} aria-label={`${light.label} color ${'xyz'[axis]}`} onChange={(event) => setLightVector(light.id, 'color', axis, Number(event.currentTarget.value))} />)}</div>
                        )}
                        <div className="model-vector"><span>position</span>{light.position.map((value, axis) => <input key={axis} type="number" step="0.1" value={value} aria-label={`${light.label} position ${'xyz'[axis]}`} onChange={(event) => setLightVector(light.id, 'position', axis, Number(event.currentTarget.value))} />)}</div>
                        <div className="model-vector"><span>aim</span>{light.target.map((value, axis) => <input key={axis} type="number" step="0.1" value={value} aria-label={`${light.label} target ${'xyz'[axis]}`} onChange={(event) => setLightVector(light.id, 'target', axis, Number(event.currentTarget.value))} />)}</div>
                        {light.type === 'spot' && <div className="model-light-fields cones">
                          <label>inner cone <input type="number" min="0" max="1.56" step="0.01" value={light.innerConeAngle} onChange={(event) => updateLight(light.id, { innerConeAngle: Number(event.currentTarget.value) })} /></label>
                          <label>outer cone <input type="number" min="0.01" max="1.57" step="0.01" value={light.outerConeAngle} onChange={(event) => updateLight(light.id, { outerConeAngle: Number(event.currentTarget.value) })} /></label>
                        </div>}
                        <div className="model-light-footer">
                          <label><input type="checkbox" disabled={light.type === 'point'} checked={light.shadow} onChange={(event) => setShadow(light.id, event.currentTarget.checked)} /> shadow caster</label>
                          <span className="model-publish">
                            <button type="button" onClick={() => publish(
                              { kind: 'light', light: light.id, property: 'intensity' },
                              `${light.label} strength`,
                              'lighting',
                              [0, Math.max(8, light.intensity * 2), light.intensity / Math.max(8, light.intensity * 2)],
                            )}>publish strength</button>
                            {(['x', 'y', 'z'] as const).map((axis, index) => <button
                              type="button"
                              key={axis}
                              onClick={() => publish(
                                { kind: 'light', light: light.id, property: `position-${axis}` },
                                `${light.label} position ${axis.toUpperCase()}`,
                                'lighting',
                                [-4, 4, normalized(light.position[index], -4, 4)],
                              )}
                            >publish P{axis.toUpperCase()}</button>)}
                            {(['x', 'y', 'z'] as const).map((axis, index) => <button
                              type="button"
                              key={`target-${axis}`}
                              onClick={() => publish(
                                { kind: 'light', light: light.id, property: `target-${axis}` },
                                `${light.label} aim ${axis.toUpperCase()}`,
                                'lighting',
                                [-4, 4, normalized(light.target[index], -4, 4)],
                              )}
                            >publish A{axis.toUpperCase()}</button>)}
                            {light.type !== 'directional' && <button type="button" onClick={() => publish(
                              { kind: 'light', light: light.id, property: 'range' },
                              `${light.label} range`,
                              'lighting',
                              [0.1, Math.max(16, light.range * 2), normalized(light.range, 0.1, Math.max(16, light.range * 2))],
                            )}>publish range</button>}
                            {light.type === 'spot' && <>
                              <button type="button" onClick={() => publish(
                                { kind: 'light', light: light.id, property: 'inner-cone' },
                                `${light.label} inner cone`,
                                'lighting',
                                [0, Math.PI / 2, normalized(light.innerConeAngle, 0, Math.PI / 2)],
                              )}>publish inner</button>
                              <button type="button" onClick={() => publish(
                                { kind: 'light', light: light.id, property: 'outer-cone' },
                                `${light.label} outer cone`,
                                'lighting',
                                [0.01, Math.PI / 2, normalized(light.outerConeAngle, 0.01, Math.PI / 2)],
                              )}>publish outer</button>
                            </>}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button tone="quiet" disabled={draftLighting.lights.length >= MAX_MODEL_LIGHTS} onPress={() => addLight()}>
                    add light
                  </Button>
                </details>
              )}

              <details className="model-inspector">
                <summary>cameras & embedded GLB lights</summary>
                <label className="model-field">
                  <span>camera</span>
                  <select value={draft.camera ?? -1} onChange={(event) => setDraft({ ...draft, camera: Number(event.target.value) < 0 ? null : Number(event.target.value) })}>
                    <option value={-1}>automatic framing</option>
                    {asset.capabilities.cameras.map((camera) => <option key={camera.index} value={camera.index}>{camera.name} · {camera.type} · near {camera.znear}</option>)}
                  </select>
                </label>
                {asset.capabilities.lights.length === 0 && <p>no embedded lights</p>}
                {asset.capabilities.lights.map((light) => {
                  const node = asset.capabilities.nodes.find((entry) => entry.light === light.index);
                  const position = node ? transformOf(node).translation.map((value) => Math.max(-4, Math.min(4, value))) : [1.5, 1, 2];
                  return <div className="model-capability" key={light.index}>
                    <span>{light.name}<small>{light.type} · strength {light.intensity} · colour {light.color.map((value) => value.toFixed(2)).join(', ')}</small></span>
                    <button
                      type="button"
                      disabled={draftLighting?.lights.length === MAX_MODEL_LIGHTS}
                      onClick={() => addLight({
                        id: slug(light.name),
                        label: light.name,
                        type: light.type,
                        space: 'model',
                        source: 'authored',
                        color: light.color,
                        enabled: true,
                        intensity: Math.min(64, light.intensity),
                        position: position as [number, number, number],
                        target: [0, 0, 0],
                        range: Math.min(64, light.range ?? 6),
                        innerConeAngle: light.innerConeAngle,
                        outerConeAngle: light.outerConeAngle,
                        shadow: false,
                        softness: 1,
                      })}
                    >adopt into rig</button>
                  </div>;
                })}
              </details>

              <div className="model-bindings">
                <h5>published inlets</h5>
                {draft.bindings.length === 0 && <p>Publish selected properties above. Bones stay in the inspector until chosen.</p>}
                {draft.bindings.map((binding) => (
                  <div className="model-binding" key={binding.id}>
                    <code>{binding.id}</code>
                    <input value={binding.label} aria-label={`${binding.id} display name`} onChange={(event) => updateBinding(binding.id, { label: event.target.value })} />
                    <input value={binding.group} aria-label={`${binding.id} group`} placeholder="group" onChange={(event) => updateBinding(binding.id, { group: event.target.value })} />
                    <label>min <input type="number" value={binding.min} step="0.01" onChange={(event) => updateBinding(binding.id, { min: Number(event.target.value) })} /></label>
                    <label>max <input type="number" value={binding.max} step="0.01" onChange={(event) => updateBinding(binding.id, { max: Number(event.target.value) })} /></label>
                    <label>start <input type="number" value={binding.default} min="0" max="1" step="0.01" onChange={(event) => updateBinding(binding.id, { default: Number(event.target.value) })} /></label>
                    <Button tone="quiet" label={`Remove ${binding.label}`} onPress={() => setDraft({ ...draft, bindings: draft.bindings.filter((entry) => entry.id !== binding.id) })}>×</Button>
                  </div>
                ))}
              </div>

              <div className="model-actions">
                <Button
                  disabled={!MODEL_SETUP_ID.test(draft.id) || !draft.name.trim()}
                  onPress={() => {
                    onSave(draft);
                    setSavedId(draft.id);
                  }}
                >save setup</Button>
                <Button tone="quiet" onPress={() => { setDraft(null); setSavedId(null); }}>close</Button>
              </div>

              {saved && library.assets.length > 1 && (
                <details className="model-inspector revision">
                  <summary>reconcile an asset revision</summary>
                  <p>The old GLB remains immutable. Choose another imported GLB and decide every stable inlet before accepting.</p>
                  <select value={revisionHash} onChange={(event) => setRevisionHash(event.target.value)}>
                    <option value="">choose replacement</option>
                    {library.assets.filter((entry) => entry.hash !== saved.assetHash).map((entry) => (
                      <option key={entry.hash} value={entry.hash}>{entry.name} · {entry.hash.slice(0, 10)}</option>
                    ))}
                  </select>
                  {preview && revision && preview.map(({ binding }) => (
                    <label className="model-field" key={binding.id}>
                      <span>{binding.label} · <code>{binding.id}</code></span>
                      <select
                        value={reconciled[binding.id] ? bindingTargetKey(reconciled[binding.id]) : ''}
                        onChange={(event) => {
                          const target = candidateMap.get(event.target.value);
                          setReconciled((held) => {
                            const next = { ...held };
                            if (target) next[binding.id] = target;
                            else delete next[binding.id];
                            return next;
                          });
                        }}
                      >
                        <option value="">missing — choose</option>
                        {candidates.map((target) => (
                          <option key={bindingTargetKey(target)} value={bindingTargetKey(target)}>{targetLabel(target, revision)}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {preview && revision && saved.materials.map((mapping) => {
                    const oldName = asset.capabilities.materials[mapping.material]?.name ?? `material ${mapping.material}`;
                    const chosen = materialReconciled[String(mapping.material)];
                    return (
                      <label className="model-field" key={`material-${mapping.material}`}>
                        <span>{oldName} · {mapping.source}</span>
                        <select
                          value={chosen ?? ''}
                          onChange={(event) => setMaterialReconciled((held) => ({
                            ...held,
                            [String(mapping.material)]: event.target.value === '' ? null : Number(event.target.value),
                          }))}
                        >
                          <option value="">explicitly unmap</option>
                          {revision.capabilities.materials.map((material) => (
                            <option key={material.index} value={material.index}>{material.name}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                  {preview && revision && (
                    <label className="model-field">
                      <span>camera after revision</span>
                      <select
                        value={revisionCamera ?? -1}
                        onChange={(event) => setRevisionCamera(Number(event.target.value) < 0 ? null : Number(event.target.value))}
                      >
                        <option value={-1}>automatic framing</option>
                        {revision.capabilities.cameras.map((camera) => (
                          <option key={camera.index} value={camera.index}>{camera.name} · {camera.type}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {preview && (
                    <Button
                      disabled={
                        Object.keys(reconciled).length !== saved.bindings.length ||
                        Object.keys(materialReconciled).length !== saved.materials.length
                      }
                      onPress={() => onReconcile(saved.id, revisionHash, {
                        targets: reconciled,
                        materials: materialReconciled,
                        camera: revisionCamera,
                      })}
                    >accept revision</Button>
                  )}
                </details>
              )}
            </div>
          )}
      </main>
    </section>
  );
}
