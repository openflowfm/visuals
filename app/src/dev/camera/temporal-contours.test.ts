import { expect, test } from 'vitest';
import { TemporalContours } from './temporal-contours';
const line = (x: number) => ({
  points: [
    { x, y: 5 },
    { x, y: 12 },
    { x, y: 20 },
  ],
  closed: false,
});
test('reduces one-pixel stationary shimmer without relying on path index', () => {
  const filter = new TemporalContours(40, 30);
  filter.update([line(10), line(30)], 0, 70);
  const result = filter.update([line(31), line(11)], 33, 70);
  expect(result[0].points[1].x).toBeGreaterThan(30);
  expect(result[0].points[1].x).toBeLessThan(30.5);
  expect(result[1].points[1].x).toBeGreaterThan(10);
  expect(result[1].points[1].x).toBeLessThan(10.5);
});
test('rapid motion snaps and removed edges disappear with no trail', () => {
  const filter = new TemporalContours(40, 30);
  filter.update([line(10)], 0, 100);
  expect(filter.update([line(18)], 33, 100)).toEqual([line(18)]);
  expect(filter.update([], 66, 100)).toEqual([]);
  expect(filter.update([line(19)], 99, 100)).toEqual([line(19)]);
});
test('elapsed time determines easing and reset or long gaps discard history', () => {
  const fast = new TemporalContours(40, 30),
    slow = new TemporalContours(40, 30);
  fast.update([line(10)], 0, 100);
  slow.update([line(10)], 0, 100);
  expect(fast.update([line(11)], 16, 100)[0].points[1].x).toBeLessThan(slow.update([line(11)], 66, 100)[0].points[1].x);
  fast.reset();
  expect(fast.update([line(11)], 33, 100)).toEqual([line(11)]);
  expect(slow.update([line(12)], 300, 100)).toEqual([line(12)]);
});
test('unrelated perpendicular features do not attract and zero steadiness bypasses', () => {
  const filter = new TemporalContours(40, 30);
  filter.update([line(10)], 0, 100);
  const horizontal = {
    points: [
      { x: 5, y: 12 },
      { x: 10, y: 12 },
      { x: 20, y: 12 },
    ],
    closed: false,
  };
  expect(filter.update([horizontal], 33, 100)).toEqual([horizontal]);
  filter.update([line(10)], 66, 100);
  expect(filter.update([line(11)], 99, 0)).toEqual([line(11)]);
});
test('output topology and work stay bounded under dense input', () => {
  const filter = new TemporalContours(320, 180);
  const paths = Array.from({ length: 1000 }, (_, i) => line(i % 320));
  const result = filter.update(paths, 0, 60);
  expect(result.length).toBeLessThanOrEqual(512);
  expect(result.reduce((n, p) => n + p.points.length, 0)).toBeLessThanOrEqual(8192);
});
