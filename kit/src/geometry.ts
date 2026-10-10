// Outlines of Sketch layers as SVG path data, in the layer's own points (0,0 at
// its top left). The browser turns them into `Path2D`s.

export type Point = [number, number];

/** A number written short: no trailing zeros, no `-0`. */
const n = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Sketch writes points as `{0.5, 0.25}`, in fractions of the layer's frame. */
export function parsePoint(s: string): Point {
  const m = /^\{\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\}$/.exec(s);
  if (!m) throw new Error(`not a Sketch point: ${s}`);
  return [Number(m[1]), Number(m[2])];
}

/** Corner styles in `style.corners.style`. */
export const CORNER_ROUNDED = 0;
export const CORNER_SMOOTH = 1;

/**
 * A rectangle with corner radii in the order top left, top right, bottom
 * right, bottom left. Each radius is held to half the shorter side, as Sketch
 * does (it writes "fully round" as 3.4e38). Smooth corners follow the
 * continuous-curvature shape Figma published (figma-squircle): a cubic
 * easing into a shorter circular arc, spending up to `(1 + smoothing) × r`
 * along each side, cut back when the side is too short for that.
 */
export function roundedRectPath(w: number, h: number, radii: number[], style = CORNER_ROUNDED, smoothing = 0, x = 0, y = 0): string {
  const budget = Math.min(w, h) / 2;
  const r = [0, 1, 2, 3].map((i) => Math.max(0, Math.min(radii[i] ?? radii[0] ?? 0, budget)));
  if (r.every((v) => v === 0)) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  const smooth = style === CORNER_SMOOTH && smoothing > 0;
  const corner = r.map((radius) => (smooth ? smoothCorner(radius, smoothing, budget) : roundCorner(radius)));
  const [tl, tr, br, bl] = corner;
  return [
    `M${n(x + w - tr.p)} ${n(y)}`,
    tr.p ? cornerSegment(tr, 0) : '',
    `L${n(x + w)} ${n(y + h - br.p)}`,
    br.p ? cornerSegment(br, 1) : '',
    `L${n(x + bl.p)} ${n(y + h)}`,
    bl.p ? cornerSegment(bl, 2) : '',
    `L${n(x)} ${n(y + tl.p)}`,
    tl.p ? cornerSegment(tl, 3) : '',
    'Z',
  ].join('');
}

type Corner = { a: number; b: number; c: number; d: number; p: number; arc: number; r: number };

function roundCorner(r: number): Corner {
  return { a: 0, b: 0, c: 0, d: 0, p: r, arc: r, r };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function smoothCorner(r: number, smoothing: number, budget: number): Corner {
  if (r === 0) return roundCorner(0);
  let s = smoothing;
  let p = (1 + s) * r;
  // Not enough side to ease in over: give up smoothing first, as figma-squircle
  // does without `preserveSmoothing`.
  s = Math.min(s, budget / r - 1);
  p = Math.min(p, budget);
  if (s <= 0) return roundCorner(r);
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3ToP4 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p3ToP4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arc, r };
}

/**
 * One corner, drawn clockwise from where the previous side ends. `quarter` is
 * 0 for the top right, 1 bottom right, 2 bottom left, 3 top left: each is the
 * top right one turned by a quarter.
 */
function cornerSegment(k: Corner, quarter: number): string {
  // Relative moves for the top right corner as (along, across) pairs; turning
  // them maps (x, y) → (-y, x) per quarter.
  const turn = ([x, y]: Point): Point => {
    let v: Point = [x, y];
    for (let i = 0; i < quarter; i++) v = [-v[1], v[0]];
    return v;
  };
  const pt = (x: number, y: number) => turn([x, y]).map(n).join(' ');
  const { a, b, c, d, arc, r } = k;
  if (a === 0 && b === 0 && c === 0 && d === 0) {
    return `a${n(r)} ${n(r)} 0 0 1 ${pt(r, r)}`;
  }
  return [`c${pt(a, 0)} ${pt(a + b, 0)} ${pt(a + b + c, d)}`, `a${n(r)} ${n(r)} 0 0 1 ${pt(arc, arc)}`, `c${pt(d, c)} ${pt(d, b + c)} ${pt(d, a + b + c)}`].join('');
}

export function ovalPath(w: number, h: number, x = 0, y = 0): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M${n(x + rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 1 1 ${n(x + rx)} ${n(y + h)}A${n(rx)} ${n(ry)} 0 1 1 ${n(x + rx)} ${n(y)}Z`;
}

export type CurvePoint = {
  point: string;
  curveFrom: string;
  curveTo: string;
  hasCurveFrom: boolean;
  hasCurveTo: boolean;
  cornerRadius: number;
};

/**
 * A path from Sketch's points, which are fractions of the layer's frame.
 * Between two points the edge is a cubic when either end has a handle on that
 * side, a straight line otherwise. Per-point corner radii are not drawn; the
 * caller is told (`rounded` is true) so it can say so.
 */
export function pointsPath(points: CurvePoint[], w: number, h: number, closed: boolean): { d: string; rounded: boolean } {
  if (points.length === 0) return { d: '', rounded: false };
  const at = (s: string) => {
    const [x, y] = parsePoint(s);
    return `${n(x * w)} ${n(y * h)}`;
  };
  const parts = [`M${at(points[0].point)}`];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    if (from.hasCurveFrom || to.hasCurveTo) {
      const c1 = from.hasCurveFrom ? from.curveFrom : from.point;
      const c2 = to.hasCurveTo ? to.curveTo : to.point;
      parts.push(`C${at(c1)} ${at(c2)} ${at(to.point)}`);
    } else {
      parts.push(`L${at(to.point)}`);
    }
  }
  if (closed) parts.push('Z');
  return { d: parts.join(''), rounded: points.some((p) => p.cornerRadius > 0) };
}
