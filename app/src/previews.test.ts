import { describe, expect, it } from 'vitest';
import { DIM, MAX_GAIN, layerOver } from './previews.ts';

const pixels = (...rgb: [number, number, number][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 0]));

describe("a layer's picture", () => {
  it('shows the frame it draws into, dimmed, where it drew nothing', () => {
    const out = layerOver(pixels([0, 0, 0], [0, 0, 0]), pixels([200, 100, 0], [0, 0, 0]));
    expect([...out.slice(0, 4)]).toEqual([Math.round(200 * DIM), Math.round(100 * DIM), 0, 255]);
  });

  it('brightens a faint drawing so its brightest channel is full, over the dim frame', () => {
    const out = layerOver(pixels([64, 32, 0], [0, 0, 0]), pixels([0, 0, 0], [100, 100, 100]));
    expect([...out.slice(0, 4)]).toEqual([255, 128, 0, 255]);
    expect(out[4]).toBe(Math.round(100 * DIM));
  });

  it('brightens by at most the gain cap, and a bright drawing not at all', () => {
    const black = pixels([0, 0, 0]);
    expect(layerOver(pixels([10, 0, 0]), black)[0]).toBe(10 * MAX_GAIN);
    expect(layerOver(pixels([255, 40, 0]), black)[1]).toBe(40);
  });

  it('is opaque whatever the drawing’s alpha', () => {
    expect(layerOver(pixels([0, 0, 0]), pixels([0, 0, 0]))[3]).toBe(255);
  });
});
