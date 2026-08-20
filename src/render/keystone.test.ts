import { describe, expect, it } from 'vitest';
import {
  apply,
  columns,
  invert,
  isSquare,
  squareToQuad,
  warpFor,
  SQUARE,
  type Corners,
} from './keystone.ts';

/**
 * The corner-pin maths.
 *
 * Worth pinning because the failure is silent and looks like a broken renderer:
 * a homography with a transposed term still draws *something*, and what it draws
 * is a picture that will not line up no matter how long you spend dragging its
 * corners. On a wall, in a room, with a band waiting.
 */

/**
 * A projector thrown from the side: the far edge of the wall is further away, so
 * it lands taller. The correction is this shape — short edge near, tall edge far.
 */
const ANGLED: Corners = { tl: [0.06, 0.18], tr: [0.98, 0.02], br: [0.98, 0.98], bl: [0.06, 0.82] };

const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
};

describe('square to quad', () => {
  it('puts the unit square on the quad, corner for corner', () => {
    const m = squareToQuad(ANGLED);
    near(apply(m, [0, 0]), ANGLED.tl);
    near(apply(m, [1, 0]), ANGLED.tr);
    near(apply(m, [1, 1]), ANGLED.br);
    near(apply(m, [0, 1]), ANGLED.bl);
  });

  it('leaves a square square', () => {
    const m = squareToQuad(SQUARE);
    near(apply(m, [0.37, 0.62]), [0.37, 0.62]);
  });

  it('takes the affine branch for a parallelogram, and is still right', () => {
    // Four corners with no perspective in them: the projective terms are exactly
    // zero rather than nearly zero, which is a real case and not a guard.
    const shear: Corners = { tl: [0.1, 0], tr: [0.9, 0], br: [1, 1], bl: [0.2, 1] };
    const m = squareToQuad(shear);
    expect(m[6]).toBe(0);
    expect(m[7]).toBe(0);
    near(apply(m, [1, 1]), shear.br);
  });

  it('bends the middle, which is the whole point of a homography', () => {
    // An affine map puts the centre of the square at the average of the four
    // corners. A projective one pulls it toward the *near* edge, and that pull
    // is exactly the foreshortening being cancelled — a scale or a shear cannot
    // produce it, which is why two keystone sliders never quite line up.
    const centre = apply(squareToQuad(ANGLED), [0.5, 0.5]);
    const meanX = (ANGLED.tl[0] + ANGLED.tr[0] + ANGLED.br[0] + ANGLED.bl[0]) / 4;
    expect(centre[0]).toBeCloseTo(0.428, 3);
    expect(centre[0]).toBeLessThan(meanX - 0.05);
  });
});

describe('the warp the shader gets', () => {
  it('is backwards: a destination corner reads the source corner', () => {
    // The shader is asked what colour an output pixel is and has to answer by
    // reading the input, so the mapping it needs is the inverse. Forwards would
    // leave holes wherever the warp stretched.
    const w = warpFor(ANGLED);
    near(apply(w, ANGLED.tl), [0, 0]);
    near(apply(w, ANGLED.br), [1, 1]);
  });

  it('round-trips against the forward map anywhere, not just at the corners', () => {
    const forward = squareToQuad(ANGLED);
    const back = warpFor(ANGLED);
    for (const p of [
      [0.5, 0.5],
      [0.13, 0.86],
      [0.99, 0.01],
    ] as const) {
      near(apply(back, apply(forward, p)), p);
    }
  });

  it('sends the matrix in the order GL reads it without transposing', () => {
    // Column-major. A transposed homography still draws a picture, which is why
    // this is asserted rather than eyeballed.
    near(Array.from(columns([1, 2, 3, 4, 5, 6, 7, 8, 9])), [1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });
});

describe('degenerate input', () => {
  it('falls back to the identity rather than to NaN', () => {
    // Dragging two corners onto each other is one gesture away at all times, and
    // a frame of NaN is a black screen that does not come back.
    const collapsed: Corners = { tl: [0.5, 0.5], tr: [0.5, 0.5], br: [0.5, 0.5], bl: [0.5, 0.5] };
    for (const v of squareToQuad(collapsed)) expect(Number.isFinite(v)).toBe(true);
    for (const v of warpFor(collapsed)) expect(Number.isFinite(v)).toBe(true);
    expect(invert([1, 1, 1, 1, 1, 1, 1, 1, 1])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('skipping the pass', () => {
  it('knows when there is nothing to correct', () => {
    // Square corners skip the whole pass, so everyone whose projector is pointed
    // at the wall pays nothing for this existing.
    expect(isSquare(SQUARE)).toBe(true);
    expect(isSquare(ANGLED)).toBe(false);
    expect(isSquare({ ...SQUARE, tr: [1 - 1e-9, 0] })).toBe(true);
    expect(isSquare({ ...SQUARE, tr: [0.999, 0] })).toBe(false);
  });
});
