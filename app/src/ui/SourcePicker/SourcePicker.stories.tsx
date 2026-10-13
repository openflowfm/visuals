import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { SOURCES } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { SourcePicker } from './SourcePicker';

/** What the app listens to, with its levels. No story in the original. */
const meta = {
  title: 'open[flow]/visuals/Controls/SourcePicker',
  component: SourcePicker,
  args: { onError: fn(), channels: 'advanced', width: 180 },
  // Room under the picker for Advanced and the menus to hang into.
  decorators: [
    (Story) => (
      <div style={{ minHeight: 200, padding: 8 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof SourcePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Hearing your DAW, the channels under Advanced. */
export const Hearing: Story = {
  play: async ({ canvas }) => {
    const picker = await canvas.findByRole('combobox', { name: 'listen to' });
    await expect(picker).toHaveTextContent('Ableton Live 12');
    await expect(picker).toHaveAttribute('title', 'Listen to: Ableton Live 12. Or pick your DAW, everything on this Mac, or a microphone or interface');
    await expect(canvas.getAllByRole('meter')).toHaveLength(2);
  },
};

/** Advanced open: the left and right channel pickers float under it. */
export const Advanced: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole('combobox', { name: 'listen to' });
    await userEvent.click(canvas.getByLabelText('Audio mixer: main and microphone inputs'));
    await expect(canvas.getByRole('combobox', { name: 'left channel' })).toBeVisible();
  },
};

/** In ⚙ Settings: the channels shown under the picker. */
export const ChannelsShown: Story = {
  args: { channels: 'shown' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('group', { name: 'left and right channels' })).toBeVisible();
  },
};

/** The home's bottom bar: no channels here. */
export const NoChannels: Story = {
  args: { channels: 'none' },
};

/** Silent: the meters empty. */
export const Silent: Story = {
  parameters: { world: { levels: [0, 0] } },
};

/** macOS refused the tap: the caution note says where to allow it. */
export const Denied: Story = {
  parameters: { world: { heard: { choice: null, channels: 0, denied: true } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/^not allowed to hear other apps/)).toBeVisible();
  },
};

/** Nothing to listen to at all: said so instead of an empty picker. */
export const Nothing: Story = {
  parameters: {
    world: {
      sources: { ...SOURCES, sources: [] },
      heard: { choice: null, channels: 0 },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('combobox', { name: 'listen to' })).toHaveTextContent('Off');
  },
};

/** Failing: what is heard can't be read; the caller hears the error. */
export const Failing: Story = {
  parameters: { world: { fail: { audio_status: 'the audio engine stopped' } } },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onError).toHaveBeenCalled());
  },
};
