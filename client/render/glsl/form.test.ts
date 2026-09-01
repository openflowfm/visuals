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

const roundedBox2 = (x: number, y: number, halfSize: number, corner: number): number => {
  const qx = Math.abs(x) - halfSize + corner;
  const qy = Math.abs(y) - halfSize + corner;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
};

const roundedLoop = (
  x: number,
  y: number,
  plane: number,
  halfSize: number,
  corner: number,
  thick: number,
): number => Math.hypot(Math.abs(roundedBox2(x, y, halfSize, corner)), plane) - thick;

const layerPlane = (value: number, gap: number): number => {
  const folded = Math.abs(value);
  return Math.min(Math.abs(folded - gap * 0.5), Math.abs(folded - gap * 1.5));
};

const segment2 = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const along = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - dx * along, y - ay - dy * along);
};

const reliefCamera = (travel: number, cell: number) => {
  const phase = clamp(travel, 0, 1) * Math.PI * 2;
  const centre = [Math.cos(phase) * cell * 2.2, Math.sin(phase * 2) * cell * 2.2];
  const tangent = [-Math.sin(phase) + 0.0001, 2 * Math.cos(phase * 2) + 0.0001];
  const length = Math.hypot(...tangent);
  return { centre, direction: tangent.map((each) => each / length) };
};

describe('the relief is a grammar of bevelled solids', () => {
  it('contains both open modules and genuinely hollow closed frames', () => {
    // The outer U owns its floor but leaves the centre of its mouth open.
    const u = (x: number, y: number) => Math.min(
      segment2(x, y, -0.32, 0.3, -0.32, -0.24),
      segment2(x, y, -0.32, -0.24, 0.32, -0.24),
      segment2(x, y, 0.32, -0.24, 0.32, 0.3),
    );
    expect(u(0, -0.24)).toBeCloseTo(0, 12);
    expect(u(0, 0.3)).toBeGreaterThan(0.3);

    // A rounded frame is its boundary, not a filled tile.
    expect(Math.abs(roundedBox2(0, 0.29, 0.3, 0.11))).toBeCloseTo(0.01, 12);
    expect(Math.abs(roundedBox2(0, 0, 0.3, 0.11))).toBeGreaterThan(0.25);
    expect(FORM_LIB).toContain('float motif = hash(id + 7.31);');
    expect(FORM_LIB).toContain('formSegment2');
  });

  it('includes paired circular arcs as a curved member of the module grammar', () => {
    const paired = (x: number, y: number) => Math.min(
      Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.5),
      Math.abs(Math.hypot(x + 0.5, y + 0.5) - 0.5),
    );
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]] as const) {
      expect(paired(x, y)).toBeCloseTo(0, 12);
    }
    expect(FORM_LIB).toContain('float first = abs(length(local - vec2(0.5)) - 0.5);');
  });

  it('is a shallow slab with a broad face, not a circular neon cord', () => {
    expect(FORM_LIB).toContain('abs(q.z - height * 0.5)');
    expect(FORM_LIB).toContain('min(max(slab.x, slab.y), 0.0) + length(max(slab, 0.0)) - bevel');
    expect(FORM_LIB).not.toContain('length(vec2(path, q.z - height)) - t');
  });

  it('returns the travelling eye to the same place and heading at the loop seam', () => {
    const start = reliefCamera(0, 0.5);
    const end = reliefCamera(1, 0.5);
    for (let axis = 0; axis < 2; axis++) {
      expect(end.centre[axis]).toBeCloseTo(start.centre[axis]!, 12);
      expect(end.direction[axis]).toBeCloseTo(start.direction[axis]!, 12);
    }
  });
});

describe('the helix travel is normalized', () => {
  it('advances exactly two whole coils from travel zero to one', () => {
    for (const control of [0, 0.2, 0.5, 0.8, 1]) {
      const coil = 0.6 + control * 3.5;
      const end = (Math.PI * 2 / coil) * 2;
      expect(Math.cos(end * coil)).toBeCloseTo(1, 12);
      expect(Math.sin(end * coil)).toBeCloseTo(0, 12);
    }
    expect(FORM_LIB).toContain('clamp(motion, 0.0, 1.0) * cycle * 2.0');
  });
});

