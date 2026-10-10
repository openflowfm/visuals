import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { PresetTile, tileBy, tileName } from './PresetTile.tsx';
import { LONG, row, ROWS } from './stories/fixtures.ts';

const sample = row(4);
const numbered = ROWS.find((r) => /^\d+$/.test(r.title))!;

/** One preset on the home: the library grid's and a playlist strip's tile (decision 68). */
const meta = {
  title: 'Library/PresetTile',
  component: PresetTile,
  args: { thumbnail: sample.thumbnail, name: tileName(sample.title, sample.path), by: tileBy(sample.authors, sample.style) },
  decorators: [
    (Story) => (
      <div style={{ width: 220 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PresetTile>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(tileName(sample.title, sample.path))).toBeVisible();
  },
};

/** The picture lifts under the pointer. */
export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** Picked in the grid: the ring with a gap. */
export const Selected: Story = { args: { 'aria-selected': true } };

/** Playing: the green level badge, and ▶ before the name. */
export const Playing: Story = { args: { playing: true, star: true } };

/** No thumbnail yet: the picture's own backing, saying so. */
export const EmptyPicture: Story = { args: { thumbnail: null, empty: 'Not drawn yet' } };

/** A long name and a long author line, cut with an ellipsis. */
export const LongName: Story = { args: { thumbnail: LONG.thumbnail, name: tileName(LONG.title, LONG.path), by: tileBy(LONG.authors, LONG.style) } };

/** A title that is only a number shows the file name instead. */
export const NumberedTitle: Story = {
  args: { thumbnail: numbered.thumbnail, name: tileName(numbered.title, numbered.path), by: tileBy(numbered.authors, numbered.style) },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText(numbered.title)).toBeNull();
  },
};
