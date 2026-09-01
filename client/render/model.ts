import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  MAX_MODEL_MORPHS,
  bindingDomainValue,
  type ModelBinding,
  type ModelLibrary,
  type ModelMaterialMapping,
  type ModelPaletteSource,
  type ModelSetup,
} from '../../model.ts';
import { portId, type CircuitModel } from './circuit.ts';
import type { NumberSample } from './evaluateNumber.ts';
import type { Program } from './gl.ts';

/** The model pass has a fixed fill-rate ceiling independent of projector size. */
export const MAX_MODEL_EDGE = 1280;
export const MAX_MODEL_BONES = 64;
export { MAX_MODEL_MORPHS };

export const modelAssetUrl = (hash: string): string => `/models/assets/${hash}.glb`;

interface ModelTarget {
  framebuffer: WebGLFramebuffer;
  base: WebGLTexture;
  mask: WebGLTexture;
  depth: WebGLRenderbuffer;
  width: number;
  height: number;
  resize(width: number, height: number): void;
  free(): void;
}

interface MeshProgram {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

interface GeometryResource {
  geometry: THREE.BufferGeometry;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexed: boolean;
  indexType: number;
  count: number;
  mode: number;
  morphs: number;
  skinned: boolean;
}

interface InitialTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  morphs: number[] | null;
}

interface Instance {
  key: string;
  setup: ModelSetup;
  target: ModelTarget;
  abort: AbortController;
  root: THREE.Group | null;
  animations: THREE.AnimationClip[];
  initial: Map<THREE.Object3D, InitialTransform>;
  nodes: Map<number, THREE.Object3D>;
  meshes: Map<number, THREE.Mesh[]>;
  materials: Map<number, THREE.Material[]>;
  geometry: Map<THREE.BufferGeometry, GeometryResource>;
  camera: THREE.Camera | null;
  autoCamera: THREE.PerspectiveCamera;
  trouble: string | null;
}

export interface ModelBank {
  /** Render every reachable model and bind its base/mask textures to the flow. */
  bind(
    program: Program,
    models: readonly CircuitModel[],
    library: ModelLibrary,
    sample: NumberSample,
    palette: readonly number[],
    width: number,
    height: number,
    scope?: string,
  ): void;
  clear(): void;
  readonly error: string | null;
  readonly resources: ModelResourceStats;
  free(): void;
}

export interface ModelResourceStats {
  instances: number;
  geometries: number;
  targets: number;
  /** Instances whose immutable bytes or GLTF parse have not completed yet. */
  loading: number;
}

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aMorph0;
layout(location=3) in vec3 aMorph1;
layout(location=4) in vec3 aMorph2;
layout(location=5) in vec3 aMorph3;
layout(location=6) in vec4 aSkinIndex;
layout(location=7) in vec4 aSkinWeight;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormal;
uniform mat4 uBind;
uniform mat4 uBindInverse;
uniform mat4 uBones[${MAX_MODEL_BONES}];
uniform vec4 uMorphWeights;
uniform float uSkinned;
out vec3 vNormal;
out vec3 vWorld;

