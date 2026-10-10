import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { HoldPad, Live, Pad } from './Live.tsx';
import { FX, FX_BUSY, LISTS, PLAYING_DECK, WARM_UP } from './stories/fixtures.ts';

/**
 * Live mode, whole, as `App` shows it: the status strip, now and next over the
 * preview, the pads and Intensity, and the crate beside them. With two
 * displays it opens the output on the way in, so the picture goes to the
 * projector.
 */
const meta = {
  title: 'Live/Live',
  component: Live,
  args: { start: null, onMode: () => {} },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof Live>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up with Link on (two peers, 124 BPM), the output on the projector. */
export const Playing: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: /^Output, on Projector/ })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /2 in time/ })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Up next' })).toBeVisible();
  },
};

/** Mid-set: HOLD on, speed up, the mirror and trails on; the pad lit and Next waiting. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('HOLD')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** One display: played in the window, with no output to open. */
export const OneDisplay: Story = {
  parameters: { tauri: { displays: [{ id: 1, index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, main: true }] } },
};

/** Started in the window (`live-windowed`): the "Go full screen on…" overlay over the preview. */
export const Windowed: Story = { args: { windowed: true } };

/** Nothing playing yet and no playlist: live picks one at random. */
export const FromNothing: Story = {
  parameters: { tauri: { lists: { playlists: [WARM_UP], deck: { ...PLAYING_DECK, playlist: null, index: null, current: null, next: null, next_index: null, count: 0, settings: null } } } },
};

/** The pads on their own: a toggle off and on, and a held effect. */
export const Pads: StoryObj<typeof Pad> = {
  render: () => (
    <div className="live">
      <div className="wdg live-pads" style={{ width: 640 }} role="group" aria-label="Live controls">
        <div className="live-pads-row" data-row="presets">
          <Pad id="previous" onPress={fn()}>
            ◀ Previous
          </Pad>
          <Pad id="random" onPress={fn()}>
            Random
          </Pad>
          <Pad id="step" onPress={fn()}>
            Next ▶
          </Pad>
        </div>
        <div className="live-pads-row" data-row="effects">
          <Pad id="hold" on onPress={fn()}>
            Hold
          </Pad>
          <HoldPad id="strobe" kind="strobe" on={FX.strobe} send={fn()}>
            Strobe
          </HoldPad>
          <Pad id="blackout" on={false} onPress={fn()}>
            Blackout
          </Pad>
          <HoldPad id="freeze" kind="freeze" on send={fn()}>
            Freeze
          </HoldPad>
        </div>
      </div>
    </div>
  ),
  parameters: { scope: 'bare', layout: 'padded' },
  globals: { viewport: { value: 'home900', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: /^Blackout/ })).toHaveAttribute('aria-pressed', 'false');
  },
};
