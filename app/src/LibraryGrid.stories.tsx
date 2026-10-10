import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { LibraryGrid } from './LibraryGrid.tsx';
import { browseOrder, prepare } from './librarySearch.ts';
import { DATA, ROWS } from './stories/fixtures.ts';
// The grid's look comes with Library.tsx in the app; on its own it needs bringing in.
import './library.css';

/** The starter slice as the home's grid browses it: curated first (decision 68). */
const rows = browseOrder(prepare(ROWS, DATA));
const keyOf = (i: number) => rows[i].row.key;

/** The home's library grid: 16:9 tiles on the main pane's padding, only the rows in view drawn. */
const meta = {
  title: 'Library/LibraryGrid',
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
  globals: { viewport: { value: 'home1440', isRotated: false } },
  decorators: [
    // The main pane and the library pane around the grid, as Home has them: as tall as the window, so the grid scrolls inside it.
    (Story) => (
      <main className="home-main" style={{ height: '100vh' }}>
        <div className="lib lib-home">
          <Story />
        </div>
      </main>
    ),
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

/** One playing: the green level badge and ▶ before its name. */
export const Playing: Story = {
  args: { current: rows[6].row.path },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('option', { name: /playing/ })).toBeVisible();
  },
};

/** Playing one while two others are picked, the way a set gets put together. */
export const PlayingWithSelection: Story = {
  args: { current: rows[6].row.path, selected: new Set([keyOf(1), keyOf(10)]), active: 10 },
};

/** At the narrowest the home goes. */
export const Narrow: Story = {
  globals: { viewport: { value: 'narrow', isRotated: false } },
  args: { current: rows[3].row.path, selected: new Set([keyOf(1)]) },
};
