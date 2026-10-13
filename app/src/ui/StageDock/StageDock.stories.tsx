import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Opaque } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { FX_BUSY, LISTS, MOOD_DECK } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { useLive } from '../model/useLive';
import { StageDock, type StageDockForm } from './StageDock';

/** The window's width the controls are drawn in, and the form they draw (outside an assembled screen, the first unless given). */
interface Args {
  width: number;
  form?: StageDockForm;
}

/**
 * The controls as the Stage places them: 20px under the header's row, 32px in from the sides and
 * 36px over the foot of a window `width` wide, over the frame's still standing in for the native
 * preview, on the stories' fake app through `useLive`, so the keys really act. The Effects button
 * toggles its pressed state here (the panel is the shell's: Live/Stage/Layout and Live).
 */
function Window({ width, form }: Args) {
  const live = useLive({ start: null });
  const [open, setOpen] = useState(false);
  return (
    <Opaque>
      <div style={{ position: 'relative', width, height: 420, background: 'var(--vs-still) center / cover var(--key-black)' }}>
        <div style={{ position: 'absolute', top: 72, right: 32, bottom: 36, left: 32, display: 'flex' }}>
          <StageDock live={live} form={form} effectsOpen={open} onEffects={() => setOpen((o) => !o)} />
        </div>
      </div>
    </Opaque>
  );
}

/**
 * **The Stage's controls.** Home's transport floating over the picture: the preset playing and
 * where from at the top left, and at the foot one row on one line: Effects (the spark, its word
 * and E) on the left, ◀ the auto-change ring ▶ dead centre (a click on the ring is HOLD; its
 * tooltip says when it moves on), the dice and the star on the right. In the stacked form (a
 * narrow window) Effects is its glyph alone.
 */
const meta = {
  title: 'open[flow]/visuals/Live/Stage/Dock',
  component: Window,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { width: 1440 },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up: Effects at the left, the keys dead centre, the dice and star at the right; the ring holds and lets go; Effects is pressed while open. */
export const Playing: Story = {};

/** Narrow (a 600px window), stacked: Effects its glyph alone, the row still one line. */
export const Narrow: Story = {
  args: { width: 600, form: 'stacked' },
};

/** Mid-set on a mood: HOLD on (the ring not pressed). */
export const Busy: Story = {
  parameters: { world: { fx: FX_BUSY, lists: { ...LISTS, deck: MOOD_DECK } } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole('button', { name: 'move on by itself' })).toHaveAttribute('aria-pressed', 'false'));
  },
};
