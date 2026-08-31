/**
 * Cheap geometric pictures whose definitions are useful to test independently.
 *
 * These are generator bodies rather than complete functions. The source
 * assembler wraps each one in `vec4 gen_NAME(vec2 p, float e, ...)`, with the
 * extra floats named by `SOURCE_VALUES`, alongside the generators that already
 * ship. Both have constant work: no loop, texture read, or data-dependent
 * search.
 */
export const PATTERN_BODIES = {
  checker: `
  // The standard square-lattice parity pattern. GLSL's mod is defined in
  // terms of floor, so this stays a checker on the negative half of centred p.
  float density = mix(7.0, 25.0, tiles);
  vec2 q = p * density + vec2(uBeat * rate(e) * 0.2, 0.0);
  vec2 cell = floor(q);
  float parity = mod(cell.x + cell.y, 2.0);

  // Leave a narrow transparent joint between tiles. The edges are ordered:
  // smoothstep is undefined when its lower edge is not below its upper edge.
  vec2 within = abs(fract(q) - 0.5);
  float edgeDistance = 0.5 - max(within.x, within.y);
  float feather = max(density / min(uRes.x, uRes.y), 0.001);
  float inset = smoothstep(0.0, feather, edgeDistance);

  vec3 ink = mix(uPrimary, vec3(1.0) - uPrimary, parity * 0.72);
  return vec4(ink * (0.48 + uLevel * 0.62),
              inset * mix(0.28, 0.82, parity));`,

  rays: `
  // atan(y, x) is undefined when both arguments are zero. Give the centre one
  // harmless answer before asking for an angle; it also leaves a clean pinhole
  // where all of the sectors meet.
  float radius2 = dot(p, p);
  if (radius2 < 1e-10) return vec4(uPrimary, 0.0);

  // An even number of equal angular sectors, alternately dark and bright.
  // Positive radial scaling cannot change the sector: only the angle matters.
  float sectors = 2.0 * floor(mix(4.0, 16.0, spokes));
  float angle = atan(p.y, p.x) + PI + uBeat * rate(e) * 0.16;
  float sector = angle * sectors / (2.0 * PI);
  float parity = mod(floor(sector), 2.0);

  // Anti-alias each boundary in sector coordinates without derivatives. Near
  // the centre one pixel spans more angle, so the feather grows with 1/r.
  float within = fract(sector);
  float edgeDistance = min(within, 1.0 - within);
  float angularPixel = sectors /
    (2.0 * PI * max(sqrt(radius2) * min(uRes.x, uRes.y), 1.0));
  float feather = clamp(angularPixel, 0.001, 0.49);
  float interior = smoothstep(0.0, feather, edgeDistance);

  vec3 ink = mix(uPrimary * 0.55, mix(uPrimary, vec3(1.0), 0.34), parity);
  return vec4(ink * (0.5 + uLevel * 0.65),
              interior * mix(0.18, 0.78, parity));`,
} satisfies Record<'checker' | 'rays', string>;