describe('the iris is a lens shell around bounded edge-on ribs', () => {
  const lens2 = (x: number, y: number, centre: number, radius: number) => Math.max(
    Math.hypot(x, y - centre) - radius,
    Math.hypot(x, y + centre) - radius,
  );

  it('puts an exact two-circle lens boundary around an empty middle', () => {
    const centre = 0.34;
    const radius = 0.84;
    const point = Math.sqrt(radius * radius - centre * centre);
    expect(lens2(point, 0, centre, radius)).toBeCloseTo(0, 12);
    expect(lens2(0, radius - centre, centre, radius)).toBeCloseTo(0, 12);
    expect(Math.abs(lens2(0, 0, centre, radius))).toBeCloseTo(0.5, 12);
  });

  it('folds a finite bank of equal-radius rings without another shader loop', () => {
    expect(FORM_LIB).toContain('float member = round(q.x / spacing);');
    expect(FORM_LIB).toContain('length(local.yz) - radius');
    expect(FORM_LIB).toContain('max(min(bank, pair), abs(q.x) - 0.24)');
    expect(FORM_LIB).not.toContain('radius *= 0.55 +');
    expect(FORM_LIB).toContain('return formIris(q, extra, detail, motion, t);');
  });

  it('returns every rigid rib rotation to its first pose at phase one without moving the shell', () => {
    const angle = (phase: number, member: number) =>
      Math.sin(phase * Math.PI) ** 2 * Math.sin(member * 0.43) * 0.92;
    for (const member of [-7, -2, 0, 3, 8]) {
      expect(angle(1, member)).toBeCloseTo(angle(0, member), 12);
    }
    expect(FORM_LIB).toContain('local.xz = formSpin(');
    expect(FORM_LIB).toContain('if (mode == 8)');
    expect(FORM_LIB).toContain('return formIris(q, extra, detail, motion, t);');
  });

  it('keeps a barrel envelope while its equal hoops twist', () => {
    const profile = (across: number) => 1 - across ** 2 * 0.22;
    expect(profile(0)).toBe(1);
    expect(profile(1)).toBeCloseTo(0.78, 12);
    expect(FORM_LIB).toContain('radius *= 1.0 - across * across * 0.22;');
    expect(FORM_LIB).toContain('swing *= swing;');
  });

  it('crossfades to an explicit symmetric hoop pair at maximum twist', () => {
    expect(FORM_LIB).toContain('float formIrisHoop(');
    expect(FORM_LIB).toContain('spacing * 2.5, swing * 0.72');
    expect(FORM_LIB).toContain('-spacing * 2.5, -swing * 0.72');
    expect(FORM_LIB).toContain('formIrisRib(q, ribs, open, phase, t) + swing * 0.052');
    expect(FORM_LIB).toContain('pair += (1.0 - swing) * 0.065;');
  });

  it('keeps saturated iris highlights in the pale colourway role', () => {
    expect(FORM_LIB).toContain('vec3 hot = mode == 8 ? uChalk : vec3(1.0);');
    expect(FORM_LIB).toContain('if (mode == 8) colour = min(colour, uChalk * 1.02);');
    expect(FORM_LIB).toContain('mix(uAccent, uPrimary, smoothstep(-0.025, 0.025, signedLens))');
  });
});

describe('the loom is repeated construction with a closed flight', () => {
  it('folds every point four cells later onto the same physical member', () => {
    const fold = (value: number, cell: number) => value - cell * Math.round(value / cell);
    for (const value of [-1.17, -0.31, 0, 0.28, 1.41]) {
      expect(fold(value + 4 * 1.13, 1.13)).toBeCloseTo(fold(value, 1.13), 12);
    }
    expect(FORM_LIB).toContain('q -= cell * round(q / cell);');
  });

  it('moves whole bundle planes continuously instead of cutting lower members', () => {
    const lift = (angle: number, phase: number, thick: number) =>
      Math.sin(angle * 2 + phase) * thick;
    expect(lift(-Math.PI, 0, 0.04)).toBeCloseTo(lift(Math.PI, 0, 0.04), 12);
    expect(lift(0, 0, 0.04)).toBeCloseTo(0, 12);
    expect(Math.abs(lift(Math.PI / 4, 0, 0.04))).toBeCloseTo(0.04, 12);
    expect(lift(Math.PI / 4, 0, 0.04)).not.toBeCloseTo(
      lift(Math.PI / 4, (Math.PI * 2) / 3, 0.04),
      3,
    );
    expect(FORM_LIB).toContain('float lift = t;');
    expect(FORM_LIB).toContain('sin(atan(q.y, q.x) * 2.0)');
    expect(FORM_LIB).not.toContain('formUnder');
  });

  it('keeps broad room light off its black chrome while retaining sharp glints', () => {
    expect(FORM_LIB).toContain('float roomWeight = mode == 5 ? 0.65 : 1.0;');
    expect(FORM_LIB).toContain(
      'float glintWeight = mode == 5 ? 0.3 : (mode == 11 ? 0.12 : (mode == 12 ? 0.2 : 1.0));',
    );
  });

  it('returns its eye and heading modulo exactly four repeated cells', () => {
    const camera = (travel: number, cell: number, sway: number, off: number) => {
      const phase = travel * Math.PI * 2;
      return {
        eye: [Math.cos(phase) * sway + off, Math.sin(phase) * sway, travel * cell * 4],
        heading: [-Math.sin(phase) * sway * 0.25, Math.cos(phase) * sway * 0.25, 1],
      };
    };
    const start = camera(0, 1.13, 0.21, -0.08);
    const end = camera(1, 1.13, 0.21, -0.08);
    expect(end.eye[0]).toBeCloseTo(start.eye[0]!, 12);
    expect(end.eye[1]).toBeCloseTo(start.eye[1]!, 12);
    expect((end.eye[2]! - start.eye[2]!) / 1.13).toBeCloseTo(4, 12);
    for (let axis = 0; axis < 3; axis++) {
      expect(end.heading[axis]).toBeCloseTo(start.heading[axis]!, 12);
    }
  });
});

