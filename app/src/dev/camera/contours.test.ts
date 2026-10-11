import { describe, expect, test } from 'vitest';
import { Contours, rawFrameSize } from './contours';
const w = 64,
  h = 36;
function scene(pixel: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = pixel(x, y);
      data[i + 3] = 255;
    }
  return data;
}
const lit = (data: Uint8ClampedArray) => data.filter((v, i) => i % 4 === 0 && v > 50).length;
describe('source contours', () => {
  test('rejects grain in a flat field but preserves a low-contrast outline', () => {
    const filter = new Contours(w, h);
    expect(
      lit(
        filter.process(
          scene((x, y) => 110 + ((x * 17 + y * 31) % 7)),
          45,
          12,
        ),
      ),
    ).toBe(0);
    const edges = filter.process(
      scene((x, y) => (x >= 20 && x < 44 && y >= 8 && y < 28 ? 145 : 105) + ((x * 17 + y * 31) % 5)),
      45,
      6,
    );
    expect(lit(edges)).toBeGreaterThan(30);
    expect(lit(edges)).toBeLessThan(150);
    expect(edges[(18 * w + 32) * 4]).toBe(0); // face interior, not a filled blob
  });
  test('raising noise cutoff removes weak detail without inventing pixels', () => {
    const filter = new Contours(w, h),
      input = scene((x, y) => (x > 30 ? 150 : 110) + Math.sin(y / 3) * 20);
    const sensitive = lit(filter.process(input, 80, 2));
    expect(lit(filter.process(input, 80, 25))).toBeLessThan(sensitive);
  });
  test('person mask removes background edges and retains even a dark silhouette', () => {
    const filter = new Contours(w, h);
    const mask = { width: w, height: h, data: new Float32Array(w * h) };
    for (let y = 8; y < 28; y++) for (let x = 20; x < 44; x++) mask.data[y * w + x] = 1;
    const result = filter.process(
      scene((x) => (x < 15 ? 240 : 5)),
      45,
      12,
      mask,
    );
    expect(lit(result)).toBeGreaterThan(30);
    for (let y = 0; y < h; y++) for (let x = 0; x < 16; x++) expect(result[(y * w + x) * 4]).toBe(0);
    const raw = filter.cutout(
      scene(() => 100),
      mask,
    );
    expect(raw[0]).toBe(0);
    expect(raw[(18 * w + 32) * 4]).toBe(100);
  });
  test('reuses output buffers and validates malformed source and mask sizes', () => {
    const filter = new Contours(w, h),
      input = scene(() => 100);
    expect(filter.process(input, 50, 12)).toBe(filter.process(input, 50, 12));
    expect(() => filter.process(new Uint8ClampedArray(4), 50, 12)).toThrow();
    expect(() => filter.cutout(input, { width: 2, height: 2, data: new Float32Array(1) })).toThrow();
  });
});
test('raw output requires bounded dimensions and a complete RGBA frame', () => {
  const headers = new Headers({ 'X-Frame-Width': '640', 'X-Frame-Height': '360' });
  expect(rawFrameSize(headers, 640 * 360 * 4)).toEqual([640, 360]);
  expect(() => rawFrameSize(headers, 30)).toThrow();
  expect(() => rawFrameSize(new Headers(), 0)).toThrow();
  expect(() => rawFrameSize(new Headers({ 'X-Frame-Width': '999999999', 'X-Frame-Height': '360' }), 0)).toThrow();
});
