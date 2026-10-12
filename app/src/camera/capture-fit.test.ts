import { expect, test } from 'vitest';
import { captureRect, gatePaddingEdges } from './capture-fit';
import { Contours } from './contours';
test('contain fits 4:3, portrait and wide sources without crop or distortion', () => {
  expect(captureRect(640, 480, 320, 180)).toEqual({ x: 40, y: 0, width: 240, height: 180 });
  expect(captureRect(360, 640, 320, 180)).toEqual({ x: 109.375, y: 0, width: 101.25, height: 180 });
  expect(captureRect(1280, 360, 320, 180)).toEqual({ x: 0, y: 45, width: 320, height: 90 });
  expect(captureRect(0, 480, 320, 180)).toBeNull();
});
test('padding around a uniform camera image cannot emit a rectangular contour', () => {
  const rect = captureRect(640, 480, 320, 180)!;
  const source = new Uint8ClampedArray(320 * 180 * 4);
  for (let y = 0; y < 180; y++) for (let x = 40; x < 280; x++) source.fill(255, (y * 320 + x) * 4, (y * 320 + x) * 4 + 4);
  const edges = new Contours(320, 180).process(source, 45, 12);
  expect(edges.some((value, i) => i % 4 === 0 && value > 0)).toBe(true);
  gatePaddingEdges(edges, 320, 180, rect);
  expect(edges.some((value, i) => i % 4 === 0 && value > 0)).toBe(false);
});
