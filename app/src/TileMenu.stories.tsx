import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, screen, within } from 'storybook/test';
import { LibraryGrid } from './LibraryGrid.tsx';
import { browseOrder, prepare } from './librarySearch.ts';
import { TileMenuContext } from './TileMenu.tsx';
import { DATA, PLAYLISTS, ROWS } from './stories/fixtures.ts';
import './library.css';

/** The starter slice as the home's grid browses it. */
const rows = browseOrder(prepare(ROWS, DATA));
const keyOf = (i: number) => rows[i].row.key;

/**
 * A library tile's context menu (TileMenu.tsx): right-click or ⌃-click a
 * tile, or the context-menu key or ⇧F10 on the highlighted one. The
 * inspector's header actions in its order, Never set apart.
 */
const meta = {
  title: 'Library/TileMenu',
  component: LibraryGrid,
  args: {
    rows,
    active: -1,
    selected: new Set<string>(),
    current: null,
    into: null,
    reveal: 0,
    onMove: fn(),
    onPick: fn(),
    onAdd: fn(),
    onClear: fn(),
  },
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
  decorators: [
    (Story) => (
      <TileMenuContext.Provider value={{ playlists: PLAYLISTS, onSet: fn(), onAddTo: fn() }}>
        <main className="home-main" style={{ height: '100vh' }}>
          <div className="lib lib-home">
            <Story />
          </div>
        </main>
      </TileMenuContext.Provider>
    ),
  ],
} satisfies Meta<typeof LibraryGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Right-clicked on one tile: Play, Star, Add to playlist, then Never. */
export const One: Story = {
  play: async ({ canvas }) => {
    const tiles = await canvas.findAllByRole('option');
    const r = tiles[5].getBoundingClientRect();
    fireEvent.contextMenu(tiles[5], { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    const menu = await screen.findByRole('menu');
    const names = [...menu.querySelectorAll(':scope > [role^="menuitem"]')].map((b) => b.textContent);
    await expect(names).toEqual(['Play', 'Star', 'Add to playlist', 'Never play']);
  },
};

/** Opened on one of three picked: it acts on all three, Play waiting for one; its playlists open under "Add to playlist". */
export const SeveralWithPlaylists: Story = {
  args: { selected: new Set([keyOf(2), keyOf(3), keyOf(4)]) },
  play: async ({ canvas }) => {
    const tiles = await canvas.findAllByRole('option');
    const r = tiles[3].getBoundingClientRect();
    fireEvent.contextMenu(tiles[3], { clientX: r.left + 40, clientY: r.top + 40 });
    const menu = await screen.findByRole('menu', { name: '3 presets' });
    await expect(within(menu).getByRole('menuitem', { name: /Play/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Add to playlist/ }));
    await expect(await within(menu).findByRole('menuitem', { name: PLAYLISTS[0].name })).toBeVisible();
  },
};
