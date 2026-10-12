import type { ContourPath } from './curve-contours';
/** Keep whole paths inside native limits; never truncate a closed loop into a
 * different topology. Native validation remains authoritative. */
export function contourPacket(paths: ContourPath[], width: number, height: number, mix: number, colorAt: (x: number, y: number) => [number, number, number]) {
  let count = 0;
  const bounded = [];
  for (const path of paths.slice(0, 512)) {
    if (count + path.points.length > 8192) break;
    count += path.points.length;
    bounded.push({ closed: path.closed, points: path.points.map((point) => ({ x: point.x, y: point.y, color: colorAt(point.x, point.y) })) });
  }
  return { width, height, mix, paths: bounded };
}
