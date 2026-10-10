import { defineConfig, mergeConfig, type Plugin } from 'vite';
import app from './vite.app.config.ts';

// `npm run dev` (`app/dev.sh`): the app's page, with HMR, in a normal browser,
// driving the real app running headless through its dev bridge (the
// `dev-bridge` feature, `app/src-tauri/src/bridge.rs`). `/__bridge` is proxied to
// the bridge at `VISUALS_BRIDGE`, so the page reaches it on its own origin.
// `app/src/dev/entry.ts` runs before `main.tsx` and stands in for Tauri's
// internals. Nothing here is in `vite.app.config.ts`, so none of it reaches the
// app's build (`app/no-dev-code.mjs` checks).
const bridge = process.env.VISUALS_BRIDGE ?? '127.0.0.1:0';

const devEntry = (): Plugin => ({
  name: 'visuals-dev-bridge',
  apply: 'serve',
  transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/src/dev/entry.ts' }, injectTo: 'head' }],
});

export default mergeConfig(
  app,
  defineConfig({
    plugins: [devEntry()],
    server: {
      proxy: { '/__bridge': { target: `http://${bridge}` } },
    },
  }),
);
