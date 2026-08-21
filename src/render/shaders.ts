import { SOURCES } from '../../protocol.ts';

/**
 * The GLSL every look is built out of.
 *
 * **The clock is a uniform, not a timer.** Nothing here reads a wall clock or
 * counts frames: `uBeat` and `uPhase` come from Link, so a shape that grows over
 * one bar grows over one *musical* bar and stays with the music when the tempo
 * moves. That is the whole reason this rig exists rather than a screensaver, and
 * why `uTime` is present but barely used — it is for drift and shimmer, things
 * that should specifically *not* be in time.
 *
 * ## Energy is an argument now, not a uniform
 *
 * It used to be the one number the whole show agreed about: an archetype set it,
 * a cascade biased it, and every shader read `uEnergy` without being asked. That
 * made "energy" mean exactly one thing forever, when in practice it means
 * whatever you decide — often a particular track's, often the bass.
 *
 * So `rate`, `beatPulse`, `charge` and every generator take it as a parameter,
 * and a look decides where it comes from by wiring an `energy` node. `uEnergy`
 * survives as **the room's** energy — a smoothed master meter — which is what an
 * unwired energy inlet falls back to. A default, not a level.
 */
export const PREAMBLE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;     // seconds; for drift that should NOT be in time
uniform float uBeat;     // continuous Link beats
uniform float uPhase;    // position within the quantum, in beats
uniform float uQuantum;
uniform float uLevel;    // the meter this pass is about, 0-1
uniform float uEnergy;   // the ROOM's energy: a smoothed master meter. A default.
uniform float uOpacity;
uniform vec3  uColor;
uniform float uSeed;
uniform float uPace;     // whole rungs along the division ladder, -2 to +2

#define PI 3.14159265359

// Aspect-corrected coordinates centred on the screen, so a circle is round.
vec2 centred() {
  vec2 p = vUv - 0.5;
  p.x *= uRes.x / uRes.y;
  return p;
}

// And back, for anything that has finished moving a point about and wants to
// read the picture at it.
vec2 uncentred(vec2 p) {
  p.x /= uRes.x / uRes.y;
  return p + 0.5;
}

