import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The editor page of the Tauri app (`app/`), built into dist-app/ for Tauri.
// No fixed port: `npm run app` (or the launcher, with `autoPort`) picks a free one,
// hands it here as `PORT` and to Tauri as its `devUrl`. Without one, the OS picks.
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
    // Strict, because Tauri was told this port before vite started.
    port: Number(process.env.PORT) || 0,
    strictPort: Boolean(process.env.PORT),
    // A worktree that links the checkout's node_modules: serve its files (the
    // widgets' font among them) from where the link really points.
    fs: { allow: [here, realpathSync(path.join(here, 'node_modules'))] },
  },
});
