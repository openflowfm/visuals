import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import type * as pl from '../playlists.ts';
import { DATA, LISTS, MOOD_DECK, PLAYLISTS, row } from '../stories/fixtures.ts';
import { say } from '../words.ts';
import type { LiveState } from './live-model.ts';
import { StageCrate } from './StageCrate.tsx';
import { STAGE_CRATE_ID } from './stage-model.ts';

/** Live's state as the crate reads it, from the stories' fixtures. */
function liveOf(lists: pl.Lists | null): LiveState {
  return {
    lists,
    setLists: fn(),
    deck: lists?.deck ?? null,
    current: lists?.deck.current ?? null,
    held: false,
    effects: null,
    status: { display: null, size: null },
    displays: null,
    inWindow: false,
    data: DATA,
    key: null,
    star: false,
    rating: null,
    says: { kind: 'held' },
    up: null,
    error: null,
    setError: fn(),
    fail: () => fn(),
    dismiss: fn(),
    act: fn(),
    actFx: fn(),
    show: fn(),
    intensity: 0.5,
    setIntensity: fn(),
    favourite: fn(),
    rate: fn(),
  };
}

/** Enough playlists that the crate scrolls inside itself. */
const MANY: pl.Lists = {
  ...LISTS,
  playlists: [...PLAYLISTS, ...Array.from({ length: 16 }, (_, i) => ({ ...PLAYLISTS[i % PLAYLISTS.length], id: `copy-${i}`, name: `${PLAYLISTS[i % PLAYLISTS.length].name} ${i + 2}` }))],
};

/**
 * The Stage's crate: Home's inset sidebar, opaque over the full-bleed picture
 * (here a stand-in gradient), down the window's left.
 */
const meta = {
  title: 'Live/Stage/Crate',
  component: StageCrate,
  args: { live: liveOf(LISTS), mode: 'docked', onAway: fn() },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: 760, height: 720, background: 'radial-gradient(circle at 60% 40%, #f0a 0%, #40f 35%, #012 80%)', borderRadius: 26, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, display: 'flex', width: 256, padding: 8, boxSizing: 'border-box' }}>
          {/* The shell's panel (StageLayout's nav), as it draws it: the band for the window buttons, opaque, rounded. */}
          <nav
            id={STAGE_CRATE_ID}
            aria-label={say('crate')}
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minHeight: 0,
              paddingTop: 52,
              borderRadius: 18,
              background: 'var(--surface-corner)',
              boxShadow: 'var(--glass-edge), 0 18px 48px rgba(0, 0, 0, 0.45)',
              overflow: 'hidden',
              ['--caption' as string]: 'var(--caption-raised)',
            }}
          >
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
              <Story />
            </div>
          </nav>
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof StageCrate>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Docked beside the picture, Warm-up playing. */
export const Docked: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: say('crate') })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Warm-up, playing' })).toHaveAttribute('aria-current', 'true');
  },
};

/** A mood playing: its row lit. */
export const MoodPlaying: Story = {
  args: { live: liveOf({ ...LISTS, deck: MOOD_DECK }) },
  parameters: { tauri: { lists: { ...LISTS, deck: MOOD_DECK }, deckItems: [row(8).path, row(14).path, row(21).path] } },
};

/** The keyboard: one tab stop (the playlist playing), the arrows walk the headings and rows. */
export const Keyboard: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Warm-up, playing' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(canvas.getByRole('button', { name: 'Playlists' })).toHaveFocus();
  },
};

/** More playlists than fit: the sections scroll inside the crate, the mark staying put. */
export const LongLists: Story = {
  args: { live: liveOf(MANY) },
  play: async ({ canvasElement }) => {
    const scroller = canvasElement.querySelector('.scr') as HTMLElement;
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  },
};

/** Before the playlists are in. */
export const Reading: Story = { args: { live: liveOf(null) } };
