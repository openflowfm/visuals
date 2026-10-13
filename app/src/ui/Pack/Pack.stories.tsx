import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { PACK_STATUS } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { PackBar } from './Pack';

/**
 * The pack bar (no original story: seen at the library's foot and in ⚙ Settings' Presets): how
 * many presets there are, getting the full library, adding a folder, the credits.
 */
const meta = {
  title: 'open[flow]/visuals/Sheets/Pack bar',
  component: PackBar,
  args: { presets: 250, dropped: null, credits: false, onCredits: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: 400, padding: 20 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof PackBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The starter set only: the full library offered. */
export const StarterOnly: Story = {
  play: async () => {
    await expect(await screen.findByRole('button', { name: /^Get the / })).toBeVisible();
  },
};

/** The full library on its way. */
export const Downloading: Story = {
  parameters: { world: { pack: { ...PACK_STATUS, state: 'downloading', received: 74_800_000 } } },
  play: async () => {
    await expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  },
};

/** The download failed: why, and the retry. */
export const Failed: Story = {
  parameters: { world: { pack: { ...PACK_STATUS, state: 'failed', error: 'The connection dropped.' } } },
  play: async () => {
    await expect(await screen.findByRole('alert')).toHaveTextContent('The connection dropped.');
  },
};

/** After a drop: how many came in. */
export const Dropped: Story = {
  args: { dropped: { text: 'Added 12 presets', error: false } },
};
