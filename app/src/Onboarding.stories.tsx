import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';
import { useAccessibility } from './access.ts';
import { FlashWarningDialog, Onboarding, WARNING_TEXT } from './Onboarding.tsx';

/** What `App` mounts once: reads the reduce-flashing setting the warning's switch follows. */
function Accessible({ children }: { children: ReactNode }) {
  useAccessibility();
  return children;
}

/**
 * The welcome flow, filling the window, and the flashing-lights warning: as
 * the flow's own step, and as the dialog over any view (owed after a skipped
 * setup, or asked for from the menu's Flashing Lights Warning…).
 */
const meta = {
  title: 'Prompts/Onboarding',
  component: Onboarding,
  args: { onDone: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen', tauri: { firstRun: true, flashUnderstood: false } },
  decorators: [
    (Story) => (
      <Accessible>
        <Story />
      </Accessible>
    ),
  ],
} satisfies Meta<typeof Onboarding>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: what the app is, Start and Skip setup. */
export const Welcome: Story = {
  play: async () => {
    await expect(await screen.findByRole('heading', { name: /Welcome to/ })).toBeVisible();
  },
};

/** The flow's warning step: the warning, the reduce-flashing switch, and I understand. */
export const WarningStep: Story = {
  args: { start: 'warning' },
  play: async () => {
    await expect(await screen.findByRole('heading', { name: 'Flashing lights' })).toBeVisible();
    await expect(screen.getByText(WARNING_TEXT)).toBeVisible();
    // The reduce-flashing switch, enabled once the app has said where it stands.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reduce flashing' })).toBeEnabled());
  },
};

/** The warning owed (setup skipped before it): over the page, and only I understand closes it. */
export const WarningOwed: Story = {
  render: () => <FlashWarningDialog required onClose={fn()} onUnderstood={fn()} />,
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Flashing lights' })).toBeVisible();
  },
};

/**
 * A window of `width` × 900 over the picture's stand-in, whatever the runner's
 * viewport: its transform makes it the dialog's containing block, so the fixed
 * scrim and dialog lay out in it as they would in a window that size.
 */
function Window({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ position: 'relative', width, height: 900, overflow: 'hidden', transform: 'translateZ(0)', background: 'var(--sb-still) center / cover no-repeat #000' }}>{children}</div>;
}

/** Owed, in a 1440 px window: the switch on its raised row, enabled once the app has said, and I understand. */
export const WarningAt1440: Story = {
  name: 'Warning at 1440 px',
  globals: { viewport: { value: 'home1440', isRotated: false } },
  render: () => (
    <Window width={1440}>
      <FlashWarningDialog required onClose={fn()} onUnderstood={fn()} />
    </Window>
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Flashing lights' });
    await expect(dialog).toBeVisible();
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reduce flashing' })).toBeEnabled());
    await expect(screen.getByRole('button', { name: 'I understand' })).toBeVisible();
  },
};

/** Asked for from the menu, in an 800 px window, with reduce flashing turned on here: the switch shows on. */
export const WarningAt800: Story = {
  name: 'Warning at 800 px',
  parameters: { tauri: { firstRun: false, flashUnderstood: true, motion: { reduced: true, system: false } } },
  globals: { viewport: { value: 'home900', isRotated: false } },
  render: () => (
    <Window width={800}>
      <FlashWarningDialog onClose={fn()} onUnderstood={fn()} />
    </Window>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Flashing lights' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reduce flashing' })).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** Asked for again from the menu: the same dialog, which Esc or a click beside it also closes. */
export const WarningAsked: Story = {
  parameters: { tauri: { firstRun: false, flashUnderstood: true } },
  render: () => <FlashWarningDialog onClose={fn()} onUnderstood={fn()} />,
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'I understand' })).toBeVisible();
  },
};
