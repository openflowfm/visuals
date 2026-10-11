import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Icon } from '../layout/icons.tsx';
import { ViewSwitch } from '../views.tsx';
import { crateModeFor, escapeDoes, panelsAtStart, STAGE_CRATE_ID, toggleCrate, togglePanels, type Panels } from './stage-model.ts';
import { StageLayout } from './StageLayout.tsx';

/** The window a story draws, and how it starts. */
interface Args {
  width: number;
  height: number;
  /** The crate shown (true), put away (false), or as the width has it (null). */
  crate: boolean | null;
  /** The panels hidden at start, as `\` hides them. */
  hidden: boolean;
  warning: boolean;
  inWindow: boolean;
}

/** The native preview's stand-in: where the engine's view shows through the hole, a still from the starter set (preview.tsx sets --sb-still). */
const STAND_IN = `html[data-sb-desk] .app.home.lay.stage > .stage-picture[data-hole]:not([data-loading]) { background: var(--sb-still) center / cover no-repeat #000; }
.sb-stage-capsule { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 8px; border-radius: 12px; background: var(--surface-corner); box-shadow: var(--glass-edge), 0 18px 48px rgba(0, 0, 0, 0.45); color: var(--ui); font-size: 12px; }
.sb-stage-fill { flex: 1; align-self: stretch; }
.sb-stage-dock { display: grid; gap: 6px; padding: 14px var(--lay-pad); color: var(--ui); font-size: 13px; }
.sb-stage-dock b { color: var(--fg); font-weight: 600; }
.sb-stage-crate { display: grid; gap: 2px; padding: 8px; color: var(--ui); font-size: 13px; }
.sb-stage-crate h2 { margin: 6px 10px; color: var(--caption); font-size: 11px; font-weight: 600; }
.sb-stage-crate button { height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; text-align: left; }
.sb-stage-offer, .sb-stage-warning { padding: 14px 18px; border-radius: 18px; background: var(--surface-corner); box-shadow: var(--glass-edge), 0 18px 48px rgba(0, 0, 0, 0.45); color: var(--ui); font-size: 13px; }
.sb-stage-warning { max-width: 420px; }`;

/**
 * The Stage on stand-in parts (the header's capsules, the dock and the crate
 * are their lanes'), working as Live wires it: the crate's toggle, `\` to hide
 * and show the panels, Esc showing hidden panels, Esc or a press outside
 * putting a laid-over crate away.
 */
function Composed({ width, height, crate, hidden, warning, inWindow }: Args) {
  const [panels, setPanels] = useState<Panels>(hidden ? togglePanels(panelsAtStart(crate)) : panelsAtStart(crate));
  const open = crateModeFor(width, panels.crate) !== 'hidden';
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === '\\') setPanels(togglePanels);
      if (e.key === 'Escape') setPanels((p) => (escapeDoes(p) === 'show' ? togglePanels(p) : p));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      <style>{STAND_IN}</style>
      <StageLayout
        width={width}
        panels={panels}
        warning={warning}
        inWindow={inWindow}
        onCrateAway={() => setPanels((p) => ({ ...p, crate: false }))}
        crate={
          <div className="sb-stage-crate">
            <h2>Playlists</h2>
            <button type="button">Warm-up</button>
            <button type="button">Peak time</button>
            <h2>Moods</h2>
            <button type="button">Hypnotic</button>
          </div>
        }
        head={
          <>
            <div className="sb-stage-capsule">
              <button type="button" className="home-tool" aria-label="crate" aria-controls={STAGE_CRATE_ID} aria-expanded={open} onClick={() => setPanels((p) => toggleCrate(p, width))}>
                <Icon name="sidebar" />
              </button>
              <ViewSwitch view="live" onChange={() => {}} />
            </div>
            <span className="sb-stage-fill" data-tauri-drag-region />
            <div className="sb-stage-capsule">Beat · Output · ? · ⚙</div>
          </>
        }
        dock={
          <div className="sb-stage-dock">
            <span>
              <b>Flexi - mindblob</b> from Warm-up · 3 of 10
            </span>
            <span>Next: Geiss - Cosmic Dust · Strobe · Blackout · Freeze · Intensity</span>
          </div>
        }
        centre={
          warning ? (
            <div className="sb-stage-warning" role="alertdialog" aria-label="flashing lights">
              Live mode can show flashing lights. I understand.
            </div>
          ) : inWindow ? (
            <div className="sb-stage-offer">
              <button type="button">Go full screen on Projector</button>
            </div>
          ) : undefined
        }
      >
        <span className="lay-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </StageLayout>
    </div>
  );
}

const meta = {
  title: 'Live/Stage/Layout',
  component: Composed,
  args: { width: 1440, height: 900, crate: null, hidden: false, warning: false, inWindow: false },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Composed>;
export default meta;
type Story = StoryObj<typeof meta>;

const picture = (canvas: { getByRole: (role: string, o: { name: RegExp }) => HTMLElement }) => canvas.getByRole('img', { name: /preview of the playing preset/ });

/** 1440 × 900: the crate docked over the picture's left edge, the header and the dock beside it, the picture the whole window. */
export const Wide: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'crate' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Live controls' })).toBeVisible();
    const hole = picture(canvas).getBoundingClientRect();
    await expect([hole.left, hole.top, hole.width, hole.height]).toEqual([0, 0, 1440, 900]);
  },
};

/** 800 wide: the crate starts put away; its toggle lays it over, Escape puts it away. */
export const Narrow: Story = {
  args: { width: 800 },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('navigation', { name: 'crate' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'crate' }));
    await expect(canvas.getByRole('navigation', { name: 'crate' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('navigation', { name: 'crate' })).toBeNull());
  },
};

/** The crate laid over the picture in a narrow window. */
export const CrateOver: Story = {
  args: { width: 800, crate: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'crate' })).toBeVisible();
    const hole = picture(canvas).getBoundingClientRect();
    await expect([hole.left, hole.width]).toEqual([0, 800]);
  },
};

/** `\` hid the panels: only the picture, and at the bottom (the pointer near it) the hint; `\` brings them back. */
export const PanelsHidden: Story = {
  args: { hidden: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('region', { name: 'Live controls' })).toBeNull();
    await expect(canvas.getByText('for controls', { exact: false })).toBeInTheDocument();
    await userEvent.keyboard('\\');
    await expect(await canvas.findByRole('region', { name: 'Live controls' })).toBeVisible();
  },
};

/** Playing in the window: the "Go full screen on…" offer over the picture, under the header. */
export const Windowed: Story = {
  args: { inWindow: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Go full screen on Projector' })).toBeVisible();
  },
};

/** The flashing warning owed: a dark window, the warning where the picture would be, the controls dimmed and inert. */
export const Warning: Story = {
  args: { warning: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alertdialog', { name: 'flashing lights' })).toBeVisible();
    await expect(canvas.queryByRole('img', { name: /preview of the playing preset/ })).toBeNull();
  },
};
