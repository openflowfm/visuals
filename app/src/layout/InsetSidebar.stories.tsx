import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import type { Pane } from '../home.ts';
import type { Lists, Playlist } from '../playlists.ts';
import { BRIGHT_FAST, CLOSING, LISTS, WARM_UP } from '../stories/fixtures.ts';
import { SIDEBAR } from './fixtures.ts';
import { InsetSidebar, sidebarSections, type InsetSidebarProps } from './InsetSidebar.tsx';

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

/**
 * The macOS layout's inset sidebar (Apple's kit's "Library Preview"), in the
 * app's own look: today's source list (Home/Sources) as collapsible sections,
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
    // One tab stop: the row picked.
    await userEvent.tab();
    await expect(warmUp).toHaveFocus();
    // Down to the next row, up past the heading's rows to the heading, End and Home.
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: new RegExp(`^${CLOSING.name},`) })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    await expect(canvas.getByRole('button', { name: 'Playlists' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    const last = SIDEBAR[SIDEBAR.length - 1].rows.at(-1)!;
    await expect(canvas.getByRole('button', { name: new RegExp(`^${last.name},`) })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    // (The heading, not the row of the same name: the heading folds.)
    await expect(canvas.getByRole('button', { name: 'Library', expanded: true })).toHaveFocus();
    // Down to the library row and Enter: it is picked, and onSelect says which pane.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect(args.onSelect).toHaveBeenLastCalledWith({ kind: 'starred' });
    await expect(canvas.getByRole('button', { name: 'Starred' })).toHaveAttribute('aria-current', 'true');
    await expect(warmUp).not.toHaveAttribute('aria-current');
    // A click picks too.
    await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${BRIGHT_FAST.name}, smart playlist`) }));
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

/** Many playlists, some with long names: the names end in an ellipsis and the panel scrolls inside itself, the window buttons' band staying put. */
export const LongNamesManyPlaylists: Story = {
  name: 'Long names, many playlists',
  args: { sections: sidebarSections(MANY, { library: 250, starred: 12 }), lists: MANY },
  play: async ({ canvasElement, canvas }) => {
    const body = canvasElement.querySelector<HTMLElement>('.lay-side-body')!;
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const long = canvas.getByText(/^Closing set, Saturday night/);
    await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
    // The last row scrolls into view when the keyboard reaches it.
    canvas.getByRole('button', { name: 'Library', expanded: true }).focus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  },
};
