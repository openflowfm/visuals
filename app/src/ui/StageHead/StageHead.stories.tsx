import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { Opaque } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { DISPLAYS, FX, LINK_OFF } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { useLive } from '../model/useLive';
import { LEAVE_LABEL, LEAVE_TITLE, StageHead, type StageHeadForm } from './StageHead';

/** What a story sets: the window's width, whether it plays in the window, and the header's form (outside an assembled screen, the first unless given). */
interface Args {
  width: number;
  windowed: boolean;
  form?: StageHeadForm;
  /** `\` pinned the controls: "Pinned" in the status area. */
  pinned?: boolean;
  /** The library map open at start: its button pressed. */
  map?: boolean;
}

/**
 * The header over the picture, `width` wide, on the stories' fake app: live's
 * real state (`useLive`; with `windowed` false, as when the app starts in live
 * mode, it opens the output on the projector), the window buttons drawn where
 * macOS puts them. The picture is the frame's still (`--vs-still`); everything over it
 * is in the Stage's `Opaque` scope, as the shell puts it.
 */
function Window({ width, windowed, form, pinned = false, map: mapAtStart = false }: Args) {
  const live = useLive({ start: null, windowed });
  const [help, setHelp] = useState(false);
  const [map, setMap] = useState(mapAtStart);
  const [left, setLeft] = useState(false);
  return (
    <Opaque>
      <div data-left={left ? '' : undefined} style={{ position: 'relative', width, height: 320, background: 'var(--vs-still) center / cover var(--key-black)', overflow: 'hidden' }}>
        <span aria-hidden="true" style={{ position: 'absolute', top: 22, left: 24, display: 'flex', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <i key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </span>
        {/* The shell's header row: 52px, 84px kept for the window buttons, 16px at the right. */}
        <div style={{ position: 'absolute', top: 0, right: 16, left: 84, height: 52, display: 'flex' }} data-tauri-drag-region>
          <StageHead
            live={live}
            help={help}
            onHelp={() => setHelp((h) => !h)}
            onView={() => {}}
            onLeave={() => setLeft(true)}
            pinned={pinned}
            mapOpen={map}
            onMap={() => setMap((m) => !m)}
            form={form}
          />
        </div>
      </div>
    </Opaque>
  );
}

/**
 * **The Stage's header**: one row of bare type on the traffic lights' line over
 * the full-bleed picture (no capsules), in the shell's header row, which keeps
 * the window buttons' room. On the left Home | Live as Home's header draws it;
 * on the right the status area (quiet notes when there are any: skipped
 * presets, a low frame rate, no sound, a failure, "Pinned"), the Beat light
 * (tap tempo and Link in its popover), the Output light as a dot and words
 * (white on a display, grey in this window; "Full screen on…" in its popover
 * while the picture plays here), a hairline, then the library map's toggle (G),
 * the mixer and its meter, the camera, ?, settings and ✕, in Home's order. Between them the picture, which
 * drags the window. No toasts.
 */
const meta = {
  title: 'open[flow]/visuals/Live/Stage/Header',
  component: Window,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { width: 1440, windowed: false },
  parameters: { scope: 'home', layout: 'fullscreen' },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 1440 wide, the output on the projector (its words white), Link on with two peers; ✕ leaves. */
export const OnTheProjector: Story = {
  play: async ({ canvas, canvasElement }) => {
    const output = await canvas.findByRole('button', { name: 'Output, on Projector (HDMI)' });
    await expect(output).toBeVisible();
    await expect(output.querySelector('.vs-stagehead-light-text')).toHaveAttribute('data-on');
    await expect(await canvas.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' })).toBeVisible();
    await expect(canvas.getByRole('radio', { name: /live/i })).toHaveAttribute('aria-checked', 'true');
    await expect(canvas.getByRole('button', { name: LEAVE_LABEL })).toHaveAttribute('title', LEAVE_TITLE);
    await userEvent.click(canvas.getByRole('button', { name: LEAVE_LABEL }));
    await expect(canvasElement.querySelector('[data-left]')).not.toBeNull();
  },
};

/** The Beat light's popover open: tap tempo, then Link. */
export const BeatOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' }));
    const pop = canvas.getByRole('dialog', { name: 'Beat, 124 BPM, 2 in time' });
    await expect(within(pop).getByRole('button', { name: /^Link tempo, 124 BPM/ })).toBeVisible();
    await expect(await within(pop).findByRole('region', { name: 'Ableton Link' })).toBeVisible();
  },
};

/** The Output light's popover open: on the projector, the display picked, how the picture fits. */
export const OutputOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Output, on Projector (HDMI)' }));
    const pop = canvas.getByRole('dialog', { name: 'Output, on Projector (HDMI)' });
    await expect(within(pop).getByText('Showing on Projector (HDMI)')).toBeVisible();
    await expect(within(pop).getByText(/^Fills Projector/)).toBeVisible();
  },
};

/** Link off: the tapped tempo, no peers. */
export const LinkOff: Story = {
  parameters: { world: { link: LINK_OFF, fx: { ...FX, linked: false } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: /^Beat, \d+ BPM$/ })).toBeVisible();
  },
};

/** Playing in the window (how going live starts): "In this window" in grey, and the Output popover offering full screen on either display. */
export const InTheWindow: Story = {
  args: { windowed: true },
  play: async ({ canvas }) => {
    const output = await canvas.findByRole('button', { name: 'Output, in this window' });
    await expect(output.querySelector('.vs-stagehead-light-text')).not.toHaveAttribute('data-on');
    await expect(canvas.queryByRole('button', { name: /^Go full screen on/ })).toBeNull();
    await userEvent.click(output);
    const pop = canvas.getByRole('dialog', { name: 'Output, in this window' });
    await expect(await within(pop).findByRole('button', { name: 'Go full screen on Projector (HDMI)' })).toBeVisible();
    await expect(within(pop).getByRole('button', { name: 'Go full screen on Built-in Retina Display' })).toBeVisible();
  },
};

/** `\` pinned the controls: a grey "Pinned" in the status area, before Beat. */
export const Pinned: Story = {
  args: { pinned: true },
};

/** The library map open: its button first after the hairline, pressed (a faint wash), G its key; a click lets it go. */
export const MapOpen: Story = {
  name: 'Map open',
  args: { map: true },
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Library map' });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveAttribute('aria-controls', 'stage-map');
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'G');
    await expect(button.getAttribute('title')).toMatch(/^Library map: .*\(G\)$/);
    await userEvent.click(button);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  },
};

/** 800 wide (the short form) with one display: still one line; the Output popover says the picture will cover this window. */
export const Narrow: Story = {
  args: { width: 800, form: 'short', windowed: true },
  parameters: { world: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Output, in this window' }));
    await expect(await within(canvas.getByRole('dialog')).findByText('One display: the picture will cover this window. ✕ or ⌘⇧L comes back.')).toBeVisible();
  },
};

/** 800 wide (the short form) with the Output popover open on one display: the warning that it covers this window too, inside the window. */
export const NarrowOneDisplayWarning: Story = {
  args: { width: 800, form: 'short' },
  parameters: { world: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Output, / }));
    const pop = canvas.getByRole('dialog');
    await expect(await within(pop).findByText(/^Only one display is connected/)).toBeVisible();
  },
};
