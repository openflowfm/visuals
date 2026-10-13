import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import type { ReactNode } from 'react';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { Hole } from '@satoramoto/zen';
import { useAccessibility } from '../model/access';
import type * as api from '../model/api';
import { FX_BUSY } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { qualityLine, Settings } from './Settings';

const LOW: api.Quality = { chosen: 'low', effective: 'low', reason: 'Chosen in Settings' };

/** What the app mounts once: reads the reduce-flashing setting the switch follows. */
function Accessible({ children }: { children: ReactNode }) {
  useAccessibility();
  return children;
}

/**
 * A window of `width` × 900 over the picture (a `Hole`, which the frame fills with the starter
 * still), whatever the runner's viewport: its transform makes it the sheet's containing block, so
 * the fixed sheet and its scrim lay out as they would in a window that size.
 */
function Window({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width, height: 900, overflow: 'hidden', transform: 'translateZ(0)' }}>
      <Hole style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  );
}

/**
 * ⚙ Settings, the sheet over any view, as the app mounts it (outside the home's scope): one
 * opaque inset panel down the window's right, quiet group labels, each setting's name first and
 * its control at the row's end.
 */
const meta = {
  title: 'open[flow]/visuals/Sheets/Settings',
  component: Settings,
  args: { open: true, onClose: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Accessible>
        <Story />
      </Accessible>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof Settings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a 1440 px window, as a first run leaves it: quality on Auto, reduce flashing following macOS, crash reports on. Picking a strobe rate underlines it. */
export const At1440: Story = {
  name: 'At 1440 px',
  render: (args) => (
    <Window width={1440}>
      <Settings {...args} />
    </Window>
  ),
  play: async ({ args }) => {
    const sheet = await screen.findByRole('dialog', { name: 'Settings' });
    await expect(within(sheet).getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(await within(sheet).findByText("Following macOS's Reduce motion.")).toBeVisible();
    const four = await within(sheet).findByRole('radio', { name: '4 flashes per beat' });
    await userEvent.click(four);
    await waitFor(() => expect(four).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close settings' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** In an 800 px window, mid-set, with reduce flashing turned on here (no longer following macOS): the switch on, and "Follow macOS" offered under it. Esc closes it. */
export const At800: Story = {
  name: 'At 800 px',
  parameters: { world: { fx: FX_BUSY, motion: { reduced: true, system: false } } },
  render: (args) => (
    <Window width={800}>
      <Settings {...args} />
    </Window>
  ),
  play: async ({ args }) => {
    await expect(await screen.findByRole('button', { name: "Follow macOS's Reduce motion" })).toBeVisible();
    // One name and one switch, lit.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Reduce flashing' })).toHaveAttribute('aria-checked', 'true'));
    await expect(screen.getAllByText('Reduce flashing')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** The quality chosen by hand (Low), so its line says so rather than what Auto picked. */
export const QualityChosen: Story = {
  parameters: { world: { quality: LOW } },
  play: async () => {
    await expect(await screen.findByText(qualityLine(LOW))).toBeVisible();
  },
};
