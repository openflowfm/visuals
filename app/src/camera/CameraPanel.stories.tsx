import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';
import { CameraPanel, CameraProvider } from './CameraPanel';
import { CameraController } from './controller';
function Fixture(props: { open: boolean; onClose(): void }) {
  const [controller] = useState(
    () =>
      new CameraController({
        enumerate: async () => [
          { deviceId: 'anonymous', label: '' },
          { deviceId: 'desk', label: 'Desk camera' },
        ],
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
    await expect(panel.getByRole('combobox', { name: 'Camera device' })).toHaveTextContent('System default camera');
    await userEvent.click(panel.getByRole('combobox', { name: 'Camera device' }));
    await userEvent.keyboard('{End}{Enter}');
    await expect(panel.getByRole('combobox', { name: 'Camera device' })).toHaveTextContent('Desk camera');
    await expect(panel.getByRole('switch', { name: 'Enable camera' })).toHaveAttribute('aria-checked', 'false');
    for (const name of ['Source', 'Appearance', 'Motion']) await expect(panel.getByRole('region', { name })).toBeVisible();
    const opacity = panel.getByRole('slider', { name: 'Camera opacity' });
    const thumb = opacity.querySelector('.wdg-slider-thumb') as HTMLElement;
    const fill = opacity.querySelector('.wdg-slider-fill') as HTMLElement;
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    const low = opacity.getBoundingClientRect();
    await expect(low.height).toBe(44);
    await expect(thumb.getBoundingClientRect().height).toBe(16);
    await expect(fill.getBoundingClientRect().height).toBe(5);
    const center = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    await expect(center(fill)).toBeCloseTo(center(thumb), 0);
    await expect(getComputedStyle(panel.getByRole('status')).color).toBe('rgb(164, 164, 172)');
    await expect(getComputedStyle(await screen.findByRole('dialog', { name: 'Camera' })).borderRadius).toBe('18px');
    await expect(thumb.getBoundingClientRect().left).toBeCloseTo(low.left, 0);
    await userEvent.click(opacity);
    await expect(opacity).toHaveFocus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(opacity).toHaveAttribute('aria-valuenow', '100'));
    await expect(thumb.getBoundingClientRect().right).toBeCloseTo(opacity.getBoundingClientRect().right, 0);
    await expect(center(fill)).toBeCloseTo(center(thumb), 0);
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(opacity).toHaveAttribute('aria-valuenow', '0'));
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
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable camera' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission denied');
  },
};
