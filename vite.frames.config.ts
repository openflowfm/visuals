import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNodes } from './tools/generate-nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

generateNodes();

// The frame renderer, built on its own — the same arrangement as the benchmark
// page and for the same reason: it imports the compositor and nothing that
// renders a component, and it has no business inside `visuals/dist`.
export default defineConfig({
  root: here,
  cacheDir: path.resolve(here, '../node_modules/.vite/visuals-frames'),
  build: {
    outDir: path.resolve(here, 'frames-dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: path.resolve(here, 'frames.html') },
  },
});
