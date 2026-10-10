import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { strip } from './home.ts';
import { prepare } from './librarySearch.ts';
import { PlaylistHead } from './PlaylistHead.tsx';
import type { Lists, Playlist } from './playlists.ts';
import { BRIGHT_FAST, CLOSING, DATA, LISTS, MOOD_DECK, RECENT, ROWS, WARM_UP } from './stories/fixtures.ts';
import { say, Say } from './words.ts';
// Home's tokens and its rules for what sits in it, as Home.tsx brings them.
import './home.css';

const rows = prepare(ROWS, DATA);

/** The head as the home's playlist pane shows it: its tiles and total from the fixtures, its lists kept as they change. */
function Head({ id, lists: start }: { id: string; lists: Lists }) {
  const [lists, setLists] = useState(start);
  const list = lists.playlists.find((p) => p.id === id) as Playlist;
  const { tiles, total } = strip(list, { rows, played: RECENT, playing: null });
  return <PlaylistHead list={list} lists={lists} tiles={tiles} total={total} onLists={setLists} onDeleted={fn()} onError={() => () => {}} />;
}

/** The header over a playlist's strip on the home (decision 67): the cover, what it is, the name, how it plays, and play, shuffle, how it plays ▾ and ···. */
const meta = {
  title: 'Playlists/PlaylistHead',
  component: Head,
  args: { id: WARM_UP.id, lists: LISTS },
  // The home's main pane at 1440 px, less the sidebar and the panel.
  decorators: [
    (Story) => (
      <div className="home-pane" style={{ width: 860, minHeight: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Head>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A manual playlist, playing: ■ Stop, and which of its ten plays. */
export const Manual: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: WARM_UP.name })).toBeVisible();
    await expect(canvas.getByText('Playlist')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Stop/ })).toBeVisible();
  },
};

/** A manual playlist not playing, shuffled, changing on the bar lines. */
export const ManualStopped: Story = { args: { id: CLOSING.id } };

/** A smart playlist: what it fills itself with, and how many match. */
export const Smart: Story = {
  args: { id: BRIGHT_FAST.id },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Smart playlist')).toBeVisible();
    await expect(canvas.getByText(/^fills itself with/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Play/ })).toBeVisible();
  },
};

/** "How it plays ▾" open: how often it moves on, the order, the crossfade and the look it sets. */
export const HowItPlaysOpen: Story = {
  decorators: [
    (Story) => (
      <div style={{ paddingBottom: 260 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: say('playlist settings') }));
    const panel = canvas.getByRole('dialog', { name: say('playlist settings') });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveTextContent(`${say('auto-advance')} every`);
    await expect(canvas.getByRole('button', { name: say('playlist settings') })).toHaveTextContent(`${Say('playlist settings')} ▾`);
  },
};

/** Its settings tweaked live while playing (the deck says which): marked in the popover. */
export const TweakedLive: Story = {
  ...HowItPlaysOpen,
  args: { lists: { ...LISTS, deck: { ...LISTS.deck, differs: MOOD_DECK.differs } } },
};

/** The "···" menu open: rename, save to a file, delete. */
export const MoreOpen: Story = {
  ...HowItPlaysOpen,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'more' }));
    await expect(canvas.getByRole('menu', { name: 'more' })).toBeVisible();
    await expect(canvas.getAllByRole('menuitem')).toHaveLength(3);
  },
};
