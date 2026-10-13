import { useEffect, useState, type ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import type { SidebarMode } from '../model/home-model';
import { HomeLayout } from '../HomeLayout/HomeLayout';
import { Hero } from '../Hero/Hero';
import { TransportBar, type TransportBarProps } from './TransportBar';

/** The window's width a story draws the bar in (the shell's sidebar takes its share), 1440 by default. */
interface Frame {
  width?: number;
  /** How the sidebar shows; docked by default. */
  sidebar?: SidebarMode;
}

/** The docked sidebar's share of the window (its 240px panel and 8px inset). */
const SIDE = 248;

/**
 * The transport over the preview's foot (Hero's `controls`, as on the home), in the shell's hero
 * slot, in a window of the story's width; `layout` is `overlay` unless a story says otherwise.
 * Touch has no hover, so the stories' canvas shows the controls only under the pointer: a story
 * reads them, never their opacity.
 */
const inWindow: Decorator = (Story, { parameters, args }) => {
  const frame = (parameters.frame as Frame | undefined) ?? {};
  if (args.layout === 'bar')
    // Live mode's docked bar: the column's width, the bar's own height.
    return (
      <div style={{ width: (frame.width ?? 1440) - (frame.sidebar === 'hidden' ? 0 : SIDE) }}>
        <Story />
      </div>
    );
  return (
    <div style={{ width: frame.width ?? 1440, height: 640 }}>
      <HomeLayout sidebar={null} sidebarMode={frame.sidebar} header={null} hero={<Hero picture={null} controls={<Story />} />} />
    </div>
  );
};

/** The bar with the ring working (a click holds or lets go), reporting to the story's spy. */
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

/** As Home drives it: the time on the preset ticking once a second while it moves on by itself, the next preset at the length, held while held. */
function Ticking(props: TransportBarProps): ReactNode {
  const [playing, setPlaying] = useState(props.playing);
  const length = props.position?.length ?? 10;
  const [elapsed, setElapsed] = useState(props.position?.elapsed ?? 0);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setElapsed((e) => (e + 1 >= length ? 0 : e + 1)), 1000);
    return () => window.clearInterval(t);
  }, [playing, length]);
  return (
    <TransportBar
      {...props}
      playing={playing}
      position={{ elapsed, length: playing ? length : null }}
      onPlayPause={() => {
        setPlaying((p) => !p);
        props.onPlayPause();
      }}
    />
  );
}

