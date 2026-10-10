// `npm run export -- <kit .sketch or unpacked folder> <symbol name prefixes…> [--out DIR] [--scale N] [--sketchtool PATH]`
//
// Exports the kit's symbols whose names start with any of the prefixes (Sketch
// names are paths: `Toggles - Switches/Light/Content Area/3 Rg/…`) as PNGs,
// drawn by Sketch itself with sketchtool, under DIR in one folder per name
// segment, and writes DIR/sheet.html laying out every symbol exported there
// so far (so a big kit can go in several runs). An unpacked kit is
// zipped into DIR/kit.sketch first, since sketchtool reads only `.sketch`
// files. Prints each sketchtool command it runs. Exit 0 when every symbol was
// exported, 1 when sketchtool failed or nothing matched, 2 on a usage error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportedFile, readSymbols, select, sheetHtml } from './symbols.ts';

function usage(msg: string): never {
  console.error(`export: ${msg}`);
  console.error('usage: npm run export -- <kit .sketch or unpacked folder> <symbol name prefixes…> [--out DIR] [--scale N] [--sketchtool PATH]');
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { out: 'out', scale: 2, sketchtool: '/Applications/Sketch.app/Contents/MacOS/sketchtool' };
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => args[++i] ?? usage(`${a} needs a value`);
  if (a === '--out') opts.out = value();
  else if (a === '--scale') opts.scale = Number(value());
  else if (a === '--sketchtool') opts.sketchtool = value();
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else rest.push(a);
}
if (rest.length < 2) usage('give the kit and at least one symbol name prefix');
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

// In batches, so the command line stays short.
let failed = false;
for (let i = 0; i < symbols.length; i += 200) {
  const batch = symbols.slice(i, i + 200);
  const cmd = ['export', 'layers', doc, `--items=${batch.map((s) => s.id).join(',')}`, '--formats=png', `--scales=${opts.scale}`, `--output=${out}`, '--overwriting=YES'];
  console.log(`${opts.sketchtool} export layers ${doc} --items=<${batch.length} symbol ids> --formats=png --scales=${opts.scale} --output=${out} --overwriting=YES`);
  const run = spawnSync(opts.sketchtool, cmd, { encoding: 'utf8' });
  if (run.status !== 0) {
    failed = true;
    console.error(`export: sketchtool exited with ${run.status ?? run.signal}: ${(run.stderr || run.stdout).trim().split('\n').slice(-5).join('\n')}`);
  }
}

const missing = symbols.filter((s) => !existsSync(join(out, exportedFile(s.name, opts.scale))));
for (const s of missing) console.error(`export: not written: ${exportedFile(s.name, opts.scale)}`);
// The sheet shows everything exported into DIR so far, from this run or earlier ones.
const exported = all.filter((s) => existsSync(join(out, exportedFile(s.name, opts.scale))));
writeFileSync(join(out, 'sheet.html'), sheetHtml(exported, opts.scale));
console.log(`${symbols.length - missing.length} of ${symbols.length} symbols exported into ${out}/ at ${opts.scale}×; sheet: ${join(out, 'sheet.html')}`);
process.exit(failed || missing.length ? 1 : 0);
