import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Status } from './Status.tsx';
import { FX, LINK_OFF, OUTPUT_OFF, OUTPUT_ON } from './stories/fixtures.ts';
// Live mode's look, which `Live.tsx` brings in the app.
import './live.css';

/**
 * Live mode's status strip: the audio, beat and output lights, the frame rate
 * when it is low, ? and ⚙, and ✕ apart. Each light opens its panel under it.
 */
const meta = {
  title: 'Live/Status',
  component: Status,
  args: { output: OUTPUT_ON, effects: FX, show: fn(), onHelp: fn(), onTap: fn(), onLeave: fn(), onError: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
  decorators: [
    (Story) => (
      <div className="live" style={{ height: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Status>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Link on with two peers at 124 BPM, the picture on the projector. */
export const LinkOn: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Output, on Projector (HDMI)' })).toBeVisible();
  },
};

/** Link off: the tapped tempo, no peers. */
export const LinkOff: Story = {
  args: { effects: { ...FX, linked: false } },
  parameters: { tauri: { link: LINK_OFF } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: /^Beat, 124 BPM$/ })).toBeVisible();
  },
};

/** The output closed: the picture only in this window, said in amber. */
export const OutputClosed: Story = {
  args: { output: OUTPUT_OFF },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('in this window')).toBeVisible();
  },
};

/** Drawing slowly: the frame rate shows once it is under 50. */
export const SlowFrames: Story = {
  parameters: { tauri: { stats: { fps: 24, cpu_ms: 31 } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('24 fps', undefined, { timeout: 3000 })).toBeVisible();
  },
};

/** The beat light's panel open: tap tempo and Ableton Link. */
export const BeatOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Beat/ }));
  },
};

/** The output light's panel open: where the picture goes. */
export const OutputOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^Output/ }));
  },
};
