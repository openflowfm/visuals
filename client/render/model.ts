import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  MAX_MODEL_LIGHTS,
  MAX_MODEL_MORPHS,
  MODEL_SLOTS,
  MODEL_SLOT_SRGB,
  bindingDomainValue,
  decodedImageBytes,
  glbBinaryChunk,
  materialTextureUse,
  modelLightingOf,
  modelRecipeOf,
  type ModelAsset,
  type ModelLibrary,
  type ModelLightSource,
  type ModelLightingSetup,
  type ModelMaterialCapability,
  type ModelMaterialMapping,
  type ModelMaterialProperty,
  type ModelMaterialRecipe,
  type ModelPaletteSource,
  type ModelSamplerCapability,
  type ModelSetup,
  type ModelSlot,
  type ModelTextureAsset,
  type ModelTextureUse,
} from '../../model.ts';
import { portId, type CircuitModel } from './circuit.ts';
import type { NumberSample } from './evaluateNumber.ts';
import type { Program } from './gl.ts';
import {
  createTextureCache,
  textureEntryKey,
  type TextureCache,
  type TextureRequest,
} from './modelTextures.ts';

/** The model pass has a fixed fill-rate ceiling independent of projector size. */
export const MAX_MODEL_EDGE = 1280;
/** One optional shadow view per instance, independent of projector size. */
export const MAX_MODEL_SHADOW_EDGE = 768;
export const MAX_MODEL_BONES = 64;
export { MAX_MODEL_MORPHS };
/**
 * Fragment texture units the pass reserves: five material maps on 0–4 and the
 * shadow map on 15. WebGL2 guarantees sixteen. Units 0–4 belong to the flow
 * program's own samplers, which the compositor binds after this pass returns.
 */
export const MODEL_MATERIAL_UNITS = [0, 1, 2, 3, 4] as const;
export const MODEL_SHADOW_UNIT = 15;
export const MODEL_TEXTURE_UNITS_NEEDED = 16;
/** Anisotropic filtering, when the extension exists, is capped here. */
export const MAX_MODEL_ANISOTROPY = 4;

export const modelAssetUrl = (hash: string): string => `/models/assets/${hash}.glb`;
export const modelTextureUrl = (hash: string): string => `/models/textures/${hash}`;

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

interface ShadowTarget {
  framebuffer: WebGLFramebuffer;
  depth: WebGLTexture;
  free(): void;
}

/** Preview-only camera inspection. Setup cameras remain durable metadata. */
export interface ModelView {
  enabled: boolean;
  yaw: number;
  pitch: number;
  panX: number;
  panY: number;
  zoom: number;
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
  uvSets: number;
}

interface InitialTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  morphs: number[] | null;
}

/** One material slot's resolved picture for this instance and setup. */
interface SlotUse {
  key: string;
  srgb: boolean;
  sampler: string;
  /** Authored `KHR_texture_transform`, or identity for an override. */
  authored: ModelTextureUse | null;
}

interface Instance {
  key: string;
  owner: string;
  setup: ModelSetup;
  asset: ModelAsset;
  target: ModelTarget;
  abort: AbortController;
  root: THREE.Group | null;
  animations: THREE.AnimationClip[];
  initial: Map<THREE.Object3D, InitialTransform>;
  nodes: Map<number, THREE.Object3D>;
  meshes: Map<number, THREE.Mesh[]>;
  materials: Map<number, THREE.Material[]>;
  geometry: Map<THREE.BufferGeometry, GeometryResource>;
  autoCamera: THREE.PerspectiveCamera;
  boundsCenter: THREE.Vector3;
  boundsRadius: number;
  shadow: ShadowTarget | null;
  trouble: string | null;
  /** The immutable bytes, kept only until the first texture acquisition is issued. */
  bytes: ArrayBuffer | null;
  /** Which material recipes the current slot uses were resolved from. */
  wantedFor: readonly ModelMaterialMapping[] | null;
  wantedTextures: readonly ModelTextureAsset[] | null;
  slots: Map<string, SlotUse>;
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
    views?: Readonly<Record<string, ModelView>>,
    seconds?: number,
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
  shadows: number;
  /** Instances whose immutable bytes, GLTF parse or wanted textures have not completed yet. */
  loading: number;
  /** Uploaded GPU textures shared across every instance and setup. */
  textures: number;
  /** Estimated decoded bytes of those textures, mips included. */
  textureBytes: number;
  /** Image decodes queued or running. */
  decoding: number;
  /** Texture acquisitions answered by an upload another owner already made. */
  textureReuse: number;
}

const SLOT_UNIFORMS: Record<ModelSlot, string> = {
  baseColor: 'uBaseMap',
  metallicRoughness: 'uMetalRoughMap',
  normal: 'uNormalMap',
  occlusion: 'uOcclusionMap',
  emissive: 'uEmissiveMap',
};

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
layout(location=8) in vec2 aUv0;
layout(location=9) in vec2 aUv1;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uShadowMatrix;
uniform mat4 uRootInverse;
uniform mat3 uNormal;
uniform mat4 uBind;
uniform mat4 uBindInverse;
uniform mat4 uBones[${MAX_MODEL_BONES}];
uniform vec4 uMorphWeights;
uniform float uSkinned;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vModel;
out vec4 vShadow;
out vec2 vUv0;
out vec2 vUv1;

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
  vModel = (uRootInverse * world).xyz;
  vNormal = normalize(uNormal * aNormal);
  vShadow = uShadowMatrix * world;
  vUv0 = aUv0;
  vUv1 = aUv1;
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vModel;
in vec4 vShadow;
in vec2 vUv0;
in vec2 vUv1;
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
uniform int uAlphaMode;
uniform float uAlphaCutoff;
uniform int uUnlit;
uniform sampler2D uBaseMap;
uniform sampler2D uMetalRoughMap;
uniform sampler2D uNormalMap;
uniform sampler2D uOcclusionMap;
uniform sampler2D uEmissiveMap;
uniform int uMapOn[5];
uniform int uMapUv[5];
uniform mat3 uMapTransform[5];
uniform int uProjection;
uniform vec3 uBoundsCenter;
uniform float uBoundsRadius;
uniform float uTextureMix;
uniform float uNormalStrength;
uniform float uOcclusionStrength;
uniform float uRim;
uniform float uScan;
uniform float uBands;
uniform float uTime;
uniform vec3 uCameraPosition;
uniform int uLightCount;
uniform int uLightType[${MAX_MODEL_LIGHTS}];
uniform vec3 uLightPosition[${MAX_MODEL_LIGHTS}];
uniform vec3 uLightDirection[${MAX_MODEL_LIGHTS}];
uniform vec3 uLightColor[${MAX_MODEL_LIGHTS}];
uniform float uLightIntensity[${MAX_MODEL_LIGHTS}];
uniform float uLightRange[${MAX_MODEL_LIGHTS}];
uniform float uLightInner[${MAX_MODEL_LIGHTS}];
uniform float uLightOuter[${MAX_MODEL_LIGHTS}];
uniform vec3 uEnvironmentTop;
uniform vec3 uEnvironmentBottom;
uniform vec3 uEnvironmentDirection;
uniform float uEnvironmentIntensity;
uniform sampler2D uShadowMap;
uniform int uShadowLight;
uniform float uShadowTexel;
uniform float uShadowSoftness;

const float PI = 3.14159265359;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// --- pictures -----------------------------------------------------------

vec2 mapUv(int slot) {
  vec2 uv = uMapUv[slot] == 1 ? vUv1 : vUv0;
  return (uMapTransform[slot] * vec3(uv, 1.0)).xy;
}