/** The transport and the preset playing: docked along live mode's foot, or floating over Home's preview (`Overlay`). */
const meta = {
  title: 'open[flow]/visuals/Layout/Transport bar',
  component: TransportBar,
  render: (args) => <Stateful {...args} />,
  decorators: [inWindow, withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: {
    playing: true,
    onPlayPause: fn(),
    onStep: fn(),
    stepIn: ' in the playlist',
    position: { elapsed: 12, length: 30 },
    onAudioError: fn(),
    // As Home has it with a playlist moving on by itself.
    moves: true,
    // The bar's own layout (live mode's dock); `Overlay` shows it floating over the preview, as Home has it.
    layout: 'bar',
  },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof TransportBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The auto-change key: the toggle named "move on by itself". */
const ring = (canvas: { getByRole: (role: string, o: { name: string }) => HTMLElement }) => canvas.getByRole('button', { name: 'move on by itself' });

/** Moving on by itself, 12 s into 30: the ring pressed and two fifths round, saying when it moves on; a click holds; the steps step. No playhead, no time. */
export const Playing: Story = {
  play: async ({ canvas, canvasElement, args }) => {
    const key = ring(canvas);
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await expect(key).toHaveAttribute('data-fill', '0.400');
    await expect(key).toHaveAttribute('title', 'Moves on in 0:18 · click or H to stay on this preset');
    await expect(canvas.queryByRole('progressbar')).toBeNull();
    await expect(canvas.queryByRole('timer')).toBeNull();
    await expect(canvasElement.querySelector('.vs-transport')!.textContent).not.toMatch(/\d:\d\d/);
    await userEvent.click(key);
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(ring(canvas)).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(canvas.getByRole('button', { name: 'previous preset' }));
    await userEvent.click(canvas.getByRole('button', { name: 'next preset' }));
    await userEvent.click(canvas.getByRole('button', { name: 'random preset' }));
    await expect(args.onStep).toHaveBeenNthCalledWith(1, -1);
    await expect(args.onStep).toHaveBeenNthCalledWith(2, 1);
    await expect(args.onStep).toHaveBeenNthCalledWith(3, 0);
  },
};

/** Holding: the ring empty and dimmed, saying it stays; a click lets it move on again. */
export const Paused: Story = {
  args: { playing: false },
  play: async ({ canvas, args }) => {
    const key = ring(canvas);
    await expect(key).toHaveAttribute('aria-pressed', 'false');
    await expect(key).toHaveAttribute('data-fill', '0.000');
    await expect(key).toHaveAttribute('data-state', 'held');
    await expect(key).toHaveAttribute('title', 'Staying on this preset · click or H to move on by itself');
    await userEvent.click(key);
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(ring(canvas)).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** Before anything plays: the keys, the ring quiet. */
export const NothingPlaying: Story = {
  args: { playing: false, position: null, stepIn: '' },
  play: async ({ canvas }) => {
    await expect(ring(canvas)).toHaveAttribute('data-state', 'off');
    await expect(canvas.getByRole('button', { name: 'next preset' })).toBeVisible();
  },
};

/** Staying until moved on (on Link's bars, moving on by itself off): the plain loop, nothing to fill. */
export const UntilMovedOn: Story = {
  name: 'Until moved on',
  args: { position: { elapsed: 75, length: null } },
  play: async ({ canvas, canvasElement }) => {
    const key = ring(canvas);
    await expect(key).toHaveAttribute('data-state', 'endless');
    await expect(key).toHaveAttribute('data-fill', '0.000');
    await expect(key).toHaveAttribute('title', 'Moves on by itself · click or H to stay on this preset');
    await expect(canvasElement.querySelector('.vs-transport-loop-fill')).toBeNull();
  },
};

/** The deck ticking as Home drives it, a 10 s preset: the ring fills a tenth a second, and starts again from empty, never running back; a click holds it empty and dim. */
export const Fills: Story = {
  name: 'Fills to the change',
  render: (args) => <Ticking {...args} />,
  args: { position: { elapsed: 7, length: 10 } },
  play: async ({ canvas, canvasElement }) => {
    const key = ring(canvas);
    await expect(key).toHaveAttribute('data-fill', '0.700');
    await waitFor(() => expect(key).toHaveAttribute('data-fill', '0.800'), { timeout: 1500 });
    // Round to the change, then empty again at once.
    await waitFor(() => expect(key).toHaveAttribute('data-fill', '0.000'), { timeout: 3500 });
    await expect(canvasElement.querySelector('.vs-transport-loop-fill')).toHaveAttribute('data-back');
    await waitFor(() => expect(key).toHaveAttribute('data-fill', '0.100'), { timeout: 1500 });
    await expect(canvasElement.querySelector('.vs-transport-loop-fill')).not.toHaveAttribute('data-back');
    await userEvent.click(key);
    await waitFor(() => expect(key).toHaveAttribute('data-state', 'held'));
    await expect(key).toHaveAttribute('data-fill', '0.000');
  },
};

/** The length run out (30 s of 30, or past it): the ring full, the arrowhead lit, moving on. */
export const RunOut: Story = {
  name: 'Length run out',
  args: { position: { elapsed: 31, length: 30 } },
  play: async ({ canvas, canvasElement }) => {
    await expect(ring(canvas)).toHaveAttribute('data-fill', '1.000');
    await expect(ring(canvas)).toHaveAttribute('title', 'Moving on · click or H to stay on this preset');
    await expect(canvasElement.querySelector('.vs-transport-loop-head')).toHaveAttribute('data-lit');
  },
};

/** A long preset, past ten minutes: the tooltip counts it in minutes. */
export const LongPreset: Story = {
  args: { position: { elapsed: 754, length: 900 } },
  play: async ({ canvas }) => {
    await expect(ring(canvas)).toHaveAttribute('title', 'Moves on in 2:26 · click or H to stay on this preset');
  },
};

/** In an 800 px window with no sidebar docked: the middle never runs under the keys or the audio input. */
export const At800: Story = {
  name: 'At 800 px',
  parameters: { frame: { width: 800, sidebar: 'hidden' } },
  args: { now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
};

/** At full speed the bar says nothing of the frame rate, in a developer's build too. */
export const FullSpeed: Story = {
  name: 'At full speed',
  play: async ({ canvasElement }) => {
    // The readout polls once a second; give it a few readings.
    await new Promise((r) => setTimeout(r, 3500));
    await expect(canvasElement.querySelector('.vs-stats')).toBeNull();
  },
};

/** The picture drawing slowly for a few seconds: the amber warning, before the audio input. */
export const Slow: Story = {
  name: 'Drawing slowly',
  parameters: { world: { stats: { fps: 24, cpu_ms: 31 } } },
  play: async ({ canvas }) => {
    const warning = await canvas.findByText('running slowly: 24 fps', {}, { timeout: 6000 });
    await expect(warning).toHaveAttribute('data-slow');
  },
};

/** In a 900 px window. */
export const At900: Story = {
  name: 'At 900 px',
  parameters: { frame: { width: 900 } },
  args: { now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
};

/** The preset playing in the middle: its name, and where it plays from quieter, on one line. */
export const NowPlaying: Story = {
  name: 'Now playing',
  args: { now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Flexi - mindblob mix')).toBeVisible();
    await expect(canvas.getByText(/from Warm-up/)).toBeVisible();
  },
};

/** A long name in an 800 px window with no sidebar: it ellipsises; the keys and the audio input keep their places, nothing overlapping. */
export const NowLongAt800: Story = {
  name: 'Now playing, long name, 800 px',
  parameters: { frame: { width: 800, sidebar: 'hidden' } },
  args: {
    now: {
      name: 'Geiss + Rovastar + Zylot + Flexi - the longest title anyone ever gave a MilkDrop preset, (Phat edit) [remix of a remix]',
      from: 'from the library · 1,204 of 9,795',
    },
  },
};

/** In a 1600 px window, a long name: still between its neighbours. */
export const At1600: Story = {
  name: 'At 1600 px',
  parameters: { frame: { width: 1600 } },
  args: { now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
};

/** As Home has it: floating over the preview's foot on a scrim, shown while the preview is hovered or focus is inside; Tab reaches the keys while they are hidden, and focus shows them. */
export const Overlay: Story = {
  args: { layout: 'overlay', now: { name: 'Flexi - mindblob mix', from: 'from Warm-up · 3 of 10' } },
  play: async ({ canvas, canvasElement }) => {
    const controls = canvasElement.querySelector('.vs-hero-stage > .vs-hero-controls') as HTMLElement;
    await expect(controls.querySelector('.vs-transport[data-layout="overlay"]')).not.toBeNull();
    const previous = canvas.getByRole('button', { name: 'previous preset' });
    previous.focus();
    await expect(previous).toHaveFocus();
  },
};
