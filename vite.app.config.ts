import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The editor page of the Tauri app (`app/`). Its own build, because it shares
// nothing with the Electron renderer it replaces but React and the widgets.
// The port is `app/src-tauri/tauri.conf.json`'s `devUrl`.
export default defineConfig({
  root: path.resolve(here, 'app'),
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: path.resolve(here, 'dist-app'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 1430,
    strictPort: true,
  },
});
