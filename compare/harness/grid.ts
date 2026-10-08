// How the bench compares two pictures: never pixel by pixel. Each picture is
// reduced to a coarse pyramid — a 32×16 grid of cells, an 8×4 grid of sections
// (4×4 cells each) and one whole-frame summary — and every claim is made at the
// section level: mean colour and brightness, dominant hue, edge/texture energy,
// and how much and which way the section moved since the previous capture.
//
// A difference only counts beyond the drift floor: the same section's distance
// between Butterchurn and Butterchurn re-run with another random seed. MilkDrop
// presets drift apart by nature (rand streams, chaotic feedback), so the floor
// is what "different" has to beat.

export const CELLS = { cols: 32, rows: 16 } as const;
export const SECTIONS = { cols: 8, rows: 4 } as const;
/** The resolution edge/texture energy is measured at: coarse enough to ignore pixel noise. */
const TEXTURE = { cols: 128, rows: 64 } as const;
/** Distance beyond the floor at which a section counts as fully different. */
export const SCALE = 0.25;
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
  return { sections, whole: regionOver(0, CELLS.cols, 0, CELLS.rows), cells };
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
  /** Butterchurn re-seeded against Butterchurn, per section: the drift floor. */
  floor: Distance[];
  /** How far ours is beyond the floor, per section, 0–1 (1 at `SCALE` or more). */
  excess: number[];
  whole: { ours: Distance; floor: Distance; excess: number };
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