describe('the woven form is twelve hollow loops', () => {
  it('folds onto four distinct parallel planes', () => {
    for (const plane of [-0.3, -0.1, 0.1, 0.3]) {
      expect(layerPlane(plane, 0.2)).toBeCloseTo(0, 12);
    }
    expect(layerPlane(0, 0.2)).toBeCloseTo(0.1, 12);
    expect(layerPlane(0.2, 0.2)).toBeCloseTo(0.1, 12);
  });

  it('puts round tube on a rounded rectangle and leaves its middle empty', () => {
    expect(roundedLoop(0, 0.62, 0, 0.62, 0.2, 0.04)).toBeCloseTo(-0.04, 12);
    expect(roundedLoop(0, 0, 0.1, 0.62, 0.2, 0.04)).toBeGreaterThan(0.5);
  });

  it('eases its rigid tumble away from fourfold sample aliases and closes the seam', () => {
    const angles = (phase: number) => {
      const a = phase * Math.PI * 2;
      return [a + Math.sin(a) * 0.35, a * 2 + Math.sin(a * 2) * 0.22];
    };
    const start = angles(0);
    const end = angles(1);
    expect((end[0]! - start[0]!) / (Math.PI * 2)).toBeCloseTo(1, 12);
    expect((end[1]! - start[1]!) / (Math.PI * 2)).toBeCloseTo(2, 12);
    expect(FORM_LIB).toContain('formSpin(a + sin(a) * 0.35)');
    expect(FORM_LIB).toContain('formSpin(a * 2.0 + sin(a * 2.0) * 0.22)');
  });
});

describe('the truss is the rectangular faces of one layered cuboid', () => {
  it('uses the same three extents for four real rails on three crossing planes', () => {
    expect(FORM_LIB).toContain('float formTrussStack(');
    expect(FORM_LIB).toContain('vec2(0.78, 0.43)');
    expect(FORM_LIB).toContain('vec2(0.43, 0.68)');
    expect(FORM_LIB).toContain('vec2(0.78, 0.68)');
    expect(FORM_LIB).toContain('formLayerPlane(q.z, gap)');
  });

  it('moves the complete union on a closed rigid oscillation', () => {
    const angles = (phase: number) => {
      const a = phase * Math.PI * 2;
      return [Math.sin(a) * 0.32, (Math.cos(a) - 1) * 0.45];
    };
    const start = angles(0);
    const end = angles(1);
    expect(end[0]).toBeCloseTo(start[0]!, 12);
    expect(end[1]).toBeCloseTo(start[1]!, 12);
    expect(angles(0.5)).not.toEqual(start);
    expect(FORM_LIB).toContain('formSpin(sin(a) * 0.32)');
    expect(FORM_LIB).toContain('formSpin((cos(a) - 1.0) * 0.45)');
    expect(FORM_LIB).toContain('return formTruss(q, extra, detail, motion, t);');
  });
});

