import { useState, type ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import type { SidebarMode } from './home-model.ts';
import { HomeLayout } from './HomeLayout.tsx';
import { TransportBar, type TransportBarProps } from './TransportBar.tsx';

/** The window's width a story draws the bar in (the shell's sidebar takes its share), 1440 by default. */
interface Frame {
  width?: number;
  /** How the sidebar shows; docked by default. */
  sidebar?: SidebarMode;
}

/** The bar in the shell's `bar` slot, in a window of the story's width. */
const inWindow: Decorator = (Story, { parameters }) => {
  const frame = (parameters.frame as Frame | undefined) ?? {};
  return (
    <div style={{ width: frame.width ?? 1440, height: 240 }}>
      <HomeLayout sidebar={null} sidebarMode={frame.sidebar} header={null} bar={<Story />} />
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
    // The bar sits on the main column's surface (the hero's spread shadow paints it) and paints none of its own.
    const bar = canvas.getByRole('button', { name: 'next preset' }).closest('.lay-transport');
    await expect(bar).not.toBeNull();
    await expect(getComputedStyle(bar!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  },
};

/** Staying until moved on (held, on Link's bars, moving on by itself off): the time on it counts, with no end and no countdown. */
export const UntilMovedOn: Story = {
  name: 'Until moved on',
  args: { position: { elapsed: 75, length: null } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('timer', { name: /time on this preset: 1:15/ })).toHaveTextContent('1:15');
    await expect(canvas.queryByRole('progressbar')).toBeNull();
    await expect(canvasElement.querySelector('.lay-transport-fill')).toBeNull();
    await expect(canvas.queryByText(/^−/)).toBeNull();
  },
};

/** In an 800 px window with no sidebar docked: the time gives way, and never runs under the audio input. */
export const At800: Story = {
  name: 'At 800 px',
  parameters: { frame: { width: 800, sidebar: 'hidden' } },
  play: async ({ canvasElement }) => {
    const time = (canvasElement.querySelector('.lay-transport-time') as HTMLElement).getBoundingClientRect();
    const right = (canvasElement.querySelector('.lay-transport-right') as HTMLElement).getBoundingClientRect();
    const keys = (canvasElement.querySelector('.lay-transport-keys') as HTMLElement).getBoundingClientRect();
    await expect(time.right).toBeLessThanOrEqual(right.left + 0.5);
    await expect(time.left).toBeGreaterThanOrEqual(keys.right - 0.5);
    const bar = canvasElement.querySelector('.lay-transport') as HTMLElement;
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  },
};

/** At full speed the bar says nothing of the frame rate, in a developer's build too. */
export const FullSpeed: Story = {
  name: 'At full speed',
  play: async ({ canvasElement }) => {
    // The readout polls once a second; give it a few readings.
    await new Promise((r) => setTimeout(r, 3500));
    await expect(canvasElement.querySelector('.vf-stats')).toBeNull();
  },
};

/** The picture drawing slowly for a few seconds: the amber warning, before the audio input. */
export const Slow: Story = {
  name: 'Drawing slowly',
  parameters: { tauri: { stats: { fps: 24, cpu_ms: 31 } } },
  play: async ({ canvas, canvasElement }) => {
    const warning = await canvas.findByText('running slowly: 24 fps', {}, { timeout: 6000 });
    await expect(warning).toHaveAttribute('data-slow');
    await expect(warning.closest('.lay-transport-right')).not.toBeNull();
    const bar = canvasElement.querySelector('.lay-transport') as HTMLElement;
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
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

/** The preset playing left of the time: its name, and where it plays from quieter, on one line. */
export const NowPlaying: Story = {
  name: 'Now playing',
  args: { now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Flexi - mindblob mix')).toBeVisible();
    await expect(canvas.getByText(/from Warm-up/)).toBeVisible();
    const now = (canvasElement.querySelector('.lay-transport-now') as HTMLElement).getBoundingClientRect();
    const time = (canvasElement.querySelector('.lay-transport-time') as HTMLElement).getBoundingClientRect();
    await expect(now.right).toBeLessThanOrEqual(time.left + 0.5);
    // One line.
    await expect(now.height).toBeLessThan(24);
  },
};

/** A long name in an 800 px window with no sidebar: it ellipsises; the keys, the time and the audio input keep their places, nothing overlapping. */
export const NowLongAt800: Story = {
  name: 'Now playing, long name, 800 px',
  parameters: { frame: { width: 800, sidebar: 'hidden' } },
  args: {
    now: {
      name: 'Geiss + Rovastar + Zylot + Flexi - the longest title anyone ever gave a MilkDrop preset, (Phat edit) [remix of a remix]',
      from: 'from the library · 1,204 of 9,795',
    },
  },
  play: async ({ canvasElement }) => {
    const rect = (sel: string) => (canvasElement.querySelector(sel) as HTMLElement).getBoundingClientRect();
    const keys = rect('.lay-transport-keys');
    const now = rect('.lay-transport-now');
    const time = rect('.lay-transport-time');
    const right = rect('.lay-transport-right');
    await expect(now.left).toBeGreaterThanOrEqual(keys.right - 0.5);
    await expect(now.right).toBeLessThanOrEqual(time.left + 0.5);
    await expect(time.right).toBeLessThanOrEqual(right.left + 0.5);
    const el = canvasElement.querySelector('.lay-transport-now') as HTMLElement;
    // Ellipsised on one line.
    await expect(el.scrollWidth).toBeGreaterThan(el.clientWidth);
    await expect(now.height).toBeLessThan(24);
    // The time keeps a usable width.
    await expect(time.width).toBeGreaterThanOrEqual(100);
    const bar = canvasElement.querySelector('.lay-transport') as HTMLElement;
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  },
};

/** The length run out (30 s of 30, or past it): the time on it alone, not a countdown stuck at −0:00. */
export const RunOut: Story = {
  name: 'Length run out',
  args: { position: { elapsed: 31, length: 30 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('timer', { name: 'time on this preset: 0:31' })).toHaveTextContent('0:31');
    await expect(canvas.queryByRole('progressbar')).toBeNull();
    await expect(canvas.queryByText(/^−/)).toBeNull();
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
