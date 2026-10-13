import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { UPDATE_CHECK_EVENT } from '../model/api';
import { emit } from '../model/ipc';
import { UPDATE } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { Update } from './Update';

/**
 * Updates, mounted beside the app as `main.tsx` does: quiet on launch unless a
 * newer version is out; the menu's "Check for Updates…" (the `update-check`
 * event) also says when there is none.
 */
const meta = {
  title: 'open[flow]/visuals/Prompts/Update',
  component: Update,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Update>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A newer version found on launch: its number, the day it came out and what's new, with Install and restart. */
export const Found: Story = {
  parameters: { world: { update: UPDATE } },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: `Version ${UPDATE.version} is out` })).toBeInTheDocument();
    await expect(screen.getByText('Released 2026-10-08.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install and restart' })).toBeVisible());
  },
};

/** Asked from the menu with nothing newer out. */
export const Latest: Story = {
  parameters: { world: { update: null } },
  play: async () => {
    await emit(UPDATE_CHECK_EVENT);
    await waitFor(() => expect(screen.getByText('You have the latest version.')).toBeVisible());
  },
};
