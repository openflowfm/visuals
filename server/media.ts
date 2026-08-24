import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { MediaAsset } from '../protocol.ts';
import { openflowHome } from './home.ts';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.ogg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS]);
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

export function mediaRoot(): string {
  return process.env.OPENFLOW_VISUALS_MEDIA ?? path.join(openflowHome(), 'visuals', 'media');
}

/** The safe, deterministic library visible to media nodes. Symlinks are never followed. */
export function listMedia(root = mediaRoot()): MediaAsset[] {
  fs.mkdirSync(root, { recursive: true });
  const assets: MediaAsset[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const id = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, id);
      else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const extension = path.extname(entry.name).toLowerCase();
        assets.push({
          id,
          name: entry.name,
          bytes: fs.statSync(file).size,
          type: IMAGE_EXTENSIONS.has(extension) ? 'image' : 'video',
        });
      }
    }
  };
  walk(root);
  return assets.sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve one asset id without allowing absolute paths, traversal, or symlink escape. */
export function resolveMedia(root: string, id: string): string | null {
  if (!id || id.includes('\\') || path.posix.isAbsolute(id)) return null;
  if (!MEDIA_EXTENSIONS.has(path.posix.extname(id).toLowerCase())) return null;
  const parts = id.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  const file = path.join(root, ...parts);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(file);
  } catch {
    return null;
  }
  const relative = path.relative(realRoot, realFile);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' ? file : null;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** One HTTP byte range. Multiple ranges are deliberately refused. */
export function byteRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      return 'invalid';
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/** Serve local media; byte ranges remain available for video decoder seeking. */
export function serveMedia(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  encodedId: string,
): boolean {
  let id: string;
  try {
    id = encodedId
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/');
  } catch {
    return false;
  }
  const file = resolveMedia(root, id);
  if (!file) return false;
  const size = fs.statSync(file).size;
  const range = byteRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' });
    res.end();
    return true;
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string | number> = {
    'accept-ranges': 'bytes',
    'content-type': type,
    'content-length': range ? range.end - range.start + 1 : size,
    'cache-control': 'no-cache',
  };
  if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file, range ?? undefined).pipe(res);
  return true;
}
