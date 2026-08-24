import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { byteRange, listMedia, resolveMedia } from './media.ts';

const made: string[] = [];
const temporary = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-media-'));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('media library', () => {
  it('lists supported videos recursively and ignores unrelated files and symlinks', () => {
    const root = temporary();
    fs.mkdirSync(path.join(root, 'loops'));
    fs.writeFileSync(path.join(root, 'front.mp4'), 'front');
    fs.writeFileSync(path.join(root, 'loops', 'cloud.webm'), 'cloud');
    fs.writeFileSync(path.join(root, 'still.png'), 'still');
    fs.writeFileSync(path.join(root, 'poster.JPEG'), 'poster');
    fs.writeFileSync(path.join(root, 'animated.gif'), 'no');
    fs.writeFileSync(path.join(root, 'vector.svg'), 'no');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'no');
    fs.symlinkSync(path.join(root, 'front.mp4'), path.join(root, 'linked.mov'));
    expect(listMedia(root).map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'front.mp4', type: 'video' },
      { id: 'loops/cloud.webm', type: 'video' },
      { id: 'poster.JPEG', type: 'image' },
      { id: 'still.png', type: 'image' },
    ]);
  });

  it('keeps every resolved asset inside the root', () => {
    const root = temporary();
    fs.writeFileSync(path.join(root, 'okay.mp4'), 'okay');
    expect(resolveMedia(root, 'okay.mp4')).toBe(path.join(root, 'okay.mp4'));
    expect(resolveMedia(root, '../okay.mp4')).toBeNull();
    expect(resolveMedia(root, '/etc/passwd')).toBeNull();
    expect(resolveMedia(root, 'notes.txt')).toBeNull();
    expect(resolveMedia(root, 'vector.svg')).toBeNull();
    expect(resolveMedia(root, 'missing.mp4')).toBeNull();
  });

  it('refuses a path whose parent symlink escapes the root', () => {
    const root = temporary();
    const outside = temporary();
    fs.writeFileSync(path.join(outside, 'escaped.mp4'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'elsewhere'));
    expect(resolveMedia(root, 'elsewhere/escaped.mp4')).toBeNull();
  });
});

describe('HTTP byte ranges', () => {
  it('parses open, closed, and suffix ranges', () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(byteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-12', 100)).toEqual({ start: 88, end: 99 });
  });

  it('refuses malformed, multiple, and unsatisfiable ranges', () => {
    expect(byteRange('items=0-2', 100)).toBe('invalid');
    expect(byteRange('bytes=0-1,4-5', 100)).toBe('invalid');
    expect(byteRange('bytes=100-', 100)).toBe('invalid');
    expect(byteRange('bytes=9-2', 100)).toBe('invalid');
  });
});
