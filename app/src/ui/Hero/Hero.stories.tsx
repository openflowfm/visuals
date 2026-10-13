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

/** The picture's box keeps 16:9 and stays within its cap (160 to 440 px tall), and within the card. */
async function pictureKept(root: HTMLElement) {
  const pic = root.querySelector('.vs-hero-pic') as HTMLElement;
  const card = root.querySelector('.vs-hero') as HTMLElement;
  const box = pic.getBoundingClientRect();
  await expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
  await expect(box.height).toBeLessThanOrEqual(440.5);
  await expect(box.height).toBeGreaterThanOrEqual(159.5);
  await expect(box.width).toBeLessThanOrEqual(card.getBoundingClientRect().width + 0.5);
  return { box, card: card.getBoundingClientRect() };
}

/** The preview's box (Views' `Preview`): the hole inside it is the image a screen reader hears. */
const previewBox = (hole: HTMLElement) => hole.closest('.vs-preview') as HTMLElement;

/** Warm-up playing its third preset: pause holds it, and star toggles. */
export const Playing: Story = {
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole('heading', { name: NOW.preset!.title })).toBeVisible();
    await expect(canvas.getByText(/from Warm-up/)).toBeVisible();
    await pictureKept(canvasElement);
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
  play: async ({ canvas, canvasElement }) => {
    const hole = canvas.getByRole('img', { name: /^preview of the playing preset/ });
    const pic = previewBox(hole);
    await expect(pic).toHaveClass(HERO_PIC);
    await expect(pic.parentElement!.closest(`.${HERO_PIC}`)).toBeNull();
    await waitFor(() => expect(pic).not.toHaveAttribute('data-loading'));
    await expect(getComputedStyle(pic).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(pic).boxShadow).toMatch(/0px 0px 0px \d+(\.\d+)?px/);
    await expect(getComputedStyle(hole, '::before').content).not.toBe('none');
    await pictureKept(canvasElement);
  },
};

/** Before anything plays: no picture, "Nothing playing", star and add off. */
export const NothingPlaying: Story = {
  args: { preset: null, picture: null, from: '', starred: false, playing: false },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'star' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'add to a playlist' })).toBeDisabled();
    await expect(canvasElement.querySelector('.vs-hero-pic img')).toBeNull();
    await pictureKept(canvasElement);
  },
};

/** The longest name in the slice, from the library: two lines, then an ellipsis. */
export const LongTitle: Story = {
  args: { preset: LONG, picture: LONG.thumbnail ?? NOW.picture, from: 'from the library · 1,204 of 9,795', starred: false },
  play: async ({ canvas }) => {
    const name = canvas.getByRole('heading', { name: LONG.title });
    // At most two lines of 24px at 1.2.
    await expect(name.getBoundingClientRect().height).toBeLessThanOrEqual(24 * 1.2 * 2 + 1);
  },
};

/** In a 900 px window: the words under the picture, which fills the column up to its cap. */
export const At900: Story = {
  name: 'At 900 px',
  parameters: { frame: { width: 900 } },
  play: async ({ canvasElement }) => {
    const { box } = await pictureKept(canvasElement);
    const info = (canvasElement.querySelector('.vs-hero-info') as HTMLElement).getBoundingClientRect();
    await expect(info.top).toBeGreaterThanOrEqual(box.bottom - 0.5);
  },
};

/**
 * The picture alone (round 2: the name and where it plays from are in the
 * transport bar): 16:9, centred in the hero's slot, as wide as it, but never
 * taller than the room the screen gave the slot, where it narrows and stays centred.
 */
async function pictureAlone(root: HTMLElement) {
  await expect(root.querySelector('.vs-hero-info')).toBeNull();
  await expect(root.querySelector('.vs-hero')).toHaveAttribute('data-only');
  const slot = root.querySelector('.vs-lay-hero') as HTMLElement;
  const style = getComputedStyle(slot);
  const rect = slot.getBoundingClientRect();
  const room = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  // The slot's content box: the size container whose 100cqh caps the picture.
  const tall = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const box = (root.querySelector('.vs-hero-pic') as HTMLElement).getBoundingClientRect();
  await expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
  await expect(box.width).toBeLessThanOrEqual(room + 0.5);
  await expect(box.height).toBeLessThanOrEqual(tall + 0.5);
  await expect(Math.abs((box.left + box.right) / 2 - (rect.left + rect.right) / 2)).toBeLessThan(1);
  return { box, tall, room };
}

/** The picture alone in a 1440 × 800 window: the slot's height caps it, so it narrows, centred. */
export const PictureOnly: Story = {
  name: 'Picture only',
  render: (args) => <Hero picture={args.picture} />,
  play: async ({ canvasElement }) => {
    const { box, tall, room } = await pictureAlone(canvasElement);
    await expect(Math.abs(box.height - tall)).toBeLessThan(1);
    await expect(box.width).toBeLessThan(room);
  },
};

/** The picture alone in an 800 px window: the column's width caps it first, so it fills it. */
export const PictureOnlyAt800: Story = {
  name: 'Picture only, 800 px',
  render: (args) => <Hero picture={args.picture} />,
  parameters: { frame: { width: 800 } },
  play: async ({ canvasElement }) => {
    const { box, room } = await pictureAlone(canvasElement);
    await expect(Math.abs(box.width - room)).toBeLessThan(1);
  },
};

/** The preview itself, alone: the hole keeps the painting rules (its shadow paints the column, its corners painted), centred and capped. */
export const PictureOnlyPreview: Story = {
  name: 'Picture only, the preview (in the app)',
  render: () => <Hero picture={<Preview className={HERO_PIC} />} />,
  play: async ({ canvas, canvasElement }) => {
    const hole = canvas.getByRole('img', { name: /^preview of the playing preset/ });
    const pic = previewBox(hole);
    await waitFor(() => expect(pic).not.toHaveAttribute('data-loading'));
    await expect(getComputedStyle(pic).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(pic).boxShadow).toMatch(/0px 0px 0px \d+(\.\d+)?px/);
    await expect(getComputedStyle(hole, '::before').content).not.toBe('none');
    await pictureAlone(canvasElement);
  },
};

/** In a 1600 px window: the picture at its cap on the left, the words beside it. */
export const At1600: Story = {
  name: 'At 1600 px',
  parameters: { frame: { width: 1600 } },
  play: async ({ canvasElement }) => {
    const { box, card } = await pictureKept(canvasElement);
    const info = (canvasElement.querySelector('.vs-hero-info') as HTMLElement).getBoundingClientRect();
    await expect(info.left).toBeGreaterThanOrEqual(box.right - 0.5);
    await expect(box.width).toBeLessThan(card.width);
  },
};
