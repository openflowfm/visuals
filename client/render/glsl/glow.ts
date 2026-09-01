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

/*
 * Inverse-square, windowed so that it actually ends.
 *
 * A plain 1/(1+kq*q) never reaches zero, and over a whole frame that is not a
 * rounding matter: the tail of one glow covers every pixel in the picture at
 * some small amplitude, so a flow built out of glows has no black in it
 * anywhere. Two things go wrong downstream and both were visible before this.
 * The frame never gets near the 47% pure black the footage this imitates runs
 * at; and radial optics — spread/disperse especially — turn a frame-wide radial
 * gradient into a frame-wide *hue* shift, because sampling it a percent nearer
 * the middle for red than for blue is brighter for red everywhere at once. A
 * flower drawn in cyan came out sitting on a red field, and the cause was not
 * in the lens.
 *
 * Subtracting the value at the cutoff and renormalising costs one subtract and
 * gives an exact zero at about two and a half reach-lengths out, which is well
 * past where a halo is doing any visible work.
 */
float glowBody(float q) {
  return max(1.0 / (1.0 + q * q * 8.0) - 0.02, 0.0) / 0.98;
}

/*
 * A hot core inside a coloured halo: the shape a lit tube has.
 *
 * The core is mixed toward white rather than toward the accent because a
 * filament bright enough to bloom has left its own hue behind, and a core that
 * keeps it reads as a thick line rather than a bright one.
 *
 * **It reaches white, and then keeps going.** The first version of this mixed
 * hot * 0.85 toward white, which sounds like a detail and is not: against a
 * saturated primary it put a hard ceiling of about (220, 246, 255) on the
 * brightest pixel the node could emit, so nothing drawn with a glow was ever
 * white — every lit line in the library came out a pale version of the
 * colourway. Measured against the footage this was imitating, the reference
 * blows 11% of its peak frame to pure white and we managed 0.9%.
 *
 * So the filament goes to white by smoothstep — reaching it well before the
 * exact centre, which is what gives the core width rather than a single bright
 * pixel — and is then multiplied past one. The excess is invisible on its own
 * (the display clips) and exists so spread/bloom has something to find; see
 * OVERBRIGHT. A white core three pixels wide with a halo bleeding off it is the
 * entire difference between a tube that is lit and a tube that is drawn.
 */
vec4 glow_neon(float d, float e, float core, float halo) {
  float q = max(d, 0.0) / glowReach(halo);
  float body = glowBody(q);
  float width = mix(0.10, 0.85, clamp(core, 0.0, 1.0));
  float hot = exp(-(q * q) / (width * width));
  float lit = clamp((body * 0.85 + hot) * mix(0.65, 1.15, e), 0.0, 1.0);
  vec3 col = mix(uPrimary, vec3(1.0), smoothstep(0.15, 0.6, hot));
  float over = 1.0 + hot * hot * mix(0.8, 4.0, clamp(core, 0.0, 1.0)) * mix(0.7, 1.3, e);
  return vec4(col * over, lit);
}

// The same falloff with no filament in it: a Gaussian that stays the colour it
// started. What you want under a neon rather than instead of one.
vec4 glow_soft(float d, float e, float halo) {
  float q = max(d, 0.0) / glowReach(halo);
  float lit = clamp(max(exp(-q * q * 0.7) - 0.02, 0.0) / 0.98 * mix(0.6, 1.15, e), 0.0, 1.0);
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
