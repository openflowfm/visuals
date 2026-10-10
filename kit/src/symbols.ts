// The kit's symbols by name, read from the Sketch document's own JSON (a
// `.sketch` is a zip of `document.json`, `pages/*.json` and the rest), and the
// contact sheet of what sketchtool exported.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type KitSymbol = { id: string; name: string };

type Layer = { _class: string; do_objectID: string; name: string };

function mastersOf(pageJson: string): KitSymbol[] {
  const page = JSON.parse(pageJson) as { layers?: Layer[] };
  return (page.layers ?? []).filter((l) => l._class === 'symbolMaster').map((l) => ({ id: l.do_objectID, name: l.name }));
}

/** Every symbol master in an unpacked kit folder or a `.sketch` file, sorted by name. */
export function readSymbols(doc: string): KitSymbol[] {
  let found: KitSymbol[];
  if (statSync(doc).isDirectory()) {
    const pages = join(doc, 'pages');
    found = readdirSync(pages)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => mastersOf(readFileSync(join(pages, f), 'utf8')));
  } else {
    const entries = execFileSync('unzip', ['-Z1', doc], { encoding: 'utf8' })
      .split('\n')
      .filter((e) => /^pages\/[^/]+\.json$/.test(e));
    found = entries.flatMap((e) => mastersOf(execFileSync('unzip', ['-p', doc, e], { encoding: 'utf8', maxBuffer: 1 << 30 })));
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** `document.json` (shared swatches, text and layer styles) from an unpacked kit folder or a `.sketch` file. */
export function readDocument(doc: string): unknown {
  const json = statSync(doc).isDirectory() ? readFileSync(join(doc, 'document.json'), 'utf8') : execFileSync('unzip', ['-p', doc, 'document.json'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  return JSON.parse(json);
}

/** The symbols whose names start with any of the prefixes. */
export function select(symbols: KitSymbol[], prefixes: string[]): KitSymbol[] {
  return symbols.filter((s) => prefixes.some((p) => s.name.startsWith(p)));
}

export type Format = 'png' | 'svg';

/**
 * Where sketchtool writes a symbol: its name as folders, `@Nx` for scales
 * other than 1. SVGs are exported at scale 1, so they never carry it.
 */
export function exportedFile(name: string, format: Format, scale: number): string {
  const s = format === 'svg' ? 1 : scale;
  return `${name}${s === 1 ? '' : `@${s}x`}.${format}`;
}

/** The window background a symbol sits on, from the appearance in its name. */
export function backgroundFor(name: string): string {
  return /\/Dark\//.test(name) ? '#1e1e1e' : '#ffffff';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** One picture on the sheet: the symbol, its file under DIR, and the zoom that shows it at its size in points. */
export type SheetItem = { name: string; file: string; zoom: number };

/**
 * A page laying out the exports, grouped by the symbol's folder, each on its
 * appearance's window background and shown at its size in points.
 */
export function sheetHtml(items: SheetItem[]): string {
  const groups = new Map<string, SheetItem[]>();
  for (const s of items) {
    const folder = s.name.slice(0, s.name.lastIndexOf('/'));
    groups.set(folder, [...(groups.get(folder) ?? []), s]);
  }
  const body = [...groups]
    .map(([folder, list]) => {
      const figures = list
        .map((s) => {
          const src = s.file.split('/').map(encodeURIComponent).join('/');
          const zoom = s.zoom === 1 ? '' : ` style="zoom:${s.zoom}"`;
          return `<figure style="background:${backgroundFor(s.name)}"><img src="${esc(src)}"${zoom}><figcaption>${esc(s.name.slice(folder.length + 1))}</figcaption></figure>`;
        })
        .join('');
      return `<h2>${esc(folder)}</h2><div class="row">${figures}</div>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Kit sheet</title><style>
body{margin:0;padding:24px;background:#888;font:12px/1.3 system-ui,sans-serif;color:#111}
h2{font-size:13px;margin:20px 0 8px}h2:first-of-type{margin-top:0}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
figure{margin:0;padding:8px;border-radius:6px}
figcaption{margin-top:4px;max-width:220px;color:#888}
img{display:block}
</style>${body}`;
}
