#!/usr/bin/env node
// Bundles visual[flow]'s Electron main, preload and server into CommonJS (and
// the server into ESM) — the single-app copy of BSV's `tools/build-electron.ts`.
//
// It exists for the same reason that one did: a Node runtime that is not ours
// to pick. Electron ships its own Node, that Node does not strip types the way
// Node 26 on your PATH does, and `--experimental-strip-types` is not a flag to
// rely on inside somebody else's runtime. So the main process is built rather
// than run from source, and it is built to **CommonJS** because a
// `sandbox: true` preload must be — which is not a limitation to work around,
// since a sandboxed preload is the whole reason the renderer can be trusted
// with `contextIsolation`.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { APPS } from '@openflow/desktop/apps.ts';
import { visualsRoot } from './bin.ts';

const root = visualsRoot;
const one = APPS.visuals;

const here = path.join(root, 'electron');
if (!fs.existsSync(path.join(here, 'main.ts'))) {
  console.error(`electron: no ${path.relative(root, path.join(here, 'main.ts'))}`);
  process.exit(1);
}

/**
 * The app's own server, bundled to run beside it rather than from source.
 *
 * Unpackaged that could be `node server/index.ts` off disk, but a packaged
 * `.app` has no source tree — and, launched from Finder, no `node` on its PATH
 * either, because a GUI process inherits `/usr/bin:/bin` and not whatever a
 * shell profile added. So the server is bundled and run by Electron's own Node
 * (`ELECTRON_RUN_AS_NODE`), which is always there.
 *
 * That works because the one native dependency, the Ableton Link addon, is
 * **node-addon-api** — N-API, whose whole point is an ABI that holds across
 * Node *and* Electron versions. Verified by loading it: no rebuild, no
 * per-upgrade repair. It stays external and ships unpacked, because a `.node`
 * binary cannot be inlined into a bundle or read out of an asar.
 */
const entries = [path.join(here, 'main.ts'), path.join(here, 'preload.ts')];
const server = one.server?.entry;

await esbuild.build({
  entryPoints: entries,
  outdir: path.join(here, 'dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Electron's bundled Node, not the one on your PATH. Conservative for the
  // same reason the server target below is: the runtime is not ours to assume.
  target: 'node20',
  // Provided by the runtime itself and unbundlable — resolving it would inline
  // a stub that silently does nothing.
  external: ['electron'],
  legalComments: 'none',
  minify: false, // this is what you read when a window does not open
});

if (server) {
  await esbuild.build({
    entryPoints: [path.join(root, server)],
    outfile: path.join(here, 'dist', 'server.mjs'),
    bundle: true,
    platform: 'node',
    // ESM, unlike the two above: the server reads `import.meta.url` to find
    // its own renderer, and `link.ts` builds a `createRequire` from it to
    // reach the Link addon. Both are empty in a CJS bundle.
    format: 'esm',
    target: 'node20',
    external: ['@ktamas77/abletonlink'],
    // `ws` and its friends are CommonJS, and esbuild's ESM output leaves their
    // `require` calls to a shim that looks for a global one — which ESM has no
    // such thing as. This is that global, built the only way ESM can build it.
    banner: {
      js: [
        "import { createRequire as __openflowRequire } from 'node:module';",
        'const require = __openflowRequire(import.meta.url);',
      ].join('\n'),
    },
    legalComments: 'none',
    minify: false,
  });
}

const size = (file: string) => fs.statSync(path.join(here, 'dist', file)).size;
const kB = (file: string) => `${(size(file) / 1024).toFixed(0)} kB`;
console.log(
  `built electron/dist — main ${kB('main.cjs')}, preload ${kB('preload.cjs')}` +
    (server ? `, server ${kB('server.mjs')}` : ''),
);
