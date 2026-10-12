import type { ContourPath } from './curve-contours';
type Segment = { ax: number; ay: number; dx: number; dy: number; length2: number };
const CELL = 4,
  RADIUS = 2.25,
  MAX_POINTS = 8192,
  MAX_REFERENCES = 32768;
/** Stabilize spatially corresponding edge segments, independent of path ordering.
 * Current topology wins: removed edges never persist and large motion snaps. */
export class TemporalContours {
  private grid: Segment[][];
  private readonly columns: number;
  private readonly rows: number;
  private lastAt = -Infinity;
  constructor(
    private width: number,
    private height: number,
  ) {
    this.columns = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.grid = Array.from({ length: this.columns * this.rows }, () => []);
  }
  reset() {
    this.grid.forEach((cell) => {
      cell.length = 0;
    });
    this.lastAt = -Infinity;
  }
  update(paths: ContourPath[], now: number, steadiness: number): ContourPath[] {
    const amount = Math.max(0, Math.min(100, steadiness)) / 100;
    const dt = now - this.lastAt;
    const blend = amount === 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / (100 * amount));
    const useHistory = Number.isFinite(dt) && dt > 0 && dt <= 150 && amount > 0;
    let count = 0;
    const result: ContourPath[] = [];
    for (const path of paths.slice(0, 512)) {
      if (count + path.points.length > MAX_POINTS) break;
      count += path.points.length;
      const points = path.points.map((point, i) => {
        if (!useHistory) return { ...point };
        const before = path.points[i === 0 ? (path.closed ? path.points.length - 1 : 0) : i - 1];
        const after = path.points[i === path.points.length - 1 ? (path.closed ? 0 : i) : i + 1];
        const tx = after.x - before.x,
          ty = after.y - before.y,
          tangent2 = tx * tx + ty * ty;
        if (tangent2 < 0.0001) return { ...point };
        const column = Math.max(0, Math.min(this.columns - 1, Math.floor(point.x / CELL)));
        const row = Math.max(0, Math.min(this.rows - 1, Math.floor(point.y / CELL)));
        let best = RADIUS * RADIUS,
          px = point.x,
          py = point.y;
        const candidates = this.grid[row * this.columns + column];
        for (let n = 0; n < Math.min(64, candidates.length); n++) {
          const segment = candidates[n];
          const dot = tx * segment.dx + ty * segment.dy;
          if (dot * dot < 0.64 * tangent2 * segment.length2) continue;
          const projection = Math.max(0, Math.min(1, ((point.x - segment.ax) * segment.dx + (point.y - segment.ay) * segment.dy) / segment.length2));
          const x = segment.ax + segment.dx * projection,
            y = segment.ay + segment.dy * projection;
          const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
          if (distance < best) {
            best = distance;
            px = x;
            py = y;
          }
        }
        // Fade out stabilization near the capture radius, avoiding a sticky edge
        // that lags real movement. Typical one-pixel shimmer receives full easing.
        const movement = Math.max(0, Math.min(1, (Math.sqrt(best) - 1) / 1.25));
        const alpha = blend + (1 - blend) * movement * movement;
        return { x: px + (point.x - px) * alpha, y: py + (point.y - py) * alpha };
      });
      result.push({ points, closed: path.closed });
    }
    this.grid.forEach((cell) => {
      cell.length = 0;
    });
    let references = 0;
    outer: for (const path of result)
      for (let i = 0; i < path.points.length - (path.closed ? 0 : 1); i++) {
        const a = path.points[i],
          b = path.points[(i + 1) % path.points.length];
        const segment = { ax: a.x, ay: a.y, dx: b.x - a.x, dy: b.y - a.y, length2: (b.x - a.x) ** 2 + (b.y - a.y) ** 2 };
        if (segment.length2 < 0.0001) continue;
        const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - RADIUS) / CELL)),
          x1 = Math.min(this.columns - 1, Math.floor((Math.max(a.x, b.x) + RADIUS) / CELL));
        const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - RADIUS) / CELL)),
          y1 = Math.min(this.rows - 1, Math.floor((Math.max(a.y, b.y) + RADIUS) / CELL));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const cell = this.grid[y * this.columns + x];
            if (cell.length < 64) {
              cell.push(segment);
              if (++references >= MAX_REFERENCES) break outer;
            }
          }
      }
    this.lastAt = now;
    return result;
  }
}
