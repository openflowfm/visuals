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
