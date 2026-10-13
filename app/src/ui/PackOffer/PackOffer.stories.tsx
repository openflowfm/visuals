import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { PACK_STATUS } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { PackOffer } from './PackOffer';

/**
 * The library's one-line offer of the full library (no original story: seen on the home under
 * the starter set): what is in, and the button to get the rest.
 */
const meta = {
  title: 'open[flow]/visuals/Prompts/Pack offer',
  component: PackOffer,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof PackOffer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Only the starter set is in. */
export const StarterOnly: Story = {
  play: async () => {
    await expect(await screen.findByRole('button', { name: /^Get the / })).toBeVisible();
  },
};

/** The download running. */
export const Downloading: Story = {
  parameters: { world: { pack: { ...PACK_STATUS, state: 'downloading', received: 74_800_000 } } },
  play: async () => {
    await expect(await screen.findByRole('progressbar')).toBeVisible();
  },
};

/** The download failed: why, and the retry. */
export const Failed: Story = {
  parameters: { world: { pack: { ...PACK_STATUS, state: 'failed', error: 'The connection dropped.' } } },
};

/** The full library came without its pictures. */
export const Bare: Story = {
  parameters: { world: { pack: { ...PACK_STATUS, installed: 9795, bare: true } } },
};
