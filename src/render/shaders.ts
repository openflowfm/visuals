import type { BuiltinEffect, SourceKind } from '../../protocol.ts';

/**
 * Every source and built-in effect, as fragment shaders over one shared
 * preamble.
 *
 * **The clock is a uniform, not a timer.** Nothing here reads a wall clock or
 * counts frames: `uBeat` and `uPhase` come from Link, so a shape that grows over
 * one bar grows over one *musical* bar and stays with the music when the tempo
 * moves. That is the whole reason this rig exists rather than a screensaver, and
 * why `uTime` is present but barely used — it is for drift and shimmer, things
 * that should specifically *not* be in time.
 *
 * **Energy is a uniform too, and that is what makes an archetype dynamic.** A
 * section is not a different picture; it is the same picture with `uEnergy`
 * somewhere else, so a chorus reacts on eighths where the verse breathed on the
 * bar, sits brighter and harder-edged, and carries effects the verse did not.
 * The alternative — a section picking a different shader — makes archetypes a
 * lookup table and loses everything they were for.
 *
 * Everything writes **premultiplied alpha**, so the compositor can pick a blend
 * mode with fixed-function GL blending and never needs an accumulator buffer.
 * `OUT(rgb, a)` is the one way out of a source, and it does the multiply.
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
uniform float uLevel;    // this layer's output meter, 0-1
uniform float uEnergy;   // this layer's resolved energy, 0-1
uniform float uOpacity;  // this layer's fader, already gated by energy
uniform vec3  uColor;    // from the song's colourway, by depth
uniform float uSeed;

#define PI 3.14159265359

// Aspect-corrected coordinates centred on the screen, so a circle is round.
vec2 centred() {
  vec2 p = vUv - 0.5;
  p.x *= uRes.x / uRes.y;
  return p;
}

// And back, for anything that has finished moving a point about and wants to
// read the picture at it. The pair is what lets every geometric operation work
// in one space without each of them knowing the frame's shape.
vec2 uncentred(vec2 p) {
  p.x /= uRes.x / uRes.y;
  return p + 0.5;
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

// How often a layer reacts, in events per beat. The single biggest thing energy
// does: a calm section moves once every four beats, a loud one three times a
// beat. Quantised to musical divisions rather than smeared across them, because
// a rate between an eighth and a triplet is not in time with anything.
//
// **Per layer as well as per energy.** Energy alone put every layer on the same
// division, so a chorus was twenty-three layers flashing in unison — which is
// one flash, however many things are drawing it, and it reads as a strobe rather
// than as a picture. The offset is a hash of the layer's seed, so it is stable
// and it is still a musical division: one layer lands on the bar while another
// lands on eighths, and both are in time.
float rate() {
  float steps[5] = float[5](0.25, 0.5, 1.0, 2.0, 3.0);
  int i = int(clamp(floor(uEnergy * 3.6 + hash(vec2(11.3, 4.7)) * 1.4), 0.0, 4.0));
  return steps[i];
}

// 1 on the beat, decaying to 0 across it. The shape every reactive thing here
// is built from, so "on the beat" means one thing everywhere. Higher energy
// also sharpens the decay, so a loud section punches instead of swelling.
float beatPulse(float division) {
  return pow(1.0 - fract(uBeat * division), mix(2.5, 5.0, uEnergy));
}

// Brightness and contrast, the cheap half of what energy is for. It reads
// instantly on a projector and costs one multiply.
//
// **Contrast about a pivot, not a squared multiply.** The old shape scaled the
// colour and then squared it: at a chorus it put a white pixel at 1.9, which
// meant everything above 0.66 came out flat white *before a single layer had
// been composited*. A chorus was not brighter than a verse, it was clipped —
// every layer arrived as the same white with no shape left in it. This pushes
// the darks down as it lifts, which is what contrast actually is, and leaves a
// little headroom for the output stage's shoulder to work with rather than
// handing it a frame that has already lost the top.
vec3 charge(vec3 c) {
  vec3 lifted = c * mix(0.8, 1.1, uEnergy);
  return clamp((lifted - 0.28) * mix(1.0, 1.3, uEnergy) + 0.28, 0.0, 1.2);
}

#define OUT(rgb, a) { float _a = (a) * uOpacity; fragColor = vec4(charge(rgb) * _a, _a); }
`;

const SOURCES: Record<SourceKind, string> = {
  solid: `${PREAMBLE}
void main() {
  // The plainest layer there is: the song's colour, breathing on the bar and
  // brightening with the sound. It exists so a stack has something solid at the
  // bottom, and so a set nobody has configured still reads as a colour scheme.
  //
  // It is the one source that fills the frame at full alpha, which makes it the
  // one that can hide everything under it — so its *brightness* has to stay
  // well short of white. It used to reach 1.8x the colourway with the meter up,
  // which on most blends is a flat wash and on a plain over is a curtain.
  float breathe = 0.55 + 0.45 * (1.0 - uPhase / uQuantum);
  OUT(uColor * (breathe * 0.6 + uLevel * 0.45), 1.0)
}`,

  bars: `${PREAMBLE}
void main() {
  // Vertical bars whose heights are a bar of music: each column is one
  // subdivision, and the playhead sweeps them. Energy adds columns, so the
  // same source is coarse in a verse and dense in a chorus.
  float columns = mix(8.0, 32.0, uEnergy);
  float x = floor(vUv.x * columns);
  float head = floor((uPhase / uQuantum) * columns);
  float lit = step(abs(x - head), 0.5);
  float height = 0.2 + 0.8 * hash(vec2(x, floor(uBeat / uQuantum))) * (0.3 + uLevel);
  float bar = step(vUv.y, height);
  OUT(uColor * (0.35 + 0.65 * lit), bar * (0.35 + 0.65 * lit))
}`,

  rings: `${PREAMBLE}
void main() {
  // Rings launched on the beat and expanding outward, so the picture carries
  // the pulse even when the sound is quiet. Energy launches them more often
  // and drives them further.
  vec2 p = centred();
  float r = length(p);
  float total = 0.0;
  float speed = rate();
  for (int i = 0; i < 4; i++) {
    float age = fract(uBeat * speed - float(i) * 0.25);
    float radius = age * mix(0.55, 0.95, uEnergy);
    total += smoothstep(0.03, 0.0, abs(r - radius)) * (1.0 - age);
  }
  OUT(uColor, clamp(total * (0.6 + uLevel * 1.4), 0.0, 1.0))
}`,

  noise: `${PREAMBLE}
void main() {
  // A drifting field that thickens with the sound. The drift is on uTime
  // deliberately — it should feel like weather, not like a metronome — while
  // energy decides how much of the field survives the threshold.
  vec2 p = centred() * mix(2.5, 6.0, uEnergy);
  float n = noise(p + vec2(uTime * 0.15, uTime * 0.1));
  n += 0.5 * noise(p * 2.3 - uTime * 0.2);
  n /= 1.5;
  float threshold = mix(0.72, 0.42, uEnergy) - uLevel * 0.25;
  OUT(uColor * (0.6 + n), smoothstep(threshold, threshold + 0.18, n))
}`,

  strobe: `${PREAMBLE}
void main() {
  // Whole-frame flashes on the beat division energy chose. The one source with
  // no shape at all, and the reason opacity has to be honest: it is unusable
  // if a fader doesn't actually take it down.
  //
  // It leans on the song's colour rather than on white, and its silent floor is
  // low: a strobe layer with nothing playing through it used to flash at a third
  // of full whatever the track was doing, which on a stack of them is the whole
  // frame going off on every beat for no reason at all.
  float flash = beatPulse(rate());
  OUT(mix(uColor, vec3(1.0), 0.3), flash * (0.1 + uLevel * 0.75))
}`,

  grid: `${PREAMBLE}
void main() {
  // A grid of cells, each lighting on its own beat. Reads as structure rather
  // than as motion, which is what a chorus wants under everything else.
  vec2 cells = mix(vec2(5.0, 3.0), vec2(12.0, 8.0), uEnergy);
  vec2 id = floor(vUv * cells);
  vec2 f = fract(vUv * cells);
  float when = hash(id);
  float lit = pow(1.0 - fract(uBeat * rate() * 0.5 + when), 6.0);
  float inset = smoothstep(0.0, 0.06, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  OUT(uColor * (0.5 + lit), inset * (0.12 + lit * (0.55 + uLevel * 0.45)))
}`,
  tunnel: `${PREAMBLE}
void main() {
  // A corridor rushing toward you. Depth is 1/r, which is what makes it read as
  // perspective rather than as rings — and the rush is on the beat, so the room
  // moves through it in time rather than at a rate of its own.
  vec2 p = centred();
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  float depth = uBeat * mix(0.3, 1.4, uEnergy) + 0.16 / r;
  float rings = smoothstep(0.82, 1.0, abs(fract(depth) * 2.0 - 1.0));
  float arms = floor(mix(4.0, 12.0, uEnergy));
  float spokes = smoothstep(0.86, 1.0, abs(fract(a / PI * arms) * 2.0 - 1.0));
  float lit = max(rings, spokes * 0.8);
  // Fades into the vanishing point, where the maths goes to infinity anyway.
  float fade = smoothstep(0.02, 0.3, r);
  OUT(mix(uColor, vec3(1.0), rings * 0.4), lit * fade * (0.35 + uLevel * 0.9))
}`,

  plasma: `${PREAMBLE}
void main() {
  // Four sines crossed. The oldest trick there is and still the best full-frame
  // wash — it never repeats visibly, it costs nothing, and it takes a colourway
  // and its complement rather than a fixed palette.
  vec2 p = centred() * mix(2.0, 5.0, uEnergy);
  float t = uBeat * 0.3;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t) + sin((p.x + p.y) * 0.7 + t * 0.8)
          + sin(length(p) * 2.2 - t * 1.6);
  v = v * 0.125 + 0.5;
  OUT(mix(uColor, vec3(1.0) - uColor, v) * (0.45 + uLevel * 0.7), 0.3 + v * 0.55)
}`,

  spiral: `${PREAMBLE}
void main() {
  // Arms winding out of the centre and turning on the beat. Reads as motion
  // with a direction, which nothing else here does — rings expand, this one
  // rotates.
  vec2 p = centred();
  float r = length(p);
  float arms = floor(mix(2.0, 7.0, uEnergy));
  float band = 0.5 + 0.5 * sin(atan(p.y, p.x) * arms + r * mix(7.0, 22.0, uEnergy)
                               - uBeat * rate() * PI);
  band = smoothstep(0.45, 0.85, band);
  float fade = 1.0 - smoothstep(0.16, 0.64, r);
  OUT(uColor * (0.5 + band * 0.7), band * fade * (0.4 + uLevel))
}`,

  scan: `${PREAMBLE}
void main() {
  // Lines, with a bar's worth of sweep passing down them. The one source that
  // looks like a machine rather than like weather, which a set of them needs.
  float lines = mix(40.0, 170.0, uEnergy);
  float line = smoothstep(0.4, 0.5, abs(fract(vUv.y * lines) - 0.5));
  float head = 1.0 - uPhase / uQuantum;
  float sweep = pow(1.0 - min(abs(vUv.y - head) * 3.5, 1.0), 3.0);
  OUT(mix(uColor, vec3(1.0), sweep * 0.55),
      clamp(line * (0.16 + sweep * 1.5) * (0.45 + uLevel), 0.0, 1.0))
}`,

  sparks: `${PREAMBLE}
void main() {
  // A cell per spark, each firing on its own beat and drifting as it dies. The
  // aspect correction is on the cell count rather than the coordinates, so a
  // spark stays round on a wide frame.
  float density = mix(9.0, 24.0, uEnergy);
  vec2 g = vUv * vec2(density * uRes.x / uRes.y, density);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float life = fract(uBeat * rate() * 0.5 + hash(id));
  float pop = pow(1.0 - life, 5.0);
  vec2 drift = (vec2(hash(id + 3.7), hash(id + 9.1)) - 0.5) * 0.7;
  float spark = smoothstep(0.02 + 0.18 * pop, 0.0, length(f - drift * life));
  OUT(mix(uColor, vec3(1.0), 0.35), spark * pop * (0.35 + uLevel * 0.9))
}`,
};

/**
 * Effects mix against their own input rather than replacing it.
 *
 * `uAmount` is what lets an archetype's energy dial one in instead of switching
 * it on: at 0.3 a kaleidoscope is a suggestion in the corner of the eye, and at
 * 0.95 it has taken the frame. `MIXED(colour)` is the one way out, and every
 * effect below ends with it so none of them can forget.
 *
 * They sample an already-premultiplied picture, so `uOpacity` is bound to 1 for
 * an effect pass — the fader has been applied once already and must not be
 * applied twice.
 *
 * `uParams` is the eight-float bank an effect's own knobs ride in. A bank rather
 * than a named uniform each, because a circuit's knobs are discovered from its
 * nodes and cannot be declared ahead of time — and because a value arriving in a
 * uniform is a value that can be turned without recompiling a shader, which is
 * the difference between a knob and a rebuild.
 */
