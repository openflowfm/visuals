import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { prepareRow } from './librarySearch.ts';
import { NowPanel } from './NowPanel.tsx';
import { DATA, PLAYLISTS, row, WARM_UP } from './stories/fixtures.ts';
// Home's tokens (--surface-1…) and its rules for what sits in it, as Home.tsx brings them.
import './home.css';

const prepared = (n: number) => prepareRow(row(n), DATA.presets[row(n).key]);
/** Warm-up's first preset: starred, rated, tagged "warm-up", and in Warm-up. */
const playing = prepared(0);

/** The home's right-hand panel (decision 67): the big preview, the name, star, never play, + playlist, what it is and my tags. */
const meta = {
  title: 'Now Playing/NowPanel',
  component: NowPanel,
  args: {
    chosen: [playing],
    current: { path: playing.row.path, name: playing.title, group: playing.style },
    from: `from ${WARM_UP.name}`,
    playlists: PLAYLISTS,
    onSet: fn(),
    onAddTo: fn(),
    onClose: fn(),
    error: null,
  },
  // The panel's cell on the home, at its width, the height of a window's middle row.
  decorators: [
    (Story) => (
      <div className="home-now" style={{ width: 340, height: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NowPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One preset playing, with its star and tags from the user's library. */
export const Playing: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: playing.title })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('group', { name: /tags/ })).toHaveTextContent('warm-up');
  },
};

/** Several picked in the grid: "3 selected", their star and tags at once (a tag on some shows on how many). */
export const Selected: Story = {
  args: { chosen: [prepared(0), prepared(3), prepared(14)] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: '3 selected' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'mixed');
  },
};

/** Nothing playing yet: the actions wait. */
export const Nothing: Story = {
  args: { chosen: [], current: null, from: '' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing playing yet')).toBeVisible();
  },
};

/** A change that didn't stick, said under the tags. */
export const Failed: Story = { args: { error: 'Couldn’t star it: the library file is read-only.' } };
