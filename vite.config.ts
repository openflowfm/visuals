import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNodes } from './tools/generate-nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

generateNodes();

// The renderer builds to `visuals/dist`, which `server/index.ts` serves. It is
// a separate build from `set/` because it is a separate app on a separate
// machine — nothing here ships inside the device.
//
// The dev port follows set[flow]'s at +300, continuing the offsets in
// widgets/docs/bench.md: set 5173, widget bench +100, device bench +200. A
// worktree that moves OPENFLOW_PORT_BASE takes all four with it.
const SET_PORT = Number(process.env.OPENFLOW_PORT_BASE) || 5173;
const PORT = Number(process.env.OPENFLOW_VISUALS_UI_PORT) || SET_PORT + 300;
const SERVER = process.env.OPENFLOW_VISUALS || 'http://127.0.0.1:17900';

export default defineConfig({
  root: here,
  plugins: [react()],
  cacheDir: path.resolve(here, '../node_modules/.vite/visuals'),
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: PORT,
    strictPort: true,
    // The editor is composed from `widgets/`, which lives outside this root.
    // Same reason both benches allow the repo: Vite refuses paths above its root.
    fs: { allow: [path.resolve(here, '..')] },
    // Dev serves the page; the visuals server stays authoritative for the show
    // and is the only thing holding the Link peer.
    proxy: {
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
      '/media': { target: SERVER },
    },
  },
});
