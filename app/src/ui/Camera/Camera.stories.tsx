import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within, waitFor, fireEvent } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { CameraPanel, CameraProvider } from './Camera';
import { cameraFixture } from './fixture';
function Fixture({ denied = false }: { denied?: boolean }) {
  const [controller] = useState(() => cameraFixture(denied));
  return (
    <CameraProvider controller={controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>
  );
}
const meta = {
  title: 'open[flow]/visuals/Sheets/Camera',
  component: Fixture,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Off: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of ['Source', 'Appearance', 'Motion']) await expect(canvas.getByRole('group', { name })).toBeVisible();
    const camera = canvas.getByRole('slider', { name: 'Camera opacity' });
    fireEvent.keyDown(camera, { key: 'End' });
    await waitFor(() => expect(camera).toHaveAttribute('aria-valuenow', '100'));
    await expect(canvas.getByRole('slider', { name: 'Outline opacity' })).toHaveAttribute('aria-valuenow', '65');
    await userEvent.click(canvas.getByRole('switch', { name: 'Enable camera' }));
    await expect(canvas.getByRole('switch', { name: 'Enable camera' })).toHaveAttribute('aria-checked', 'true');
  },
};
export const Denied: Story = { args: { denied: true } };
