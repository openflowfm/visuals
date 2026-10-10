import { useState, type ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { HomeLayout } from './HomeLayout.tsx';
import { TransportBar, type TransportBarProps } from './TransportBar.tsx';

/** The window's width a story draws the bar in (the shell's sidebar takes its share), 1440 by default. */
interface Frame {
  width?: number;
}

/** The bar in the shell's `bar` slot, in a window of the story's width. */
const inWindow: Decorator = (Story, { parameters }) => {
  const width = (parameters.frame as Frame | undefined)?.width ?? 1440;
  return (
    <div style={{ width, height: 240 }}>
      <HomeLayout sidebar={null} header={null} bar={<Story />} />
    </div>
  );
};

/** The bar with play/pause working, reporting to the story's spy. */
function Stateful(props: TransportBarProps): ReactNode {
  const [playing, setPlaying] = useState(props.playing);
  return (
    <TransportBar
      {...props}
      playing={playing}
      onPlayPause={() => {
        setPlaying((p) => !p);
        props.onPlayPause();
      }}
    />
  );
}

/** The macOS layout's bottom bar: HomeBar reduced to the transport (the hero has the preview and the name). */
const meta = {
  title: 'Layout/Transport bar',
  component: TransportBar,
  render: (args) => <Stateful {...args} />,
  decorators: [inWindow],
  args: {
    playing: true,
    onPlayPause: fn(),
    onStep: fn(),
    stepIn: ' in the playlist',
    position: { elapsed: 12, length: 30 },
    onAudioError: fn(),
  },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof TransportBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Moving on by itself, 12 s into 30: pause holds, the steps step, the time reads 0:12 and −0:18. */
export const Playing: Story = {
  play: async ({ canvas, args }) => {
    const track = canvas.getByRole('progressbar', { name: 'time on this preset' });
    await expect(track).toHaveAttribute('aria-valuenow', '12');
    await expect(track).toHaveAttribute('aria-valuemax', '30');
    await expect(canvas.getByText('0:12')).toBeVisible();
    await expect(canvas.getByText('−0:18')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'pause' }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'play' })).toBeVisible());
    await userEvent.click(canvas.getByRole('button', { name: 'previous preset' }));
    await userEvent.click(canvas.getByRole('button', { name: 'next preset' }));
    await userEvent.click(canvas.getByRole('button', { name: 'random preset' }));
    await expect(args.onStep).toHaveBeenNthCalledWith(1, -1);
    await expect(args.onStep).toHaveBeenNthCalledWith(2, 1);
    await expect(args.onStep).toHaveBeenNthCalledWith(3, 0);
  },
};

/** Holding: play shows, and the time stands. */
export const Paused: Story = {
  args: { playing: false },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'play' }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'pause' })).toBeVisible());
  },
};

/** Before anything plays: the keys, and a quiet track with no time. */
export const NothingPlaying: Story = {
  args: { playing: false, position: null, stepIn: '' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('progressbar')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'next preset' })).toBeVisible();
  },
};

/** A long preset, past ten minutes: the time stays in its place. */
export const LongPreset: Story = {
  args: { position: { elapsed: 754, length: 900 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('12:34')).toBeVisible();
    await expect(canvas.getByText('−2:26')).toBeVisible();
  },
};

/** In a 900 px window. */
export const At900: Story = {
  name: 'At 900 px',
  parameters: { frame: { width: 900 } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('progressbar')).toBeVisible();
    const bar = canvasElement.querySelector('.lay-transport') as HTMLElement;
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  },
};

/** In a 1600 px window: the track no wider than its cap, in the middle. */
export const At1600: Story = {
  name: 'At 1600 px',
  parameters: { frame: { width: 1600 } },
  play: async ({ canvasElement }) => {
    const time = canvasElement.querySelector('.lay-transport-time') as HTMLElement;
    await expect(time.getBoundingClientRect().width).toBeLessThanOrEqual(560.5);
  },
};
