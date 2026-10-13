import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { VisualsApp } from './ui';
import { install, type World } from './stories/backend.ts';
import { PLAYING_DECK, STILL, WARM_UP } from './stories/fixtures.ts';
import { SEEDED_KEY } from './home.ts';
import { installTauriBridge } from './zenBridge.ts';
import './main.css';

/**
 * What an App story can say, beside Storybook's own:
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

/**
 * The frost's stand-in (decision 69): the main window is macOS's HUD material,
 * which comes out about #1e1e1e over a dark desktop and #363636 over a light
 * one, solid in that range with Reduce transparency on. Headless pictures can't
 * show the blur, so these are the desktop already blurred (`preview.css`,
 * `data-sb-desk`), picked with the toolbar's Desk menu (the `desk` global the
 * UI's own stories read too).
 */
const withDesk: Decorator = (Story, { globals }) => {
  const desk = (globals.desk as string | undefined) ?? 'dark';
  useLayoutEffect(() => {
    document.documentElement.dataset.sbDesk = desk;
    return () => void delete document.documentElement.dataset.sbDesk;
  }, [desk]);
  return <Story />;
};

/**
 * The whole app as `main.tsx` renders it: the UI (`./ui`) in zen's `visuals`
 * pack, dark, over the app's Tauri bridge (`zenBridge.ts`), with the fake app
 * (`stories/backend.ts`) answering Tauri's IPC. Each part's own stories (the
 * home's states, the library, live's panels, the sheets and prompts) are under
 * `open[flow]/visuals/`, beside the parts in `ui/`. The page isn't marked for
 * the overlay title bar (`chrome: false`): no window buttons are drawn over a story.
 */
const meta = {
  title: 'App',
  component: VisualsApp,
  args: { mode: 'dark', chrome: false },
  decorators: [withDesk],
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
  // Picked up where the app left off, as at a launch: without a resume the home opens a random preset.
  parameters: { layout: 'fullscreen', tauri: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } } },
} satisfies Meta<typeof VisualsApp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A launch past the first run: the home, playing Warm-up, its presets read from the app over the bridge. */
export const Launch: Story = {
  play: async ({ canvas }) => {
    const list = await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    await expect((await within(list).findAllByRole('listitem')).length).toBe(WARM_UP.items.length);
  },
};

/** Started in live mode in the window (`VISUALS_VIEW=live-windowed`): the output waits for a display to be picked, offered in the Output popover. */
export const StartLive: Story = {
  parameters: { tauri: { start: 'live-windowed' } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Output, in this window' }));
    const pop = await canvas.findByRole('dialog', { name: 'Output, in this window' });
    await expect(await within(pop).findByRole('button', { name: 'Go full screen on Projector (HDMI)' })).toBeInTheDocument();
  },
};

/** The first run: the welcome flow fills the window; skipping it ends on the home. */
export const FirstRun: Story = {
  parameters: { tauri: { firstRun: true, flashUnderstood: false } },
  play: async ({ canvas }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Skip setup' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Skip setup' })).toBeNull());
    await expect(await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` })).toBeInTheDocument();
  },
};

/** An update waiting: its prompt over the home, from the app's `update_check`. */
export const UpdateWaiting: Story = {
  parameters: { tauri: { update: { version: '1.1.0', date: '2026-09-30', notes: 'Faster library scans.' } } },
  play: async () => {
    await expect(await screen.findByText(/Version 1\.1\.0 is out/)).toBeInTheDocument();
  },
};
