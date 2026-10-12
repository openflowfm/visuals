import { expect, test } from 'vitest';
import { ColorSignal } from './color-signal';

test('colored emission changes native input while the same source retains facial shading', () => {
  const signal = new ColorSignal(2, 1);
  const source = new Uint8ClampedArray([180, 100, 80, 255, 40, 20, 10, 255]);
  const edges = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const emission = signal.prepare(edges, source, new Float32Array([1, 1]), 100, 0);
  expect(new Set(emission.slice(0, 3)).size).toBeGreaterThan(1);
  expect([...emission.slice(4, 7)]).toEqual([0, 0, 0]);
  expect(signal.identity[7]).toBeGreaterThan(0);
  expect(signal.identity[4]).toBeGreaterThan(0);
  signal.prepare(edges, source, new Float32Array([1, 0]), 0, 0);
  expect([...emission.slice(0, 3)]).toEqual([255, 255, 255]);
  expect(signal.identity[7]).toBe(0);
});

test('empty masks and no contours cannot reintroduce the room in identity', () => {
  const signal = new ColorSignal(2, 1);
  signal.prepare(new Uint8ClampedArray(8), new Uint8ClampedArray(8).fill(255), new Float32Array(2), 100, 0);
  expect(signal.identity[3]).toBe(0);
  expect(signal.identity[7]).toBe(0);
});
