import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Opaque } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { FX_BUSY } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { useLive } from '../model/useLive';
import { EffectsPanel } from './EffectsPanel';

/**
 * The panel where the Stage docks it: 20px in from the left of a 1280 × 720 window, from 64px down
 * to 100px over the foot, 340px wide, over the frame's still standing in for the native picture,
 * on the stories' fake app (`useLive`, and the panel's own `useFx`), so every control really acts.
 */
function Window() {
  const live = useLive({ start: null });
  return (
    <Opaque>
      <div style={{ position: 'relative', width: 1280, height: 720, background: 'var(--vs-still) center / cover var(--key-black)' }}>
        <div style={{ position: 'absolute', top: 64, bottom: 100, left: 20, width: 340, display: 'flex' }}>
          <EffectsPanel live={live} onClose={() => {}} />
        </div>
      </div>
    </Opaque>
  );
}

/**
 * **Live's effects panel** (design C): Home's side-panel material at the Stage's left. The held
 * effects as pads ("Hold · ⇧ to latch · Blackout toggles": Strobe S, Blackout B, Freeze F, Punch P), Intensity,
 * Speed, Colour and Trails as slider rows, Mirror and Invert, and Back to normal (0) at its foot.
 */
const meta = {
  title: 'open[flow]/visuals/Live/Stage/Effects panel',
  component: Window,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: every control there, Blackout toggling. */
export const AtRest: Story = {
  play: async ({ canvas }) => {
    const panel = await canvas.findByRole('complementary', { name: 'Effects' });
    const p = within(panel);
    await expect(p.getByText('Hold · ⇧ to latch · Blackout toggles')).toBeVisible();
    for (const name of ['intensity', 'speed', 'hue', 'trails']) await expect(await p.findByRole('slider', { name })).toBeVisible();
    const blackout = p.getByRole('button', { name: 'Blackout (B)' });
    await userEvent.click(blackout);
    await waitFor(() => expect(blackout).toHaveAttribute('aria-pressed', 'true'));
    await expect(p.getByRole('button', { name: 'Back to normal' })).toBeVisible();
  },
};

/** Mid-set: the mirror and trails on, speed up. */
export const Busy: Story = {
  parameters: { world: { fx: { ...FX_BUSY, invert: true } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'invert' })).toHaveAttribute('aria-pressed', 'true');
  },
};
