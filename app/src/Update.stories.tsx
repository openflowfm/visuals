import type { Meta, StoryObj } from '@storybook/react-vite';
import { emit } from '@tauri-apps/api/event';
import { expect, screen, waitFor } from 'storybook/test';
import { UPDATE_CHECK_EVENT } from './api.ts';
import { Update } from './Update.tsx';
import { UPDATE } from './stories/fixtures.ts';

/**
 * Updates, mounted beside the app as `main.tsx` does: quiet on launch unless a
 * newer version is out; the menu's "Check for Updates…" (the `update-check`
 * event) also says when there is none.
 */
const meta = {
  title: 'Prompts/Update',
  component: Update,
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Update>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A newer version found on launch: its number, the day it came out and what's new, with Install and restart. */
export const Found: Story = {
  parameters: { tauri: { update: UPDATE } },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: `Version ${UPDATE.version} is out` })).toBeInTheDocument();
    await expect(screen.getByText('Released 2026-10-08.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install and restart' })).toBeVisible());
  },
};

/** Asked from the menu with nothing newer out. */
export const Latest: Story = {
  parameters: { tauri: { update: null } },
  play: async () => {
    await emit(UPDATE_CHECK_EVENT);
    await waitFor(() => expect(screen.getByText('You have the latest version.')).toBeVisible());
  },
};
