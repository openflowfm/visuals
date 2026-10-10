import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Crate } from './Crate.tsx';
import { CLOSING, DATA, LISTS, MOOD_DECK, row, WARM_UP } from './stories/fixtures.ts';
// Live mode's look, which `Live.tsx` brings in the app.
import './live.css';

/**
 * Live mode's crate: the playlists to play with one tap, the user's tags as
 * moods, and what plays after Next.
 */
const meta = {
  title: 'Live/Crate',
  component: Crate,
  args: { lists: LISTS, data: DATA, current: LISTS.deck.current, act: fn(), onLists: fn(), onError: fn() },
  parameters: { scope: 'bare' },
  decorators: [
    (Story) => (
      <div className="live" style={{ display: 'block', height: 'auto' }}>
        <aside className="live-side" style={{ width: 320, height: 760 }}>
          <Story />
        </aside>
      </div>
    ),
  ],
} satisfies Meta<typeof Crate>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up in order: it lit, the moods, and the four after Next. */
export const PlayingPlaylist: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Moods' })).toBeVisible();
    await expect(canvas.getByRole('list', { name: 'Up next, in play order' }).querySelectorAll('li').length).toBe(4);
  },
};

/** Playing the mood "peak", held: the chip lit, up next from the filter. */
export const PlayingMood: Story = {
  args: { lists: { ...LISTS, deck: MOOD_DECK }, current: MOOD_DECK.current },
  parameters: { tauri: { lists: { ...LISTS, deck: MOOD_DECK }, deckItems: [row(8).path, row(14).path, row(21).path] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'peak' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'chill' })).toHaveAttribute('aria-pressed', 'false');
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
  parameters: { tauri: { deckItems: CLOSING.items.map((i) => i.path) } },
};

/** No tags yet: no moods, only the playlists and up next. */
export const NoMoods: Story = { args: { data: { version: 1, presets: {} } } };

/** No playlists at all. */
export const Empty: Story = {
  args: { lists: { playlists: [], deck: { ...LISTS.deck, playlist: null, index: null, next: null, next_index: null, count: 0 } }, current: WARM_UP.items[0].path },
};
