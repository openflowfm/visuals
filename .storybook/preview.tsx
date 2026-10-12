import type { Preview } from '@storybook/react-vite';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
// The app's own CSS, through the same imports `main.tsx` makes.
import '@satoramoto/zen/zen.css';
import '@satoramoto/zen/visuals.css';
import '../app/src/main.css';
import './preview.css';
import { install, type World } from '../app/src/stories/backend.ts';
import { STILL } from '../app/src/stories/fixtures.ts';
import { SEEDED_KEY } from '../app/src/home.ts';
import { installTauriBridge } from '../app/src/zenBridge.ts';

/**
 * The app's page is zen's (`@satoramoto/zen/visuals`); its components' own
 * stories live in zen's Storybook. Here are a few of the whole app
 * (`app/src/*.stories.tsx`) as the app runs it: zen's UI over the app's Tauri
 * bridge (`zenBridge.ts`), with the fake app (`app/src/stories/backend.ts`)
 * answering Tauri's IPC underneath.
 *
 * - `tauri`: the app behind the page (`backend.ts`'s `World`), over the
 *   fixtures; `hang: ['library_index']` keeps the library loading.
 * - `storage`: the page's local storage keys to set before it mounts (the home's
 *   open panel, its filters…); every `visuals.*` key is cleared first.
 */
export interface StoryParameters {
  tauri?: Partial<World>;
  storage?: Record<string, string>;
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
  },
  // A fresh app behind each story, and the page's storage as a first run left it.
  beforeEach: ({ parameters }) => {
    const p = parameters as StoryParameters;
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('visuals.')) localStorage.removeItem(key);
      localStorage.setItem(SEEDED_KEY, '1');
      for (const [key, value] of Object.entries(p.storage ?? {})) localStorage.setItem(key, value);
    } catch {
      // No storage (a private window): the page does without it too.
    }
    document.documentElement.style.setProperty('--sb-still', `url("${STILL}")`);
    const app = install(p.tauri);
    const bridge = installTauriBridge();
    return () => {
      bridge();
      app();
    };
  },
  decorators: [
    // The frost's stand-in (decision 69): the main window is macOS's HUD material,
    // which comes out about #1e1e1e over a dark desktop and #363636 over a light
    // one, solid in that range with Reduce transparency on. Headless pictures
    // can't show the blur, so these are the desktop already blurred.
    withThemeByDataAttribute({
      themes: { 'Frost, dark desktop': 'dark', 'Frost, light desktop': 'light', 'Reduce transparency': 'solid' },
      defaultTheme: 'Frost, dark desktop',
      attributeName: 'data-sb-desk',
      parentSelector: 'html',
    }),
  ],
};

export default preview;
