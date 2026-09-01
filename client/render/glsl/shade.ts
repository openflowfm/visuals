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

/*
 * One colour, from unlit to blown: the exposure of a thing rather than its
 * identity.
 *
 * The other two modes answer "which colour is this number" by walking the
 * palette, and that turns out to be the wrong question most of the time. A
 * number that says how brightly some part of a shape is lit is not naming a
 * different colour when it rises — it is naming the same colour with more light
 * on it. Ramping across the roles instead paints hue onto geometry, and a lit
 * curve whose colour changes along its length reads as a thermal image or a
 * media-player visualisation, never as something that is glowing.
 *
 * So: black, up through the primary, out to white, and then past it. Only the
 * last stretch overdrives, which is what keeps a filament a filament — the
 * whole curve is one hue and the top of it is where that hue has been
 * overwhelmed. See OVERBRIGHT for where the excess goes.
 */
vec4 shade_filament(float n, float amount) {
  float t = clamp(n, 0.0, 1.0);
  vec3 col = uPrimary * smoothstep(0.0, 0.55, t);
  col = mix(col, vec3(1.0), smoothstep(0.55, 0.92, t));
  col *= 1.0 + smoothstep(0.8, 1.0, t) * 2.5;
  return vec4(col, clamp(t * 3.0, 0.0, 1.0) * clamp(amount, 0.0, 1.0));
}
`;
