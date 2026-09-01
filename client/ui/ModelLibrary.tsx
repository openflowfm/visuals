import { useEffect, useMemo, useRef, useState } from 'react';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Scheme } from '../../protocol.ts';
import './models.css';
import {
  MODEL_SETUP_ID,
  bindingTargetKey,
  reconcileBindings,
  type ModelAsset,
  type ModelBinding,
  type ModelBindingTarget,
  type ModelLibrary,
  type ModelMaterialMapping,
  type ModelNodeCapability,
  type ModelPaletteSource,
  type ModelRevisionDecision,
  type ModelSetup,
  type ModelSetupDraft,
} from '../../model.ts';

const SOURCES: ModelPaletteSource[] = [
  'color-a', 'color-b', 'primary', 'secondary', 'complement', 'accent', 'chalk', 'original',
];

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
  return `${asset.capabilities.materials[target.material]?.name ?? `material ${target.material}`} · ${target.property}`;
}

function allTargets(asset: ModelAsset): ModelBindingTarget[] {
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
      (['metallic', 'roughness', 'opacity', 'emissive-strength'] as const).map((property) => ({
        kind: 'material' as const,
        material: material.index,
        property,
      })),
    ),
  ];
}

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
    camera: asset.capabilities.cameras.length ? 0 : null,
  };
}

function asDraft(setup: ModelSetup): ModelSetupDraft {
  return {
    id: setup.id,
    name: setup.name,
    assetHash: setup.assetHash,
    bindings: setup.bindings.map((binding) => ({ ...binding, target: { ...binding.target } })),
    materials: setup.materials.map((mapping) => ({ ...mapping })),
    camera: setup.camera,
  };
}

export function ModelLibraryView({
  library,
  scheme,
  onImport,
  onSave,
  onReconcile,
}: {
  library: ModelLibrary;
  scheme: Scheme;
  onImport(file: File): Promise<void>;
  onSave(setup: ModelSetupDraft): void;
  onReconcile(setupId: string, assetHash: string, decision: ModelRevisionDecision): void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ModelSetupDraft | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [revisionHash, setRevisionHash] = useState('');
  const [reconciled, setReconciled] = useState<Record<string, ModelBindingTarget>>({});
  const [materialReconciled, setMaterialReconciled] = useState<Record<string, number | null>>({});
  const [revisionCamera, setRevisionCamera] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const asset = draft ? library.assets.find((entry) => entry.hash === draft.assetHash) ?? null : null;
  const saved = savedId ? library.setups.find((entry) => entry.id === savedId) ?? null : null;
  const revision = library.assets.find((entry) => entry.hash === revisionHash) ?? null;
  const preview = saved && revision ? reconcileBindings(saved, revision.capabilities) : null;
  const candidates = useMemo(() => revision ? allTargets(revision) : [], [revision]);
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
    setRevisionHash('');
  };

  const start = (picked = library.assets[0]) => {
    if (!picked) return;
    setSavedId(null);
    setDraft(draftFor(picked));
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

  return (
    <section className="model-workspace">
      <aside className="model-catalog">
        <div className="model-catalog-head">
          <span className="model-eyebrow">model library</span>
          <h2>Reusable GLB setups</h2>
          <p>Import inert model bytes once, then publish only the controls a flow should see.</p>
          <div className="model-actions">
            <Button tone="quiet" onPress={() => input.current?.click()}>import GLB</Button>
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

              <details className="model-inspector" open>
                <summary>materials & palette mapping</summary>
                {asset.capabilities.materials.map((material) => {
                  const mapping = draft.materials.find((entry) => entry.material === material.index) ?? {
                    material: material.index, source: 'original' as const, amount: 1,
                  };
                  return (
                    <div className="model-material" key={material.index}>
                      <b>{material.name}<small> base {material.baseColor.map((value) => value.toFixed(2)).join(', ')} · metal {material.metallic.toFixed(2)} · rough {material.roughness.toFixed(2)} · {material.alphaMode}</small></b>
                      <select value={mapping.source} onChange={(event) => setMaterial(material.index, { source: event.target.value as ModelPaletteSource })}>
                        {SOURCES.map((source) => <option key={source}>{source}</option>)}
                      </select>
                      <input
                        type="range" min="0" max="1" step="0.01" value={mapping.amount}
                        aria-label={`${material.name} mapping amount`}
                        onChange={(event) => setMaterial(material.index, { amount: Number(event.target.value) })}
                      />
                      <span className="model-publish">
                        {(['metallic', 'roughness', 'opacity', 'emissive-strength'] as const).map((property) => (
                          <button
                            type="button"
                            key={property}
                            onClick={() => publish(
                              { kind: 'material', material: material.index, property },
                              `${material.name} ${property}`,
                              'materials',
                              property === 'emissive-strength'
                                ? [0, Math.max(8, material.emissiveStrength * 2), material.emissiveStrength / Math.max(8, material.emissiveStrength * 2)]
                                : [0, 1, property === 'metallic'
                                  ? material.metallic
                                  : property === 'roughness'
                                    ? material.roughness
                                    : material.baseColor[3]],
                            )}
                          >{property}</button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </details>

              <details className="model-inspector">
                <summary>cameras & lights</summary>
                <label className="model-field">
                  <span>camera</span>
                  <select value={draft.camera ?? -1} onChange={(event) => setDraft({ ...draft, camera: Number(event.target.value) < 0 ? null : Number(event.target.value) })}>
                    <option value={-1}>automatic framing</option>
                    {asset.capabilities.cameras.map((camera) => <option key={camera.index} value={camera.index}>{camera.name} · {camera.type} · near {camera.znear}</option>)}
                  </select>
                </label>
                {asset.capabilities.lights.map((light) => <p key={light.index}>{light.name} · {light.type} · intensity {light.intensity} · colour {light.color.map((value) => value.toFixed(2)).join(', ')}</p>)}
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
