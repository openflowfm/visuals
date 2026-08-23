/**
 * The GLSL every flow is built out of.
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
 * and a flow decides where it comes from by wiring an `energy` node. `uEnergy`
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
