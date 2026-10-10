import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { LibraryRow } from '../api.ts';
import { ROWS } from '../stories/fixtures.ts';
import { HomeLayout } from './HomeLayout.tsx';
import { InsetSidebar } from './InsetSidebar.tsx';
import { Section, type SectionProps } from './Section.tsx';
import { NOW, SECTIONS, SIDEBAR, STARRED } from './fixtures.ts';

/** A long name, to show the title and a tile's name ellipsised. */
const LONG = 'Everything the bundled starter set has, from the softest washes to the hardest strobes, in the order the index lists them';
/** A row whose title runs long. */
const longRow: LibraryRow = { ...ROWS[1], key: 'long', title: 'An extraordinarily long preset title that cannot possibly fit under its picture' };

/** The sections in the macOS layout's main column, in a window `width` px wide (the sidebar beside them, as in the app). */
function Window({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div style={{ width, height: 820 }}>
      <HomeLayout lights header={null} sidebar={<InsetSidebar sections={SIDEBAR} selected={{ kind: 'library' }} onSelect={() => {}} collapsed={[]} onToggle={() => {}} />}>
        {children}
      </HomeLayout>
    </div>
  );
}

/** Home's sections stacked, as the main column shows them: recently played, the playlist playing, a style, then the whole library. */
function Stacked({ width, onPlay, onSeeAll }: { width: number; onPlay?: SectionProps['onPlay']; onSeeAll?(): void }) {
  const seeAll = { label: 'See all', onPress: () => onSeeAll?.() };
  return (
    <Window width={width}>
      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title} action={seeAll} rows={s.rows} playing={NOW.path} starred={STARRED} onPlay={onPlay} />
      ))}
      <Section title="Library" action={seeAll} rows={ROWS} playing={NOW.path} starred={STARRED} onPlay={onPlay} />
    </Window>
  );
}

/**
 * A titled section of the macOS layout's main column: the title in the app's
 * display type, "See all ›" as type at its right, and one row of today's tiles,
 * as many as fit the width (the rest are left out: no wrap, no sideways
 * scroll). A tile plays from there on a click, Enter or Space.
 */
const meta = {
  title: 'Layout/Section',
  component: Stacked,
  parameters: { scope: 'bare', layout: 'fullscreen' },
  args: { width: 1600, onPlay: fn(), onSeeAll: fn() },
} satisfies Meta<typeof Stacked>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The library section's row: how many tiles it shows. */
const shownIn = (canvas: HTMLElement, name: string) => within(within(canvas).getByRole('region', { name })).getAllByRole('listitem').length;

/** In a 1600 px window: more tiles a row. A tile's click plays it, and See all calls back. */
export const Wide: Story = {
  name: 'Wide (1600 px)',
  play: async ({ canvas, canvasElement, args }) => {
    const library = canvas.getByRole('region', { name: 'Library' });
    // 1600 − the sidebar (256) − the column's padding (44): 1300 px, six tiles of at least 200 with 16 between.
    await waitFor(() => expect(shownIn(canvasElement, 'Library')).toBe(6));
    await expect(within(library).getByRole('list')).toHaveAttribute('data-total', String(ROWS.length));
    const first = within(library).getAllByRole('button')[1]; // [0] is See all
    await userEvent.click(first);
    await expect(args.onPlay).toHaveBeenCalledWith(ROWS[0]);
    await userEvent.click(within(library).getByRole('button', { name: 'See all' }));
    await expect(args.onSeeAll).toHaveBeenCalledTimes(1);
  },
};

/** In a 900 px window: fewer. The keyboard reaches a tile and Enter plays it. */
export const Narrow: Story = {
  name: 'Narrow (900 px)',
  args: { width: 900 },
  play: async ({ canvas, canvasElement, args }) => {
    // 900 − 256 − 44: 600 px, two tiles (three would need 632).
    await waitFor(() => expect(shownIn(canvasElement, 'Library')).toBe(2));
    const library = canvas.getByRole('region', { name: 'Library' });
    const tiles = within(library).getAllByRole('button').slice(1);
    tiles[1].focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPlay).toHaveBeenCalledWith(ROWS[1]);
  },
};

/** The playlist playing, its playing tile marked and named so; a starred one says so too. */
export const Playing: Story = {
  render: (args) => (
    <Window width={args.width}>
      <Section title={SECTIONS[1].title} action={{ label: 'See all', onPress: () => {} }} rows={SECTIONS[1].rows} playing={NOW.path} starred={STARRED} onPlay={args.onPlay} />
    </Window>
  ),
  play: async ({ canvas }) => {
    const list = within(canvas.getByRole('region', { name: SECTIONS[1].title }));
    const now = list.getByRole('button', { current: true });
    await expect(now).toHaveAccessibleName(/ · playing/);
    await expect(now.querySelector('.tile-live')).not.toBeNull();
    await expect(list.getAllByRole('button', { current: false }).length).toBeGreaterThan(1);
  },
};

/** Empty, a long title and a long preset name, and a section with nothing to play: only pictures. */
export const EmptyAndLong: Story = {
  name: 'Empty and long',
  args: { width: 900 },
  render: (args) => (
    <Window width={args.width}>
      <Section title="Starred" rows={[]} empty="Star a preset to keep it here" />
      <Section title={LONG} action={{ label: 'See all', onPress: () => {} }} rows={[longRow, ...ROWS.slice(2, 8)]} onPlay={args.onPlay} />
      <Section title="Pictures only" rows={ROWS.slice(8, 14)} />
    </Window>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Star a preset to keep it here')).toBeVisible();
    const title = canvas.getByRole('heading', { name: LONG });
    await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    const pictures = canvas.getByRole('region', { name: 'Pictures only' });
    await expect(within(pictures).queryAllByRole('button')).toHaveLength(0);
  },
};
