/**
 * The CPU mirror of the shader preamble's scalar maths.
 *
 * A leaf, the way `ports.ts` is: it imports nothing, so a node folder and the
 * compiler can both read it without either importing the other. That matters
 * here more than usual — the whole point of this file is that one expression
 * has one answer, and a second copy of it kept somewhere convenient is exactly
 * how the two answers appear.
 *
 * `hash` in particular has to be **bit for bit**. Under the old sine hash it
 * could not be: the GPU evaluated `fract(sin(...) * 43758.5453)` at 32 bits and
 * a CPU copy at 64, and that expression amplifies a one-ulp difference into an
 * unrelated number. Integer mixing removes the disagreement rather than
 * narrowing it. `Math.imul` is the 32-bit wrapping multiply GLSL's `uint`
 * already does, `>>> 0` keeps the intermediate unsigned, and a float goes in by
 * its 32-bit bit pattern so both sides start from the same bits.
 */

export const clamp = (value: number, low = 0, high = 1): number =>
  Math.max(low, Math.min(high, value));
export const fract = (value: number): number => value - Math.floor(value);
export const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

const FLOAT_BITS = new DataView(new ArrayBuffer(4));

function floatBitsToUint(value: number): number {
  FLOAT_BITS.setFloat32(0, value);
  return FLOAT_BITS.getUint32(0);
}

function hashBits(value: number): number {
  let v = value >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  v = Math.imul(v, 0x846ca68b) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return v;
}

/** The scalar form of the shader preamble's `hash(vec2)`. */
export function hash(x: number, y: number, seed: number): number {
  const mixed =
    (hashBits(Math.imul(floatBitsToUint(x), 0x9e3779b9) >>> 0) ^
      hashBits(Math.imul(floatBitsToUint(y), 0x85ebca6b) >>> 0) ^
      hashBits(floatBitsToUint(seed))) >>>
    0;
  return (hashBits(mixed) & 0x00ffffff) / 16777215;
}

/** The scalar form of the shader preamble's two-dimensional value noise. */
export function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = fract(x);
  let fy = fract(y);
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx),
    fy,
  );
}
