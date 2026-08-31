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
 * `uTime` is nonetheless **shared**: seconds since the *server* started, riding
 * the anchor and extrapolated locally the same way the beat is. It used to be
 * counted from whenever each window opened, which made every haze and sway a
 * fact about a boot time and put two render boxes minutes out of phase. Link
 * could not have fixed it — Link shares a beat timeline, not a host clock, and
 * deriving seconds from the beat would put drift back in tempo.
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
// Required, not decorative. In GLSL ES 3.00 a *fragment* shader defaults int
// and uint to mediump, which is only guaranteed sixteen bits -- and every hash
// here is a 32-bit bit-mixer whose whole correctness is exact wraparound. Most
// desktop drivers hand out 32-bit ints regardless, which is why this was never
// visibly wrong; a tiler that honours the default would have truncated every
// lattice hash in the library.
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;     // seconds since the SERVER started; drift, not tempo
// Seconds since the previous drawn frame. The only per-FRAME quantity in here,
// and it exists for exactly one customer: a feedback trail decays once per
// frame, so without this its length would be a fact about the display rather
// than about the show -- half as long on a 120Hz panel as on the projector it
// was dialled in on. See fromLast in shaders.ts.
uniform float uDt;
uniform float uBeat;     // continuous Link beats
uniform float uPhase;    // position within the quantum, in beats
uniform float uQuantum;
uniform float uLevel;    // the meter this pass is about, 0-1
uniform float uEnergy;   // the ROOM's energy: a smoothed master meter. A default.
uniform float uOpacity;
// The colourway, by role. One array rather than five uniforms because the roles
// are a fixed vocabulary and the track pass overwrites only the first slot.
uniform vec3  uColors[5];
#define uPrimary    uColors[0]
#define uSecondary  uColors[1]
#define uComplement uColors[2]
#define uAccent     uColors[3]
#define uChalk      uColors[4]
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

// A hash, not a stream.
//
// fract(sin(dot(p, k)) * 43758.5453) was here, and it is well distributed --
// that was never the problem. The problem is that it is *chaotically* sensitive
// to the last bits of sin: multiplying by 43758 and taking the fraction turns a
// one-ulp disagreement into a completely different number. Evaluated at 32-bit
// instead of 64-bit precision, the same expression on the same inputs disagrees
// about half the time -- so what it returned was a property of the driver that
// compiled it rather than of the flow.
//
// That mattered in one place far more than the rest. rate() uses this to pick
// which musical division something pulses on, so a value that moves is a flow
// that changes tempo, and two render boxes could not agree about it.
//
// Integer bit-mixing instead: the same lowbias32 mixer fields.ts already uses,
// for the reason written there. uint operations have exact wraparound in GLSL
// ES 3, so a fixed probe agrees across drivers and a CPU mirror can reproduce
// it honestly. floatBitsToUint rather than quantising, because it is one
// instruction, exact for every finite input, and has no range to overflow.
// Only -0.0 and +0.0 hash apart, which no caller here can produce for one cell.
uint hashBits(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}

float hash(vec2 p) {
  uvec2 bits = floatBitsToUint(p);
  uint mixed = hashBits(bits.x * 0x9e3779b9u)
             ^ hashBits(bits.y * 0x85ebca6bu)
             ^ hashBits(floatBitsToUint(uSeed));
  return float(hashBits(mixed) & 0x00ffffffu) / 16777215.0;
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
