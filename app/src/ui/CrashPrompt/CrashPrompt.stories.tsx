import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { CRASHES } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { CrashPrompt } from './CrashPrompt';

const [crash] = CRASHES;

/** Two older crashes kept beside the newest, none offered yet. */
const SEVERAL = [crash, { ...crash, id: 'c-2026-10-02', when: crash.when - 7 * 86_400 }, { ...crash, id: 'c-2026-09-28', when: crash.when - 11 * 86_400 }];

/**
 * The crash prompt on launch, with "Send crash reports" on: the newest crash
 * kept on this Mac that hasn't been offered yet, with its text. It has no other
 * state: Send report opens the GitHub issue and closes it, as Don't send does.
 */
const meta = {
  title: 'open[flow]/visuals/Prompts/CrashPrompt',
  component: CrashPrompt,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { scope: 'bare', layout: 'fullscreen', world: { crashes: CRASHES, crashesEnabled: true } },
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
  parameters: { world: { crashes: SEVERAL } },
  play: async () => {
    await expect(await screen.findByText(/2 earlier crashes are kept on this Mac too/)).toBeInTheDocument();
  },
};
