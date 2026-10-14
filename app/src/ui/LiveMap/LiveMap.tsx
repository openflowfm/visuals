import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { ColourPicker, Field } from '../Field/Field';
import { Icon } from '../Icon/Icon';
import * as api from '../model/api';
import type { LibraryRow } from '../model/api';
import { claimHolds, claimOf, claimSettled, type Claim } from '../model/claim';
import { AXES, type AxisId } from '../model/field';
import { characterOf, fieldSays } from '../model/inspector-model';
import type { LiveState } from '../model/live-model';
import { prepareRow } from '../model/librarySearch';
import { useMapAxes } from '../model/mapPrefs';
import { openFailed } from '../model/shell';
import { useDeckSet } from './deckSet';
import { liveMapScope, SCOPE_NAMES, SCOPES, setLiveMapScope, type Scope } from './scope';
import './LiveMap.css';

/** The panel's id: the header's map button names it in `aria-controls`. */
export const LIVE_MAP_ID = 'stage-map';

/** What the panel is called, to a screen reader. */
export const LIVE_MAP_LABEL = 'Library map';

/** The keys a control in the panel answers itself: kept from live's keys (←/→ would step the preset too, Enter and Space act). */
const OWN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ']);
function keepOwnKeys(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (OWN_KEYS.has(e.key) && t.closest?.('[role="listbox"], [role="combobox"], [role="radio"], [role="radiogroup"]')) e.stopPropagation();
}

/** An axis's name in a sentence: "speed". */
const axisWord = (id: AxisId): string => (AXES.find((a) => a.id === id)?.label ?? id).toLowerCase();

/** The library's rows, read once; null until read (an empty list when that failed). */
function useRows(): LibraryRow[] | null {
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  useEffect(() => {
    let on = true;
    api.libraryIndex().then(
      (r) => on && setRows(r),
      () => on && setRows([]),
    );
    return () => {
      on = false;
    };
  }, []);
  return rows;
}

/**
 * **Job.** Live's map panel (wireframe D): docked at the Stage's right under the header, in the
 * Effects panel's frame (a `raised` Surface, its light from the picture's right). Its head says
 * "Map", what it shows and how many ("this set · 36", "library · 250"), the colour picker and ✕
 * (or G); under it "This set" | "Library" (Show). Its body is the Field at the panel's width:
 * this set's presets (what the deck plays) or the whole library, by the map's axes (the pickers
 * on its edges, `useMapAxes`, shared with Home's map), the preset playing lit, the session's
 * trail dashed through the presets played. A dot picked (click, or Enter on the field's cursor)
 * plays at once, as Home's map does. Not a dialog: live's keys keep working while it is open
 * (only the field's, the pickers' and the switch's own keys stay theirs).
 *
 * **Changed.** New: the map comes to Live. Scope is remembered for the page's session, not
 * saved (`scope.ts`; `resetLiveMapScope` starts it over for stories). "This set" is read again
 * whenever its contents may have changed (`deckSetKey`: a playlist item replaced, a smart
 * playlist's or filter's matches after the library's data changes). A pick is claimed (`claimHolds`
 * in `model/claim.ts`): lit at once, and held until the picked preset plays (`live.current`, which
 * follows the deck when the app's word has no path) or `CLAIM_MS` pass; the deck moving to another
 * preset meanwhile (a Link beat) doesn't end it, until the open resolves: from then on the deck
 * moving off the preset that played when picked ends it (`claimSettled`). A failed open drops it. The preset already
 * playing does nothing when picked.
 *
 * **Kept.** The Field and its words (`fieldSays`), as Home's `LibraryMap` has them; the Effects
 * panel's material, padding, radius, type and ✕.
 *
 * **Tuning knobs** (LiveMap.css): `--vs-live-map-pad`, the panel's padding (20px, the Effects
 * panel's).
 */
