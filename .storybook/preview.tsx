import type { Preview } from '@storybook/react-vite';
import { libraryGlobalTypes, libraryInitialGlobals } from '@satoramoto/zen/storybook';
// zen's stylesheet, as `main.tsx` loads it; each part of the UI imports its own.
import '@satoramoto/zen/zen.css';
import './preview.css';

/**
 * Two kinds of story, each setting up its own world:
 *
 * - The UI's parts (`app/src/ui/**`, titled `open[flow]/visuals/…`): each meta
 *   draws itself with zen's decorators (`withStoryFrame`, `withLibraryTheme`
 *   from `@satoramoto/zen/storybook`) and `ui/fixtures/story.tsx`
 *   (`withVisualsFrame`, `visualsBeforeEach`: the fake backend from
 *   `parameters.world`), in the `visuals` theme pack (`VISUALS_GLOBALS`).
 * - The whole app (`app/src/App.stories.tsx`): the UI over the app's Tauri
 *   bridge, with `app/src/stories/backend.ts` answering Tauri's IPC
 *   (`parameters.tauri`), and the page's own `main.css`.
 *
 * The toolbar is zen's (theme pack, mode, facets) plus the desktop behind the
 * frost (`desk`), which both kinds read.
 */
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
  },
  globalTypes: {
    ...libraryGlobalTypes,
    desk: {
      description: 'The desktop behind the frost',
      toolbar: {
        title: 'Desk',
        icon: 'photo',
        dynamicTitle: true,
        items: [
          { value: 'dark', title: 'Frost, dark desktop' },
          { value: 'light', title: 'Frost, light desktop' },
          { value: 'solid', title: 'Reduce transparency' },
        ],
      },
    },
  },
  initialGlobals: { ...libraryInitialGlobals },
};

export default preview;