// Weights for the three projection planes, sharpened so the seams stay short.
vec3 triplanarWeights() {
  vec3 w = pow(abs(normalize(vNormal)), vec3(4.0));
  return w / max(w.x + w.y + w.z, 0.0001);
}

// Model-space coordinate scaled so the whole subject spans about one repeat.
vec3 triplanarPoint() {
  return (vModel - uBoundsCenter) / max(uBoundsRadius, 0.0001) * 0.5 + 0.5;
}

vec4 readMap(sampler2D map, int slot) {
  if (uProjection == 1) {
    vec3 w = triplanarWeights();
    vec3 p = triplanarPoint();
    mat3 t = uMapTransform[slot];
    return texture(map, (t * vec3(p.zy, 1.0)).xy) * w.x
      + texture(map, (t * vec3(p.xz, 1.0)).xy) * w.y
      + texture(map, (t * vec3(p.xy, 1.0)).xy) * w.z;
  }
  return texture(map, mapUv(slot));
}

// A tangent frame from position and UV derivatives: no CPU tangents, and a
// mirrored UV island simply yields a mirrored frame.
mat3 cotangentFrame(vec3 n, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, n);
  vec3 dp1perp = cross(n, dp1);
  vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
  float det = max(dot(t, t), dot(b, b));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(t * scale, b * scale, n);
}

vec3 decodeNormal(vec4 texel) {
  vec3 tn = texel.xyz * 2.0 - 1.0;
  // A frame from derivatives turns the picture's up into glTF's down.
  tn.xy *= vec2(uNormalStrength, -uNormalStrength);
  return tn;
}

vec3 mappedNormal(vec3 n) {
  if (uMapOn[2] == 0) return n;
  if (uProjection == 1) {
    vec3 w = triplanarWeights();
    vec3 p = triplanarPoint();
    mat3 t = uMapTransform[2];
    vec2 x = (t * vec3(p.zy, 1.0)).xy;
    vec2 y = (t * vec3(p.xz, 1.0)).xy;
    vec2 z = (t * vec3(p.xy, 1.0)).xy;
    vec3 blended =
      cotangentFrame(n, vWorld, x) * decodeNormal(texture(uNormalMap, x)) * w.x +
      cotangentFrame(n, vWorld, y) * decodeNormal(texture(uNormalMap, y)) * w.y +
      cotangentFrame(n, vWorld, z) * decodeNormal(texture(uNormalMap, z)) * w.z;
    return normalize(blended);
  }
  vec2 uv = mapUv(2);
  // Without UVs the derivatives vanish and the frame is degenerate; keep the
  // geometric normal rather than a black or exploding surface.
  if (dot(dFdx(uv), dFdx(uv)) + dot(dFdy(uv), dFdy(uv)) < 1e-12) return n;
  return normalize(cotangentFrame(n, vWorld, uv) * decodeNormal(texture(uNormalMap, uv)));
}

// --- light --------------------------------------------------------------

float distributionGGX(vec3 n, vec3 h, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 0.0001);
}

float geometrySchlickGGX(float nv, float roughness) {
  float r = roughness + 1.0;
  float k = r * r / 8.0;
  return nv / max(nv * (1.0 - k) + k, 0.0001);
}

float geometrySmith(vec3 n, vec3 v, vec3 l, float roughness) {
  return geometrySchlickGGX(max(dot(n, v), 0.0), roughness)
    * geometrySchlickGGX(max(dot(n, l), 0.0), roughness);
}

vec3 fresnelSchlick(float cosine, vec3 f0) {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

vec3 fresnelRoughness(float cosine, vec3 f0, float roughness) {
  return f0 + (max(vec3(1.0 - roughness), f0) - f0)
    * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

float modelShadow(vec3 n, vec3 l) {
  if (uShadowLight < 0 || vShadow.w <= 0.0) return 1.0;
  vec3 projected = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (projected.x <= 0.0 || projected.x >= 1.0 || projected.y <= 0.0 || projected.y >= 1.0 || projected.z >= 1.0) return 1.0;
  float bias = max(0.00035, 0.0018 * (1.0 - max(dot(n, l), 0.0)));
  float radius = max(0.25, uShadowSoftness) * uShadowTexel;
  float visible = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float held = texture(uShadowMap, projected.xy + vec2(float(x), float(y)) * radius).r;
      visible += projected.z - bias <= held ? 1.0 : 0.0;
    }
  }
  return visible / 9.0;
}

struct Surface {
  vec3 n;
  vec3 v;
  float nv;
  float metallic;
  float roughness;
  float occlusion;
  vec3 emissive;
};

