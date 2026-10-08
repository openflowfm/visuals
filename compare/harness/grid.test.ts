import { describe, expect, it } from 'vitest';
import { captureFrames, factsOf, parseSize, refreshLands, selfDrift, UsageError } from './bench.ts';
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
    // Every section is fully different; only the palette (no hue on either side) agrees.
    expect(result.score).toBeLessThan(25);
    expect(result.excess.every((e) => e === 1)).toBe(true);
  });

  it('forgives a difference Butterchurn also has from itself, in its furthest re-run', () => {
    const ref = side(flat(0, 0, 0));
    const other = side(flat(200, 200, 200));
    expect(compareCapture(ref, other, [ref, other]).score).toBe(100);
    expect(compareCapture(ref, other, [ref]).score).toBeLessThan(25);
  });

  it('forgives a difference ours also has from itself, drawn again', () => {
    const ref = side(flat(0, 0, 0));
    const ours = side(flat(120, 120, 120));
    expect(compareCapture(ref, ours, [ref]).score).toBeLessThan(30);
    // Ours re-run lands as far from ours as ours is from Butterchurn: within drift.
    expect(compareCapture(ref, ours, [ref], [side(flat(240, 240, 240))]).score).toBe(100);
  });

  it('allows a little difference even when the re-runs are exactly equal', () => {
    const ref = side(centred(200, 20));
    expect(compareCapture(ref, side(centred(206, 24)), [ref]).score).toBe(100);
    expect(compareCapture(ref, side(centred(60, 20)), [ref]).score).toBeLessThan(80);
  });

  it('counts a defect in two sections more than their share of the mean', () => {
    const ref = side(flat(0, 0, 0));
    const ours = side(picture((x, y) => (y < H / SECTIONS.rows && x < (2 * W) / SECTIONS.cols ? [255, 255, 255] : [0, 0, 0])));
    const result = compareCapture(ref, ours, [ref]);
    expect(result.excess.filter((e) => e > 0.5)).toHaveLength(2);
    // A plain mean would give 2 of 32 sections: about 94.
    expect(result.score).toBeLessThan(90);
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

  it('never says the hue matches for pink against red', () => {
    const ref = side(flat(220, 20, 20));
    const ours = side(flat(230, 60, 160));
    const line = describeGap([{ weight: 1, ref, ours, drifts: [ref] }]);
    expect(line).not.toContain('hue matches');
    expect(line).toContain('hue differs (ours magenta, Butterchurn red)');
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

  it('lets one clearly wrong capture pull the score down, and names it', () => {
    const red = flat(220, 20, 20), pink = flat(230, 60, 160);
    // Right for the first captures, wrong from frame 50: the plain weighted mean would be about 90.
    const run = compareRun(
      [1, 2, 5, 10, 50].map((frame) => ({ frame, ref: red, ours: frame < 50 ? red : pink, drifts: [red] })),
      W,
      H,
    );
    expect(run.score).toBeLessThan(60);
    expect(run.sentence).toContain('worst at frame 50');
    expect(run.sentence).toContain('hue differs');
    expect(run.sentence).not.toContain('hue matches');
  });

  it('takes ours re-run at another size', () => {
    const grey = flat(120, 120, 120);
    const bigger = { rgba: new Uint8Array(new Array((W + 2) * (H + 1)).fill([240, 240, 240, 255]).flat()), width: W + 2, height: H + 1 };
    const run = compareRun([{ frame: 1, ref: flat(0, 0, 0), ours: grey, drifts: [flat(0, 0, 0)], oursDrifts: [bigger] }], W, H);
    expect(run.score).toBe(100);
  });
});

describe('the bench', () => {
  it('captures early frames first, geometrically spaced', () => {
    expect(captureFrames(240, 8)).toEqual([1, 2, 5, 10, 23, 50, 110, 240]);
    expect(captureFrames(10, 1)).toEqual([10]);
  });

  it('takes only a well-formed size', () => {
    expect(parseSize('640x360')).toEqual({ width: 640, height: 360 });
    for (const bad of ['640x', 'x360', '640x360x2', '640.5x360', 'big', '0x360', '640X360', '99999x10']) expect(() => parseSize(bad), bad).toThrow(UsageError);
  });

  it('takes only a refresh that lands on every capture frame', () => {
    expect(refreshLands(60, [1, 2, 5, 240])).toBe(true);
    expect(refreshLands(30, [1, 2, 5])).toBe(true);
    expect(refreshLands(45, [2, 4])).toBe(true);
    expect(refreshLands(45, [1, 2])).toBe(false);
    expect(refreshLands(50, [1])).toBe(false);
  });

  it('draws its own re-run slightly larger, with another seed', () => {
    const self = selfDrift(1n, 640, 360);
    expect(self.seed).not.toBe(1n);
    expect([self.width, self.height]).toEqual([656, 369]);
  });

  it("reads which random sources a preset uses and how hard it feeds back", () => {
    const facts = factsOf('[preset00]\nfDecay=1.0\nper_frame_1=q1 = rand(10);\nper_pixel_1=zoom = 1.01;\nwarp_1=`ret = rand_frame.xyz;\n');
    expect(facts.uses).toEqual({ rand: true, rand_frame: true, rand_start: false, rand_preset: false });
    expect(facts.feedback).toEqual({ decay: 1, strong: true });
    expect(factsOf('[preset00]\nfDecay=0.9\n').feedback.strong).toBe(false);
  });
});
