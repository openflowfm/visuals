/**
 * A shape standing in space, drawn from a moving eye.
 *
 * ## Why the whole vocabulary was flat until now
 *
 * A colour here is a function of a point, and the point is two numbers. That is
 * what makes the graph composable — a lens folds a subgraph by asking it for a
 * different point — and it is also what has kept every picture in it flat. A
 * ring seen at an angle, a cube whose far edges are behind its near ones, a
 * corridor with things arriving out of it: none of that is a function of where
 * you are on the screen. It is a function of what is *along the ray* through
 * that screen position, which is a search rather than an expression.
 *
 * So this node does the search and hands back a colour, exactly like `field`
 * and `fractal` do for their own bounded loops. The 3D stays inside it. Nothing
 * else in the vocabulary learns a third coordinate, no cord changes what it
 * carries, and a form composes downstream as any other picture does.
 *
 * ## It brings its own light rather than being bloomed
 *
 * Every step of the march adds `exp(-distance)` to a running total, so a tube
 * lights the space around it as the ray passes. This is not a substitute for
 * `spread/bloom`; it is better than one, because the glow is accumulated in the
 * scene rather than smeared across the screen — near tubes bloom harder than
 * far ones, and a strand passing behind another glows through it.
 *
 * It is also the only affordable answer. A march is charged at its step ceiling
 * like a fractal, and a `spread` reads its input once per tap, so a bloom over
 * a form would charge nine marches and be refused by name. The light has to
 * come from inside.
 *
 * ## Chrome
 *
 * The march already knows where it stopped, and four more distance samples
 * around that point give the surface normal — so a reflection is one `reflect`
 * and a sky to reflect into. The sky is the colourway as a gradient with a
 * bright band in it where a studio would hang a softbox, which is all a curved
 * surface needs to read as polished metal. No environment map, no second pass,
 * no cubemap to ship. At `chrome` zero none of it is mixed in and the form is
 * pure emission.
 */

/** Steps along the ray, plus the four samples a normal costs. */
export const FORM_STEPS = 28;
export const FORM_WORK = FORM_STEPS + 4;