export const EFFECT_PREAMBLE = `${PREAMBLE}
uniform sampler2D uTex;
uniform float uAmount;
uniform float uParams[8];
#define MIXED(c) { fragColor = mix(texture(uTex, vUv), (c), uAmount); }
`;

/** One knob an effect declares: a range, a resting value, and a name to show. */
export interface EffectParam {
  name: string;
  min: number;
  max: number;
  value: number;
}

/**
 * What each built-in exposes, in the order its shader reads `uParams`.
 *
 * Position is the contract — index 0 in this list is `uParams[0]` in that
 * shader — so a parameter is appended rather than inserted. The names are what
 * the scheme stores against, so renaming one loses whatever was set for it.
 */
export const BUILTIN_PARAMS: Record<BuiltinEffect, readonly EffectParam[]> = {
  mirror: [
    { name: 'line', min: 0, max: 1, value: 0.5 },
    { name: 'angle', min: 0, max: 1, value: 0 },
  ],
  kaleido: [
    { name: 'segments', min: 2, max: 12, value: 3 },
    { name: 'spin', min: -0.3, max: 0.3, value: 0.05 },
  ],
  shift: [
    { name: 'spread', min: 0, max: 1, value: 0.3 },
    { name: 'drive', min: 0, max: 1, value: 0.5 },
  ],
  pixelate: [
    { name: 'blocks', min: 4, max: 128, value: 24 },
    { name: 'resolve', min: 0, max: 1, value: 1 },
  ],
  ripple: [
    { name: 'waves', min: 2, max: 60, value: 20 },
    { name: 'depth', min: 0, max: 1, value: 0.3 },
    { name: 'speed', min: 0.25, max: 4, value: 1 },
  ],
  smear: [
    { name: 'reach', min: 0, max: 1, value: 0.3 },
    { name: 'drive', min: 0, max: 1, value: 0.5 },
  ],
  bloom: [
    { name: 'reach', min: 0, max: 1, value: 0.35 },
    { name: 'floor', min: 0, max: 1, value: 0.25 },
  ],
  slice: [
    { name: 'bands', min: 0, max: 1, value: 0.4 },
    { name: 'throw', min: 0, max: 1, value: 0.35 },
  ],
  edge: [
    { name: 'width', min: 0, max: 1, value: 0.4 },
    { name: 'gain', min: 0, max: 1, value: 0.5 },
  ],
  posterize: [{ name: 'levels', min: 0, max: 1, value: 0.5 }],
  twist: [
    { name: 'turn', min: 0, max: 1, value: 0.65 },
    { name: 'sway', min: 0, max: 1, value: 0.25 },
  ],
  invert: [
    { name: 'hold', min: 0, max: 1, value: 0.35 },
    { name: 'rate', min: 0, max: 1, value: 0.5 },
  ],
};

