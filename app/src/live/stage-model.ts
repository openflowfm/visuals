/**
 * Live's "Stage" layout (contract-owned, so the shell, the dock, the crate, the
 * header and Live's wiring share it): the picture full-bleed across the main
 * window and Home's opaque inset panels floating over it — the crate down the
 * left, the header's two capsules along the top, the dock along the bottom.
 * Here are which panels show at a window's width and the viewer's choices, the
 * keys that hide and show them, and the props each part is handed.
 */
import type { ReactNode } from 'react';
import type { View } from '../views.tsx';
import type { LiveState } from './live-model.ts';

/** The crate: beside the picture's left edge with the dock and header clear of it, laid over them (a narrow window), or put away. */
export type CrateMode = 'docked' | 'overlay' | 'hidden';

/** The narrowest window the crate docks in (and is shown by default); below it the crate is laid over the rest, and starts put away. */
export const STAGE_DOCK_AT = 1100;

/** The browser storage key for the crate shown (true) or put away (false) by the viewer, kept between runs. */
export const CRATE_KEY = 'visuals.live.crate';

/** The crate panel's id: its toggle names it in `aria-controls`, and a press on the toggle doesn't put a laid-over crate away. */
export const STAGE_CRATE_ID = 'stage-crate';

/** The crate's mode in a window `width` px wide, from the viewer's choice (`shown`; null: never chose, the width's default). */
export function crateModeFor(width: number, shown: boolean | null): CrateMode {
  const wide = width >= STAGE_DOCK_AT;
  if (shown === false) return 'hidden';
  if (shown === null) return wide ? 'docked' : 'hidden';
  return wide ? 'docked' : 'overlay';
}

/**
 * What the panels are doing: `shown` is false while `\` has hidden them all
 * (only the picture shows in the main window; the output window is always the
 * clean picture); `crate` is the viewer's choice for the crate, as `crateModeFor`
 * takes it.
 */
export interface Panels {
  shown: boolean;
  crate: boolean | null;
}

/** The panels on the way in: shown, the crate as the viewer left it. */
export const panelsAtStart = (crate: boolean | null): Panels => ({ shown: true, crate });

/** `\`: hide every panel, or show them again. */
export const togglePanels = (p: Panels): Panels => ({ ...p, shown: !p.shown });

/**
 * Esc in live mode: with the panels hidden it shows them (`show`); with them
 * shown it does nothing (`stay`). Esc never leaves live — leaving is ✕ or ⌘⇧L,
 * so a stray press mid-set can't close the output. A laid-over crate takes its
 * own Esc first (it puts itself away).
 */
export const escapeDoes = (p: Panels): 'show' | 'stay' => (p.shown ? 'stay' : 'show');

/** The crate's toggle: put it away when it shows at `width`, else show it. */
export function toggleCrate(p: Panels, width: number): Panels {
  return { ...p, crate: crateModeFor(width, p.crate) === 'hidden' };
}

/**
 * The shell (`StageLayout.tsx`, the shell lane): the picture full-bleed under
 * everything (the native preview, through `Preview`), and the parts laid over
 * it in their places. Hidden panels (`panels.shown` false) leave only the
 * picture; with the flashing warning owed (`warning`), the picture is dark and
 * the parts inert.
 */
export interface StageLayoutProps {
  /** The window's width, for the crate's mode. */
  width: number;
  panels: Panels;
  /** The flashing-lights warning is owed: nothing plays and the controls wait for "I understand". */
  warning?: boolean;
  /** Playing in the window (no output on a display). */
  inWindow: boolean;
  /** The crate panel (`StageCrate`), down the left. */
  crate: ReactNode;
  /** The header's two capsules (`StageHead`), on the traffic lights' line. */
  head: ReactNode;
  /** The dock (`StageDock`), along the bottom. */
  dock: ReactNode;
  /** Over the picture's middle: the "Go full screen on…" offer (playing in the window), or the warning. */
  centre?: ReactNode;
  /** Laid over everything: the ? overlay, notices. */
  children?: ReactNode;
  /** The laid-over crate was dismissed (Esc, or a press outside it). */
  onCrateAway(): void;
}

/**
 * The dock (`StageDock.tsx`, the dock lane): Home's transport bar (pause is
 * HOLD, ◀ ▶ step, random) and a row under it with the Next line, the effect
 * keys (strobe, blackout, freeze), Intensity and More effects…; the notice
 * shows over it.
 */
export interface StageDockProps {
  live: LiveState;
}

/** The crate (`StageCrate.tsx`, the crate lane): playlists, moods and up next, as Home's inset sidebar. */
export interface StageCrateProps {
  live: LiveState;
  mode: CrateMode;
  /** The laid-over crate was dismissed. */
  onAway(): void;
}

/**
 * The header (`StageHead.tsx`, the header lane): the leading capsule (the
 * crate's toggle, Home | Live as Home's header switches them) and the trailing
 * one (the Beat and Output lights as Home's popovers, ?, settings).
 */
export interface StageHeadProps {
  live: LiveState;
  /** The crate shows (its toggle's `aria-expanded`). */
  crateOpen: boolean;
  onCrate(): void;
  /** The ? overlay is open. */
  help: boolean;
  onHelp(): void;
  /** Home | Live: leaving for another view. */
  onView(next: View): void;
}

/** The "Go full screen on…" offer over the picture, playing in the window (the header lane's, in `StageHead.tsx`). */
export interface FullScreenOfferProps {
  live: LiveState;
}
