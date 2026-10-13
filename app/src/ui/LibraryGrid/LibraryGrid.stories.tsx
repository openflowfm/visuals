import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { DATA, ROWS } from '../fixtures/fixtures';
import { browseOrder, prepare } from '../model/librarySearch';
import { LibraryGrid } from './LibraryGrid';

/** The starter slice as the home's grid browses it: curated first (decision 68). */
const rows = browseOrder(prepare(ROWS, DATA));
const keyOf = (i: number) => rows[i].row.key;

/**
 * The home's library grid: 16:9 tiles on the main pane's padding, only the rows in view drawn.
 * (The original set its width with a viewport global, `home1440` or `narrow`; zen's Storybook has
 * no such viewports, so the pane around the grid takes `parameters.paneWidth` instead.)
 */
const meta = {
  title: 'open[flow]/visuals/Library/LibraryGrid',
  component: LibraryGrid,
  args: {
    rows,
    active: -1,
    selected: new Set<string>(),
    current: null,
    into: null,
    reveal: 0,
    onMove: fn(),
    onPick: fn(),
    onAdd: fn(),
    onClear: fn(),
  },
  parameters: { layout: 'fullscreen' },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  decorators: [
    // The main pane around the grid, as Home has it: as tall as the window, so the grid scrolls inside it.
    (Story, { parameters }) => (
      <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: (parameters.paneWidth as number | undefined) ?? 1100, maxWidth: '100%' }}>
        <Story />
      </main>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof LibraryGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Full of tiles, nothing picked and nothing playing. */
export const Full: Story = {
  play: async ({ canvas }) => {
    await expect((await canvas.findAllByRole('option')).length).toBeGreaterThan(12);
  },
};

/** One tile picked (the ring with a gap), and highlighted for the keyboard. */
export const OneSelected: Story = {
  args: { selected: new Set([keyOf(5)]), active: 5 },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByRole('option', { selected: true })).toHaveLength(1);
  },
};

/** Several picked with ⌘-click and ⇧-click: a run of three and two apart. */
export const SeveralSelected: Story = {
  args: { selected: new Set([keyOf(2), keyOf(3), keyOf(4), keyOf(9), keyOf(13)]), active: 13 },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByRole('option', { selected: true })).toHaveLength(5);
  },
};

/** One playing: a "Playing" chip at its picture's foot. */
export const Playing: Story = {
  args: { current: rows[6].row.path },
  play: async ({ canvas }) => {
    const playing = await canvas.findByRole('option', { name: /playing/ });
    await expect(playing).toBeVisible();
    await expect(playing.querySelector('.vs-tile-pic > .vs-tile-live')).toBeTruthy();
  },
};

/** Playing one while two others are picked, the way a set gets put together. */
export const PlayingWithSelection: Story = {
  args: { current: rows[6].row.path, selected: new Set([keyOf(1), keyOf(10)]), active: 10 },
};

/** At the narrowest the home goes. */
export const Narrow: Story = {
  parameters: { paneWidth: 560 },
  args: { current: rows[3].row.path, selected: new Set([keyOf(1)]) },
};
