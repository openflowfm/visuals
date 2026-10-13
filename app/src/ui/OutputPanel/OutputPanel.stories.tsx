import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Layer } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { DISPLAYS, OUTPUT_OFF, OUTPUT_ON } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { OutputPanel, OutputSettings } from './OutputPanel';

/** The output, as the Stage's popover shows it: in a float layer, no panel of its own. No story in the original. */
const meta = {
  title: 'open[flow]/visuals/Controls/OutputPanel',
  component: OutputPanel,
  args: { status: OUTPUT_OFF, show: fn() },
  decorators: [
    (Story) => (
      <Layer level="float" style={{ width: 340, padding: 'var(--space-4)', borderRadius: 'var(--radius-card)' }}>
        <Story />
      </Layer>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof OutputPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Off: playing in the window, Show opens it on the projector (the first display without the menu bar). */
export const Off: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText('Not showing')).toBeVisible();
    await expect(await canvas.findByRole('combobox', { name: 'Display' })).toHaveTextContent('2. Projector (HDMI)');
    await userEvent.click(canvas.getByRole('button', { name: 'Show' }));
    await expect(args.show).toHaveBeenCalledWith(2);
  },
};

/** On the projector: the signal's green, the picture's fit. */
export const On: Story = {
  args: { status: OUTPUT_ON },
  parameters: { world: { output: OUTPUT_ON } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Showing on Projector (HDMI)')).toHaveAttribute('data-on');
  },
};

/** Covering the display with the menu bar: the caution note. */
export const OnMenuBar: Story = {
  args: { status: { display: DISPLAYS[0], size: [3024, 1964] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('note')).toHaveTextContent('covering the display with the menu bar');
  },
};

/** Only the built-in display: the output would cover this window too. */
export const OneDisplay: Story = {
  parameters: { world: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('note')).toHaveTextContent('Only one display is connected');
  },
};

/** No displays read (failing): said so in place of the picker. */
export const NoDisplays: Story = {
  parameters: { world: { fail: { displays: 'no displays' } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No displays found.')).toBeVisible();
  },
};

/** In ⚙ Settings, while live: the picker moves the output. */
export const Settings: Story = {
  parameters: { world: { output: OUTPUT_ON } },
  render: () => <OutputSettings />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Showing on Projector (HDMI).')).toBeVisible();
  },
};

/** In ⚙ Settings, not live: the picker is off until live mode. */
export const SettingsOff: Story = {
  render: () => <OutputSettings />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('combobox', { name: 'Display' })).toBeDisabled();
  },
};

/** The render settings under the display: 1080p at 150% draws 2880 × 1620, kept by the model. */
export const Render: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('status')).toHaveTextContent('1920 × 1080 at 100%');
    await userEvent.click(canvas.getByRole('combobox', { name: 'Resolution' }));
    await userEvent.click(await canvas.findByRole('option', { name: '1080p' }));
    await userEvent.click(canvas.getByRole('radio', { name: '150%' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('2880 × 1620 at 150%');
    await userEvent.click(canvas.getByRole('radio', { name: '30' }));
    await expect(canvas.getByRole('radio', { name: '30' })).toBeChecked();
  },
};
