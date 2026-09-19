import type { StorybookConfig } from '@storybook/react-vite';

// Storybook is where a piece of this app's UI is looked at on its own, and
// where a small experiment is kept once it has been worth running once.
//
// Two kinds of story. `client/**/*.stories.tsx` sits beside the component it
// shows and is a component's states with none of the console around them.
// `stories/experiments/` is the other kind: a page that exists to answer a
// question — how does the palette generator behave across the moods, what does
// the boundary look like when it fires — and is worth keeping so the next
// person does not have to write it again.
//
// A dedicated Vite config rather than the app's: the app's proxies a show
// server that is not running and regenerates the node registry on load, and
// neither has any business in a page that is only drawing components.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../client/**/*.stories.tsx', '../stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-vitest'],
  core: {
    disableTelemetry: true,
    builder: { name: '@storybook/builder-vite', options: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
};

export default config;
