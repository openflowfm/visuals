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

// How far the nearest surface is from a point in the form's own space.
//
// The rings turn against each other on the beat rather than with the camera,
// which is the difference between an object being looked at and an object doing
// something. One ring on a fixed axis holds the arrangement still enough to
// read while the other two precess through it.
float formField(vec3 q, int mode, float thick, float extra) {
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
  // A helix winding away down the corridor. The one shape here whose distance
  // is an over-estimate along its axis, which is why every march takes half
  // steps: a full one would tunnel through the strand and draw nothing.
  float coil = 0.6 + clamp(extra, 0.0, 1.0) * 3.5;
  vec2 centre = vec2(cos(q.z * coil), sin(q.z * coil)) * 0.42;
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
  return mode == 4 ? 0.5 : 0.9;
}

// The surface direction, from four samples around the point the ray stopped at.
vec3 formNormal(vec3 q, int mode, float thick, float extra) {
  vec2 k = vec2(1.0, -1.0) * 0.0018;
  return normalize(
    k.xyy * formField(q + k.xyy, mode, thick, extra) +
    k.yyx * formField(q + k.yyx, mode, thick, extra) +
    k.yxy * formField(q + k.yxy, mode, thick, extra) +
    k.xxx * formField(q + k.xxx, mode, thick, extra));
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

vec4 form_march(vec2 p, float e, int mode, float turn, float tilt, float dolly,
                float thick, float flare, float chrome, float extra) {
  float yaw = turn * 6.28318530718;
  float pitch = (clamp(tilt, 0.0, 1.0) - 0.5) * 2.4;
  float away = mix(1.5, 4.5, clamp(dolly, 0.0, 1.0));
  vec3 eye = vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw)) * away;
  vec3 fwd = normalize(-eye);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, side);

  // The corridor is the one shape you are meant to be inside rather than
  // looking at, so its eye is not on the orbit. It sits on the axis the helix
  // winds around and flies down it on the beat, and the two camera numbers
  // keep their meaning: turn is still where the eye stands around the form,
  // and dolly is still how far it stands off it — which in here is how far
  // off the middle of the corridor, out toward the wall.
  if (mode == 4) {
    float off = clamp(dolly, 0.0, 1.0) * 0.32;
    eye = vec3(cos(yaw) * off, sin(yaw) * off, uBeat * 0.45);
    fwd = vec3(0.0, 0.0, 1.0);
    side = vec3(-sin(yaw), cos(yaw), 0.0);
    up = cross(fwd, side);
  }

  vec3 ray = normalize(fwd * 1.4 + side * p.x + up * p.y);

  float tight = mix(120.0, 24.0, clamp(flare, 0.0, 1.0));
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
    float d = formField(where, mode, thick, extra);
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
  float lit = clamp(raw, 0.0, 1.0);
  // Only what is genuinely saturated goes white. Mixing toward white from
  // halfway up leaves every tube the same pale grey and throws the colourway
  // away, which is the difference between a lit tube and a lit tube-shaped
  // hole.
  vec3 colour = mix(uPrimary, vec3(1.0), clamp(raw * 1.6 - 0.75, 0.0, 1.0));
  colour *= 1.0 + max(raw - 1.0, 0.0) * mix(0.8, 2.6, clamp(flare, 0.0, 1.0));
  float cover = lit;

  if (chrome > 0.002) {
    vec3 n = formNormal(where, mode, thick, extra);
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
    vec3 shell = formSky(bounced) * mix(0.35, 1.0, facing)
               + vec3(1.0) * glint * mix(1.4, 6.0, polish)
               + uChalk * facing * 0.6;
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
