import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { useAccessibility } from '../model/access';
import { FlashWarningDialog, Onboarding, WARNING_TEXT } from './Onboarding';

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
  title: 'open[flow]/visuals/Prompts/Onboarding',
  component: Onboarding,
  args: { onDone: fn() },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { scope: 'bare', layout: 'fullscreen', world: { firstRun: true, flashUnderstood: false } },
  decorators: [
    (Story) => (
      <Accessible>
        <Story />
      </Accessible>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof Onboarding>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: what the app is, Start and Skip setup. */
export const Welcome: Story = {
  args: { start: 'welcome' },
  play: async () => {
    await expect(await screen.findByRole('heading', { name: /Welcome to/ })).toBeVisible();
  },
};

/**
 * Listen to: the preview fills the window behind the words' card. Test sound plays music through
 * the speakers and into the visuals; while it plays the button stops it, and a note says the
 * picker waits for that.
 */
export const ListenStep: Story = {
  args: { start: 'listen' },
  play: async () => {
    await expect(await screen.findByRole('heading', { level: 1 })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /▶ Test sound/ }));
    const stop = await screen.findByRole('button', { name: /■ Stop test sound/ });
    await expect(screen.getByText(/Stop the test sound to choose what to/)).toBeVisible();
    await userEvent.click(stop);
    await expect(await screen.findByRole('button', { name: /▶ Test sound/ })).toBeVisible();
    await waitFor(() => expect(screen.queryByText(/Stop the test sound to choose what to/)).toBeNull());
  },
};

/** The flow's warning step:the warning, the reduce-flashing switch, and I understand. */
export const WarningStep: Story = {
  args: { start: 'warning' },
  play: async () => {
    await expect(await screen.findByRole('heading', { name: 'Flashing lights' })).toBeVisible();
    await expect(screen.getByText(WARNING_TEXT)).toBeVisible();
    // The reduce-flashing switch, enabled once the app has said where it stands.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Reduce flashing' })).toBeEnabled());
    // Named once, beside the switch: no second caption inside it.
    await expect(screen.getAllByText('Reduce flashing')).toHaveLength(1);
    // The name flips it too.
    await userEvent.click(screen.getByText('Reduce flashing'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Reduce flashing' })).toHaveAttribute('aria-checked', 'true'));
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
  return (
    <div style={{ position: 'relative', width, height: 900, overflow: 'hidden', transform: 'translateZ(0)', background: 'var(--vs-still) center / cover no-repeat var(--key-black)' }}>{children}</div>
  );
}

/** Owed, in a 1440 px window: the switch on its raised row, enabled once the app has said, and I understand. */
export const WarningAt1440: Story = {
  name: 'Warning at 1440 px',
  render: () => (
    <Window width={1440}>
      <FlashWarningDialog required onClose={fn()} onUnderstood={fn()} />
    </Window>
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Flashing lights' });
    await expect(dialog).toBeVisible();
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Reduce flashing' })).toBeEnabled());
    await expect(screen.getByRole('button', { name: 'I understand' })).toBeVisible();
  },
};

/** Asked for from the menu, in an 800 px window, with reduce flashing turned on here: the switch shows on. */
export const WarningAt800: Story = {
  name: 'Warning at 800 px',
  parameters: { world: { firstRun: false, flashUnderstood: true, motion: { reduced: true, system: false } } },
  render: () => (
    <Window width={800}>
      <FlashWarningDialog onClose={fn()} onUnderstood={fn()} />
    </Window>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Flashing lights' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Reduce flashing' })).toHaveAttribute('aria-checked', 'true'));
  },
};

/** Asked for again from the menu: the same dialog, which Esc or a click beside it also closes. */
export const WarningAsked: Story = {
  parameters: { world: { firstRun: false, flashUnderstood: true } },
  render: () => <FlashWarningDialog onClose={fn()} onUnderstood={fn()} />,
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'I understand' })).toBeVisible();
  },
};
