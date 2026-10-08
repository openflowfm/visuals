// How the bench compares two pictures: never pixel by pixel. Each picture is
// reduced to a coarse pyramid — a 32×16 grid of cells, an 8×4 grid of sections
// (4×4 cells each) and one whole-frame summary — and every claim is made at the
// section level: mean colour and brightness, dominant hue, edge/texture energy,
// and how much and which way the section moved since the previous capture.
//
// A difference only counts beyond the drift floor, feature by feature: per
// section and feature, the furthest of Butterchurn against Butterchurn re-run
// with other random seeds, and of ours against ours drawn again slightly larger
// with another seed (how far ours drifts from itself: a preset that feeds back
// strongly turns float-level differences into different pictures, and
// Butterchurn's own re-runs may not show it when the preset uses no
// randomness). Never below `MIN_FLOOR`: a floor of exactly zero would count
// every WebGL-against-wgpu rounding in full. MilkDrop presets drift apart by
// nature, so the floor is what "different" has to beat. Beside the sections,
// the whole frame's palette (which hues and brightnesses it holds) is compared
// the same way: drift moves shapes about, but rarely turns red into pink.
//
// The constants were set by `npm run calibrate` (compare/README.md has the numbers).

export const CELLS = { cols: 32, rows: 16 } as const;
export const SECTIONS = { cols: 8, rows: 4 } as const;
/** The resolution edge/texture energy is measured at: coarse enough to ignore pixel noise. */
const TEXTURE = { cols: 128, rows: 64 } as const;
/** Weighted distance beyond the floor, over a section's features, at which it counts as fully different. */
export const SCALE = 0.12;
/** The least floor each feature of a section is allowed, whatever the re-runs say. */
export const MIN_FLOOR = 0.2;
/** How a capture's score is made: its sections' mean excess, the worst `WORST_SECTIONS`' mean, the whole frame's, and the palette's. */
export const CAPTURE_WEIGHTS = { mean: 0.5, worst: 0.2, whole: 0.1, palette: 0.2 } as const;
export const WORST_SECTIONS = 4;
/** Palette distance beyond its floor at which a capture's palette counts as fully different, and the least floor it is allowed. */
export const PALETTE_SCALE = 0.25;
export const MIN_PALETTE_FLOOR = 0.05;
/** How much the worst capture pulls the preset's score from the weighted mean of its captures towards it. */
export const WORST_CAPTURE = 0.7;
/** How the five features make a section's distance (motion only from the second capture). */
export const FEATURE_WEIGHTS = { brightness: 0.3, colour: 0.2, hue: 0.15, edge: 0.2, motion: 0.15 } as const;
export type Feature = keyof typeof FEATURE_WEIGHTS;

export interface Region {
  /** Mean colour, 0–1. */
  r: number;
  g: number;
  b: number;
  /** Rec. 709 luma of the mean colour, 0–1. */
  lum: number;
  /** Hue of the mean colour, degrees; meaningful when `chroma` is. */
  hue: number;
  /** max − min of the mean colour, 0–1. */
  chroma: number;
  /** Mean neighbouring luma change at 128×64, 0–1. */
  edge: number;
  /** Brightness-weighted centre within the region, −0.5…0.5 of its size. */
  cx: number;
  cy: number;
}

export interface Picture {
  sections: Region[];
  whole: Region;
  /** Luma per cell, for motion between captures. */
  cells: Float32Array;
  /** The frame's palette over its cells: `HUE_BINS` hue bins (30° each), each cell adding its chroma, so they sum to the mean chroma. */
  palette: Float32Array;
}

const HUE_BINS = 12;

/** The palette of a set of cell colours: how much of each hue, each cell spread linearly over its two nearest bins. */
function paletteOf(cellRgb: Float32Array): Float32Array {
  const out = new Float32Array(HUE_BINS);
  const n = cellRgb.length / 3;
  for (let i = 0; i < n; i++) {
    const r = cellRgb[i * 3], g = cellRgb[i * 3 + 1], b = cellRgb[i * 3 + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const h = (hueOf(r, g, b) / 360) * HUE_BINS - 0.5;
    const h0 = Math.floor(h), hf = h - h0;
    out[(h0 + HUE_BINS) % HUE_BINS] += (chroma * (1 - hf)) / n;
    out[(h0 + 1 + HUE_BINS) % HUE_BINS] += (chroma * hf) / n;
  }
  return out;
}

/** How far apart two palettes are, 0–1: the summed bin differences (a vivid frame that changes every hue scores 1). */
export function paletteDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < HUE_BINS; i++) sum += Math.abs(a[i] - b[i]);
  return clamp01(sum);
}

