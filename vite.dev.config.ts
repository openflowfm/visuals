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
      proxy: {
        '/__bridge': {
          target: `http://${bridge}`,
          // Refused means the app isn't listening yet (still building, or restarting): nothing
          // reached it, so the page may send again (`x-bridge-unreachable`). Any other failure
          // may have reached it, and is left to vite's own 502.
          configure: (proxy) =>
            proxy.on('error', (err, _req, res) => {
              if ((err as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || !('writeHead' in res) || res.headersSent) return;
              res.writeHead(503, { 'content-type': 'text/plain', 'x-bridge-unreachable': '1' }).end('the app behind the dev bridge is not up yet');
            }),
        },
      },
    },
  }),
);
