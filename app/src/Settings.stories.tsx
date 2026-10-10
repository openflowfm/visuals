import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen } from 'storybook/test';
import type { ReactNode } from 'react';
import { useAccessibility } from './access.ts';
import type * as api from './api.ts';
import { qualityLine, Settings } from './Settings.tsx';

const LOW: api.Quality = { chosen: 'low', effective: 'low', reason: 'Chosen in Settings' };

/** What `App` mounts once: reads the reduce-flashing setting the switch follows. */
function Accessible({ children }: { children: ReactNode }) {
  useAccessibility();
  return children;
}

/** ⚙ Settings, the sheet over any view, as `App` mounts it: outside the home's scope, over the whole window. */
const meta = {
  title: 'Sheets/Settings',
  component: Settings,
  args: { open: true, onClose: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Accessible>
        <Story />
      </Accessible>
    ),
  ],
} satisfies Meta<typeof Settings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** As a first run leaves it: quality on Auto, reduce flashing following macOS, crash reports on. */
export const Open: Story = {
  play: async () => {
    await expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(await screen.findByText("Following macOS's Reduce motion.")).toBeVisible();
  },
};

/** The quality chosen by hand (Low), so its line says so rather than what Auto picked. */
export const QualityChosen: Story = {
  parameters: { tauri: { quality: LOW } },
  play: async () => {
    await expect(await screen.findByText(qualityLine(LOW))).toBeVisible();
  },
};

/** Reduce flashing turned on here, no longer following macOS: the switch on, and "Follow macOS" offered. */
export const ReduceMotionOn: Story = {
  parameters: { tauri: { motion: { reduced: true, system: false } } },
  play: async () => {
    await expect(await screen.findByRole('button', { name: "Follow macOS's Reduce motion" })).toBeVisible();
  },
};