vec3 litSurface(vec3 albedo, Surface s) {
  vec3 n = s.n;
  vec3 v = s.v;
  float nv = s.nv;
  vec3 f0 = mix(vec3(0.04), albedo, s.metallic);
  vec3 direct = vec3(0.0);

  for (int i = 0; i < ${MAX_MODEL_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 l;
    float attenuation = 1.0;
    if (uLightType[i] == 0) {
      l = normalize(-uLightDirection[i]);
    } else {
      vec3 offset = uLightPosition[i] - vWorld;
      float distance = max(length(offset), 0.0001);
      l = offset / distance;
      float relativeDistance = distance / max(uLightRange[i], 0.0001);
      float falloff = clamp(1.0 - relativeDistance, 0.0, 1.0);
      attenuation = falloff * falloff / (1.0 + 4.0 * relativeDistance * relativeDistance);
      if (uLightType[i] == 2) {
        float cone = dot(normalize(vWorld - uLightPosition[i]), normalize(uLightDirection[i]));
        attenuation *= smoothstep(uLightOuter[i], uLightInner[i], cone);
      }
    }
    float nl = max(dot(n, l), 0.0);
    if (nl <= 0.0 || attenuation <= 0.0) continue;
    vec3 h = normalize(v + l);
    vec3 f = fresnelSchlick(max(dot(h, v), 0.0), f0);
    float d = distributionGGX(n, h, s.roughness);
    float g = geometrySmith(n, v, l, s.roughness);
    vec3 specular = d * g * f / max(4.0 * nv * nl, 0.0001);
    vec3 diffuse = (vec3(1.0) - f) * (1.0 - s.metallic) * albedo / PI;
    float shadow = i == uShadowLight ? modelShadow(n, l) : 1.0;
    direct += (diffuse + specular) * uLightColor[i] * uLightIntensity[i] * attenuation * nl * shadow;
  }

  float hemi = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 environment = mix(uEnvironmentBottom, uEnvironmentTop, hemi);
  vec3 reflected = reflect(-v, n);
  float hot = pow(max(dot(reflected, uEnvironmentDirection), 0.0), mix(72.0, 3.0, s.roughness));
  vec3 f = fresnelRoughness(nv, f0, s.roughness);
  vec3 diffuseEnvironment = (vec3(1.0) - f) * (1.0 - s.metallic) * albedo * environment;
  vec3 specularEnvironment = f * (environment * (0.35 + 0.65 * (1.0 - s.roughness)) + uEnvironmentTop * hot * 1.6);
  return direct + (diffuseEnvironment + specularEnvironment) * uEnvironmentIntensity * s.occlusion;
}

// The curated looks. All uniform-driven, so there is one shader and no
// stage-time compile for a recipe change.
vec3 styled(vec3 lit, vec3 tint, Surface s) {
  vec3 colour = lit;
  if (uBands > 0.0) {
    float l = dot(colour, LUMA);
    float q = floor(l * 4.0 + 0.5) / 4.0;
    colour *= mix(1.0, q / max(l, 0.0001), uBands);
  }
  if (uScan > 0.0) {
    float phase = (vModel.y - uBoundsCenter.y) / max(uBoundsRadius, 0.0001) * 18.0 - uTime * 4.0;
    float band = smoothstep(0.55, 0.95, 0.5 + 0.5 * sin(phase));
    colour = colour * (1.0 - uScan * 0.5 * (1.0 - band)) + tint * uScan * band * 1.5;
  }
  if (uRim > 0.0) colour += tint * uRim * pow(1.0 - s.nv, 3.0) * 2.5;
  return colour;
}

vec3 shade(vec3 albedo, Surface s) {
  vec3 lit = uUnlit == 1 ? albedo : litSurface(albedo, s) + s.emissive;
  return styled(lit, albedo, s);
}

void main() {
  vec3 geometric = normalize(vNormal);
  if (!gl_FrontFacing) geometric = -geometric;

  vec4 base = uMapOn[0] == 1 ? readMap(uBaseMap, 0) : vec4(1.0);
  vec3 albedo = uBaseColor.rgb * mix(vec3(1.0), base.rgb, uTextureMix);
  float coverage = uBaseColor.a * mix(1.0, base.a, uTextureMix);
  // Authored light/dark structure, read perceptually so a mid-grey texel keeps
  // roughly half its brightness when the palette replaces its hue.
  float detail = uMapOn[0] == 1 ? mix(1.0, pow(max(dot(base.rgb, LUMA), 0.0), 0.4545), uTextureMix) : 1.0;

  if (uAlphaMode == 1 && coverage < uAlphaCutoff) discard;
  float alpha = clamp((uAlphaMode == 2 ? coverage : 1.0) * uOpacity, 0.0, 1.0);

  vec4 metalRough = uMapOn[1] == 1 ? readMap(uMetalRoughMap, 1) : vec4(1.0);
  vec4 occlusion = uMapOn[3] == 1 ? readMap(uOcclusionMap, 3) : vec4(1.0);
  vec4 emissiveMap = uMapOn[4] == 1 ? readMap(uEmissiveMap, 4) : vec4(1.0);

  Surface s;
  s.n = mappedNormal(geometric);
  s.v = normalize(uCameraPosition - vWorld);
  s.nv = max(dot(s.n, s.v), 0.0001);
  s.roughness = clamp(uRoughness * metalRough.g, 0.045, 1.0);
  s.metallic = clamp(uMetallic * metalRough.b, 0.0, 1.0);
  s.occlusion = 1.0 + uOcclusionStrength * (occlusion.r - 1.0);
  s.emissive = uEmissive * uEmissiveStrength * emissiveMap.rgb;

  vec3 original = shade(albedo, s);
  vec3 mapped = shade(uPalette * detail, s);
  float mappedLight = dot(shade(vec3(detail), s), LUMA);

  outBase = vec4(0.0);
  outMask = vec4(0.0);
  if (uSource == 1) {
    outBase = vec4(original * alpha * (1.0 - uMappingAmount), alpha * (1.0 - uMappingAmount));
    outMask = vec4(mappedLight * alpha * uMappingAmount, 0.0, 0.0, alpha * uMappingAmount);
  } else if (uSource == 2) {
    outBase = vec4(original * alpha * (1.0 - uMappingAmount), alpha * (1.0 - uMappingAmount));
    outMask = vec4(0.0, mappedLight * alpha * uMappingAmount, 0.0, alpha * uMappingAmount);
  } else {
    vec3 chosen = uSource == 0 ? original : mix(original, mapped, uMappingAmount);
    outBase = vec4(chosen * alpha, alpha);
  }
}`;

const SHADOW_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=2) in vec3 aMorph0;
layout(location=3) in vec3 aMorph1;
layout(location=4) in vec3 aMorph2;
layout(location=5) in vec3 aMorph3;
layout(location=6) in vec4 aSkinIndex;
layout(location=7) in vec4 aSkinWeight;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uBind;
uniform mat4 uBindInverse;
uniform mat4 uBones[${MAX_MODEL_BONES}];
uniform vec4 uMorphWeights;
uniform float uSkinned;
void main() {
  vec3 p = aPosition + aMorph0 * uMorphWeights.x + aMorph1 * uMorphWeights.y
    + aMorph2 * uMorphWeights.z + aMorph3 * uMorphWeights.w;
  vec4 local = vec4(p, 1.0);
  if (uSkinned > 0.5) {
    mat4 skin = uBones[int(aSkinIndex.x)] * aSkinWeight.x
      + uBones[int(aSkinIndex.y)] * aSkinWeight.y
      + uBones[int(aSkinIndex.z)] * aSkinWeight.z
      + uBones[int(aSkinIndex.w)] * aSkinWeight.w;
    local = uBindInverse * skin * uBind * local;
  }
  gl_Position = uViewProjection * uModel * local;
}`;

const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
void main() { }
`;

function compileMesh(
  gl: WebGL2RenderingContext,
  vertexSource = VERTEX,
  fragmentSource = FRAGMENT,
  label = 'model renderer',
): MeshProgram {
  const shader = (kind: number, source: string) => {
    const made = gl.createShader(kind)!;
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) {
      const why = gl.getShaderInfoLog(made);
      gl.deleteShader(made);
      throw new Error(`${label}: ${why}`);
    }
    return made;
  };
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const why = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${label}: ${why}`);
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

function shadowTarget(gl: WebGL2RenderingContext): ShadowTarget {
  const framebuffer = gl.createFramebuffer()!;
  const depth = gl.createTexture()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, depth);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    MAX_MODEL_SHADOW_EDGE,
    MAX_MODEL_SHADOW_EDGE,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(depth);
    throw new Error('model renderer could not allocate its bounded shadow target');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    framebuffer,
    depth,
    free() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(depth);
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
  // GLTFLoader names TEXCOORD_0 `uv` and TEXCOORD_1 `uv1`; an occlusion map
  // may read the second while everything else reads the first.
  const uv0 = geometry.getAttribute('uv');
  const uv1 = geometry.getAttribute('uv1');
  attribute(8, uv0);
  attribute(9, uv1 ?? uv0);

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
    uvSets: uv1 ? 2 : uv0 ? 1 : 0,
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
  const bounds = new THREE.Box3().setFromObject(instance.root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 1e-4 ? sphere.radius : 1;
  instance.boundsCenter.copy(sphere.center);
  instance.boundsRadius = radius;
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

interface AppliedBindings {
  materials: Map<number, Partial<Record<ModelMaterialProperty, number>>>;
  lights: Map<string, Partial<Record<
    'intensity' | 'position-x' | 'position-y' | 'position-z' | 'target-x' | 'target-y' | 'target-z' | 'range' | 'inner-cone' | 'outer-cone',
    number
  >>>;
  environment: Partial<Record<'intensity' | 'rotation', number>>;
}

function applyBindings(instance: Instance, model: CircuitModel, sample: NumberSample): AppliedBindings {
  resetInstance(instance);
  const applied: AppliedBindings = {
    materials: new Map(),
    lights: new Map(),
    environment: {},
  };
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
      const held = applied.materials.get(target.material) ?? {};
      held[target.property] = value;
      applied.materials.set(target.material, held);
    } else if (target.kind === 'light') {
      const held = applied.lights.get(target.light) ?? {};
      held[target.property] = value;
      applied.lights.set(target.light, held);
    } else if (target.kind === 'environment') {
      applied.environment[target.property] = value;
    }
  }
  if (mixer) mixer.update(0);
  instance.root?.updateMatrixWorld(true);
  // Actions belong only to this one sampled frame; a fresh mixer next frame
  // avoids clips whose weights were removed continuing to affect the setup.
  for (const action of actions) action.stop();
  return applied;
}

interface MaterialFacts {
  color: [number, number, number, number];
  emissive: [number, number, number];
  emissiveStrength: number;
  metallic: number;
  roughness: number;
  opacity: number;
  alphaMode: 0 | 1 | 2;
  alphaCutoff: number;
  doubleSided: boolean;
  unlit: boolean;
}

