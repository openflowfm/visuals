/** Helper functions used by expressions emitted from the circuit compiler. */
export const CIRCUIT_HELPERS = `
float cLfoPhase(float rate, float sync, float offset) {
  float rung = floor(clamp(rate, 0.0, 1.0) * 7.0 + 0.5);
  float cyclesPerBeat = exp2(rung - 4.0);
  float hz = 0.05 * pow(400.0, clamp(rate, 0.0, 1.0));
  return mix(uTime * hz, uBeat * cyclesPerBeat, step(0.5, sync)) + clamp(offset, 0.0, 1.0);
}

float cLfoSine(float p) { return sin(fract(p) * PI * 2.0) * 0.5 + 0.5; }
float cLfoTriangle(float p) { return 1.0 - abs(fract(p) * 2.0 - 1.0); }
float cLfoSaw(float p) { return fract(p); }
float cLfoSquare(float p) { return step(0.5, fract(p)); }
float cLfoHold(float p, float identity) {
  return hash(vec2(floor(p) + identity, identity * 0.37));
}

vec2 cFold(vec2 p, float n) {
  float sides = 1.0 + floor(n * 11.0);
  float wedge = PI / sides;
  float a = abs(mod(atan(p.y, p.x), wedge * 2.0) - wedge);
  return vec2(cos(a), sin(a)) * length(p);
}

vec2 cSwirl(vec2 p, float turns) {
  float a = turns * 6.28318530718 * length(p);
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec2 cZoom(vec2 p, float n) {
  return p * exp2((0.5 - n) * 4.0);
}

vec2 cWobble(vec2 p, float n) {
  return p + vec2(sin(p.y * 9.0 + uBeat * PI), cos(p.x * 9.0 + uBeat * PI)) * n * 0.35;
}

vec2 cTile(vec2 p, float n) {
  float count = 1.0 + floor(n * 7.0);
  return fract(p * count + 0.5) - 0.5;
}

// Rotation about the grey axis: the short, correct hue shift. Undone and redone
// around the premultiply, or a translucent pixel rotates toward black.
vec4 cHue(vec4 c, float n) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  const vec3 k = vec3(0.57735027);
  float ang = (n - 0.5) * 6.28318;
  float co = cos(ang);
  vec3 shifted = col * co + cross(k, col) * sin(ang) + k * dot(k, col) * (1.0 - co);
  return vec4(clamp(shifted, 0.0, 1.0) * c.a, c.a);
}

vec4 cLevels(vec4 c, float gain, float lift) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  col = (col - 0.5) * exp2((gain - 0.5) * 3.0) + 0.5 + (lift - 0.5);
  return vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}
`;
