// `npm run export -- <kit .sketch or unpacked folder> <symbol name prefixes…> [--out DIR] [--formats png,svg] [--scale N] [--sketchtool PATH]`
//
// Exports the kit's symbols whose names start with any of the prefixes (Sketch
// names are paths: `Toggles - Switches/Light/Content Area/3 Rg/…`), drawn by
// Sketch itself with sketchtool, under DIR in one folder per name segment: a
// PNG at the scale (`<name>@2x.png`) and an SVG (`<name>.svg`). The PNG is
// the exact picture; the SVG has the outlines and layout to start from, but
// loses blend modes, glass and the font's weight. Writes DIR/sheet.html
// laying out every symbol exported there so far (so a big kit can go in
// several runs). An unpacked kit is zipped into DIR/kit.sketch first, since
// sketchtool reads only `.sketch` files. Prints each sketchtool command it
// runs. Exit 0 when every file was written, 1 when sketchtool failed or
// nothing matched, 2 on a usage error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportedFile, readSymbols, select, sheetHtml, type Format } from './symbols.ts';

function usage(msg: string): never {
  console.error(`export: ${msg}`);
  console.error('usage: npm run export -- <kit .sketch or unpacked folder> <symbol name prefixes…> [--out DIR] [--formats png,svg] [--scale N] [--sketchtool PATH]');
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { out: 'out', formats: ['png', 'svg'] as Format[], scale: 2, sketchtool: '/Applications/Sketch.app/Contents/MacOS/sketchtool' };
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => args[++i] ?? usage(`${a} needs a value`);
  if (a === '--out') opts.out = value();
  else if (a === '--formats') opts.formats = value().split(',') as Format[];
  else if (a === '--scale') opts.scale = Number(value());
  else if (a === '--sketchtool') opts.sketchtool = value();
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else rest.push(a);
}
if (rest.length < 2) usage('give the kit and at least one symbol name prefix');
if (opts.formats.length === 0 || opts.formats.some((f) => f !== 'png' && f !== 'svg')) usage('--formats is png, svg or png,svg');
if (!(opts.scale > 0)) usage('--scale must be a positive number');
if (!existsSync(opts.sketchtool)) usage(`no sketchtool at ${opts.sketchtool}: install Sketch, or pass --sketchtool`);
const [kit, ...prefixes] = rest;
if (!existsSync(kit)) usage(`no kit at ${kit}`);

const out = resolve(opts.out);
mkdirSync(out, { recursive: true });

const all = readSymbols(kit);
const symbols = select(all, prefixes);
if (symbols.length === 0) {
  console.error(`export: no symbol starts with ${prefixes.map((p) => `"${p}"`).join(' or ')}`);
  process.exit(1);
}

// sketchtool reads a `.sketch`: zip an unpacked kit once, again when it changes.
let doc = resolve(kit);
if (statSync(doc).isDirectory()) {
  const packed = join(out, 'kit.sketch');
  if (!existsSync(packed) || statSync(packed).mtimeMs < statSync(join(doc, 'document.json')).mtimeMs) {
    console.log(`zip -r -X ${packed} . (in ${doc})`);
    execFileSync('zip', ['-r', '-X', '-q', packed, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: doc, stdio: 'inherit' });
  }
  doc = packed;
}

// One pass per format (SVGs at scale 1, so their names carry no `@2x`), in
// batches so the command line stays short.
let failed = false;
for (const format of opts.formats) {
  const scale = format === 'svg' ? 1 : opts.scale;
  for (let i = 0; i < symbols.length; i += 200) {
    const batch = symbols.slice(i, i + 200);
    const tail = [`--formats=${format}`, `--scales=${scale}`, `--output=${out}`, '--overwriting=YES'];
    console.log(`${opts.sketchtool} export layers ${doc} --items=<${batch.length} symbol ids> ${tail.join(' ')}`);
    const run = spawnSync(opts.sketchtool, ['export', 'layers', doc, `--items=${batch.map((s) => s.id).join(',')}`, ...tail], { encoding: 'utf8' });
    if (run.status !== 0) {
      failed = true;
      console.error(`export: sketchtool exited with ${run.status ?? run.signal}: ${(run.stderr || run.stdout).trim().split('\n').slice(-5).join('\n')}`);
    }
  }
}

const wanted = symbols.flatMap((s) => opts.formats.map((f) => exportedFile(s.name, f, opts.scale)));
const missing = wanted.filter((f) => !existsSync(join(out, f)));
for (const f of missing) console.error(`export: not written: ${f}`);
// The sheet shows everything exported into DIR so far, from this run or earlier
// ones: the PNG where there is one, else the SVG.
const pick = (name: string) => (['png', 'svg'] as Format[]).map((f) => exportedFile(name, f, opts.scale)).find((f) => existsSync(join(out, f)));
const shown = all.flatMap((s) => {
  const file = pick(s.name);
  return file ? [{ name: s.name, file, zoom: file.endsWith('.png') ? 1 / opts.scale : 1 }] : [];
});
writeFileSync(join(out, 'sheet.html'), sheetHtml(shown));
console.log(`${wanted.length - missing.length} of ${wanted.length} files (${opts.formats.join(', ')}) for ${symbols.length} symbols exported into ${out}/; sheet: ${join(out, 'sheet.html')}`);
process.exit(failed || missing.length ? 1 : 0);
