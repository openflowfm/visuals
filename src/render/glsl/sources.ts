import { SOURCES, type Source } from '../../../protocol.ts';
import { PATTERN_BODIES } from './patterns.ts';

/**
 * The numbers each source takes beyond its point and its energy.
 *
 * Every one of these was a constant with `e` mixed into it — "energy adds
 * columns" — so every one **follows the energy inlet until somebody takes
 * it**: unwired and unheld they compile to exactly the coupling they replaced,
 * and a graph that never touches them draws what it always drew. Catching one
 * pins that shape; wiring one drives it from anything.
 *
 * The names are function parameters as well as inlet names, so none may
 * shadow a preamble function (`rate`, `noise`, `hash`) — which is why the
 * strobe's division is `pulse` and a scan's count is `lines` read into
 * `rules`.
 */
export const SOURCE_VALUES = {
  solid: [],
  bars: ['columns'],
  rings: ['flight'],
  noise: ['weave', 'cover'],
  strobe: ['pulse'],
  grid: ['tiles'],
  tunnel: ['spokes'],
  plasma: ['weave'],
  spiral: ['arms', 'coil'],
  scan: ['lines'],
  sparks: ['shower'],
  checker: ['tiles'],
  rays: ['spokes'],
} as const satisfies Record<Source, readonly string[]>;

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
export const GENERATOR_BODIES = {
  solid: `
  // The plainest picture there is: the colour, breathing on the bar and
  // brightening with the sound. The one source that fills the frame at full
  // alpha, which makes it the one that can hide everything under it -- so its
  // brightness stays well short of white.
  float breathe = 0.55 + 0.45 * (1.0 - uPhase / uQuantum);
  return vec4(uColor * (breathe * 0.6 + uLevel * 0.45), 1.0);`,

  bars: `
  // Vertical bars whose heights are a bar of music: each column is one
  // subdivision, and the playhead sweeps them. Energy adds columns, so the
  // same source is coarse when it is quiet and dense when it is not.
  vec2 uv = uncentred(p);
  float cols = mix(8.0, 32.0, columns);
  float x = floor(uv.x * cols);
  float head = floor((uPhase / uQuantum) * cols);
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
    float radius = age * mix(0.55, 0.95, flight);
    total += smoothstep(0.03, 0.0, abs(r - radius)) * (1.0 - age);
  }
  return vec4(uColor, clamp(total * (0.6 + uLevel * 1.4), 0.0, 1.0));`,

  noise: `
  // A drifting field that thickens with the sound. The drift is on uTime
  // deliberately -- it should feel like weather, not like a metronome.
  vec2 q = p * mix(2.5, 6.0, weave);
  float n = noise(q + vec2(uTime * 0.15, uTime * 0.1));
  n += 0.5 * noise(q * 2.3 - uTime * 0.2);
  n /= 1.5;
  float threshold = mix(0.72, 0.42, cover) - uLevel * 0.25;
  return vec4(uColor * (0.6 + n), smoothstep(threshold, threshold + 0.18, n));`,

  strobe: `
  // Whole-frame flashes on the beat division energy chose. The one source with
  // no shape at all, and the reason opacity has to be honest. It leans on the
  // colour rather than on white, and its silent floor is low: a strobe with
  // nothing playing through it flashing at a third of full is the whole frame
  // going off on every beat for no reason at all.
  float flash = beatPulse(rate(pulse), e);
  return vec4(mix(uColor, vec3(1.0), 0.3), flash * (0.1 + uLevel * 0.75));`,

  grid: `
  // A grid of cells, each lighting on its own beat. Reads as structure rather
  // than as motion, which is what a busy frame wants under everything else.
  vec2 uv = uncentred(p);
  vec2 cells = mix(vec2(5.0, 3.0), vec2(12.0, 8.0), tiles);
  vec2 id = floor(uv * cells);
  vec2 f = fract(uv * cells);
  float when = hash(id);
  float lit = pow(1.0 - fract(uBeat * rate(e) * 0.5 + when), 6.0);
  float inset = smoothstep(0.0, 0.06, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  return vec4(uColor * (0.5 + lit), inset * (0.12 + lit * (0.55 + uLevel * 0.45)));`,

  tunnel: `
  // A corridor rushing toward you. Depth is 1/r, which is what makes it read as
  // perspective rather than as rings -- and the rush is on the beat, so the room
  // moves through it in time rather than at a rate of its own.
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  float depth = uBeat * rate(e) * 0.45 + 0.16 / r;
  float rings = smoothstep(0.82, 1.0, abs(fract(depth) * 2.0 - 1.0));
  float arms = floor(mix(4.0, 12.0, spokes));
  float ribs = smoothstep(0.86, 1.0, abs(fract(a / PI * arms) * 2.0 - 1.0));
  float lit = max(rings, ribs * 0.8);
  // Fades into the vanishing point, where the maths goes to infinity anyway.
  float fade = smoothstep(0.02, 0.3, r);
  return vec4(mix(uColor, vec3(1.0), rings * 0.4), lit * fade * (0.35 + uLevel * 0.9));`,

  plasma: `
  // Four sines crossed. The oldest trick there is and still the best full-frame
  // wash -- it never repeats visibly, it costs nothing, and it takes a colour and
  // its complement rather than a fixed palette.
  vec2 q = p * mix(2.0, 5.0, weave);
  float t = uBeat * rate(e) * 0.25;
  float v = sin(q.x + t) + sin(q.y * 1.3 - t) + sin((q.x + q.y) * 0.7 + t * 0.8)
          + sin(length(q) * 2.2 - t * 1.6);
  v = v * 0.125 + 0.5;
  return vec4(mix(uColor, vec3(1.0) - uColor, v) * (0.45 + uLevel * 0.7), 0.3 + v * 0.55);`,

  spiral: `
  // Arms winding out of the centre and turning on the beat. Reads as motion
  // with a direction, which nothing else here does -- rings expand, this rotates.
  float r = length(p);
  float count = floor(mix(2.0, 7.0, arms));
  float band = 0.5 + 0.5 * sin(atan(p.y, p.x) * count + r * mix(7.0, 22.0, coil)
                               - uBeat * rate(e) * PI);
  band = smoothstep(0.45, 0.85, band);
  float fade = 1.0 - smoothstep(0.16, 0.64, r);
  return vec4(uColor * (0.5 + band * 0.7), band * fade * (0.4 + uLevel));`,

  scan: `
  // Lines, with a bar's worth of sweep passing down them. The one source that
  // looks like a machine rather than like weather, which a set of them needs.
  vec2 uv = uncentred(p);
  float rules = mix(40.0, 170.0, lines);
  float line = smoothstep(0.4, 0.5, abs(fract(uv.y * rules) - 0.5));
  float head = 1.0 - uPhase / uQuantum;
  float sweep = pow(1.0 - min(abs(uv.y - head) * 3.5, 1.0), 3.0);
  return vec4(mix(uColor, vec3(1.0), sweep * 0.55),
              clamp(line * (0.16 + sweep * 1.5) * (0.45 + uLevel), 0.0, 1.0));`,

  sparks: `
  // A cell per spark, each firing on its own beat and drifting as it dies. The
  // aspect correction is on the cell count rather than the coordinates, so a
  // spark stays round on a wide frame.
  vec2 uv = uncentred(p);
  float density = mix(9.0, 24.0, shower);
  vec2 g = uv * vec2(density * uRes.x / uRes.y, density);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float life = fract(uBeat * rate(e) * 0.5 + hash(id));
  float pop = pow(1.0 - life, 5.0);
  vec2 drift = (vec2(hash(id + 3.7), hash(id + 9.1)) - 0.5) * 0.7;
  float spark = smoothstep(0.02 + 0.18 * pop, 0.0, length(f - drift * life));
  return vec4(mix(uColor, vec3(1.0), 0.35), spark * pop * (0.35 + uLevel * 0.9));`,

  ...PATTERN_BODIES,
} satisfies Record<Source, string>;

/**
 * All of them as GLSL, compiled into every flow.
 *
 * Every shader carries every lightweight source whether or not it calls one,
 * alternative — emitting only what a graph reached — makes the shader a function
 * of the wiring in a second way and gives the cache signature a second thing to
 * get wrong. A driver drops an uncalled function.
 */
export const GENERATOR_LIB = SOURCES.map((name) => {
  const params = SOURCE_VALUES[name].map((value) => `, float ${value}`).join('');
  return `vec4 gen_${name}(vec2 p, float e${params}) {${GENERATOR_BODIES[name]}\n}`;
}).join('\n\n');
