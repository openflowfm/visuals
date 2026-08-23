/** Helper functions used by expressions emitted from the circuit compiler. */
export const CIRCUIT_HELPERS = `
vec2 cFold(vec2 p, float n) {
  float sides = 1.0 + floor(n * 11.0);
  float wedge = PI / sides;
  float a = abs(mod(atan(p.y, p.x), wedge * 2.0) - wedge);
  return vec2(cos(a), sin(a)) * length(p);
}

vec2 cSwirl(vec2 p, float n) {
  float a = (n - 0.5) * 12.56637 * length(p);
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
