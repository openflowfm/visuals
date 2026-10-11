import { useCallback, useEffect, useState } from 'react';
import { HelpOverlay } from './HelpOverlay.tsx';
import { remember, rememberedChoice } from './home.ts';
import { useLiveKeys } from './liveKeys.ts';
import * as output from './output.ts';
import { useTauriEvent } from './hooks.ts';
import { HOME, type View } from './views.tsx';
import { StageCrate } from './live/StageCrate.tsx';
import { StageDock } from './live/StageDock.tsx';
import { FullScreenOffer, StageHead } from './live/StageHead.tsx';
import { StageLayout } from './live/StageLayout.tsx';
import { CRATE_KEY, crateModeFor, escapeDoes, panelsAtStart, STAGE_DOCK_AT, toggleCrate, togglePanels, type Panels } from './live/stage-model.ts';
import { useLive } from './live/useLive.ts';
import './live.css';

// Live mode's reckonings moved to live/live-model.ts (the Stage contract); they are still here for what imported them from Live.
export { intensityOf, keyOf, openEffects, opensOnStart, padLabel, ratingOf, sendIntensity, starred, starsText, whenText, whereSr, whereText, type IntensityAction } from './live/live-model.ts';

/** The window's width, followed as it is resized. */
function useWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return width;
}

/**
 * Live mode, as the Stage: the picture full-bleed across the main window, and
 * Home's opaque inset panels over it — the header's two capsules along the top
 * (`StageHead`), the crate down the left (`StageCrate`), the dock along the
 * bottom (`StageDock`), all laid out by `StageLayout` and fed from `useLive`.
 * Going live plays in this window; "Go full screen on…" sits over the picture's
 * middle until the user puts the picture on a display (it, or the Output popover).
 *
 * The crate docks from `STAGE_DOCK_AT` px and is laid over the rest below it,
 * where it starts put away; the viewer's choice is kept (`CRATE_KEY`) where it
 * docks, as Home keeps its sidebar's. `\` hides every panel, leaving only the
 * picture, and shows them again. Esc pressed shows hidden panels, or puts a
 * laid-over crate away; held for 3 s (`LEAVE_HOLD_MS`) it leaves live, here or
 * on the output (which tells the page of Esc down and up, `output.onEscape`),
 * the Stage showing the hold's progress in this window and never on the output.
 * ✕ and ⌘⇧L leave at once, as they are deliberate. Leaving puts the
 * effects back (`useLive`'s unmount), so nothing is left inverted or frozen.
 * With the flashing warning owed, `App` doesn't mount live at all until it is
 * understood.
 */
export function Live({
  start,
  onMode,
  windowed,
}: {
  start: string | null;
  onMode: (mode: View, path: string | null) => void;
  /**
   * Live always plays in the window on the way in (true or unset, as from
   * Home or `live-windowed`); false only when the app was started in live
   * mode (`VISUALS_LIVE=1`, `VISUALS_VIEW=live`), which opens the output.
   */
  windowed?: boolean;
}) {
  const live = useLive({ start, windowed });
  const { current } = live;
  const [help, setHelp] = useState(false);
  const width = useWidth();
  const [panels, setPanels] = useState<Panels>(() => panelsAtStart(width < STAGE_DOCK_AT ? null : rememberedChoice(CRATE_KEY)));
  const mode = crateModeFor(width, panels.crate);

  // ✕ and ⌘⇧L leave at once; Esc leaves only held for LEAVE_HOLD_MS (liveKeys), with its progress shown while held.
  const [leaving, setLeaving] = useState(false);
  const leaveLive = useCallback(() => onMode(HOME, current), [onMode, current]);
  const onView = useCallback((next: View) => next !== 'live' && onMode(next, current), [onMode, current]);

  /** Show or put away the crate; kept for next time only where it docks (laid over the picture, it starts put away again). */
  const chooseCrate = useCallback(
    (next: Panels) => {
      if (width >= STAGE_DOCK_AT && next.crate !== null) remember(CRATE_KEY, next.crate);
      setPanels(next);
    },
    [width],
  );
  const onCrate = () => chooseCrate(toggleCrate(panels, width));
  const crateAway = () => chooseCrate({ ...panels, crate: false });

  const escapes = useLiveKeys({
    editor: leaveLive,
    holding: setLeaving,
    act: live.act,
    fx: live.actFx,
    rate: live.rate,
    favourite: live.favourite,
    help: () => setHelp((h) => !h),
    panels: () => setPanels(togglePanels),
    escape: () => {
      if (escapeDoes(panels) === 'show') {
        setPanels((p) => ({ ...p, shown: true }));
        return true;
      }
      // A crate laid over the picture takes Esc before live does.
      if (mode === 'overlay') {
        crateAway();
        return true;
      }
      return false;
    },
  });
  // Esc on the output does what it does here: pressed, it shows hidden panels; held, it leaves (shown here, never on the output).
  useTauriEvent(output.onEscape, (says) => {
    if (says === 'up') return escapes.escapeUp();
    setPanels((p) => (p.shown ? p : { ...p, shown: true }));
    escapes.escapeDown();
  });

  const offer = live.inWindow && (live.displays?.length ?? 0) > 0;

  return (
    <div className="live" data-windowed={live.inWindow ? '' : undefined} data-panels={panels.shown ? undefined : 'hidden'} data-crate={mode}>
      <StageLayout
        width={width}
        panels={panels}
        inWindow={live.inWindow}
        leaving={leaving}
        head={<StageHead live={live} crateOpen={mode !== 'hidden'} onCrate={onCrate} help={help} onHelp={() => setHelp(true)} onView={onView} />}
        crate={<StageCrate live={live} mode={mode} onAway={crateAway} />}
        dock={<StageDock live={live} />}
        centre={offer ? <FullScreenOffer live={live} /> : undefined}
        onCrateAway={crateAway}
        onPanels={() => setPanels((p) => ({ ...p, shown: true }))}
      >
        {/* Laid over everything: the ? overlay (the dock shows the silence banner and the notice). */}
        <HelpOverlay open={help} onClose={() => setHelp(false)} stage />
      </StageLayout>
    </div>
  );
}
