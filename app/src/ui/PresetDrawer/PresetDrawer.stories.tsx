import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { DATA, PLAYLISTS, ROWS } from '../fixtures/fixtures';
import { prepare } from '../model/librarySearch';
import { PresetDrawer } from './PresetDrawer';

// No original story: the lab editor's drawer under its grid, on the starter slice.
const all = prepare(ROWS, DATA);
const [warm, both, peak] = [all[0], all[3], all[21]];

/** The selection's drawer in the lab editor's column: one preset, or several at once. */
const meta = {
  title: 'open[flow]/visuals/Library/PresetDrawer',
  component: PresetDrawer,
  args: {
    chosen: [both],
    hiddenByFilter: 0,
    playlists: PLAYLISTS,
    current: null,
    error: null,
    onSet: fn(),
    onLoad: fn(),
    onClose: fn(),
  },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', width: 240, height: 640, padding: 'var(--space-2)' }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof PresetDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One preset: its picture, its groups, star and never-play, its tags and its playlists. */
export const One: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('region', { name: `preset ${both.title}` })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'true');
    canvas.getByRole('button', { name: 'take the tag chill off' }).click();
    await expect(args.onSet).toHaveBeenCalledWith([both.row.key], { remove_tags: ['chill'] });
  },
};

/** The preset playing: its picture says so. */
export const Playing: Story = { args: { current: both.row.path } };

/** Several at once: a strip of pictures, their tags with counts, the star mixed. */
export const Several: Story = {
  args: { chosen: [warm, both, peak] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByText('3 selected')).toBeVisible();
  },
};

/** Some of the selection hidden by the filter: the title says how many. */
export const HiddenByFilter: Story = { args: { chosen: [warm, both, peak], hiddenByFilter: 2 } };

/** The last change didn't stick. */
export const ChangeFailed: Story = { args: { error: 'Couldn’t save the library: the disk is full.' } };