/**
 * Authored facts come from the inspected capabilities when the material has
 * an index, since those carry alpha, sidedness, unlit and texture slots. A
 * Three material is only the fallback for a malformed association.
 */
function materialFacts(material: THREE.Material, capability: ModelMaterialCapability | undefined): MaterialFacts {
  if (capability) {
    return {
      color: [...capability.baseColor] as [number, number, number, number],
      emissive: [...capability.emissive] as [number, number, number],
      emissiveStrength: capability.emissiveStrength,
      metallic: capability.metallic,
      roughness: capability.roughness,
      opacity: 1,
      alphaMode: capability.alphaMode === 'MASK' ? 1 : capability.alphaMode === 'BLEND' ? 2 : 0,
      alphaCutoff: capability.alphaCutoff,
      doubleSided: capability.doubleSided,
      unlit: capability.unlit === true,
    };
  }
  const standard = material as THREE.MeshStandardMaterial;
  const color = standard.color ?? new THREE.Color(1, 1, 1);
  const emissive = standard.emissive ?? new THREE.Color(0, 0, 0);
  return {
    color: [color.r, color.g, color.b, 1],
    emissive: [emissive.r, emissive.g, emissive.b],
    emissiveStrength: Number.isFinite(standard.emissiveIntensity) ? standard.emissiveIntensity : 1,
    metallic: Number.isFinite(standard.metalness) ? standard.metalness : 0,
    roughness: Number.isFinite(standard.roughness) ? standard.roughness : 0.7,
    opacity: Number.isFinite(standard.opacity) ? standard.opacity : 1,
    alphaMode: standard.transparent ? 2 : 0,
    alphaCutoff: 0.5,
    doubleSided: material.side === THREE.DoubleSide,
    unlit: false,
  };
}

interface ResolvedLight {
  type: 0 | 1 | 2;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  color: [number, number, number];
  intensity: number;
  range: number;
  inner: number;
  outer: number;
  shadow: boolean;
  softness: number;
}

const lightSourceColor = (
  source: ModelLightSource,
  authored: readonly [number, number, number],
  palette: readonly number[],
): [number, number, number] => {
  if (source === 'authored') return [authored[0], authored[1], authored[2]];
  if (source === 'white') return [1, 1, 1];
  const at = ({ primary: 0, secondary: 1, complement: 2, accent: 3, chalk: 4 } as const)[source];
  return rgb(palette[at] ?? 0xffffff);
};

function cameraFor(instance: Instance, view: ModelView | undefined): THREE.Camera {
  const radius = instance.boundsRadius;
  const center = instance.boundsCenter;
  if (view?.enabled) {
    const yaw = Number.isFinite(view.yaw) ? view.yaw : 0;
    const pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, Number.isFinite(view.pitch) ? view.pitch : 0));
    const zoom = Math.max(0.08, Math.min(16, Number.isFinite(view.zoom) ? view.zoom : 1));
    const outward = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = outward.clone().cross(right).normalize();
    const target = center.clone()
      .addScaledVector(right, (Number.isFinite(view.panX) ? view.panX : 0) * radius)
      .addScaledVector(up, (Number.isFinite(view.panY) ? view.panY : 0) * radius);
    instance.autoCamera.position.copy(target).addScaledVector(outward, radius * 2.9 / zoom);
    instance.autoCamera.near = Math.max(0.001, radius / 200);
    instance.autoCamera.far = Math.max(radius * 24, radius * 2.9 / zoom + radius * 4);
    instance.autoCamera.lookAt(target);
  } else {
    instance.autoCamera.position.set(center.x, center.y, center.z + radius * 2.9);
    instance.autoCamera.near = Math.max(0.001, radius / 100);
    instance.autoCamera.far = radius * 20;
    instance.autoCamera.lookAt(center);
  }
  const cameraNode = instance.setup.camera === null
    ? undefined
    : instance.asset.capabilities.nodes.find((node) => node.camera === instance.setup.camera);
  const selected = cameraNode ? instance.nodes.get(cameraNode.index) : undefined;
  return view?.enabled || !(selected instanceof THREE.Camera) ? instance.autoCamera : selected;
}

function resolvedLighting(
  instance: Instance,
  camera: THREE.Camera,
  palette: readonly number[],
  applied: AppliedBindings,
): { setup: ModelLightingSetup; lights: ResolvedLight[]; environmentIntensity: number; environmentRotation: number } {
  const setup = modelLightingOf(instance.setup);
  const center = instance.boundsCenter;
  const radius = instance.boundsRadius;
  const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
  const modelQuaternion = instance.root?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const lights = setup.lights.filter((light) => light.enabled).slice(0, MAX_MODEL_LIGHTS).map((light): ResolvedLight => {
    const override = applied.lights.get(light.id) ?? {};
    const component = (prefix: 'position' | 'target', axis: 'x' | 'y' | 'z', fallback: number) =>
      override[`${prefix}-${axis}`] ?? fallback;
    const position = new THREE.Vector3(
      component('position', 'x', light.position[0]),
      component('position', 'y', light.position[1]),
      component('position', 'z', light.position[2]),
    ).multiplyScalar(radius);
    const target = new THREE.Vector3(
      component('target', 'x', light.target[0]),
      component('target', 'y', light.target[1]),
      component('target', 'z', light.target[2]),
    ).multiplyScalar(radius);
    const orientation = light.space === 'camera'
      ? cameraQuaternion
      : light.space === 'model' ? modelQuaternion : new THREE.Quaternion();
    position.applyQuaternion(orientation).add(center);
    target.applyQuaternion(orientation).add(center);
    const direction = target.clone().sub(position);
    if (direction.lengthSq() < 1e-8) direction.set(0, -1, 0);
    else direction.normalize();
    const inner = override['inner-cone'] ?? light.innerConeAngle;
    const outer = Math.max(inner + 0.001, override['outer-cone'] ?? light.outerConeAngle);
    return {
      type: light.type === 'directional' ? 0 : light.type === 'point' ? 1 : 2,
      position,
      direction,
      color: lightSourceColor(light.source, light.color, palette),
      intensity: Math.max(0, override.intensity ?? light.intensity),
      range: Math.max(0.001, override.range ?? light.range) * radius,
      inner: Math.cos(inner),
      outer: Math.cos(outer),
      shadow: light.shadow && light.type !== 'point',
      softness: light.softness,
    };
  });
  return {
    setup,
    lights,
    environmentIntensity: Math.max(0, applied.environment.intensity ?? setup.environment.intensity),
    environmentRotation: applied.environment.rotation ?? setup.environment.rotation,
  };
}

// --- pictures per material ------------------------------------------------

const DEFAULT_SAMPLER: ModelSamplerCapability = {
  index: -1,
  name: 'default',
  magFilter: 'linear',
  minFilter: 'linear',
  mipmap: true,
  wrapS: 'repeat',
  wrapT: 'repeat',
};

const samplerKey = (sampler: ModelSamplerCapability, wrap: ModelMaterialRecipe['wrap']): string => {
  const wrapS = wrap === 'authored' ? sampler.wrapS : wrap;
  const wrapT = wrap === 'authored' ? sampler.wrapT : wrap;
  return `${wrapS}|${wrapT}|${sampler.magFilter}|${sampler.minFilter}|${sampler.mipmap ? 'mip' : 'flat'}`;
};

