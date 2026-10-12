import { expect, test } from 'vitest';
import { contourPacket } from './contour-packet';
test('serializes native source coordinates and normalized palette colors', () => {
  const result = contourPacket(
    [
      {
        closed: false,
        points: [
          { x: 1.5, y: 2 },
          { x: 4, y: 6 },
        ],
      },
    ],
    320,
    180,
    0.09,
    () => [1, 0.5, 0],
  );
  expect(result).toEqual({
    width: 320,
    height: 180,
    mix: 0.09,
    paths: [
      {
        closed: false,
        points: [
          { x: 1.5, y: 2, color: [1, 0.5, 0] },
          { x: 4, y: 6, color: [1, 0.5, 0] },
        ],
      },
    ],
  });
});
test('caps total serialized vertices rather than trusting trace traversal budget', () => {
  const path = { closed: true, points: Array.from({ length: 17 }, (_, i) => ({ x: i, y: 2 })) };
  const result = contourPacket(
    Array.from({ length: 600 }, () => path),
    320,
    180,
    1,
    () => [1, 1, 1],
  );
  expect(result.paths.length).toBeLessThanOrEqual(512);
  expect(result.paths.reduce((sum, p) => sum + p.points.length, 0)).toBeLessThanOrEqual(8192);
  expect(result.paths.every((p) => p.closed && p.points.length === 17)).toBe(true);
  expect(contourPacket([], 320, 180, 1, () => [1, 1, 1]).paths).toEqual([]);
});
