import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { CameraPanel, CameraProvider } from './CameraPanel';
import { CameraController } from './controller';
function Fixture({ denied = false, ...props }: { denied?: boolean; open: boolean; onClose(): void }) {
  const [controller] = useState(
    () =>
      new CameraController({
        acquire: async () => {
          throw new Error('Camera permission denied. Check camera access in system settings.');
        },
        source: () => {
          throw new Error('Fixture never accesses a camera');
        },
        begin: async () => 'fixture',
        end: async () => {},
        submit: async (frame) => frame.sequence,
        now: () => performance.now(),
      }),
  );
  return (
    <CameraProvider controller={controller}>
      <CameraPanel {...props} />
    </CameraProvider>
  );
}
const meta = {
  title: 'Sheets/Camera',
  component: CameraPanel,
  args: { open: true, onClose: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  render: (args) => <Fixture {...args} />,
} satisfies Meta<typeof CameraPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Off: Story = {
  play: async ({ args }) => {
    const panel = within(await screen.findByRole('dialog', { name: 'Camera' }));
    await expect(panel.getByRole('slider', { name: 'Camera opacity' })).toHaveAttribute('aria-valuenow', '0');
    await expect(panel.getByRole('slider', { name: 'Outline opacity' })).toHaveAttribute('aria-valuenow', '65');
    await userEvent.click(panel.getByRole('button', { name: 'Bring my outline back' }));
    await expect(panel.getByRole('slider', { name: 'Camera opacity' })).toHaveAttribute('aria-valuenow', '0');
    await expect(panel.getByRole('slider', { name: 'Outline opacity' })).toHaveAttribute('aria-valuenow', '100');
    await userEvent.click(panel.getByRole('button', { name: 'Close camera' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
export const PermissionDenied: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Enable camera' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission denied');
  },
};
