import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Storybook's own Vite config. See main.ts for why it is not the app's.
export default defineConfig({
  plugins: [react()],
  cacheDir: 'node_modules/.vite/storybook',
});
