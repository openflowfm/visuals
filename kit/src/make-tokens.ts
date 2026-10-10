// `npm run tokens -- <kit .sketch or unpacked folder> [--out FILE] [--preview FILE]`
//
// Writes the kit's colour swatches, text styles and layer styles as CSS custom
// properties (tokens.ts) to FILE, `tokens.css` by default, and a page showing
// them all in light and dark to the preview file, `out/tokens.html` by default.
// Prints how many of each it wrote. Exit 0 when written, 2 on a usage error.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { readDocument } from './symbols.ts';
import { tokensCss, tokensOf, tokensPreview, type SDocument } from './tokens.ts';

function usage(msg: string): never {
  console.error(`tokens: ${msg}`);
  console.error('usage: npm run tokens -- <kit .sketch or unpacked folder> [--out FILE] [--preview FILE]');
  process.exit(2);
}

const args = process.argv.slice(2);
let out = 'tokens.css';
let preview = 'out/tokens.html';
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i] ?? usage('--out needs a value');
  else if (args[i] === '--preview') preview = args[++i] ?? usage('--preview needs a value');
  else if (args[i].startsWith('--')) usage(`unknown option ${args[i]}`);
  else rest.push(args[i]);
}
if (rest.length !== 1) usage('give the kit');
const [kit] = rest;
if (!existsSync(kit)) usage(`no kit at ${kit}`);

const tokens = tokensOf(readDocument(kit) as SDocument);
writeFileSync(resolve(out), tokensCss(tokens, `"${basename(resolve(kit)).replace(/\.sketch$/, '')}"`));
mkdirSync(dirname(resolve(preview)), { recursive: true });
writeFileSync(resolve(preview), tokensPreview(tokens, relative(dirname(resolve(preview)), resolve(out))));
const count = (re: RegExp) => new Set(tokens.filter((t) => re.test(t.name)).map((t) => t.name)).size;
console.log(
  `${new Set(tokens.map((t) => t.name)).size} tokens written to ${out}: ${count(/^--mac-font-|^--mac-tracking-/)} type, ${count(/-(bg|blend|ring|shadow|backdrop)(-\d+)?$/)} from layer styles, the rest colours; preview: ${preview}`,
);
