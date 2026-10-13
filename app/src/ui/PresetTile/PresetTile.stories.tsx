import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { LONG, row, ROWS } from '../fixtures/fixtures';
import { PresetTile, TileGhost, tileBy, tileName } from './PresetTile';

const sample = row(4);
const numbered = ROWS.find((r) => /^\d+$/.test(r.title))!;

/** One preset on the home: the library grid's and a playlist strip's tile (decision 68). */
const meta = {
  title: 'open[flow]/visuals/Library/PresetTile',
  component: PresetTile,
  args: { thumbnail: sample.thumbnail, name: tileName(sample.title, sample.path), by: tileBy(sample.authors, sample.style) },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  decorators: [
    (Story) => (
      <div style={{ width: 220, padding: 'var(--mat-plate-inset)' }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof PresetTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The name and author on the picture's foot, over a soft scrim; nothing under the picture. */
export const Normal: Story = {
  play: async ({ canvas, canvasElement }) => {
    const name = canvas.getByText(tileName(sample.title, sample.path));
    await expect(name).toBeVisible();
    await expect(name.closest('.vs-tile-pic')).toBeTruthy();
    await expect(canvas.getByText(tileBy(sample.authors, sample.style)).closest('.vs-tile-caption')).toBeTruthy();
    // The tile is as tall as its picture.
    const tile = canvasElement.querySelector('.vs-tile')!;
    await expect(tile.getBoundingClientRect().height).toBeCloseTo(tile.querySelector('.vs-tile-pic')!.getBoundingClientRect().height, 0);
  },
};

/** The picture lifts under the pointer. (The original forced :hover with the pseudo-states addon, which zen's Storybook doesn't have: point at it.) */
export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** Hovered in the library: the preset moving over the thumbnail (here a still stand-in), the name still on it. */
export const Moving: Story = {
  args: {
    motion: (
      <canvas
        className="vs-tile-motion"
        data-drawn=""
        width={64}
        height={36}
        ref={(c) => {
          const g = c?.getContext('2d');
          if (!g) return;
          const grad = g.createLinearGradient(0, 0, 64, 36);
          grad.addColorStop(0, '#ff3d7f');
          grad.addColorStop(1, '#3dc3ff');
          g.fillStyle = grad;
          g.fillRect(0, 0, 64, 36);
        }}
      />
    ),
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelector('.vs-tile-motion')).toBeVisible();
    await expect(canvas.getByText(tileName(sample.title, sample.path))).toBeVisible();
  },
};

/** Picked in the grid: the ring with a gap. */
export const Selected: Story = { args: { 'aria-selected': true } };

/** Playing: a "Playing" chip at the picture's foot, the name bold. */
export const Playing: Story = {
  args: { playing: true, star: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.vs-tile-pic > .vs-tile-live')).toBeVisible();
  },
};

/** Failed to draw: the ! chip at the bottom right, the name kept clear of it. */
export const Failed: Story = {
  args: {
    'data-failed': '',
    marks: (
      <span className="vs-tile-failed" aria-hidden="true">
        !
      </span>
    ),
  } as Story['args'],
};

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

/** New here: the tile being dragged, on the float layer, over a place it can land. */
export const Dragged: Story = {
  render: () => <TileGhost x={20} y={20} thumbnail={sample.thumbnail} name={tileName(sample.title, sample.path)} ok />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.vs-tile-ghost[data-layer="float"]')).toBeTruthy();
  },
};
