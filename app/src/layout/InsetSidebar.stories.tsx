import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import type { Pane } from '../home.ts';
import type { Lists, Playlist } from '../playlists.ts';
import { drags } from '../drag.ts';
import { BRIGHT_FAST, CLOSING, LISTS, ROWS, WARM_UP } from '../stories/fixtures.ts';
import { SIDEBAR, STARRED } from './fixtures.ts';
import type { SidebarActions } from './home-model.ts';
import { InsetSidebar, sidebarSections, type InsetSidebarProps } from './InsetSidebar.tsx';
// The shell's panel and its `--lay-*` sizes, as HomeLayout.tsx brings them (the decorator draws its panel).
import './layout.css';

/** A name as a literal for a RegExp. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sidebar holding its own selection and folding, as Home would, telling the story's spies too. */
function Live(props: InsetSidebarProps) {
  const [selected, setSelected] = useState<Pane | null>(props.selected);
  const [collapsed, setCollapsed] = useState<readonly string[]>(props.collapsed);
  return (
    <InsetSidebar
      {...props}
      selected={selected}
      collapsed={collapsed}
      onSelect={(pane) => {
        setSelected(pane);
        props.onSelect(pane);
      }}
      onToggle={(id) => {
        setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
        props.onToggle(id);
      }}
    />
  );
}

/** Many playlists, some with long names, so the panel scrolls inside itself. */
const MANY: Lists = (() => {
  const names = [
    'Closing set, Saturday night at the warehouse, the long version',
    'Sunrise',
    'Ambient room, upstairs, for the people who came to sit down',
    'Peak',
    'Drum and bass',
    'Techno, hard',
    'Slow motion',
    'Birthday',
    'Rehearsal, Thursday',
    'Visuals for the band: second half of the set, after the break',
    'Late',
    'Daytime',
  ];
  const manual: Playlist[] = names.map((name, n) => ({ ...WARM_UP, id: `p-many-${n}`, name, items: WARM_UP.items.slice(0, (n % WARM_UP.items.length) + 1) }));
  const smart: Playlist[] = ['Bright, fast and very colourful, for the peak of the night', 'Dark', 'Hypnotic and slow'].map((name, n) => ({ ...BRIGHT_FAST, id: `s-many-${n}`, name }));
  return { playlists: [WARM_UP, ...manual, ...LISTS.playlists.filter((p) => p !== WARM_UP), ...smart], deck: LISTS.deck };
})();

/** What a smart playlist's row counts: its matches, fixed here (the app works them out). */
const SMART_COUNT = 42;

/** The sidebar's actions as spies: a manual playlist counts its items, a smart one `SMART_COUNT`. */
const ACTIONS: SidebarActions = {
  onPlay: fn(),
  onStop: fn(),
  onCreate: fn(),
  onImport: fn(),
  onRename: fn(),
  onExport: fn(),
  onDelete: fn(),
  onQuickAdd: fn(),
  onInfo: fn(),
  onSettings: fn(),
  count: fn((p: Playlist) => (p.kind === 'manual' ? p.items.length : SMART_COUNT)),
  onError: fn((what: string) => (e: unknown) => console.error(`Couldn't ${what}:`, e)),
};

/** No playlists at all, nothing playing. */
const EMPTY: Lists = { playlists: [], deck: { ...LISTS.deck, playlist: null } };

/** A row's button by the start of its name. */
const rowNamed = (canvas: { getByRole(role: string, o: { name: RegExp }): HTMLElement }, name: string) => canvas.getByRole('button', { name: new RegExp(`^${escape(name)},`) });

/** A right-click on a row, a third of the way along it, so the menu opens where a pointer would put it. */
const rightClick = (el: HTMLElement) => {
  const box = el.getBoundingClientRect();
  return userEvent.pointer({ keys: '[MouseRight]', target: el, coords: { clientX: box.left + box.width / 3, clientY: box.top + box.height / 2 } });
};

/**
 * The macOS layout's inset sidebar (Apple's kit's "Library Preview"), in the
 * app's own look: the mark at its top, today's source list (Home/Sources) as collapsible sections,
 * rows of 40 px, the row picked a soft pill, the playlist playing its green
 * dot. Shown in the inset panel as HomeLayout draws it, the window buttons'
 * band clear at its top.
 */
