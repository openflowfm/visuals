import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Layer } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { BRIGHT_FAST, CLOSING, DATA, LISTS, MOOD_DECK, RECENT, ROWS, WARM_UP } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { strip } from '../model/home';
import { prepare } from '../model/librarySearch';
import type { Lists, Playlist } from '../model/playlists';
import { say, Say } from '../model/words';
import { PlaylistHead } from './PlaylistHead';

const rows = prepare(ROWS, DATA);

/** The head as the home's playlist pane (or the inspector) shows it: its tiles and total from the fixtures, its lists kept as they change. */
function Head({ id, lists: start, variant, onQuickAdd }: { id: string; lists: Lists; variant?: 'pane' | 'inspector'; onQuickAdd?: () => void }) {
  const [lists, setLists] = useState(start);
  const list = lists.playlists.find((p) => p.id === id) as Playlist;
  const { tiles, total } = strip(list, { rows, played: RECENT, playing: null });
  return <PlaylistHead list={list} lists={lists} tiles={tiles} total={total} onLists={setLists} onDeleted={fn()} onError={() => () => {}} variant={variant} onQuickAdd={onQuickAdd} />;
}

/**
 * The header over a playlist's strip on the home (decision 67): the cover, what it is, the name, how it plays, and play, shuffle, how it plays ▾ and ···; or, in the inspector, the same as a card.
 *
 * The inspector here is a stand-in for its panel (288 px, 8 px in from the window, its raised tint and 18 px corners, its content's padding), so the story doesn't lean on HomeLayout.
 */
const meta = {
  title: 'open[flow]/visuals/Playlists/PlaylistHead',
  component: Head,
  args: { id: WARM_UP.id, lists: LISTS },
  // The home's main pane at 1440 px, less the sidebar and the panel; or the inspector's panel at its width, its content's padding round the card.
  decorators: [
    (Story, { args }) =>
      args.variant === 'inspector' ? (
        <Layer level="raised" data-inspector="" style={{ width: 288, height: 760, margin: 8, padding: 16, boxSizing: 'border-box', borderRadius: 18, overflow: 'hidden' }}>
          <Story />
        </Layer>
      ) : (
        <div style={{ width: 860, minHeight: 420 }}>
          <Story />
        </div>
      ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
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

/** In the inspector, as the source playing: a card down the panel, the cover over the words, the name an h2, how it plays and ⋯ under them; no playback controls. */
export const InInspector: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: WARM_UP.name })).toBeVisible();
    await expect(canvas.queryByRole('heading', { level: 1 })).toBeNull();
    for (const name of [/Play/, /Stop/, /Shuffle/]) await expect(canvas.queryByRole('button', { name })).toBeNull();
    await expect(canvas.getByRole('button', { name: say('playlist settings') })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'more' })).toBeVisible();
  },
};

/** In the inspector with quick add: "Add presets" beside how it plays, on a manual playlist. */
export const InInspectorQuickAdd: Story = {
  args: { variant: 'inspector', onQuickAdd: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: Say('quickadd button') }));
    await expect(args.onQuickAdd).toHaveBeenCalledOnce();
  },
};

/** In the inspector, a smart playlist not playing: what it fills itself with, on as many lines as it takes; no "Add presets", even with quick add. */
export const InInspectorSmart: Story = {
  args: { variant: 'inspector', id: BRIGHT_FAST.id, onQuickAdd: fn() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Smart playlist')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /Play/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: Say('quickadd button') })).toBeNull();
  },
};

/** Whether `inner` lies inside the inspector's panel, so it doesn't run past the panel. */
const inPanel = (canvasElement: HTMLElement, inner: HTMLElement) => {
  const box = canvasElement.querySelector('[data-inspector]')!.getBoundingClientRect();
  const r = inner.getBoundingClientRect();
  return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
};

/** In the inspector, how it plays open: across the card, inside the panel; shuffle is its order, kept by the playlist. */
export const InInspectorHowItPlays: Story = {
  args: { variant: 'inspector' },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: say('playlist settings') }));
    const panel = canvas.getByRole('dialog', { name: say('playlist settings') });
    await expect(panel).toBeVisible();
    await expect(inPanel(canvasElement, panel)).toBe(true);
    const shuffle = within(panel).getByRole('radio', { name: 'shuffle' });
    await userEvent.click(shuffle);
    await expect(shuffle).toHaveAttribute('aria-checked', 'true');
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
