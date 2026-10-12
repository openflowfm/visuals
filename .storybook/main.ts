import type { StorybookConfig } from '@storybook/react-vite';
import app from '../vite.app.config.ts';

// The whole app (`app/src/*.stories.tsx`) as main.tsx renders it, with no app
// behind it: zen's UI over the app's Tauri bridge, the fake Tauri commands and
// what they serve (the starter set's rows and thumbnails, the playlists, the
// deck, live mode's state) in `app/src/stories/`. Each part's own stories live
// in zen's Storybook. The app's build starts from `app/index.html` and never
// imports either, so none of it ships (`npm run app:build-ui` then
// `npm run check:no-dev-code`, which also looks for Storybook).
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../app/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
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
