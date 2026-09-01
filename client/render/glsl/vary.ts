/**
 * Making the copies differ.
 *
 * `array` hands out a copy number and `figure` hands out how far along a curve
 * a point is, and both of those are *ordered* — copy three is between two and
 * four, and always will be. Wire either straight into a control and what comes
 * out is a gradient across the repeat: a fan whose arms get steadily brighter
 * clockwise, which reads as a ramp someone applied rather than as sixteen
 * separate lights.
 *
 * What was missing is the step from an ordered number to an unordered one that
 * is nonetheless *stable* — the same copy gets the same value on every frame,
 * so nothing flickers, but neighbours have nothing to do with each other. That
 * is the whole node. It is one hash and no loop, so it costs what a math costs.
 *
 * The two modes are two distributions, and the second is the one worth having.
 * A bank of lights is never evenly lit: most of it is a dim bed and a few of
 * them are burning, and that ratio is what the eye reads as *many* rather than
 * as a pattern. Measured against the footage this vocabulary was built to
 * match, an even roll across sixteen arms came back at a saturation of 0.26 —
 * every arm hot enough to have lost its colour — where the reference holds a
 * coloured bed under a handful of blown strokes.
 */
export const VARY_LIB = `
// Above about this many the steps are finer than anything reads as separate,
// and the node is indistinguishable from noise.
#define VARY_STEPS 48.0

// The value a roll is looked up with. At zero steps the number is taken as it
// comes, which is what a continuous input wants; above that it is cut into
// bands first, so a whole segment of a curve shares one roll and the curve
// comes out dashed rather than dissolved.
float varyKey(float n, float steps) {
  float s = floor(clamp(steps, 0.0, 1.0) * VARY_STEPS);
  float t = clamp(n, 0.0, 1.0);
  return s < 1.0 ? t : (floor(t * s) + 0.5) / s;
}

float vary_even(float n, float steps) {
  float key = varyKey(n, steps);
  return hash(vec2(key * 91.7 + 3.1, key * 13.3 - 7.9));
}

// The same roll, weighted so most of them land low. Cubed rather than squared
// because squaring still leaves a third of the copies in the top half, which
// on a ring of sixteen is five arms burning and reads as a mistake rather than
// as a highlight.
float vary_few(float n, float steps) {
  float roll = vary_even(n, steps);
  return roll * roll * roll;
}
`;
