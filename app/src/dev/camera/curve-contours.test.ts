import { describe, expect, test, vi } from 'vitest';
import { drawContourPaths, traceContours } from './curve-contours';
function frame(width: number, height: number, predicate: (x: number, y: number) => boolean) {
  return new Uint8ClampedArray(Array.from({ length: width * height }, (_, i) => (predicate(i % width, Math.floor(i / width)) ? 255 : 0)));
}
describe('vector contours', () => {
  test('orders a staircase as one connected chain and preserves endpoints', () => {
    const edges = frame(32, 24, (x, y) => x >= 3 && x <= 25 && y === Math.floor(x / 2));
    const [path] = traceContours(edges, 32, 24, 90);
    expect(traceContours(edges, 32, 24, 90)).toHaveLength(1);
    expect(path.closed).toBe(false);
    expect(path.points[0]).toEqual({ x: 3.5, y: 1.5 });
    expect(path.points.at(-1)).toEqual({ x: 25.5, y: 12.5 });
    expect(path.points.length).toBeLessThan(23);
    for (const p of path.points) expect(Math.abs(p.y - p.x / 2)).toBeLessThan(1);
  });
  test('retains a closed ring without shortcut triangles or duplicate endpoint', () => {
    const edges = frame(24, 24, (x, y) => x >= 4 && x <= 19 && y >= 4 && y <= 19 && (x === 4 || x === 19 || y === 4 || y === 19));
    const paths = traceContours(edges, 24, 24, 65);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    expect(paths[0].points.length).toBeGreaterThan(20);
    expect(paths[0].points[0]).not.toEqual(paths[0].points.at(-1));
  });
  test('splits junctions without jumping between separate features; rejects flecks', () => {
    const edges = frame(40, 30, (x, y) => (x === 10 && y > 3 && y < 25) || (y === 12 && x > 3 && x < 18) || (x === 32 && y > 4 && y < 20) || (x === 25 && y === 25));
    const paths = traceContours(edges, 40, 30, 40);
    expect(paths).toHaveLength(5);
    for (const path of paths) expect(path.points.every((p) => p.x < 19) || path.points.every((p) => p.x === 32.5)).toBe(true);
  });
  test('bounds pathological dense images and rejects invalid dimensions', () => {
    const paths = traceContours(new Uint8ClampedArray(320 * 180).fill(255), 320, 180, 100);
    expect(paths.length).toBeLessThanOrEqual(512);
    expect(paths.reduce((n, p) => n + p.points.length, 0)).toBeLessThanOrEqual(16384);
    expect(() => traceContours(new Uint8ClampedArray(9), 3.1, 3, 50)).toThrow();
    expect(() => traceContours(new Uint8ClampedArray(9), 3, 4, 50)).toThrow();
    expect(() => traceContours(new Uint8ClampedArray(), 10000, 10000, 50)).toThrow();
  });
  test('RGBA and grayscale produce identical paths, including zero smoothing', () => {
    const mono = frame(24, 24, (x, y) => x === y),
      rgba = new Uint8ClampedArray(24 * 24 * 4);
    mono.forEach((v, i) => {
      rgba[i * 4] = v;
      rgba[i * 4 + 3] = 255;
    });
    expect(traceContours(rgba, 24, 24, 0)).toEqual(traceContours(mono, 24, 24, 0));
    expect(traceContours(mono, 24, 24, NaN)).toEqual(traceContours(mono, 24, 24, 0));
  });
  test('draws independent continuous quadratic paths in scaled coordinates', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      globalAlpha: 1,
    };
    drawContourPaths(
      ctx as unknown as CanvasRenderingContext2D,
      [
        {
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 3 },
            { x: 4, y: 4 },
          ],
          closed: true,
        },
      ],
      { scaleX: 4, scaleY: 4, lineWidth: 0.8, strokeStyle: 'white' },
    );
    expect(ctx.scale).toHaveBeenCalledWith(4, 4);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(3);
    expect(ctx.closePath).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});
