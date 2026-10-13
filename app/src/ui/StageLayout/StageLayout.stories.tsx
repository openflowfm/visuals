import { useState, type CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Layer } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { useLiveKeys } from '../model/liveKeys';
import { ViewSwitch } from '../Views/Views';
import { StageLayout } from './StageLayout';

/** The window a story draws, and how it starts. */
interface Args {
  width: number;
  height: number;
  /** The controls pinned shown at start, as `\` pins them. */
  pinned: boolean;
  warning: boolean;
  inWindow: boolean;
  /** Esc held at start, as if pressed and not let go: the progress toward leaving. */
  leaving?: boolean;
  /** The effects panel open (a stand-in), docked at the left. */
  effects?: boolean;
}

/** The stand-in parts' looks (the real ones are their own stories'): type on the scrim, and the toast a float surface. */
const type: CSSProperties = { color: 'var(--text-2)', fontSize: 'var(--size-caption)' };
const panel: CSSProperties = { padding: '14px 18px', borderRadius: 18, color: 'var(--text-2)', fontSize: 'var(--size-body)' };
const key: CSSProperties = { height: 30, padding: '0 8px', border: 0, background: 'none', color: 'inherit', font: 'inherit' };

/** The native window buttons' stand-in: three 12px dots where macOS puts them (x 24, centred on y 28). */
function Lights() {
  return (
    <span aria-hidden="true" style={{ position: 'absolute', top: 22, left: 24, zIndex: 11, display: 'flex', gap: 8, pointerEvents: 'none' }}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ width: 12, height: 12, borderRadius: 6, background: 'color-mix(in oklab, var(--text-1) 18%, transparent)' }} />
      ))}
    </span>
  );
}

/**
 * The Stage on stand-in parts (the header and the controls are their own
 * stories'), working as Live wires it: `\` pins the controls shown and lets
 * them go, Esc held shows its progress toward leaving.
 */
function Composed({ width, height, pinned: pinnedAtStart, warning, inWindow, leaving: heldAtStart = false, effects = false }: Args) {
  const [pinned, setPinned] = useState(pinnedAtStart);
  const [leaving, setLeaving] = useState(heldAtStart);
  const [left, setLeft] = useState(false);
  const none = () => {};
  useLiveKeys({
    editor: () => setLeft(true),
    act: none,
    fx: none,
    rate: none,
    favourite: none,
    help: none,
    sheetOpen: () => false,
    panels: () => setPinned((p) => !p),
    holding: setLeaving,
  });
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }} data-left={left ? '' : undefined}>
      <StageLayout
        pinned={pinned}
        warning={warning}
        inWindow={inWindow}
        leaving={leaving}
        head={
          <div style={{ ...type, display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <ViewSwitch view="live" onChange={() => {}} />
            <span style={{ flex: 1, alignSelf: 'stretch' }} data-tauri-drag-region />
            <span>Beat · In this window · ? · ⚙ · ✕</span>
          </div>
        }
        dock={
          <div style={{ ...type, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', pointerEvents: 'none' }}>
            <b style={{ color: 'var(--text-1)', fontSize: 'var(--size-heading)' }}>Flexi - mindblob</b>
            <div style={{ display: 'grid', gap: 6, pointerEvents: 'auto' }}>
              <span>
                <button type="button" style={key}>
                  ◀
                </button>
                <button type="button" style={key}>
                  ⟳
                </button>
                <button type="button" style={key}>
                  ▶
                </button>
              </span>
              <span>Effects · ◀ ⟳ ▶ · dice · star</span>
            </div>
          </div>
        }
        panel={
          effects ? (
            <Surface as="aside" layer="raised" aria-label="Effects" style={{ ...panel, height: '100%', boxSizing: 'border-box' }}>
              Effects: Strobe · Blackout · Freeze · Punch · Intensity · Speed · Colour · Trails
            </Surface>
          ) : undefined
        }
        centre={
          warning ? (
            <Layer level="overlay" role="alertdialog" aria-label="flashing lights" style={{ ...panel, maxWidth: 420 }}>
              Live mode can show flashing lights. I understand.
            </Layer>
          ) : undefined
        }
      >
        <Lights />
      </StageLayout>
    </div>
  );
}

const meta = {
  title: 'open[flow]/visuals/Live/Stage/Layout',
  component: Composed,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { width: 1440, height: 900, pinned: false, warning: false, inWindow: false, leaving: false, effects: false },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Composed>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The one overlay (the header and the controls on the scrim). */
const reveal = (root: HTMLElement) => root.querySelector<HTMLElement>('.vs-stagelayout-reveal')!;

/** 1440 × 900: the picture the whole window, the header and the controls over it (no crate, no dock bar); focus in them shows them, as hovering the window does. */
export const Wide: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('navigation')).toBeNull();
    await expect(canvas.getByRole('region', { name: 'Live controls' })).toBeInTheDocument();
    await expect(canvas.getByRole('img', { name: /preview of the playing preset/ })).toBeInTheDocument();
  },
};

/** `\` pinned the controls: shown hovered or not; `\` lets them go again. */
export const Pinned: Story = {
  args: { pinned: true },
  play: async ({ canvasElement }) => {
    await expect(reveal(canvasElement)).toHaveAttribute('data-pinned');
    await userEvent.keyboard('\\');
    await waitFor(() => expect(reveal(canvasElement)).not.toHaveAttribute('data-pinned'));
    await userEvent.keyboard('\\');
    await waitFor(() => expect(reveal(canvasElement)).toHaveAttribute('data-pinned'));
  },
};

/** The effects panel open: docked at the left, 20px in, from 64px down to 100px over the foot, 340px wide. No corner toasts. */
export const EffectsOpen: Story = {
  args: { effects: true, pinned: true },
};

/** At 1000 × 700, pinned, the panel open. */
export const At1000: Story = {
  name: 'At 1000 × 700',
  args: { width: 1000, height: 700, pinned: true, effects: true },
};

/** Esc held to leave live: a ring filling over 3 s and "Keep holding Esc to leave live" over the picture's middle; let go early, it goes. */
export const EscHeld: Story = {
  args: { leaving: true },
  play: async ({ canvas, canvasElement }) => {
    // It shows after a beat, so a short press shows nothing.
    await waitFor(() => expect(canvas.getByText('Keep holding Esc to leave live')).toBeVisible());
    // Held from the keyboard (one user, so it knows the key is down): shows, and let go early, goes without leaving.
    const user = userEvent.setup();
    await user.keyboard('{Escape>}');
    await user.keyboard('{/Escape}');
    await waitFor(() => expect(canvas.queryByText('Keep holding Esc to leave live')).toBeNull());
    await user.keyboard('{Escape>}');
    await expect(await canvas.findByRole('status')).toBeInTheDocument();
    await user.keyboard('{/Escape}');
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull());
    await expect(canvasElement.querySelector('[data-left]')).toBeNull();
  },
};

/** The flashing warning owed: a dark window, the warning in the middle, the controls dimmed and inert. */
export const Warning: Story = {
  args: { warning: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alertdialog', { name: 'flashing lights' })).toBeVisible();
    await expect(canvas.queryByRole('img', { name: /preview of the playing preset/ })).toBeNull();
  },
};