const EFFECTS: Record<BuiltinEffect, string> = {
  mirror: `${EFFECT_PREAMBLE}
void main() {
  // A fold, at an angle. Rotating into the fold and back out is what turns one
  // mirror into every mirror — vertical, horizontal, and the diagonals nobody
  // gets from a shader that only knows which half of the frame it is in.
  float a = uParams[1] * PI;
  float c = cos(a), s = sin(a);
  vec2 p = mat2(c, -s, s, c) * centred();
  float line = (uParams[0] - 0.5) * 2.0;
  p.x = line - abs(p.x - line);
  p = mat2(c, s, -s, c) * p;
  MIXED(texture(uTex, clamp(uncentred(p), 0.0, 1.0)))
}`,

  kaleido: `${EFFECT_PREAMBLE}
void main() {
  // Folded in polar space, rotating with the beat so it moves with the music
  // rather than at a rate of its own. Energy adds segments on top of the knob,
  // which is what keeps a chorus busier than a verse without a second preset.
  vec2 p = centred();
  float segments = floor(max(2.0, uParams[0] + uEnergy * 4.0));
  float a = atan(p.y, p.x) + uBeat * uParams[1];
  float r = length(p);
  float wedge = PI / segments;
  a = abs(mod(a, wedge * 2.0) - wedge);
  MIXED(texture(uTex, clamp(uncentred(vec2(cos(a), sin(a)) * r), 0.0, 1.0)))
}`,

  shift: `${EFFECT_PREAMBLE}
void main() {
  // Channel separation that opens with the level, so it bites on transients
  // and closes to nothing in the gaps.
  float d = uParams[0] * 0.03 * (0.25 + uLevel * uParams[1] * 2.0) * mix(0.5, 2.0, uEnergy);
  float r = texture(uTex, vUv + vec2(d, 0.0)).r;
  vec4 g = texture(uTex, vUv);
  float b = texture(uTex, vUv - vec2(d, 0.0)).b;
  MIXED(vec4(r, g.g, b, g.a))
}`,

  pixelate: `${EFFECT_PREAMBLE}
void main() {
  // Blocks that resolve across the bar. Quantising the picture the way the
  // clock quantises the launch.
  float base = mix(uParams[0], uParams[0] * 0.45, uEnergy);
  float steps = max(2.0, mix(base, base * 4.0, (1.0 - uPhase / uQuantum) * uParams[1]));
  MIXED(texture(uTex, (floor(vUv * steps) + 0.5) / steps))
}`,

  ripple: `${EFFECT_PREAMBLE}
void main() {
  // A wave leaving the centre on each beat, displacing what it passes over.
  // The most obviously *frenetic* of these, which is why a loud archetype
  // reaches for it: the whole frame moves rather than being recoloured.
  vec2 p = centred();
  float r = length(p);
  float wave = sin(r * mix(uParams[0] * 0.7, uParams[0] * 2.0, uEnergy)
                   - uBeat * rate() * uParams[2] * PI * 2.0);
  float push = wave * uParams[1] * (0.01 + uLevel * 0.04);
  MIXED(texture(uTex, clamp(vUv + normalize(p + 1e-6) * push, 0.0, 1.0)))
}`,

  smear: `${EFFECT_PREAMBLE}
void main() {
  // A short radial blur, taken in a handful of steps toward the centre. Softens
  // a layer into the ones under it, which is what a quiet section wants and
  // what makes it the opposite of ripple.
  vec2 toward = (vec2(0.5) - vUv) * uParams[0] * (0.03 + uLevel * uParams[1] * 0.12);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 6; i++) sum += texture(uTex, vUv + toward * (float(i) / 6.0));
  MIXED(sum / 6.0)
}`,
  bloom: `${EFFECT_PREAMBLE}
void main() {
  // Eight taps on a ring, and only what is already bright gets added back. The
  // cheapest thing that makes a projector look like it cost more than it did:
  // a cheap lamp has no contrast to spare, so the highlights have to be built.
  vec4 base = texture(uTex, vUv);
  float reach = (0.003 + uParams[0] * 0.022) * (0.6 + uLevel * 0.8);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * PI * 0.25;
    sum += texture(uTex, vUv + vec2(cos(a), sin(a)) * reach);
  }
  MIXED(base + max(sum / 8.0 - vec4(uParams[1]), vec4(0.0)) * mix(0.4, 1.1, uEnergy))
}`,

  slice: `${EFFECT_PREAMBLE}
void main() {
  // Rows thrown sideways, re-diced on each beat division. Wrapped rather than
  // clamped, because a slice that ran off the edge and smeared would read as a
  // broken texture instead of as a deliberate glitch.
  float bands = floor(mix(5.0, 26.0, uParams[0]));
  float row = floor(vUv.y * bands);
  float tick = floor(uBeat * rate());
  float pick = hash(vec2(row * 1.7, tick));
  float push = (hash(vec2(row, tick * 2.3)) - 0.5) * uParams[1] * 0.5 * step(0.55, pick);
  MIXED(texture(uTex, vec2(fract(vUv.x + push), vUv.y)))
}`,

  edge: `${EFFECT_PREAMBLE}
void main() {
  // Difference across a pixel, both ways. Throws away the fill and keeps the
  // outline, which turns any source into a diagram — the one effect here that
  // makes a busy frame *less* busy.
  vec2 px = (0.5 + uParams[0] * 3.0) / uRes;
  vec3 h = abs(texture(uTex, vUv + vec2(px.x, 0.0)).rgb - texture(uTex, vUv - vec2(px.x, 0.0)).rgb);
  vec3 v = abs(texture(uTex, vUv + vec2(0.0, px.y)).rgb - texture(uTex, vUv - vec2(0.0, px.y)).rgb);
  float m = clamp(length(h + v) * mix(1.5, 6.0, uParams[1]), 0.0, 1.0);
  MIXED(vec4(mix(uColor, vec3(1.0), 0.45) * m, m))
}`,

  posterize: `${EFFECT_PREAMBLE}
void main() {
  // Colour quantised to a handful of steps. Undone and redone around the
  // premultiply, or the banding lands on the alpha as well and the edges crawl.
  vec4 c = texture(uTex, vUv);
  float a = max(c.a, 1e-4);
  float steps = floor(mix(14.0, 2.0, uParams[0]));
  MIXED(vec4(clamp(floor(c.rgb / a * steps + 0.5) / steps, 0.0, 1.0) * c.a, c.a))
}`,

  twist: `${EFFECT_PREAMBLE}
void main() {
  // Rotation that grows with radius, swaying on the beat. Where kaleido folds
  // the frame, this one wrings it.
  vec2 p = centred();
  float a = (uParams[0] - 0.5) * 9.0 * length(p) + sin(uBeat * PI * 0.5) * uParams[1] * 1.5;
  float c = cos(a), s = sin(a);
  MIXED(texture(uTex, clamp(uncentred(mat2(c, -s, s, c) * p), 0.0, 1.0)))
}`,

  invert: `${EFFECT_PREAMBLE}
void main() {
  // On the beat and off again. The only effect here that is a switch rather
  // than a shape, which is why the hold knob is how *much* of the beat it holds:
  // an inversion that never let go would just be a different colourway.
  vec4 c = texture(uTex, vUv);
  float a = max(c.a, 1e-4);
  float on = step(1.0 - uParams[0], beatPulse(rate() * mix(0.5, 2.0, uParams[1])));
  MIXED(vec4(mix(c.rgb / a, vec3(1.0) - c.rgb / a, on) * c.a, c.a))
}`,
};

export const sourceSources: ReadonlyMap<SourceKind, string> = new Map(
  Object.entries(SOURCES) as [SourceKind, string][],
);

export const effectSources: ReadonlyMap<BuiltinEffect, string> = new Map(
  Object.entries(EFFECTS) as [BuiltinEffect, string][],
);
