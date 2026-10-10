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

/** The symbols whose names start with any of the prefixes. */
export function select(symbols: KitSymbol[], prefixes: string[]): KitSymbol[] {
  return symbols.filter((s) => prefixes.some((p) => s.name.startsWith(p)));
}

/** Where sketchtool writes a symbol: its name as folders, `@Nx` for scales other than 1. */
export function exportedFile(name: string, scale: number): string {
  return `${name}${scale === 1 ? '' : `@${scale}x`}.png`;
}

/** The window background a symbol sits on, from the appearance in its name. */
export function backgroundFor(name: string): string {
  return /\/Dark\//.test(name) ? '#1e1e1e' : '#ffffff';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * A page laying out the exports, grouped by the symbol's folder, each on its
 * appearance's window background and shown at its size in points.
 */
export function sheetHtml(symbols: KitSymbol[], scale: number): string {
  const groups = new Map<string, KitSymbol[]>();
  for (const s of symbols) {
    const folder = s.name.slice(0, s.name.lastIndexOf('/'));
    groups.set(folder, [...(groups.get(folder) ?? []), s]);
  }
  const body = [...groups]
    .map(([folder, list]) => {
      const figures = list
        .map((s) => {
          const src = exportedFile(s.name, scale).split('/').map(encodeURIComponent).join('/');
          return `<figure style="background:${backgroundFor(s.name)}"><img src="${esc(src)}"><figcaption>${esc(s.name.slice(folder.length + 1))}</figcaption></figure>`;
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
img{display:block;zoom:${1 / scale}}
</style>${body}`;
}
