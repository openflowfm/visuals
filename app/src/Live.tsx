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
export { intensityOf, keyOf, openEffects, padLabel, playsWindowed, ratingOf, sendIntensity, starred, starsText, whenText, whereSr, whereText, type IntensityAction } from './live/live-model.ts';

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

const goNow = (go: () => void) => go();

/**
 * Live mode, as the Stage: the picture full-bleed across the main window, and
 * Home's opaque inset panels over it — the header's two capsules along the top
 * (`StageHead`), the crate down the left (`StageCrate`), the dock along the
 * bottom (`StageDock`), all laid out by `StageLayout` and fed from `useLive`.
 * Playing in the window, "Go full screen on…" sits over the picture's middle.
 *
 * The crate docks from `STAGE_DOCK_AT` px and is laid over the rest below it,
 * where it starts put away; the viewer's choice is kept (`CRATE_KEY`) where it
 * docks, as Home keeps its sidebar's. `\` hides every panel, leaving only the
 * picture, and shows them again. Esc shows hidden panels, or puts a laid-over
 * crate away, and never leaves live, here or on the output (which tells the
 * page, `output.onEscape`). ✕ and ⌘⇧L leave through `useLive`'s `leave`: with
 * the output on a display, only a second press within 4 s leaves. Leaving puts the
 * effects back (`useLive`'s unmount), so nothing is left inverted or frozen.
 * With the flashing warning owed, `App` doesn't mount live at all until it is
 * understood.
 */
export function Live({
  start,
  onMode,
  windowed = false,
}: {
  start: string | null;
  onMode: (mode: View, path: string | null) => void;
  /** Play in the window: don't open the output on the way in. */ windowed?: boolean;
}) {
  const live = useLive({ start, windowed });
  const { current } = live;
  const [help, setHelp] = useState(false);
  const width = useWidth();
  const [panels, setPanels] = useState<Panels>(() => panelsAtStart(width < STAGE_DOCK_AT ? null : rememberedChoice(CRATE_KEY)));
  const mode = crateModeFor(width, panels.crate);

  // Every way out goes through `live.leave`: with the output on a display, the first press only asks.
  const leave = live.leave ?? goNow;
  const leaveLive = useCallback(() => leave(() => onMode(HOME, current)), [leave, onMode, current]);
  const onView = useCallback((next: View) => next !== 'live' && leave(() => onMode(next, current)), [leave, onMode, current]);

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

  useLiveKeys({
    editor: leaveLive,
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
  // Esc on the output does what it does here, never leaving: it shows hidden panels.
  useTauriEvent(output.onEscape, () => setPanels((p) => (p.shown ? p : { ...p, shown: true })));

  const offer = live.inWindow && (live.displays?.length ?? 0) > 0;

  return (
    <div className="live" data-windowed={live.inWindow ? '' : undefined} data-panels={panels.shown ? undefined : 'hidden'} data-crate={mode}>
      <StageLayout
        width={width}
        panels={panels}
        inWindow={live.inWindow}
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
