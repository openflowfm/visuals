import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { CrashPrompt } from './CrashPrompt.tsx';
import { CRASHES } from './stories/fixtures.ts';

const [crash] = CRASHES;

/** Two older crashes kept beside the newest, none offered yet. */
const SEVERAL = [crash, { ...crash, id: 'c-2026-10-02', when: crash.when - 7 * 86_400 }, { ...crash, id: 'c-2026-09-28', when: crash.when - 11 * 86_400 }];

/**
 * The crash prompt on launch, with "Send crash reports" on: the newest crash
 * kept on this Mac that hasn't been offered yet, with its text. It has no other
 * state: Send report opens the GitHub issue and closes it, as Don't send does.
 */
const meta = {
  title: 'Prompts/CrashPrompt',
  component: CrashPrompt,
  parameters: { scope: 'bare', layout: 'fullscreen', tauri: { crashes: CRASHES, crashesEnabled: true } },
} satisfies Meta<typeof CrashPrompt>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One unsent report: what Send report does, the reminder to read it first, and the report's text. */
export const OneReport: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'visual[flow] crashed last time' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/GPU device lost/)).toBeVisible());
  },
};

/** The newest of three, saying the two earlier ones are kept too. */
export const EarlierCrashesKept: Story = {
  parameters: { tauri: { crashes: SEVERAL } },
  play: async () => {
    await expect(await screen.findByText(/2 earlier crashes are kept on this Mac too/)).toBeInTheDocument();
  },
};