export function LiveMap({ live, trail, onClose, focusOnOpen = false }: { live: LiveState; trail: readonly string[]; onClose(): void; focusOnOpen?: boolean }) {
  const [axes, setAxes] = useMapAxes();
  const [scope, setScopeState] = useState<Scope>(liveMapScope);
  const setScope = (next: Scope) => {
    setLiveMapScope(next);
    setScopeState(next);
  };
  const rows = useRows();
  const set = useDeckSet(live);
  const mine = live.data?.presets;

  // Opened by the map button: focus moves to the field (G leaves it where it was).
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusOnOpen) return;
    panel.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
    // On mount only: a later prop change never moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const library = scope === 'library' || set.whole || set.failed;
  const shown = useMemo(() => {
    const all = rows ?? [];
    if (library) return all;
    if (!set.paths) return [];
    const byPath = new Map(all.map((r) => [r.path, r]));
    const seen = new Set<string>();
    const out: LibraryRow[] = [];
    for (const p of set.paths) {
      const r = byPath.get(p);
      if (r && !seen.has(r.key)) {
        seen.add(r.key);
        out.push(r);
      }
    }
    return out;
  }, [rows, library, set.paths]);
  const loading = !rows || (!library && !set.paths);

  // A dot picked, lit until it plays or its time is up (`claimHolds`).
  const [claim, setClaim] = useState<Claim | null>(null);
  useEffect(() => {
    if (!claim) return;
    if (!claimHolds(claim, live.current)) return setClaim(null);
    const t = setTimeout(() => setClaim((c) => (c === claim ? null : c)), Math.max(0, claim.until - Date.now()));
    return () => clearTimeout(t);
  }, [claim, live.current]);

  const litPath = claim?.path ?? live.current;
  const litRow = useMemo(() => (litPath ? (rows ?? []).find((r) => r.path === litPath) : undefined), [rows, litPath]);
  const playing = claim ? (litRow?.key ?? null) : live.key;
  const c = useMemo(() => (litRow ? characterOf(prepareRow(litRow, mine?.[litRow.key])) : null), [litRow, mine]);
  const drawn = useMemo(() => shown.reduce((n, r) => (r.look ? n + 1 : n), 0), [shown]);

  const pick = (row: LibraryRow) => {
    if (row.key === playing) return;
    const mineClaim = claimOf(row.path);
    const from = live.current;
    setClaim(mineClaim);
    api.open(row.path).then(
      // Opened: the deck moving off what played when picked is news from here (`claimSettled`).
      () => setClaim((was) => (was === mineClaim ? claimSettled(was, from) : was)),
      (e) => {
        setClaim((was) => (was === mineClaim ? null : was));
        live.setError(openFailed(row.path, String(e)));
      },
    );
  };

  const what = library ? 'library' : 'this set';
  const caption = loading ? what : `${what} · ${shown.length.toLocaleString('en-US')}`;
  const name = `${library ? 'The library' : 'This set'} by ${axisWord(axes.across)} and ${axisWord(axes.up)}`;

  return (
    <Surface as="aside" layer="raised" ambient="right" className="vs-live-map" id={LIVE_MAP_ID} aria-label={LIVE_MAP_LABEL} onKeyDown={keepOwnKeys} ref={panel}>
      <Text as="div" className="vs-live-map-head">
        <Text as="h2" weight="strong" leading="tight" className="vs-live-map-title">
          Map
        </Text>
        <Text role="caption" tabular className="vs-live-map-caption">
          {caption}
        </Text>
        <span className="vs-live-map-fill" />
        <ColourPicker axes={axes} onAxes={setAxes} />
        <ButtonFace tone="quiet" className="vs-live-map-close" aria-label="Close the map" aria-keyshortcuts="G" title="Close the map (G)" onClick={onClose}>
          <Icon name="close" size={14} />
        </ButtonFace>
      </Text>
      <Segmented items={SCOPE_NAMES} index={SCOPES.indexOf(scope)} onChange={(i) => setScope(SCOPES[i] ?? 'set')} label="Show" className="vs-live-map-scope" />
      <Field
        library={shown}
        mine={mine}
        playing={playing}
        intensity={c?.intensity.at ?? null}
        hue={c?.hues[0]?.css ?? 'var(--text-1)'}
        description={fieldSays(c, drawn, shown.length)}
        onPick={pick}
        axes={axes}
        onAxes={setAxes}
        trail={trail}
        name={name}
      />
    </Surface>
  );
}
