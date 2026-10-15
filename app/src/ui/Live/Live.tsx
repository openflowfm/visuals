import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpOverlay } from '../HelpOverlay/HelpOverlay';
import * as api from '../model/api';
import { useTauriEvent } from '../model/hooks';
import { useLiveKeys } from '../model/liveKeys';
import * as output from '../model/output';
import { useLive } from '../model/useLive';
import { EFFECTS_PANEL_ID, EffectsPanel } from '../EffectsPanel/EffectsPanel';
import { LIVE_MAP_ID, LiveMap } from '../LiveMap/LiveMap';
import { useSessionTrail } from '../model/trail';
import { StageDock } from '../StageDock/StageDock';
import { StageHead } from '../StageHead/StageHead';
import { StageLayout } from '../StageLayout/StageLayout';
import { HOME, type View } from '../Views/Views';
import './Live.css';

// Live mode's reckonings moved to model/live-model.ts (the Stage contract); they are still here for what imported them from Live.
export { intensityOf, keyOf, openEffects, opensOnStart, padLabel, ratingOf, sendIntensity, starred, starsText, whenText, whereSr, whereText, type IntensityAction } from '../model/live-model';

/** The playing preset's thumbnail, from the library's index by its key: the light the Stage's surfaces take (Home's `ambient`). */
function useThumbnail(key: string | null): string | null {
  const [rows, setRows] = useState<api.LibraryRow[] | null>(null);
  useEffect(() => {
    let gone = false;
    api.libraryIndex().then(
      (r) => !gone && setRows(r),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, []);
  if (!key || !rows) return null;
  return rows.find((r) => r.key === key)?.thumbnail ?? null;
}

/**
 * **Job.** Live mode, as the Stage: the picture full-bleed across the main window, and over it,
 * on hover, the header (`StageHead`: Home | Live, the notes, the Beat and Output lights, the
 * mixer, the camera, ?, settings and ✕) and the controls (`StageDock`: the preset at the top left,
 * and at the foot Effects, ◀ ring ▶ centred, the dice and star), laid out and faded by
 * `StageLayout` and fed from `useLive`. Effects (or E) opens the effects panel (`EffectsPanel`)
 * docked at the left; ✕ on it, E or a short Esc puts it away. The header's map button (or G) opens
 * the library map (`LiveMap`) at the right: the presets as dots by the axes picked, a click playing
 * one, the dashed trail what played this session (`useSessionTrail`, kept while it is closed); ✕
 * on it, G, the button or a short Esc puts it away. The button moves focus into a panel, its key
 * leaves it on the picture, and closing gives focus back to the button if it was inside. The two
 * open together freely, one at either side; a short Esc puts away both. Going live plays in this window;
 * "Full screen on…" is in the Output light's popover until the user puts the picture on a display.
 * The Stage takes the playing preset's light (its thumbnail), as Home does.
 *
 * `\` pins the controls shown (hovered or not) and lets them go again. Esc held for 3 s
 * (`LEAVE_HOLD_MS`) leaves live, here or on the output (which tells the page of Esc down and up,
 * `output.onEscape`), the Stage showing the hold's progress in this window and never on the
 * output; both pictures fade toward black over the hold (`output.leaving` for the output), and
 * back quickly when Esc is let go early. ✕ and ⌘⇧L leave at once, as they are deliberate. Leaving puts the effects back
 * (`useLive`'s unmount), so nothing is left inverted or frozen. With the flashing warning owed,
 * `App` doesn't mount live at all until it is understood.
 *
 * **Changed.** No crate (no sidebar in Live: the owner's call), no dock bar and no capsules: the
 * Stage is Home's language, type and glyphs fading in over the picture. `\` pins rather than
 * hides, and the header says "Pinned" while it does; a short Esc only puts the open panels away
 * (with none open it does nothing). Design C: no corner toasts (the notices are quiet words in the
 * header); the bottom More effects drawer and the effects' row gave way to the effects panel.
 * Wireframe D: the library map at the right, on G and the header's map button.
 *
 * **Kept.** The props, the re-exports, the keys, the root's `data-windowed`; the root's class is
 * `vs-live`, and it says `data-pinned` while `\` holds the controls shown.
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
  const [pinned, setPinned] = useState(false);
  // The effects panel (the Effects button, or E), docked at the Stage's left.
  const [effects, setEffects] = useState(false);
  // Opened by the button, focus moves into the panel; by E, it stays on the picture.
  const [effectsFocus, setEffectsFocus] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Closing (✕, Esc, E or the button) gives focus back to the Effects button if it was in the panel.
  const closeEffects = useCallback(() => {
    const root = rootRef.current;
    const inside = root?.querySelector(`#${EFFECTS_PANEL_ID}`)?.contains(document.activeElement) ?? false;
    if (inside) root?.querySelector<HTMLElement>('.vs-stagedock-effects')?.focus();
    setEffects(false);
  }, []);
  const toggleEffects = useCallback(() => {
    if (effects) return closeEffects();
    setEffectsFocus(false);
    setEffects(true);
  }, [effects, closeEffects]);
  const pressEffects = useCallback(() => {
    if (effects) return closeEffects();
    setEffectsFocus(true);
    setEffects(true);
  }, [effects, closeEffects]);
  // The library map (the header's map button, or G), at the Stage's right; it opens beside the effects panel freely.
  const [map, setMap] = useState(false);
  // Opened by the button, focus moves into the map; by G, it stays on the picture.
  const [mapFocus, setMapFocus] = useState(false);
  // Closing (✕ in it, G, the button or a short Esc) gives focus back to the map button if it was in the map.
  const closeMap = useCallback(() => {
    const root = rootRef.current;
    const inside = root?.querySelector(`#${LIVE_MAP_ID}`)?.contains(document.activeElement) ?? false;
    if (inside) root?.querySelector<HTMLElement>('.vs-stagehead-map')?.focus();
    setMap(false);
  }, []);
  const toggleMap = useCallback(() => {
    if (map) return closeMap();
    setMapFocus(false);
    setMap(true);
  }, [map, closeMap]);
  const pressMap = useCallback(() => {
    if (map) return closeMap();
    setMapFocus(true);
    setMap(true);
  }, [map, closeMap]);
  // What played this session, for the map's dashed trail: kept while the map is closed too.
  const trail = useSessionTrail(live.current);
  const thumbnail = useThumbnail(live.key);

  // ✕ and ⌘⇧L leave at once; Esc leaves only held for LEAVE_HOLD_MS (liveKeys), with its progress shown while held.
  const [leaving, setLeaving] = useState(false);
  const leaveLive = useCallback(() => onMode(HOME, current), [onMode, current]);
  const onView = useCallback((next: View) => next !== 'live' && onMode(next, current), [onMode, current]);

  // The hold shown here (the hint and the window's fade) and told to the app, whose output fades the same way. Over by
  // leaving, the output is left dark: it closes on the way out, which puts its fade back.
  const holding = useCallback((on: boolean, left?: boolean) => {
    setLeaving(on);
    if (on || !left) output.leaving(on).catch(() => {});
  }, []);

  const escapes = useLiveKeys({
    editor: leaveLive,
    holding,
    act: live.act,
    fx: live.actFx,
    rate: live.rate,
    favourite: live.favourite,
    help: () => setHelp((h) => !h),
    panels: () => setPinned((p) => !p),
    effects: toggleEffects,
    map: toggleMap,
    // A short Esc puts away whatever panels are open, both if both (held on, it still leaves).
    escape: () => {
      if (!effects && !map) return false;
      if (effects) closeEffects();
      if (map) closeMap();
      return true;
    },
  });
  // Esc on the output does what it does here: held, it leaves (shown here, never on the output).
  useTauriEvent(output.onEscape, (says) => (says === 'up' ? escapes.escapeUp() : escapes.escapeDown()));

  return (
    <div ref={rootRef} className="vs-live" data-windowed={live.inWindow ? '' : undefined} data-pinned={pinned ? '' : undefined}>
      <StageLayout
        pinned={pinned}
        inWindow={live.inWindow}
        leaving={leaving}
        ambient={thumbnail}
        head={<StageHead live={live} help={help} onHelp={() => setHelp(true)} onView={onView} onLeave={leaveLive} pinned={pinned} mapOpen={map} onMap={pressMap} />}
        dock={<StageDock live={live} effectsOpen={effects} onEffects={pressEffects} />}
        panel={effects ? <EffectsPanel live={live} onClose={closeEffects} focusOnOpen={effectsFocus} /> : null}
        side={map ? <LiveMap live={live} trail={trail} onClose={closeMap} focusOnOpen={mapFocus} /> : null}
      >
        {/* Laid over everything: the ? overlay. */}
        <HelpOverlay open={help} onClose={() => setHelp(false)} stage />
      </StageLayout>
    </div>
  );
}