export interface Motion {
  /** Mean luma change of the region's cells since the previous capture, 0–1. */
  change: number;
  /** How its brightness centre moved, in region widths/heights. */
  dx: number;
  dy: number;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** RGB per cell, 0–1, by area average; a cell smaller than a pixel takes the pixel under it. */
function average(rgba: Uint8Array, width: number, height: number, cols: number, rows: number): Float32Array {
  const span = (i: number, n: number, size: number) => {
    const from = Math.min(size - 1, Math.floor((i * size) / n));
    return [from, Math.max(from + 1, Math.floor(((i + 1) * size) / n))];
  };
  const out = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    const [y0, y1] = span(row, rows, height);
    for (let col = 0; col < cols; col++) {
      const [x0, x1] = span(col, cols, width);
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * width + x) * 4;
          r += rgba[at];
          g += rgba[at + 1];
          b += rgba[at + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0) * 255;
      out.set([r / n, g / n, b / n], (row * cols + col) * 3);
    }
  }
  return out;
}

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d <= 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function region(r: number, g: number, b: number, edge: number, cx: number, cy: number): Region {
  return { r, g, b, lum: luma(r, g, b), hue: hueOf(r, g, b), chroma: Math.max(r, g, b) - Math.min(r, g, b), edge, cx, cy };
}

/** A picture (RGBA rows, top to bottom) reduced to its sections and whole. */
export function pictureOf(rgba: Uint8Array, width: number, height: number): Picture {
  const cellRgb = average(rgba, width, height, CELLS.cols, CELLS.rows);
  const cells = new Float32Array(CELLS.cols * CELLS.rows);
  for (let i = 0; i < cells.length; i++) cells[i] = luma(cellRgb[i * 3], cellRgb[i * 3 + 1], cellRgb[i * 3 + 2]);
  const tex = average(rgba, width, height, TEXTURE.cols, TEXTURE.rows);
  const texLum = (x: number, y: number) => {
    const i = (y * TEXTURE.cols + x) * 3;
    return luma(tex[i], tex[i + 1], tex[i + 2]);
  };
  const regionOver = (c0: number, c1: number, r0: number, r1: number): Region => {
    let r = 0, g = 0, b = 0, n = 0, wx = 0, wy = 0, w = 0;
    for (let y = r0; y < r1; y++) {
      for (let x = c0; x < c1; x++) {
        const i = y * CELLS.cols + x;
        r += cellRgb[i * 3];
        g += cellRgb[i * 3 + 1];
        b += cellRgb[i * 3 + 2];
        n++;
        const l = cells[i];
        wx += l * ((x - c0 + 0.5) / (c1 - c0) - 0.5);
        wy += l * ((y - r0 + 0.5) / (r1 - r0) - 0.5);
        w += l;
      }
    }
    // Edge energy over the same area at texture resolution.
    const tx0 = (c0 * TEXTURE.cols) / CELLS.cols, tx1 = (c1 * TEXTURE.cols) / CELLS.cols;
    const ty0 = (r0 * TEXTURE.rows) / CELLS.rows, ty1 = (r1 * TEXTURE.rows) / CELLS.rows;
    let edge = 0, en = 0;
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const l = texLum(x, y);
        if (x + 1 < TEXTURE.cols) edge += Math.abs(texLum(x + 1, y) - l);
        if (y + 1 < TEXTURE.rows) edge += Math.abs(texLum(x, y + 1) - l);
        en++;
      }
    }
    return region(r / n, g / n, b / n, en ? edge / en : 0, w > 1e-4 ? wx / w : 0, w > 1e-4 ? wy / w : 0);
  };
  const cw = CELLS.cols / SECTIONS.cols, ch = CELLS.rows / SECTIONS.rows;
  const sections: Region[] = [];
  for (let sy = 0; sy < SECTIONS.rows; sy++) for (let sx = 0; sx < SECTIONS.cols; sx++) sections.push(regionOver(sx * cw, (sx + 1) * cw, sy * ch, (sy + 1) * ch));
  return { sections, whole: regionOver(0, CELLS.cols, 0, CELLS.rows), cells, palette: paletteOf(cellRgb) };
}

