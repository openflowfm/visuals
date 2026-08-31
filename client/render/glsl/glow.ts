/**
 * Turning a distance into light.
 *
 * The one thing this vocabulary could not say. `read` takes a number off a
 * picture and `polar` takes numbers off a point, but nothing went the other
 * way: there was no way to hand the graph a number that is *near at zero* and
 * get a lit stroke back. Every generated look built out of glowing lines —
 * which is most of what a screen full of light is — needs exactly that, and
 * without it the only way to draw a line was to find a `source` that happened
 * to contain one.
 *
 * A glow is priced like arithmetic because it is arithmetic: no loop, no
 * sample of anything, no lattice. It is `light`'s falloff maths with the point
 * taken out, so what supplies the distance is somebody else's business —
 * `figure`, a `read` off a picture, a meter, a wave.
 *
 * Each returns the same unpremultiplied colour-and-coverage a generator does,
 * so a glow composes downstream exactly as a picture does.
 */

/**
 * How far the light carries, from a hairline to a soft wash.
 *
 * Exponential rather than linear, and the reason is the whole range: a neon
 * edge lives at a few thousandths of the plane and a haze lives at a quarter of
 * it. Spread linearly, everything usable would sit in the bottom twentieth of
 * the control and the other nineteen twentieths would all be fog.
 */
export const GLOW_LIB = `
float glowReach(float halo) {
  return 0.004 * pow(60.0, clamp(halo, 0.0, 1.0));
}

// A hot core inside a coloured halo: the shape a lit tube has, and the reason
// the core is mixed toward white rather than toward the accent — a filament
// bright enough to bloom has left its own hue behind, and a core that keeps it
// reads as a thick line rather than a bright one.
vec4 glow_neon(float d, float e, float core, float halo) {
  float q = max(d, 0.0) / glowReach(halo);
  float body = 1.0 / (1.0 + q * q * 8.0);
  float width = mix(0.10, 0.85, clamp(core, 0.0, 1.0));
  float hot = exp(-(q * q) / (width * width));
  float lit = clamp((body * 0.85 + hot) * mix(0.65, 1.15, e), 0.0, 1.0);
  return vec4(mix(uPrimary, vec3(1.0), hot * 0.85), lit);
}

// The same falloff with no filament in it: a Gaussian that stays the colour it
// started. What you want under a neon rather than instead of one.
vec4 glow_soft(float d, float e, float halo) {
  float q = max(d, 0.0) / glowReach(halo);
  float lit = clamp(exp(-q * q * 0.7) * mix(0.6, 1.15, e), 0.0, 1.0);
  return vec4(uPrimary, lit);
}

// Brightest at a distance rather than at zero, so a shape gets an outline
// standing off it. At an away of zero it is exactly the soft glow, which is the
// right thing for a control to do at its bottom.
vec4 glow_band(float d, float e, float away, float halo) {
  float q = abs(max(d, 0.0) - clamp(away, 0.0, 1.0) * 0.4) / glowReach(halo);
  float lit = clamp(exp(-q * q * 0.7) * mix(0.6, 1.15, e), 0.0, 1.0);
  return vec4(uPrimary, lit);
}
`;