export const FORM_LIB = `
const int FORM_STEPS = ${FORM_STEPS};

mat2 formSpin(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// A ring of tube: the distance to a circle of radius R, thickened by t.
float formRing(vec3 q, float R, float t) {
  return length(vec2(length(q.xz) - R, q.y)) - t;
}

// The twelve edges of a cube, as rounded tubes.
//
// Straight to the nearest point on each family of edges rather than through a
// box distance: an edge along x is the segment at |y| = |z| = R, so the nearest
// point on it is this point's own x clamped to the box and the corner it is
// closest to in the other two. Exact, never an over-estimate, and — unlike
// clipping three infinite tubes with the box, which is the obvious way and the
// way that was here first — it does not fill the middle in. That version made
// every cage a solid brick, because a point inside the box is inside all three
// tubes and the union of three solids is a solid.
float formCage(vec3 q, float R, float t) {
  // step rather than sign, and the difference is not cosmetic: sign(0.0) is
  // zero, so on any of the three planes through the middle of the cube the
  // corner this picks is the middle of the cube — and the distance to it goes
  // negative down the whole of each axis. That is a phantom tube through the
  // centre of every cage, invisible at a glance and lit like a real one. Where
  // a coordinate is exactly zero the two corners are equidistant, so choosing
  // the positive one is not an approximation.
  vec3 corner = mix(vec3(-R), vec3(R), step(0.0, q));
  vec3 run = clamp(q, -R, R);
  float x = length(q - vec3(run.x, corner.y, corner.z));
  float y = length(q - vec3(corner.x, run.y, corner.z));
  float z = length(q - vec3(corner.x, corner.y, run.z));
  return min(min(x, y), z) - t;
}

// Exact distance to the boundary of a rounded rectangle in its own plane.
// Absolute value turns the signed distance to the filled box into distance to its
// outline; adding the plane coordinate sweeps a round tube around the outline
// rather than extruding a flat ribbon.
float formRoundedBox2(vec2 p, vec2 halfSize, float corner) {
  vec2 q = abs(p) - halfSize + vec2(corner);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
}

float formRoundedLoopSize(vec3 q, vec2 halfSize, float corner, float t) {
  float outline = abs(formRoundedBox2(q.xy, halfSize, corner));
  return length(vec2(outline, q.z)) - t;
}

float formRoundedLoop(vec3 q, float halfSize, float corner, float t) {
  return formRoundedLoopSize(q, vec2(halfSize), corner, t);
}

// Four parallel planes at -1.5, -0.5, 0.5 and 1.5 times the gap. Folding to
// the nearest plane is the analytic version of evaluating four separate loops,
// and keeps the weave exact without putting another loop inside the ray march.
float formLayerPlane(float q, float gap) {
  float folded = abs(q);
  return min(abs(folded - gap * 0.5), abs(folded - gap * 1.5));
}

float formWeave(vec3 q, float apart, float corner, float t) {
  float gap = mix(0.08, 0.19, clamp(apart, 0.0, 1.0));
  float roundness = mix(0.08, 0.3, clamp(corner, 0.0, 1.0));
  float d = formRoundedLoop(vec3(q.xy, formLayerPlane(q.z, gap)), 0.62, roundness, t);
  d = min(d, formRoundedLoop(vec3(q.yz, formLayerPlane(q.x, gap)), 0.62, roundness, t));
  return min(d, formRoundedLoop(vec3(q.xz, formLayerPlane(q.y, gap)), 0.62, roundness, t));
}

// Four equal rails following one rounded rectangle at four real depths. The
// outline may be rectangular: Xenon's truss is a cuboid armature, not three
// square ornaments. A wide face, a tall face and a deep face therefore share
// the same three extents and meet as one construction when crossed below.
float formTrussStack(vec3 q, vec2 halfSize, float gap, float corner, float t) {
  float outline = abs(formRoundedBox2(q.xy, halfSize, corner));
  return length(vec2(outline, formLayerPlane(q.z, gap))) - t;
}

// Twelve real rails around the three centre planes of one cuboid. The closed
// oscillation dwells on its frontal hourglass rather than spinning through a
// succession of unrelated star silhouettes; every member still moves under
// the same rigid transform, preserving its identity and occlusion order.
float formTruss(vec3 q, float apart, float corner, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  q.xy = formSpin(sin(a) * 0.32) * q.xy;
  q.yz = formSpin((cos(a) - 1.0) * 0.45) * q.yz;
  float gap = mix(0.045, 0.14, clamp(apart, 0.0, 1.0));
  float roundness = mix(0.07, 0.26, clamp(corner, 0.0, 1.0));
  float d = formTrussStack(q, vec2(0.78, 0.43), gap, roundness, t);
  d = min(d, formTrussStack(vec3(q.yz, q.x), vec2(0.43, 0.68), gap, roundness, t));
  return min(d, formTrussStack(vec3(q.xz, q.y), vec2(0.78, 0.68), gap, roundness, t));
}

// One open turbine blade, repeated analytically around the z axis. Folding the
// azimuth selects the nearest sector, so twenty-odd complete blades cost one
// distance rather than putting a second loop inside the ray march. Each blade
// is a U: two swept sides joined at the outer rim and left open at the throat.
// Mirroring the dome through z makes the front and rear cages one construction;
// they meet at the throat and rim and separate through the body of the rotor.
float formRotor(vec3 q, float blades, float sweep, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float count = floor(mix(14.0, 30.0, clamp(blades, 0.0, 1.0)));
  float sector = 2.0 * PI / count;
  // Thirteen complete sectors of spin return repeated geometry to the same pose,
  // while two bounded tilts show depth without spending half the loop edge-on.
  q.xy = formSpin(a * 13.0 / count) * q.xy;
  q.yz = formSpin(sin(a) * 0.7) * q.yz;
  q.xz = formSpin(sin(a * 2.0) * 0.42) * q.xz;

  float angle = mod(atan(q.y, q.x) + sector * 0.5, sector) - sector * 0.5;
  float radius = length(q.xy);
  float inner = 0.16;
  float outer = 0.82;
  float along = clamp((radius - inner) / (outer - inner), 0.0, 1.0);

  // The centreline leans backward through its sector while the two sides open
  // toward the rim. Their sum remains inside half a sector, so folding never
  // cuts a blade or mistakes one member for its neighbour.
  float bend = mix(0.16, 0.39, clamp(sweep, 0.0, 1.0));
  float centre = -sector * bend * pow(along, 0.7);
  float halfWidth = sector * mix(0.035, 0.1, along);
  float dome = sin(along * PI) * mix(0.2, 0.46, clamp(sweep, 0.0, 1.0));
  float radialEnd = max(max(inner - radius, radius - outer), 0.0);
  float frontAngular = min(abs(angle - centre - halfWidth), abs(angle - centre + halfWidth));
  float rearCentre = -centre + sector * 0.16;
  float rearAngular = min(abs(angle - rearCentre - halfWidth), abs(angle - rearCentre + halfWidth));
  float front = length(vec3(radialEnd, frontAngular * radius, abs(q.z - dome))) - t;
  float rear = length(vec3(radialEnd, rearAngular * radius, abs(q.z + dome))) - t;
  float sides = min(front, rear);

  // A circular arc at the outer radius is the rounded bridge between both
  // sides. There is deliberately no corresponding inner arc: those four ends
  // are the dark, open teeth around the reference's central throat.
  float frontCapAngle = clamp(angle, centre - halfWidth, centre + halfWidth);
  float rearCapAngle = clamp(angle, rearCentre - halfWidth, rearCentre + halfWidth);
  float frontCap = length(vec3(radius - outer, (angle - frontCapAngle) * outer, q.z)) - t;
  float rearCap = length(vec3(radius - outer, (angle - rearCapAngle) * outer, q.z)) - t;
  return min(sides, min(frontCap, rearCap));
}

// A dense bank of coplanar circular hoops. Radius is the coordinate that
// distinguishes one member from the next, so rounding that coordinate selects
// the nearest real hoop analytically; fifteen nested rings still cost one
// distance inside the march and leave the centre physically empty.
float formRingBank(vec3 q, float ribs, float nest, float t) {
  float count = floor(mix(7.0, 20.0, clamp(ribs, 0.0, 1.0)));
  float inner = 0.24;
  float outer = mix(0.52, 0.72, clamp(nest, 0.0, 1.0));
  float spacing = (outer - inner) / (count - 1.0);
  float radial = length(q.xy);
  float member = clamp(round((radial - inner) / spacing), 0.0, count - 1.0);
  float radius = inner + member * spacing;
  return length(vec2(radial - radius, q.z)) - t * 0.52;
}

// One broad polished gimbal. The reference's parallel streaks move across the
// member as its orientation changes, so they are reflected strips, not three
// separate skinny rails. Making those streaks geometry produced a tidy wire
// sculpture whose gaps stayed fixed in the object — physically the wrong read.
float formGimbalXY(vec3 q, float radius, float shoulder, float t) {
  return length(vec2(length(q.xy) - radius, q.z)) - (t + shoulder);
}

// A circular hoop made from flat metal stock rather than round neon cord.
// The two cross-section axes deliberately disagree: looking onto the hoop
// reveals its broad radial face, while looking along its plane sees only the
// thin edge. A small round keeps the stock manufactured rather than perfectly
// sharp without turning it back into a tube.
float formRibbonGimbalXY(vec3 q, float radius, float width, float depth, float t) {
  vec2 stock = abs(vec2(length(q.xy) - radius, q.z)) - vec2(width + t, depth + t * 0.32);
  float bevel = 0.004;
  return length(max(stock, 0.0)) + min(max(stock.x, stock.y), 0.0) - bevel;
}

// One dark central body, one nested ring bank and three larger gimbal hoops.
// The body is invariant. The bank precesses as one assembly while every gimbal
// follows a different closed whole-turn path, so they periodically agree as
// concentric circles and elsewhere expose a hoop as the reference's bright
// edge-on bar. No member changes radius or identity during that motion.
float formArmillary(vec3 q, float ribs, float nest, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float d = length(q) - 0.205;

  vec3 bank = q;
  bank.yz = formSpin(a + sin(a) * 0.24) * bank.yz;
  bank.xz = formSpin(a * 2.0 + (cos(a) - 1.0) * 0.28) * bank.xz;
  d = min(d, formRingBank(bank, ribs, nest, t));

  vec3 outer = q;
  outer.yz = formSpin(a * 0.5) * outer.yz;
  outer.xz = formSpin((cos(a) - 1.0) * 0.2) * outer.xz;
  d = min(d, formGimbalXY(outer, 0.92, 0.020, t * 1.1));

  vec3 middle = q;
  middle.yz = formSpin((cos(a) - 1.0) * 0.28) * middle.yz;
  middle.xz = formSpin(a) * middle.xz;
  d = min(d, formGimbalXY(middle, 0.84, 0.017, t * 0.9));

  vec3 inner = q;
  inner.yz = formSpin(a) * inner.yz;
  inner.xz = formSpin(-a * 0.5) * inner.xz;
  inner.xy = formSpin((cos(a) - 1.0) * 0.16) * inner.xy;
  return min(d, formGimbalXY(inner, 0.76, 0.014, t * 0.74));
}

// Four nested rounded hoops in one plane. These are true decreasing solids,
// not four outlines offset in screen space, so a tilted bank keeps depth and
// lets the near shoulders hide the far ones. Xenon 91 repeatedly resolves into
// a large capsule around smaller diamonds and rounded rectangles; that is a
// nested size hierarchy, not a bank of equal parallel rails.
float formGyreBank(vec3 q, vec2 outer, float stepDown, float corner, float t) {
  float d = formRoundedLoopSize(q, outer, corner, t * 1.35 + 0.012);
  vec2 second = outer - vec2(stepDown, stepDown * 0.82);
  d = min(d, formRoundedLoopSize(q, second, max(corner - stepDown * 0.28, 0.05), t));
  vec2 third = outer - vec2(stepDown * 2.0, stepDown * 1.64);
  d = min(d, formRoundedLoopSize(q, third, max(corner - stepDown * 0.56, 0.045), t * 0.82));
  vec2 fourth = outer - vec2(stepDown * 3.0, stepDown * 2.46);
  return min(d, formRoundedLoopSize(q, fourth, max(corner - stepDown * 0.84, 0.04), t * 0.66));
}

// Two counter-moving rounded-loop banks plus one smaller axial bank. The pair
// is explicit because both projections must coexist at the crossed waist: a
// nearest-member fold can select only one. The graph mirrors their projection
// across the two frame axes, which is why the finished object retains exact
// bilateral symmetry while these real 3D members change occlusion order.
float formGyre(vec3 q, float nest, float rounded, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float stepDown = mix(0.065, 0.12, clamp(nest, 0.0, 1.0));
  float corner = mix(0.18, 0.38, clamp(rounded, 0.0, 1.0));

  vec3 first = q;
  first.yz = formSpin(a * 0.5) * first.yz;
  first.xz = formSpin((cos(a) - 1.0) * 0.56) * first.xz;
  first.xy = formSpin(sin(a) * 0.22) * first.xy;
  float d = formGyreBank(first, vec2(0.8, 0.67), stepDown, corner, t);

  vec3 second = q;
  second.xz = formSpin(-a * 0.5) * second.xz;
  second.yz = formSpin((cos(a) - 1.0) * 0.68) * second.yz;
  second.xy = formSpin(-sin(a) * 0.22) * second.xy;
  d = min(d, formGyreBank(second, vec2(0.72, 0.54), stepDown * 0.82, corner * 0.86, t * 0.86));

  vec3 axial = q;
  axial.yz = formSpin(a + sin(a) * 0.28) * axial.yz;
  axial.xz = formSpin((cos(a) - 1.0) * 0.34) * axial.xz;
  return min(d, formGyreBank(axial, vec2(0.46, 0.32), stepDown * 0.52, corner * 0.62, t * 0.62));
}

// Whether the nearest member belongs to the outside of one of the three real
// banks. This repeats the fixed distances once at the final shading point, not
// inside the march. A radius threshold cannot answer the same question on a
// rounded rectangle — its corners are farther from the origin than its sides —
// and would make one physical hoop change emissivity around its own path.
float formGyreOuter(vec3 q, float nest, float rounded, float phase) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float stepDown = mix(0.065, 0.12, clamp(nest, 0.0, 1.0));
  float corner = mix(0.18, 0.38, clamp(rounded, 0.0, 1.0));

  vec3 first = q;
  first.yz = formSpin(a * 0.5) * first.yz;
  first.xz = formSpin((cos(a) - 1.0) * 0.56) * first.xz;
  first.xy = formSpin(sin(a) * 0.22) * first.xy;
  float outside = formRoundedLoopSize(first, vec2(0.8, 0.67), corner, 0.0) - 0.012;

  vec3 second = q;
  second.xz = formSpin(-a * 0.5) * second.xz;
  second.yz = formSpin((cos(a) - 1.0) * 0.68) * second.yz;
  second.xy = formSpin(-sin(a) * 0.22) * second.xy;
  outside = min(outside,
    formRoundedLoopSize(second, vec2(0.72, 0.54), corner * 0.86, 0.0) - 0.012);

  vec3 axial = q;
  axial.yz = formSpin(a + sin(a) * 0.28) * axial.yz;
  axial.xz = formSpin((cos(a) - 1.0) * 0.34) * axial.xz;
  outside = min(outside,
    formRoundedLoopSize(axial, vec2(0.46, 0.32), corner * 0.62, 0.0) - 0.012);

  float anyMember = formGyre(q, nest, rounded, phase, 0.0);
  return 1.0 - smoothstep(0.002, 0.025, outside - anyMember);
}

// Keep the closer distance together with the permanent member that supplied
// it. The march reads x; the material reads y once at the point the ray found.
// Screen position cannot recover identity after several circular hoops cross,
// while this comparison remains attached to the solid.
vec2 formAstrolabeTake(vec2 best, float distance, float member, float count) {
  if (member >= count || distance >= best.x) return best;
  return vec2(distance, member);
}

// Three to seven broad metal gimbals locked into one sculpture. Every radius
// and plane belongs to a permanent member and one shared transform tumbles the
// whole construction; intersections and relative occlusion can therefore be
// followed from frame to frame. This is the crucial distinction between an
// object and a collection of animated ring glyphs. Explicit members also let
// coincident projections coexist where an analytic nearest-radius fold would
// select only one of them.
vec2 formAstrolabeNearest(vec3 q, float members, float spread, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float count = floor(mix(3.0, 7.0, clamp(members, 0.0, 1.0)));
  float stepDown = mix(0.055, 0.13, clamp(spread, 0.0, 1.0));
  vec2 best = vec2(10.0, 0.0);

  // One closed rigid motion. Three disagreeing bounded excursions avoid the
  // false half-cycle produced when a centrally symmetric hoop sculpture spins
  // around one axis: all eight study poses are different, yet the exact first
  // transform returns at the seam.
  q.yz = formSpin(sin(a) * 1.08) * q.yz;
  q.xz = formSpin((cos(a) - 1.0) * 0.82) * q.xz;
  q.xy = formSpin(sin(a * 2.0) * 0.27) * q.xy;

  vec3 m0 = q;
  m0.yz = formSpin(0.18) * m0.yz;
  m0.xz = formSpin(0.32) * m0.xz;
  best = formAstrolabeTake(best, formRibbonGimbalXY(m0, 0.98, 0.042, 0.012, t), 0.0, count);

  vec3 m1 = q;
  m1.xz = formSpin(-0.92) * m1.xz;
  m1.yz = formSpin(0.35) * m1.yz;
  best = formAstrolabeTake(best,
    formRibbonGimbalXY(m1, 0.94 - stepDown * 0.25, 0.036, 0.011, t * 0.88), 1.0, count);

  vec3 m2 = q;
  m2.xy = formSpin(0.55) * m2.xy;
  m2.xz = formSpin(-0.48) * m2.xz;
  best = formAstrolabeTake(best,
    formRibbonGimbalXY(m2, 0.94 - stepDown * 1.5, 0.032, 0.01, t * 0.78), 2.0, count);

  vec3 m3 = q;
  m3.yz = formSpin(1.05) * m3.yz;
  m3.xy = formSpin(-0.3) * m3.xy;
  best = formAstrolabeTake(best,
    formRibbonGimbalXY(m3, 0.94 - stepDown * 2.8, 0.029, 0.009, t * 0.7), 3.0, count);

  vec3 m4 = q;
  m4.xz = formSpin(0.78) * m4.xz;
  m4.yz = formSpin(-0.55) * m4.yz;
  best = formAstrolabeTake(best,
    formRibbonGimbalXY(m4, 0.94 - stepDown * 4.1, 0.026, 0.008, t * 0.62), 4.0, count);

  vec3 m5 = q;
  m5.xy = formSpin(-0.72) * m5.xy;
  m5.yz = formSpin(1.2) * m5.yz;
  best = formAstrolabeTake(best,
    formRibbonGimbalXY(m5, 0.94 - stepDown * 5.1, 0.023, 0.007, t * 0.54), 5.0, count);

  vec3 m6 = q;
  m6.yz = formSpin(-0.35) * m6.yz;
  m6.xz = formSpin(0.65) * m6.xz;
  m6.xy = formSpin(0.22) * m6.xy;
  return formAstrolabeTake(best,
    formRibbonGimbalXY(m6, 0.94 - stepDown * 5.75, 0.02, 0.006, t * 0.46), 6.0, count);
}

// One circular member whose permanent hinge lies on the radial rail at
// memberAngle. In its resting pose every hoop is parallel to xy. Rotating it
// around its own radial x axis opens the common coplanar flower into a real 3D
// mechanism without moving the hinge or changing the hoop's radius.
float formRosetteMember(vec3 q, float memberAngle, float hinge, float radius,
                        float open, float t) {
  q.xy = formSpin(-memberAngle) * q.xy;
  q -= vec3(hinge, 0.0, 0.0);
  q.yz = formSpin(open) * q.yz;
  return formGimbalXY(q, radius, 0.003, t * 0.36);
}

float formRosetteTake(float best, vec3 q, float member, float count, float sector,
                      float hinge, float radius, float open, float t) {
  if (member < 0.0 || member >= count) return best;
  return min(best, formRosetteMember(q, member * sector, hinge, radius, open, t));
}

// Permanent hoops hinged around one axis. Axis-crossing flowers and localized
// wreaths have different apparent density, but the distance field cannot drop
// either one's remote members. A nearest-sector window looks plausible at the
// shading point yet overestimates distance along rays that approach a hoop
// through another sector, cutting black wedges through the render. Evaluate
// every permanent member explicitly instead. The fixed calls are bounded and
// contain no second shader loop, and unlike a screen kaleidoscope every
// crossing has a real front and back.
float formRosette(vec3 q, float petals, float spread, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float opened = clamp(spread, 0.0, 1.0);
  float count = floor(mix(5.0, 24.0, clamp(petals, 0.0, 1.0)));
  float sector = 2.0 * PI / count;
  // One topology control moves along the family the footage actually uses:
  // large circles with nearby hinges cross through the common axis as petals;
  // pushing the hinges out while shrinking those same circles opens a toroidal
  // hole without changing member count or replacing the construction.
  float hinge = mix(0.18, 0.58, opened);
  float radius = mix(0.78, 0.24, opened);

  // The whole rail rocks while every member opens by the same amount around
  // its own radial hinge. Both are bounded trigonometric paths: the sculpture
  // reaches a genuinely different midpoint and returns exactly at one.
  q.yz = formSpin(sin(a) * 0.42) * q.yz;
  q.xz = formSpin((cos(a) - 1.0) * 0.24) * q.xz;
  float open = 0.18 + (cos(a) - 1.0) * 0.82 + sin(a * 2.0) * 0.16;

  float d = 10.0;
  d = formRosetteTake(d, q, 0.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 1.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 2.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 3.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 4.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 5.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 6.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 7.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 8.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 9.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 10.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 11.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 12.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 13.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 14.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 15.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 16.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 17.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 18.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 19.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 20.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 21.0, count, sector, hinge, radius, open, t);
  d = formRosetteTake(d, q, 22.0, count, sector, hinge, radius, open, t);
  return formRosetteTake(d, q, 23.0, count, sector, hinge, radius, open, t);
}

// One sector of the two coaxial banks in Xenon 78. The outer member is a
// persistent rounded loop and the inner member is a persistent circle; both
// rotate around the same local tangential axis but keep separate hinges and
// opening angles. Their different profiles remain visible where the two banks
// overlap, which is what a single repeated petal silhouette cannot reproduce.
float formCorollaMember(vec3 q, float memberAngle, vec2 outerSize,
                        float outerHinge, float innerHinge, float innerRadius,
                        float outerOpen, float innerOpen, float corner, float t) {
  q.xy = formSpin(-memberAngle) * q.xy;

  vec3 outer = q - vec3(outerHinge, 0.0, 0.0);
  // The rounded bank does not merely fall flat: every loop twists about its
  // own normal as it opens, producing the reference's coherent clockwise
  // pinwheel while the compact necklace retains untwisted tangent links.
  float outerSkew = (1.0 - smoothstep(0.08, 1.38, outerOpen)) * 0.32;
  outer.xy = formSpin(-outerSkew) * outer.xy;
  outer.xz = formSpin(outerOpen) * outer.xz;
  float d = formRoundedLoopSize(outer, outerSize, corner, t * 0.35 + 0.003);

  vec3 inner = q - vec3(innerHinge, 0.0, 0.0);
  inner.xz = formSpin(innerOpen) * inner.xz;
  return min(d, formGimbalXY(inner, innerRadius, 0.003, t * 0.32));
}

float formCorollaTake(float best, vec3 q, float member, float count, float sector,
                       vec2 outerSize, float outerHinge, float innerHinge,
                       float innerRadius, float outerOpen, float innerOpen,
                       float corner, float t) {
  if (member >= count) return best;
  return min(best, formCorollaMember(q, member * sector, outerSize,
    outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t));
}

// A compact toroidal cage opening into two legible radial layers. Size changes
// are attached to the actual member dimensions and hinge rails: at the flower
// pose the reference's outer rounded loops reach beyond its inner circular
// turbine, while in the compact pose both banks collect around the same dark
// throat. Fourteen explicit sectors keep the distance valid between members;
// a nearest-sector fold cuts wedges through rays before they reach the cage.
float formCorolla(vec3 q, float petals, float rounded, float phase, float t) {
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float bloom = sin(a * 0.5);
  bloom *= bloom;
  float count = floor(mix(10.0, 14.0, clamp(petals, 0.0, 1.0)));
  float sector = 2.0 * PI / count;
  float outerHinge = mix(0.52, 0.68, bloom);
  vec2 outerSize = mix(vec2(0.25, 0.18), vec2(0.42, 0.32), bloom);
  float innerHinge = mix(0.4, 0.3, bloom);
  float innerRadius = mix(0.16, 0.34, bloom);
  float corner = mix(0.045, 0.18, clamp(rounded, 0.0, 1.0));
  float outerOpen = mix(1.38, 0.08, bloom);
  float innerOpen = mix(1.32, 0.34, bloom);

  // A shallow shared nod exposes the depth of the compact cage. It is one
  // closed motion of the entire construction, not an angle recovered from the
  // screen, so the same loop remains traceable through the cycle.
  float sharedTilt = mix(0.72, 0.08, bloom) + sin(a) * 0.08;
  q.yz = formSpin(sharedTilt) * q.yz;
  q.xy = formSpin(sin(a * 2.0) * 0.08) * q.xy;

  float d = 10.0;
  d = formCorollaTake(d, q, 0.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 1.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 2.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 3.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 4.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 5.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 6.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 7.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 8.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 9.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 10.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 11.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  d = formCorollaTake(d, q, 12.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
  return formCorollaTake(d, q, 13.0, count, sector, outerSize, outerHinge, innerHinge, innerRadius, outerOpen, innerOpen, corner, t);
}

// Exact distance to one horizontal circular arc. The ordinary torus distance
// is valid outside the missing sector. Inside it, the nearest point on the
// persistent member is one of its two round endpoints rather than an invisible
// continuation of the circle. Keeping that distinction in the field is what
// lets Xenon 32's circulating breaks expose real ends instead of a dark mask
// painted over complete hoops.
float formArcRingY(vec3 q, float height, float radius, float gapAngle,
                   float gapHalf, float t) {
  q.y -= height;
  float angle = atan(q.z, q.x);
  float fromGap = mod(angle - gapAngle + PI, 2.0 * PI) - PI;
  if (abs(fromGap) >= gapHalf) {
    return length(vec2(length(q.xz) - radius, q.y)) - t;
  }
  float endpointAngle = gapAngle + (fromGap < 0.0 ? -gapHalf : gapHalf);
  vec3 endpoint = vec3(cos(endpointAngle) * radius, 0.0,
                       sin(endpointAngle) * radius);
  return length(q - endpoint) - t;
}

float formSpindleMember(vec3 q, float member, float count, float reach,
                        float phase, float t) {
  float across = member / max(count - 1.0, 1.0) * 2.0 - 1.0;
  float height = across * 0.48;
  float radius = 0.145 + pow(abs(across), 1.34)
    * mix(0.72, 1.24, clamp(reach, 0.0, 1.0));
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  // Every open rail completes one physical revolution. A fixed height twist
  // prevents all gaps from lining up into one screen-space cut, while the
  // bounded second harmonic gives eight sampled poses distinct silhouettes
  // and still returns every endpoint exactly at the seam.
  float gapAngle = a + across * 1.28 + sin(a * 2.0 + across * 2.4) * 0.23;
  float gapPulse = 0.78 + sin(a * 3.0 + across * 1.7) * 0.28;
  float gapHalf = mix(0.48, 1.35, pow(abs(across), 0.72)) * gapPulse;
  return formArcRingY(q, height, radius, gapAngle, gapHalf, t * 0.56 + 0.004);
}

float formSpindleTake(float best, vec3 q, float member, float count,
                      float reach, float phase, float t) {
  if (member >= count) return best;
  return min(best, formSpindleMember(q, member, count, reach, phase, t));
}

// A finite stack of permanent coaxial open hoops. The narrow middle and large
// outer radii are a fixed construction, not a screen warp: perspective turns
// the middle members into long rays while near outer arcs swell beyond the
// frame. All seventeen possible members remain explicit because selecting the
// nearest height plane can miss a farther hoop whose larger radius is closer.
float formSpindle(vec3 q, float ribs, float reach, float phase, float t) {
  float count = floor(mix(9.0, 17.0, clamp(ribs, 0.0, 1.0)));
  float d = 10.0;
  d = formSpindleTake(d, q, 0.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 1.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 2.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 3.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 4.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 5.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 6.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 7.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 8.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 9.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 10.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 11.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 12.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 13.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 14.0, count, reach, phase, t);
  d = formSpindleTake(d, q, 15.0, count, reach, phase, t);
  return formSpindleTake(d, q, 16.0, count, reach, phase, t);
}

// A light chase attached to the fixed height identity of each spindle rail.
// The reference does not raise the complete object uniformly: bright members
// migrate through a mostly dark stack. Two closed waves keep that motion quick
// without moving geometry or changing which rail owns a highlight.
float formSpindleExcitation(vec3 q, float ribs, float phase) {
  float count = floor(mix(9.0, 17.0, clamp(ribs, 0.0, 1.0)));
  float member = clamp(round((q.y / 0.48 + 1.0) * 0.5 * (count - 1.0)),
                       0.0, count - 1.0);
  float a = clamp(phase, 0.0, 1.0) * 2.0 * PI;
  float wave = pow(0.5 + 0.5 * cos(a * 2.0 + member * 0.83), 3.0);
  float overhead = mix(0.72, 1.28, smoothstep(-0.48, 0.48, q.y));
  return mix(0.16, 0.78, wave) * overhead;
}

// One bank of elliptical meridians. Every member is a complete closed rail in
// a vertical plane through the y axis; folding azimuth modulo half a sector
// selects the nearest physical plane, including its opposite radial half. The
// ellipse approximation is deliberately conservative (scaled by its shorter
// axis), so the march cannot step through the more strongly bowed side.
float formMeridianBank(vec3 q, float centre, float radius, float halfHeight,
                       float count, float spin, float t) {
  q.y -= centre;
  float sector = PI / count;
  float angle = mod(atan(q.z, q.x) - spin + sector * 0.5, sector) - sector * 0.5;
  float radial = length(q.xz);
  float alongPlane = radial * cos(angle);
  float offPlane = radial * sin(angle);
  float ellipse = (length(vec2(alongPlane / radius, q.y / halfHeight)) - 1.0)
    * min(radius, halfHeight);
  return length(vec2(ellipse, offPlane)) - t;
}

// Xenon 59 is two banks of longitudes, not a flower outline or a latitude grid.
// The upper and lower oblate banks share the origin as one pole and each has
// its own opposite pole. Counter-rotating by exactly one repeated plane spacing
// makes a closed loop without changing, birthing or deleting any rail.
float formMeridian(vec3 q, float ribs, float bow, float phase, float t) {
  float count = floor(mix(7.0, 17.0, clamp(ribs, 0.0, 1.0)));
  float halfHeight = 0.48;
  float radius = mix(0.7, 1.5, clamp(bow, 0.0, 1.0));
  float sector = PI / count;
  float spin = clamp(phase, 0.0, 1.0) * sector;
  float rail = t * 0.3 + 0.0015;
  float upper = formMeridianBank(q, halfHeight, radius, halfHeight,
                                  count, spin, rail);
  float lower = formMeridianBank(q, -halfHeight, radius, halfHeight,
                                  count, -spin, rail);
  return min(upper, lower);
}

// Light travels along each same complete rail as well as between physical
// planes. The ellipsoidal polar coordinate selects arc position without a
// screen mask; plane angle remains the permanent member identity. Horizontal
// tangencies and central edge-on fans can therefore flare independently while
// all dark portions remain present geometry.
float formMeridianExcitation(vec3 q, float ribs, float bow, float phase) {
  float count = floor(mix(7.0, 17.0, clamp(ribs, 0.0, 1.0)));
  float sector = PI / count;
  float spin = (q.y >= 0.0 ? 1.0 : -1.0) * clamp(phase, 0.0, 1.0) * sector;
  float halfHeight = 0.48;
  float centre = (q.y >= 0.0 ? 1.0 : -1.0) * halfHeight;
  float radius = mix(0.7, 1.5, clamp(bow, 0.0, 1.0));
  float radial = length(q.xz);
  float azimuth = atan(q.z, q.x);
  float plane = round((azimuth - spin) / sector) * sector + spin;
  float polar = atan(radial / radius, (q.y - centre) / halfHeight);
  float sideArc = pow(abs(cos(plane)), 1.7);
  float centreFan = pow(abs(sin(plane)), 1.7);
  float a = phase * 2.0 * PI;
  float along = pow(0.5 + 0.5 * cos(polar * 3.0 - a * 2.0 + plane * 2.0), 4.0);
  float counter = pow(0.5 + 0.5 * cos(polar * 2.0 + a * 3.0 - plane * 4.0), 5.0);
  float travelling = max(along, counter * 0.62) * 0.78;
  float exposed = max(centreFan * 0.96, max(sideArc * 0.18, travelling));
  float bank = mix(0.65, 1.25, 0.5 + 0.5 * sin(a + step(0.0, q.y) * PI));
  return mix(0.07, 1.0, exposed) * bank;
}

// The woven object repeated as construction rather than copied as pixels.
// Each cell holds three orthogonal bundles of four rounded loops; folding the
// point into the cell makes the field infinite without a loop inside the march.
// The camera can therefore pass between real members and preserve occlusion at
// every crossing, which a tiled render of the finite weave could not do.
float formLoom(vec3 q, float apart, float cells, float t) {
  float cell = mix(0.82, 1.5, clamp(cells, 0.0, 1.0));
  q -= cell * round(q / cell);
  float gap = mix(0.055, 0.13, clamp(apart, 0.0, 1.0));
  float size = cell * 0.4;
  float corner = cell * 0.13;
  float lift = t;

  // Each bundle rises and falls continuously out of its nominal plane. The
  // three phases disagree at a crossing, so the tubes pass at different
  // depths instead of occupying the same volume and becoming one CSG joint.
  // Unlike cutting a gap in the lower tube, this leaves every member complete.
  float xyPlane = q.z - sin(atan(q.y, q.x) * 2.0) * lift;
  float yzPlane = q.x - sin(atan(q.z, q.y) * 2.0 + 2.0943951) * lift;
  float xzPlane = q.y - sin(atan(q.z, q.x) * 2.0 + 4.1887902) * lift;
  float d = formRoundedLoop(vec3(q.xy, formLayerPlane(xyPlane, gap)), size, corner, t);
  d = min(d, formRoundedLoop(vec3(q.yz, formLayerPlane(yzPlane, gap)), size, corner, t));
  return min(d, formRoundedLoop(vec3(q.xz, formLayerPlane(xzPlane, gap)), size, corner, t));
}

// One outer eye/lens and many circular ribs seen edge-on inside it.
//
// A lens is the intersection of two equal circles whose centres are separated
// vertically. max() is that intersection's signed field; abs() turns its
// boundary into a centreline, and z sweeps a round tube around it. The ribs are
// a finite bank of equal yz rings. Each one rotates rigidly about y; changing a
// ring's radius made the bank pinch into a waveform, while the footage keeps a
// cylindrical envelope and gets its crossed silhouettes from tilted hoops.
// Folding x selects the nearest ring analytically, preserving the form
// renderer's one-loop invariant instead of nesting fifteen distances inside
// every ray-march step.
float formLens2(vec2 p, float centre, float radius) {
  float upper = length(p - vec2(0.0, centre)) - radius;
  float lower = length(p + vec2(0.0, centre)) - radius;
  return max(upper, lower);
}

float formIrisRib(vec3 q, float ribs, float open, float phase, float t) {
  float spacing = mix(0.07, 0.03, clamp(ribs, 0.0, 1.0));
  float member = round(q.x / spacing);
  float across = clamp(abs(member * spacing) / 0.24, 0.0, 1.0);
  float radius = mix(0.12, 0.3, clamp(open, 0.0, 1.0));
  radius *= 1.0 - across * across * 0.22;
  vec3 local = q - vec3(member * spacing, 0.0, 0.0);
  float swing = sin(clamp(phase, 0.0, 1.0) * PI);
  swing *= swing;
  // The spatial sine makes neighbouring members form a coherent fan rather
  // than fifteen unrelated rotations. At phase zero and one every ring is
  // edge-on again, so the topology and the loop seam both close exactly.
  local.xz = formSpin(swing * sin(member * 0.43) * 0.92) * local.xz;
  return length(vec2(length(local.yz) - radius, local.x)) - t * 0.52;
}

float formIrisHoop(vec3 q, float centre, float angle, float radius, float t) {
  vec3 local = q - vec3(centre, 0.0, 0.0);
  local.xz = formSpin(angle) * local.xz;
  return length(vec2(length(local.yz) - radius, local.x)) - t * 0.52;
}

float formIris(vec3 q, float ribs, float open, float phase, float t) {
  float lens = abs(formLens2(q.xy, 0.34, 0.84));
  float shell = length(vec2(lens, q.z)) - t;
  float spacing = mix(0.07, 0.03, clamp(ribs, 0.0, 1.0));
  float radius = mix(0.12, 0.3, clamp(open, 0.0, 1.0)) * 0.97;
  float swing = sin(clamp(phase, 0.0, 1.0) * PI);
  swing *= swing;

  // The edge-on state can fold fifteen members into one exact distance. Once
  // hoops tilt, their projections overlap and a nearest-cell fold cannot draw
  // both at once. Two explicit symmetric hoops supply that crossed state with
  // no nested loop; distance offsets crossfade excitation between the complete
  // bank and the pair while leaving both constructions physically coherent.
  float bank = formIrisRib(q, ribs, open, phase, t) + swing * 0.052;
  float pair = formIrisHoop(q, spacing * 2.5, swing * 0.72, radius, t);
  pair = min(pair, formIrisHoop(q, -spacing * 2.5, -swing * 0.72, radius, t));
  pair += (1.0 - swing) * 0.065;
  float rib = max(min(bank, pair), abs(q.x) - 0.24);
  return min(shell, rib);
}

float formSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 line = b - a;
  float along = clamp(dot(p - a, line) / dot(line, line), 0.0, 1.0);
  return length(p - a - line * along);
}

// A deterministic grammar of the objects actually visible in the reference:
// closed frames, open nested U modules, elbows and stepped hooks. Each is an
// orthogonal centreline with rounded corners and ends, before extrusion gives
// it a broad face and sidewalls. The grammar matters. One reflected pair of
// Truchet arcs made a beautiful continuous field, but it could only ever draw
// sinuous ribbons; no lighting or camera could turn those into these separate
// machined glyphs.
//
// It is deliberately *not* a round tube. The footage this mode reconstructs is
// made from broad bands with a face, a short vertical wall and a soft bevel.
// Sweeping a circle around the path produced neon cable: related vocabulary,
// but physically a different object. Intersecting the path band with a shallow
// z slab gives the ray all three surfaces the reference uses to reveal itself.
float formRelief(vec3 q, float tiles, float raise, float t) {
  float cell = mix(0.72, 0.28, clamp(tiles, 0.0, 1.0));
  vec2 grid = q.xy / cell;
  vec2 id = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float quarter = floor(hash(id + 11.7) * 4.0);
  local = formSpin(quarter * PI * 0.5) * local;

  float motif = hash(id + 7.31);
  float path;
  if (motif < 0.2) {
    path = formSegment2(local, vec2(-0.32, 0.3), vec2(-0.32, -0.24));
    path = min(path, formSegment2(local, vec2(-0.32, -0.24), vec2(0.32, -0.24)));
    path = min(path, formSegment2(local, vec2(0.32, -0.24), vec2(0.32, 0.3)));
    path = min(path, formSegment2(local, vec2(-0.13, 0.16), vec2(-0.13, -0.05)));
    path = min(path, formSegment2(local, vec2(-0.13, -0.05), vec2(0.13, -0.05)));
    path = min(path, formSegment2(local, vec2(0.13, -0.05), vec2(0.13, 0.16)));
  } else if (motif < 0.4) {
    path = abs(formRoundedBox2(local, vec2(0.31, 0.29), 0.11));
  } else if (motif < 0.6) {
    path = formSegment2(local, vec2(-0.31, 0.3), vec2(-0.31, -0.12));
    path = min(path, formSegment2(local, vec2(-0.31, -0.12), vec2(0.3, -0.12)));
    path = min(path, formSegment2(local, vec2(-0.1, 0.16), vec2(-0.1, 0.08)));
    path = min(path, formSegment2(local, vec2(-0.1, 0.08), vec2(0.22, 0.08)));
  } else if (motif < 0.8) {
    path = formSegment2(local, vec2(-0.32, 0.24), vec2(0.08, 0.24));
    path = min(path, formSegment2(local, vec2(0.08, 0.24), vec2(0.08, -0.22)));
    path = min(path, formSegment2(local, vec2(0.08, -0.22), vec2(0.32, -0.22)));
  } else {
    float first = abs(length(local - vec2(0.5)) - 0.5);
    float second = abs(length(local + vec2(0.5)) - 0.5);
    path = min(first, second);
  }
  path *= cell;
  float height = mix(0.035, 0.24, clamp(raise, 0.0, 1.0));
  height *= mix(0.68, 1.08, hash(id + 31.4));
  float band = min(t, cell * 0.095);
  float bevel = min(band * 0.38, height * 0.3);
  vec2 slab = vec2(
    path - max(band - bevel, 0.002),
    abs(q.z - height * 0.5) - max(height * 0.5 - bevel, 0.002)
  );
  return min(max(slab.x, slab.y), 0.0) + length(max(slab, 0.0)) - bevel;
}

// Which physical loop a weave ray stopped on. The field only needs distance,
// but the material needs identity: painting the whole union one cyan turns a
// woven object back into an undifferentiated cage. Repeating the three analytic
// distances once at the hit is cheap beside repeating them at every march step.
vec3 formBaseColour(vec3 q, int mode, float extra, float detail, float motion) {
  if (mode == 7) {
    float cell = mix(0.72, 0.28, clamp(extra, 0.0, 1.0));
    vec2 id = floor(q.xy / cell);
    float chase = pow(1.0 - fract(motion + hash(id + 19.7)), 5.0);
    return mix(uPrimary, uChalk, chase * 0.88);
  }
  if (mode == 5) {
    float cell = mix(0.82, 1.5, clamp(detail, 0.0, 1.0));
    vec3 id = floor(q / cell + 0.5);
    float key = hash(id.xy + id.z * 17.3);
    return mix(uPrimary * 0.12, uChalk, pow(key, 8.0) * 0.8);
  }
  if (mode == 8) {
    float spacing = mix(0.07, 0.03, clamp(extra, 0.0, 1.0));
    float member = round(q.x / spacing);
    float signedLens = formLens2(q.xy, 0.34, 0.84);
    float lens = length(vec2(abs(signedLens), q.z));
    vec3 local = q - vec3(member * spacing, 0.0, 0.0);
    float swing = sin(clamp(motion, 0.0, 1.0) * PI);
    swing *= swing;
    local.xz = formSpin(swing * sin(member * 0.43) * 0.92) * local.xz;
    float across = clamp(abs(member * spacing) / 0.24, 0.0, 1.0);
    float radius = mix(0.12, 0.3, clamp(detail, 0.0, 1.0));
    radius *= 1.0 - across * across * 0.22;
    float rib = length(vec2(
      abs(length(local.yz) - radius),
      local.x));
    // The two sides of the shell tube carry opposite spectral roles. As the
    // glowing core washes toward chalk, its inner and outer fringes therefore
    // separate orange/cyan without re-reading the entire form at shifted
    // screen coordinates like a post-process dispersion would have to.
    if (lens < rib) {
      return mix(uAccent, uPrimary, smoothstep(-0.025, 0.025, signedLens));
    }
    float chase = pow(0.5 + 0.5 * sin(motion * 2.0 * PI - member * 0.47), 5.0);
    return mix(uPrimary * 0.08, uChalk, 0.12 + chase * 0.88);
  }
  if (mode == 11) {
    // Radius is a stable member identity for this construction: the central
    // sphere and every hoop stay centred on the origin even while their planes
    // precess. Colouring by screen position made the rainbow slide over the
    // object like a filter; colouring by radius makes each physical rail keep
    // its material throughout the loop.
    float radius = length(q);
    if (radius < 0.23) return vec3(0.002);
    if (radius > 0.885) return uChalk;
    if (radius > 0.805) return uPrimary;
    if (radius > 0.725) return uComplement;
    float count = floor(mix(7.0, 20.0, clamp(extra, 0.0, 1.0)));
    float outer = mix(0.52, 0.72, clamp(detail, 0.0, 1.0));
    float member = round((radius - 0.24) / ((outer - 0.24) / (count - 1.0)));
    float role = mod(member, 4.0);
    if (role < 0.5) return uPrimary;
    if (role < 1.5) return uSecondary;
    if (role < 2.5) return uComplement;
    return uAccent;
  }
  if (mode == 13) {
    float member = formAstrolabeNearest(q, extra, detail, motion, 0.0).y;
    vec3 role = uChalk;
    if (member < 0.5) role = uChalk;
    else if (member < 1.5) role = uPrimary;
    else if (member < 2.5) role = uAccent;
    else if (member < 3.5) role = uComplement;
    else if (member < 4.5) role = uSecondary;
    else role = mod(member, 2.0) < 0.5 ? uChalk : uPrimary;
    // The stock is pale metal with only a trace of member tint. Xenon 34's
    // cyan, magenta and orange travel along each *same* hoop as it turns, so
    // most spectral identity has to come from the reflected room below rather
    // than being painted permanently onto whole members.
    return mix(uChalk, role, 0.28);
  }
  if (mode == 17) {
    return mix(uPrimary, uChalk, 0.15);
  }
  if (mode == 14 || mode == 15 || mode == 16) {
    // Every hoop is the same pale luminous stock. Recovering a sector from the
    // shaded world point after the shared rocking transform would make colours
    // jump at sector boundaries; a constant material keeps the mechanism's
    // physical continuity and leaves spectral variation to reflected light or
    // an explicit downstream treatment.
    return mix(uPrimary, uChalk, 0.35);
  }
  if (mode != 4) return uPrimary;
  float a = clamp(motion, 0.0, 1.0) * 2.0 * PI;
  q.xy = formSpin(a) * q.xy;
  q.yz = formSpin(a * 2.0) * q.yz;
  float gap = mix(0.08, 0.19, clamp(extra, 0.0, 1.0));
  float roundness = mix(0.08, 0.3, clamp(detail, 0.0, 1.0));
  float xy = formRoundedLoop(vec3(q.xy, formLayerPlane(q.z, gap)), 0.62, roundness, 0.0);
  float yz = formRoundedLoop(vec3(q.yz, formLayerPlane(q.x, gap)), 0.62, roundness, 0.0);
  float xz = formRoundedLoop(vec3(q.xz, formLayerPlane(q.y, gap)), 0.62, roundness, 0.0);
  float orientation = 0.0;
  float normal = q.z;
  if (yz < xy && yz < xz) {
    orientation = 1.0;
    normal = q.x;
  } else if (xz < xy) {
    orientation = 2.0;
    normal = q.y;
  }
  float layer = floor(abs(normal) / gap + 0.5);
  float key = fract(orientation * 0.271 + layer * 0.193 + step(0.0, normal) * 0.409 + motion);
  if (key < 0.25) return uPrimary;
  if (key < 0.5) return uSecondary;
  if (key < 0.75) return uComplement;
  return uAccent;
}

// How far the nearest surface is from a point in the form's own space.
//
// The rings turn against each other on the beat rather than with the camera,
// which is the difference between an object being looked at and an object doing
// something. One ring on a fixed axis holds the arrangement still enough to
// read while the other two precess through it.
float formField(vec3 q, int mode, float thick, float extra, float detail, float motion) {
  float t = mix(0.012, 0.13, clamp(thick, 0.0, 1.0));
  if (mode == 0) {
    return formRing(q, 0.62, t);
  }
  if (mode == 1) {
    float apart = mix(0.0, 0.3, clamp(extra, 0.0, 1.0));
    float d = formRing(q, 0.62 + apart, t);
    vec3 b = q;
    b.yz = formSpin(1.05 + uBeat * 0.21) * b.yz;
    d = min(d, formRing(b, 0.62, t));
    vec3 c = q;
    c.xy = formSpin(-0.7 - uBeat * 0.13) * c.xy;
    return min(d, formRing(c, 0.62 - apart, t));
  }
  if (mode == 2) {
    return formCage(q, mix(0.3, 0.75, clamp(extra, 0.0, 1.0)), t);
  }
  if (mode == 3) {
    float cell = mix(0.7, 1.8, clamp(extra, 0.0, 1.0));
    return formCage(q - cell * round(q / cell), cell * 0.42, t);
  }
  if (mode == 4) {
    // Two whole turns on one axis and one on the other return exactly to the
    // same pose at tumble one. The object moves as a rigid body, so its
    // crossings keep a real occlusion order instead of sliding independently.
    // Sinusoidal easing bends the route away from exact 45-degree samples;
    // without it the object's fourfold symmetry aliases an eight-frame study
    // into only two apparent poses even though the angle is still changing.
    float a = clamp(motion, 0.0, 1.0) * 2.0 * PI;
    q.xy = formSpin(a + sin(a) * 0.35) * q.xy;
    q.yz = formSpin(a * 2.0 + sin(a * 2.0) * 0.22) * q.yz;
    return formWeave(q, extra, detail, t);
  }
  if (mode == 5) {
    return formLoom(q, extra, detail, t);
  }
  if (mode == 6) {
    float a = clamp(detail, 0.0, 1.0) * 2.0 * PI;
    q.xy = formSpin(a) * q.xy;
    q.yz = formSpin(a * 2.0) * q.yz;

    // One enclosing orbit and five successively smaller rings on crossing,
    // fixed planes. Descending radii preserve a legible outside, middle and
    // inside as the rigid assembly tumbles.
    float stepDown = mix(0.065, 0.14, clamp(extra, 0.0, 1.0));
    float d = formRing(q, 0.78, t);
    vec3 b = q;
    b.yz = formSpin(1.02) * b.yz;
    d = min(d, formRing(b, 0.78 - stepDown * 1.25, t * 0.95));
    vec3 c = q;
    c.xy = formSpin(-0.76) * c.xy;
    d = min(d, formRing(c, 0.78 - stepDown * 1.5, t * 0.9));
    vec3 innerA = q;
    innerA.yz = formSpin(0.72) * innerA.yz;
    innerA.xy = formSpin(0.9) * innerA.xy;
    d = min(d, formRing(innerA, 0.78 - stepDown * 2.65, t * 0.52));
    vec3 innerB = q;
    innerB.yz = formSpin(-1.18) * innerB.yz;
    innerB.xy = formSpin(-0.54) * innerB.xy;
    d = min(d, formRing(innerB, 0.78 - stepDown * 3.0, t * 0.44));
    vec3 heart = q;
    heart.yz = formSpin(1.57) * heart.yz;
    return min(d, formRing(heart, 0.78 - stepDown * 4.0, t * 0.38));
  }
  if (mode == 7) {
    return formRelief(q, extra, detail, t);
  }
  if (mode == 8) {
    return formIris(q, extra, detail, motion, t);
  }
  if (mode == 9) {
    return formTruss(q, extra, detail, motion, t);
  }
  if (mode == 10) {
    return formRotor(q, extra, detail, motion, t);
  }
  if (mode == 11) {
    return formArmillary(q, extra, detail, motion, t);
  }
  if (mode == 12) {
    return formGyre(q, extra, detail, motion, t);
  }
  if (mode == 13) {
    return formAstrolabeNearest(q, extra, detail, motion, t).x;
  }
  if (mode == 14) {
    return formRosette(q, extra, detail, motion, t);
  }
  if (mode == 15) {
    return formCorolla(q, extra, detail, motion, t);
  }
  if (mode == 16) {
    return formSpindle(q, extra, detail, motion, t);
  }
  if (mode == 17) {
    return formMeridian(q, extra, detail, motion, t);
  }
  // A helix winding away down the corridor. The one shape here whose distance
  // is an over-estimate along its axis, which is why every march takes half
  // steps: a full one would tunnel through the strand and draw nothing.
  float coil = 0.6 + clamp(extra, 0.0, 1.0) * 3.5;
  float radius = mix(0.24, 0.62, clamp(detail, 0.0, 1.0));
  vec2 centre = vec2(cos(q.z * coil), sin(q.z * coil)) * radius;
  return length(q.xy - centre) - t;
}

// How much of the reported distance a step dares to take.
//
// Every shape here but one returns a true distance and can step the whole of
// it. The helix does not: its distance is measured across the strand while the
// strand itself is moving away along z, so the real nearest surface can be
// closer than it says and a full step walks through it. Half steps everywhere
// was the safe reading of that, and it cost the other four modes their
// convergence — a ray that never gets within a thousandth of a surface never
// reports a hit, and chrome is only mixed in where something was hit.
float formStride(int mode) {
  if (mode == 5) return 0.85;
  if (mode == 10) return 0.5;
  return mode == 18 ? 0.5 : 0.9;
}

// The surface direction, from four samples around the point the ray stopped at.
vec3 formNormal(vec3 q, int mode, float thick, float extra, float detail, float motion) {
  vec2 k = vec2(1.0, -1.0) * 0.0018;
  return normalize(
    k.xyy * formField(q + k.xyy, mode, thick, extra, detail, motion) +
    k.yyx * formField(q + k.yyx, mode, thick, extra, detail, motion) +
    k.yxy * formField(q + k.yxy, mode, thick, extra, detail, motion) +
    k.xxx * formField(q + k.xxx, mode, thick, extra, detail, motion));
}

// The room a polished surface reflects.
//
// **A hard horizon, not a soft gradient.** Chrome does not look like chrome
// because of the shape of its highlight; it looks like chrome because it shows
// you a whole room compressed into a curve, and a room has edges in it. A
// smooth teal ramp reflected off a tube is indistinguishable from matte
// plastic lit from above, which is what the first version of this was. So:
// a bright ceiling over a dark floor with a sharp line between them, one hot
// lamp hanging in it, and a few vertical strips of the accent for the curve to
// smear as it turns. No environment map, no second pass, no cubemap to ship.
const vec3 FORM_LAMP = vec3(0.35, 0.85, -0.4);
const vec3 FORM_FILL = vec3(-0.7, 0.25, 0.62);

vec3 formSky(vec3 ray) {
  float above = ray.y;
  vec3 ceiling = mix(uPrimary * 0.5, uChalk, smoothstep(0.05, 0.75, above));
  vec3 ground = mix(vec3(0.015), uSecondary * 0.45, smoothstep(-0.9, 0.0, above));
  vec3 room = mix(ground, ceiling, smoothstep(-0.02, 0.02, above));
  float lamp = pow(clamp(dot(ray, normalize(FORM_LAMP)), 0.0, 1.0), 40.0)
           + pow(clamp(dot(ray, normalize(FORM_FILL)), 0.0, 1.0), 18.0) * 0.4;
  float strips = smoothstep(0.45, 0.75, abs(sin(atan(ray.x, ray.z) * 3.0)))
               * smoothstep(0.0, 0.5, above);
  /*
   * Bars across the ceiling, which is what a curved surface needs to be read as
   * curved.
   *
   * A room made only of a horizon and one lamp gives a tube a single smooth
   * gradient down its length, and a smooth gradient is what matte plastic looks
   * like. What says *polished* is the room's own edges sliding along the
   * surface as it turns: the reflection has to have something in it to smear.
   * Four soft bars, brightest overhead, and they cost a fract and a smoothstep.
   */
  float bars = smoothstep(0.62, 0.98, abs(fract(ray.z * 2.1 + 0.5) * 2.0 - 1.0))
             * smoothstep(0.1, 0.6, above);
  return room + vec3(1.0) * lamp * 2.0 + uAccent * strips * 0.4 + uChalk * bars * 0.55;
}

// A black studio built specifically for the armillary. Its illumination is
// made from large strips rather than point lamps: a strip reflected in the
// central sphere becomes the reference's bent diagonal slash, and the same
// strip breaks into long travelling arcs on the curved gimbals. Most of the
// room remains truly black, so lowering energy reveals only reflections rather
// than a uniformly dim neon drawing of every rail.
vec3 formArmillarySky(vec3 ray) {
  vec2 diagonalAxis = normalize(vec2(0.72, -0.69));
  float diagonalDistance = abs(dot(ray.xy, diagonalAxis) - 0.18);
  float softbox = 1.0 - smoothstep(0.04, 0.2, diagonalDistance);
  float azimuth = atan(ray.x, ray.z);
  float panels = pow(0.5 + 0.5 * cos(azimuth * 4.0 + 0.45), 18.0);
  panels *= smoothstep(-0.72, 0.38, ray.y);
  float horizon = 1.0 - smoothstep(0.025, 0.09, abs(ray.y + 0.28));
  vec3 room = vec3(0.0015);
  room += uChalk * softbox * 2.2;
  room += uPrimary * panels * 0.92;
  room += mix(uAccent, uComplement, smoothstep(-0.8, 0.8, ray.x)) * horizon * 0.48;
  return room;
}

// The coloured studio around Astrolabe's neutral metal. Broad azimuthal panels
// are reflected into long arcs, so one physical hoop can run cyan, white,
// magenta and warm as its normal turns around the circle. Painting those
// colours by member instead makes flat plastic rings; painting them by screen
// position makes a filter that slides over the object. Reflection is the only
// mapping that stays attached to the surface and changes with its orientation.
vec3 formAstrolabeSky(vec3 ray) {
  float azimuth = atan(ray.x, ray.z);
  float cyan = pow(0.5 + 0.5 * cos(azimuth * 2.0 - 0.35), 8.0);
  float rose = pow(0.5 + 0.5 * cos(azimuth * 2.0 + 2.05), 10.0);
  float warm = pow(0.5 + 0.5 * cos(azimuth * 3.0 - 1.35), 12.0);
  float edge = pow(1.0 - abs(ray.y), 7.0);
  float overhead = smoothstep(0.04, 0.5, ray.y);
  float softbox = pow(clamp(dot(ray, normalize(vec3(-0.28, 0.9, -0.32))), 0.0, 1.0), 7.0);
  vec3 room = vec3(0.0015);
  room += uPrimary * cyan * (0.65 + overhead * 0.7);
  room += uSecondary * rose * 1.35;
  room += uComplement * warm * 1.45;
  room += uAccent * edge * 0.22;
  room += uChalk * softbox * 2.4;
  return room;
}

// Saturated panels for the Spindle's polished open rails. Broad cyan and warm
// fields occupy different reflected azimuths, so colour bends around a member
// and shifts with the viewing normal rather than being painted onto one whole
// ring. A narrow pale strip supplies the blown white segments between them.
vec3 formSpindleSky(vec3 ray) {
  float azimuth = atan(ray.x, ray.z);
  float cyan = pow(0.5 + 0.5 * cos(azimuth * 2.0 - 0.28), 7.0);
  float warm = pow(0.5 + 0.5 * cos(azimuth * 2.0 + 2.18), 8.0);
  float lower = pow(0.5 + 0.5 * cos(azimuth * 3.0 - 1.1), 10.0)
    * (1.0 - smoothstep(-0.5, 0.55, ray.y));
  float strip = pow(clamp(dot(ray, normalize(vec3(-0.42, 0.72, -0.55))),
                          0.0, 1.0), 16.0);
  vec3 room = vec3(0.001);
  room += uPrimary * cyan * 1.5;
  room += uComplement * warm * 1.55;
  room += uAccent * lower * 0.8;
  room += uChalk * strip * 2.0;
  return room;
}

// A mostly cyan studio for the meridian banks. Narrow pale vertical panels make
// the pole-sharing rails flash separately as their planes counter-rotate;
// keeping the lower hemisphere dark preserves the black gaps between them.
vec3 formMeridianSky(vec3 ray) {
  float azimuth = atan(ray.x, ray.z);
  float cyan = pow(0.5 + 0.5 * cos(azimuth * 4.0 - 0.22), 11.0);
  float pale = pow(clamp(dot(ray, normalize(vec3(-0.18, 0.42, -0.89))),
                         0.0, 1.0), 14.0);
  float horizon = 1.0 - smoothstep(0.03, 0.11, abs(ray.y + 0.08));
  vec3 room = vec3(0.001);
  room += uPrimary * cyan * 1.18;
  room += uChalk * pale * 2.4;
  room += uSecondary * horizon * 0.3;
  return room;
}

vec4 form_march(vec2 p, float e, int mode, float turn, float tilt, float dolly,
                float thick, float flare, float chrome, float extra, float detail, float motion) {
  float yaw = turn * 6.28318530718;
  float pitch = (clamp(tilt, 0.0, 1.0) - 0.5) * 2.4;
  float away = mix(1.5, 4.5, clamp(dolly, 0.0, 1.0));
  if (mode == 14) {
    // Xenon's hinged rosette is choreographed as a camera move as well as a
    // mechanism. At its coplanar pose the whole wreath is visible; as the
    // hoops stand up, the eye drives close enough for their long projected
    // rails to leave the frame. sin² closes at both ends with zero velocity.
    float push = sin(clamp(motion, 0.0, 1.0) * PI);
    push *= push;
    push = pow(push, 0.35);
    away *= mix(1.45, 0.62, push);
  }
  vec3 eye = vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw)) * away;
  vec3 fwd = normalize(-eye);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, side);

  // Travelling constructions put the eye inside or above their repeated
  // geometry instead of leaving it on the finite-object orbit.
  if (mode == 5) {
    // Four cells of forward travel are exactly periodic in the field. The eye
    // sways on one closed revolution while it advances, so position modulo the
    // cell, heading and roll all agree at zero and one.
    float phase = clamp(motion, 0.0, 1.0) * 2.0 * PI;
    float cell = mix(0.82, 1.5, clamp(detail, 0.0, 1.0));
    float sway = (clamp(tilt, 0.0, 1.0) - 0.5) * cell * 0.8;
    float off = (clamp(dolly, 0.0, 1.0) - 0.5) * cell * 0.45;
    eye = vec3(cos(phase) * sway + off, sin(phase) * sway, clamp(motion, 0.0, 1.0) * cell * 4.0);
    fwd = normalize(vec3(-sin(phase) * sway * 1.7, cos(phase) * sway * 1.7, 1.0));
    side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    up = cross(fwd, side);
    float roll = turn * 2.0 * PI;
    vec3 rolledSide = side * cos(roll) + up * sin(roll);
    up = -side * sin(roll) + up * cos(roll);
    side = rolledSide;
  }

  if (mode == 7) {
    // A closed Lissajous path over the repeated relief. Eye and target share
    // the same planar centre, so travel moves across the construction rather
    // than orbiting one fixed tile. Tilt changes grazing angle, turn becomes
    // camera roll, and travel one returns position, direction and roll to zero.
    float phase = clamp(motion, 0.0, 1.0) * 2.0 * PI;
    float cell = mix(0.72, 0.28, clamp(extra, 0.0, 1.0));
    vec2 centre = vec2(cos(phase), sin(phase * 2.0)) * cell * 2.2;
    float height = mix(0.5, 2.8, clamp(dolly, 0.0, 1.0));
    eye = vec3(centre, height);
    float grazing = (clamp(tilt, 0.0, 1.0) - 0.5) * 1.5;
    vec2 direction = normalize(vec2(-sin(phase), 2.0 * cos(phase * 2.0)) + vec2(0.0001));
    fwd = normalize(vec3(direction * grazing, -1.0));
    side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    up = cross(fwd, side);
    float roll = turn * 2.0 * PI;
    vec3 rolledSide = side * cos(roll) + up * sin(roll);
    up = -side * sin(roll) + up * cos(roll);
    side = rolledSide;
  }

  if (mode == 18) {
    float off = clamp(dolly, 0.0, 1.0) * 0.32;
    float coil = 0.6 + clamp(extra, 0.0, 1.0) * 3.5;
    float cycle = 2.0 * PI / coil;
    eye = vec3(cos(yaw) * off, sin(yaw) * off, clamp(motion, 0.0, 1.0) * cycle * 2.0);
    fwd = vec3(0.0, 0.0, 1.0);
    side = vec3(-sin(yaw), cos(yaw), 0.0);
    up = cross(fwd, side);
  }

  // Astrolabe uses a close wide-angle eye: near arcs swell past the frame while
  // far members collect into the dense inner knot. Pulling the ordinary camera
  // closer without widening it merely crops a larger version of the same tidy
  // orthographic-looking ball.
  float focal = mode == 16 ? 0.88
    : (mode == 17 ? 1.0
      : (mode == 13 || mode == 14 || mode == 15 ? 1.1 : 1.4));
  vec3 ray = normalize(fwd * focal + side * p.x + up * p.y);

  float tight = mix(120.0, 24.0, clamp(flare, 0.0, 1.0));
  if (mode == 13) tight *= 0.42;
  if (mode == 16) tight *= 0.58;
  if (mode == 17) tight *= 1.8;
  float stride = formStride(mode);
  /*
   * Start each ray a random fraction of a step along, and the contours go away.
   *
   * A march accumulates light in lumps, one per step, and with every ray
   * starting at the same place neighbouring pixels take their lumps at the same
   * depths. The sum then changes in visible jumps as the surface moves through
   * a step boundary, and what that draws is a set of smooth contour lines
   * following the shape — banding that looks exactly like the eight-bit kind
   * and survives any amount of dithering at the end, because it is in the
   * geometry rather than in the quantiser.
   *
   * Offsetting the start decorrelates the boundaries between neighbours, which
   * trades the contours for a fine noise the eye integrates away. It costs one
   * hash, where the alternative is more steps and the step count is what a form
   * is charged against the shader budget.
   */
  float travelled = hash(p * 937.0) * stride * 0.08;
  float gathered = 0.0;
  float hit = 0.0;
  vec3 where = eye;
  for (int i = 0; i < FORM_STEPS; i++) {
    where = eye + ray * travelled;
    float d = formField(where, mode, thick, extra, detail, motion);
    // Weighted by how far this step carries the ray, not by the fact that a
    // step happened. A march slows to its floor as it closes on a surface, so
    // counting steps counts *deceleration*: a ray grazing a tube took twenty
    // tiny steps beside it and came out as bright as one that went through the
    // middle. In units of length the glow is an integral along the ray, which
    // is what it was always meant to be, and near tubes bloom harder than far
    // ones for the honest reason.
    float carry = max(d * stride, 0.005);
    gathered += exp(-max(d, 0.0) * tight) * carry * exp(-travelled * 0.32);
    // Loosened with distance, because a pixel far away covers more of the
    // scene than a near one and holding both to the same thousandth spends the
    // whole step budget resolving something a pixel wide.
    if (d < 0.0015 + travelled * 0.0012) {
      hit = 1.0;
      break;
    }
    travelled += carry;
    if (travelled > away + 5.0) break;
  }

  // Kept unclamped, because how far past full the glow went is the whole
  // question downstream: coverage saturates at one and light does not. Where
  // the ray ran down the length of a tube this comes back well above one, and
  // that excess is what makes a core white and gives a bloom something to
  // spread. See OVERBRIGHT.
  float raw = gathered * mix(8.0, 26.0, clamp(flare, 0.0, 1.0)) * mix(0.7, 1.2, e);
  if (mode == 16) raw *= formSpindleExcitation(where, extra, motion);
  if (mode == 17) raw *= formMeridianExcitation(where, extra, detail, motion) * 4.5;
  // The armillary is polished black construction in a lit room, not emissive
  // wire. Energy opens a controlled amount of internal light for the bright
  // Xenon 84 treatment; near zero, Xenon 87 is revealed almost entirely by
  // the strips it reflects.
  if (mode == 11) raw *= mix(0.04, 0.65, pow(clamp(e, 0.0, 1.0), 2.0));
  float gyreOuter = mode == 12 ? formGyreOuter(where, extra, detail, motion) : 1.0;
  if (mode == 12) raw *= mix(0.14, 0.58, gyreOuter);
  // Astrolabe is lit metal stock. Enough internal light remains to halo its
  // silhouette, but the face has to disappear when it turns away from the
  // studio strips or the broad/edge distinction in the geometry is erased.
  if (mode == 13) raw *= mix(0.05, 0.18, pow(clamp(e, 0.0, 1.0), 2.0));
  // Rosette and Corolla use genuinely emissive fine wire. On a thin member a
  // direct hit terminates before the volumetric integral has gathered as much
  // light as a grazing ray, which otherwise draws a black cord inside a cyan
  // halo. The footage has the opposite physical ordering: a saturated core
  // with bloom falling away from it.
  if (mode == 14 || mode == 15 || mode == 16 || mode == 17) {
    raw = max(raw, hit * mix(0.12, 0.32, clamp(e, 0.0, 1.0)));
  }
  float lit = clamp(raw, 0.0, 1.0);
  // Only what is genuinely saturated goes white. Mixing toward white from
  // halfway up leaves every tube the same pale grey and throws the colourway
  // away, which is the difference between a lit tube and a lit tube-shaped
  // hole.
  vec3 material = formBaseColour(where, mode, extra, detail, motion);
  if (mode == 12) material = mix(uPrimary * 0.08, uChalk, gyreOuter);
  // Xenon's iris clips through the pale cyan role rather than neutral white:
  // one channel can reach the ceiling while the others keep the spectral rim.
  // That is why its hottest frames remain chromatic instead of becoming a
  // white cage. Other forms retain the harder neutral filament.
  vec3 hot = mode == 8 ? uChalk : vec3(1.0);
  vec3 colour = mix(material, hot, clamp(raw * 1.6 - 0.75, 0.0, 1.0));
  colour *= 1.0 + max(raw - 1.0, 0.0) * mix(0.8, 2.6, clamp(flare, 0.0, 1.0));
  if (mode == 8) colour = min(colour, uChalk * 1.02);
  float cover = lit;

  if (chrome > 0.002) {
    vec3 n = formNormal(where, mode, thick, extra, detail, motion);
    vec3 bounced = reflect(ray, n);
    /*
     * Fresnel at five, and a specular lobe that chrome sharpens.
     *
     * The surface reflected a room and still read as matte, and the reason is
     * that a reflection alone is not a material: what the eye uses to judge one
     * is the *highlight* — how tight it is, and how much brighter than
     * everything around it. There was no highlight here at all, only the room
     * scaled by a soft rim, so every tube came out the same flat wash of the
     * colourway whatever chrome was set to.
     *
     * So the lamp gets a real lobe, tightened from a broad sheen to a hard
     * glint as chrome rises, and driven well past white so it survives the
     * shoulder as an actual blown highlight rather than a pale patch. Chrome
     * stops being a mix amount and becomes what it is called: how polished.
     */
    float facing = pow(1.0 - clamp(dot(-ray, n), 0.0, 1.0), 5.0);
    float polish = clamp(chrome, 0.0, 1.0);
    float gloss = mix(8.0, 90.0, polish);
    // Two lamps, from opposite quarters. One is a coin toss: a mirror direction
    // sweeping a corridor of tubes simply misses it for most of the frame, and
    // a highlight that is absent from nine tubes out of ten is not read as a
    // sharp material, it is read as no material.
    float glint = pow(clamp(dot(bounced, normalize(FORM_LAMP)), 0.0, 1.0), gloss)
                + pow(clamp(dot(bounced, normalize(FORM_FILL)), 0.0, 1.0), gloss * 0.6) * 0.55;
    float roomWeight = mode == 5 ? 0.65 : 1.0;
    float glintWeight = mode == 5 ? 0.3
      : (mode == 11 ? 0.12 : (mode == 12 ? 0.2 : (mode == 13 ? 0.38 : 1.0)));
    float rimWeight = mode == 5 ? 0.25 : (mode == 13 ? 0.38 : 1.0);
    vec3 reflectedRoom = mode == 11
      ? formArmillarySky(bounced)
      : (mode == 12 ? formArmillarySky(bounced) * 1.18
        : (mode == 13 ? formAstrolabeSky(bounced)
          : (mode == 16 ? formSpindleSky(bounced)
            : (mode == 17 ? formMeridianSky(bounced) : formSky(bounced)))));
    vec3 shell = reflectedRoom * mix(0.35, 1.0, facing) * roomWeight
               + vec3(1.0) * glint * mix(1.4, 6.0, polish) * glintWeight
               + uChalk * facing * 0.6 * rimWeight;
    // Chrome falls off with how far the ray went to find it. Without this a
    // lattice is equally bright at every depth, so the far cells fill the frame
    // instead of receding into it and the picture has no black in it at all —
    // 9% of the frame against the 47% the footage this imitates runs at. Depth
    // is the difference between a structure and a wallpaper.
    float depth = exp(-max(travelled - 1.0, 0.0) * 0.55);
    colour = mix(colour, shell * depth, chrome * hit);
    cover = max(cover, hit * chrome * depth);
  }

  return vec4(colour, cover);
}
`;
