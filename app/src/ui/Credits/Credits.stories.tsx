import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { ENTRIES } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { Credits } from './Credits';

/**
 * The credits (no original story: seen in the library and in ⚙ Settings' Presets), shown in
 * place of the preset list: where the presets come from, their terms, and the authors the
 * library's file names credit, by presets.
 */
const meta = {
  title: 'open[flow]/visuals/Sheets/Credits',
  component: Credits,
  args: { entries: ENTRIES, onBack: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: 400, height: 600, display: 'flex', padding: 20 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof Credits>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The starter library's authors. "← Presets" goes back. */
export const Library: Story = {
  play: async ({ args }) => {
    await expect(await screen.findByRole('list', { name: 'authors' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '← Presets' }));
    await expect(args.onBack).toHaveBeenCalled();
  },
};

/** No author named in any file name yet. */
export const NoAuthors: Story = {
  args: { entries: [] },
  play: async () => {
    await expect(await screen.findByText("No authors named in the presets' file names yet.")).toBeVisible();
  },
};