// The other direction, for the handful of effects whose maths is written in
// screen space. Exactly the inverse of uncentred, so a remap can drop into uv,
// do its work and come back without anyone else learning the frame's shape.
vec2 recentred(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= uRes.x / uRes.y;
  return p;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// How often something reacts, in events per beat, on a ladder of musical
// divisions: once every two bars, once a bar, every two beats, every beat,
// eighths, triplets. Quantised rather than smeared across them, because a rate
// *between* an eighth and a triplet is in time with nothing.
//
// Three things choose the rung. The energy handed in moves it up the ladder. A
// hash of the pass's seed spreads things a couple of rungs either side, because
// one number alone put everything on the same division and twenty-three things
// pulsing in unison is one flash however many are drawing it. And uPace shifts
// the lot, for a room that wants the whole show slower or quicker.
float rate(float e) {
  float steps[6] = float[6](0.125, 0.25, 0.5, 1.0, 2.0, 3.0);
  float rung = e * 3.2 + hash(vec2(11.3, 4.7)) * 2.2 + uPace;
  return steps[int(clamp(floor(rung), 0.0, 5.0))];
}

// 1 on the beat, decaying to 0 across it. The shape every reactive thing here
// is built from, so "on the beat" means one thing everywhere. Higher energy
// sharpens the decay, so a loud passage punches instead of swelling.
float beatPulse(float division, float e) {
  return pow(1.0 - fract(uBeat * division), mix(2.5, 5.0, e));
}

// Brightness and contrast, the cheap half of what energy is for. It reads
// instantly on a projector and costs one multiply.
//
// **Contrast about a pivot, not a squared multiply.** The old shape scaled the
// colour and then squared it, which put a white pixel at 1.9 and meant
// everything above 0.66 came out flat white before anything had been
// composited. This pushes the darks down as it lifts, which is what contrast
// actually is, and leaves headroom for the output stage's shoulder.
vec3 charge(vec3 c, float e) {
  vec3 lifted = c * mix(0.8, 1.1, e);
  return clamp((lifted - 0.28) * mix(1.0, 1.3, e) + 0.28, 0.0, 1.2);
}

#define OUT(rgb, a) { float _a = (a) * uOpacity; fragColor = vec4(charge(rgb, uEnergy) * _a, _a); }
`;

/**
 * Each picture as a **function of a point and an energy**.
 *
 * This is what makes "the sources are nodes" true rather than claimed. A
 * generator used to be a whole `void main()`, which meant the only way to get a
 * picture out of one was to give it a pass of its own — and that is exactly what
 * forced composition out of the graph and into a stack of full-screen passes.
 *
 * Each returns an **unpremultiplied** `vec4(rgb, coverage)` and neither charges
 * nor fades: who does that depends on where the picture is going. The track pass
 * hands it to `OUT`; a `source` node hands it to `laid`. Doing it here would do
 * it twice.
 */
const GENERATOR_BODIES: Record<string, string> = {
  solid: `
  // The plainest picture there is: the colour, breathing on the bar and
  // brightening with the sound. The one source that fills the frame at full
  // alpha, which makes it the one that can hide everything under it — so its
  // brightness stays well short of white.
  float breathe = 0.55 + 0.45 * (1.0 - uPhase / uQuantum);
  return vec4(uColor * (breathe * 0.6 + uLevel * 0.45), 1.0);`,

  bars: `
  // Vertical bars whose heights are a bar of music: each column is one
  // subdivision, and the playhead sweeps them. Energy adds columns, so the
  // same source is coarse when it is quiet and dense when it is not.
  vec2 uv = uncentred(p);
  float columns = mix(8.0, 32.0, e);
  float x = floor(uv.x * columns);
  float head = floor((uPhase / uQuantum) * columns);
  float lit = step(abs(x - head), 0.5);
  float height = 0.2 + 0.8 * hash(vec2(x, floor(uBeat / uQuantum))) * (0.3 + uLevel);
  float bar = step(uv.y, height);
  return vec4(uColor * (0.35 + 0.65 * lit), bar * (0.35 + 0.65 * lit));`,

  rings: `
  // Rings launched on the beat and expanding outward, so the picture carries
  // the pulse even when the sound is quiet.
  float r = length(p);
  float total = 0.0;
  float speed = rate(e);
  for (int i = 0; i < 4; i++) {
    float age = fract(uBeat * speed - float(i) * 0.25);
    float radius = age * mix(0.55, 0.95, e);
    total += smoothstep(0.03, 0.0, abs(r - radius)) * (1.0 - age);
  }
  return vec4(uColor, clamp(total * (0.6 + uLevel * 1.4), 0.0, 1.0));`,

  noise: `
  // A drifting field that thickens with the sound. The drift is on uTime
  // deliberately — it should feel like weather, not like a metronome.
  vec2 q = p * mix(2.5, 6.0, e);
  float n = noise(q + vec2(uTime * 0.15, uTime * 0.1));
  n += 0.5 * noise(q * 2.3 - uTime * 0.2);
  n /= 1.5;
  float threshold = mix(0.72, 0.42, e) - uLevel * 0.25;
  return vec4(uColor * (0.6 + n), smoothstep(threshold, threshold + 0.18, n));`,

  strobe: `
  // Whole-frame flashes on the beat division energy chose. The one source with
  // no shape at all, and the reason opacity has to be honest. It leans on the
  // colour rather than on white, and its silent floor is low: a strobe with
  // nothing playing through it flashing at a third of full is the whole frame
  // going off on every beat for no reason at all.
  float flash = beatPulse(rate(e), e);
  return vec4(mix(uColor, vec3(1.0), 0.3), flash * (0.1 + uLevel * 0.75));`,

  grid: `
  // A grid of cells, each lighting on its own beat. Reads as structure rather
  // than as motion, which is what a busy frame wants under everything else.
  vec2 uv = uncentred(p);
  vec2 cells = mix(vec2(5.0, 3.0), vec2(12.0, 8.0), e);
  vec2 id = floor(uv * cells);
  vec2 f = fract(uv * cells);
  float when = hash(id);
  float lit = pow(1.0 - fract(uBeat * rate(e) * 0.5 + when), 6.0);
  float inset = smoothstep(0.0, 0.06, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  return vec4(uColor * (0.5 + lit), inset * (0.12 + lit * (0.55 + uLevel * 0.45)));`,

  tunnel: `
  // A corridor rushing toward you. Depth is 1/r, which is what makes it read as
  // perspective rather than as rings — and the rush is on the beat, so the room
  // moves through it in time rather than at a rate of its own.
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  float depth = uBeat * rate(e) * 0.45 + 0.16 / r;
  float rings = smoothstep(0.82, 1.0, abs(fract(depth) * 2.0 - 1.0));
  float arms = floor(mix(4.0, 12.0, e));
  float spokes = smoothstep(0.86, 1.0, abs(fract(a / PI * arms) * 2.0 - 1.0));
  float lit = max(rings, spokes * 0.8);
  // Fades into the vanishing point, where the maths goes to infinity anyway.
  float fade = smoothstep(0.02, 0.3, r);
  return vec4(mix(uColor, vec3(1.0), rings * 0.4), lit * fade * (0.35 + uLevel * 0.9));`,

  plasma: `
  // Four sines crossed. The oldest trick there is and still the best full-frame
  // wash — it never repeats visibly, it costs nothing, and it takes a colour and
  // its complement rather than a fixed palette.
  vec2 q = p * mix(2.0, 5.0, e);
  float t = uBeat * rate(e) * 0.25;
  float v = sin(q.x + t) + sin(q.y * 1.3 - t) + sin((q.x + q.y) * 0.7 + t * 0.8)
          + sin(length(q) * 2.2 - t * 1.6);
  v = v * 0.125 + 0.5;
  return vec4(mix(uColor, vec3(1.0) - uColor, v) * (0.45 + uLevel * 0.7), 0.3 + v * 0.55);`,

  spiral: `
  // Arms winding out of the centre and turning on the beat. Reads as motion
  // with a direction, which nothing else here does — rings expand, this rotates.
  float r = length(p);
  float arms = floor(mix(2.0, 7.0, e));
  float band = 0.5 + 0.5 * sin(atan(p.y, p.x) * arms + r * mix(7.0, 22.0, e)
                               - uBeat * rate(e) * PI);
  band = smoothstep(0.45, 0.85, band);
  float fade = 1.0 - smoothstep(0.16, 0.64, r);
  return vec4(uColor * (0.5 + band * 0.7), band * fade * (0.4 + uLevel));`,

  scan: `
  // Lines, with a bar's worth of sweep passing down them. The one source that
  // looks like a machine rather than like weather, which a set of them needs.
  vec2 uv = uncentred(p);
  float lines = mix(40.0, 170.0, e);
  float line = smoothstep(0.4, 0.5, abs(fract(uv.y * lines) - 0.5));
  float head = 1.0 - uPhase / uQuantum;
  float sweep = pow(1.0 - min(abs(uv.y - head) * 3.5, 1.0), 3.0);
  return vec4(mix(uColor, vec3(1.0), sweep * 0.55),
              clamp(line * (0.16 + sweep * 1.5) * (0.45 + uLevel), 0.0, 1.0));`,

  sparks: `
  // A cell per spark, each firing on its own beat and drifting as it dies. The
  // aspect correction is on the cell count rather than the coordinates, so a
  // spark stays round on a wide frame.
  vec2 uv = uncentred(p);
  float density = mix(9.0, 24.0, e);
  vec2 g = uv * vec2(density * uRes.x / uRes.y, density);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float life = fract(uBeat * rate(e) * 0.5 + hash(id));
  float pop = pow(1.0 - life, 5.0);
  vec2 drift = (vec2(hash(id + 3.7), hash(id + 9.1)) - 0.5) * 0.7;
  float spark = smoothstep(0.02 + 0.18 * pop, 0.0, length(f - drift * life));
  return vec4(mix(uColor, vec3(1.0), 0.35), spark * pop * (0.35 + uLevel * 0.9));`,
};

/**
 * All of them as GLSL, compiled into every look.
 *
 * Every shader carries all eleven whether or not it calls one, because the
 * alternative — emitting only what a graph reached — makes the shader a function
 * of the wiring in a second way and gives the cache signature a second thing to
 * get wrong. A driver drops an uncalled function.
 */
export const GENERATOR_LIB = SOURCES.map(
  (name) => `vec4 gen_${name}(vec2 p, float e) {${GENERATOR_BODIES[name]}\n}`,
).join('\n\n');

/**
 * The point remaps and colour operations the `effect` node's modes are built
 * from, for the ones that are a single read of their input.
 *
 * The multi-tap effects — `shift`, `smear`, `bloom`, `edge` — are not here.
 * They read their input at several points, and under a graph an input is an
 * expression rather than a texture, so what to read *is* the compiler's
 * business. See `circuit.ts`.
 */
export const EFFECT_LIB = `
vec2 fxMirror(vec2 p, float line, float angle) {
  float a = angle * PI;
  float c = cos(a), s = sin(a);
  vec2 q = mat2(c, -s, s, c) * p;
  float at = (line - 0.5) * 2.0;
  q.x = at - abs(q.x - at);
  return mat2(c, s, -s, c) * q;
}

vec2 fxKaleido(vec2 p, float segments, float spin, float e) {
  float n = floor(max(2.0, 2.0 + segments * 10.0 + e * 4.0));
  float a = atan(p.y, p.x) + uBeat * (spin - 0.5) * 0.6;
  float r = length(p);
  float wedge = PI / n;
  a = abs(mod(a, wedge * 2.0) - wedge);
  return vec2(cos(a), sin(a)) * r;
}

vec2 fxPixelate(vec2 p, float blocks, float resolve, float e) {
  vec2 uv = uncentred(p);
  float base = mix(4.0 + blocks * 124.0, (4.0 + blocks * 124.0) * 0.45, e);
  float steps = max(2.0, mix(base, base * 4.0, (1.0 - uPhase / uQuantum) * resolve));
  return recentred((floor(uv * steps) + 0.5) / steps);
}

vec2 fxRipple(vec2 p, float waves, float depth, float speed, float e) {
  vec2 uv = uncentred(p);
  float r = length(p);
  float n = 2.0 + waves * 58.0;
  float wave = sin(r * mix(n * 0.7, n * 2.0, e) - uBeat * rate(e) * (0.25 + speed * 3.75) * PI * 2.0);
  float push = wave * depth * (0.01 + uLevel * 0.04);
  return recentred(uv + normalize(p + 1e-6) * push);
}

vec2 fxSlice(vec2 p, float bands, float throwBy, float e) {
  vec2 uv = uncentred(p);
  float n = floor(mix(5.0, 26.0, bands));
  float row = floor(uv.y * n);
  float tick = floor(uBeat * rate(e));
  float pick = hash(vec2(row * 1.7, tick));
  float push = (hash(vec2(row, tick * 2.3)) - 0.5) * throwBy * 0.5 * step(0.55, pick);
  // Wrapped rather than clamped: a slice that ran off the edge and smeared
  // would read as a broken texture instead of as a deliberate glitch.
  return recentred(vec2(fract(uv.x + push), uv.y));
}

vec2 fxTwist(vec2 p, float turn, float sway, float e) {
  float a = (turn - 0.5) * 9.0 * length(p) + sin(uBeat * rate(e) * PI * 0.5) * sway * 1.5;
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec4 fxPosterize(vec4 c, float levels) {
  float a = max(c.a, 1e-4);
  float steps = floor(mix(14.0, 2.0, levels));
  return vec4(clamp(floor(c.rgb / a * steps + 0.5) / steps, 0.0, 1.0) * c.a, c.a);
}

vec4 fxInvert(vec4 c, float hold, float speed, float e) {
  float a = max(c.a, 1e-4);
  float on = step(1.0 - hold, beatPulse(rate(e) * mix(0.5, 2.0, speed), e));
  return vec4(mix(c.rgb / a, vec3(1.0) - c.rgb / a, on) * c.a, c.a);
}
`;

/**
 * The preamble a compiled look gets, sized to the graph it is for.
 *
 * `uParams` is the bank every knob rides in — a `value` node's amount and every
 * number set on an inlet's own face. A bank rather than a uniform each because
 * which knobs a graph has is discovered from its nodes and cannot be declared
 * ahead of time, and a value in a uniform is one you can turn without
 * recompiling. That last part is the whole point: `signatureOf` deliberately
 * leaves knob values out, so dragging one does not rebuild a shader sixty times
 * a second.
 *
 * **The size is a parameter because the shader is generated.** Every inlet
 * carrying a number would be a fixed bank of hundreds, most of them unread; a
 * bank cut to fit costs one recompile the first time an inlet is given a value
 * and nothing at all afterwards. One floor: GLSL rejects a zero-length array,
 * so a look with no knobs at all still declares one.
 *
 * `uTracksTex` is the Live set's own picture, drawn by the pass a `tracks` node
 * stands for. It is the one texture a look reads, and the only reason there is
 * still more than one pass in this renderer.
 */
export const lookPreamble = (knobs: number): string => `${PREAMBLE}
uniform sampler2D uTracksTex;
uniform float uParams[${Math.max(1, knobs)}];
// Meters of tracks a look NAMED, in the order its track nodes appear, and
// energies computed on the CPU for its energy nodes. Banks rather than a
// uniform each, for the same reason uParams is one.
uniform float uTracks[8];
uniform float uEnergies[8];
// Facts about the song that is playing: a stable hash of its name, its tempo,
// its key as a pitch class over twelve, and where the section sits in the song.
uniform float uSongSeed;
uniform float uSongTempo;
uniform float uSongKey;
uniform float uSection;
uniform float uSections;

${GENERATOR_LIB}

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
  vec4 g = gen_${name}(centred(), uEnergy);
  OUT(g.rgb, g.a)
}`,
  ]),
);
