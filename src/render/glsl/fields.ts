/**
 * Fixed work performed by one evaluation of each bounded field.
 *
 * A visit is one feature-point, gradient-corner, or density evaluation. The
 * circuit compiler charges these numbers every time a field is read, so a
 * spread sampling a field several times cannot hide its cost inside a small
 * GLSL function call.
 */
export const FIELD_WORK = {
  cells: 9,
  clouds: 16,
  metaballs: 4,
} as const;

export type FieldMode = keyof typeof FIELD_WORK;

/** The most expensive single field evaluation. The graph owns the total cap. */
export const FIELD_MAX_WORK = Math.max(...Object.values(FIELD_WORK));

/**
 * Three standard scalar fields, each behind a statically bounded amount of
 * work and returned as the same unpremultiplied colour-and-coverage shape as a
 * source generator.
 *
 * The lattice hash uses integer arithmetic rather than `sin`: uint operations
 * have exact wraparound semantics in GLSL ES 3, which makes fixed probes agree
 * across GPU drivers and gives a CPU reference something honest to reproduce.
 */
export const FIELD_LIB = `
uint fieldHashBits(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}

float fieldHash(ivec2 cell) {
  uint seed = uint(floor(abs(uSeed) * 4096.0));
  uint bits = uint(cell.x) * 0x9e3779b9u ^ uint(cell.y) * 0x85ebca6bu ^ seed;
  return float(fieldHashBits(bits) & 0x00ffffffu) / 16777215.0;
}

vec2 fieldFeature(ivec2 cell) {
  return vec2(fieldHash(cell), fieldHash(cell + ivec2(37, 17)));
}

// Worley F1: the distance to the nearest jittered feature point in the local
// 3x3 lattice neighbourhood. Nine candidates, always.
float fieldWorleyF1(vec2 p) {
  ivec2 home = ivec2(floor(p));
  vec2 local = fract(p);
  float nearest = 2.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 offset = ivec2(x, y);
      vec2 delta = vec2(offset) + fieldFeature(home + offset) - local;
      nearest = min(nearest, length(delta));
    }
  }
  return clamp(nearest * 0.70710678118, 0.0, 1.0);
}

vec2 fieldGradient(ivec2 cell) {
  float angle = fieldHash(cell) * 6.28318530718;
  return vec2(cos(angle), sin(angle));
}

// Two-dimensional gradient noise. One call visits the four corners around p.
float fieldGradientNoise(vec2 p) {
  ivec2 cell = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 fade = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(fieldGradient(cell), f);
  float b = dot(fieldGradient(cell + ivec2(1, 0)), f - vec2(1.0, 0.0));
  float c = dot(fieldGradient(cell + ivec2(0, 1)), f - vec2(0.0, 1.0));
  float d = dot(fieldGradient(cell + ivec2(1, 1)), f - vec2(1.0));
  return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
}

// Fixed-octave fBm: four gradient-noise octaves, lacunarity 2 and gain 1/2.
// The conservative sqrt(2) bound contains one gradient-noise octave before the
// normalized sum is moved into 0..1.
float fieldFbm(vec2 p) {
  float total = 0.0;
  float amplitude = 1.0;
  float normalizer = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    total += fieldGradientNoise(p) * amplitude;
    normalizer += amplitude;
    p = p * 2.0 + vec2(19.1, 7.7);
    amplitude *= 0.5;
  }
  return clamp(0.5 + 0.5 * total / (normalizer * 1.41421356237), 0.0, 1.0);
}

// Four Gaussian densities. Gaussian kernels stay finite at their centres,
// unlike inverse-square metaballs, and their sum is normalized to 0..1.
float fieldMetaballDensity(vec2 p, float e) {
  float total = 0.0;
  float spread = mix(8.0, 18.0, e);
  for (int i = 0; i < 4; i++) {
    ivec2 key = ivec2(i * 13 + 5, i * 29 + 11);
    float angle = fieldHash(key) * 6.28318530718 +
                  uBeat * mix(-0.16, 0.16, fieldHash(key + ivec2(7, 3)));
    float orbit = mix(0.12, 0.48, fieldHash(key + ivec2(17, 23)));
    vec2 centre = vec2(cos(angle), sin(angle)) * orbit;
    vec2 delta = p - centre;
    total += exp(-dot(delta, delta) * spread);
  }
  return clamp(total * 0.25, 0.0, 1.0);
}

vec4 field_cells(vec2 p, float e) {
  float f1 = fieldWorleyF1(p * mix(4.0, 12.0, e));
  float body = 1.0 - smoothstep(0.12, 0.58, f1);
  float contour = 1.0 - smoothstep(0.0, 0.06, abs(f1 - 0.34));
  vec3 colour = mix(uColor * (0.45 + body * 0.55), vec3(1.0) - uColor, contour * 0.35);
  return vec4(colour, clamp(body * 0.75 + contour * 0.45, 0.0, 1.0));
}

vec4 field_clouds(vec2 p, float e) {
  vec2 drift = vec2(uTime * 0.035, uTime * 0.021);
  float density = fieldFbm(p * mix(1.4, 3.8, e) + drift);
  float coverage = smoothstep(0.34 - uLevel * 0.08, 0.72, density);
  vec3 colour = mix(uColor * 0.5, mix(uColor, vec3(1.0), 0.42), density);
  return vec4(colour, coverage);
}

vec4 field_metaballs(vec2 p, float e) {
  float density = fieldMetaballDensity(p, e);
  float coverage = smoothstep(0.07, 0.23, density);
  float rim = 1.0 - smoothstep(0.0, 0.04, abs(density - 0.16));
  vec3 colour = mix(uColor, vec3(1.0) - uColor, rim * 0.45);
  return vec4(colour, clamp(coverage + rim * 0.25, 0.0, 1.0));
}
`;
