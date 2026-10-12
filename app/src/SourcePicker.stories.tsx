import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import { SourcePicker } from './SourcePicker.tsx';
const meta = {
  title: 'Player/Audio mixer',
  component: SourcePicker,
  args: { onError: fn(), channels: 'shown' },
  render: (args) => (
    <div className="settings" style={{ width: 320, padding: 20 }}>
      <SourcePicker {...args} />
    </div>
  ),
} satisfies Meta<typeof SourcePicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BothInputs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const main = canvas.getByRole('combobox', { name: 'listen to' });
    await waitFor(() => expect(main).toHaveTextContent('Ableton Live 12'));
    const mic = canvas.getByRole('combobox', { name: 'microphone input' });
    mic.focus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(mic).toHaveTextContent('MacBook Pro Microphone'));
    await expect(main).toHaveTextContent('Ableton Live 12');
    await expect(canvas.getByRole('combobox', { name: 'microphone right channel' })).toHaveTextContent('R 1');
    main.focus();
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(main).toHaveTextContent('Off'));
    await expect(mic).toHaveTextContent('MacBook Pro Microphone');
  },
};
export const Compact: Story = {
  args: { channels: 'none', width: 140 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Mixer'));
    await expect(canvas.getByRole('combobox', { name: 'microphone input' })).toBeVisible();
  },
};
