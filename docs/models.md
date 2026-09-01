# Models

`model.ts`, `server/models.ts`, `client/ui/ModelLibrary.tsx`,
`client/ui/ModelSetupPreview.tsx`, `client/ui/models.css`,
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
| immutable asset | content-addressed GLB bytes, the images, samplers and textures embedded in them, derived capabilities; and any separately imported local texture, content-addressed the same way | different bytes are imported |
| reusable setup | display name, selected published bindings, domains, material palette mappings and recipes, camera and lighting rig | the setup is edited or explicitly reconciled |
| flow instance | setup id/revision snapshot, held values, modulation depths and cords | that flow is edited |

A local texture override is an asset, not a setting: import stores its bytes at
`~/.openflow/visuals/models/textures/<sha256>.<png|jpg>` beside a small record, and a recipe
refers to it by hash. No image bytes ever sit inside a setup or a flow. The derived capability
record beside a GLB carries an inspector version; a record written by an older inspector is
rebuilt from its bytes the first time the library reads it, so an asset imported before texture
inspection existed shows its textures without being imported again.

A filename is informational, a setup id is reusable configuration, and a binding id is a
graph address. Treating any two as the same would either duplicate large assets, make one
setup per flow, or cut cords on a rename.

`OPENFLOW_VISUALS_MODELS` moves the model root independently. `OPENFLOW_HOME` moves the whole
user library as usual.

## Models is a library workspace

Model authoring is a first-class **Models** view beside Build, Train, Review and Set. Its left
side is a searchable catalog with reusable setups and immutable GLBs deliberately shown as two
collections. Setup rows report their published inlet count and how many direct flow instances
currently select them; asset rows report capability/byte counts and how many setups reuse those
bytes. Selecting an asset starts a new setup without mutating an existing one. Selecting a setup
opens the wide capability editor, material mapper, published-inlet face and revision reconciler.

The editor begins with a live preview of the selected setup or unsaved working copy. It is not
a second Three renderer: a private one-node `model → out` flow runs through the same compositor,
bounded HDR/depth model pass and output stage used by Build and the wall. It reads the current
colourway and the setup's normalized starting values, so changing a material mapping, selected
camera, lighting rig, published range or `start` value is visible before save. Dragging orbits;
Shift-dragging, middle-dragging or right-dragging pans; the wheel zooms; and **reset view** returns
to the setup camera (or automatic framing when none is selected). A selector auditions any scheme colourway. Those viewing choices remain
local to the preview and do not overwrite the setup camera or active show; the private flow,
setup id and instance values never enter the user's scheme or model store.

Build no longer contains a model-library drawer. Its ordinary `model` node chooser consumes the
saved setups and owns only that flow instance's normalized values, depths and cords.

## Inspection is bounded and inert

`inspectGlb` parses the GLB 2.0 container and its JSON without executing content or resolving a
URI. It reports scenes and roots; node paths, hierarchy and matrix/TRS transforms; meshes,
primitive modes, attributes (so `TEXCOORD_0`, `TEXCOORD_1` and `TANGENT` are visible per
primitive) and counts; named morph targets; skins, skeletons and joints; named animation clips,
channels, interpolation, key counts and duration; material factors, alpha mode and cutoff,
double-sidedness and `KHR_materials_unlit`; every image, sampler and texture; which texture each
material's base colour, metallic/roughness, normal, occlusion and emissive slot reads, with its UV
set, `KHR_texture_transform` offset/scale/rotation and normal scale or occlusion strength; cameras;
`KHR_lights_punctual` lights; and every extension the file uses or requires, marked supported or
merely inspected. Those are the facts shown in **Models**.

**An image is measured before it is ever decoded.** The inspector reads only the PNG or JPEG
header of each embedded image and records its type and size. A picture larger than 4,096 pixels
on either edge, one whose declared type disagrees with its bytes, an unsupported type such as
WebP or KTX2, an unreadable header, an external URI, or an image past the 64-per-asset ceiling is
marked `unsupported` with the reason and never reaches a decoder. The per-asset decode budget is
256 MiB of RGBA with mips; images past it are marked the same way. The asset still imports and its
geometry still draws; the affected slot falls back to its flat factor and the warning says why.
The same header check guards imported local textures, which are capped at 32 MiB encoded.

