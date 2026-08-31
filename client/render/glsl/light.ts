/**
 * Fixed work performed by one evaluation of each light.
 *
 * A visit is one lattice or feature-point evaluation in the helpers this
 * library borrows from `fields.ts`. The lamp is a closed form and charges a
 * token visit so the table has no zero a future mode could hide behind.
 */
export const LIGHT_WORK = {
  lamp: 1,
  beam: 8,
  shafts: 16,
  caustics: 18,
} as const;

export type LightMode = keyof typeof LIGHT_WORK;

/**
 * Four 2D lights, each behind a statically bounded amount of work and each
 * returned as the same unpremultiplied colour-and-coverage shape as a source
 * generator, so a light composes downstream exactly as a picture does.
 *
 * The research behind the set: the looks that read as *light* rather than as
 * texture are the ones with a physical story — inverse-square falloff, a cone
 * with dust in it, crepuscular rays, water caustics — and every one of those
 * has a cheap closed or fixed-loop form. Nothing here samples an input or
 * marches a ray: a lamp is arithmetic, a beam is two gradient-noise octaves,
 * shafts are one fBm read in ray space, caustics are two Worley layers. The
 * motion that sells them rides `uTime`, deliberately outside the beat — haze,
 * dust and water are precisely the things that should not dance in tempo —
 * while `energy` drives only brightness, so a light breathes with the room
 * without its physics wobbling.
 *
 * This file assumes `FIELD_LIB` is already in the program: it borrows
 * `fieldGradientNoise`, `fieldFbm` and `fieldWorleyF1` rather than shipping a
 * second lattice.
 */
export const LIGHT_LIB = `
// Wrapped distance between two angles, so a cone does not tear at +/-PI.
float lightAngleOff(float angle, float axis) {
  return abs(mod(angle - axis + PI, 2.0 * PI) - PI);
}

// A soft point of light in haze: a hot Gaussian core over an inverse-square
// halo, windowed to a finite reach so the picture composes instead of
// tinting the whole frame forever.
vec4 light_lamp(vec2 p, vec2 from, float e, float carry, float soft) {
  float radius = mix(0.22, 1.35, clamp(carry, 0.0, 1.0));
  float q = length(p - from) / radius;
  float window = 1.0 - smoothstep(0.55, 1.0, q);
  float halo = window / (1.0 + 9.0 * q * q);
  float core = exp(-q * q / max(0.0045, soft * soft * 0.22));
  float lit = clamp((halo + core) * mix(0.55, 1.15, e), 0.0, 1.0);
  vec3 colour = mix(uPrimary, vec3(1.0), core * 0.75);
  return vec4(colour, lit);
}

// A stage spotlight: a soft-edged cone swung about straight down, its throw
// fading exponentially, with two octaves of dust drifting through in seconds
// rather than beats.
vec4 light_beam(vec2 p, vec2 from, float e, float aim, float spread) {
  vec2 v = p - from;
  float r = length(v);
  float axis = -PI * 0.5 + (clamp(aim, 0.0, 1.0) - 0.5) * 1.9;
  float off = lightAngleOff(atan(v.y, v.x), axis);
  float width = mix(0.07, 0.5, clamp(spread, 0.0, 1.0));
  float cone = 1.0 - smoothstep(width * 0.4, width, off);
  float throwFade = exp(-r * mix(2.4, 1.0, spread)) * smoothstep(0.0, 0.06, r);
  vec2 dustAt = vec2(off * 9.0, r * 5.0 - uTime * 0.6);
  float dust = 0.8 + 0.28 * (fieldGradientNoise(dustAt) +
                             0.5 * fieldGradientNoise(dustAt * 2.3 + vec2(11.7, 3.1)));
  float lit = clamp(cone * throwFade * dust * mix(0.55, 1.25, e), 0.0, 1.0);
  vec3 colour = mix(uPrimary, vec3(1.0), lit * 0.45);
  return vec4(colour, lit);
}

// Crepuscular rays: fBm read over the angle around a hanging point, so the
// streaks are radial and constant along each ray, fanned downward and fading
// with distance. The angle is measured from straight down, which parks the
// fBm seam at +/-PI behind the sector window where it never draws.
vec4 light_shafts(vec2 p, vec2 from, float e, float blades, float haze) {
  vec2 v = p - from;
  float r = length(v);
  float off = mod(atan(v.y, v.x) + PI * 0.5 + PI, 2.0 * PI) - PI;
  float fan = 1.0 - smoothstep(0.85, 1.35, abs(off));
  float streaks = fieldFbm(vec2(off * mix(2.5, 10.0, clamp(blades, 0.0, 1.0)),
                                r * 0.4 - uTime * 0.04));
  float rays = smoothstep(0.42, 0.8, streaks);
  float carry = exp(-r * mix(2.6, 0.85, clamp(haze, 0.0, 1.0))) * smoothstep(0.0, 0.05, r);
  float lit = clamp(rays * fan * carry * mix(0.5, 1.2, e), 0.0, 1.0);
  vec3 colour = mix(uPrimary, vec3(1.0), lit * 0.35);
  return vec4(colour, lit);
}

// Sunlight through water: two Worley layers drifting against each other, the
// pattern bright where either layer nears a feature point and flashing where
// both do. The counter-drift is what makes the web dance rather than slide.
vec4 light_caustics(vec2 p, float e, float weave, float glint) {
  float scale = mix(2.5, 8.0, clamp(weave, 0.0, 1.0));
  vec2 sway = vec2(uTime * 0.05, uTime * 0.031);
  float w1 = fieldWorleyF1(p * scale + sway);
  float w2 = fieldWorleyF1(p * scale * 1.27 + vec2(17.3, 9.1) - sway * 1.4);
  float sharp = mix(2.2, 9.0, clamp(glint, 0.0, 1.0));
  float web = pow(clamp(1.0 - min(w1, w2), 0.0, 1.0), sharp);
  float crossings = pow(clamp((1.0 - w1) * (1.0 - w2), 0.0, 1.0), sharp * 0.5);
  float lit = clamp((web * 0.75 + crossings * 0.55) * mix(0.5, 1.2, e), 0.0, 1.0);
  vec3 colour = mix(uPrimary, vec3(1.0), lit * lit * 0.5);
  return vec4(colour, lit);
}
`;
