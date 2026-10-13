import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { SOURCES } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { AudioInput } from './AudioInput';

/** The header's source picker, Advanced for the channels. No story in the original. */
const meta = {
  title: 'open[flow]/visuals/Controls/AudioInput',
  component: AudioInput,
  args: { onError: fn() },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 160, padding: 8 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof AudioInput>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Hearing your DAW. */
export const On: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('combobox', { name: 'listen to' })).toHaveTextContent('Ableton Live 12');
  },
};

/** Hearing an app that has quit: its name first, the rest to pick from. */
export const Gone: Story = {
  parameters: { world: { heard: { choice: { name: 'Logic Pro', left: 1, right: 2, size: 2 }, channels: 2 } } },
};

/** Nothing to listen to. */
export const Off: Story = {
  parameters: { world: { sources: { ...SOURCES, sources: [] } } },
};
