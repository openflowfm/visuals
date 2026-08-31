import { describe, expect, it } from 'vitest';
import { FORM_LIB, FORM_STEPS, FORM_WORK } from './form.ts';
import { FORM_MODES } from '../../../protocol.ts';

const clamp = (value: number, lower: number, upper: number): number =>
  Math.max(lower, Math.min(upper, value));

/**
 * The cage, mirrored: the distance to the twelve edges of a cube.
 *
 * Worth a CPU copy rather than a structural assertion, because the version this
 * replaced was *plausible* — three infinite square tubes clipped to the box —
 * and produced a solid brick. Nothing about the source said so; only drawing it
 * did. These assertions say it in a way that fails the next time somebody has
 * the same good idea.
 */
const cage = (x: number, y: number, z: number, R: number, t: number): number => {
  const side = (v: number) => (v >= 0 ? R : -R);
  const corner = [side(x), side(y), side(z)] as const;
  const run = [clamp(x, -R, R), clamp(y, -R, R), clamp(z, -R, R)] as const;
  const to = (a: number, b: number, c: number) => Math.hypot(x - a, y - b, z - c);
  return (
    Math.min(
      to(run[0], corner[1], corner[2]),
      to(corner[0], run[1], corner[2]),
      to(corner[0], corner[1], run[2]),
    ) - t
  );
};

describe('the cube is edges, not a brick', () => {
  it('is on the surface along an edge and inside the tube around it', () => {
    expect(cage(0, 1, 1, 1, 0.05)).toBeCloseTo(-0.05, 12);
    expect(cage(0.5, 1, 1, 1, 0.05)).toBeCloseTo(-0.05, 12);
    expect(cage(0, 1.05, 1, 1, 0.05)).toBeCloseTo(0, 12);
  });

  it('leaves the middle of the cube empty, which is the whole point of a frame', () => {
    // The centre is a full half-diagonal from the nearest edge. A cage that
    // reported a negative distance here would be a solid, and a march would
    // stop at the first face and draw a box.
    expect(cage(0, 0, 0, 1, 0.05)).toBeCloseTo(Math.SQRT2 - 0.05, 12);
    expect(cage(0, 0, 0, 1, 0.05)).toBeGreaterThan(0.5);
    // So is the middle of a face.
    expect(cage(1, 0, 0, 1, 0.05)).toBeGreaterThan(0.5);
  });

  it('agrees with the definition of an edge, everywhere it is asked', () => {
    // The definition, brute force: the twelve segments of the cube, walked.
    // A march may take the whole reported distance only because this is an
    // exact distance rather than a bound, so it is worth checking against
    // something written a completely different way.
    const brute = (x: number, y: number, z: number, R: number): number => {
      let best = Infinity;
      for (const axis of [0, 1, 2]) {
        for (const a of [-R, R]) {
          for (const b of [-R, R]) {
            const at = [0, 0, 0];
            at[axis] = clamp([x, y, z][axis]!, -R, R);
            at[(axis + 1) % 3] = a;
            at[(axis + 2) % 3] = b;
            best = Math.min(best, Math.hypot(x - at[0]!, y - at[1]!, z - at[2]!));
          }
        }
      }
      return best;
    };
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648) * 4 - 2;
    };
    for (let sample = 0; sample < 400; sample++) {
      const [x, y, z] = [next(), next(), next()];
      expect(cage(x!, y!, z!, 1, 0)).toBeCloseTo(brute(x!, y!, z!, 1), 10);
    }
    // Including the degenerate places, which is where the first version of
    // this was wrong.
    for (const at of [
      [0, 0, 0],
      [0, 0, 0.5],
      [0, 0.5, 0],
      [0.5, 0, 0],
    ] as const) {
      expect(cage(at[0], at[1], at[2], 1, 0)).toBeCloseTo(brute(at[0], at[1], at[2], 1), 10);
    }
  });
});

describe('the march is bounded and says so', () => {
  it('prices the steps it takes plus the four samples a normal costs', () => {
    expect(FORM_WORK).toBe(FORM_STEPS + 4);
    expect(FORM_LIB).toContain(`const int FORM_STEPS = ${FORM_STEPS};`);
    expect((FORM_LIB.match(/formField\(/g) ?? []).length).toBe(
      // One in the loop, four in the normal, and one declaration.
      6,
    );
  });

  it('holds exactly one loop, and it is the ray', () => {
    expect((FORM_LIB.match(/for \(/g) ?? []).length).toBe(1);
    expect(FORM_LIB).toContain('for (int i = 0; i < FORM_STEPS; i++)');
  });

  it('gives every mode a branch of the one field function', () => {
    // The modes are indices into one field function rather than five field
    // functions, because a fragment shader has no function pointers and five
    // marchers would be five copies of the loop.
    const field = FORM_LIB.slice(
      FORM_LIB.indexOf('float formField('),
      FORM_LIB.indexOf('float formStride('),
    );
    expect(FORM_MODES.length).toBe(5);
    for (let i = 0; i < FORM_MODES.length - 1; i++) {
      expect(field).toContain(`if (mode == ${i})`);
    }
    // The last mode is the fall-through, so there is no branch to find for it.
    expect(field).not.toContain(`if (mode == ${FORM_MODES.length - 1})`);
  });

  it('takes half steps only for the shape whose distance is an over-estimate', () => {
    // The helix measures across the strand while the strand moves away along
    // its own axis, so the true nearest surface can be nearer than it says.
    expect(FORM_MODES.indexOf('tube')).toBe(4);
    expect(FORM_LIB).toContain('return mode == 4 ? 0.5 : 0.9;');
  });

  it('accumulates glow along the ray rather than once per step', () => {
    // Steps shrink as a ray closes on a surface, so counting them counts
    // deceleration: a ray grazing a tube took twenty tiny steps beside it and
    // came out as bright as one that went through the middle.
    expect(FORM_LIB).toContain('* carry *');
    expect(FORM_LIB).toContain('float carry = max(d * stride, 0.005);');
  });
});