/** A material slot's use resolved against this asset, recipe and the local texture library. */
function slotUse(
  asset: ModelAsset,
  material: ModelMaterialCapability,
  slot: ModelSlot,
  recipe: ModelMaterialRecipe,
  textures: readonly ModelTextureAsset[],
): { use: SlotUse; request: Omit<TextureRequest, 'source'>; embedded: number | null; override: ModelTextureAsset | null } | null {
  const source = recipe.slots[slot];
  const srgb = MODEL_SLOT_SRGB[slot];
  if (source.kind === 'none') return null;
  if (source.kind === 'texture') {
    const record = textures.find((entry) => entry.hash === source.hash);
    if (!record) return null;
    return {
      use: { key: `texture:${record.hash}`, srgb, sampler: samplerKey(DEFAULT_SAMPLER, recipe.wrap), authored: null },
      request: { key: `texture:${record.hash}`, srgb, mimeType: record.mimeType, bytes: decodedImageBytes(record.width, record.height) },
      embedded: null,
      override: record,
    };
  }
  const authored = materialTextureUse(material, slot);
  if (!authored) return null;
  const texture = asset.capabilities.textures?.[authored.texture];
  const image = texture && texture.image !== null ? asset.capabilities.images?.[texture.image] : undefined;
  if (!texture || !image || image.unsupported !== null || image.mimeType === null) return null;
  const sampler = texture.sampler === null ? DEFAULT_SAMPLER : (asset.capabilities.samplers?.[texture.sampler] ?? DEFAULT_SAMPLER);
  const key = `asset:${asset.hash}:${image.index}`;
  return {
    use: { key, srgb, sampler: samplerKey(sampler, recipe.wrap), authored },
    request: { key, srgb, mimeType: image.mimeType, bytes: image.decodedBytes },
    embedded: image.index,
    override: null,
  };
}

const slotId = (material: number, slot: ModelSlot): string => `${material}:${slot}`;

/**
 * `uv' = T · R · S · uv`, the `KHR_texture_transform` definition, with the
 * recipe's own transform applied about the picture's centre on top of it.
 */
function uvTransform(
  authored: ModelTextureUse | null,
  recipe: ModelMaterialRecipe,
  override: Partial<Record<ModelMaterialProperty, number>>,
  projection: 'uv' | 'triplanar',
): THREE.Matrix3 {
  const matrix = new THREE.Matrix3();
  const rotation = (angle: number) => new THREE.Matrix3().set(
    Math.cos(angle), Math.sin(angle), 0,
    -Math.sin(angle), Math.cos(angle), 0,
    0, 0, 1,
  );
  const translation = (x: number, y: number) => new THREE.Matrix3().set(1, 0, x, 0, 1, y, 0, 0, 1);
  const scaling = (x: number, y: number) => new THREE.Matrix3().set(x, 0, 0, 0, y, 0, 0, 0, 1);
  const scale = override['uv-scale'] ?? 1;
  const offsetX = override['uv-offset-x'] ?? recipe.uvOffset[0];
  const offsetY = override['uv-offset-y'] ?? recipe.uvOffset[1];
  const angle = override['uv-rotation'] ?? recipe.uvRotation;
  matrix
    .multiply(translation(0.5 + offsetX, 0.5 + offsetY))
    .multiply(rotation(angle))
    .multiply(scaling(recipe.uvScale[0] * scale, recipe.uvScale[1] * scale))
    .multiply(translation(-0.5, -0.5));
  if (projection === 'uv' && authored) {
    matrix
      .multiply(translation(authored.offset[0], authored.offset[1]))
      .multiply(rotation(authored.rotation))
      .multiply(scaling(authored.scale[0], authored.scale[1]));
  }
  return matrix;
}

