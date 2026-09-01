# Models

`model.ts`, `server/models.ts`, `client/ui/ModelLibrary.tsx`,
`client/nodes/model/`, `client/render/model.ts`. Importing binary glTF, turning discovered
facts into reusable OpenFlow setups, and rendering setup instances as graph colours.

## The GLB is evidence, not configuration

An ordinary `.glb` is enough. OpenFlow requires no manifest and reads no hand-written sidecar.
Import stores the exact bytes at
`~/.openflow/visuals/models/assets/<sha256>.glb`; the hash, rather than the original filename,
is its address. A derived JSON capability record sits beside it and can be rebuilt from the
bytes. Importing the same bytes under another name reuses that asset, and any number of setups
may refer to it.

The three ownership layers deliberately do not collapse:

| layer | owns | changes when |
|---|---|---|
| immutable asset | content-addressed GLB bytes and derived capabilities | different bytes are imported |
| reusable setup | display name, selected published bindings, domains, material palette mappings, camera | the setup is edited or explicitly reconciled |
| flow instance | setup id/revision snapshot, held values, modulation depths and cords | that flow is edited |

A filename is informational, a setup id is reusable configuration, and a binding id is a
graph address. Treating any two as the same would either duplicate large assets, make one
setup per flow, or cut cords on a rename.

`OPENFLOW_VISUALS_MODELS` moves the model root independently. `OPENFLOW_HOME` moves the whole
user library as usual.

## Inspection is bounded and inert

`inspectGlb` parses the GLB 2.0 container and its JSON without executing content or resolving a
URI. It reports scenes and roots; node paths, hierarchy and matrix/TRS transforms; meshes,
primitive modes, attributes and counts; named morph targets; skins, skeletons and joints;
named animation clips, channels, interpolation, key counts and duration; material factors;
cameras; and `KHR_lights_punctual` lights. Those are the facts shown in **Build → Models**.

The import boundary accepts at most 128 MiB, at most 8 MiB of JSON, 4,096 nodes or members in
the major collections, 16,384 primitives, and 16,384 animation channels. It rejects malformed
headers, lengths and glTF versions. Library paths accept only safe hashes/setup ids and ordinary
files; symlinks, traversal and absolute asset addresses do not cross the HTTP boundary. The
renderer accepts the imported blob itself and blocks external GLB resource URLs, preserving the
stage rule that nothing is fetched from a CDN. Warnings make unsupported external references
visible instead of silently following them.

## A setup publishes a small, stable surface

The inspector can publish any chosen translation, rotation or scale component; named morph;
animation clip; or metallic, roughness, opacity or emissive-strength material property. A
setup may publish at most 48 controls. This is an authoring ceiling and a faceplate decision:
skins and all of their joints remain inspectable without dumping every bone into the graph.

Every binding has two different names:

- `id` is the stable lower-case address stored in cords, instance values and modulation depths;
- `label` is the display name a person may change at any time.

The graph value is always normalized from zero to one. `min` and `max` map it to the target's
useful domain, and `default` is the normalized starting position. Renaming a label keeps the
id, so setup synchronization updates the face without touching cords. Removing a published
binding explicitly prunes only that id's stale values, depths and incoming cords.

Every `model` source always has `p`, `color-a` and `color-b` inlets before the setup's dynamic
number inlets. Unwired colours use the active colourway's primary and secondary roles. Each GLB
material maps independently to either inlet, another colourway role, its authored colour, or a
blend between the authored light structure and the selected source. A cord into `color-a` or
`color-b` is therefore external graph control, while the same setup still follows the show
palette when those inlets are left alone.

## Revisions are reconciliation, not replacement

Importing revised bytes creates another immutable asset. Editing a setup cannot point it at
that hash directly. **Reconcile asset revision** previews name/path matches and requires an
explicit decision for every published binding, every material mapping, and the selected or
automatic camera. Only then does the setup move to the new asset.

Bindings retain their ids through reconciliation, including a deliberate remap to a differently
named target. That keeps compatible instance values, depths and cords. A target which no longer
exists cannot be waved through as a stale index; the author must select another discovered
target. Material mappings may be explicitly dropped, and the camera may explicitly return to
automatic framing.

## The renderer rejoins the ordinary colour graph

The compiler flattens nested flows, allocates only reachable models, and refuses more than two
instances in one expanded flow. Each instance loads the immutable local GLB, clones its scene
(including skeleton ownership), applies its normalized setup/instance controls, samples
animation clips, and rasterizes the scene with depth into a multi-render target. The current
bounded pass supports node transforms, four morph targets per geometry, skins up to 64 bones,
authored PBR factors and opacity, the setup's camera or automatic framing. Imported lights are
inspected; the pass presently uses one stable stage key/rim treatment so an exporter's lighting
rig cannot make a show setup unpredictably black.

The target is HDR `RGBA16F` where WebGL2 exposes float colour rendering, with an `RGBA8`
fallback, two colour attachments for authored base plus `color-a`/`color-b` masks, and a 24-bit
depth buffer. Its longest edge is capped at 1280 independently of the projector. The flow shader
samples those textures as one premultiplied colour source, so downstream lenses, grades,
spreads, blends, feedback, nested flows and the output stage use their existing paths unchanged.

Leaving the flow aborts outstanding loads and releases scene clones, geometry buffers, textures,
framebuffers and depth renderbuffers. Context loss clears the same bank and restore constructs a
new one. Missing, invalid or still-loading models draw transparent and report a visible renderer
error; they do not take the rest of the graph down.

## The Xenon 60 proof

`visuals/assets/models/xenon-60.glb` is a metadata-free proof asset with twelve separately named,
equal-radius capsule-meridian nodes and materials, a named animation, camera and light. Generate
it, or install the complete reusable setup and two-instance scheme:

```sh
npm --prefix visuals run model:xenon
npm --prefix visuals run model:proof -- --install
npm run visuals
```

The install command is additive: it writes the `xenon-60-model-proof` setup and scheme in the
normal user library without changing the open-scheme pointer. Choose that scheme in **Set**.
For isolated headless evidence, omit `--install`; it writes under
`/private/tmp/openflow-xenon-model-proof`, then accepts the ordinary harnesses:

```sh
npm run frames -- --scheme=/private/tmp/openflow-xenon-model-proof/scheme.json \
  --models=/private/tmp/openflow-xenon-model-proof/models \
  --flows=xenon-60-a,xenon-60-proof --at=0,0.5,1,1.5,2,2.5,3,3.5
```

Both frames and the unpaced benchmark use hidden, non-focusable Electron windows. Their reports
include model loading and resource counts, so the proof covers completed rendering and release as
well as pixels. `tools/structure-compare.ts` adds projection/contour distance, silhouette overlap,
holes/endpoints/junction topology, material-layout difference, cyclic motion and topology
persistence; global luma or darkness is not accepted as fidelity evidence.
