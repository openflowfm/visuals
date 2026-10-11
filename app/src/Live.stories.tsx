import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Live } from './Live.tsx';
import { FX_BUSY, LISTS, PLAYING_DECK, WARM_UP } from './stories/fixtures.ts';

/**
 * Live mode, whole, as `App` shows it: the Stage — the picture full-bleed, the
 * header's two capsules along the top, the crate down the left (docked from
 * 1100 px), the dock along the bottom. It plays in the window on the way in,
 * "Go full screen on…" over the picture until a display is picked (only a start
 * in live mode, `windowed` false, opens the output by itself). `\` hides the panels and
 * shows them again; ? lists every control. The parts have stories of their own
 * (Live/Stage…); the pads are the dock's.
 */
const meta = {
  title: 'Live/Live',
  component: Live,
  args: { start: null, onMode: () => {} },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof Live>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Live's root: what it is doing, as data (it takes no box of its own). */
const root = (el: HTMLElement) => el.querySelector<HTMLElement>('.live')!;

/** Playing Warm-up with Link on (two peers, 124 BPM), the output put on the projector from the offer; `\` hides the panels and shows them again. */
export const Playing: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    // Going live plays in the window, with two displays too, until one is picked.
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Go full screen on Projector (HDMI)' }));
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBeUndefined());
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.panels).toBe('hidden'));
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.panels).toBeUndefined());
  },
};

/** Mid-set: HOLD on, speed up, the mirror and trails on. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
};

/** One display: played in the window, the offer to cover it with the picture over it. */
export const OneDisplay: Story = {
  parameters: { tauri: { displays: [{ id: 1, index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, main: true }] } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
    await expect(await within(canvasElement).findByRole('button', { name: 'Go full screen on Built-in Retina Display' })).toBeVisible();
  },
};

/** Started in live mode (`VISUALS_LIVE=1`): the one way in that opens the output by itself, on the projector. */
export const StartedLive: Story = {
  args: { windowed: false },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBeUndefined());
  },
};

/** Nothing playing yet and no playlist: live picks one at random. */
export const FromNothing: Story = {
  parameters: { tauri: { lists: { playlists: [WARM_UP], deck: { ...PLAYING_DECK, playlist: null, index: null, current: null, next: null, next_index: null, count: 0, settings: null } } } },
};