The import boundary accepts at most 128 MiB, at most 8 MiB of JSON, 4,096 nodes or members in
the major collections, 16,384 primitives, and 16,384 animation channels. It rejects malformed
headers, lengths and glTF versions. Library paths accept only safe hashes/setup ids and ordinary
files; symlinks, traversal and absolute asset addresses do not cross the HTTP boundary. The
renderer accepts the imported blob itself and blocks external GLB resource URLs, preserving the
stage rule that nothing is fetched from a CDN. Warnings make unsupported external references
visible instead of silently following them. Thumbnails in **Models** are served as byte ranges of
the stored GLB (`/models/assets/<hash>/images/<index>`), only for images the inspector accepted.

## A setup publishes a small, stable surface

The inspector can publish any chosen translation, rotation or scale component; named morph;
animation clip; a material's metallic, roughness, opacity, emissive strength, normal strength,
occlusion strength, texture mix, UV scale, rotation or offset, or its rim, scan or bands amount;
selected light position, aim, strength, range or cone component; or environment strength and
rotation. A setup may publish at most 48 controls. This is an authoring ceiling and a faceplate
decision: skins and all of their joints remain inspectable without dumping every bone into the
graph, and the full material recipe stays in the editor while only the chosen numbers become
inlets.

## A material recipe is typed, bounded and never GLSL

Each material mapping may carry a **recipe**: for each of the five slots, whether it reads the
texture the GLB authored, nothing (the flat factor), or an imported local texture by hash; a
projection (`uv` or a bounded `triplanar`); a wrap override (authored, repeat, mirror, clamp); a
UV scale, offset and rotation composed over the authored `KHR_texture_transform`; a texture mix
between flat factor and full texture; normal and occlusion strength; and three curated effect
amounts, **rim** (a fresnel glow in the mapped colour), **scan** (moving bands) and **bands**
(quantised light, a printed look). Every field defaults to the authored look, so a mapping saved
before recipes existed still reads, and a recipe can gain a field without invalidating a setup.
A setup may reference at most eight local textures. Arbitrary shader text is deliberately not a
field: it would compile at stage time, escape every resource bound, and have no stable graph
contract.

The Models material laboratory is the product surface for that vocabulary. It shows every
accepted embedded image and every refusal reason, thumbnails each of the five slots beside its
UV set, and keeps separately imported PNG/JPEG overrides on the library shelf. Each slot chooses
authored, flat/none, or one immutable local texture; projection, wrap, transform, strengths and
the three curated effects update the production-compositor preview immediately. **Hold authored
look** feeds a neutral authored working copy to that preview without replacing the edited draft,
so releasing it restores the exact unsaved recipe. Publish buttons sit beside the numeric recipe
properties only and disable once that stable material/property target is already an inlet.

Lighting belongs to the reusable setup. **Studio**, **void** and **neon** are editable starting
rigs, not renderer modes; changing any field makes the rig custom. A rig contains an analytic
palette-aware HDR environment and at most four enabled directional, point or spot lights. Lights
may be camera-, world- or model-relative, may follow a colourway role or an authored linear RGB
colour, and at most one directional or spot light may cast the bounded shadow. A GLB's
`KHR_lights_punctual` entries remain inert discovered facts until **adopt into rig** is pressed,
so an exporter's accidental work light cannot make a performance setup black or unpredictable.
The adopted light receives a stable setup-owned id; its label may then change without cutting a
published cord.

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
authored PBR factors, all five core material maps, the setup's camera or automatic framing, GGX
direct lighting, and the analytic HDR environment. Base-colour and emissive pictures upload as
sRGB; metallic/roughness, normal and occlusion pictures remain linear data. The pass composes
`KHR_texture_transform` with the setup recipe, distinguishes UV0 and UV1, derives a tangent frame
when a normal map has no authored tangents, and falls back to the geometric normal when there is
no usable UV derivative. `OPAQUE`, `MASK` and sorted `BLEND` draws have deliberate depth-write
behavior, alpha cutoff and double-sided culling; `KHR_materials_unlit` bypasses lighting. Other
PBR lobes remain inspected but unsupported rather than silently approximated. Imported lights are
inspected and become active only when adopted into the reusable rig.

