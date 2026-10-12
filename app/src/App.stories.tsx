import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { VisualsApp } from '@satoramoto/zen/visuals';
import { PLAYING_DECK, WARM_UP } from './stories/fixtures.ts';

/**
 * The whole app as `main.tsx` renders it: zen's UI (`@satoramoto/zen/visuals`)
 * in the `visuals` pack, dark, over the app's Tauri bridge (`zenBridge.ts`),
 * with the fake app (`stories/backend.ts`) answering Tauri's IPC. Each part's
 * own stories (the home's states, the library, live's panels, the sheets and
 * prompts) live in zen's Storybook. The page isn't marked for the overlay title
 * bar (`chrome: false`): no window buttons are drawn over a story.
 */
const meta = {
  title: 'App',
  component: VisualsApp,
  args: { mode: 'dark', chrome: false },
  // Picked up where the app left off, as at a launch: without a resume the home opens a random preset.
  parameters: { tauri: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } } },
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

/** Started in live mode in the window (`VISUALS_VIEW=live-windowed`): the output waits for a display to be picked. */
export const StartLive: Story = {
  parameters: { tauri: { start: 'live-windowed' } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Go full screen on Projector (HDMI)' })).toBeVisible();
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
