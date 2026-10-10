import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Home } from './Home.tsx';
import { PLAYING_DECK, row, WARM_UP } from './stories/fixtures.ts';

/** The preset the deck plays: Warm-up's third, `row(7)`. */
const PLAYING = row(7);

/** The bottom bar names the deck's preset, not one picked at random. */
const barNamesPlaying = async (canvasElement: HTMLElement) => {
  await waitFor(() => expect(canvasElement.querySelector('.home-bar-name')?.getAttribute('title')).toBe(PLAYING.title));
};

/**
 * The whole home (decisions 66–68): the source list, the main pane, the Now
 * Playing panel and the bottom bar, playing from Warm-up. At 900 px and up it
 * is wide; under 900 px (`NARROW`) the source list is a menu and the panel an
 * overlay, closed at first.
 */
const meta = {
  title: 'Home/Home',
  component: Home,
  args: { start: null, onMode: () => {} },
  // Picked up where the app left off, as at a launch: without a resume the home opens a random preset, and the bar and panel wouldn't name the deck's.
  parameters: { scope: 'bare', layout: 'fullscreen', tauri: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At 1440×900: the playing playlist's strip, the panel open beside it. */
export const Wide: Story = {
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect((await canvas.findAllByText(WARM_UP.name)).length).toBeGreaterThan(0);
    await barNamesPlaying(canvasElement);
  },
};

/** At 900×800, the narrowest the home is still wide. */
export const At900: Story = {
  name: 'At 900 px',
  globals: { viewport: { value: 'home900', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect((await canvas.findAllByText(WARM_UP.name)).length).toBeGreaterThan(0);
    await barNamesPlaying(canvasElement);
  },
};

/** Under 900 px: the source list a menu, the panel closed. */
export const Narrow: Story = {
  globals: { viewport: { value: 'narrow', isRotated: false } },
};

/** Opened on the library pane (`VISUALS_VIEW=library`) while Warm-up plays. */
export const Library: Story = {
  args: { library: true },
  globals: { viewport: { value: 'home1440', isRotated: false } },
};
