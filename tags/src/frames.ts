// A frame sheet from a preset's clip, for Claude to look at: the clip is a
// horizontal WebP sprite of `clip.frames` frames of `clip.size`; a few evenly
// spaced frames are laid out in a grid (4×2 by default, at the clip's size,
// with a thin dark gutter), read left to right, then top to bottom.

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { Features } from './features.ts';

export type Clip = Features['clip'];

export interface SheetOptions {
  /** How many frames to show (8). */
  count?: number;
  /** Columns in the grid (4). */
  cols?: number;
  /** Pixels between frames and around the edge (4). */
  gutter?: number;
  /** `jpeg` (default, smaller) or `png`. */
  format?: 'jpeg' | 'png';
  /** JPEG quality (90). */
  quality?: number;
}

export interface Sheet {
  data: Buffer;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  /** The clip's frame indices shown, in order. */
  frames: number[];
}

const GUTTER_COLOUR = { r: 12, g: 12, b: 14 };

/** `count` frame indices spread evenly over `total`, first and last included; all of them when there are fewer. */
export function pickFrames(total: number, count: number): number[] {
  if (!(total > 0)) return [];
  if (count >= total) return [...Array(total).keys()];
  if (count <= 1) return [Math.floor((total - 1) / 2)];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i * (total - 1)) / (count - 1)));
  return out;
}

/** The grid's columns, rows and pixel size for `count` frames of `size`. */
export function sheetLayout(size: [number, number], count: number, cols = 4, gutter = 4): { cols: number; rows: number; width: number; height: number } {
  const c = Math.max(1, Math.min(cols, count));
  const r = Math.max(1, Math.ceil(count / c));
  return { cols: c, rows: r, width: c * size[0] + (c + 1) * gutter, height: r * size[1] + (r + 1) * gutter };
}

/** The sheet's pixel size for a features file's clip, without reading any clip. */
export function sheetSize(clip: Clip, opts: SheetOptions = {}): { width: number; height: number } {
  const count = pickFrames(clip.frames, opts.count ?? 8).length;
  const l = sheetLayout(clip.size, count, opts.cols ?? 4, opts.gutter ?? 4);
  return { width: l.width, height: l.height };
}

/** Builds the sheet from a clip file (or its bytes). Throws when the sprite is smaller than the clip description says. */
export async function frameSheet(clipFile: string | Buffer, clip: Clip, opts: SheetOptions = {}): Promise<Sheet> {
  const src = typeof clipFile === 'string' ? readFileSync(clipFile) : clipFile;
  const [w, h] = clip.size;
  const meta = await sharp(src).metadata();
  if ((meta.width ?? 0) < w * clip.frames || (meta.height ?? 0) < h) {
    throw new Error(`clip is ${meta.width}×${meta.height}, expected ${clip.frames} frames of ${w}×${h} side by side`);
  }
  const frames = pickFrames(clip.frames, opts.count ?? 8);
  const gutter = opts.gutter ?? 4;
  const layout = sheetLayout(clip.size, frames.length, opts.cols ?? 4, gutter);
  const tiles = await Promise.all(
    frames.map(async (f, i) => ({
      input: await sharp(src)
        .extract({ left: f * w, top: 0, width: w, height: h })
        .removeAlpha()
        .png()
        .toBuffer(),
      left: gutter + (i % layout.cols) * (w + gutter),
      top: gutter + Math.floor(i / layout.cols) * (h + gutter),
    })),
  );
  const canvas = sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: GUTTER_COLOUR } }).composite(tiles);
  const format = opts.format ?? 'jpeg';
  const data = format === 'png' ? await canvas.png().toBuffer() : await canvas.jpeg({ quality: opts.quality ?? 90 }).toBuffer();
  return { data, mediaType: format === 'png' ? 'image/png' : 'image/jpeg', width: layout.width, height: layout.height, frames };
}
