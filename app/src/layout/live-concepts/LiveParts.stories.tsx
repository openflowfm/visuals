import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { FX_BUSY, LISTS, PLAYING_DECK } from '../../stories/fixtures.ts';
import { Glyph, LIVE_GLYPHS } from './glyphs.tsx';
import { BeatLight, DeckPads, EffectPads, IntensityFader, MoreEffectsButton, NowNext, OutputLight, useLive, WarningCard } from './parts.tsx';

/** The parts on one sheet, on the fixtures: Live's state as useLive reads it. */
function Sheet() {
  const live = useLive();
  return (
    // Home's tokens come with `.app.home`, whose own grid (app.css) the sheet's column sits inside.
    <div className="app home lc" style={{ display: 'block', height: 'auto', background: 'var(--surface-0)' }}>
      <div style={{ display: 'grid', gap: 28, width: 720, padding: 24 }}>
        <div style={{ display: 'flex', gap: 18, color: 'var(--ui)' }} aria-label="glyphs" role="group">
          {LIVE_GLYPHS.map((g) => (
            <Glyph key={g} name={g} label={g} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <BeatLight live={live} />
          <OutputLight live={live} />
        </div>
        <NowNext live={live} />
        <DeckPads live={live} />
        <EffectPads live={live} />
        <DeckPads live={live} variant="key" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <IntensityFader live={live} />
          </div>
          <MoreEffectsButton />
        </div>
        <WarningCard onUnderstood={() => {}} />
      </div>
    </div>
  );
}

/**
 * The parts the Live view's concepts share (`parts.tsx`), in Home's language:
 * Live's glyphs drawn on Home's 16-unit grid, the beat and output lights as
 * Home's popovers, now and next as type, the pads (raised tiles, or keys as
 * the transport's), the Intensity fader as the transport's track, and the
 * flashing-lights warning as an opaque card. Every one acts on the stories'
 * fake app as Live's own do.
 */
const meta = {
  title: 'Live/Concepts/Parts',
  component: Sheet,
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up, Link on: the pads act (Hold lights), the lights open their panels. */
export const Playing: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/124 BPM/)).toBeVisible();
    const hold = canvas.getAllByRole('button', { name: /^Hold/ })[0];
    await expect(hold).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(hold);
    await waitFor(() => expect(canvas.getAllByRole('button', { name: /^Hold/ })[0]).toHaveAttribute('aria-pressed', 'true'));
    await expect(canvas.getByRole('slider', { name: 'Intensity' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Where the picture goes' }));
    await expect(await canvas.findByRole('dialog', { name: 'Where the picture goes' })).toBeVisible();
  },
};

/** Mid-set: HOLD on and the effects busy. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Hold', { selector: '.lc-held' })).toBeVisible();
  },
};
