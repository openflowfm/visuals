import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { visualsBeforeEach } from '../fixtures/story';
import { SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { VisualsApp } from './App';

/** The production window owns its frame: deliberately no theme or frame decorators.
 * The component stories exercise embedded frames; this catches viewport insets and clipping
 * in the default VisualsApp path actually mounted by the native host. */
const meta = {
  title: 'open[flow]/visuals/Window',
  component: VisualsApp,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof VisualsApp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const win = canvasElement.ownerDocument.defaultView!;
    await waitFor(() => expect(canvasElement.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull(), { timeout: 10_000 });
    await waitFor(() => {
      const app = canvasElement.querySelector('.vs-app')!.getBoundingClientRect();
      expect(app.x).toBe(0);
      expect(app.y).toBe(0);
      expect(Math.abs(app.width - win.innerWidth)).toBeLessThan(1);
      expect(Math.abs(app.height - win.innerHeight)).toBeLessThan(1);
      const transport = canvas.getByRole('region', { name: 'transport' }).getBoundingClientRect();
      expect(transport.bottom).toBeLessThanOrEqual(win.innerHeight + 1);
      const next = canvas.getByRole('button', { name: 'next preset' }).getBoundingClientRect();
      expect(next.height).toBeGreaterThan(0);
      expect(next.bottom).toBeLessThanOrEqual(win.innerHeight);
      expect(next.top).toBeGreaterThanOrEqual(0);
      expect(canvasElement.ownerDocument.documentElement.scrollHeight).toBeLessThanOrEqual(win.innerHeight);
    });
  },
};
