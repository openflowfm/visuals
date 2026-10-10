import type { Decorator, Preview } from '@storybook/react-vite';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import { ThemeRoot } from '@openflow/widgets/theme/ThemeRoot.tsx';
import { DEFAULT_THEME } from '@openflow/widgets/theme/theme.ts';
// The app's own CSS, through the same imports `main.tsx` makes.
import '@openflow/widgets/palette.css';
import '@openflow/widgets/tokens.css';
import '../app/src/app.css';
import './preview.css';
import { install, type World } from '../app/src/stories/backend.ts';
import { STILL } from '../app/src/stories/fixtures.ts';
import { SEEDED_KEY } from '../app/src/home.ts';

/**
 * What a story can say about where it is shown, beside Storybook's own:
 *
 * - `tauri`: the app behind the page (`app/src/stories/backend.ts`'s `World`),
 *   over the fixtures; `hang: ['library_index']` keeps the library loading.
 * - `scope`: what the component sits in. `home` (the default) is inside
 *   `.app.home`, where Home's surface tokens and type are; `bare` is as is, for
 *   a whole view (Home, Live) that brings its own.
 * - `storage`: the page's local storage keys to set before it mounts (the home's
 *   open panel, its filters…); every `visuals.*` key is cleared first.
 */
export interface StoryParameters {
  tauri?: Partial<World>;
  scope?: 'home' | 'bare';
  storage?: Record<string, string>;
}

/** The app's theme root, as `main.tsx` mounts it, and the scope the component sits in. */
const inApp: Decorator = (Story, { parameters }) => {
  const scope = (parameters as StoryParameters).scope ?? 'home';
  return (
    <ThemeRoot theme={DEFAULT_THEME} className="vf-root">
      {scope === 'home' ? (
        <div className="app home sb-scope">
          <Story />
        </div>
      ) : (
        <Story />
      )}
    </ThemeRoot>
  );
};

/** The width the home is built around, the one where it turns narrow, and the narrowest it goes. */
const VIEWPORTS = {
  narrow: { name: 'Narrow, 560 px', styles: { width: '560px', height: '800px' }, type: 'desktop' },
  home900: { name: 'Home at 900 px', styles: { width: '900px', height: '800px' }, type: 'desktop' },
  home1440: { name: 'Home at 1440 px', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
};

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    viewport: { options: VIEWPORTS },
    options: {
      storySort: { order: ['Home', 'Library', 'Now Playing', 'Playlists', 'Controls', 'Live', 'Sheets', 'Prompts'] },
    },
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
    return install(p.tauri);
  },
  decorators: [
    inApp,
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
