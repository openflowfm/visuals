#!/usr/bin/env node
// `npm run check:no-dev-code [-- --bin <path>]`: the dev bridge (`npm run dev`)
// never reaches what ships. Exit 1 when the built page (dist-app/, after
// `npm run app:build-ui`) has the page's bridge shim in it, or when the app
// binary given with `--bin` (built without the `dev-bridge` feature) has the
// Rust bridge in it; 0 otherwise; 2 on a usage error.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Strings only the bridge has: its route, its header, its env names and its files.
const PAGE_MARKERS = ['/__bridge', 'x-bridge-token', 'visuals.dev.bridge-token', 'src/dev/'];
const BIN_MARKERS = ['/__bridge', 'VISUALS_BRIDGE', 'dev bridge'];

const args = process.argv.slice(2);
const at = args.indexOf('--bin');
const bin = at >= 0 ? args[at + 1] : null;
if (at >= 0 && !bin) {
  console.error('usage: no-dev-code.mjs [--bin <app binary>]');
  process.exit(2);
}

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? files(path.join(dir, n)) : [path.join(dir, n)]));
const found = [];
const dist = path.join(root, 'dist-app');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('no dist-app/: run `npm run app:build-ui` first');
  process.exit(2);
}
for (const file of files(dist).filter((f) => /\.(js|css|html|map)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const m of PAGE_MARKERS) if (text.includes(m)) found.push(`${path.relative(root, file)} has "${m}"`);
}
if (bin) {
  const bytes = readFileSync(bin);
  for (const m of BIN_MARKERS) if (bytes.includes(Buffer.from(m))) found.push(`${bin} has "${m}"`);
}
if (found.length) {
  console.error(`the dev bridge is in what ships:\n  ${found.join('\n  ')}`);
  process.exit(1);
}
console.log(`no dev bridge in dist-app/${bin ? ` or ${bin}` : ''}`);
