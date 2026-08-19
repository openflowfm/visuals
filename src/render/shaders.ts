import type { EffectKind, SourceKind } from '../../protocol.ts';

/**
 * Every source and effect, as fragment shaders over one shared preamble.
 *
 * **The clock is a uniform, not a timer.** Nothing here reads a wall clock or
 * counts frames: `uBeat` and `uPhase` come from Link, so a shape that grows over
 * one bar grows over one *musical* bar and stays with the music when the tempo
 * moves. That is the whole reason this rig exists rather than a screensaver, and
 * it is why `uTime` is present but barely used — it is for drift and shimmer,
 * things that should not be in time.
 *
 * Everything writes **premultiplied alpha**, so the compositor can pick a blend
 * mode with fixed-function GL blending and never needs an accumulator buffer.
 * `OUT(rgb, a)` is the one way to leave a shader, and it does the multiply.
 */

const PREAMBLE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;     // seconds; for drift that should NOT be in time
uniform float uBeat;     // continuous Link beats
uniform float uPhase;    // position within the quantum, in beats
uniform float uQuantum;
uniform float uLevel;    // this layer's output meter, 0-1
uniform float uOpacity;  // this layer's fader
uniform vec3  uColor;    // the playing clip's colour
uniform float uSeed;

#define PI 3.14159265359

// Aspect-corrected coordinates centred on the screen, so a circle is round.
vec2 centred() {
  vec2 p = vUv - 0.5;
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

// 1 on the beat, decaying to 0 across it. The shape every reactive thing here
// is built from, so that "on the beat" means one thing everywhere.
float beatPulse(float division) {
  return pow(1.0 - fract(uBeat * division), 3.0);
}

#define OUT(rgb, a) { float _a = (a) * uOpacity; fragColor = vec4((rgb) * _a, _a); }
`;

const SOURCES: Record<SourceKind, string> = {
  solid: `${PREAMBLE}
void main() {
  // The plainest layer there is: the clip's colour, breathing on the bar and
  // brightening with the sound. It exists so a stack has something solid at the
  // bottom, and so an unnamed set still reads as the set's own colours.
  float breathe = 0.55 + 0.45 * (1.0 - uPhase / uQuantum);
  OUT(uColor * (breathe + uLevel * 0.8), 1.0)
}`,

  bars: `${PREAMBLE}
void main() {
  // Vertical bars whose heights are a bar of music: each column is one
  // sixteenth, and the playhead sweeps them.
  float columns = 16.0;
  float x = floor(vUv.x * columns);
  float head = floor((uPhase / uQuantum) * columns);
  float lit = step(abs(x - head), 0.5);
  float height = 0.2 + 0.8 * hash(vec2(x, floor(uBeat / uQuantum))) * (0.3 + uLevel);
  float bar = step(vUv.y, height);
  vec3 c = uColor * (0.35 + 0.65 * lit);
  OUT(c, bar * (0.35 + 0.65 * lit))
}`,

  rings: `${PREAMBLE}
void main() {
  // Rings launched on every beat and expanding outward, so the picture carries
  // the pulse even when the sound is quiet.
  vec2 p = centred();
  float r = length(p);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = fract(uBeat - float(i) * 0.25);
    float radius = age * 0.75;
    total += smoothstep(0.03, 0.0, abs(r - radius)) * (1.0 - age);
  }
  total *= 0.6 + uLevel * 1.4;
  OUT(uColor, clamp(total, 0.0, 1.0))
}`,

  noise: `${PREAMBLE}
void main() {
  // A drifting field that thickens with the sound. The drift is on uTime
  // deliberately — it should feel like weather, not like a metronome.
  vec2 p = centred() * 4.0;
  float n = noise(p + vec2(uTime * 0.15, uTime * 0.1));
  n += 0.5 * noise(p * 2.3 - uTime * 0.2);
  n /= 1.5;
  float threshold = 0.62 - uLevel * 0.35;
  float a = smoothstep(threshold, threshold + 0.18, n);
  OUT(uColor * (0.6 + n), a)
}`,

  strobe: `${PREAMBLE}
void main() {
  // Whole-frame flashes on the eighth. The one source with no shape at all,
  // and the reason the compositor's opacity has to be honest: this is unusable
  // if a fader doesn't actually take it down.
  float flash = beatPulse(2.0);
  OUT(mix(uColor, vec3(1.0), 0.6), flash * (0.35 + uLevel * 0.65))
}`,

  grid: `${PREAMBLE}
void main() {
  // A grid of cells, each lighting on its own beat. Reads as structure rather
  // than as motion, which is what a chorus wants under everything else.
  vec2 cells = vec2(8.0, 5.0);
  vec2 id = floor(vUv * cells);
  vec2 f = fract(vUv * cells);
  float when = hash(id);
  float lit = pow(1.0 - fract(uBeat * 0.5 + when), 6.0);
  float inset = smoothstep(0.0, 0.06, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  OUT(uColor * (0.5 + lit), inset * (0.12 + lit * (0.55 + uLevel * 0.45)))
}`,
};

const EFFECT_PREAMBLE = `${PREAMBLE}
uniform sampler2D uTex;
`;

const EFFECTS: Record<Exclude<EffectKind, 'none'>, string> = {
  mirror: `${EFFECT_PREAMBLE}
void main() {
  vec2 uv = vec2(vUv.x < 0.5 ? vUv.x : 1.0 - vUv.x, vUv.y) * vec2(2.0, 1.0);
  fragColor = texture(uTex, vec2(uv.x * 0.5 + 0.25, uv.y));
}`,

  kaleido: `${EFFECT_PREAMBLE}
void main() {
  // Six-fold, folded in polar space, rotating one turn every four bars so it
  // moves with the music rather than at a rate of its own.
  vec2 p = centred();
  float a = atan(p.y, p.x) + uBeat * 0.05;
  float r = length(p);
  float wedge = PI / 3.0;
  a = abs(mod(a, wedge * 2.0) - wedge);
  vec2 uv = vec2(cos(a), sin(a)) * r + 0.5;
  fragColor = texture(uTex, clamp(uv, 0.0, 1.0));
}`,

  shift: `${EFFECT_PREAMBLE}
void main() {
  // Channel separation that opens with the level, so it bites on transients
  // and closes to nothing in the gaps.
  float d = (0.004 + uLevel * 0.02);
  float r = texture(uTex, vUv + vec2(d, 0.0)).r;
  vec4 g = texture(uTex, vUv);
  float b = texture(uTex, vUv - vec2(d, 0.0)).b;
  fragColor = vec4(r, g.g, b, g.a);
}`,

  pixelate: `${EFFECT_PREAMBLE}
void main() {
  // Blocks that halve on the bar. Quantising the picture the way the clock
  // quantises the launch.
  float steps = mix(16.0, 96.0, 1.0 - uPhase / uQuantum);
  vec2 uv = (floor(vUv * steps) + 0.5) / steps;
  fragColor = texture(uTex, uv);
}`,
};

export const sourceSources: ReadonlyMap<SourceKind, string> = new Map(
  Object.entries(SOURCES) as [SourceKind, string][],
);

export const effectSources: ReadonlyMap<EffectKind, string> = new Map(
  Object.entries(EFFECTS) as [EffectKind, string][],
);
