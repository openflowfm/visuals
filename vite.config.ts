import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The renderer builds to `visuals/dist`, which `server/index.ts` serves. It is
// a separate build from `ui/` because it is a separate app on a separate
// machine — nothing here ships inside the device.
//
// The dev port follows the UI's at +300, continuing the offsets in
// widgets/docs/bench.md: UI 5173, widget bench +100, device bench +200. A
// worktree that moves BSV_UI_PORT takes all four with it.
const UI_PORT = Number(process.env.BSV_UI_PORT) || 5173;
const PORT = Number(process.env.BSV_VISUALS_UI_PORT) || UI_PORT + 300;
const SERVER = process.env.BSV_VISUALS || 'http://127.0.0.1:17900';

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
    },
  },
});
