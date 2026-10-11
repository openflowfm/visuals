import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { clipFile } from './features.ts';
import { makeFixture } from './fixture.ts';
import { frameSheet, pickFrames, sheetLayout, sheetSize } from './frames.ts';

describe('frame picking', () => {
  it('spreads frames evenly, first and last included', () => {
    expect(pickFrames(24, 8)).toEqual([0, 3, 7, 10, 13, 16, 20, 23]);
    expect(pickFrames(5, 8)).toEqual([0, 1, 2, 3, 4]);
    expect(pickFrames(24, 1)).toEqual([11]);
    expect(pickFrames(0, 8)).toEqual([]);
  });

  it('lays 8 frames out 4×2 with a gutter around and between', () => {
    expect(sheetLayout([192, 144], 8)).toEqual({ cols: 4, rows: 2, width: 4 * 192 + 5 * 4, height: 2 * 144 + 3 * 4 });
    expect(sheetLayout([192, 144], 3)).toEqual({ cols: 3, rows: 1, width: 3 * 192 + 4 * 4, height: 144 + 2 * 4 });
  });
});

describe('frame sheet', () => {
  it('builds a 4×2 sheet at the clip size from a fixture clip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tags-frames-'));
    const f = await makeFixture(dir, { n: 2 });
    const sheet = await frameSheet(clipFile(dir, f.features.rows[0]), f.features.clip);
    expect(sheet.frames).toEqual(pickFrames(24, 8));
    expect(sheet.mediaType).toBe('image/jpeg');
    expect({ width: sheet.width, height: sheet.height }).toEqual(sheetSize(f.features.clip));
    const meta = await sharp(sheet.data).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([788, 300, 'jpeg']);
    const png = await frameSheet(clipFile(dir, f.features.rows[1]), f.features.clip, { format: 'png' });
    expect((await sharp(png.data).metadata()).format).toBe('png');
  });

  it('refuses a sprite smaller than the clip description', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tags-frames-'));
    const f = await makeFixture(dir, { n: 1 });
    await expect(frameSheet(clipFile(dir, f.features.rows[0]), { ...f.features.clip, frames: 48 })).rejects.toThrow(/expected 48 frames/);
  });
});