export function createModelBank(gl: WebGL2RenderingContext): ModelBank {
  const held = new Map<number, Instance>();
  const meshProgram = compileMesh(gl);
  const shadowProgram = compileMesh(gl, SHADOW_VERTEX, SHADOW_FRAGMENT, 'model shadow');
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const textureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
  const anisotropy = anisotropic
    ? Math.min(MAX_MODEL_ANISOTROPY, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number)
    : 0;
  // WebGL2 promises sixteen; a context that reports fewer draws every model
  // transparent with a reason rather than sampling through a unit it lacks.
  const limitTrouble = textureUnits < MODEL_TEXTURE_UNITS_NEEDED
    ? `this GPU exposes ${textureUnits} fragment texture units; the model pass needs ${MODEL_TEXTURE_UNITS_NEEDED}`
    : null;
  let serial = 0;

  gl.useProgram(meshProgram.program);
  MODEL_SLOTS.forEach((slot, at) => gl.uniform1i(meshProgram.uniform(SLOT_UNIFORMS[slot]), MODEL_MATERIAL_UNITS[at]!));
  gl.uniform1i(meshProgram.uniform('uShadowMap'), MODEL_SHADOW_UNIT);
  gl.useProgram(null);

  const textures: TextureCache<WebGLTexture> = createTextureCache<WebGLTexture, ImageBitmap>({
    async decode(bytes, mimeType) {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    },
    upload(picture, srgb) {
      if (picture.width > maxTextureSize || picture.height > maxTextureSize) {
        throw new Error(`${picture.width}×${picture.height} exceeds this GPU's ${maxTextureSize} pixel texture limit`);
      }
      const texture = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + MODEL_MATERIAL_UNITS[0]!);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, picture.image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    },
    free: (texture) => gl.deleteTexture(texture),
  });

  const samplers = new Map<string, WebGLSampler>();
  const samplerFor = (key: string): WebGLSampler => {
    const found = samplers.get(key);
    if (found) return found;
    const [wrapS, wrapT, mag, min, mip] = key.split('|');
    const wrap = (name: string | undefined) =>
      name === 'clamp' ? gl.CLAMP_TO_EDGE : name === 'mirror' ? gl.MIRRORED_REPEAT : gl.REPEAT;
    const sampler = gl.createSampler()!;
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrap(wrapS));
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrap(wrapT));
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, mag === 'nearest' ? gl.NEAREST : gl.LINEAR);
    gl.samplerParameteri(
      sampler,
      gl.TEXTURE_MIN_FILTER,
      mip === 'mip'
        ? (min === 'nearest' ? gl.NEAREST_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_LINEAR)
        : (min === 'nearest' ? gl.NEAREST : gl.LINEAR),
    );
    if (anisotropic && anisotropy > 1 && mip === 'mip') {
      gl.samplerParameterf(sampler, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, anisotropy);
    }
    samplers.set(key, sampler);
    return sampler;
  };

  const freeInstance = (instance: Instance) => {
    instance.abort.abort();
    textures.release(instance.owner);
    instance.slots.clear();
    instance.bytes = null;
    for (const resource of instance.geometry.values()) {
      gl.deleteVertexArray(resource.vao);
      for (const buffer of resource.buffers) gl.deleteBuffer(buffer);
    }
    instance.geometry.clear();
    instance.shadow?.free();
    instance.shadow = null;
    instance.target.free();
    instance.root = null;
  };

  /**
   * Resolve every slot the current recipes want, acquire the pictures the
   * instance does not hold yet and release the ones it no longer reads.
   * Recipes are setup metadata that may change every keystroke in the editor;
   * the cache makes an unchanged picture free to ask for again.
   */
  const wantTextures = (instance: Instance, library: ModelLibrary) => {
    if (!instance.root) return;
    if (instance.wantedFor === instance.setup.materials && instance.wantedTextures === library.textures) return;
    instance.wantedFor = instance.setup.materials;
    instance.wantedTextures = library.textures;
    const mapping = new Map(instance.setup.materials.map((entry) => [entry.material, entry]));
    const keep = new Set<string>();
    const bytes = instance.bytes;
    // The bytes fetched for the parse feed the first round of decodes; a later
    // recipe change reads the immutable asset again through the browser cache
    // rather than pinning up to 128 MiB per instance for its whole life.
    const assetBytes = bytes
      ? (_signal: AbortSignal) => Promise.resolve(bytes)
      : (signal: AbortSignal) => fetch(modelAssetUrl(instance.asset.hash), { signal }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        });
    instance.slots.clear();
    for (const material of instance.asset.capabilities.materials) {
      const recipe = modelRecipeOf(mapping.get(material.index));
      for (const slot of MODEL_SLOTS) {
        const resolved = slotUse(instance.asset, material, slot, recipe, library.textures);
        if (!resolved) continue;
        instance.slots.set(slotId(material.index, slot), resolved.use);
        keep.add(textureEntryKey(resolved.request.key, resolved.request.srgb));
        const source = resolved.override
          ? (signal: AbortSignal) => fetch(modelTextureUrl(resolved.override!.hash), { signal }).then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.arrayBuffer();
            }).then((buffer) => new Uint8Array(buffer))
          : (signal: AbortSignal) => assetBytes(signal).then((buffer) => {
              const image = instance.asset.capabilities.images[resolved.embedded!]!;
              const binary = glbBinaryChunk(buffer);
              if (image.byteOffset + image.bytes > binary.byteLength) throw new Error('image lies outside the GLB binary chunk');
              return binary.slice(image.byteOffset, image.byteOffset + image.bytes);
            });
        textures.acquire(instance.owner, { ...resolved.request, source });
      }
    }
    textures.keep(instance.owner, keep);
    instance.bytes = null;
  };

  const make = (key: string, setup: ModelSetup, asset: ModelLibrary['assets'][number]): Instance => {
    serial += 1;
    const instance: Instance = {
      key,
      owner: `${key}#${serial}`,
      setup,
      asset,
      target: modelTarget(gl),
      abort: new AbortController(),
      root: null,
      animations: [],
      initial: new Map(),
      nodes: new Map(),
      meshes: new Map(),
      materials: new Map(),
      geometry: new Map(),
      autoCamera: new THREE.PerspectiveCamera(42, 1, 0.01, 1000),
      boundsCenter: new THREE.Vector3(),
      boundsRadius: 1,
      shadow: null,
      trouble: limitTrouble,
      bytes: null,
      wantedFor: null,
      wantedTextures: null,
      slots: new Map(),
    };
    if (limitTrouble) return instance;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      // A stored GLB is self-contained. Never turn an URI found inside user
      // bytes into a stage-time network dependency. Blob/data URLs are made by
      // GLTFLoader itself for embedded image buffer views and stay local.
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      throw new Error('external GLB resources are not loaded');
    });
    const loader = new GLTFLoader(manager);
    // Pictures are OpenFlow's: measured by the inspector, decoded through the
    // bounded shared cache, uploaded once per asset. Three must not decode
    // them a second time per instance, so its texture loader answers nothing.
    loader.register(() => ({
      name: 'OPENFLOW_owned_textures',
      loadTexture: () => Promise.resolve(null as unknown as THREE.Texture),
    }));
    void fetch(modelAssetUrl(asset.hash), { signal: instance.abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => new Promise<GLTF>((resolve, reject) => {
        instance.bytes = bytes;
        loader.parse(bytes, '', resolve, reject);
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

  const pose = (program: MeshProgram, object: THREE.Mesh, resource: GeometryResource) => {
    gl.bindVertexArray(resource.vao);
    gl.uniformMatrix4fv(program.uniform('uModel'), false, object.matrixWorld.elements);
    const normalLocation = program.uniform('uNormal');
    if (normalLocation) {
      const normal = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
      gl.uniformMatrix3fv(normalLocation, false, normal.elements);
    }
    const influences = object.morphTargetInfluences ?? [];
    gl.uniform4f(program.uniform('uMorphWeights'), influences[0] ?? 0, influences[1] ?? 0, influences[2] ?? 0, influences[3] ?? 0);
    if (object instanceof THREE.SkinnedMesh && object.skeleton.bones.length > MAX_MODEL_BONES) {
      throw new Error(`skin ${object.name || 'mesh'} has more than ${MAX_MODEL_BONES} bones`);
    }
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.update();
      gl.uniform1f(program.uniform('uSkinned'), 1);
      gl.uniformMatrix4fv(program.uniform('uBind'), false, object.bindMatrix.elements);
      gl.uniformMatrix4fv(program.uniform('uBindInverse'), false, object.bindMatrixInverse.elements);
      gl.uniformMatrix4fv(program.uniform('uBones[0]'), false, object.skeleton.boneMatrices);
    } else gl.uniform1f(program.uniform('uSkinned'), 0);
  };

  const geometryFor = (instance: Instance, object: THREE.Mesh): GeometryResource => {
    const resource = instance.geometry.get(object.geometry) ?? uploadGeometry(gl, object.geometry, object instanceof THREE.SkinnedMesh);
    instance.geometry.set(object.geometry, resource);
    return resource;
  };

  const renderShadow = (
    instance: Instance,
    lights: readonly ResolvedLight[],
  ): { index: number; matrix: THREE.Matrix4; softness: number } => {
    const index = lights.findIndex((light) => light.shadow);
    if (index < 0) {
      instance.shadow?.free();
      instance.shadow = null;
      return { index: -1, matrix: new THREE.Matrix4(), softness: 1 };
    }
    const light = lights[index];
    instance.shadow ??= shadowTarget(gl);
    const radius = instance.boundsRadius;
    let camera: THREE.Camera;
    if (light.type === 0) {
      const held = new THREE.OrthographicCamera(-radius * 1.35, radius * 1.35, radius * 1.35, -radius * 1.35, radius * 0.01, radius * 10);
      held.position.copy(instance.boundsCenter).addScaledVector(light.direction, -radius * 4);
      held.lookAt(instance.boundsCenter);
      held.updateProjectionMatrix();
      camera = held;
    } else {
      const outer = Math.acos(Math.max(-1, Math.min(1, light.outer)));
      const held = new THREE.PerspectiveCamera(
        Math.max(2, Math.min(175, THREE.MathUtils.radToDeg(outer * 2))),
        1,
        radius * 0.01,
        Math.max(radius * 0.1, light.range),
      );
      held.position.copy(light.position);
      held.lookAt(light.position.clone().add(light.direction));
      held.updateProjectionMatrix();
      camera = held;
    }
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    gl.bindFramebuffer(gl.FRAMEBUFFER, instance.shadow.framebuffer);
    gl.drawBuffers([gl.NONE]);
    gl.viewport(0, 0, MAX_MODEL_SHADOW_EDGE, MAX_MODEL_SHADOW_EDGE);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadowProgram.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    gl.uniformMatrix4fv(shadowProgram.uniform('uViewProjection'), false, matrix.elements);
    instance.root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const resource = geometryFor(instance, object);
      if (resource.count <= 0) return;
      pose(shadowProgram, object, resource);
      if (resource.indexed) gl.drawElements(resource.mode, resource.count, resource.indexType, 0);
      else gl.drawArrays(resource.mode, 0, resource.count);
    });
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.DEPTH_TEST);
    return { index, matrix, softness: light.softness };
  };

  interface Draw {
    object: THREE.Mesh;
    resource: GeometryResource;
    start: number;
    count: number;
    material: THREE.Material;
    index: number;
    facts: MaterialFacts;
    mapped: ModelMaterialMapping;
    recipe: ModelMaterialRecipe;
    override: Partial<Record<ModelMaterialProperty, number>>;
    blended: boolean;
    depth: number;
  }

  const bindSlot = (unit: number, texture: WebGLTexture | null, sampler: WebGLSampler | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture ?? blank);
    gl.bindSampler(unit, sampler);
  };

  const draw = (
    instance: Instance,
    model: CircuitModel,
    sample: NumberSample,
    palette: readonly number[],
    width: number,
    height: number,
    view: ModelView | undefined,
    seconds: number,
  ) => {
    instance.target.resize(width, height);
    if (!instance.root) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, instance.target.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, instance.target.width, instance.target.height);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }

    const applied = applyBindings(instance, model, sample);
    const camera = cameraFor(instance, view);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = instance.target.width / instance.target.height;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    const lighting = resolvedLighting(instance, camera, palette, applied);
    const shadow = renderShadow(instance, lighting.lights);
    const mapping = new Map(instance.setup.materials.map((entry) => [entry.material, entry]));
    const rootInverse = instance.root.matrixWorld.clone().invert();
    const rootCenter = instance.boundsCenter.clone().applyMatrix4(rootInverse);

    gl.bindFramebuffer(gl.FRAMEBUFFER, instance.target.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, instance.target.width, instance.target.height);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(meshProgram.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(meshProgram.uniform('uViewProjection'), false, viewProjection.elements);
    gl.uniformMatrix4fv(meshProgram.uniform('uShadowMatrix'), false, shadow.matrix.elements);
    gl.uniformMatrix4fv(meshProgram.uniform('uRootInverse'), false, rootInverse.elements);
    gl.uniform3f(meshProgram.uniform('uCameraPosition'), cameraPosition.x, cameraPosition.y, cameraPosition.z);
    gl.uniform3f(meshProgram.uniform('uBoundsCenter'), rootCenter.x, rootCenter.y, rootCenter.z);
    gl.uniform1f(meshProgram.uniform('uBoundsRadius'), instance.boundsRadius);
    gl.uniform1f(meshProgram.uniform('uTime'), seconds);

    const lightTypes = new Int32Array(MAX_MODEL_LIGHTS);
    const lightPositions = new Float32Array(MAX_MODEL_LIGHTS * 3);
    const lightDirections = new Float32Array(MAX_MODEL_LIGHTS * 3);
    const lightColors = new Float32Array(MAX_MODEL_LIGHTS * 3);
    const lightIntensities = new Float32Array(MAX_MODEL_LIGHTS);
    const lightRanges = new Float32Array(MAX_MODEL_LIGHTS);
    const lightInners = new Float32Array(MAX_MODEL_LIGHTS);
    const lightOuters = new Float32Array(MAX_MODEL_LIGHTS);
    lighting.lights.forEach((light, index) => {
      lightTypes[index] = light.type;
      lightPositions.set(light.position.toArray(), index * 3);
      lightDirections.set(light.direction.toArray(), index * 3);
      lightColors.set(light.color, index * 3);
      lightIntensities[index] = light.intensity;
      lightRanges[index] = light.range;
      lightInners[index] = light.inner;
      lightOuters[index] = light.outer;
    });
    gl.uniform1i(meshProgram.uniform('uLightCount'), lighting.lights.length);
    gl.uniform1iv(meshProgram.uniform('uLightType[0]'), lightTypes);
    gl.uniform3fv(meshProgram.uniform('uLightPosition[0]'), lightPositions);
    gl.uniform3fv(meshProgram.uniform('uLightDirection[0]'), lightDirections);
    gl.uniform3fv(meshProgram.uniform('uLightColor[0]'), lightColors);
    gl.uniform1fv(meshProgram.uniform('uLightIntensity[0]'), lightIntensities);
    gl.uniform1fv(meshProgram.uniform('uLightRange[0]'), lightRanges);
    gl.uniform1fv(meshProgram.uniform('uLightInner[0]'), lightInners);
    gl.uniform1fv(meshProgram.uniform('uLightOuter[0]'), lightOuters);
    const environment = lighting.setup.environment;
    const top = lightSourceColor(environment.top, environment.topColor, palette);
    const bottom = lightSourceColor(environment.bottom, environment.bottomColor, palette);
    const environmentDirection = new THREE.Vector3(
      Math.sin(lighting.environmentRotation),
      0.35,
      Math.cos(lighting.environmentRotation),
    ).normalize();
    gl.uniform3fv(meshProgram.uniform('uEnvironmentTop'), top);
    gl.uniform3fv(meshProgram.uniform('uEnvironmentBottom'), bottom);
    gl.uniform3f(meshProgram.uniform('uEnvironmentDirection'), environmentDirection.x, environmentDirection.y, environmentDirection.z);
    gl.uniform1f(meshProgram.uniform('uEnvironmentIntensity'), lighting.environmentIntensity);
    gl.activeTexture(gl.TEXTURE0 + MODEL_SHADOW_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, instance.shadow?.depth ?? blank);
    gl.bindSampler(MODEL_SHADOW_UNIT, null);
    gl.uniform1i(meshProgram.uniform('uShadowLight'), shadow.index);
    gl.uniform1f(meshProgram.uniform('uShadowTexel'), 1 / MAX_MODEL_SHADOW_EDGE);
    gl.uniform1f(meshProgram.uniform('uShadowSoftness'), shadow.softness);

    // Opaque and cut-out surfaces first with depth writes; everything that
    // blends afterwards, farthest first, reading depth without writing it.
    const draws: Draw[] = [];
    const viewPoint = new THREE.Vector3();
    instance.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const resource = geometryFor(instance, object);
      if (resource.count <= 0) return;
      const materials = materialArray(object.material);
      // glTF primitives normally arrive as one Mesh. Groups retain multi-material
      // geometry; drawing each group keeps that authored assignment intact.
      const groups = object.geometry.groups.length
        ? object.geometry.groups
        : [{ start: 0, count: resource.count, materialIndex: 0 }];
      const depth = object.getWorldPosition(viewPoint).distanceTo(cameraPosition);
      for (const group of groups) {
        const material = materials[group.materialIndex] ?? materials[0];
        if (!material || !material.visible) continue;
        const index = materialIndex(instance, material);
        const facts = materialFacts(material, index >= 0 ? instance.asset.capabilities.materials[index] : undefined);
        const mapped: ModelMaterialMapping = mapping.get(index) ?? { material: index, source: 'original', amount: 1 };
        const override = applied.materials.get(index) ?? {};
        const opacity = override.opacity ?? facts.opacity;
        draws.push({
          object,
          resource,
          start: group.start,
          count: group.count,
          material,
          index,
          facts,
          mapped,
          recipe: modelRecipeOf(mapped),
          override,
          blended: facts.alphaMode === 2 || opacity < 1,
          depth,
        });
      }
    });
    draws.sort((a, b) => a.blended === b.blended ? (a.blended ? b.depth - a.depth : 0) : (a.blended ? 1 : -1));

    const transforms = new Float32Array(9 * MODEL_SLOTS.length);
    const mapOn = new Int32Array(MODEL_SLOTS.length);
    const mapUv = new Int32Array(MODEL_SLOTS.length);
    let posed: THREE.Mesh | null = null;
    for (const entry of draws) {
      if (posed !== entry.object) {
        pose(meshProgram, entry.object, entry.resource);
        posed = entry.object;
      }
      const { facts, recipe, override } = entry;
      const color = rgb(palette[paletteIndex(entry.mapped.source)] ?? 0xffffff);
      MODEL_SLOTS.forEach((slot, at) => {
        const use = entry.index >= 0 ? instance.slots.get(slotId(entry.index, slot)) : undefined;
        const view = use ? textures.lookup(use.key, use.srgb) : null;
        const ready = view?.texture ?? null;
        mapOn[at] = ready ? 1 : 0;
        mapUv[at] = Math.min(use?.authored?.texCoord ?? 0, entry.resource.uvSets > 1 ? 1 : 0);
        transforms.set(uvTransform(use?.authored ?? null, recipe, override, recipe.projection).elements, at * 9);
        bindSlot(MODEL_MATERIAL_UNITS[at]!, ready, ready && use ? samplerFor(use.sampler) : null);
      });
      gl.uniform1iv(meshProgram.uniform('uMapOn[0]'), mapOn);
      gl.uniform1iv(meshProgram.uniform('uMapUv[0]'), mapUv);
      gl.uniformMatrix3fv(meshProgram.uniform('uMapTransform[0]'), false, transforms);
      gl.uniform1i(meshProgram.uniform('uProjection'), recipe.projection === 'triplanar' ? 1 : 0);
      gl.uniform4f(meshProgram.uniform('uBaseColor'), facts.color[0], facts.color[1], facts.color[2], facts.color[3]);
      gl.uniform3f(meshProgram.uniform('uEmissive'), facts.emissive[0], facts.emissive[1], facts.emissive[2]);
      gl.uniform1f(meshProgram.uniform('uEmissiveStrength'), override['emissive-strength'] ?? facts.emissiveStrength);
      gl.uniform1f(meshProgram.uniform('uMetallic'), override.metallic ?? facts.metallic);
      gl.uniform1f(meshProgram.uniform('uRoughness'), override.roughness ?? facts.roughness);
      gl.uniform1f(meshProgram.uniform('uOpacity'), override.opacity ?? facts.opacity);
      gl.uniform1i(meshProgram.uniform('uAlphaMode'), facts.alphaMode);
      gl.uniform1f(meshProgram.uniform('uAlphaCutoff'), facts.alphaCutoff);
      gl.uniform1i(meshProgram.uniform('uUnlit'), facts.unlit ? 1 : 0);
      gl.uniform1f(meshProgram.uniform('uTextureMix'), override['texture-mix'] ?? recipe.textureMix);
      const authoredNormal = entry.index >= 0 ? materialTextureUse(instance.asset.capabilities.materials[entry.index]!, 'normal') : null;
      const authoredOcclusion = entry.index >= 0 ? materialTextureUse(instance.asset.capabilities.materials[entry.index]!, 'occlusion') : null;
      gl.uniform1f(meshProgram.uniform('uNormalStrength'), (override['normal-strength'] ?? recipe.normalStrength) * (authoredNormal?.strength ?? 1));
      gl.uniform1f(meshProgram.uniform('uOcclusionStrength'), (override['occlusion-strength'] ?? recipe.occlusionStrength) * (authoredOcclusion?.strength ?? 1));
      gl.uniform1f(meshProgram.uniform('uRim'), override.rim ?? recipe.rim);
      gl.uniform1f(meshProgram.uniform('uScan'), override.scan ?? recipe.scan);
      gl.uniform1f(meshProgram.uniform('uBands'), override.bands ?? recipe.bands);
      gl.uniform3f(meshProgram.uniform('uPalette'), color[0], color[1], color[2]);
      gl.uniform1f(meshProgram.uniform('uMappingAmount'), entry.mapped.amount);
      gl.uniform1i(meshProgram.uniform('uSource'), sourceIndex(entry.mapped.source));

      if (facts.doubleSided) gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      }
      gl.frontFace(entry.object.matrixWorld.determinant() < 0 ? gl.CW : gl.CCW);
      gl.depthMask(!entry.blended);
      if (entry.resource.indexed) {
        const size = entry.resource.indexType === gl.UNSIGNED_INT ? 4 : entry.resource.indexType === gl.UNSIGNED_SHORT ? 2 : 1;
        gl.drawElements(entry.resource.mode, entry.count, entry.resource.indexType, entry.start * size);
      } else gl.drawArrays(entry.resource.mode, entry.start, entry.count);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  };

  const bindOutput = (program: Program, index: number, name: 'Base' | 'Mask', texture: WebGLTexture) => {
    const unit = 8 + index * 2 + (name === 'Mask' ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.uniform(`uModel${name}${index}`), unit);
  };

  const clearTarget = (instance: Instance, width: number, height: number) => {
    try {
      instance.target.resize(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, instance.target.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, instance.target.width, instance.target.height);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } catch {
      // If allocation itself failed, the existing target remains the
      // safest texture to bind; the compositor still reports the cause.
    }
  };

  return {
    get error() {
      const instance = [...held.values()].find((entry) => entry.trouble);
      if (instance?.trouble) return instance.trouble;
      for (const entry of held.values()) {
        for (const use of entry.slots.values()) {
          const view = textures.lookup(use.key, use.srgb);
          if (view?.error) return `${entry.asset.name}: ${view.error}`;
        }
      }
      return null;
    },
    get resources() {
      const stats = textures.stats();
      return {
        instances: held.size,
        geometries: [...held.values()].reduce((sum, instance) => sum + instance.geometry.size, 0),
        targets: held.size,
        shadows: [...held.values()].filter((instance) => instance.shadow).length,
        loading: [...held.values()].filter((instance) =>
          !instance.trouble && (!instance.root || textures.pendingFor(instance.owner) > 0)).length,
        textures: stats.textures,
        textureBytes: stats.bytes,
        decoding: stats.decoding,
        textureReuse: stats.reuse,
      };
    },
    bind(program, models, library, sample, palette, width, height, scope = '', views, seconds = 0) {
      const active = new Set(models.map((model) => model.index));
      for (const [index, instance] of held) {
        if (active.has(index)) continue;
        freeInstance(instance);
        held.delete(index);
      }
      const outputs: [WebGLTexture, WebGLTexture][] = [];
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
          outputs.push([blank, blank]);
          continue;
        }
        const key = `${scope}:${model.id}:${setup.revision}:${asset.hash}`;
        let instance = held.get(index);
        if (!instance || instance.key !== key) {
          if (instance) freeInstance(instance);
          instance = make(key, setup, asset);
          held.set(index, instance);
        }
        // Material mappings, recipes, published defaults and preview camera
        // selection are setup metadata, not immutable GLB resources. Keep the
        // loaded instance and apply the current metadata instead of flashing
        // through a fetch/parse cycle for every setup-editor keystroke.
        instance.setup = setup;
        try {
          wantTextures(instance, library);
          draw(instance, model, sample, palette, width, height, views?.[model.id], seconds);
          if (!limitTrouble) instance.trouble = null;
        } catch (error) {
          // A malformed geometry or an exhausted target must not take the
          // whole colour graph down. Keep the failure visible through
          // `ModelBank.error`, clear this model to transparent, and let every
          // downstream blend/grade/output continue to draw.
          instance.trouble = `${asset.name}: ${(error as Error).message}`;
          clearTarget(instance, width, height);
        }
        outputs.push([instance.target.base, instance.target.mask]);
      }
      // The material units and their sampler objects are this pass's alone;
      // hand them back clean, or the flow program's own samplers on 0–4 would
      // read through a model sampler's wrap and filter state.
      for (const unit of MODEL_MATERIAL_UNITS) bindSlot(unit, null, null);
      gl.depthMask(true);
      // Output bindings write uniforms belonging to the flow program, after
      // every model draw has changed the active program.
      gl.useProgram(program.program);
      outputs.forEach(([base, mask], index) => {
        bindOutput(program, index, 'Base', base);
        bindOutput(program, index, 'Mask', mask);
      });
    },
    clear() {
      for (const instance of held.values()) freeInstance(instance);
      held.clear();
    },
    free() {
      this.clear();
      textures.free();
      for (const sampler of samplers.values()) gl.deleteSampler(sampler);
      samplers.clear();
      gl.deleteTexture(blank);
      gl.deleteProgram(meshProgram.program);
      gl.deleteProgram(shadowProgram.program);
    },
  };
}
