/**
 * What every visuals story stands on, in place of visual[flow]'s `.storybook/preview.tsx`:
 *
 * ```tsx
 * const meta = {
 *   title: 'open[flow]/visuals/…',
 *   decorators: [withVisualsFrame, withLibraryTheme],
 *   globals: VISUALS_GLOBALS,
 *   beforeEach: visualsBeforeEach,
 *   parameters: { world: { hang: ['library_index'] } },
 * } satisfies Meta<typeof Thing>;
 * ```
 *
 * `withVisualsFrame` must come before `withLibraryTheme` (inside its theme scope), so the frame
 * reads the contract's variables.
 */
import type { CSSProperties } from 'react';
import type { Decorator, StoryContext } from '@storybook/react-vite';
import { Layer } from '@satoramoto/zen';
import { SEEDED_KEY } from '../model/home';
import { install, type World } from './backend';
import { STILL } from './fixtures';
import '../visuals.css';
import './story.css';

/**
 * The desktop behind the HUD frost (the original's `data-sb-desk` stand-ins): a dark desktop, a
 * light one, or Reduce transparency (the material solid). A `desk` global wins over the parameter.
 */
export type Desk = 'dark' | 'light' | 'solid';

/**
 * What a story can say about where it is shown, beside Storybook's own:
 *
 * - `world`: the app behind the page (`backend.ts`'s `World`), over the fixtures;
 *   `hang: ['library_index']` keeps the library loading. (The original's `parameters.tauri`.)
 * - `scope`: what the component sits in. `home` (the default) is inside `.vs-root` as a block,
 *   laid out as itself; `bare` is a whole view (Home, Live) filling the canvas.
 * - `storage`: the page's local storage keys to set before it mounts (the home's open panel, its
 *   filters…); every `visuals.*` key is cleared first.
 * - `desk`: the desktop behind the frost; `dark` by default.
 */
export interface StoryParameters {
  world?: Partial<World>;
  scope?: 'home' | 'bare';
  storage?: Record<string, string>;
  desk?: Desk;
}

/** The theme every visuals story wears: the visuals pack (frost, Instrument Sans, roomy). */
export const VISUALS_GLOBALS = { theme: 'visuals' } as const;

/** A fresh app behind each story, and the page's storage as a first run left it. Returns what takes the app away. */
export function visualsBeforeEach({ parameters }: Pick<StoryContext, 'parameters'>): () => void {
  const p = parameters as StoryParameters;
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('visuals.')) localStorage.removeItem(key);
    localStorage.setItem(SEEDED_KEY, '1');
    for (const [key, value] of Object.entries(p.storage ?? {})) localStorage.setItem(key, value);
  } catch {
    // No storage (a private window): the page does without it too.
  }
  return install(p.world);
}

/**
 * The window the app sits in: the desktop (the starter still, blurred as the frost blurs it) or
 * the material solid, the `ground` layer over it, and `.vs-root` (visuals.css) in the story's
 * scope. Holes inside show the still, as the native preview would.
 */
export const withVisualsFrame: Decorator = (Story, { parameters, globals }) => {
  const p = parameters as StoryParameters;
  const desk: Desk = (globals.desk as Desk | undefined) ?? p.desk ?? 'dark';
  const scope = p.scope ?? 'home';
  return (
    <div className="vs-frame" data-desk={desk} data-scope={scope} style={{ '--vs-still': `url("${STILL}")` } as CSSProperties}>
      {desk !== 'solid' && <div className="vs-frame-desk" aria-hidden="true" />}
      <Layer level="ground" className="vs-frame-ground">
        <div className="vs-root" data-still="">
          <Story />
        </div>
      </Layer>
    </div>
  );
};
