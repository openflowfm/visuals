import type { ContourPath } from './curve-contours';
type Point = { x: number; y: number };
type Segment = { ax: number; ay: number; dx: number; dy: number; length2: number };
const CELL = 6,
  RADIUS = 6,
  MAX_POINTS = 8192,
  MAX_REFERENCES = 65536;
function bounded(paths: ContourPath[]) {
  let count = 0;
  const result: ContourPath[] = [];
  for (const path of paths.slice(0, 512)) {
    if (count + path.points.length > MAX_POINTS) break;
    count += path.points.length;
    result.push(path);
  }
  return result;
}
/** Spatial correspondence stays independent of path ordering and vertex counts. */
class SegmentGrid {
  private cells: Segment[][];
  private columns: number;
  private rows: number;
  constructor(width: number, height: number) {
    this.columns = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.cells = Array.from({ length: this.columns * this.rows }, () => []);
  }
  clear() {
    this.cells.forEach((cell) => {
      cell.length = 0;
    });
  }
  match(path: ContourPath, index: number): Point | null {
    const point = path.points[index];
    const before = path.points[index === 0 ? (path.closed ? path.points.length - 1 : 0) : index - 1];
    const after = path.points[index === path.points.length - 1 ? (path.closed ? 0 : index) : index + 1];
    const tx = after.x - before.x,
      ty = after.y - before.y,
      tangent2 = tx * tx + ty * ty;
    if (tangent2 < 0.0001) return null;
    const x = Math.max(0, Math.min(this.columns - 1, Math.floor(point.x / CELL))),
      y = Math.max(0, Math.min(this.rows - 1, Math.floor(point.y / CELL)));
    let best = RADIUS * RADIUS,
      result: Point | null = null;
    for (const segment of this.cells[y * this.columns + x]) {
      const dot = tx * segment.dx + ty * segment.dy;
      if (dot * dot < 0.64 * tangent2 * segment.length2) continue;
      const t = Math.max(0, Math.min(1, ((point.x - segment.ax) * segment.dx + (point.y - segment.ay) * segment.dy) / segment.length2));
      const px = segment.ax + segment.dx * t,
        py = segment.ay + segment.dy * t,
        distance = (point.x - px) ** 2 + (point.y - py) ** 2;
      if (distance < best) {
        best = distance;
        result = { x: px, y: py };
      }
    }
    return result;
  }
  replace(paths: ContourPath[]) {
    this.clear();
    let references = 0;
    outer: for (const path of bounded(paths))
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
            const cell = this.cells[y * this.columns + x];
            if (cell.length < 64) {
              cell.push(segment);
              if (++references >= MAX_REFERENCES) break outer;
            }
          }
      }
  }
}
/** Time-aware low-pass geometry with fast-motion release, no retained dead paths. */
export class TemporalContours {
  private grid: SegmentGrid;
  private lastAt = -Infinity;
  constructor(width: number, height: number) {
    this.grid = new SegmentGrid(width, height);
  }
  reset() {
    this.grid.clear();
    this.lastAt = -Infinity;
  }
  update(paths: ContourPath[], now: number, steadiness: number): ContourPath[] {
    const amount = Math.max(0, Math.min(100, steadiness)) / 100,
      dt = now - this.lastAt;
    const blend = amount === 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / (50 + 200 * amount));
    const history = Number.isFinite(dt) && dt > 0 && dt <= 150 && amount > 0;
    const result = bounded(paths).map((path) => ({
      closed: path.closed,
      points: path.points.map((point, i) => {
        const prior = history ? this.grid.match(path, i) : null;
        if (!prior) return { ...point };
        const distance = Math.hypot(point.x - prior.x, point.y - prior.y);
        const release = Math.max(0, Math.min(1, (distance - 3) / 3));
        const alpha = blend + (1 - blend) * release * release;
        return { x: prior.x + (point.x - prior.x) * alpha, y: prior.y + (point.y - prior.y) * alpha };
      }),
    }));
    this.grid.replace(result);
    this.lastAt = now;
    return result;
  }
}
/** Smooth display motion on current topology, retargeting from actually displayed
 * segment positions. It never extends source freshness or retains vanished paths. */
export class ContourMotion {
  private grid: SegmentGrid;
  private targets: ContourPath[] = [];
  private starts: ContourPath[] = [];
  private at = -Infinity;
  private duration = 50;
  constructor(width: number, height: number) {
    this.grid = new SegmentGrid(width, height);
  }
  reset() {
    this.grid.clear();
    this.targets = [];
    this.starts = [];
    this.at = -Infinity;
  }
  retarget(paths: ContourPath[], now: number) {
    const dt = now - this.at;
    const history = Number.isFinite(dt) && dt > 0 && dt <= 150;
    this.grid.replace(history ? this.sample(now) : []);
    this.targets = bounded(paths);
    this.starts = this.targets.map((path) => ({ closed: path.closed, points: path.points.map((point, i) => this.grid.match(path, i) ?? { ...point }) }));
    this.duration = Math.max(50, Math.min(85, Number.isFinite(dt) ? dt * 1.5 : 50));
    this.at = now;
  }
  sample(now: number): ContourPath[] {
    if (now - this.at > 250) return [];
    const t = Math.max(0, Math.min(1, (now - this.at) / this.duration));
    if (t >= 1) return this.targets;
    return this.targets.map((path, index) => ({
      closed: path.closed,
      points: path.points.map((point, i) => {
        // These indices are paired within the newly constructed CURRENT topology;
        // prior paths are matched only by SegmentGrid, never by ordinal index.
        const start = this.starts[index].points[i];
        return { x: start.x + (point.x - start.x) * t, y: start.y + (point.y - start.y) * t };
      }),
    }));
  }
}
