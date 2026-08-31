/**
 * Repeating the space a picture is read in, and saying which copy you are in.
 *
 * `lens/tile` already repeats a picture across the frame, and for a wallpaper
 * that is the whole job. What it cannot say is *which* tile — so every copy is
 * the same copy, and twenty of them is one thing stamped twenty times.
 *
 * The second outlet is the entire reason this node exists. Wire it into a
 * phase, a size, a colour or a sweep and the copies stop being stamps: a fan of
 * arcs each opening a little further, a stack of squares each dimmer than the
 * last, a grid of cells each firing on its own beat. It is the difference
 * between a repeat and an arrangement.
 *
 * Nothing here rescales the local point. A shape larger than its cell spills
 * into its neighbours, which is usually what a ring of overlapping ribbons
 * wants — and a shape that should not spill has a size control of its own.
 */
export const ARRAY_LIB = `
// A row of copies across the frame. The plane is about 1.8 wide on 16:9, so
// the cells are cut from that rather than from the 1.0 of uv space.
vec3 array_row(vec2 p, float count) {
  float n = 1.0 + floor(clamp(count, 0.0, 1.0) * 11.0);
  float cell = 1.8 / n;
  float x = p.x / cell + n * 0.5;
  float i = floor(x);
  return vec3((fract(x) - 0.5) * cell, p.y, clamp(i / max(n - 1.0, 1.0), 0.0, 1.0));
}

// A grid of cells. Which copy you are in is a hash of the cell rather than a
// count across it, because a grid has no first cell and no last one — and what
// a grid is nearly always for is giving every cell its own clock.
vec3 array_grid(vec2 p, float count) {
  float n = 1.0 + floor(clamp(count, 0.0, 1.0) * 7.0);
  float cell = 1.0 / n;
  vec2 g = p / cell;
  vec2 i = floor(g + 0.5);
  return vec3((g - i) * cell, hash(i + 0.5));
}

// Copies turned around the centre, each in its own wedge and each looking at
// the wedge the same way — so a shape drawn once is drawn once per arm.
vec3 array_ring(vec2 p, float count, float turn) {
  float n = 2.0 + floor(clamp(count, 0.0, 1.0) * 14.0);
  float wedge = 6.28318530718 / n;
  float a = atan(p.y, p.x) + clamp(turn, 0.0, 1.0) * 6.28318530718;
  float i = floor(a / wedge);
  float folded = a - (i + 0.5) * wedge;
  float r = length(p);
  return vec3(cos(folded) * r, sin(folded) * r, fract((i + 0.5) / n));
}

// The same, mirrored: every other copy is a reflection of the one beside it,
// so the seams between the wedges close. What a kaleidoscope does, with the
// wedge number handed back.
vec3 array_mirror(vec2 p, float count) {
  float n = 1.0 + floor(clamp(count, 0.0, 1.0) * 11.0);
  float wedge = PI / n;
  float a = atan(p.y, p.x);
  float i = floor(a / (wedge * 2.0));
  float folded = abs(mod(a, wedge * 2.0) - wedge);
  float r = length(p);
  return vec3(cos(folded) * r, sin(folded) * r, fract((i + 0.5) / n));
}
`;
