import { describe, expect, it } from 'vitest';
import { DIM, HEADER, MAX_GAIN, SETTLE_MS, STEPS, layerOver, needed, settler, stepFor, unpack, wanted, withinBudget, ZOOM_IN } from './previews.ts';

/** The device pixels a 192 CSS px picture covers, as the poll works it out. */
const need = (node: number, graph: number, dpr: number) => needed(192, { node, graph }, dpr);

describe('the size a picture is asked for', () => {
  it('is CSS width × node zoom × graph zoom × pixel ratio, zoomed in', () => {
    expect(needed(150, { node: 0.5, graph: 3 }, 2)).toBe(450);
  });

  it('is the base size at 1× or zoomed out, whatever the display', () => {
    expect(STEPS).toEqual([192, 384, 768]);
    expect(stepFor(need(1, 1, 1), 0)).toBe(0);
    expect(stepFor(need(1, 1, 2), 0)).toBe(0);
    expect(stepFor(need(1, 0.4, 3), 0)).toBe(0);
    expect(stepFor(need(1, 1, 2), 2)).toBe(0);
  });

  it('steps up with the zoom it is shown at', () => {
    expect(stepFor(need(0.6, 1.04, 2), 0)).toBe(0);
    expect(stepFor(need(1, 1.2, 2), 0)).toBe(1);
    expect(stepFor(need(1, 2, 2), 0)).toBe(2);
  });

  it('stops at the largest step, however far in', () => {
    expect(stepFor(need(1, 3, 2), 0)).toBe(STEPS.length - 1);
    expect(stepFor(need(1, 3, 3), 2)).toBe(STEPS.length - 1);
  });

  it('steps down only once a smaller step covers the picture with room to spare', () => {
    // 230 px: stretched less than the limit from 192, and short of 384.
    expect(stepFor(230, 0)).toBe(0);
    expect(stepFor(230, 1)).toBe(1);
    expect(stepFor(170, 1)).toBe(0);
    expect(stepFor(170, 2)).toBe(0);
    expect(stepFor(400, 2)).toBe(2);
    expect(stepFor(300, 2)).toBe(1);
  });

  it('steps down when more pictures are on screen than fit the budget at that size', () => {
    expect(withinBudget(2, 4)).toBe(2);
    expect(withinBudget(2, 5)).toBe(1);
    expect(withinBudget(2, 15)).toBe(1);
    expect(withinBudget(1, 15)).toBe(1);
    expect(withinBudget(0, 15)).toBe(0);
  });

  it('leaves the base step only past ZOOM_IN, and comes back only at 1×', () => {
    const at = (graph: number, from: number) => stepFor(needed(192, { node: 1, graph }, 2, from), from);
    expect(at(1.05, 0)).toBe(0);
    expect(at(ZOOM_IN + 0.01, 0)).toBe(1);
    expect(at(1.05, 1)).toBe(1);
    expect(at(1, 1)).toBe(0);
    for (let graph = 0.9; graph < 1.3; graph += 0.01) {
      for (let from = 0; from < STEPS.length; from++) {
        const once = at(graph, from);
        expect(at(graph, once)).toBe(once);
      }
    }
  });

  it('never flips between two steps for one need', () => {
    for (let px = 50; px < 1500; px += 7) {
      for (let from = 0; from < STEPS.length; from++) {
        const once = stepFor(px, from);
        expect(stepFor(px, once)).toBe(once);
      }
    }
  });

  it('changes once zooming settles, not on every tick', () => {
    const settle = settler();
    expect(settle(2, 0)).toBe(0);
    expect(settle(2, SETTLE_MS - 1)).toBe(0);
    // Back and forth while the wheel turns: the wait starts again.
    expect(settle(1, SETTLE_MS)).toBe(0);
    expect(settle(2, SETTLE_MS + 10)).toBe(0);
    expect(settle(2, 2 * SETTLE_MS + 10)).toBe(2);
    expect(settle(0, 2 * SETTLE_MS + 20)).toBe(2);
    expect(settle(2, 3 * SETTLE_MS + 20)).toBe(2);
  });
});

describe('the pictures asked for', () => {
  it("are the ones shown, and under a layer the frame it draws into, in the engine's order", () => {
    expect(wanted([3, 1])).toEqual([1, 3]);
    expect(wanted([9, 3, 9])).toEqual([0, 3, 9]);
    expect(wanted([])).toEqual([]);
  });
});

/** A poll's bytes: the header, then `pictures` (each `w`×`h`, filled with its index) in order. */
function polled(w: number, h: number, which: number[], cut = 0): ArrayBuffer {
  const each = w * h * 4;
  const bytes = new Uint8Array(HEADER + each * which.length - cut);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, w, true);
  header.setUint32(4, h, true);
  header.setUint32(
    8,
    which.reduce((m, i) => m | (1 << i), 0),
    true,
  );
  which.forEach((i, n) => bytes.fill(i, HEADER + each * n, Math.min(bytes.length, HEADER + each * (n + 1))));
  return bytes.buffer;
}

describe('a poll', () => {
  it('unpacks a subset at its own size, by stage', () => {
    const got = unpack(polled(4, 2, [0, 5, 14]))!;
    expect([got.width, got.height]).toEqual([4, 2]);
    expect([...got.pictures.keys()]).toEqual([0, 5, 14]);
    for (const [which, picture] of got.pictures) {
      expect(picture.length).toBe(4 * 2 * 4);
      expect(picture.every((b) => b === which)).toBe(true);
    }
  });

  it('is nothing when empty, cut short or holding none', () => {
    expect(unpack(new ArrayBuffer(0))).toBeNull();
    expect(unpack(polled(4, 2, [0, 5], 1))).toBeNull();
    expect(unpack(polled(4, 2, []))).toBeNull();
  });
});

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
