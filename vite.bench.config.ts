import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNodes } from './tools/generate-nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

generateNodes();

// The benchmark page, built on its own. No React plugin: `bench.ts` imports the
// compositor and the compiler and nothing that renders a component, and the
// point of this build is that what it times is the renderer rather than an app
// around it.
//
// Its own `outDir`, because `visuals/dist` is what the server serves on a show
// night and a benchmark has no business inside it.
export default defineConfig({
  root: here,
  cacheDir: path.resolve(here, '../node_modules/.vite/visuals-bench'),
  build: {
    outDir: path.resolve(here, 'bench-dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: path.resolve(here, 'bench.html') },
  },
});