/** Each section's motion from `before` to `after`, and the whole frame's. */
export function motionOf(before: Picture, after: Picture): { sections: Motion[]; whole: Motion } {
  const cw = CELLS.cols / SECTIONS.cols, ch = CELLS.rows / SECTIONS.rows;
  const changeOver = (c0: number, c1: number, r0: number, r1: number) => {
    let sum = 0, n = 0;
    for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++, n++) sum += Math.abs(after.cells[y * CELLS.cols + x] - before.cells[y * CELLS.cols + x]);
    return sum / n;
  };
  const sections = after.sections.map((s, i) => {
    const sx = i % SECTIONS.cols, sy = Math.floor(i / SECTIONS.cols);
    return { change: changeOver(sx * cw, (sx + 1) * cw, sy * ch, (sy + 1) * ch), dx: s.cx - before.sections[i].cx, dy: s.cy - before.sections[i].cy };
  });
  return { sections, whole: { change: changeOver(0, CELLS.cols, 0, CELLS.rows), dx: after.whole.cx - before.whole.cx, dy: after.whole.cy - before.whole.cy } };
}

export type Distance = Record<Feature, number> & { total: number };

/** How far apart two regions are, 0–1 per feature and in total. Motion only when both are given. */
export function distance(a: Region, b: Region, ma?: Motion, mb?: Motion): Distance {
  const hueGap = Math.abs(((a.hue - b.hue + 540) % 360) - 180) / 180;
  const parts: Record<Feature, number | null> = {
    brightness: clamp01(2 * Math.abs(a.lum - b.lum)),
    colour: clamp01((2 * (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b))) / 3),
    // Hue only says something where both are coloured.
    hue: clamp01((hueGap * Math.min(a.chroma, b.chroma)) / 0.3),
    edge: Math.abs(a.edge - b.edge) / Math.max(a.edge, b.edge, 0.02),
    motion: ma && mb ? Math.abs(ma.change - mb.change) / Math.max(ma.change, mb.change, 0.02) : null,
  };
  let total = 0, weight = 0;
  for (const [k, w] of Object.entries(FEATURE_WEIGHTS) as [Feature, number][]) {
    const v = parts[k];
    if (v === null) continue;
    total += w * v;
    weight += w;
  }
  return { ...(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v ?? 0])) as Record<Feature, number>), total: total / weight };
}

export interface CaptureComparison {
  /** Ours against Butterchurn, per section. */
  ours: Distance[];
  /** The drift floor per section, feature by feature: the furthest of Butterchurn's re-runs against Butterchurn and ours' against ours (before `MIN_FLOOR`). */
  floor: Distance[];
  /** How far ours is beyond the floor, per section, 0–1 (1 at `SCALE` or more). */
  excess: number[];
  whole: { ours: Distance; floor: Distance; excess: number };
  /** The whole frame's palette (how much of each hue): drift moves shapes about but rarely changes it. */
  palette: { ours: number; floor: number; excess: number };
  /** 0–100: 100 when no section is further from Butterchurn than Butterchurn is from itself. */
  score: number;
  /** 0–100 similarity without the floor, ours and the floor's: what the drift looks like. */
  raw: number;
  floorRaw: number;
}

