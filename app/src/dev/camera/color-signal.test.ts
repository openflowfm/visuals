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

test('native vertex colors use the palette even when the raster edge pixel is black', () => {
  const signal = new ColorSignal(2, 1),
    source = new Uint8ClampedArray([100, 100, 100, 255, 0, 0, 0, 255]);
  signal.prepare(new Uint8ClampedArray(8), source, null, 100, 0);
  expect(signal.emission[0]).toBe(0);
  expect(Math.max(...signal.strokeColor(0, 0, source))).toBe(1);
  signal.prepare(new Uint8ClampedArray(8), source, null, 0, 0);
  expect(signal.strokeColor(0, 0, source)).toEqual([1, 1, 1]);
});

test('camera image preserves original RGB and full masked opacity independently of color', () => {
  const signal = new ColorSignal(2, 1);
  const source = new Uint8ClampedArray([180, 100, 80, 255, 40, 20, 10, 255]);
  for (const color of [0, 100]) {
    signal.prepare(new Uint8ClampedArray(8), source, new Float32Array([1, 0.5]), color, 12);
    expect([...signal.identity]).toEqual([180, 100, 80, 255, 40, 20, 10, 128]);
  }
  signal.prepare(new Uint8ClampedArray(8), source, null, 100, 12);
  expect([...signal.identity]).toEqual([...source]);
});
