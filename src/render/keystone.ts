/**
 * Corner pinning: the projector is never square to the wall.
 *
 * A projector throwing at an angle lands a **trapezoid** on the wall, and no
 * amount of moving the stand fixes it when the stand is where it has to be.
 * The correction is the inverse trapezoid — draw the picture into the shape
 * that, after the throw, arrives as a rectangle. Every VJ tool has this, and
 * cheap projectors either lack the built-in version or apply it before their own
 * scaler and lose a third of the pixels doing it.
 *
 * It is a **homography**, not a scale: the four corners move independently, the
 * mapping is projective rather than affine, and lines stay straight while the
 * spacing along them does not. That last part is the whole point — an angled
 * throw makes the far edge of the image larger, so the correction has to make it
 * smaller in a way that varies across the frame.
 *
 * ## Why this belongs to the machine and not to the scheme
 *
 * A keystone describes **this projector in this room**, and nothing else. The
 * scheme travels — it is a file you commit, and a show that looked different on
 * the gig laptop would be a bug. A keystone is the opposite: one that travelled
 * would be *wrong* everywhere except where it was set. So it lives in the
 * browser's own storage, keyed to the machine doing the projecting, and never
 * goes near `scheme.json`.
 */

/** A corner, in output space: `0,0` top left, `1,1` bottom right, y down. */
export type Corner = readonly [number, number];

/**
 * Where the picture's four corners should land.
 *
 * Named by where they are on the *picture*, so dragging the one at the top left
 * of the screen moves the top left of the image however far it has been warped.
 */
export interface Corners {
  tl: Corner;
  tr: Corner;
  br: Corner;
  bl: Corner;
}

export const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

export const CORNER_NAMES = ['tl', 'tr', 'br', 'bl'] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

/** Row-major 3×3, mapping `[x, y, 1]` to a homogeneous `[x, y, w]`. */
export type Matrix3 = readonly number[];

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Whether the corners are square enough that the whole pass can be skipped. */
export function isSquare(corners: Corners): boolean {
  return CORNER_NAMES.every((name) => {
    const [x, y] = corners[name];
    const [sx, sy] = SQUARE[name];
    return Math.abs(x - sx) < 1e-6 && Math.abs(y - sy) < 1e-6;
  });
}

/**
 * The unit square onto an arbitrary quad.
 *
 * Heckbert's closed form, which is the standard one and is worth using rather
 * than solving an 8×8 system: the square's corners are known constants, so most
 * of the general solution collapses. The degenerate branch is a genuine case
 * rather than a guard — four corners forming a parallelogram have no
 * perspective, and the projective terms are exactly zero.
 */
export function squareToQuad(corners: Corners): Matrix3 {
  const [x0, y0] = corners.tl;
  const [x1, y1] = corners.tr;
  const [x2, y2] = corners.br;
  const [x3, y3] = corners.bl;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }

  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return IDENTITY;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;

  return [
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  ];
}

/** The adjugate over the determinant. A singular matrix returns the identity. */
export function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

/** Apply it to a point, dividing through by the homogeneous coordinate. */
export function apply(m: Matrix3, [x, y]: Corner): Corner {
  const w = m[6] * x + m[7] * y + m[8];
  const s = Math.abs(w) < 1e-12 ? 1 : w;
  return [(m[0] * x + m[1] * y + m[2]) / s, (m[3] * x + m[4] * y + m[5]) / s];
}

/**
 * What the shader needs: destination pixel back to source pixel.
 *
 * Backwards, because a fragment shader is asked "what colour is *this* output
 * pixel" and has to answer by reading the input. Mapping forwards would leave
 * holes wherever the warp stretched.
 */
export function warpFor(corners: Corners): Matrix3 {
  return invert(squareToQuad(corners));
}

/** Column-major, which is the order `uniformMatrix3fv` reads without transposing. */
export function columns(m: Matrix3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/**
 * The final pass.
 *
 * `vUv` has y up and the corners are quoted y down, so both ends flip. Sampling
 * outside the source is transparent rather than clamped — the area the warp
 * pushed the picture out of has to be black, not a smear of the edge pixel, or
 * the projector paints a bright fringe exactly where you are trying to find the
 * edge of the frame.
 *
 * The test pattern is computed in **source** space and therefore arrives warped,
 * which is what makes it useful: line it up until the grid is square *on the
 * wall*, and the picture is square too.
 */
export const KEYSTONE_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform mat3 uWarp;
uniform float uTest;
uniform vec2 uRes;

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec3 s = uWarp * vec3(p, 1.0);
  vec2 uv = s.xy / s.z;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || s.z <= 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 c = texture(uTex, vec2(uv.x, 1.0 - uv.y));

  if (uTest > 0.5) {
    // Eight cells across, and a heavier line on the outside edge. Widths are in
    // *output* pixels via the derivative, so a line stays one pixel wide where
    // the warp has squeezed the grid and does not disappear.
    vec2 grid = abs(fract(uv * 8.0 - 0.5) - 0.5) / fwidth(uv * 8.0);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    vec2 edge = min(uv, 1.0 - uv) / fwidth(uv);
    float border = 1.0 - min(min(edge.x, edge.y) / 2.0, 1.0);
    c = mix(c, vec4(1.0), max(line * 0.45, border));
  }

  fragColor = vec4(c.rgb, 1.0);
}`;
