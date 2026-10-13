import { useState, type ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { LONG } from '../fixtures/fixtures';
import { Preview } from '../Views/Views';
import { HomeLayout } from '../HomeLayout/HomeLayout';
import { Hero, HERO_PIC, type HeroProps } from './Hero';
import { NOW, STARRED } from '../fixtures/layout';

/** The window's width a story draws the hero in (the shell's sidebar takes its share), 1440 by default. */
interface Frame {
  width?: number;
}

/** The hero in the shell's main column, in a window of the story's width, so it lays out as it would there. */
const inWindow: Decorator = (Story, { parameters }) => {
  const width = (parameters.frame as Frame | undefined)?.width ?? 1440;
  return (
    <div style={{ width, height: 800 }}>
      <HomeLayout sidebar={null} header={null} hero={<Story />} />
    </div>
  );
};

/** The hero with its play/pause and star working, reporting to the story's spies. */
function Stateful(props: HeroProps): ReactNode {
  const [playing, setPlaying] = useState(props.playing);
  const [starred, setStarred] = useState(props.starred);
  return (
    <Hero
      {...props}
      playing={playing}
      starred={starred}
      onPlayPause={() => {
        setPlaying((p) => !p);
        props.onPlayPause?.();
      }}
      onStar={() => {
        setStarred((s) => !s);
        props.onStar?.();
      }}
    />
  );
}

/** The Now Playing card of the macOS layout: the preview large, the preset's name, author and where it plays from, and its actions as type. */
const meta = {
  title: 'open[flow]/visuals/Layout/Hero',
  component: Hero,
  render: (args) => <Stateful {...args} />,
  decorators: [inWindow, withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: {
    preset: NOW.preset,
    picture: NOW.picture,
    playing: true,
    from: NOW.from,
    starred: !!NOW.preset && STARRED.includes(NOW.preset.key),
    onPlayPause: fn(),
    onNext: fn(),
    onStar: fn(),
    onAdd: fn(),
  },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Hero>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Warm-up playing its third preset: pause holds it, and star toggles. */
export const Playing: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('heading', { name: NOW.preset!.title })).toBeVisible();
    await expect(canvas.getByText(/from Warm-up/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'pause' }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'play' })).toBeVisible());
    const star = canvas.getByRole('button', { name: 'star' });
    const was = star.getAttribute('aria-pressed');
    await userEvent.click(star);
    await expect(args.onStar).toHaveBeenCalledOnce();
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true'));
    await userEvent.click(canvas.getByRole('button', { name: 'next preset' }));
    await expect(args.onNext).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'add to a playlist' }));
    await expect(args.onAdd).toHaveBeenCalledOnce();
  },
};

/** Holding on the preset: play shows, and moves it on again. */
export const Paused: Story = {
  args: { playing: false },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'play' }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'pause' })).toBeVisible());
  },
};

/**
 * In the app: the picture is the native preview's hole, `<Preview className={HERO_PIC} />`,
 * the box itself with nothing around it. Once it draws it paints nothing (the
 * engine's view shows through; here the desktop's stand-in), its spread shadow
 * paints the column around it, and its corners are painted opaque.
 */
export const ThePreview: Story = {
  name: 'The preview (in the app)',
  args: { picture: <Preview className={HERO_PIC} /> },
};

/** Before anything plays: no picture, "Nothing playing", star and add off. */
export const NothingPlaying: Story = {
  args: { preset: null, picture: null, from: '', starred: false, playing: false },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'star' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'add to a playlist' })).toBeDisabled();
    await expect(canvasElement.querySelector('.vs-hero-pic img')).toBeNull();
  },
};

/** The longest name in the slice, from the library: two lines, then an ellipsis. */
export const LongTitle: Story = {
  args: { preset: LONG, picture: LONG.thumbnail ?? NOW.picture, from: 'from the library · 1,204 of 9,795', starred: false },
};

/** In a 900 px window: the words under the picture, which fills the column up to its cap. */
export const At900: Story = {
  name: 'At 900 px',
  parameters: { frame: { width: 900 } },
};

/**
 * The picture alone (round 2: the name and where it plays from are in the transport bar) in a
 * 1440 × 800 window: 16:9, centred in the hero's slot; the slot's height caps it, so it narrows.
 */
export const PictureOnly: Story = {
  name: 'Picture only',
  render: (args) => <Hero picture={args.picture} />,
};

/** The picture alone in an 800 px window: the column's width caps it first, so it fills it. */
export const PictureOnlyAt800: Story = {
  name: 'Picture only, 800 px',
  render: (args) => <Hero picture={args.picture} />,
  parameters: { frame: { width: 800 } },
};

/** The preview itself, alone: the hole keeps the painting rules (its shadow paints the column, its corners painted), centred and capped. */
export const PictureOnlyPreview: Story = {
  name: 'Picture only, the preview (in the app)',
  render: () => <Hero picture={<Preview className={HERO_PIC} />} />,
};

/** In a 1600 px window: the picture at its cap on the left, the words beside it. */
export const At1600: Story = {
  name: 'At 1600 px',
  parameters: { frame: { width: 1600 } },
};
