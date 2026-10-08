import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUALS_PORT } from './protocol.ts';
import { generateNodes } from './tools/generate-nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

generateNodes();

// The renderer builds to `visuals/dist`, which `server/index.ts` serves. It is
// a separate build from `set/` because it is a separate app on a separate
// machine — nothing here ships inside the device.
//
// No dev port is assumed: `$PORT`, or 0 for a free one. The server is where
// `server/index.ts` listens — `OPENFLOW_VISUALS_PORT`, or `VISUALS_PORT`.
const PORT = Number(process.env.PORT) || 0;
const SERVER =
  process.env.OPENFLOW_VISUALS ||
  `http://127.0.0.1:${Number(process.env.OPENFLOW_VISUALS_PORT) || VISUALS_PORT}`;

export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // The default 500 kB is a warning about downloading, and this page is not
    // downloaded: it loads from `visual://app/`, off local disk, with no network
    // in the path. What is in the 780 kB is react-dom, the node editor —
    // `@xyflow/react` and its d3 — and this client's own render and ui, which is
    // to say all of it is used and none of it is a surprise.
    //
    // Splitting it would trade a few milliseconds of parse at launch for a chunk
    // that can fail to arrive *later*, which is the wrong direction for
    // something running during a set — the same instinct as the rule against
    // CDNs. Raised rather than turned off, so a dependency that doubles the
    // bundle still says so.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // A preference, not a claim: busy, it moves up.
    port: PORT,
    strictPort: false,
    // Dev serves the page; the visuals server stays authoritative for the show
    // and is the only thing holding the Link peer.
    proxy: {
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
      '/media': { target: SERVER },
      '/models': { target: SERVER },
      '/presets': { target: SERVER },
    },
  },
});
