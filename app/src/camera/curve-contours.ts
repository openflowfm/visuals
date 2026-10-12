export type ContourPath = { points: readonly { x: number; y: number }[]; closed: boolean };
type Point = ContourPath['points'][number];
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const MAX_PIXELS = 512 * 512;
const MAX_POINTS = 8192;
const MAX_PATHS = 512;

/** Trace grayscale RGBA8 (or one-channel) thin edges into bounded, ordered curves.
 * Coordinates are source pixel centers. Work stays at capture resolution; render
 * these same paths at output resolution instead of enlarging a raster outline.
 */
export function traceContours(edges: Uint8ClampedArray, width: number, height: number, smoothing: number): ContourPath[] {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || count > MAX_PIXELS || (edges.length !== count && edges.length !== count * 4))
    throw new Error('Invalid contour dimensions');
  const stride = edges.length === count ? 1 : 4;
  const amount = Number.isFinite(smoothing) ? Math.max(0, Math.min(100, smoothing)) / 100 : 0;
  const links = new Uint8Array(count),
    visited = new Uint8Array(count),
    degrees = new Uint8Array(count);
  const active = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && edges[(y * width + x) * stride] >= 32;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!active(x, y)) continue;
      const index = y * width + x;
      for (let d = 0; d < 8; d++) {
        if (!active(x + DX[d], y + DY[d])) continue;
        // Avoid triangular shortcuts at staircase corners while retaining diagonal lines.
        if (d % 2 && (active(x + DX[d], y) || active(x, y + DY[d]))) continue;
        links[index] |= 1 << d;
        degrees[index]++;
      }
    }
  const paths: ContourPath[] = [];
  let budget = MAX_POINTS;
  const walk = (start: number, direction: number) => {
    const points: Point[] = [{ x: (start % width) + 0.5, y: Math.floor(start / width) + 0.5 }];
    let index = start,
      closed = false;
    while (budget > 0 && points.length < 1024) {
      const next = index + DX[direction] + DY[direction] * width;
      visited[index] |= 1 << direction;
      visited[next] |= 1 << ((direction + 4) % 8);
      budget--;
      if (next === start) {
        closed = true;
        break;
      }
      points.push({ x: (next % width) + 0.5, y: Math.floor(next / width) + 0.5 });
      index = next;
      if (degrees[index] !== 2) break;
      const remaining = links[index] & ~visited[index];
      if (!remaining) break;
      direction = 31 - Math.clz32(remaining & -remaining);
    }
    // Four pixels retains small facial features but discards isolated sensor flecks.
    if (points.length >= 4) paths.push({ points: smooth(points, closed, amount), closed });
  };
  // Endpoints/junctions first, then any remaining closed rings or capped segments.
  for (let pass = 0; pass < 2 && budget > 0 && paths.length < MAX_PATHS; pass++) {
    for (let i = 0; i < count && budget > 0 && paths.length < MAX_PATHS; i++) {
      if (pass === 0 && degrees[i] === 2) continue;
      for (let d = 0; d < 8 && budget > 0 && paths.length < MAX_PATHS; d++) if (links[i] & ~visited[i] & (1 << d)) walk(i, d);
    }
  }
  return paths;
}

function smooth(points: Point[], closed: boolean, amount: number): Point[] {
  if (!amount) return points;
  // A bounded local filter removes staircase jitter without moving endpoints or
  // pulling a face contour across a gap. Maximum displacement is below one pixel.
  const filtered = points.map((p, i) => {
    if (!closed && (i === 0 || i === points.length - 1)) return p;
    const before = points[(i + points.length - 1) % points.length],
      after = points[(i + 1) % points.length];
    return { x: p.x + (before.x + after.x - 2 * p.x) * amount * 0.25, y: p.y + (before.y + after.y - 2 * p.y) * amount * 0.25 };
  });
  // Radial reduction is linear and keeps loops intact; quadratic drawing supplies
  // the continuous curvature without an expensive per-frame spline fit.
  const result = [filtered[0]],
    distance2 = (0.75 + amount * 1.5) ** 2;
  for (let i = 1; i < filtered.length - 1; i++) {
    const p = filtered[i],
      last = result[result.length - 1];
    if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 >= distance2) result.push(p);
  }
  result.push(filtered[filtered.length - 1]);
  return closed && result.length < 3 ? filtered : result;
}

/** Anti-aliased quadratic curves; widths use source pixels, transformed to output. */
export function drawContourPaths(
  ctx: CanvasRenderingContext2D,
  paths: readonly ContourPath[],
  options: { scaleX: number; scaleY: number; lineWidth: number; strokeStyle: string | CanvasGradient; alpha?: number },
): void {
  if (![options.scaleX, options.scaleY, options.lineWidth].every((v) => Number.isFinite(v) && v > 0)) return;
  ctx.save();
  ctx.scale(options.scaleX, options.scaleY);
  ctx.lineWidth = options.lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = options.strokeStyle;
  ctx.globalAlpha *= Number.isFinite(options.alpha ?? 1) ? Math.max(0, Math.min(1, options.alpha ?? 1)) : 1;
  ctx.beginPath();
  for (const { points, closed } of paths) {
    if (points.length < 2) continue;
    const first = points[0],
      last = points[points.length - 1];
    if (closed) {
      ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
      for (let i = 0; i < points.length; i++) {
        const p = points[i],
          next = points[(i + 1) % points.length];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i],
          next = points[i + 1];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      ctx.lineTo(last.x, last.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}
