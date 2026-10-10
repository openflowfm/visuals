import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { HomeBar } from './HomeBar.tsx';
import { LONG, row, WARM_UP } from './stories/fixtures.ts';
// Home's tokens (--playing…) and its rules for what sits in it, as Home.tsx brings them.
import './home.css';

/** The preset Warm-up plays (`PLAYING_DECK`: the third of ten). */
const playing = row(7);

/** The home's bottom bar (decision 67): what plays and where from, ◀ ▶ R, the audio input, the panel's toggle and go live. */
const meta = {
  title: 'Home/HomeBar',
  component: HomeBar,
  args: {
    name: playing.title,
    from: `from ${WARM_UP.name} · 3 of ${WARM_UP.items.length}`,
    onStep: fn(),
    stepIn: ' in the playlist',
    panel: true,
    onPanel: fn(),
    mini: false,
    onLive: fn(),
    onAudioError: fn(),
  },
  // The whole width of the window, as on the home.
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof HomeBar>;
export default meta;
type Story = StoryObj<typeof meta>;

// The panel's toggle goes under 900 px (the test runner's window is narrower, and a hidden button has no name), so it is found by its class.
const toggle = (root: HTMLElement) => root.querySelector('.home-bar-panel');

/** Playing from a playlist, the Now Playing panel open (its toggle pressed). */
export const PanelOpen: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText(playing.title)).toBeVisible();
    await expect(toggle(canvasElement)).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.queryByRole('button', { name: 'show the now playing panel' })).toBeNull();
  },
};

/** The panel closed: the toggle off, and no small preview. */
export const PanelClosed: Story = {
  args: { panel: false },
  play: async ({ canvasElement }) => {
    await expect(toggle(canvasElement)).toHaveAttribute('aria-pressed', 'false');
  },
};

/** The panel closed, with the small preview at the left (as Home shows it): clicking it opens the panel. */
export const Mini: Story = {
  args: { panel: false, mini: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'show the now playing panel' })).toBeVisible();
  },
};

/** Before anything plays. */
export const NothingPlaying: Story = { args: { name: null, from: '', stepIn: '' } };

/** A long name, from the library, cut with an ellipsis. */
export const LongName: Story = { args: { name: LONG.title, from: 'from the library · 1,204 of 9,795', stepIn: '' } };

/** At the narrowest the home goes. */
export const Narrow: Story = { args: { panel: false, mini: true }, globals: { viewport: { value: 'narrow', isRotated: false } } };
