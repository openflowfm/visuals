import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { FX, FX_BUSY, LISTS, MOOD_DECK, STILL, WARM_UP } from '../stories/fixtures.ts';
import { StageDock } from './StageDock.tsx';
import { useLive } from './useLive.ts';

/** The window's width the dock is drawn in. */
interface Args {
  width: number;
}

/**
 * The dock as the Stage places it: in the shell's panel, 8px in from the bottom
 * of a window `width` wide, over the picture (the still stands in for the native preview), on the
 * stories' fake app through `useLive`, so the keys and the fader really act.
 */
function Window({ width }: Args) {
  const live = useLive({ start: null });
  return (
    <div style={{ position: 'relative', width, height: 320, background: `#000 url(${STILL}) center / cover` }}>
      {/* The shell's panel (StageLayout paints it): opaque, Home's inset corners. */}
      <section
        aria-label="Live controls"
        style={{ position: 'absolute', right: 8, bottom: 8, left: 8, borderRadius: 18, background: 'var(--surface-corner)', boxShadow: 'var(--glass-edge), 0 18px 48px rgba(0, 0, 0, 0.45)' }}
      >
        <StageDock live={live} />
      </section>
    </div>
  );
}

/**
 * **The Stage's dock.** Home's transport bar as an opaque inset panel along the
 * bottom of the picture: ◀ ⏸ ▶ R, where pause is HOLD; the preset playing and
 * where from; the time on it; the audio input. Under it the deck's Next (and
 * when), HOLD, the star and rating; Strobe and Freeze (held while pressed,
 * Shift latches) and Blackout (a toggle) as keys with their letters;
 * Intensity; More effects…. Under about 940px of dock the keys drop their
 * names; under 700, Next takes a line of its own.
 */
const meta = {
  title: 'Live/Stage/Dock',
  component: Window,
  args: { width: 1440 },
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Whether two boxes overlap by more than a hair. */
const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

/** Every control in the dock's row, none over another, none past the dock. */
async function nothingOverlaps(root: HTMLElement) {
  const dock = root.querySelector('.sd')!.getBoundingClientRect();
  const parts = ['.sd-next', '.sd-keys', '.sd-fader', '.sd-more'].map((s) => root.querySelector(s)!.getBoundingClientRect());
  for (const [i, a] of parts.entries()) {
    await expect(a.right).toBeLessThanOrEqual(dock.right + 0.5);
    await expect(a.bottom).toBeLessThanOrEqual(dock.bottom + 0.5);
    for (const b of parts.slice(i + 1)) await expect(overlap(a, b)).toBe(false);
  }
}

/** Playing Warm-up on Link's bars: Next names the fourth item and the beats until it; pause holds, and Next says nothing comes. */
export const Playing: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText(WARM_UP.items[3].name)).toBeVisible();
    await expect(await canvas.findByText(/^in \d+ beats?$/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Strobe (hold S, ⇧S latches)' })).toBeVisible();
    await expect(canvas.getByRole('slider', { name: 'Intensity' })).toHaveAttribute('aria-valuetext', '50%');
    await nothingOverlaps(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'pause' }));
    await expect(await canvas.findByRole('button', { name: 'play' })).toBeVisible();
    await waitFor(() => expect(canvasElement.querySelector('.sd-next-line')!.textContent).toContain('held'));
    await userEvent.click(canvas.getByRole('button', { name: 'Blackout (B)' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Blackout (B)' })).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** At 800 wide: the keys keep their glyph and letter, everything on the row and none over another. */
export const Narrow: Story = {
  args: { width: 800 },
  globals: { viewport: { value: 'home900', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('button', { name: /^Freeze/ })).toBeVisible();
    await nothingOverlaps(canvasElement);
  },
};

/** Narrower still (a 600px window): Next on a line of its own over the effects. */
export const Narrower: Story = {
  args: { width: 600 },
  globals: { viewport: { value: 'home900', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('button', { name: /^Freeze/ })).toBeVisible();
    await nothingOverlaps(canvasElement);
  },
};

/** Mid-set on a mood: HOLD on (the Hold pill, play showing), the strobe latched. */
export const Busy: Story = {
  parameters: { tauri: { fx: { ...FX_BUSY, strobe: true }, lists: { ...LISTS, deck: MOOD_DECK } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Hold')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'play' })).toBeVisible();
    await waitFor(() => expect(canvas.getByRole('button', { name: /^Strobe/ })).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** An effect that won't change: the notice floats over the dock until dismissed. */
export const Failing: Story = {
  parameters: { tauri: { fx: FX, fail: { act: 'the effects engine is busy' } } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Blackout (B)' }));
    await expect(await canvas.findByRole('alert')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(canvas.queryByRole('alert')).toBeNull());
  },
};