export interface Side {
  picture: Picture;
  motion?: { sections: Motion[]; whole: Motion };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Each feature's furthest re-run: the floor per feature, wherever each re-run drifted most (one re-run can land close by chance). */
const perFeature = (ds: Distance[]): Distance => {
  const out = { ...ds[0] };
  for (const d of ds) for (const k of [...(Object.keys(FEATURE_WEIGHTS) as Feature[]), 'total'] as const) out[k] = Math.max(out[k], d[k]);
  return out;
};

/** The mean of the `n` largest values. */
const meanOfLargest = (xs: number[], n: number) => mean([...xs].sort((a, b) => b - a).slice(0, n));

/**
 * One capture: Butterchurn (`ref`), ours, Butterchurn re-run with other seeds
 * (`drifts`) and ours drawn again perturbed (`oursDrifts`). The floor per
 * section and feature is the furthest of every re-run from its own side, and
 * a section's excess is how far ours goes beyond it, feature by feature. The
 * score counts the worst sections as well as the mean, so a defect in a few
 * sections still costs, and the palette, so a colour gone wrong does.
 */
export function compareCapture(ref: Side, ours: Side, drifts: Side[], oursDrifts: Side[] = []): CaptureComparison {
  const sectionDistances = (from: Side, other: Side) => from.picture.sections.map((s, i) => distance(s, other.picture.sections[i], from.motion?.sections[i], other.motion?.sections[i]));
  const wholeDistance = (from: Side, other: Side) => distance(from.picture.whole, other.picture.whole, from.motion?.whole, other.motion?.whole);
  const o = sectionDistances(ref, ours);
  const each = [...drifts.map((d) => sectionDistances(ref, d)), ...oursDrifts.map((d) => sectionDistances(ours, d))];
  const f = o.map((_, i) => perFeature(each.map((d) => d[i])));
  // Motion only counts from the second capture, as in `distance`.
  const hasMotion = !!(ref.motion && ours.motion);
  const beyond = (d: Distance, fl: Distance) => {
    let sum = 0, weight = 0;
    for (const [k, w] of Object.entries(FEATURE_WEIGHTS) as [Feature, number][]) {
      if (k === 'motion' && !hasMotion) continue;
      sum += w * Math.max(0, d[k] - Math.max(fl[k], MIN_FLOOR));
      weight += w;
    }
    return clamp01(sum / weight / SCALE);
  };
  const excess = o.map((d, i) => beyond(d, f[i]));
  const wo = wholeDistance(ref, ours);
  const wf = perFeature([...drifts.map((d) => wholeDistance(ref, d)), ...oursDrifts.map((d) => wholeDistance(ours, d))]);
  const we = beyond(wo, wf);
  const po = paletteDistance(ref.picture.palette, ours.picture.palette);
  const pf = Math.max(0, ...drifts.map((d) => paletteDistance(ref.picture.palette, d.picture.palette)), ...oursDrifts.map((d) => paletteDistance(ours.picture.palette, d.picture.palette)));
  const pe = clamp01(Math.max(0, po - Math.max(pf, MIN_PALETTE_FLOOR)) / PALETTE_SCALE);
  const round = (v: number) => Math.round(v * 1000) / 10;
  const w = CAPTURE_WEIGHTS;
  return {
    ours: o,
    floor: f,
    excess,
    whole: { ours: wo, floor: wf, excess: we },
    palette: { ours: po, floor: pf, excess: pe },
    score: round(1 - (w.mean * mean(excess) + w.worst * meanOfLargest(excess, WORST_SECTIONS) + w.whole * we + w.palette * pe)),
    raw: round(1 - mean(o.map((d) => d.total))),
    floorRaw: round(1 - mean(f.map((d) => d.total))),
  };
}

/** Early captures weigh most: before rand streams and feedback part, they say the most. */
export const captureWeight = (frame: number) => 1 / (1 + Math.log2(Math.max(1, frame)));

// --- the plain-language line -------------------------------------------------

/** Where a section sits, for the sentence. */
export function regionName(index: number): 'centre' | 'top' | 'bottom' | 'left' | 'right' {
  const x = index % SECTIONS.cols, y = Math.floor(index / SECTIONS.cols);
  if (x >= 2 && x <= 5 && y >= 1 && y <= 2) return 'centre';
  if (y === 0) return 'top';
  if (y === SECTIONS.rows - 1) return 'bottom';
  return x < 2 ? 'left' : 'right';
}

export function hueName(hue: number): string {
  const names: [number, string][] = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'cyan'], [260, 'blue'], [290, 'purple'], [340, 'magenta'], [360, 'red']];
  return names.find(([end]) => hue < end)![1];
}

