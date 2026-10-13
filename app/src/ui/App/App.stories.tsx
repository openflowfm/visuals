import { useState } from 'react';
import { cameraFixture } from '../Camera/fixture';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { withLibraryTheme, withStoryFrame } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { PLAYING_DECK, WARM_UP } from '../fixtures/fixtures';
import { SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { VisualsApp } from './App';

/**
 * The whole app on the fixture backend, as main.tsx renders it: the view the app starts in
 * (`world.start`), the sheets, the welcome flow when it is owed, and the update and crash prompts.
 * Storybook's frame and theme stand in for the app's own (`frame: false`), so the toolbar's theme
 * and desk apply; the page isn't marked for the overlay title bar (`chrome: false`), as no story is.
 */
const meta = {
  title: 'open[flow]/visuals/App',
  component: VisualsApp,
  decorators: [withVisualsFrame, withStoryFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { frame: false, chrome: false },
  parameters: {
    scope: 'bare',
    layout: 'fullscreen',
    // The fluid window: the canvas at its real size, as the app fills its window.
    frame: 'fill',
    world: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } },
  },
} satisfies Meta<typeof VisualsApp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A launch past the first run: the home, playing from Warm-up. */
export const Launch: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull());
  },
};

/** Started in live mode in the window (`VISUALS_VIEW=live-windowed`). */
export const StartLive: Story = { parameters: { world: { start: 'live-windowed' } } };

/** The first run: the welcome flow fills the window. */
export const FirstRun: Story = {
  parameters: { world: { firstRun: true, flashUnderstood: false } },
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'Skip setup' })).toBeInTheDocument();
  },
};

/** An update waiting: its prompt over the home. */
export const UpdateWaiting: Story = {
  parameters: { world: { update: { version: '1.1.0', date: '2026-09-30', notes: 'Faster library scans.' } } },
};

/** Whole app with a simulated camera: screen changes never own capture. */
export const CameraPreview: Story = {
  render: function CameraPreview(args) {
    const [cameraController] = useState(() => cameraFixture());
    return <VisualsApp {...args} cameraController={cameraController} />;
  },
};