void main() {
  vec3 p = aPosition
    + aMorph0 * uMorphWeights.x
    + aMorph1 * uMorphWeights.y
    + aMorph2 * uMorphWeights.z
    + aMorph3 * uMorphWeights.w;
  vec4 local = vec4(p, 1.0);
  if (uSkinned > 0.5) {
    mat4 skin =
      uBones[int(aSkinIndex.x)] * aSkinWeight.x +
      uBones[int(aSkinIndex.y)] * aSkinWeight.y +
      uBones[int(aSkinIndex.z)] * aSkinWeight.z +
      uBones[int(aSkinIndex.w)] * aSkinWeight.w;
    local = uBindInverse * skin * uBind * local;
  }
  vec4 world = uModel * local;
  vWorld = world.xyz;
  vNormal = normalize(uNormal * aNormal);
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
layout(location=0) out vec4 outBase;
layout(location=1) out vec4 outMask;

uniform vec4 uBaseColor;
uniform vec3 uEmissive;
uniform float uEmissiveStrength;
uniform float uMetallic;
uniform float uRoughness;
uniform float uOpacity;
uniform vec3 uPalette;
uniform float uMappingAmount;
uniform int uSource;

void main() {
  vec3 n = normalize(vNormal);
  vec3 key = normalize(vec3(-0.42, 0.76, 0.68));
  float diffuse = max(dot(n, key), 0.0);
  float rim = pow(1.0 - abs(n.z), mix(1.5, 5.0, uRoughness));
  float specular = pow(max(dot(reflect(-key, n), vec3(0.0, 0.0, 1.0)), 0.0), mix(48.0, 5.0, uRoughness));
  float authored = dot(uBaseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float emitted = dot(uEmissive, vec3(0.2126, 0.7152, 0.0722)) * uEmissiveStrength;
  float light = 0.12 + diffuse * 0.88 + rim * 0.32
    + specular * mix(0.28, 1.4, uMetallic) * mix(1.25, 0.18, uRoughness);
  light *= mix(1.0, 0.35 + authored, uMappingAmount);
  vec3 original = uBaseColor.rgb * light + uEmissive * uEmissiveStrength;
  float mappedLight = light + emitted;
  float alpha = clamp(uBaseColor.a * uOpacity, 0.0, 1.0);

  outBase = vec4(0.0);
  outMask = vec4(0.0);
  if (uSource == 1) {
    outBase = vec4(original * alpha * (1.0 - uMappingAmount), alpha * (1.0 - uMappingAmount));
    outMask = vec4(mappedLight * alpha * uMappingAmount, 0.0, 0.0, alpha * uMappingAmount);
  } else if (uSource == 2) {
    outBase = vec4(original * alpha * (1.0 - uMappingAmount), alpha * (1.0 - uMappingAmount));
    outMask = vec4(0.0, mappedLight * alpha * uMappingAmount, 0.0, alpha * uMappingAmount);
  } else {
    vec3 mapped = uPalette * light + uEmissive * uEmissiveStrength;
    vec3 chosen = uSource == 0 ? original : mix(original, mapped, uMappingAmount);
    outBase = vec4(chosen * alpha, alpha);
  }
}`;

function compileMesh(gl: WebGL2RenderingContext): MeshProgram {
  const shader = (kind: number, source: string) => {
    const made = gl.createShader(kind)!;
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) {
      const why = gl.getShaderInfoLog(made);
      gl.deleteShader(made);
      throw new Error(`model renderer: ${why}`);
    }
    return made;
  };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const why = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`model renderer: ${why}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    },
  };
}

