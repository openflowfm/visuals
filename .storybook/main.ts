import type { StorybookConfig } from '@storybook/react-vite';
import app, { zenSourceConfig } from '../vite.app.config.ts';

// The UI's parts (`app/src/ui/**/*.stories.tsx`, on the fake backend in
// `app/src/ui/fixtures/`) and the whole app (`app/src/App.stories.tsx`) as
// main.tsx renders it, with no app behind it: the UI over the app's Tauri
// bridge, the fake Tauri commands and what they serve (the starter set's rows
// and thumbnails, the playlists, the deck, live mode's state) in
// `app/src/stories/`. The app's build starts from `app/index.html` and never
// imports a story or a fixture, so none of it ships (`npm run app:build-ui` then
// `npm run check:no-dev-code`, which also looks for Storybook).
//
// With `ZEN_SOURCE` set (`npm run design`), zen resolves to that checkout's
// source, hot-reloaded (`vite.app.config.ts`'s `zenSourceConfig`), and zen's own
// Storybook is composed in from `ZEN_STORYBOOK_URL` (http://localhost:6022 by
// default): one window, the visuals stories beside zen's. Without it, no ref.
const zenStorybook = process.env.ZEN_SOURCE ? (process.env.ZEN_STORYBOOK_URL ?? 'http://localhost:6022') : null;

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../app/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
  ...(zenStorybook ? { refs: { zen: { title: 'zen', url: zenStorybook } } } : {}),
  viteFinal: (config) => ({
    ...config,
    // The app's own: the lab's switch, off (the editor isn't storied), and its build target.
    define: { ...config.define, ...app.define },
    build: { ...config.build, target: app.build?.target },
    resolve: { ...config.resolve, ...zenSourceConfig.resolve },
    // With a local zen, its checkout may be served too (beside the app's own allow list).
    server: zenSourceConfig.fsAllow.length
      ? { ...config.server, fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? app.server?.fs?.allow ?? []), ...zenSourceConfig.fsAllow] } }
      : config.server,
    // Apart from the app's own vite cache: two servers on one cache dir each
    // decide the other's is stale and re-optimize on every start.
    cacheDir: 'node_modules/.vite/storybook',
  }),
};

export default config;
