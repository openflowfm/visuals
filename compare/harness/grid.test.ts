import { describe, expect, it } from 'vitest';
import { captureFrames, factsOf } from './bench.ts';
import { compareCapture, compareRun, describe as describeGap, motionOf, pictureOf, regionName, SECTIONS, type Side } from './grid.ts';

const W = 64, H = 32;
/** A picture painted by `paint(x, y)` → [r, g, b]. */
const picture = (paint: (x: number, y: number) => [number, number, number]) => {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out.set([...paint(x, y), 255], (y * W + x) * 4);
    }
  }
  return out;
};
const flat = (r: number, g: number, b: number) => picture(() => [r, g, b]);
/** Brighter in the centre sections (columns 2–5, rows 1–2 of 8×4) than outside. */
const centred = (inside: number, outside: number) =>
  picture((x, y) => {
    const sx = Math.floor((x * SECTIONS.cols) / W), sy = Math.floor((y * SECTIONS.rows) / H);
    const v = sx >= 2 && sx <= 5 && sy >= 1 && sy <= 2 ? inside : outside;
    return [v, v, v];
  });
const side = (rgba: Uint8Array): Side => ({ picture: pictureOf(rgba, W, H) });

describe('pictureOf', () => {
  it('reduces a flat picture to flat sections', () => {
    const p = pictureOf(flat(255, 0, 0), W, H);
    expect(p.sections).toHaveLength(SECTIONS.cols * SECTIONS.rows);
    for (const s of p.sections) {
      expect(s.lum).toBeCloseTo(0.2126, 3);
      expect(s.hue).toBe(0);
      expect(s.chroma).toBe(1);
      expect(s.edge).toBe(0);
    }
  });

  it('finds texture where the picture has edges, and ignores none of it in flat areas', () => {
    const stripes = pictureOf(
      picture((x) => (Math.floor(x / 4) % 2 ? [255, 255, 255] : [0, 0, 0])),
      W,
      H,
    );
    expect(stripes.whole.edge).toBeGreaterThan(0.1);
  });

  it('measures how a section changed between captures', () => {
    const m = motionOf(pictureOf(flat(0, 0, 0), W, H), pictureOf(flat(255, 255, 255), W, H));
    expect(m.whole.change).toBeCloseTo(1, 3);
  });
});

describe('compareCapture', () => {
  it('scores identical pictures 100', () => {
    const a = side(centred(200, 20));
    expect(compareCapture(a, a, [a]).score).toBe(100);
  });

  it('scores a difference far beyond the floor low', () => {
    const ref = side(flat(0, 0, 0));
    const result = compareCapture(ref, side(flat(255, 255, 255)), [ref]);
    expect(result.score).toBeLessThan(10);
    expect(result.excess.every((e) => e === 1)).toBe(true);
  });

  it('forgives a difference Butterchurn also has from itself, in its furthest re-run', () => {
    const ref = side(flat(0, 0, 0));
    const other = side(flat(200, 200, 200));
    expect(compareCapture(ref, other, [ref, other]).score).toBe(100);
    expect(compareCapture(ref, other, [ref]).score).toBeLessThan(10);
  });
});

describe('the plain-language line', () => {
  it('says where ours is brighter, and what matches', () => {
    const ref = side(centred(60, 60));
    const ours = side(centred(220, 60));
    const line = describeGap([{ weight: 1, ref, ours, drifts: [ref] }]);
    expect(line).toContain('ours brighter in the centre sections');
    expect(line).toContain('hue matches');
  });

  it('says nothing differs when the gap is within the floor', () => {
    const ref = side(centred(60, 60));
    const ours = side(centred(220, 60));
    expect(describeGap([{ weight: 1, ref, ours, drifts: [ref, ours] }])).toBe('brightness matches; edges match; hue matches');
  });

  it('names the regions of the 8×4 grid', () => {
    expect(regionName(0)).toBe('top');
    expect(regionName(SECTIONS.cols + 3)).toBe('centre');
    expect(regionName(SECTIONS.cols)).toBe('left');
    expect(regionName(SECTIONS.cols * SECTIONS.rows - 1)).toBe('bottom');
  });
});

describe('compareRun', () => {
  it('weights early captures most, and calls a drifting reference not comparable', () => {
    const black = flat(0, 0, 0), white = flat(255, 255, 255);
    // Ours is wrong only at the first capture: that costs more than being wrong only at the last.
    const early = compareRun(
      [
        { frame: 1, ref: black, ours: white, drifts: [black] },
        { frame: 64, ref: black, ours: black, drifts: [black] },
      ],
      W,
      H,
    );
    const late = compareRun(
      [
        { frame: 1, ref: black, ours: black, drifts: [black] },
        { frame: 64, ref: black, ours: white, drifts: [black] },
      ],
      W,
      H,
    );
    expect(early.score).toBeLessThan(late.score);
    const chaotic = compareRun([{ frame: 1, ref: black, ours: black, drifts: [white] }], W, H);
    expect(chaotic.notComparable).toBe(true);
    expect(chaotic.sentence).toMatch(/^not comparable/);
  });
});

describe('the bench', () => {
  it('captures early frames first, geometrically spaced', () => {
    expect(captureFrames(240, 8)).toEqual([1, 2, 5, 10, 23, 50, 110, 240]);
    expect(captureFrames(10, 1)).toEqual([10]);
  });

  it("reads which random sources a preset uses and how hard it feeds back", () => {
    const facts = factsOf('[preset00]\nfDecay=1.0\nper_frame_1=q1 = rand(10);\nper_pixel_1=zoom = 1.01;\nwarp_1=`ret = rand_frame.xyz;\n');
    expect(facts.uses).toEqual({ rand: true, rand_frame: true, rand_start: false, rand_preset: false });
    expect(facts.feedback).toEqual({ decay: 1, strong: true });
    expect(factsOf('[preset00]\nfDecay=0.9\n').feedback.strong).toBe(false);
  });
});
