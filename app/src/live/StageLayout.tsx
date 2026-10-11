import { useEffect, useRef, type RefObject } from 'react';
import { Preview } from '../views.tsx';
import { isTyping } from '../shell.ts';
import { say } from '../words.ts';
import { crateModeFor, STAGE_CRATE_ID, type CrateMode, type StageLayoutProps } from './stage-model.ts';
import '../layout/layout.css';
import './stage.css';

/** What the crate is called to a screen reader. */
export const CRATE_LABEL = say('crate');

/** Where a press belongs to something laid over the crate (Settings, More effects, Help, popovers), not outside it. */
const OVER_CRATE = '[role="dialog"], .vf-sheet, .vf-pop-panel';

/** Typing in a field, where Escape is the field's (liveKeys' `isTyping`, and contenteditable). */
function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return isTyping(e) || (t instanceof Element && (t.closest('[contenteditable]:not([contenteditable="false"])') != null || (t instanceof HTMLElement && t.isContentEditable)));
}

/** What the dock's panel is called to a screen reader. */
export const DOCK_LABEL = 'Live controls';

/** The quiet way back with the panels hidden, shown when the pointer nears the bottom. */
export const PANELS_HINT = 'for controls';

/** The hint's name to a screen reader: it is a button that shows the panels. */
export const PANELS_HINT_LABEL = 'Show controls (\\)';

/** What can take focus inside a panel, in order. */
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The laid-over crate: focus goes into it when it appears (not when a docked
 * one turns into it, the window narrowing), and back to where it was when it
 * goes, if it was lost with it (HomeLayout's way).
 */
function useOverlayFocus(panel: RefObject<HTMLElement | null>, mode: CrateMode) {
  const was = useRef(mode);
  const opener = useRef<Element | null>(null);
  const overlay = mode === 'overlay';
  useEffect(() => {
    const el = panel.current;
    if (overlay && was.current === 'hidden' && el) {
      opener.current = document.activeElement;
      (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    }
    was.current = mode;
  }, [mode, overlay, panel]);
  useEffect(() => {
    if (!overlay) return;
    return () => {
      const back = opener.current;
      opener.current = null;
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost && back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [overlay]);
}

/**
 * Escape, or a press outside the laid-over crate and its toggle (a control
 * naming `STAGE_CRATE_ID` in `aria-controls`), calls `away`. Escape is taken
 * (`preventDefault`), so live mode's keys don't also leave live on it.
 */
function useDismiss(on: boolean, panel: RefObject<HTMLElement | null>, away: () => void) {
  const latest = useRef(away);
  latest.current = away;
  useEffect(() => {
    if (!on) return;
    const press = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panel.current?.contains(t)) return;
      const el = t instanceof Element ? t : t.parentElement;
      const names = el?.closest('[aria-controls]')?.getAttribute('aria-controls')?.split(/\s+/) ?? [];
      if (names.includes(STAGE_CRATE_ID)) return;
      if (el?.closest(OVER_CRATE)) return;
      latest.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typing(e)) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener('pointerdown', press);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', key);
    };
  }, [on, panel]);
}

/**
 * Live's Stage: the picture full-bleed across the main window, the panels laid
 * over it (see `StageLayoutProps`).
 *
 * The picture is the native preview's hole (`Preview`), the whole window
 * whatever else shows: a docked crate, the header and the dock float over it
 * and never move it. Nothing paints under the hole (the root and every wrapper
 * paint nothing); each panel over it paints opaque `--surface-corner`, as no
 * blur reaches the native view and anything translucent would show the picture
 * through unblurred (stage.css).
 *
 * The shell owns where each part goes and the crate's and the dock's inset
 * panels: the crate (`crate`) is the content of a `nav` (`STAGE_CRATE_ID`) down
 * the left, docked from `STAGE_DOCK_AT` (the header and the dock keep clear of
 * it) and laid over everything below it, where Escape or a press outside it
 * calls `onCrateAway`; the dock (`dock`) is the content of a panel along the
 * bottom; the header (`head`) is laid out as a row on the traffic lights'
 * line, its capsules painting themselves, the empty line between them a drag
 * region. Hidden panels (`panels.shown` false) leave only the picture and a
 * hint, shown as the pointer nears the bottom, that `\` brings them back.
 * With the warning owed the picture is dark (the preview isn't mounted), the
 * crate and the dock inert and dimmed, and `centre` (the warning) centred over
 * where the picture would be, even with the panels hidden.
 */
export function StageLayout({ width, panels, warning = false, inWindow, crate, head, dock, centre, children, onCrateAway, onPanels }: StageLayoutProps) {
  const shown = panels.shown;
  const mode: CrateMode = shown ? crateModeFor(width, panels.crate) : 'hidden';
  const panel = useRef<HTMLElement | null>(null);
  useOverlayFocus(panel, mode);
  useDismiss(mode === 'overlay' && !warning, panel, onCrateAway);
  const showCentre = centre != null && (shown || warning);
  return (
    <div className="app home lay stage" data-view="live" data-crate={mode} data-panels={shown ? 'shown' : 'hidden'} data-warning={warning ? '' : undefined} data-windowed={inWindow ? '' : undefined}>
      {warning ? <div className="stage-dark" aria-hidden="true" /> : <Preview className="stage-picture" />}

      {mode !== 'hidden' && (
        <div className="stage-crate-cell" data-mode={mode} inert={warning || undefined}>
          <nav className="lay-side stage-crate" id={STAGE_CRATE_ID} aria-label={CRATE_LABEL} ref={panel} tabIndex={-1}>
            <div className="lay-side-band" data-tauri-drag-region />
            <div className="lay-side-body">{crate}</div>
          </nav>
        </div>
      )}

      <div className="stage-head" data-tauri-drag-region>
        {shown && head}
      </div>

      {showCentre && (
        <div className="stage-centre" data-for={warning ? 'warning' : 'offer'}>
          {centre}
        </div>
      )}

      {shown ? (
        <section className="stage-dock" aria-label={DOCK_LABEL} inert={warning || undefined}>
          {dock}
        </section>
      ) : (
        <div className="stage-peek">
          <button type="button" className="stage-hint" aria-label={PANELS_HINT_LABEL} onClick={onPanels}>
            <kbd>\</kbd> {PANELS_HINT}
          </button>
        </div>
      )}

      {children}
    </div>
  );
}
