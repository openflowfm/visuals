import { describe, expect, it } from 'vitest';
import {
  apply,
  columns,
  invert,
  isSquare,
  squareToQuad,
  warpFor,
  KNEE,
  OUTPUT_SHADER,
  SQUARE,
  type Corners,
} from './output.ts';

/**
 * The output stage's maths.
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

describe('knowing when the corners are square', () => {
  it('is exact enough to drive a reset button and loose enough to survive a float', () => {
    expect(isSquare(SQUARE)).toBe(true);
    expect(isSquare(ANGLED)).toBe(false);
    expect(isSquare({ ...SQUARE, tr: [1 - 1e-9, 0] })).toBe(true);
    expect(isSquare({ ...SQUARE, tr: [0.999, 0] })).toBe(false);
  });
});

describe('the shoulder', () => {
  it('spells its knee as a float, which GLSL will not infer', () => {
    // `const float knee = 1;` does not compile, and a knee that arrived as an
    // integer would take the whole output stage down with it — which is the
    // entire picture, not one effect.
    expect(OUTPUT_SHADER).toContain(`const float knee = ${KNEE.toFixed(3)};`);
    expect(OUTPUT_SHADER).toMatch(/const float knee = \d+\.\d+;/);
  });

  it('leaves room under the knee for a picture to live in', () => {
    // If the knee sat low, this would be a dimmer rather than a shoulder: every
    // midtone would be compressed and the whole frame would go flat.
    expect(KNEE).toBeGreaterThan(0.6);
    expect(KNEE).toBeLessThan(0.95);
  });

  it('is applied before the test grid, so the grid stays readable', () => {
    // The grid is how a projector gets lined up. Compressing it along with the
    // picture would make it dimmest exactly where the picture is brightest.
    // Against the branch, not the uniform declaration — that one is at the top
    // of the file and would make this assertion pass for the wrong reason.
    expect(OUTPUT_SHADER.indexOf('shoulder(c.r)')).toBeLessThan(
      OUTPUT_SHADER.indexOf('if (uTest'),
    );
  });
});

/** The shoulder, mirrored, so what it can and cannot reach is a fact and not a hope. */
const shoulder = (x: number): number =>
  x < KNEE ? x : KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE)));

describe('the last stage before eight bits', () => {
  it('needs light above white to make white, which is what the buffer feeds it', () => {
    // The shoulder is asymptotic, so an input of exactly one comes out at 0.908
    // — 232 of 255. For as long as the buffer between the flow and this stage
    // was RGBA8, one was also the *most* it could ever be handed, so no pixel
    // the app drew ever exceeded 232 and every white on every wall was a grey.
    // Half floats are what let the overbright reach it. See createTarget.
    expect(shoulder(1)).toBeCloseTo(0.908, 3);
    expect(Math.round(shoulder(1) * 255)).toBe(232);
    // Given real headroom it does reach the top of the range.
    expect(Math.round(shoulder(4) * 255)).toBe(255);
    // And it is monotone the whole way, or a highlight would fold back on itself.
    let previous = -1;
    for (let step = 0; step <= 200; step++) {
      const at = shoulder((step / 200) * 5);
      expect(at).toBeGreaterThanOrEqual(previous);
      previous = at;
    }
  });

  it('dithers, because a wide gradient crosses fewer than 256 levels', () => {
    // The defect this removes is not subtle and is not in the flows: a halo
    // falling off across a few hundred pixels lands as a staircase of flat
    // plateaus with a hard step between each, and the eye reads those as contour
    // lines drawn across something that should be continuous.
    expect(OUTPUT_SHADER).toContain('dithered(c, gl_FragCoord.xy)');
    // Triangular, from two draws differenced: one uniform draw would bias the
    // plateaus it is trying to break up rather than dissolve them.
    expect(OUTPUT_SHADER).toContain('(low - high) / 255.0');
    // One level, so it is invisible on its own and never lifts black off zero.
    expect(OUTPUT_SHADER).not.toContain('/ 128.0');
  });
});
