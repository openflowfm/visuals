/**
 * Shapes measured rather than drawn.
 *
 * `polar` splits a point into its distance from the centre and its direction
 * around it, which is the whole of what the vocabulary could say about where a
 * point *is*. This is the same node generalised off the origin and onto a
 * shape: how far this point is from a circle, a rose, a lissajous figure —
 * and how far along that shape the nearest part of it lies.
 *
 * It gives back a number and never a colour, which is the point. What a
 * distance becomes is somebody else's decision: `glow` makes it a lit stroke,
 * `ramp` makes it a colour, `math` makes it into another distance, and
 * `displace` reads it off a picture instead. A node that drew its own line
 * would have to own a thickness, a falloff and a colour, and would then be one
 * more source that only draws what its author thought of.
 *
 * **Most of these are radial distances, not perpendicular ones.** For a circle,
 * a box and a straight line the two are the same and the maths is exact. For a
 * rose, a star and a polygon the distance is measured along the ray from the
 * centre, which is cheap, continuous, and wrong by the cosine of how steeply
 * the curve leans away from that ray. What it looks like is a stroke that
 * thickens where the curve is steep — which is what a brush does, and reads as
 * drawn rather than as computed. An exact SDF for a rhodonea costs a root
 * solve per pixel and buys a stroke of relentlessly even weight.
 */

/** Segments walked along a curve that has no closed-form distance. */
export const FIGURE_SAMPLES = 32;

export const FIGURE_LIB = `
const int FIGURE_SAMPLES = ${FIGURE_SAMPLES};

// The direction around the centre, as the 0-1 the rest of the graph speaks.
float figureAround(vec2 p) {
  return atan(p.y, p.x) / 6.28318530718 + 0.5;
}

float figureRadius(float size) {
  return mix(0.05, 0.6, clamp(size, 0.0, 1.0));
}

// Distance to a segment, for the curves that have to be walked.
float figureSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * h);
}

vec2 figure_circle(vec2 p, float size) {
  return vec2(abs(length(p) - figureRadius(size)), figureAround(p));
}

// The outline of a rounded square. Exact: the box distance with the corner
// radius taken off it, and the absolute value taken so the inside of the
// outline is as far from it as the outside.
vec2 figure_box(vec2 p, float size, float corner) {
  float r = figureRadius(size);
  float k = mix(0.0, 0.9, clamp(corner, 0.0, 1.0)) * r;
  vec2 q = abs(p) - (r - k);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - k;
  return vec2(abs(d), figureAround(p));
}

// A segment through the centre at an angle, with the position along it running
// from one end to the other rather than around anything.
vec2 figure_line(vec2 p, float turn, float span) {
  float a = clamp(turn, 0.0, 1.0) * 6.28318530718;
  vec2 dir = vec2(cos(a), sin(a));
  float reach = mix(0.05, 0.9, clamp(span, 0.0, 1.0));
  float t = clamp(dot(p, dir), -reach, reach);
  return vec2(length(p - dir * t), t / reach * 0.5 + 0.5);
}

// Part of a circle, opened symmetrically about straight up so that growing the
// sweep never makes the arc jump. Past its ends the distance is to the end
// itself, so a wide glow rounds the cap instead of ringing the whole circle.
vec2 figure_arc(vec2 p, float size, float sweep) {
  float r = figureRadius(size);
  float swept = clamp(sweep, 0.0, 1.0) * PI;
  float a = atan(p.x, p.y);
  vec2 cap = vec2(sin(swept), cos(swept)) * r;
  float d = abs(a) <= swept
    ? abs(length(p) - r)
    : length(vec2(abs(p.x), p.y) - cap);
  return vec2(d, clamp(a / max(swept, 1e-4) * 0.5 + 0.5, 0.0, 1.0));
}

// A regular polygon, exactly: fold the plane into one wedge and measure to the
// edge line, which is the apothem away from the centre.
vec2 figure_polygon(vec2 p, float size, float sides) {
  float n = 3.0 + floor(clamp(sides, 0.0, 1.0) * 9.0);
  float r = figureRadius(size);
  float wedge = PI / n;
  float folded = mod(atan(p.y, p.x) + wedge, wedge * 2.0) - wedge;
  return vec2(abs(cos(folded) * length(p) - r * cos(wedge)), figureAround(p));
}

// A star, as a radius that falls from a tip to a valley across each wedge.
vec2 figure_star(vec2 p, float size, float points, float spike) {
  float n = 3.0 + floor(clamp(points, 0.0, 1.0) * 9.0);
  float r = figureRadius(size);
  float wedge = PI / n;
  float folded = abs(mod(atan(p.y, p.x) + wedge, wedge * 2.0) - wedge);
  float edge = mix(r, r * mix(0.9, 0.15, clamp(spike, 0.0, 1.0)), folded / wedge);
  return vec2(abs(length(p) - edge), figureAround(p));
}

// A rhodonea: the radius is a cosine of the angle, so the petal count follows
// the number rather than a shape being chosen from a list of them. An even
// count draws twice as many petals as it says, which is what a rose curve does
// and is worth leaving alone.
vec2 figure_rose(vec2 p, float size, float petals) {
  float k = 1.0 + floor(clamp(petals, 0.0, 1.0) * 9.0);
  float r = mix(0.08, 0.6, clamp(size, 0.0, 1.0));
  float a = atan(p.y, p.x);
  return vec2(abs(length(p) - r * abs(cos(k * a))), figureAround(p));
}

vec2 figureLissajousAt(float t, float r, float b, float phase) {
  return vec2(sin(2.0 * t + phase), sin(b * t)) * r;
}

// The one curve here with no closed form, so it is walked: thirty-two segments
// around the figure and the nearest of them wins. The cost is charged before
// the graph reaches the GPU, the way a fractal's is.
vec2 figure_lissajous(vec2 p, float size, float ratio, float turn) {
  float r = mix(0.08, 0.6, clamp(size, 0.0, 1.0));
  float b = 1.0 + floor(clamp(ratio, 0.0, 1.0) * 6.0);
  float phase = clamp(turn, 0.0, 1.0) * PI;
  float stride = 6.28318530718 / float(FIGURE_SAMPLES);
  vec2 prev = figureLissajousAt(0.0, r, b, phase);
  float best = 1e9;
  float at = 0.0;
  for (int i = 1; i <= FIGURE_SAMPLES; i++) {
    vec2 cur = figureLissajousAt(float(i) * stride, r, b, phase);
    float d = figureSegment(p, prev, cur);
    if (d < best) {
      best = d;
      at = float(i - 1) / float(FIGURE_SAMPLES);
    }
    prev = cur;
  }
  return vec2(min(best, 1.0), at);
}
`;
