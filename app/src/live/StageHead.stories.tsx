import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DISPLAYS, FX, LINK_OFF, STILL } from '../stories/fixtures.ts';
import { FullScreenOffer, StageHead } from './StageHead.tsx';
import { useLive } from './useLive.ts';

/** What a story sets: the window's width, whether it plays in the window, and whether the crate is docked (its band then holds the window buttons). */
interface Args {
  width: number;
  windowed: boolean;
  docked: boolean;
}

/**
 * The header over the picture, `width` wide, on the stories' fake app: live's
 * real state (`useLive`, which opens the output on the projector unless
 * `windowed`), the window buttons drawn where macOS puts them, and the offer
 * under the header while it plays in the window.
 */
function Window({ width, windowed, docked }: Args) {
  const live = useLive({ start: null, windowed });
  const [crate, setCrate] = useState(docked);
  const [help, setHelp] = useState(false);
  return (
    <div data-crate={docked ? 'docked' : undefined} style={{ position: 'relative', width, height: 320, background: `#000 url("${STILL}") center / cover`, overflow: 'hidden' }}>
      {!docked && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 22, left: 24, display: 'flex', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <i key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </span>
      )}
      {/* The shell's header row: 84px kept for the window buttons, or beside the docked crate; 8px at the right. */}
      <div style={{ position: 'absolute', top: 0, right: 8, left: docked ? 272 : 84, display: 'flex' }} data-tauri-drag-region>
        <StageHead live={live} crateOpen={crate} onCrate={() => setCrate((c) => !c)} help={help} onHelp={() => setHelp((h) => !h)} onView={() => {}} />
      </div>
      <div style={{ position: 'absolute', top: 64, right: 0, left: 0, display: 'flex', justifyContent: 'center' }}>
        <FullScreenOffer live={live} />
      </div>
    </div>
  );
}

/**
 * **The Stage's header**: two opaque capsules on the traffic lights' line over
 * the full-bleed picture, in the shell's header row (which keeps the window
 * buttons' room, or sits beside the docked crate). On the left, the crate's toggle and Home | Live as Home's
 * header draws it; on the right, the skipped note and a low frame rate when
 * there are any, the Beat light (tap tempo and Link in its popover), the Output
 * light (the display, how the picture fits it, and the warnings), ? and
 * settings. Between them the picture, which drags the window. Under it, while
 * the picture plays in the window, "Go full screen on…".
 */
const meta = {
  title: 'Live/Stage/Header',
  component: Window,
  args: { width: 1440, windowed: false, docked: false },
  parameters: { scope: 'home', layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The header's capsules fit their window on one line, clear of the window buttons. */
async function fits(canvasElement: HTMLElement) {
  const head = canvasElement.querySelector<HTMLElement>('.stage-bar')!;
  await expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth);
  for (const cap of head.querySelectorAll<HTMLElement>('.stage-cap')) await expect(cap.getBoundingClientRect().height).toBe(36);
}

/** 1440 wide, the output on the projector, Link on with two peers. */
export const OnTheProjector: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('button', { name: 'Output, on Projector (HDMI)' })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' })).toBeVisible();
    await expect(canvas.getByRole('radio', { name: /live/i })).toHaveAttribute('aria-checked', 'true');
    // The toggle starts clear of the window buttons (x 24–76).
    await expect(canvas.getByRole('button', { name: 'playlists and up next' }).getBoundingClientRect().left).toBeGreaterThan(84);
    await fits(canvasElement);
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
  parameters: { tauri: { link: LINK_OFF, fx: { ...FX, linked: false } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: /^Beat, \d+ BPM$/ })).toBeVisible();
  },
};

/** Playing in the window (the welcome flow's way in): "In this window" in amber, and the offer to go full screen on either display. */
export const InTheWindow: Story = {
  args: { windowed: true },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Output, in this window' })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: 'Go full screen on Projector (HDMI)' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Go full screen on Built-in Retina Display' })).toBeVisible();
  },
};

/** 800 wide with one display: still one line each, and the offer says the picture will cover this window. */
export const Narrow: Story = {
  args: { width: 800 },
  parameters: { tauri: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText('One display: the picture will cover this window. ✕ or ⌘⇧L comes back.')).toBeVisible();
    await fits(canvasElement);
  },
};

/** 800 wide with the Output popover open on one display: the warning that it covers this window too, inside the window. */
export const NarrowOneDisplayWarning: Story = {
  args: { width: 800 },
  parameters: { tauri: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Output, / }));
    const pop = canvas.getByRole('dialog');
    await expect(await within(pop).findByText(/^Only one display is connected/)).toBeVisible();
    await waitFor(() => expect(pop.getBoundingClientRect().right).toBeLessThanOrEqual(800));
  },
};

/** The crate docked: its band holds the window buttons, so the leading capsule starts at its own edge. */
export const CrateDocked: Story = {
  args: { docked: true },
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('button', { name: 'playlists and up next' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle.getBoundingClientRect().left).toBeLessThan(272 + 30);
  },
};