/** One capture: Butterchurn (`ref`), ours, and Butterchurn re-seeded (`drift`). */
export function compareCapture(ref: Side, ours: Side, drift: Side): CaptureComparison {
  const sectionDistances = (other: Side) => ref.picture.sections.map((s, i) => distance(s, other.picture.sections[i], ref.motion?.sections[i], other.motion?.sections[i]));
  const o = sectionDistances(ours), f = sectionDistances(drift);
  const beyond = (d: Distance, fl: Distance) => clamp01(Math.max(0, d.total - fl.total) / SCALE);
  const excess = o.map((d, i) => beyond(d, f[i]));
  const wo = distance(ref.picture.whole, ours.picture.whole, ref.motion?.whole, ours.motion?.whole);
  const wf = distance(ref.picture.whole, drift.picture.whole, ref.motion?.whole, drift.motion?.whole);
  const we = beyond(wo, wf);
  const round = (v: number) => Math.round(v * 1000) / 10;
  return {
    ours: o,
    floor: f,
    excess,
    whole: { ours: wo, floor: wf, excess: we },
    score: round(1 - (0.8 * mean(excess) + 0.2 * we)),
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
  drift: Side;
}

/**
 * A short line on how ours differs from Butterchurn, only where the gap is
 * clearly beyond the drift floor; features that agree are said to match.
 * Gaps are weighted over captures the same way the score is.
 */
export function describe(captures: CaptureSides[]): string {
  const total = captures.reduce((s, c) => s + c.weight, 0) || 1;
  const n = SECTIONS.cols * SECTIONS.rows;
  // Signed gap beyond the floor: how much further ours is than the re-seeded run, in ours' direction.
  const gap = (value: (side: Side, i: number) => number | null, relative: boolean) => {
    const out = new Array<number>(n).fill(0);
    for (const c of captures) {
      for (let i = 0; i < n; i++) {
        const a = value(c.ref, i), o = value(c.ours, i), f = value(c.drift, i);
        if (a === null || o === null || f === null) continue;
        const scale = relative ? Math.max(Math.abs(a), Math.abs(o), Math.abs(f), 0.02) : 1;
        const d = (o - a) / scale, fl = Math.abs(f - a) / scale;
        out[i] += (c.weight / total) * Math.sign(d) * Math.max(0, Math.abs(d) - fl);
      }
    }
    return out;
  };
  const said: string[] = [];
  const twoWay = (gaps: number[], threshold: number, more: string, less: string, matches: string) => {
    const up = gaps.flatMap((g, i) => (g > threshold ? [i] : []));
    const down = gaps.flatMap((g, i) => (g < -threshold ? [i] : []));
    const parts: string[] = [];
    // Two sections or more: a single one is too easily one shape out of place.
    if (up.length >= 2) parts.push(`ours ${more} in ${where(up)}`);
    if (down.length >= 2) parts.push(`ours ${less} in ${where(down)}`);
    said.push(parts.length ? parts.join(', ') : matches);
  };
  twoWay(gap((s, i) => s.picture.sections[i].lum, false), 0.05, 'brighter', 'darker', 'brightness matches');
  twoWay(gap((s, i) => s.picture.sections[i].edge, true), 0.3, 'more textured', 'smoother', 'edges match');
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
  let hueOff = 0, chromaOff = 0;
  const last = { ours: 0, ref: 0 };
  for (const c of captures) {
    const a = dominant(c.ref), o = dominant(c.ours), f = dominant(c.drift);
    const w = c.weight / total;
    if (Math.min(a.chroma, o.chroma) > 0.06) hueOff += w * Math.max(0, hueGap(a.hue, o.hue) - (f.chroma > 0.06 ? hueGap(a.hue, f.hue) : 0));
    chromaOff += w * Math.sign(o.chroma - a.chroma) * Math.max(0, Math.abs(o.chroma - a.chroma) - Math.abs(f.chroma - a.chroma));
    if (w > 0) [last.ours, last.ref] = [o.hue, a.hue];
  }
  const colour: string[] = [];
  if (hueOff > 35) colour.push(`hue differs (ours ${hueName(last.ours)}, Butterchurn ${hueName(last.ref)})`);
  if (Math.abs(chromaOff) > 0.06) colour.push(chromaOff > 0 ? 'ours more colourful' : 'ours less colourful');
  said.push(colour.length ? colour.join(', ') : 'hue matches');
  // Motion: frozen or runaway first, else where it moves more or less.
  const moving = captures.filter((c) => c.ref.motion && c.ours.motion && c.drift.motion);
  if (moving.length) {
    const avg = (pick: (c: CaptureSides) => number) => mean(moving.map(pick));
    const a = avg((c) => c.ref.motion!.whole.change), o = avg((c) => c.ours.motion!.whole.change), f = avg((c) => c.drift.motion!.whole.change);
    if (a > 0.02 && o < 0.1 * a && Math.abs(f - a) < 0.5 * a) said.push('ours looks frozen where Butterchurn moves');
    else if (o > 3 * Math.max(a, f) + 0.02) said.push('ours changes far more than Butterchurn (runaway?)');
    else twoWay(gap((s, i) => s.motion?.sections[i].change ?? null, true), 0.35, 'moves more', 'moves less', 'motion matches');
  }
  return said.join('; ');
}

// --- a whole run ---------------------------------------------------------------

export interface Captured {
  frame: number;
  /** RGBA rows, top to bottom: Butterchurn, the candidate (ours), Butterchurn re-seeded. */
  ref: Uint8Array;
  ours: Uint8Array;
  drift: Uint8Array;
}

export interface RunComparison {
  /** 0–100, captures weighted early-first: how far ours stays within Butterchurn's own drift. */
  score: number;
  raw: number;
  floorRaw: number;
  /** True when Butterchurn drifts so far from itself that nothing can be concluded. */
  notComparable: boolean;
  sentence: string;
  captures: (CaptureComparison & { frame: number; weight: number; sides: Record<'ref' | 'ours' | 'drift', { region: Region; motion: Motion | null }> })[];
}

/** Below this weighted floor similarity, Butterchurn's own drift swamps any difference. */
export const COMPARABLE_FLOOR = 70;

/** Every capture of one preset, compared section by section against the drift floor. */
export function compareRun(captured: Captured[], width: number, height: number): RunComparison {
  const ordered = [...captured].sort((a, b) => a.frame - b.frame);
  const prev: Partial<Record<'ref' | 'ours' | 'drift', Picture>> = {};
  const all: CaptureSides[] = [];
  const captures: RunComparison['captures'] = [];
  for (const c of ordered) {
    const sides = {} as Record<'ref' | 'ours' | 'drift', Side>;
    for (const k of ['ref', 'ours', 'drift'] as const) {
      const picture = pictureOf(c[k], width, height);
      sides[k] = { picture, motion: prev[k] ? motionOf(prev[k]!, picture) : undefined };
      prev[k] = picture;
    }
    const weight = captureWeight(c.frame);
    all.push({ weight, ...sides });
    const side = (s: Side) => ({ region: s.picture.whole, motion: s.motion?.whole ?? null });
    captures.push({ frame: c.frame, weight, ...compareCapture(sides.ref, sides.ours, sides.drift), sides: { ref: side(sides.ref), ours: side(sides.ours), drift: side(sides.drift) } });
  }
  const total = captures.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = (pick: (c: (typeof captures)[number]) => number) => Math.round((captures.reduce((s, c) => s + c.weight * pick(c), 0) / total) * 10) / 10;
  const floorRaw = weighted((c) => c.floorRaw);
  const notComparable = floorRaw < COMPARABLE_FLOOR;
  return {
    score: weighted((c) => c.score),
    raw: weighted((c) => c.raw),
    floorRaw,
    notComparable,
    sentence: notComparable ? `not comparable: random/chaotic (Butterchurn re-seeded is only ${floorRaw} similar to itself)` : describe(all),
    captures,
  };
}