function modelTarget(gl: WebGL2RenderingContext): ModelTarget {
  const framebuffer = gl.createFramebuffer()!;
  const base = gl.createTexture()!;
  const mask = gl.createTexture()!;
  const depth = gl.createRenderbuffer()!;
  const deep = gl.getExtension('EXT_color_buffer_float') !== null;
  let width = 0;
  let height = 0;

  const texture = (held: WebGLTexture, attachment: number, w: number, h: number) => {
    gl.bindTexture(gl.TEXTURE_2D, held);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      deep ? gl.RGBA16F : gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      deep ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, held, 0);
  };

  return {
    framebuffer,
    base,
    mask,
    depth,
    get width() { return width; },
    get height() { return height; },
    resize(w, h) {
      const scale = Math.min(1, MAX_MODEL_EDGE / Math.max(1, w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      if (w === width && h === height) return;
      width = w;
      height = h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      texture(base, gl.COLOR_ATTACHMENT0, w, h);
      texture(mask, gl.COLOR_ATTACHMENT1, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('model renderer could not allocate its HDR/depth target');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    free() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(base);
      gl.deleteTexture(mask);
      gl.deleteRenderbuffer(depth);
    },
  };
}

const typeOf = (array: THREE.TypedArray): number => {
  if (array instanceof Uint8Array) return WebGL2RenderingContext.UNSIGNED_BYTE;
  if (array instanceof Int8Array) return WebGL2RenderingContext.BYTE;
  if (array instanceof Uint16Array) return WebGL2RenderingContext.UNSIGNED_SHORT;
  if (array instanceof Int16Array) return WebGL2RenderingContext.SHORT;
  if (array instanceof Uint32Array) return WebGL2RenderingContext.UNSIGNED_INT;
  if (array instanceof Int32Array) return WebGL2RenderingContext.INT;
  return WebGL2RenderingContext.FLOAT;
};

function uploadGeometry(gl: WebGL2RenderingContext, geometry: THREE.BufferGeometry, skinned: boolean): GeometryResource {
  const vao = gl.createVertexArray()!;
  const buffers: WebGLBuffer[] = [];
  gl.bindVertexArray(vao);

  const attribute = (at: number, held: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, integer = false) => {
    if (!held) {
      gl.disableVertexAttribArray(at);
      if (at === 1) gl.vertexAttrib3f(at, 0, 0, 1);
      else if (at === 7) gl.vertexAttrib4f(at, 1, 0, 0, 0);
      else gl.vertexAttrib4f(at, 0, 0, 0, 0);
      return;
    }
    // GLTFLoader de-interleaves sparse accessors, but not every ordinary one.
    const interleaved = held instanceof THREE.InterleavedBufferAttribute;
    const source = interleaved
      ? new THREE.BufferAttribute(new (held.data.array.constructor as typeof Float32Array)(held.count * held.itemSize), held.itemSize, held.normalized)
      : held;
    if (interleaved) {
      for (let i = 0; i < held.count; i++) {
        for (let j = 0; j < held.itemSize; j++) source.setComponent(i, j, held.getComponent(i, j));
      }
    }
    const buffer = gl.createBuffer()!;
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, source.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(at);
    const type = typeOf(source.array);
    if (integer) gl.vertexAttribIPointer(at, source.itemSize, type, 0, 0);
    else gl.vertexAttribPointer(at, source.itemSize, type, source.normalized, 0, 0);
  };

  attribute(0, geometry.getAttribute('position'));
  attribute(1, geometry.getAttribute('normal'));
  const morphs = geometry.morphAttributes.position ?? [];
  for (let i = 0; i < MAX_MODEL_MORPHS; i++) attribute(2 + i, morphs[i]);
  // The shader accepts a vec4 and converts each component to an array index.
  // Feeding an integer attribute to that declaration is a WebGL type mismatch
  // on strict drivers, even though some desktop drivers quietly accept it.
  attribute(6, skinned ? geometry.getAttribute('skinIndex') : undefined);
  attribute(7, skinned ? geometry.getAttribute('skinWeight') : undefined);

  const index = geometry.getIndex();
  if (index) {
    const buffer = gl.createBuffer()!;
    buffers.push(buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index.array, gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  return {
    geometry,
    vao,
    buffers,
    indexed: !!index,
    indexType: index ? typeOf(index.array) : gl.UNSIGNED_SHORT,
    count: index?.count ?? geometry.getAttribute('position')?.count ?? 0,
    mode: gl.TRIANGLES,
    morphs: Math.min(MAX_MODEL_MORPHS, morphs.length),
    skinned,
  };
}

const sourceIndex = (source: ModelPaletteSource): number => ({
  original: 0,
  'color-a': 1,
  'color-b': 2,
  primary: 3,
  secondary: 4,
  complement: 5,
  accent: 6,
  chalk: 7,
})[source];

const paletteIndex = (source: ModelPaletteSource): number => ({
  primary: 0,
  secondary: 1,
  complement: 2,
  accent: 3,
  chalk: 4,
  original: 0,
  'color-a': 0,
  'color-b': 1,
})[source];

const rgb = (color: number): [number, number, number] => [
  ((color >> 16) & 0xff) / 255,
  ((color >> 8) & 0xff) / 255,
  (color & 0xff) / 255,
];

function materialArray(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function mapObjects(instance: Instance, asset: ModelLibrary['assets'][number], gltf: GLTF): void {
  if (!instance.root) return;
  const sourceObjects: THREE.Object3D[] = [];
  const objects: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  gltf.scene.traverse((object) => sourceObjects.push(object));
  instance.root.traverse((object) => {
    objects.push(object);
    instance.initial.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      morphs: object instanceof THREE.Mesh && object.morphTargetInfluences
        ? [...object.morphTargetInfluences] : null,
    });
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
      for (const material of materialArray(object.material)) if (!materials.includes(material)) materials.push(material);
    }
  });

  // Names are for people and need not be unique. GLTFLoader keeps the exact
  // glTF indices it associated with its source objects; SkeletonUtils preserves
  // traversal order in the clone, so carry those identities onto this instance
  // before using name/order only as a malformed-export fallback.
  for (let at = 0; at < Math.min(sourceObjects.length, objects.length); at++) {
    const source = sourceObjects[at];
    const object = objects[at];
    const association = gltf.parser.associations.get(source);
    if (association?.nodes !== undefined) instance.nodes.set(association.nodes, object);
    if (association?.meshes !== undefined && object instanceof THREE.Mesh) {
      const mapped = instance.meshes.get(association.meshes) ?? [];
      mapped.push(object);
      instance.meshes.set(association.meshes, mapped);
    }
    if (object instanceof THREE.Mesh) {
      for (const material of materialArray(object.material)) {
        const materialAssociation = gltf.parser.associations.get(material);
        if (materialAssociation?.materials === undefined) continue;
        const mapped = instance.materials.get(materialAssociation.materials) ?? [];
        if (!mapped.includes(material)) mapped.push(material);
        instance.materials.set(materialAssociation.materials, mapped);
      }
    }
  }
  for (const capability of asset.capabilities.nodes) {
    if (instance.nodes.has(capability.index)) continue;
    const named = objects.filter((object) => object.name === capability.name);
    const found = named[0] ?? objects[capability.index + 1] ?? objects[capability.index];
    if (found) instance.nodes.set(capability.index, found);
  }
  for (const capability of asset.capabilities.meshes) {
    if (instance.meshes.has(capability.index)) continue;
    const found = meshes.filter((mesh) =>
      mesh.name === capability.name || mesh.parent?.name === capability.name ||
      asset.capabilities.nodes.some((node) => node.mesh === capability.index && node.name === mesh.name),
    );
    instance.meshes.set(capability.index, found.length ? found : (meshes[capability.index] ? [meshes[capability.index]] : []));
  }
  for (const capability of asset.capabilities.materials) {
    if (instance.materials.has(capability.index)) continue;
    const found = materials.filter((material) => material.name === capability.name);
    instance.materials.set(capability.index, found.length ? found : (materials[capability.index] ? [materials[capability.index]] : []));
  }
  const cameraNode = instance.setup.camera === null
    ? undefined
    : asset.capabilities.nodes.find((node) => node.camera === instance.setup.camera);
  const selectedCamera = cameraNode ? instance.nodes.get(cameraNode.index) : undefined;
  instance.camera = selectedCamera instanceof THREE.Camera ? selectedCamera : null;

  const bounds = new THREE.Box3().setFromObject(instance.root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 1e-4 ? sphere.radius : 1;
  instance.autoCamera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + radius * 2.9);
  instance.autoCamera.near = Math.max(0.001, radius / 100);
  instance.autoCamera.far = radius * 20;
  instance.autoCamera.lookAt(sphere.center);
  instance.autoCamera.updateProjectionMatrix();
}

function resetInstance(instance: Instance): void {
  for (const [object, initial] of instance.initial) {
    object.position.copy(initial.position);
    object.quaternion.copy(initial.quaternion);
    object.scale.copy(initial.scale);
    if (object instanceof THREE.Mesh && object.morphTargetInfluences && initial.morphs) {
      object.morphTargetInfluences.splice(0, object.morphTargetInfluences.length, ...initial.morphs);
    }
  }
}

const axisOf = (property: string): 'x' | 'y' | 'z' => property.endsWith('-x') ? 'x' : property.endsWith('-y') ? 'y' : 'z';

function applyBindings(instance: Instance, model: CircuitModel, sample: NumberSample): Map<number, Partial<{
  metallic: number;
  roughness: number;
  opacity: number;
  emissiveStrength: number;
}>> {
  resetInstance(instance);
  const overrides = new Map<number, Partial<{ metallic: number; roughness: number; opacity: number; emissiveStrength: number }>>();
  const actions: THREE.AnimationAction[] = [];
  const mixer = instance.root && instance.animations.length ? new THREE.AnimationMixer(instance.root) : null;
  for (const binding of instance.setup.bindings) {
    const normalized = sample.inlet(portId(model.id, binding.id)) ?? binding.default;
    const value = bindingDomainValue(binding, normalized);
    const target = binding.target;
    if (target.kind === 'node-transform') {
      const object = instance.nodes.get(target.node);
      if (!object) continue;
      const axis = axisOf(target.property);
      if (target.property.startsWith('translation')) object.position[axis] = value;
      else if (target.property.startsWith('rotation')) object.rotation[axis] = value;
      else object.scale[axis] = value;
    } else if (target.kind === 'morph') {
      for (const mesh of instance.meshes.get(target.mesh) ?? []) {
        if (mesh.morphTargetInfluences?.[target.target] !== undefined) mesh.morphTargetInfluences[target.target] = value;
      }
    } else if (target.kind === 'animation' && mixer) {
      const clip = instance.animations[target.animation];
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.reset().play();
      action.paused = true;
      action.time = Math.max(0, Math.min(clip.duration, value));
      action.weight = 1;
      actions.push(action);
    } else if (target.kind === 'material') {
      const held = overrides.get(target.material) ?? {};
      if (target.property === 'emissive-strength') held.emissiveStrength = value;
      else held[target.property] = value;
      overrides.set(target.material, held);
    }
  }
  if (mixer) mixer.update(0);
  instance.root?.updateMatrixWorld(true);
  // Actions belong only to this one sampled frame; a fresh mixer next frame
  // avoids clips whose weights were removed continuing to affect the setup.
  for (const action of actions) action.stop();
  return overrides;
}

function materialFacts(material: THREE.Material): {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveStrength: number;
  metallic: number;
  roughness: number;
  opacity: number;
} {
  const standard = material as THREE.MeshStandardMaterial;
  return {
    color: standard.color?.clone() ?? new THREE.Color(1, 1, 1),
    emissive: standard.emissive?.clone() ?? new THREE.Color(0, 0, 0),
    emissiveStrength: Number.isFinite(standard.emissiveIntensity) ? standard.emissiveIntensity : 1,
    metallic: Number.isFinite(standard.metalness) ? standard.metalness : 0,
    roughness: Number.isFinite(standard.roughness) ? standard.roughness : 0.7,
    opacity: Number.isFinite(standard.opacity) ? standard.opacity : 1,
  };
}

export function createModelBank(gl: WebGL2RenderingContext): ModelBank {
  const held = new Map<number, Instance>();
  const meshProgram = compileMesh(gl);
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const freeInstance = (instance: Instance) => {
    instance.abort.abort();
    for (const resource of instance.geometry.values()) {
      gl.deleteVertexArray(resource.vao);
      for (const buffer of resource.buffers) gl.deleteBuffer(buffer);
    }
    instance.geometry.clear();
    instance.target.free();
    instance.root = null;
  };

  const make = (key: string, setup: ModelSetup, asset: ModelLibrary['assets'][number]): Instance => {
    const instance: Instance = {
      key,
      setup,
      target: modelTarget(gl),
      abort: new AbortController(),
      root: null,
      animations: [],
      initial: new Map(),
      nodes: new Map(),
      meshes: new Map(),
      materials: new Map(),
      geometry: new Map(),
      camera: null,
      autoCamera: new THREE.PerspectiveCamera(42, 1, 0.01, 1000),
      trouble: null,
    };
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      // A stored GLB is self-contained. Never turn an URI found inside user
      // bytes into a stage-time network dependency. Blob/data URLs are made by
      // GLTFLoader itself for embedded image buffer views and stay local.
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      throw new Error('external GLB resources are not loaded');
    });
    void fetch(modelAssetUrl(asset.hash), { signal: instance.abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => new Promise<GLTF>((resolve, reject) => {
        new GLTFLoader(manager).parse(bytes, '', resolve, reject);
      }))
      .then((gltf) => {
        if (instance.abort.signal.aborted) return;
        instance.root = cloneSkeleton(gltf.scene) as THREE.Group;
        instance.animations = gltf.animations;
        mapObjects(instance, asset, gltf);
        instance.trouble = null;
      })
      .catch((error: unknown) => {
        if (!instance.abort.signal.aborted) instance.trouble = `${asset.name}: ${(error as Error).message}`;
      });
    return instance;
  };

  const materialIndex = (instance: Instance, material: THREE.Material): number => {
    for (const [index, materials] of instance.materials) if (materials.includes(material)) return index;
    return -1;
  };

  const draw = (
    instance: Instance,
    model: CircuitModel,
    sample: NumberSample,
    palette: readonly number[],
    width: number,
    height: number,
  ) => {
    instance.target.resize(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, instance.target.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, instance.target.width, instance.target.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!instance.root) return;

    const overrides = applyBindings(instance, model, sample);
    const camera = instance.camera ?? instance.autoCamera;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = instance.target.width / instance.target.height;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const normal = new THREE.Matrix3();
    const mapping = new Map(instance.setup.materials.map((entry) => [entry.material, entry]));

    gl.useProgram(meshProgram.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(meshProgram.uniform('uViewProjection'), false, viewProjection.elements);

    instance.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const resource = instance.geometry.get(object.geometry) ?? uploadGeometry(gl, object.geometry, object instanceof THREE.SkinnedMesh);
      instance.geometry.set(object.geometry, resource);
      if (resource.count <= 0) return;
      const materials = materialArray(object.material);
      // glTF primitives normally arrive as one Mesh. Groups retain multi-material
      // geometry; drawing each group keeps that authored assignment intact.
      const groups = object.geometry.groups.length
        ? object.geometry.groups
        : [{ start: 0, count: resource.count, materialIndex: 0 }];
      gl.bindVertexArray(resource.vao);
      gl.uniformMatrix4fv(meshProgram.uniform('uModel'), false, object.matrixWorld.elements);
      normal.getNormalMatrix(object.matrixWorld);
      gl.uniformMatrix3fv(meshProgram.uniform('uNormal'), false, normal.elements);
      const influences = object.morphTargetInfluences ?? [];
      gl.uniform4f(meshProgram.uniform('uMorphWeights'), influences[0] ?? 0, influences[1] ?? 0, influences[2] ?? 0, influences[3] ?? 0);

      if (object instanceof THREE.SkinnedMesh && object.skeleton.bones.length > MAX_MODEL_BONES) {
        throw new Error(`skin ${object.name || 'mesh'} has more than ${MAX_MODEL_BONES} bones`);
      }
      if (object instanceof THREE.SkinnedMesh) {
        object.skeleton.update();
        gl.uniform1f(meshProgram.uniform('uSkinned'), 1);
        gl.uniformMatrix4fv(meshProgram.uniform('uBind'), false, object.bindMatrix.elements);
        gl.uniformMatrix4fv(meshProgram.uniform('uBindInverse'), false, object.bindMatrixInverse.elements);
        gl.uniformMatrix4fv(meshProgram.uniform('uBones[0]'), false, object.skeleton.boneMatrices);
      } else {
        gl.uniform1f(meshProgram.uniform('uSkinned'), 0);
      }

      for (const group of groups) {
        const material = materials[group.materialIndex] ?? materials[0];
        if (!material || !material.visible) continue;
        const index = materialIndex(instance, material);
        const mapped: ModelMaterialMapping = mapping.get(index) ?? { material: index, source: 'original', amount: 1 };
        const facts = materialFacts(material);
        const override = overrides.get(index) ?? {};
        const color = rgb(palette[paletteIndex(mapped.source)] ?? 0xffffff);
        gl.uniform4f(meshProgram.uniform('uBaseColor'), facts.color.r, facts.color.g, facts.color.b, 1);
        gl.uniform3f(meshProgram.uniform('uEmissive'), facts.emissive.r, facts.emissive.g, facts.emissive.b);
        gl.uniform1f(meshProgram.uniform('uEmissiveStrength'), override.emissiveStrength ?? facts.emissiveStrength);
        gl.uniform1f(meshProgram.uniform('uMetallic'), override.metallic ?? facts.metallic);
        gl.uniform1f(meshProgram.uniform('uRoughness'), override.roughness ?? facts.roughness);
        gl.uniform1f(meshProgram.uniform('uOpacity'), override.opacity ?? facts.opacity);
        gl.uniform3f(meshProgram.uniform('uPalette'), color[0], color[1], color[2]);
        gl.uniform1f(meshProgram.uniform('uMappingAmount'), mapped.amount);
        gl.uniform1i(meshProgram.uniform('uSource'), sourceIndex(mapped.source));
        if (resource.indexed) {
          gl.drawElements(resource.mode, group.count, resource.indexType, group.start * (resource.indexType === gl.UNSIGNED_INT ? 4 : resource.indexType === gl.UNSIGNED_SHORT ? 2 : 1));
        } else gl.drawArrays(resource.mode, group.start, group.count);
      }
    });
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  };

  const bindTexture = (program: Program, index: number, name: 'Base' | 'Mask', texture: WebGLTexture) => {
    const unit = 8 + index * 2 + (name === 'Mask' ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.uniform(`uModel${name}${index}`), unit);
  };

  return {
    get error() {
      return [...held.values()].find((instance) => instance.trouble)?.trouble ?? null;
    },
    get resources() {
      return {
        instances: held.size,
        geometries: [...held.values()].reduce((sum, instance) => sum + instance.geometry.size, 0),
        targets: held.size,
        loading: [...held.values()].filter((instance) => !instance.root && !instance.trouble).length,
      };
    },
    bind(program, models, library, sample, palette, width, height, scope = '') {
      // `bindTexture` writes uniforms belonging to the flow program. The model
      // pass changes the active program while it draws, and a blank slot can be
      // the first slot visited, so establish the owner before either branch.
      gl.useProgram(program.program);
      const active = new Set(models.map((model) => model.index));
      for (const [index, instance] of held) {
        if (active.has(index)) continue;
        freeInstance(instance);
        held.delete(index);
      }
      for (let index = 0; index < 2; index++) {
        const model = models.find((entry) => entry.index === index);
        const setup = model ? library.setups.find((entry) => entry.id === model.setup) : undefined;
        const asset = setup ? library.assets.find((entry) => entry.hash === setup.assetHash) : undefined;
        if (!model || !setup || !asset) {
          const old = held.get(index);
          if (old) {
            freeInstance(old);
            held.delete(index);
          }
          bindTexture(program, index, 'Base', blank);
          bindTexture(program, index, 'Mask', blank);
          continue;
        }
        const key = `${scope}:${model.id}:${setup.revision}:${asset.hash}`;
        let instance = held.get(index);
        if (!instance || instance.key !== key) {
          if (instance) freeInstance(instance);
          instance = make(key, setup, asset);
          held.set(index, instance);
        }
        try {
          draw(instance, model, sample, palette, width, height);
          instance.trouble = null;
        } catch (error) {
          // A malformed geometry or an exhausted target must not take the
          // whole colour graph down. Keep the failure visible through
          // `ModelBank.error`, clear this model to transparent, and let every
          // downstream blend/grade/output continue to draw.
          instance.trouble = `${asset.name}: ${(error as Error).message}`;
          try {
            instance.target.resize(width, height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, instance.target.framebuffer);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            gl.viewport(0, 0, instance.target.width, instance.target.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          } catch {
            // If allocation itself failed, the existing target remains the
            // safest texture to bind; the compositor still reports the cause.
          }
        }
        gl.useProgram(program.program);
        bindTexture(program, index, 'Base', instance.target.base);
        bindTexture(program, index, 'Mask', instance.target.mask);
      }
    },
    clear() {
      for (const instance of held.values()) freeInstance(instance);
      held.clear();
    },
    free() {
      this.clear();
      gl.deleteTexture(blank);
      gl.deleteProgram(meshProgram.program);
    },
  };
}
