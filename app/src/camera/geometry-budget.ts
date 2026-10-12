import type { ContourPath } from './curve-contours';
/** Production render budget. Preserve whole topologies, open endpoints, and sample
 * remaining vertices uniformly by arc length rather than keeping dense corners. */
export function budgetContours(paths: ContourPath[], budget = 4096): ContourPath[] {
  const selected: ContourPath[] = [];
  let minimum = 0;
  for (const path of paths.slice(0, 512)) {
    const min = path.closed ? 3 : 2;
    if (path.points.length < min) continue;
    if (minimum + min > budget) break;
    selected.push(path);
    minimum += min;
  }
  const total = selected.reduce((sum, path) => sum + path.points.length, 0);
  if (total <= budget) return selected;
  const ratio = (budget - minimum) / (total - minimum);
  return selected.map((path) => {
    const min = path.closed ? 3 : 2;
    const count = min + Math.floor((path.points.length - min) * ratio);
    if (count >= path.points.length) return path;
    const points = path.points;
    const lengths = [0];
    const segments = points.length - (path.closed ? 0 : 1);
    for (let i = 0; i < segments; i++) lengths.push(lengths[i] + Math.hypot(points[(i + 1) % points.length].x - points[i].x, points[(i + 1) % points.length].y - points[i].y));
    const length = lengths[lengths.length - 1];
    let segment = 0;
    return {
      closed: path.closed,
      points: Array.from({ length: count }, (_, i) => {
        if (!path.closed && i === count - 1) return { ...points[points.length - 1] };
        const distance = (length * i) / (path.closed ? count : count - 1);
        while (segment < segments - 1 && lengths[segment + 1] < distance) segment++;
        const a = points[segment],
          b = points[(segment + 1) % points.length];
        const span = lengths[segment + 1] - lengths[segment];
        const t = span > 0 ? (distance - lengths[segment]) / span : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }),
    };
  });
}