describe('the rotor is one open blade repeated as a double-domed cage', () => {
  it('folds azimuth into one sector instead of looping over every blade', () => {
    expect(FORM_LIB).toContain('float formRotor(');
    expect(FORM_LIB).toContain('float count = floor(mix(14.0, 30.0');
    expect(FORM_LIB).toContain('mod(atan(q.y, q.x) + sector * 0.5, sector)');
    expect(FORM_LIB).toContain('float rearCentre = -centre + sector * 0.16');
    expect(FORM_LIB).toContain('abs(q.z - dome)');
    expect(FORM_LIB).toContain('abs(q.z + dome)');
    expect(FORM_LIB).toContain('float rearCapAngle = clamp(angle, rearCentre - halfWidth, rearCentre + halfWidth)');
  });

  it('leaves the throat open and closes its rigid tumble at the seam', () => {
    expect(FORM_LIB).toContain('float inner = 0.16;');
    expect(FORM_LIB).toContain('There is deliberately no corresponding inner arc');
    const angles = (phase: number, count = 22) => {
      const a = phase * Math.PI * 2;
      return [a * 13 / count, Math.sin(a) * 0.7, Math.sin(a * 2) * 0.42];
    };
    const start = angles(0);
    const end = angles(1);
    expect((end[0]! - start[0]!) / (Math.PI * 2 / 22)).toBeCloseTo(13, 12);
    expect(end[1]).toBeCloseTo(start[1]!, 12);
    expect(end[2]).toBeCloseTo(start[2]!, 12);
    expect(angles(0.5)).not.toEqual(start);
    expect(FORM_LIB).toContain('formSpin(a * 13.0 / count)');
  });
});

describe('the armillary is a nested bank around a dark body and three gimbals', () => {
  it('selects the nearest real bank radius analytically and leaves the centre empty', () => {
    const radius = (radial: number, count: number, inner: number, outer: number) => {
      const spacing = (outer - inner) / (count - 1);
      const member = clamp(Math.round((radial - inner) / spacing), 0, count - 1);
      return inner + member * spacing;
    };
    expect(radius(0, 15, 0.24, 0.66)).toBeCloseTo(0.24, 12);
    expect(radius(0.45, 15, 0.24, 0.66)).toBeCloseTo(0.45, 12);
    expect(radius(1, 15, 0.24, 0.66)).toBeCloseTo(0.66, 12);
    expect(FORM_LIB).toContain('float formRingBank(');
    expect(FORM_LIB).toContain('round((radial - inner) / spacing)');
  });

  it('keeps the body fixed while every moving member closes on whole turns', () => {
    expect(FORM_LIB).toContain('float d = length(q) - 0.205;');
    expect(FORM_LIB).toContain('float formGimbalXY(');
    expect(FORM_LIB).toContain('formGimbalXY(outer, 0.92, 0.020');
    expect(FORM_LIB).toContain('formGimbalXY(middle, 0.84, 0.017');
    expect(FORM_LIB).toContain('formGimbalXY(inner, 0.76, 0.014');
    const turns = (phase: number) => {
      const a = phase * Math.PI * 2;
      return [
        a + Math.sin(a) * 0.24,
        a * 2 + (Math.cos(a) - 1) * 0.28,
        a * 0.5,
        (Math.cos(a) - 1) * 0.2,
        (Math.cos(a) - 1) * 0.28,
        a,
        -a * 0.5,
        (Math.cos(a) - 1) * 0.16,
      ];
    };
    const start = turns(0);
    const end = turns(1);
    expect((end[0]! - start[0]!) / (Math.PI * 2)).toBeCloseTo(1, 12);
    expect((end[1]! - start[1]!) / (Math.PI * 2)).toBeCloseTo(2, 12);
    expect((end[2]! - start[2]!) / (Math.PI * 2)).toBeCloseTo(0.5, 12);
    expect(end[3]).toBeCloseTo(start[3]!, 12);
    expect(end[4]).toBeCloseTo(start[4]!, 12);
    expect((end[5]! - start[5]!) / (Math.PI * 2)).toBeCloseTo(1, 12);
    expect((end[6]! - start[6]!) / (Math.PI * 2)).toBeCloseTo(-0.5, 12);
    expect(end[7]).toBeCloseTo(start[7]!, 12);
    expect(turns(0.5)).not.toEqual(start);
  });

  it('keeps material identity on invariant radii and reflects a black strip-lit room', () => {
    expect(FORM_LIB).toContain('if (radius < 0.23) return vec3(0.002);');
    expect(FORM_LIB).toContain('float role = mod(member, 4.0);');
    expect(FORM_LIB).toContain('vec3 formArmillarySky(vec3 ray)');
    expect(FORM_LIB).toContain('float diagonalDistance = abs(dot(ray.xy, diagonalAxis) - 0.18);');
    expect(FORM_LIB).toContain('mode == 12 ? formArmillarySky(bounced) * 1.18');
  });

  it('turns down emitted wire light before hiding the construction itself', () => {
    expect(FORM_LIB).toContain('if (mode == 11) raw *= mix(0.04, 0.65');
    expect(FORM_LIB).toContain('mode == 11 ? 0.12 : (mode == 12 ? 0.2 : 1.0)');
  });
});

