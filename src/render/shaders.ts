import { SOURCES } from '../../protocol.ts';
import { PREAMBLE } from './glsl/common.ts';
import { EFFECT_LIB } from './glsl/effects.ts';
import { FIELD_LIB } from './glsl/fields.ts';
import { FRACTAL_LIB } from './glsl/fractal.ts';
import { LIGHT_LIB } from './glsl/light.ts';
import { GENERATOR_LIB, SOURCE_VALUES } from './glsl/sources.ts';

export { PREAMBLE } from './glsl/common.ts';
export { EFFECT_LIB } from './glsl/effects.ts';
export { FIELD_LIB, FIELD_MAX_WORK, FIELD_WORK } from './glsl/fields.ts';
export { FRACTAL_ITERATIONS, FRACTAL_LIB } from './glsl/fractal.ts';
export { LIGHT_LIB, LIGHT_WORK } from './glsl/light.ts';
export { GENERATOR_LIB } from './glsl/sources.ts';

/**
 * The preamble a compiled flow gets, sized to the graph it is for.
 *
 * `uParams` is the bank every number rides in — a `value` node's amount and every
 * number set on an inlet's own face. A bank rather than a uniform each because
 * which numbers a graph has is discovered from its nodes and cannot be declared
 * ahead of time, and a value in a uniform is one you can turn without
 * recompiling. That last part is the whole point: `signatureOf` deliberately
 * leaves those values out, so dragging one does not rebuild a shader sixty times
 * a second.
 *
 * **The size is a parameter because the shader is generated.** Every inlet
 * carrying a number would be a fixed bank of hundreds, most of them unread; a
 * bank cut to fit costs one recompile the first time an inlet is given a value
 * and nothing at all afterwards. One floor: GLSL rejects a zero-length array,
 * so a flow that sets nothing at all still declares one.
 *
 * `uTracksTex` is the Live set's own picture, drawn by the pass a `tracks` node
 * stands for. It is the one texture a flow reads, and the only reason there is
 * still more than one pass in this renderer.
 */
export const flowPreamble = (values: number): string => `${PREAMBLE}
uniform sampler2D uTracksTex;
uniform sampler2D uVideo0;
uniform sampler2D uVideo1;
uniform vec2 uVideoSize[2];
uniform float uParams[${Math.max(1, values)}];
// Meters of tracks a flow NAMED, in the order its track nodes appear, and
// energies computed on the CPU for its energy nodes. Banks rather than a
// uniform each, for the same reason uParams is one.
uniform float uTracks[8];
// Facts about the song that is playing: a stable hash of its name, its tempo,
// its key as a pitch class over twelve, and where the section sits in the song.
uniform float uSongSeed;
uniform float uSongTempo;
uniform float uSongKey;
uniform float uSection;
uniform float uSections;

${GENERATOR_LIB}

${FIELD_LIB}

${LIGHT_LIB}

${FRACTAL_LIB}

${EFFECT_LIB}

// A generator's raw (colour, coverage) as the premultiplied, charged vec4 the
// rest of the vocabulary passes about — the same shape cPaint produces, so a
// source node and a paint node are interchangeable downstream.
vec4 laid(vec4 g, float e) {
  float a = clamp(g.a, 0.0, 1.0);
  return vec4(charge(g.rgb, e) * a, a);
}

// The Live set's own picture, at a point.
vec4 fromTracks(vec2 p) {
  return texture(uTracksTex, clamp(uncentred(p), 0.0, 1.0));
}

vec2 videoUv(vec2 p, vec2 size) {
  vec2 uv = uncentred(p);
  float frameAspect = uRes.x / max(uRes.y, 1.0);
  float sourceAspect = size.x / max(size.y, 1.0);
  if (sourceAspect > frameAspect) uv.x = (uv.x - 0.5) * frameAspect / sourceAspect + 0.5;
  else uv.y = (uv.y - 0.5) * sourceAspect / frameAspect + 0.5;
  return clamp(uv, 0.0, 1.0);
}

vec4 fromVideo0(vec2 p) {
  vec4 c = texture(uVideo0, videoUv(p, uVideoSize[0]));
  return vec4(c.rgb * c.a, c.a);
}

vec4 fromVideo1(vec2 p) {
  vec4 c = texture(uVideo1, videoUv(p, uVideoSize[1]));
  return vec4(c.rgb * c.a, c.a);
}
`;

/**
 * One Live track, drawn.
 *
 * The `tracks` node is a pass rather than an expression, because it draws the
 * same picture once per playing track with a different colour, meter and fader
 * each time — which a single fragment shader cannot do without evaluating the
 * whole thing N times. It is the only multi-pass thing left in the renderer, and
 * it is the last surviving piece of the compositor this replaced.
 */
export const TRACK_SHADERS: ReadonlyMap<string, string> = new Map(
  SOURCES.map((name) => [
    name,
    `${PREAMBLE}
${GENERATOR_LIB}
void main() {
  vec4 g = gen_${name}(centred(), uEnergy${', uEnergy'.repeat(SOURCE_VALUES[name].length)});
  OUT(g.rgb, g.a)
}`,
  ]),
);
