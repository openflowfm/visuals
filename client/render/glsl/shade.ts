/**
 * Turning a number into a colour, through the colourway rather than past it.
 *
 * `colorway` hands out five colours by role and `grade/tint` recolours a
 * picture from its own brightness. Between them there was no way to say "this
 * number, as a colour" — so a meter, an envelope or a position along a curve
 * could drive where something was drawn but never what colour it came out.
 *
 * Both modes are one expression. Nothing here samples, loops, or reads a
 * picture, so a shade costs what a `math` costs.
 */
export const SHADE_LIB = `
// The five roles, evenly spaced, in the order the colourway names them. A
// sample of the whole palette, indexable by anything.
vec4 shade_across(float n, float amount) {
  float x = clamp(n, 0.0, 1.0) * 4.0;
  float i = floor(min(x, 3.0));
  vec3 col = mix(uColors[int(i)], uColors[int(i) + 1], x - i);
  float a = clamp(amount, 0.0, 1.0);
  return vec4(col, a);
}

// The shape a hot thing has: out of the dark, through the colour, into the
// accent, ending at white. Coverage follows the number rather than sitting at the
// amount asked for, because the cold end of a heat curve is *nothing* — a shade that
// stayed opaque down there would lay a black rectangle over whatever is under
// it, which is the one thing a colour node must never do by default.
vec4 shade_heat(float n, float amount) {
  float t = clamp(n, 0.0, 1.0);
  vec3 col = mix(uSecondary, uPrimary, smoothstep(0.0, 0.45, t));
  col = mix(col, uAccent, smoothstep(0.4, 0.78, t));
  col = mix(col, vec3(1.0), smoothstep(0.72, 1.0, t));
  return vec4(col, clamp(t * 2.5, 0.0, 1.0) * clamp(amount, 0.0, 1.0));
}
`;
