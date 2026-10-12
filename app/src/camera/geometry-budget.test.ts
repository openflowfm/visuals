import { expect, test } from 'vitest';
import { budgetContours } from './geometry-budget';
test('production caps at4096 before matching, preserves closed topology and open endpoints', () => {
  const paths = Array.from({ length: 64 }, (_, j) => ({ closed: j % 2 === 0, points: Array.from({ length: 128 }, (_, i) => ({ x: i, y: j + Math.sin(i) })) }));
  const result = budgetContours(paths);
  expect(result.reduce((sum, path) => sum + path.points.length, 0)).toBeLessThanOrEqual(4096);
  expect(result).toHaveLength(paths.length);
  result.forEach((path, i) => {
    expect(path.closed).toBe(paths[i].closed);
    expect(path.points[0]).toEqual(paths[i].points[0]);
    if (!path.closed) expect(path.points.at(-1)).toEqual(paths[i].points.at(-1));
  });
});
test('arc length decimation handles unequal segment lengths and coincident points', () => {
  const path = {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 0 },
    ],
  };
  expect(budgetContours([path], 3)[0].points).toEqual([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
  ]);
});
