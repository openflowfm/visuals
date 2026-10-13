import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { CLOSING, DATA, LISTS, MOOD_DECK, row, WARM_UP } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { Crate } from './Crate';

/**
 * Live mode's crate, in Home's sidebar look: the playlists (a tap cues one,
 * its Play button plays it), the user's tags as moods, and what plays after Next, each section
 * folding under its heading. On the Stage it sits in its panel
 * (`StageCrate`); here, on the panel's opaque tone.
 */
const meta = {
  title: 'open[flow]/visuals/Live/Crate',
  component: Crate,
  args: { lists: LISTS, data: DATA, current: LISTS.deck.current, act: fn(), onLists: fn(), onError: fn() },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', width: 240, height: 640, padding: '12px 10px 0', background: 'var(--layer-base-solid)', borderRadius: 18 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof Crate>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up in order: it the pill with its green dot, the moods, and the four after Next. */
export const PlayingPlaylist: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Moods' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Warm-up, playing' })).toHaveAttribute('aria-current', 'true');
    await expect(canvas.getByRole('list', { name: 'Up next, in play order' }).querySelectorAll('li').length).toBe(4);
  },
};

/** Playing the mood "peak", held: its row lit, up next from the filter. */
export const PlayingMood: Story = {
  args: { lists: { ...LISTS, deck: MOOD_DECK }, current: MOOD_DECK.current },
  parameters: { world: { lists: { ...LISTS, deck: MOOD_DECK }, deckItems: [row(8).path, row(14).path, row(21).path] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'peak' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'chill' })).toHaveAttribute('aria-pressed', 'false');
  },
};

/** The keyboard: one tab stop, the arrows walk, ← folds a section. */
export const Keyboard: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Warm-up, playing' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: /^Closing set, Saturday/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await expect(canvas.getByRole('button', { name: 'Playlists' })).toHaveAttribute('aria-expanded', 'false');
  },
};

/** A tap only cues a playlist: its row marked, a Play button at its end; playing is that button, Enter or a double-click. */
export const Cued: Story = {
  play: async ({ args, canvas }) => {
    const row = canvas.getByRole('button', { name: /^Closing set, Saturday/ });
    await userEvent.click(row);
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(args.act).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Play Closing set, Saturday' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Warm-up, playing' })).toHaveAttribute('aria-current', 'true');
  },
};

/** Playing a shuffled playlist: up next from the deck's order, not draggable. */
export const Shuffled: Story = {
  args: {
    lists: {
      ...LISTS,
      deck: {
        ...LISTS.deck,
        playlist: CLOSING.id,
        index: 0,
        current: CLOSING.items[0].path,
        next: CLOSING.items[1].path,
        next_index: 1,
        count: CLOSING.items.length,
        order: 'shuffle',
        settings: CLOSING.settings,
      },
    },
    current: CLOSING.items[0].path,
  },
  parameters: { world: { deckItems: CLOSING.items.map((i) => i.path) } },
};

/** No tags yet: no moods, only the playlists and up next. */
export const NoMoods: Story = { args: { data: { version: 1, presets: {} } } };

/** No playlists at all. */
export const Empty: Story = {
  args: { lists: { playlists: [], deck: { ...LISTS.deck, playlist: null, index: null, next: null, next_index: null, count: 0 } }, current: WARM_UP.items[0].path },
};
