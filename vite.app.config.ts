import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * A local zen, with hot reload of its source: `ZEN_SOURCE=~/Code/satoramoto/zen`
 * (the checkout), after `npm install --no-save "$ZEN_SOURCE"` has made
 * `node_modules/@satoramoto/zen` a link to it (`npm run dev` and `npm run dev:app`
 * do both, through `app/dev-zen.sh`). zen's
 * `zen-source` export condition, first, resolves each of its entries to the TS/TSX
 * source (its CSS entries to an empty sheet: in source each component imports its
 * own), React comes from here only, and the checkout may be served. Without
 * `ZEN_SOURCE` this is empty and the pinned GitHub build (`lib/`) is used.
 * `.storybook/main.ts` applies the same.
 */
const zenSource = process.env.ZEN_SOURCE ? path.resolve(process.env.ZEN_SOURCE.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')) : null;
export const zenSourceConfig = zenSource
  ? {
      resolve: { conditions: ['zen-source', 'module', 'browser', 'development|production'], dedupe: ['react', 'react-dom'] },
      fsAllow: [realpathSync(zenSource)],
    }
  : { resolve: {}, fsAllow: [] as string[] };

// The page of the Tauri app (`app/`), built into dist-app/ for Tauri.
// No fixed port: `npm run app` (or the launcher, with `autoPort`) picks a free one,
// hands it here as `PORT` and to Tauri as its `devUrl`. Without one, the OS picks.
//
// `VITE_LAB=1` (`npm run app:lab`, `npm run app:build-ui:lab`) builds the lab page,
// with the editor. Without it `import.meta.env.VITE_LAB` is written in as an empty
// string, so the editor's import is dead code and none of it reaches the bundle.
export default defineConfig({
  root: path.resolve(here, 'app'),
  plugins: [react()],
  resolve: zenSourceConfig.resolve,
  define: { 'import.meta.env.VITE_LAB': JSON.stringify(process.env.VITE_LAB === '1' ? '1' : '') },
  clearScreen: false,
  build: {
    outDir: path.resolve(here, 'dist-app'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    // Strict, because Tauri was told this port before vite started.
    port: Number(process.env.PORT) || 0,
    strictPort: Boolean(process.env.PORT),
    // A worktree that links the checkout's node_modules: serve its files (zen's
    // stylesheets among them) from where the link really points.
    fs: { allow: [here, realpathSync(path.join(here, 'node_modules')), ...zenSourceConfig.fsAllow] },
  },
});
