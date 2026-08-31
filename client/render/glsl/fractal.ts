/**
 * The hard ceiling for one fractal evaluation.
 *
 * Exported because the circuit compiler charges this exact worst case every
 * time a fractal is read. The detail inlet may stop sooner, but it is a uniform
 * and can be turned after compilation, so the graph has to be safe at the
 * ceiling rather than merely safe at its present setting.
 */
export const FRACTAL_ITERATIONS = 32;

/**
 * Two escape-time fractals behind one bounded orbit implementation.
 *
 * No supersampling and no derivative taps: one fragment performs at most
 * `FRACTAL_ITERATIONS` orbit steps. Most fragments escape earlier, and the
 * Mandelbrot set's main cardioid and period-two bulb skip the loop entirely.
 */
export const FRACTAL_LIB = `
vec2 fractalPoint(vec2 p, float zoom, float turn) {
  float a = (turn - 0.5) * 6.28318530718;
  float co = cos(a), si = sin(a);
  // Full set at zero, down to 1/64 scale at one. Bounded because highp float
  // cannot make an honest deep-zoom picture, however many iterations follow.
  float scale = exp2(mix(0.75, -6.0, clamp(zoom, 0.0, 1.0)));
  return mat2(co, -si, si, co) * p * scale;
}

vec4 fractalColour(vec2 z, vec2 c, float detail, float e) {
  int steps = 8 + int(floor(clamp(detail, 0.0, 1.0) * 24.999));
  float escaped = 0.0;
  float at = float(steps);
  float mag2 = dot(z, z);

  for (int i = 0; i < ${FRACTAL_ITERATIONS}; i++) {
    if (i >= steps) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    mag2 = dot(z, z);
    if (mag2 > 256.0) {
      escaped = 1.0;
      at = float(i);
      break;
    }
  }

  // Smooth escape time removes the contouring that would otherwise need more
  // samples to hide. The beat only turns the palette; it never raises cost.
  float smoothAt = at + 1.0 - log2(log2(max(sqrt(mag2), 2.0001)));
  float orbit = clamp(smoothAt / float(steps), 0.0, 1.0);
  float bands = 0.5 + 0.5 * cos(6.28318530718 *
                (orbit * 4.0 - uBeat * rate(e) * 0.035));
  vec3 outside = mix(uPrimary, vec3(1.0) - uPrimary, bands * 0.72);
  outside *= mix(0.35, 1.0, 1.0 - orbit);
  vec3 inside = uPrimary * mix(0.12, 0.28, e);
  return vec4(mix(inside, outside, escaped), 1.0);
}

vec4 fractalMandelbrot(vec2 p, float zoom, float turn, float detail, float e) {
  vec2 c = fractalPoint(p, zoom, turn) + vec2(-0.55, 0.0);

  // The two large known interior regions. Fragments here can never escape, so
  // proving that once is cheaper than asking the orbit the same question 32 times.
  float q = dot(c - vec2(0.25, 0.0), c - vec2(0.25, 0.0));
  bool cardioid = q * (q + c.x - 0.25) <= 0.25 * c.y * c.y;
  bool bulb = dot(c - vec2(-1.0, 0.0), c - vec2(-1.0, 0.0)) <= 0.0625;
  if (cardioid || bulb) return vec4(uPrimary * mix(0.12, 0.28, e), 1.0);

  return fractalColour(vec2(0.0), c, detail, e);
}

vec4 fractalJulia(vec2 p, float zoom, float turn, float detail, float shape, float e) {
  vec2 z = fractalPoint(p, zoom, turn);
  float a = clamp(shape, 0.0, 1.0) * 6.28318530718;
  vec2 c = vec2(cos(a), sin(a)) * 0.7885;
  return fractalColour(z, c, detail, e);
}
`;