describe('the gyre is counter-moving nested rounded solids', () => {
  it('builds four decreasing rounded loops without a shader loop', () => {
    expect(FORM_LIB).toContain('float formGyreBank(');
    expect(FORM_LIB).toContain('vec2 second = outer - vec2(stepDown, stepDown * 0.82);');
    expect(FORM_LIB).toContain('vec2 fourth = outer - vec2(stepDown * 3.0, stepDown * 2.46);');
    const field = FORM_LIB.slice(
      FORM_LIB.indexOf('float formGyreBank('),
      FORM_LIB.indexOf('// Two counter-moving rounded-loop banks'),
    );
    expect(field).not.toMatch(/for\s*\(/);
    expect(FORM_LIB).toContain('t * 1.35 + 0.012');
  });

  it('keeps both counter-moving banks and the axial bank closed at the seam', () => {
    const angles = (phase: number) => {
      const a = phase * Math.PI * 2;
      return [
        a * 0.5,
        (Math.cos(a) - 1) * 0.56,
        Math.sin(a) * 0.22,
        -a * 0.5,
        (Math.cos(a) - 1) * 0.68,
        -Math.sin(a) * 0.22,
        a + Math.sin(a) * 0.28,
        (Math.cos(a) - 1) * 0.34,
      ];
    };
    const start = angles(0);
    const end = angles(1);
    expect((end[0]! - start[0]!) / Math.PI).toBeCloseTo(1, 12);
    expect((end[3]! - start[3]!) / Math.PI).toBeCloseTo(-1, 12);
    expect((end[6]! - start[6]!) / (Math.PI * 2)).toBeCloseTo(1, 12);
    for (const index of [1, 2, 4, 5, 7]) {
      expect(end[index]).toBeCloseTo(start[index]!, 12);
    }
    expect(angles(0.5)).not.toEqual(start);
    expect(FORM_LIB).toContain('return formGyre(q, extra, detail, motion, t);');
  });

  it('uses the same black strip room without adopting armillary energy suppression', () => {
    expect(FORM_LIB).toContain('mode == 12 ? formArmillarySky(bounced) * 1.18');
    expect(FORM_LIB).toContain('mode == 12 ? 0.2 : 1.0');
    expect(FORM_LIB).not.toContain('mode == 12) raw *= mix(0.04, 0.65');
  });

  it('assigns bright material by nearest physical member rather than screen radius', () => {
    expect(FORM_LIB).toContain('float formGyreOuter(');
    expect(FORM_LIB).toContain('corner, 0.0) - 0.012;');
    expect(FORM_LIB).toContain('outside - anyMember');
    expect(FORM_LIB).toContain('raw *= mix(0.14, 0.58, gyreOuter);');
    expect(FORM_LIB).toContain('material = mix(uPrimary * 0.08, uChalk, gyreOuter);');
  });
});

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
    expect(FORM_MODES.length).toBe(14);
    for (let i = 0; i < FORM_MODES.length - 1; i++) {
      expect(field).toContain(`if (mode == ${i})`);
    }
    // The last mode is the fall-through, so there is no branch to find for it.
    expect(field).not.toContain(`if (mode == ${FORM_MODES.length - 1})`);
  });

  it('takes half steps only for the shape whose distance is an over-estimate', () => {
    // The helix measures across the strand while the strand moves away along
    // its own axis, so the true nearest surface can be nearer than it says.
    expect(FORM_MODES.indexOf('tube')).toBe(13);
    expect(FORM_LIB).toContain('if (mode == 5) return 0.85;');
    expect(FORM_LIB).toContain('if (mode == 10) return 0.5;');
    expect(FORM_LIB).toContain('return mode == 13 ? 0.5 : 0.9;');
  });

  it('accumulates glow along the ray rather than once per step', () => {
    // Steps shrink as a ray closes on a surface, so counting them counts
    // deceleration: a ray grazing a tube took twenty tiny steps beside it and
    // came out as bright as one that went through the middle.
    expect(FORM_LIB).toContain('* carry *');
    expect(FORM_LIB).toContain('float carry = max(d * stride, 0.005);');
  });
});
