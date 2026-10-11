import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { Live } from './Live.tsx';
import { FX_BUSY, LISTS, PLAYING_DECK, WARM_UP } from './stories/fixtures.ts';

/**
 * Live mode, whole, as `App` shows it: the Stage — the picture full-bleed, the
 * header's two capsules along the top, the crate down the left (docked from
 * 1100 px), the dock along the bottom. With two displays it opens the output on
 * the way in, so the picture goes to the projector. `\` hides the panels and
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

/** Playing Warm-up with Link on (two peers, 124 BPM), the output on the projector; `\` hides the panels and shows them again. */
export const Playing: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    // The output went to the projector: not playing in the window.
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBeUndefined());
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.panels).toBe('hidden'));
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.panels).toBeUndefined());
  },
};

/** Mid-set: HOLD on, speed up, the mirror and trails on; ? lists the Stage's own controls too. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async () => {
    await userEvent.keyboard('?');
    const help = await screen.findByRole('dialog');
    await expect(help).toHaveTextContent(/Hide the controls/);
    await userEvent.keyboard('{Escape}');
  },
};

/** One display: played in the window, with no output to open. */
export const OneDisplay: Story = {
  parameters: { tauri: { displays: [{ id: 1, index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, main: true }] } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
  },
};

/** Started in the window (`live-windowed`): the "Go full screen on…" offer over the picture. */
export const Windowed: Story = {
  args: { windowed: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
  },
};

/** Nothing playing yet and no playlist: live picks one at random. */
export const FromNothing: Story = {
  parameters: { tauri: { lists: { playlists: [WARM_UP], deck: { ...PLAYING_DECK, playlist: null, index: null, current: null, next: null, next_index: null, count: 0, settings: null } } } },
};
