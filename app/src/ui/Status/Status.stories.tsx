import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Layer } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { FX, LINK, LINK_OFF, OUTPUT_OFF, OUTPUT_ON } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import type * as fx from '../model/fx';
import { localEvents } from '../model/ipc';
import type * as link from '../model/link';
import type * as output from '../model/output';
import { BeatDot, bpmText, Fps, outputText, SkipNote, TapButton } from './Status';

/**
 * The live status readouts together, as the Stage's header and beat popover hold them: the beat
 * dot and tempo, where the output goes, the frame rate (only while low), the skipped note, and
 * the tap key in a float layer. No story in the original.
 */
function StatusLine({ frame, effects, status, onTap }: { frame: link.Frame | null; effects: fx.Fx | null; status: output.Status; onTap(): void }) {
  const out = outputText(status);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)', width: 360 }}>
      <div className="vs-num" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--vs-text-label)', fontVariantNumeric: 'tabular-nums' }}>
        <BeatDot frame={frame} className="story-beat" />
        <span>{bpmText(frame, effects) ?? '—'}</span>
        <span style={{ color: out.on ? 'var(--vs-playing)' : 'var(--text-3)' }}>{out.text}</span>
        <SkipNote className="story-skipped" />
        <Fps className="story-fps" />
      </div>
      <Layer level="float" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-card)' }}>
        <TapButton effects={effects} onTap={onTap} />
      </Layer>
    </div>
  );
}

const meta = {
  title: 'open[flow]/visuals/Controls/Status',
  component: StatusLine,
  args: { frame: LINK, effects: FX, status: OUTPUT_ON, onTap: fn() },
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof StatusLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a Link session, on the projector: the tempo is Link's, the tap key lit. */
export const Linked: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Link tempo, 124 BPM (T)' })).toHaveAttribute('data-on');
  },
};

/** No session, in the window: the effects' tempo, tap in time. */
export const Tapping: Story = {
  args: { frame: LINK_OFF, effects: { ...FX, linked: false, bpm: 120 }, status: OUTPUT_OFF },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Tap tempo, 120 BPM (T)' }));
    await expect(args.onTap).toHaveBeenCalled();
  },
};

/** Before any tempo is known. */
export const Unknown: Story = {
  args: { frame: null, effects: null, status: OUTPUT_OFF },
};

/** The picture drawing slowly: the frame rate shows, in caution. */
export const SlowFrames: Story = {
  parameters: { world: { stats: { fps: 31, cpu_ms: 14 } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('31 fps', {}, { timeout: 3000 })).toBeVisible();
  },
};

/** Broken presets skipped: counted into one note. */
export const Skipped: Story = {
  play: async ({ canvas }) => {
    await localEvents().emit('preset-skipped', 'a.milk');
    await localEvents().emit('preset-skipped', 'b.milk');
    await expect(await canvas.findByText('Skipped 2 broken presets')).toBeVisible();
  },
};

/** Stepping stopped: presets in a row wouldn't draw. */
export const StoppedSkipping: Story = {
  play: async ({ canvas }) => {
    await localEvents().emit('preset-skipping-stopped', 8);
    await expect(await canvas.findByText("Stopped skipping: 8 presets in a row wouldn't draw")).toBeVisible();
  },
};
