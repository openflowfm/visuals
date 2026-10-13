import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { Hole } from '@satoramoto/zen';
import { FX_BUSY } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { MoreEffects } from './MoreEffects';

/**
 * A window of `width` × 900 over the picture (a `Hole`, which the frame fills with the starter
 * still), whatever the runner's viewport: its transform makes it the drawer's containing block,
 * so the fixed drawer lays out along its foot as it would in a window that size.
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
 * The More effects drawer, one tap from live, as the app mounts it (outside the home's scope):
 * along the window's foot, the show above it uncovered. Speed, Colour and Trails as sliders,
 * Mirror and Invert as type, Punch a pad, Reset a quiet word.
 */
const meta = {
  title: 'open[flow]/visuals/Sheets/More effects',
  component: MoreEffects,
  args: { open: true, onClose: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof MoreEffects>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a 1440 px window, every effect at rest: picking a mirror underlines it. */
export const At1440: Story = {
  name: 'At 1440 px',
  render: (args) => (
    <Window width={1440}>
      <MoreEffects {...args} />
    </Window>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'More effects' })).toBeVisible();
    await expect(await screen.findByRole('button', { name: 'Punch (P)' })).toBeVisible();
    for (const name of ['speed', 'hue', 'trails']) await expect(screen.getByRole('slider', { name })).toBeVisible();
    const quad = screen.getByRole('radio', { name: '4-way: mirror four ways' });
    await userEvent.click(quad);
    await waitFor(() => expect(quad).toHaveAttribute('aria-checked', 'true'));
  },
};

/** In an 800 px window, mid-set: the mirror on and the colours inverted. */
export const At800: Story = {
  name: 'At 800 px',
  parameters: { world: { fx: { ...FX_BUSY, invert: true, mirror: 'quad' } } },
  render: (args) => (
    <Window width={800}>
      <MoreEffects {...args} />
    </Window>
  ),
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'invert' })).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByRole('radio', { name: '4-way: mirror four ways' })).toHaveAttribute('aria-checked', 'true');
    await expect(screen.getByRole('button', { name: 'Reset: back to normal' })).toBeVisible();
  },
};
