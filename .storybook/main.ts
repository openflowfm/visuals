import type { StorybookConfig } from '@storybook/react-vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import app from '../vite.app.config.ts';

// The macOS kit's exported pictures (`kit/out/`, ignored by git: see
// `kit/README.md`), served at `kit/` so the macOS stories show each beside
// ours. Only when they have been exported here; the stories do without.
const kitOut = fileURLToPath(new URL('../kit/out', import.meta.url));

// The app's page components in the app's own look, with no app behind them.
// Stories sit beside the component they show (`app/src/*.stories.tsx`); what
// they run on (the starter set's rows and thumbnails, the playlists, the deck,
// live mode's state, and the fake Tauri commands that serve them) lives in
// `app/src/stories/`. The app's build starts from `app/index.html` and never
// imports either, so none of it ships (`npm run app:build-ui` then
// `npm run check:no-dev-code`, which also looks for Storybook).
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../app/src/**/*.stories.tsx'],
  // Pseudo-states shows a hover or a focus ring without a pointer there (`parameters.pseudo`).
  addons: ['@storybook/addon-docs', '@storybook/addon-themes', '@storybook/addon-vitest', 'storybook-addon-pseudo-states'],
  core: { disableTelemetry: true },
  staticDirs: existsSync(kitOut) ? [{ from: '../kit/out', to: '/kit' }] : [],
  viteFinal: (config) => ({
    ...config,
    // The app's own: the lab's switch, off (the editor isn't storied), and its build target.
    define: { ...config.define, ...app.define },
    build: { ...config.build, target: app.build?.target },
    // Apart from the app's own vite cache: two servers on one cache dir each
    // decide the other's is stale and re-optimize on every start.
    cacheDir: 'node_modules/.vite/storybook',
  }),
};

export default config;
