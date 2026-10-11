import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';
import type { ReactNode } from 'react';
import { GROUPS, HelpOverlay } from './HelpOverlay.tsx';

/**
 * A window of `width` × 900 over the picture's stand-in, whatever the runner's
 * viewport: its transform makes it the overlay's containing block, so the
 * fixed overlay lays out in it as it would in a window that size.
 */
function Window({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ position: 'relative', width, height: 900, overflow: 'hidden', transform: 'translateZ(0)', background: 'var(--sb-still) center / cover no-repeat #000' }}>{children}</div>;
}

/**
 * The ? overlay: every live control, grouped by where it is, over live mode,
 * as Live mounts it (outside the home's scope). Opaque on the picture, Home's
 * type and quiet headings, the keys as keycaps; Esc, ? or ✕ closes it.
 */
const meta = {
  title: 'Live/Help',
  component: HelpOverlay,
  args: { open: true, onClose: fn(), stage: true },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof HelpOverlay>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a 1440 px window, with the Stage's own controls: the groups in two columns. */
export const At1440: Story = {
  name: 'At 1440 px',
  globals: { viewport: { value: 'home1440', isRotated: false } },
  render: (args) => (
    <Window width={1440}>
      <HelpOverlay {...args} />
    </Window>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Live controls' })).toBeVisible();
    for (const g of GROUPS) await expect(screen.getByRole('heading', { name: g.heading })).toBeVisible();
    await expect(screen.getByText('Hide the controls')).toBeVisible();
  },
};

/** In an 800 px window, without the Stage: Esc closes it. */
export const At800: Story = {
  name: 'At 800 px',
  args: { stage: false },
  globals: { viewport: { value: 'home900', isRotated: false } },
  render: (args) => (
    <Window width={800}>
      <HelpOverlay {...args} />
    </Window>
  ),
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Live controls' });
    await expect(dialog).toBeVisible();
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await expect(screen.queryByText('Hide the controls')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