/** Where a set of sections mostly is: one region when it holds most of them. */
function where(indices: number[]): string {
  const counts = new Map<string, number>();
  for (const i of indices) counts.set(regionName(i), (counts.get(regionName(i)) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / indices.length >= 0.6 ? `the ${top} sections` : `${indices.length} of ${SECTIONS.cols * SECTIONS.rows} sections, across the frame`;
}

export interface CaptureSides {
  weight: number;
  ref: Side;
  ours: Side;
  /** Butterchurn re-run: their distance from `ref` is drift. */
  drifts: Side[];
  /** Ours drawn again perturbed: their distance from `ours` is drift too. */
  oursDrifts?: Side[];
}

/** One clause of the plain-language line, by feature. */
export interface Clause {
  feature: 'brightness' | 'edges' | 'colour' | 'motion';
  text: string;
  differs: boolean;
}

/**
 * A short line on how ours differs from Butterchurn, only where the gap is
 * clearly beyond the drift floor; features that agree are said to match.
 * Gaps are weighted over captures the same way the score is.
 */
export const describe = (captures: CaptureSides[]): string => clauses(captures).map((c) => c.text).join('; ');

/** The plain-language line's clauses, one per feature. */
export function clauses(captures: CaptureSides[]): Clause[] {
  const total = captures.reduce((s, c) => s + c.weight, 0) || 1;
  const n = SECTIONS.cols * SECTIONS.rows;
  // Signed gap beyond the floor: how much further ours is than the re-runs drift, in ours' direction.
  const gap = (value: (side: Side, i: number) => number | null, relative: boolean) => {
    const out = new Array<number>(n).fill(0);
    for (const c of captures) {
      for (let i = 0; i < n; i++) {
        const a = value(c.ref, i), o = value(c.ours, i), fs = c.drifts.map((d) => value(d, i)), os = (c.oursDrifts ?? []).map((d) => value(d, i));
        if (a === null || o === null || fs.some((f) => f === null) || os.some((f) => f === null)) continue;
        const scale = relative ? Math.max(Math.abs(a), Math.abs(o), ...fs.map((f) => Math.abs(f!)), ...os.map((f) => Math.abs(f!)), 0.02) : 1;
        const d = (o - a) / scale, fl = Math.max(...fs.map((f) => Math.abs(f! - a)), ...os.map((f) => Math.abs(f! - o))) / scale;
        out[i] += (c.weight / total) * Math.sign(d) * Math.max(0, Math.abs(d) - fl);
      }
    }
    return out;
  };
  const said: Clause[] = [];
  const twoWay = (feature: Clause['feature'], gaps: number[], threshold: number, more: string, less: string, matches: string) => {
    const up = gaps.flatMap((g, i) => (g > threshold ? [i] : []));
    const down = gaps.flatMap((g, i) => (g < -threshold ? [i] : []));
    const parts: string[] = [];
    // Two sections or more: a single one is too easily one shape out of place.
    if (up.length >= 2) parts.push(`ours ${more} in ${where(up)}`);
    if (down.length >= 2) parts.push(`ours ${less} in ${where(down)}`);
    said.push({ feature, text: parts.length ? parts.join(', ') : matches, differs: parts.length > 0 });
  };
  twoWay('brightness', gap((s, i) => s.picture.sections[i].lum, false), 0.05, 'brighter', 'darker', 'brightness matches');
  twoWay('edges', gap((s, i) => s.picture.sections[i].edge, true), 0.3, 'more textured', 'smoother', 'edges match');
  // Hue: the whole frame's dominant hue, chroma-weighted over sections.
  const dominant = (side: Side) => {
    let x = 0, y = 0, c = 0;
    for (const s of side.picture.sections) {
      x += s.chroma * Math.cos((s.hue * Math.PI) / 180);
      y += s.chroma * Math.sin((s.hue * Math.PI) / 180);
      c += s.chroma;
    }
    return { hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, chroma: c / side.picture.sections.length };
  };
  const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  let hueOff = 0, chromaOff = 0, paletteOff = 0;
  // The capture whose hue is furthest beyond the floor, to name the hues from.
  let worstHue: { gap: number; ours: number; ref: number; palettes: { ours: Float32Array; ref: Float32Array } } = { gap: -1, ours: 0, ref: 0, palettes: { ours: new Float32Array(0), ref: new Float32Array(0) } };
  for (const c of captures) {
    const a = dominant(c.ref), o = dominant(c.ours), fs = c.drifts.map(dominant), os = (c.oursDrifts ?? []).map(dominant);
    const w = c.weight / total;
    const hueFloor = Math.max(0, ...fs.map((f) => (f.chroma > 0.06 ? hueGap(a.hue, f.hue) : 0)), ...os.map((f) => (f.chroma > 0.06 ? hueGap(o.hue, f.hue) : 0)));
    const beyond = Math.min(a.chroma, o.chroma) > 0.06 ? Math.max(0, hueGap(a.hue, o.hue) - hueFloor) : 0;
    // The palette says it too when the frame holds several hues and only some changed.
    const pf = Math.max(MIN_PALETTE_FLOOR, ...c.drifts.map((d) => paletteDistance(c.ref.picture.palette, d.picture.palette)), ...(c.oursDrifts ?? []).map((d) => paletteDistance(c.ours.picture.palette, d.picture.palette)));
    const paletteBeyond = Math.max(0, paletteDistance(c.ref.picture.palette, c.ours.picture.palette) - pf) / PALETTE_SCALE;
    hueOff += w * beyond;
    paletteOff += w * paletteBeyond;
    const rank = beyond + 40 * paletteBeyond;
    if (rank > worstHue.gap) worstHue = { gap: rank, ours: o.hue, ref: a.hue, palettes: { ours: c.ours.picture.palette, ref: c.ref.picture.palette } };
    const chromaFloor = Math.max(...fs.map((f) => Math.abs(f.chroma - a.chroma)), ...os.map((f) => Math.abs(f.chroma - o.chroma)));
    chromaOff += w * Math.sign(o.chroma - a.chroma) * Math.max(0, Math.abs(o.chroma - a.chroma) - chromaFloor);
  }
  const colour: string[] = [];
  // Hue is a circle: a gap of 25° beyond the floor reads as another colour
  // (pink against red), as does a palette half its scale beyond its floor.
  if (hueOff > 25 || paletteOff > 0.5) {
    const [ours, ref] = [hueName(worstHue.ours), hueName(worstHue.ref)];
    if (ours !== ref) colour.push(`hue differs (ours ${ours}, Butterchurn ${ref})`);
    else {
      // The same dominant hue, a different mix: name the hue ours has most more of, and most less.
      const gain = Array.from(worstHue.palettes.ours, (v, i) => v - worstHue.palettes.ref[i]);
      const more = gain.indexOf(Math.max(...gain)), less = gain.indexOf(Math.min(...gain));
      const name = (bin: number) => hueName(((bin + 0.5) * 360) / gain.length);
      colour.push(name(more) === name(less) ? `colours differ (ours mostly ${ours} too)` : `colours differ (ours more ${name(more)}, less ${name(less)})`);
    }
  }
  if (Math.abs(chromaOff) > 0.06) colour.push(chromaOff > 0 ? 'ours more colourful' : 'ours less colourful');
  said.push({ feature: 'colour', text: colour.length ? colour.join(', ') : 'hue matches', differs: colour.length > 0 });
  // Motion: frozen or runaway first, else where it moves more or less.
  const moving = captures.filter((c) => c.ref.motion && c.ours.motion && c.drifts.every((d) => d.motion));
  if (moving.length) {
    const avg = (pick: (c: CaptureSides) => number) => mean(moving.map(pick));
    const a = avg((c) => c.ref.motion!.whole.change), o = avg((c) => c.ours.motion!.whole.change);
    const f = avg((c) => Math.max(...c.drifts.map((d) => d.motion!.whole.change)));
    if (a > 0.02 && o < 0.1 * a && Math.abs(f - a) < 0.5 * a) said.push({ feature: 'motion', text: 'ours looks frozen where Butterchurn moves', differs: true });
    else if (o > 3 * Math.max(a, f) + 0.02) said.push({ feature: 'motion', text: 'ours changes far more than Butterchurn (runaway?)', differs: true });
    else twoWay('motion', gap((s, i) => s.motion?.sections[i].change ?? null, true), 0.35, 'moves more', 'moves less', 'motion matches');
  }
  return said;
}

// --- a whole run ---------------------------------------------------------------

/** A picture of its own size: RGBA rows, top to bottom. */
export interface Image {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface Captured {
  frame: number;
  /** RGBA rows, top to bottom, at the run's size: Butterchurn, the candidate (ours), and Butterchurn re-run with other seeds. */
  ref: Uint8Array;
  ours: Uint8Array;
  drifts: Uint8Array[];
  /** The candidate drawn again perturbed (another seed, a slightly larger size): how far it drifts from itself. */
  oursDrifts?: Image[];
}

type SideName = 'ref' | 'ours' | 'drift';

export interface RunComparison {
  /** 0–100: how far ours stays within the drift floor; the captures' early-first weighted mean, pulled towards the worst capture. */
  score: number;
  raw: number;
  floorRaw: number;
  /** True when Butterchurn drifts so far from itself that nothing can be concluded. */
  notComparable: boolean;
  sentence: string;
  /** `sides.drift` is the first re-run. */
  captures: (CaptureComparison & { frame: number; weight: number; sides: Record<SideName, { region: Region; motion: Motion | null }> })[];
}

/** Below this weighted floor similarity, Butterchurn's own drift swamps any difference. */
export const COMPARABLE_FLOOR = 80;

/** Every capture of one preset, compared section by section against the drift floor. */
export function compareRun(captured: Captured[], width: number, height: number): RunComparison {
  const ordered = [...captured].sort((a, b) => a.frame - b.frame);
  const prev = new Map<string, Picture>();
  const all: CaptureSides[] = [];
  const captures: RunComparison['captures'] = [];
  const sideOf = (key: string, image: Image): Side => {
    const picture = pictureOf(image.rgba, image.width, image.height);
    const before = prev.get(key);
    prev.set(key, picture);
    return { picture, motion: before ? motionOf(before, picture) : undefined };
  };
  const sized = (rgba: Uint8Array): Image => ({ rgba, width, height });
  for (const c of ordered) {
    const ref = sideOf('ref', sized(c.ref)), ours = sideOf('ours', sized(c.ours));
    const drifts = c.drifts.map((d, i) => sideOf(`drift${i}`, sized(d)));
    const oursDrifts = (c.oursDrifts ?? []).map((d, i) => sideOf(`self${i}`, d));
    const weight = captureWeight(c.frame);
    all.push({ weight, ref, ours, drifts, oursDrifts });
    const side = (s: Side) => ({ region: s.picture.whole, motion: s.motion?.whole ?? null });
    captures.push({ frame: c.frame, weight, ...compareCapture(ref, ours, drifts, oursDrifts), sides: { ref: side(ref), ours: side(ours), drift: side(drifts[0]) } });
  }
  const total = captures.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = (pick: (c: (typeof captures)[number]) => number) => captures.reduce((s, c) => s + c.weight * pick(c), 0) / total;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const floorRaw = round1(weighted((c) => c.floorRaw));
  const notComparable = floorRaw < COMPARABLE_FLOOR;
  // The worst capture pulls the score towards it: a preset clearly wrong from
  // frame 50 on is wrong, however well its first second matched.
  const worst = captures.reduce((a, b) => (b.score < a.score ? b : a));
  const average = weighted((c) => c.score);
  const score = round1(average - WORST_CAPTURE * (average - worst.score));
  let sentence = notComparable ? `not comparable: random/chaotic (Butterchurn re-seeded is only ${floorRaw} similar to itself)` : describe(all);
  if (!notComparable && worst.score < 70) {
    // The run's line averages over captures; a clearly-off capture gets its own
    // clause, and the run never claims a feature matches that capture shows differs.
    const at = clauses([{ ...all[captures.indexOf(worst)], weight: 1 }]);
    const run = clauses(all).filter((c) => c.differs || !at.some((a) => a.differs && a.feature === c.feature));
    // Only what the run's own clauses don't already say.
    const differs = at.filter((c) => c.differs && !run.some((r) => r.differs && r.feature === c.feature)).map((c) => c.text);
    const sections = worst.excess.flatMap((e, i) => (e >= 0.5 ? [i] : []));
    const where_ = sections.length ? `, mostly ${where(sections)}` : '';
    const off = captures.filter((c) => c.score < 70).length;
    sentence = [
      ...run.map((c) => c.text),
      `worst at frame ${worst.frame} (${worst.score}${where_}${off > 1 ? `; ${off} of ${captures.length} captures under 70` : ''})${differs.length ? `: ${differs.join(', ')}` : run.some((c) => c.differs) ? '' : ': differs beyond the floor'}`,
    ].join('; ');
  }
  return { score, raw: round1(weighted((c) => c.raw)), floorRaw, notComparable, sentence, captures };
}
