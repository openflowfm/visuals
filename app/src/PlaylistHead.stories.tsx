import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { strip } from './home.ts';
import { InspectorPanel } from './layout/HomeLayout.tsx';
import { prepare } from './librarySearch.ts';
import { PlaylistHead } from './PlaylistHead.tsx';
import type { Lists, Playlist } from './playlists.ts';
import { BRIGHT_FAST, CLOSING, DATA, LISTS, MOOD_DECK, RECENT, ROWS, WARM_UP } from './stories/fixtures.ts';
import { say, Say } from './words.ts';
// Home's tokens and its rules for what sits in it, as Home.tsx brings them.
import './home.css';
// The inspector's content rules, for the head as its source card.
import './layout/inspector/inspector-content.css';

const rows = prepare(ROWS, DATA);

/** The head as the home's playlist pane (or the inspector) shows it: its tiles and total from the fixtures, its lists kept as they change. */
function Head({ id, lists: start, variant }: { id: string; lists: Lists; variant?: 'pane' | 'inspector' }) {
  const [lists, setLists] = useState(start);
  const list = lists.playlists.find((p) => p.id === id) as Playlist;
  const { tiles, total } = strip(list, { rows, played: RECENT, playing: null });
  return <PlaylistHead list={list} lists={lists} tiles={tiles} total={total} onLists={setLists} onDeleted={fn()} onError={() => () => {}} variant={variant} />;
}

/** The header over a playlist's strip on the home (decision 67): the cover, what it is, the name, how it plays, and play, shuffle, how it plays ▾ and ···; or, in the inspector, the same as a card. */
const meta = {
  title: 'Playlists/PlaylistHead',
  component: Head,
  args: { id: WARM_UP.id, lists: LISTS },
  // The home's main pane at 1440 px, less the sidebar and the panel; or the inspector's panel at its width, its content's padding round the card.
  decorators: [
    (Story, { args }) =>
      args.variant === 'inspector' ? (
        <div className="app home lay" data-inspector-alone="" style={{ height: 760 }}>
          <InspectorPanel>
            <div className="insp">
              <Story />
            </div>
          </InspectorPanel>
        </div>
      ) : (
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

/** In the inspector, as the source playing: a card down the panel, the cover over the words, the name an h2, the actions wrapping under. */
export const InInspector: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: WARM_UP.name })).toBeVisible();
    await expect(canvas.queryByRole('heading', { level: 1 })).toBeNull();
    await expect(canvas.getByRole('button', { name: /Stop/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'more' })).toBeVisible();
  },
};

/** In the inspector, a smart playlist not playing: what it fills itself with, on as many lines as it takes. */
export const InInspectorSmart: Story = {
  args: { variant: 'inspector', id: BRIGHT_FAST.id },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Smart playlist')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Play/ })).toBeVisible();
  },
};

/** Whether `inner` lies inside the inspector's panel, so the panel's clipping doesn't cut it. */
const inPanel = (canvasElement: HTMLElement, inner: HTMLElement) => {
  const box = canvasElement.querySelector('.lay-insp')!.getBoundingClientRect();
  const r = inner.getBoundingClientRect();
  return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
};

/** In the inspector, how it plays open: across the card, inside the panel. */
export const InInspectorHowItPlays: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: say('playlist settings') }));
    const panel = canvas.getByRole('dialog', { name: say('playlist settings') });
    await expect(panel).toBeVisible();
    await expect(inPanel(canvasElement, panel)).toBe(true);
  },
};

/** In the inspector, the ⋯ menu open: from the card's top right, inside the panel. */
export const InInspectorMore: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'more' }));
    const menu = canvas.getByRole('menu', { name: 'more' });
    await expect(menu).toBeVisible();
    await expect(inPanel(canvasElement, menu)).toBe(true);
  },
};

/** In the inspector, renaming: the box across the card. */
export const InInspectorRenaming: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'more' }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Rename' }));
    await expect(canvas.getByRole('textbox', { name: 'playlist name' })).toHaveFocus();
  },
};
