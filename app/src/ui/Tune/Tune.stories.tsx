import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import type { LibraryChange, LibraryRow, Mine } from '../model/api';
import { prepareRow } from '../model/librarySearch';
import { row } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { TuneCard } from './Tune';
import { TuneSlider } from './TuneSlider';

/** The presets the card is about in the stories, and what the user keeps about each. */
const ROWS: LibraryRow[] = [row(18), row(19), row(20)];

/** What the card's `onSet` does to the user's data, as Rust's `library_set` would for a tune. */
function applied(mine: Record<string, Mine>, keys: string[], change: LibraryChange): Record<string, Mine> {
  const next = { ...mine };
  for (const key of keys) {
    const tune = { ...(change.clear_tune ? {} : next[key]?.tune), ...change.tune };
    for (const k of ['speed', 'sensitivity'] as const) if (tune[k] === 1) delete tune[k];
    next[key] = { ...next[key], tune: Object.keys(tune).length ? tune : undefined };
  }
  return next;
}

/** The card over `count` presets, their tunes kept as the card sets them. */
function Card({ count, start }: { count: number; start: Record<string, Mine> }) {
  const [mine, setMine] = useState(start);
  const subjects = ROWS.slice(0, count).map((r) => prepareRow(r, mine[r.key]));
  return (
    <div style={{ width: 280, padding: 20 }}>
      <TuneCard key={subjects.map((s) => s.row.key).join('\n')} subjects={subjects} onSet={(keys, change) => setMine((m) => applied(m, keys, change))} />
    </div>
  );
}

/** One slider on its own, keeping what it is given. */
function One({ start, disabled }: { start: number | null; disabled?: boolean }) {
  const [value, setValue] = useState(start);
  return (
    <div style={{ width: 280, padding: 20 }}>
      <TuneSlider name="speed" value={value} onChange={setValue} disabled={disabled} title="How fast this preset moves" />
    </div>
  );
}

type Args = { count: number; start: Record<string, Mine> };

/**
 * "For this preset" (and "for these presets"): a preset's own speed and how much it reacts, each a
 * musical multiple on a log rail from ¼× to 4×, detents at each doubling, filled from 1×.
 */
const meta = {
  title: 'open[flow]/visuals/Layout/Tune',
  component: Card,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { count: 1, start: {} },
  parameters: { scope: 'bare' },
} satisfies Meta<typeof Card>;
export default meta;
type S = StoryObj<Args>;

/** One preset kept at half speed: the arrows step to the next detent, Shift nudges, Delete puts it back to 1×, and "as made" clears both. */
export const ForThisPreset: S = {
  name: 'For this preset',
  args: { start: { [ROWS[0].key]: { tune: { speed: 0.5 } } } },
  play: async ({ canvasElement }) => {
    const card = within(within(canvasElement).getByRole('group', { name: 'for this preset' }));
    const speed = card.getByRole('slider', { name: 'speed' });
    await expect(speed).toHaveAttribute('aria-valuetext', '½×');
    speed.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(speed).toHaveAttribute('aria-valuetext', '1×');
    await userEvent.keyboard('{ArrowRight}');
    await expect(speed).toHaveAttribute('aria-valuetext', '2×');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await expect(speed).toHaveAttribute('aria-valuetext', '1.89×');
    await userEvent.keyboard('{Delete}');
    await expect(speed).toHaveAttribute('aria-valuetext', '1×');
    await userEvent.keyboard('{Home}');
    await expect(speed).toHaveAttribute('aria-valuetext', '¼×');
    await userEvent.click(card.getByRole('button', { name: 'as made' }));
    await waitFor(() => expect(speed).toHaveAttribute('aria-valuetext', '1×'));
    await expect(card.queryByRole('button', { name: 'as made' })).toBeNull();
  },
};

/** Three presets that share a speed but differ on how much they react: "Mixed", and a step sets all three. */
export const ForThesePresets: S = {
  name: 'For these presets',
  args: { count: 3, start: { [ROWS[0].key]: { tune: { speed: 2, sensitivity: 0.5 } }, [ROWS[1].key]: { tune: { speed: 2 } }, [ROWS[2].key]: { tune: { speed: 2, sensitivity: 4 } } } },
  play: async ({ canvasElement }) => {
    const card = within(within(canvasElement).getByRole('group', { name: 'for these presets' }));
    await expect(card.getByRole('slider', { name: 'speed' })).toHaveAttribute('aria-valuetext', '2×');
    const reacts = card.getByRole('slider', { name: 'how much it reacts' });
    await expect(reacts).toHaveAttribute('aria-valuetext', 'Mixed');
    reacts.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(reacts).toHaveAttribute('aria-valuetext', '½×');
    // Kept for all three once it rests: no longer mixed after the card reads them back.
    await new Promise((r) => setTimeout(r, 400));
    await expect(reacts).toHaveAttribute('aria-valuetext', '½×');
  },
};

/** The readout takes a typed multiple: "3/2" reads 1.50×, a double-click on the rail puts it back to 1×. */
export const Typed: S = {
  name: 'A typed value',
  render: () => <One start={1} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const speed = canvas.getByRole('slider', { name: 'speed' });
    await userEvent.click(canvas.getByRole('button', { name: 'speed 1×, type a value' }));
    await userEvent.keyboard('{Control>}a{/Control}3/2{Enter}');
    await expect(speed).toHaveAttribute('aria-valuetext', '1.50×');
    fireEvent.doubleClick(speed);
    await waitFor(() => expect(speed).toHaveAttribute('aria-valuetext', '1×'));
  },
};

/** Nothing to tune: dimmed, a dash, no knob, and the keys do nothing. */
export const Disabled: S = {
  name: 'Nothing to tune',
  render: () => <One start={1} disabled />,
  play: async ({ canvasElement }) => {
    const speed = within(canvasElement).getByRole('slider', { name: 'speed' });
    await expect(speed).toHaveAttribute('aria-valuetext', '–');
    await expect(speed).toHaveAttribute('aria-disabled', 'true');
  },
};
