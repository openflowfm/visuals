import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { ColourPicker, Field } from '../Field/Field';
import { Icon } from '../Icon/Icon';
import * as api from '../model/api';
import type { LibraryRow } from '../model/api';
import { CLAIM_MS } from '../model/claim';
import { AXES, type AxisId } from '../model/field';
import { characterOf, fieldSays } from '../model/inspector-model';
import type { LiveState } from '../model/live-model';
import { prepareRow } from '../model/librarySearch';
import { useMapAxes } from '../model/mapPrefs';
import * as pl from '../model/playlists';
import { openFailed } from '../model/shell';
import './LiveMap.css';

/** The panel's id: the header's map button names it in `aria-controls`. */
export const LIVE_MAP_ID = 'stage-map';

/** What the panel is called, to a screen reader. */
export const LIVE_MAP_LABEL = 'Library map';

/** What the map shows: the presets of what the deck plays, or the whole library. */
type Scope = 'set' | 'library';
const SCOPES: readonly Scope[] = ['set', 'library'];
const SCOPE_NAMES = ['This set', 'Library'] as const;

/** The scope picked last, for the page's session: the panel opens on it again (not persisted). */
let sessionScope: Scope = 'set';

/** The keys a control in the panel answers itself: kept from live's keys (←/→ would step the preset too, Enter and Space act). */
const OWN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ']);
function keepOwnKeys(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (OWN_KEYS.has(e.key) && t.closest?.('[role="listbox"], [role="combobox"], [role="radio"], [role="radiogroup"]')) e.stopPropagation();
}

/** An axis's name in a sentence: "speed". */
const axisWord = (id: AxisId): string => (AXES.find((a) => a.id === id)?.label ?? id).toLowerCase();

/** A dot picked, lit before the app says it plays. */
interface Claim {
  path: string;
  /** What played when it was picked. */
  from: string | null;
  /** Until when it holds while the open is on its way (ms). */
  until: number;
  /** The open came back: it plays. */
  resolved: boolean;
}

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
 * The paths of what the deck plays (`deck_items`), read again when its playlist, filter, order or
 * count changes. `whole` when the deck plays the whole library (no playlist, no filter); `paths`
 * is null while reading, or when that failed (`failed`).
 */
function useDeckSet(live: LiveState): { whole: boolean; paths: string[] | null; failed: boolean } {
  const deck = live.deck;
  const whole = !deck || (!deck.playlist && !deck.query);
  const items = deck?.playlist ? live.lists?.playlists.find((p) => p.id === deck.playlist)?.items.length : undefined;
  const key = whole || !deck ? null : `${deck.playlist}:${JSON.stringify(deck.query)}:${deck.order}:${deck.count}:${items ?? ''}`;
  const [read, setRead] = useState<{ key: string; paths: string[] | null } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let on = true;
    pl.deckItems().then(
      (paths) => on && setRead({ key, paths }),
      () => on && setRead({ key, paths: null }),
    );
    return () => {
      on = false;
    };
  }, [key]);
  if (key === null) return { whole: true, paths: null, failed: false };
  const done = read?.key === key;
  return { whole: false, paths: done ? read.paths : null, failed: done && read.paths === null };
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
 * saved. A pick is claimed as Home's is: lit at once, until the app says that preset plays, or
 * `CLAIM_MS` pass while its open is on the way; once the open comes back it holds until something
 * else plays (the app says nothing more of an open: `deck.opened` sends the deck, not the path).
 * The preset already playing does nothing when picked.
 *
 * **Kept.** The Field and its words (`fieldSays`), as Home's `LibraryMap` has them; the Effects
 * panel's material, padding, radius, type and ✕.
 *
 * **Tuning knobs** (LiveMap.css): `--vs-live-map-pad`, the panel's padding (20px, the Effects
 * panel's).
 */
export function LiveMap({ live, trail, onClose, focusOnOpen = false }: { live: LiveState; trail: readonly string[]; onClose(): void; focusOnOpen?: boolean }) {
  const [axes, setAxes] = useMapAxes();
  const [scope, setScopeState] = useState<Scope>(sessionScope);
  const setScope = (next: Scope) => {
    sessionScope = next;
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

  // A dot picked, lit before the app says it plays (Home's claim).
  const [claim, setClaim] = useState<Claim | null>(null);
  useEffect(() => {
    if (!claim) return;
    if (live.current === claim.path || (claim.resolved && live.current !== claim.from)) return setClaim(null);
    if (claim.resolved) return;
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
    const mineClaim: Claim = { path: row.path, from: live.current, until: Date.now() + CLAIM_MS, resolved: false };
    setClaim(mineClaim);
    api.open(row.path).then(
      () => setClaim((was) => (was === mineClaim ? { ...was, resolved: true } : was)),
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
