// `npm run render -- <kit folder> <symbol name prefixes…> [--out DIR] [--scale N] [--pad N] [--background auto|none|#rrggbb]`
//
// Draws the kit's symbols whose names start with any of the prefixes (Sketch
// names are paths: `Toggles - Switches/Light/Content Area/3 Rg/…`) into PNGs
// under DIR, one folder per path segment. Each sits on its appearance's
// window background unless `--background` says otherwise. What the renderer
// could not draw exactly is listed per message, with how many symbols hit it.
// Exit 0 when every symbol drew, 1 when one failed or nothing matched, 2 on a
// usage error.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright';
import { backgroundFor, buildScene, loadKit, type Color } from './scene.ts';

function usage(msg: string): never {
  console.error(`render: ${msg}`);
  console.error('usage: npm run render -- <kit folder> <symbol name prefixes…> [--out DIR] [--scale N] [--pad N] [--background auto|none|#rrggbb]');
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const opts = { out: 'out', scale: 2, pad: 0, background: 'auto' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? usage(`${a} needs a value`);
    if (a === '--out') opts.out = value();
    else if (a === '--scale') opts.scale = Number(value());
    else if (a === '--pad') opts.pad = Number(value());
    else if (a === '--background') opts.background = value();
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length < 2) usage('give the kit folder and at least one symbol name prefix');
  if (!(opts.scale > 0)) usage('--scale must be a positive number');
  if (!(opts.pad >= 0)) usage('--pad must be zero or more');
  if (!/^(auto|none|#[0-9a-f]{6})$/i.test(opts.background)) usage('--background is auto, none or #rrggbb');
  return { kitDir: rest[0], prefixes: rest.slice(1), ...opts };
}

function hex(s: string): Color {
  const v = parseInt(s.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

/** A file name for a symbol: its path, with what file systems dislike replaced. */
const fileFor = (name: string) =>
  name
    .split('/')
    .map((s) => s.trim().replace(/[\\:*?"<>|]/g, '_') || '_')
    .join('/') + '.png';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kit = loadKit(resolve(args.kitDir));
  const names = [...kit.byName.keys()].filter((n) => args.prefixes.some((p) => n.startsWith(p))).sort();
  if (names.length === 0) {
    console.error(`render: no symbol starts with ${args.prefixes.map((p) => `"${p}"`).join(' or ')}`);
    process.exit(1);
  }

  const here = dirname(new URL(import.meta.url).pathname);
  const drawModule = stripTypeScriptTypes(readFileSync(join(here, 'draw.ts'), 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const stop = () => void browser.close().finally(() => process.exit(130));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let failed = 0;
  const warnings = new Map<string, number>();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(`render: page error: ${e.message}`));
    await page.setContent('<!doctype html><meta charset="utf-8">');
    for (const f of kit.fontFiles) {
      await page.evaluate(
        async ({ family, b64, variable }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const face = new FontFace(family, bytes, variable ? { weight: '1 1000' } : {});
          await face.load();
          document.fonts.add(face);
        },
        { family: f.family, b64: readFileSync(f.file).toString('base64'), variable: f.variable },
      );
    }
    await page.addScriptTag({ content: drawModule, type: 'module' });
    await page.waitForFunction(() => 'drawScene' in globalThis);

    for (const name of names) {
      const background = args.background === 'none' ? null : args.background === 'auto' ? backgroundFor(name) : hex(args.background);
      try {
        const scene = buildScene(kit, kit.byName.get(name)!, background);
        for (const w of scene.warnings) {
          // Messages end with where they happened, in brackets; count by message.
          const key = w.slice(0, w.lastIndexOf(' ('));
          warnings.set(key, (warnings.get(key) ?? 0) + 1);
        }
        const url = await page.evaluate(({ scene, scale, pad }) => (globalThis as unknown as { drawScene: (s: unknown, a: number, b: number) => Promise<string> }).drawScene(scene, scale, pad), {
          scene,
          scale: args.scale,
          pad: args.pad,
        });
        const file = join(args.out, fileFor(name));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      } catch (e) {
        failed++;
        console.error(`render: ${name}: ${(e as Error).message}`);
      }
    }

    // A contact sheet of everything drawn, grouped by the symbol's folder.
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const folder = name.slice(0, name.lastIndexOf('/'));
      groups.set(folder, [...(groups.get(folder) ?? []), name]);
    }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const html = `<!doctype html><meta charset="utf-8"><title>Kit sheet</title><style>
body{margin:0;padding:24px;background:#888;font:12px/1.3 system-ui,sans-serif;color:#111}
h2{font-size:13px;margin:20px 0 8px}h2:first-child{margin-top:0}
.row{display:flex;flex-wrap:wrap;gap:16px 20px;align-items:flex-end}
figure{margin:0}figcaption{margin-top:4px;max-width:200px}
img{display:block;zoom:${1 / args.scale}}
</style>${[...groups]
      .map(
        ([folder, list]) =>
          `<h2>${esc(folder)}</h2><div class="row">${list
            .map((n) => `<figure><img src="${esc(encodeURI(fileFor(n)))}"><figcaption>${esc(n.slice(folder.length + 1))}</figcaption></figure>`)
            .join('')}</div>`,
      )
      .join('')}`;
    const sheet = join(args.out, 'sheet.html');
    writeFileSync(sheet, html);
    // Shown at their size in points, captured at the drawing's scale.
    const view = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: args.scale });
    await view.goto(`file://${resolve(sheet)}`);
    await view.screenshot({ path: join(args.out, 'sheet.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(`${names.length - failed} of ${names.length} symbols drawn into ${args.out}/ at ${args.scale}×`);
  for (const [w, count] of [...warnings].sort((a, b) => b[1] - a[1])) console.log(`  ${count}× ${w}`);
  process.exit(failed ? 1 : 0);
}

await main();