Image bytes are decoded at most four at a time and uploaded once per immutable picture and colour
interpretation. A shared cache lets two setups or instances over one GLB reuse that upload while
sampler objects carry each recipe's bounded wrap/filter choice separately. Five fixed material
units and one fixed shadow unit fit the WebGL2 guaranteed sixteen; a context which cannot supply
them draws the model transparent with a visible reason. The resource meter and hidden frame
harness report uploaded texture count, estimated decoded bytes, pending decodes and shared
acquisitions.

The target is HDR `RGBA16F` where WebGL2 exposes float colour rendering, with an `RGBA8`
fallback, two colour attachments for authored base plus `color-a`/`color-b` masks, and a 24-bit
depth buffer. One optional shadow caster uses one depth-only target capped at 768; point-light
cube shadows and unbounded per-light targets are deliberately absent. Its longest colour edge is
capped at 1280 independently of the projector. The flow shader
samples those textures as one premultiplied colour source, so downstream lenses, grades,
spreads, blends, feedback, nested flows and the output stage use their existing paths unchanged.

Leaving the flow aborts outstanding loads and releases scene clones, geometry buffers, colour and
shadow textures, framebuffers and depth renderbuffers. A shared image fetch survives one owner
leaving and is aborted only when its last owner leaves; a decode completing after that point is
closed without uploading or resurrecting a cache entry. Removing the caster releases its shadow
target on the next frame. Context loss clears the same bank and restore constructs a new one.
Missing, invalid or still-loading models draw transparent and report a visible renderer error;
they do not take the rest of the graph down.

The Models preview follows the same lifecycle: it exists only while a setup editor is mounted,
is capped by the compositor's 960-pixel preview edge, and releases its model and WebGL resources
on close or view change. Editing setup metadata updates the already loaded working instance; it
does not refetch and reparse the immutable GLB on every keystroke.

## A representative showcase

The recommended demo uses two assets from Khronos' curated glTF sample library rather than
presenting the synthetic capsule as the product's model vocabulary:

- **Fox** exposes one 24-joint skin and Survey, Walk and Run clips. The showcase makes separate
  Run and Survey setups over the same content-addressed GLB, proving one asset can support more
  than one performance face, then gives them distinct palette-driven light rigs in a kinetic duet.
- **Toy Car** exposes three material groups and eight authored cameras. Its setup publishes body
  rotation, glass presence, body shine, the optional display cloth and key-light strength, maps
  its parts and rig across the palette, modulates that published light from an LFO, and feeds the
  ordinary array, feedback, blend, bloom and grade graph path.

Install the assets, three setups and two-flow scheme explicitly:

```sh
npm --prefix visuals run model:showcase -- --install
npm run visuals
```

The authoring command downloads the upstream GLBs, verifies pinned SHA-256 digests, and imports
them through the same content-addressed store as the UI. That command is the only network step;
rendering reads the local immutable copies and remains stage-safe. Source credits and licenses
are recorded in `assets/models/SOURCES.md`. The install is additive and does not change which
scheme is open; choose **model showcase** from the scheme shelf, then switch between its two
flows in Build or Set.

For hidden frame evidence without touching the user library, omit `--install`, then run:

```sh
npm run frames -- --scheme=/private/tmp/openflow-model-showcase/scheme.json \
  --models=/private/tmp/openflow-model-showcase/models \
  --flows=model-fox-duet,model-toy-car --at=0,0.5,1,1.5,2,2.5,3,3.5
```

## The Xenon 60 regression proof

`visuals/assets/models/xenon-60.glb` remains a metadata-free structural regression asset with twelve separately named,
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
