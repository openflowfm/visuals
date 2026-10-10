import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { matches } from './home.ts';
import { browsable, prepare } from './librarySearch.ts';
import type { Playlist } from './playlists.ts';
import { Sidebar, SourceMenu, type SidebarProps } from './Sources.tsx';
import { BRIGHT_FAST, CLOSING, DATA, LISTS, RECENT, ROWS, WARM_UP } from './stories/fixtures.ts';
// Home's tokens (--playing…) and its rules for what sits in it, as Home.tsx brings them.
import './home.css';

const rows = prepare(ROWS, DATA);

/** How many presets each source holds, worked out as Home does from the fixtures. */
const counts: SidebarProps['counts'] = {
  library: browsable(rows).length,
  starred: browsable(rows).filter((p) => p.star).length,
  list: (p: Playlist) => (p.kind === 'manual' ? p.items.length : p.query ? matches(p.query, rows, RECENT).length : null),
};

/** The home's source list (decision 67): the library, starred and recently played; the playlists; the smart playlists. */
const meta = {
  title: 'Home/Sources',
  component: Sidebar,
  args: {
    lists: LISTS,
    shown: { kind: 'list', id: CLOSING.id },
    counts,
    onPick: fn(),
    onLists: fn(),
    onImport: fn(),
    onError: () => () => {},
  },
  // The sidebar's cell on the home, at its width (as `.home-side` draws it, which home.css hides under 900 px, where the menu stands in);
  // the menu at the top of a narrow main pane.
  decorators: [
    (Story, { parameters }) =>
      parameters.menu ? (
        <div style={{ width: 480, height: 520 }}>
          <Story />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', width: 220, height: 560, overflowY: 'auto', background: 'var(--surface-0)' }}>
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Closing set shown (underlined), Warm-up playing (the green dot). */
export const PlaylistShown: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Library')).toBeVisible();
    await expect(canvas.getByRole('listitem', { name: /^Warm-up, .*playing$/ })).toHaveAttribute('data-active');
    await expect(canvas.getByRole('listitem', { name: new RegExp(`^${CLOSING.name},`) })).toHaveAttribute('aria-current', 'true');
    await expect(canvas.getByRole('listitem', { name: new RegExp(`^${BRIGHT_FAST.name}, smart playlist`) })).toBeVisible();
  },
};

/** The library shown; nothing playing. */
export const LibraryShown: Story = {
  args: { shown: { kind: 'library' }, lists: { ...LISTS, deck: { ...LISTS.deck, playlist: null, index: null } } },
};

/** A playlist row under the pointer: its icon turns into a play (or stop) button. */
export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** No playlists of the user's own yet: each section says how to make one. */
export const Empty: Story = {
  args: { lists: { playlists: [], deck: { ...LISTS.deck, playlist: null } }, shown: { kind: 'library' } },
};

/** Under 900 px the sidebar becomes a menu at the top of the main pane: "<pane shown> ▾". */
export const MenuClosed: Story = {
  render: (args) => <SourceMenu {...args} />,
  args: { shown: { kind: 'list', id: WARM_UP.id } },
  parameters: { menu: true },
  globals: { viewport: { value: 'narrow', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'sources' })).toHaveTextContent(`${WARM_UP.name} ▾`);
    await expect(canvas.queryByRole('dialog')).toBeNull();
  },
};

/** The menu open: the same list as the sidebar. */
export const MenuOpen: Story = {
  ...MenuClosed,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'sources' }));
    await expect(canvas.getByRole('dialog', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
  },
};
