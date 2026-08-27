/**
 * Every one-tap function the vocabulary's modes are built from: `lens` moving a
 * point, `grade` changing a colour, `halftone` reducing one to a pattern, and
 * `displace` moving a point by what a picture says.
 *
 * The multi-tap effects — `shift`, `smear`, `bloom`, `edge` — are not
 * here. They read their input at several points, and under a graph an input is
 * an expression rather than a texture, so what to read *is* the compiler's
 * business. See `circuit.ts`.
 *
 * What decides whether something lands here rather than there is therefore
 * cost, not family: everything below is one read of whatever it was handed, so
 * a graph can stack as many of them as it likes.
 */
export const EFFECT_LIB = `
vec2 fxMirror(vec2 p, float line, float angle) {
  float a = angle * PI;
  float c = cos(a), s = sin(a);
  vec2 q = mat2(c, -s, s, c) * p;
  float at = (line - 0.5) * 2.0;
  q.x = at - abs(q.x - at);
  return mat2(c, s, -s, c) * q;
}

vec2 fxKaleido(vec2 p, float segments, float spin, float e) {
  float n = floor(max(2.0, 2.0 + segments * 10.0 + e * 4.0));
  float a = atan(p.y, p.x) + uBeat * (spin - 0.5) * 0.6;
  float r = length(p);
  float wedge = PI / n;
  a = abs(mod(a, wedge * 2.0) - wedge);
  return vec2(cos(a), sin(a)) * r;
}

vec2 fxPixelate(vec2 p, float blocks, float resolve, float e) {
  vec2 uv = uncentred(p);
  float base = mix(4.0 + blocks * 124.0, (4.0 + blocks * 124.0) * 0.45, e);
  float steps = max(2.0, mix(base, base * 4.0, (1.0 - uPhase / uQuantum) * resolve));
  return recentred((floor(uv * steps) + 0.5) / steps);
}

vec2 fxRipple(vec2 p, float waves, float depth, float speed, float e) {
  vec2 uv = uncentred(p);
  float r = length(p);
  float n = 2.0 + waves * 58.0;
  float wave = sin(r * mix(n * 0.7, n * 2.0, e) - uBeat * rate(e) * (0.25 + speed * 3.75) * PI * 2.0);
  float push = wave * depth * (0.01 + uLevel * 0.04);
  return recentred(uv + normalize(p + 1e-6) * push);
}

vec2 fxSlice(vec2 p, float bands, float throwBy, float e) {
  vec2 uv = uncentred(p);
  float n = floor(mix(5.0, 26.0, bands));
  float row = floor(uv.y * n);
  float tick = floor(uBeat * rate(e));
  float pick = hash(vec2(row * 1.7, tick));
  float push = (hash(vec2(row, tick * 2.3)) - 0.5) * throwBy * 0.5 * step(0.55, pick);
  // Wrapped rather than clamped: a slice that ran off the edge and smeared
  // would read as a broken texture instead of as a deliberate glitch.
  return recentred(vec2(fract(uv.x + push), uv.y));
}

vec2 fxTwist(vec2 p, float turn, float sway, float e) {
  float a = (turn - 0.5) * 9.0 * length(p) + sin(uBeat * rate(e) * PI * 0.5) * sway * 1.5;
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec4 fxPosterize(vec4 c, float levels) {
  float a = max(c.a, 1e-4);
  float steps = floor(mix(14.0, 2.0, levels));
  return vec4(clamp(floor(c.rgb / a * steps + 0.5) / steps, 0.0, 1.0) * c.a, c.a);
}

vec4 fxInvert(vec4 c, float hold, float speed, float e) {
  float a = max(c.a, 1e-4);
  float on = step(1.0 - hold, beatPulse(rate(e) * mix(0.5, 2.0, speed), e));
  return vec4(mix(c.rgb / a, vec3(1.0) - c.rgb / a, on) * c.a, c.a);
}

// --- the colour where it already is --------------------------------------

// The one luminance every colour operation here agrees on. Rec. 709, because
// the wall is a projector rather than a scope, and green carrying most of the
// weight is what makes a desaturated frame look like the frame rather than like
// a badly exposed copy of it.
float fxLuma(vec3 col) {
  return dot(col, vec3(0.2126, 0.7152, 0.0722));
}

// Centred, like every other bipolar control here: a half is the picture that
// arrived, zero is grey, one is twice as loud. There was no way to say either
// before this, which is why footage could never be made to sit under anything.
vec4 fxSaturate(vec4 c, float amount) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  vec3 pulled = mix(vec3(fxLuma(col)), col, clamp(amount, 0.0, 1.0) * 2.0);
  return vec4(clamp(pulled, 0.0, 1.0) * c.a, c.a);
}

// Luminance into a two-point ramp that ends at the room's own colour.
//
// The most content-preserving thing in this file, and it is worth saying why:
// the brightness carrying the picture is passed through untouched and only the
// hue is being decided, so a face is still a face and a logo is still legible
// while the frame agrees with the colourway. That is the whole trade the video
// vocabulary is after — breathe, stay decipherable.
vec4 fxTint(vec4 c, float amount, float bias) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  // The bias bends the ramp rather than sliding it, so the tint can be pushed
  // into the shadows or held up in the highlights without clipping either end.
  float shaped = pow(clamp(fxLuma(col), 0.0, 1.0), exp2((0.5 - bias) * 2.4));
  vec3 duo = mix(uColor * 0.12, mix(uColor, vec3(1.0), 0.3), shaped);
  return vec4(clamp(mix(col, duo, clamp(amount, 0.0, 1.0)), 0.0, 1.0) * c.a, c.a);
}

// A fold in the transfer curve, and NOT the beat-gated flip beside it.
//
// invert turns the whole frame over on a division, which is an event. This
// bends everything above a pivot back down the other side and leaves it there,
// which is a look: edges survive the fold, so the picture still reads as itself
// under impossible light. Soft-shouldered rather than a step, because a hard
// threshold on footage crawls with compression noise along the pivot.
vec4 fxSolarize(vec4 c, float pivot, float amount) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  float at = mix(0.25, 0.9, clamp(pivot, 0.0, 1.0));
  vec3 turned = mix(col, vec3(1.0) - col, smoothstep(at - 0.08, at + 0.08, col));
  return vec4(clamp(mix(col, turned, clamp(amount, 0.0, 1.0)), 0.0, 1.0) * c.a, c.a);
}

// A permutation of the channels, snapped to thirds.
//
// Snapped because the useful gesture is a wave wired into it: quantised, the
// frame lands on one of three whole rotations in time with the music, where a
// smeared one spends most of the bar between two wrong colours. It is a
// permutation rather than a rotation about the grey axis, so luminance is very
// nearly kept and the content survives a shift that changes every colour in it.
vec4 fxChannels(vec4 c, float rotate) {
  float which = floor(clamp(rotate, 0.0, 0.999) * 3.0);
  vec3 col = which < 1.0 ? c.rgb : (which < 2.0 ? c.gbr : c.brg);
  return vec4(col, c.a);
}

// --- brightness thrown away in a pattern that keeps the picture ------------

// The ruling is a count across the frame rather than a count of output pixels,
// for the reason edge's tap is a fraction of the height: this is authored on a
// 320-pixel node face, judged on an 800-pixel bench and projected at 1920, and a
// cell measured in pixels is three different screens in those three places.
vec2 fxScreen(vec2 p, float size, float tilt) {
  float a = (tilt - 0.5) * PI;
  float co = cos(a), si = sin(a);
  return mat2(co, -si, si, co) * p * mix(150.0, 16.0, clamp(size, 0.0, 1.0));
}

// Ink keeps the colour it had. A halftone is monochrome in print because print
// has one ink per pass; here the paper is transparent and the dot is the picture
// at that point, which reads as the footage rather than as an effect over it.
vec4 fxDots(vec4 c, vec2 p, float size, float tilt) {
  float lit = clamp(fxLuma(c.rgb / max(c.a, 1e-4)), 0.0, 1.0);
  vec2 cell = fract(fxScreen(p, size, tilt)) - 0.5;
  // The square root, because a dot's ink is its AREA and the eye is reading
  // ink. Radius straight off the luminance makes every midtone too dark.
  float on = 1.0 - smoothstep(-0.05, 0.05, length(cell) - sqrt(lit) * 0.7);
  return vec4(c.rgb * on, c.a * on);
}

vec4 fxLines(vec4 c, vec2 p, float size, float tilt) {
  float lit = clamp(fxLuma(c.rgb / max(c.a, 1e-4)), 0.0, 1.0);
  float band = abs(fract(fxScreen(p, size, tilt).y) - 0.5) * 2.0;
  float on = 1.0 - smoothstep(-0.08, 0.08, band - sqrt(lit));
  return vec4(c.rgb * on, c.a * on);
}

// The ordered 4x4 threshold every dither is, kept as a constant array rather
// than as arithmetic so it is the matrix somebody can look up rather than a
// clever expression nobody can check.
float fxBayer(vec2 q) {
  float m[16] = float[16](
    0.0,  8.0,  2.0, 10.0,
   12.0,  4.0, 14.0,  6.0,
    3.0, 11.0,  1.0,  9.0,
   15.0,  7.0, 13.0,  5.0);
  vec2 i = floor(mod(q, 4.0));
  return (m[int(i.x) + int(i.y) * 4] + 0.5) / 16.0;
}

vec4 fxDither(vec4 c, vec2 p, float size) {
  float lit = clamp(fxLuma(c.rgb / max(c.a, 1e-4)), 0.0, 1.0);
  float on = step(fxBayer(p * mix(360.0, 44.0, clamp(size, 0.0, 1.0))), lit);
  return vec4(c.rgb * on, c.a * on);
}

// Alpha survives a scanline where it does not survive a dot, and the difference
// is what the two things ARE: a screen decides whether there is ink here, and a
// tube decides how brightly this row is lit. A scanline that carved holes would
// composite as lace over whatever is under it.
vec4 fxScanlines(vec4 c, vec2 p, float size, float weight) {
  float row = cos(p.y * mix(420.0, 60.0, clamp(size, 0.0, 1.0)) * PI);
  return vec4(c.rgb * mix(1.0, 0.5 + 0.5 * row, clamp(weight, 0.0, 1.0)), c.a);
}

// --- a point moved by what a picture says ---------------------------------

// Red and green as x and y, the way a displacement map has always been read.
// Transparent field, no push: an image on contain or a light with a falloff
// displaces only where it actually covers something.
vec2 fxDisplaceMap(vec2 p, vec4 field, float amount) {
  vec2 push = (field.rg / max(field.a, 1e-4) - 0.5) * 2.0;
  return p + push * field.a * clamp(amount, 0.0, 1.0) * 0.35;
}

// Brightness as a DIRECTION rather than as a pair of channels.
//
// Every picture here is tinted by the colourway, so a source's red and green
// move together and reading them as x and y would lock the whole displacement
// to one diagonal — the map mode is for footage and photographs, where the
// channels are independent, and this one is for everything else.
vec2 fxDisplaceCurl(vec2 p, vec4 field, float amount) {
  float ang = fxLuma(field.rgb / max(field.a, 1e-4)) * PI * 2.0;
  return p + vec2(cos(ang), sin(ang)) * field.a * clamp(amount, 0.0, 1.0) * 0.35;
}
`;