const meta = {
  title: 'Layout/Inset sidebar',
  component: InsetSidebar,
  render: (args) => <Live {...args} />,
  args: {
    sections: SIDEBAR,
    lists: LISTS,
    selected: { kind: 'list', id: WARM_UP.id },
    collapsed: [],
    onSelect: fn(),
    onToggle: fn(),
    actions: ACTIONS,
  },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="app home lay" style={{ width: 256, height: 640 }}>
        <nav className="lay-side" aria-label="sources">
          <span className="lay-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div className="lay-side-body">
            <Story />
          </div>
        </nav>
      </div>
    ),
  ],
} satisfies Meta<typeof InsetSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Warm-up picked and playing: the pill, the green dot; the keyboard walks the rows and headings, and picks with Enter. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const warmUp = canvas.getByRole('button', { name: /^Warm-up, playlist, 10 presets, playing$/ });
    await expect(warmUp).toHaveAttribute('aria-current', 'true');
    await expect(warmUp).toHaveAttribute('data-playing');
    // The playlists' heading's + and ⤓ are tab stops of their own (before it in the page); then one stop for the rows and headings: the row picked.
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'new playlist' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'add from a file' })).toHaveFocus();
    await userEvent.tab();
    await expect(warmUp).toHaveFocus();
    // Down to the next row, up past the heading's rows to the heading, End and Home.
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: new RegExp(`^${escape(CLOSING.name)},`) })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    await expect(canvas.getByRole('button', { name: 'Playlists' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    const last = SIDEBAR[SIDEBAR.length - 1].rows.at(-1)!;
    await expect(canvas.getByRole('button', { name: new RegExp(`^${escape(last.name)},`) })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    // (The heading, not the row of the same name: the heading folds.)
    await expect(canvas.getByRole('button', { name: 'Library', expanded: true })).toHaveFocus();
    // Down to the library row and Enter: it is picked, and onSelect says which pane.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect(args.onSelect).toHaveBeenLastCalledWith({ kind: 'starred' });
    await expect(canvas.getByRole('button', { name: 'Starred' })).toHaveAttribute('aria-current', 'true');
    await expect(warmUp).not.toHaveAttribute('aria-current');
    // A click picks too.
    await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${escape(BRIGHT_FAST.name)}, smart playlist`) }));
    await expect(args.onSelect).toHaveBeenLastCalledWith({ kind: 'list', id: BRIGHT_FAST.id });
  },
};

/** The playlists folded away: their heading says so, its rows are gone, and the keyboard skips them. */
export const Collapsed: Story = {
  args: { collapsed: ['playlists'], selected: { kind: 'library' } },
  play: async ({ canvas, args }) => {
    const head = canvas.getByRole('button', { name: 'Playlists' });
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByRole('button', { name: /^Warm-up,/ })).toBeNull();
    // From the heading, down goes to the next section's heading.
    head.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: 'Smart playlists' })).toHaveFocus();
    // Unfold with →, fold again with a click.
    await userEvent.keyboard('{ArrowUp}{ArrowRight}');
    await expect(args.onToggle).toHaveBeenLastCalledWith('playlists');
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'true'));
    await expect(canvas.getByRole('button', { name: /^Warm-up,/ })).toBeVisible();
    await userEvent.click(head);
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'false'));
    await expect(canvas.queryByRole('button', { name: /^Warm-up,/ })).toBeNull();
  },
};

/** Many playlists, some with long names: the names end in an ellipsis and the sections scroll inside the panel, the window buttons' band, the mark and the foot staying put. */
export const LongNamesManyPlaylists: Story = {
  name: 'Long names, many playlists',
  args: { sections: sidebarSections(MANY, { library: 250, starred: 12 }), lists: MANY },
  play: async ({ canvasElement, canvas }) => {
    const body = canvasElement.querySelector<HTMLElement>('.isb-sections')!;
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const long = canvas.getByText(/^Closing set, Saturday night/);
    await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
    // The last row scrolls into view when the keyboard reaches it.
    canvas.getByRole('button', { name: 'Library', expanded: true }).focus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  },
};

/** A playlist's menu: a right-click opens it on Play/Stop, the arrows walk it, Esc closes it back to the row, ⇧F10 opens it from the keyboard, and Save to a file exports. */
export const RowMenu: Story = {
  name: 'Row menu',
  play: async ({ canvas, args }) => {
    const warmUp = rowNamed(canvas, WARM_UP.name);
    // The counts: a manual playlist's items, a smart one's matches.
    await expect(warmUp).toHaveTextContent(String(WARM_UP.items.length));
    await expect(rowNamed(canvas, BRIGHT_FAST.name)).toHaveTextContent(String(SMART_COUNT));
    await rightClick(warmUp);
    const menu = await canvas.findByRole('menu', { name: WARM_UP.name });
    // Warm-up is playing: the menu opens on Stop.
    await waitFor(() => expect(canvas.getByRole('menuitem', { name: 'Stop' })).toHaveFocus());
    // Warm-up is a manual playlist: quick add, then show info.
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('menuitem', { name: 'Quick add' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('menuitem', { name: 'Show info' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(canvas.getByRole('menuitem', { name: 'Delete…' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('menuitem', { name: 'Stop' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(menu).not.toBeInTheDocument());
    await expect(warmUp).toHaveFocus();
    // From the keyboard: ⇧F10 on the row focused.
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(canvas.getByRole('menuitem', { name: 'Stop' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Save to a file' }));
    await expect(args.actions!.onExport).toHaveBeenCalledWith(WARM_UP.id);
    await waitFor(() => expect(canvas.queryByRole('menu')).toBeNull());
    await expect(args.actions!.onDelete).not.toHaveBeenCalled();
  },
};

/** A smart playlist's menu: no quick add (it fills itself); Show info asks the page for its card, and Quick add on a manual one starts adding. */
export const InfoAndQuickAdd: Story = {
  name: 'Show info and quick add',
  play: async ({ canvas, args }) => {
    await rightClick(rowNamed(canvas, BRIGHT_FAST.name));
    await canvas.findByRole('menu', { name: BRIGHT_FAST.name });
    await expect(canvas.queryByRole('menuitem', { name: 'Quick add' })).toBeNull();
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Show info' }));
    await expect(args.actions!.onInfo).toHaveBeenCalledWith(BRIGHT_FAST.id);
    await waitFor(() => expect(canvas.queryByRole('menu')).toBeNull());
    await rightClick(rowNamed(canvas, CLOSING.name));
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Quick add' }));
    await expect(args.actions!.onQuickAdd).toHaveBeenCalledWith(CLOSING.id);
  },
};

/** The mark atop the sidebar under the window buttons, and the quiet Settings row pinned to its foot: it stays at the bottom while the rows scroll under it. */
export const MarkAndSettings: Story = {
  name: 'Mark and Settings',
  args: { sections: sidebarSections(MANY, { library: 250, starred: 12 }), lists: MANY },
  play: async ({ canvasElement, canvas, args }) => {
    const panel = canvasElement.querySelector<HTMLElement>('.lay-side')!;
    const scroller = canvasElement.querySelector<HTMLElement>('.isb-sections')!;
    const mark = canvasElement.querySelector<HTMLElement>('.isb-mark')!;
    await expect(mark).toHaveTextContent('visual[flow]');
    // Under the window buttons' band, not in it.
    await expect(mark.getBoundingClientRect().top).toBeGreaterThanOrEqual(canvasElement.querySelector('.lay-side-body')!.getBoundingClientRect().top);
    const markTop = mark.getBoundingClientRect().top;
    const settings = canvas.getByRole('button', { name: 'Settings' });
    const atFoot = () => expect(Math.abs(panel.getBoundingClientRect().bottom - settings.closest('.isb-foot')!.getBoundingClientRect().bottom)).toBeLessThan(1);
    await atFoot();
    // The rows scroll; the mark and the foot stay where they were.
    scroller.scrollTop = scroller.scrollHeight / 2;
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    await atFoot();
    await expect(mark.getBoundingClientRect().top).toBe(markTop);
    await userEvent.click(settings);
    await expect(args.actions!.onSettings).toHaveBeenCalled();
  },
};

/** Few rows: the Settings row still sits at the panel's foot, the space between empty. */
export const SettingsFewRows: Story = {
  name: 'Settings with few rows',
  args: { sections: sidebarSections(EMPTY, { library: ROWS.length, starred: STARRED.length }), lists: EMPTY, selected: { kind: 'library' } },
  play: async ({ canvasElement, canvas }) => {
    const panel = canvasElement.querySelector<HTMLElement>('.lay-side')!;
    const foot = canvas.getByRole('button', { name: 'Settings' }).closest('.isb-foot')!;
    await expect(Math.abs(panel.getBoundingClientRect().bottom - foot.getBoundingClientRect().bottom)).toBeLessThan(1);
  },
};

/** The menu left open on Closing set, for a look: its glass, where it sits, the row keeping its hover tint and its "…". */
export const RowMenuOpen: Story = {
  name: 'Row menu open',
  play: async ({ canvas }) => {
    const closing = rowNamed(canvas, CLOSING.name);
    await rightClick(closing);
    const menu = await canvas.findByRole('menu', { name: CLOSING.name });
    // At the pointer, in the row: not flipped above it.
    await waitFor(() => expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(closing.getBoundingClientRect().top));
    await expect(canvas.getByRole('button', { name: `More for ${CLOSING.name}` })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** Rename from the menu: the name becomes a box in its row, a new name and Enter rename it, and focus goes back to the row. */
export const Rename: Story = {
  play: async ({ canvas, args }) => {
    await rightClick(rowNamed(canvas, CLOSING.name));
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Rename' }));
    const box = await canvas.findByRole('textbox', { name: `New name for ${CLOSING.name}` });
    await waitFor(() => expect(box).toHaveFocus());
    await expect(box).toHaveValue(CLOSING.name);
    await userEvent.clear(box);
    await userEvent.type(box, 'Encore{Enter}');
    await expect(args.actions!.onRename).toHaveBeenCalledWith(CLOSING.id, 'Encore');
    await waitFor(() => expect(canvas.queryByRole('textbox')).toBeNull());
    await waitFor(() => expect(rowNamed(canvas, CLOSING.name)).toHaveFocus());
  },
};

/** Delete asks first, in the menu: "Delete Closing set, Saturday?" or Keep; Keep keeps it, the question deletes it. */
export const DeleteAsksFirst: Story = {
  name: 'Delete asks first',
  play: async ({ canvas, args }) => {
    const closing = rowNamed(canvas, CLOSING.name);
    await rightClick(closing);
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Delete…' }));
    const ask = await canvas.findByRole('menuitem', { name: `Delete ${CLOSING.name}?` });
    await waitFor(() => expect(ask).toHaveFocus());
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Keep' }));
    await waitFor(() => expect(canvas.queryByRole('menu')).toBeNull());
    await expect(args.actions!.onDelete).not.toHaveBeenCalled();
    await expect(closing).toHaveFocus();
    // Again, and this time delete.
    await rightClick(closing);
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Delete…' }));
    await userEvent.click(await canvas.findByRole('menuitem', { name: `Delete ${CLOSING.name}?` }));
    await expect(args.actions!.onDelete).toHaveBeenCalledWith(CLOSING.id);
    await waitFor(() => expect(canvas.queryByRole('menu')).toBeNull());
  },
};

/** No playlists yet: both sections say how to make one, and the heading's + makes one. */
export const Empty: Story = {
  args: { sections: sidebarSections(EMPTY, { library: ROWS.length, starred: STARRED.length }), lists: EMPTY, selected: { kind: 'library' } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('None yet: + makes one.')).toBeVisible();
    await expect(canvas.getByText(/^Filter the library, then /)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'new playlist' }));
    await expect(args.actions!.onCreate).toHaveBeenCalled();
  },
};

/** A preset dragged over Closing set: that row lights as the drop target, the smart playlists fade; the drag is the page's own (`drags`), held over the row. */
export const DraggingAPreset: Story = {
  name: 'Dragging a preset',
  beforeEach: () => () => drags.cancel(),
  play: async ({ canvasElement, canvas }) => {
    const target = canvasElement.querySelector<HTMLElement>(`li[data-drop="list:${CLOSING.id}"]`)!;
    await expect(target).not.toBeNull();
    const box = target.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const row = ROWS[0];
    drags.press(x - 40, y, { kind: 'preset', path: row.path, name: row.title, thumbnail: null }, { accepts: () => true, onDrop: fn() });
    drags.move(x, y);
    await waitFor(() => expect(target).toHaveAttribute('data-over'));
    const bright = rowNamed(canvas, BRIGHT_FAST.name).closest('li')!;
    await expect(bright).toHaveAttribute('data-refuses');
    await expect(bright).not.toHaveAttribute('data-drop');
    // Warm-up takes drops too, but the pointer isn't over it.
    await expect(rowNamed(canvas, WARM_UP.name).closest('li')).not.toHaveAttribute('data-over');
  },
};
