/**
 * Live mode's state and the plain reckonings its parts share (contract-owned,
 * so the Stage's shell, dock, crate, header and Live's wiring read the same
 * shape): `LiveState` is what `useLive` reads from the app and every part is
 * handed; the functions say what the parts show. Live.tsx re-exports the ones
 * it had, so nothing that imported them moves.
 */
import { invoke } from '@tauri-apps/api/core';
import type * as api from '../api.ts';
import { isMood } from '../Crate.tsx';
import type * as fx from '../fx.ts';
import { control, type ControlId } from '../HelpOverlay.tsx';
import * as link from '../link.ts';
import type { Stars } from '../liveKeys.ts';
import type * as output from '../output.ts';
import type * as pl from '../playlists.ts';
import type { Notice } from '../shell.ts';
import { openSheet } from '../views.tsx';
import { say } from '../words.ts';

/** Everything live mode shows and does, as `useLive` reads it: the parts take this and nothing else of the app. */
export interface LiveState {
  lists: pl.Lists | null;
  setLists(l: pl.Lists): void;
  /** The deck (`lists.deck`), or null before the playlists are read. */
  deck: pl.Deck | null;
  /** The preset playing's path. */
  current: string | null;
  /** HOLD is on: the preset stays. */
  held: boolean;
  effects: fx.Fx | null;
  /** Where the output is. */
  status: output.Status;
  /** The displays, or null until they are read (or when that failed). */
  displays: output.Display[] | null;
  /** Playing in the window: no output open on a display (and the displays are known). */
  inWindow: boolean;
  /** The user's library data: moods, stars, ratings. */
  data: api.LibraryData | null;
  /** The playing preset's library key, or null when the library doesn't list it. */
  key: string | null;
  star: boolean;
  /** 1–5, or null when unrated. */
  rating: number | null;
  /** What the Next line says. */
  says: pl.NextSays;
  /** Where the next preset comes from (a playlist), or null. */
  up: pl.Up | null;
  /** The notice showing (a failure), or null. */
  error: Notice | null;
  /** A quiet line over the dock that is a state, not a failure: Hold keeping the preset (until it's let go), or leaving waiting for its second press. */
  hint?: string | null;
  /**
   * Leave live through this: with the output on a display, the first call only
   * asks (the hint) and a second within `LEAVE_MS` calls `go`; otherwise `go`
   * at once. Esc never leaves (liveKeys), so this is ✕'s and ⌘⇧L's way out.
   */
  leave?(go: () => void): void;
  setError(n: Notice | null): void;
  /** A handler that shows `message` with the error it is given. */
  fail(message: string): (e: unknown) => void;
  dismiss(): void;
  /** A step or a play: previous, next, random, a playlist… (its failure becomes the notice). */
  act(action: pl.Action): void;
  /** An effect (its failure becomes the notice). */
  actFx(action: fx.FxAction): void;
  /** Open the output on display `id`, or where it was last (null). */
  show(id: number | null): void;
  /** The Intensity slider's position, 0–1. */
  intensity: number;
  setIntensity(v: number): void;
  /** Star the preset playing, or take its star off. */
  favourite(): void;
  /** Rate the preset playing; the same number again takes the rating off. */
  rate(stars: Stars): void;
}

/** How long leaving live waits for its second press while the output shows on a display. */
export const LEAVE_MS = 4000;

/** What the dock says after the first press to leave with the output showing. */
export const LEAVE_HINT = 'The output is showing: press ⌘⇧L (or ✕) again to leave live and close it.';

/**
 * The Intensity slider's position, 0–1, read back from the sensitivity it set:
 * `fx::intensity` runs sensitivity from ½× to 2× on a log taper, ½ in the middle
 * at 1×, so the slider follows a sensitivity changed anywhere else too.
 */
export function intensityOf(sensitivity: number): number {
  if (!(sensitivity > 0)) return 0.5;
  return Math.max(0, Math.min(1, Math.log2(sensitivity * 2) / 2));
}

/** `fx::FxAction::Intensity`: sensitivity, brightness and strobe level together, on the app's capped curve. */
export interface IntensityAction {
  kind: 'intensity';
  value: number;
}
/** Send the Intensity slider's position through `act`, as a controller would. */
export const sendIntensity = (value: number) => invoke<void>('act', { action: { kind: 'intensity', value: Math.max(0, Math.min(1, value)) } satisfies IntensityAction });

/** A preset's library key (what `librarySet` takes) from its path, or null when the library doesn't list it. */
export function keyOf(rows: readonly api.LibraryRow[], path: string | null): string | null {
  if (!path) return null;
  return rows.find((r) => r.path === path)?.key ?? null;
}

/** Whether the preset at `key` is starred in the user's data. */
export const starred = (data: api.LibraryData | null, key: string | null): boolean => (key ? data?.presets[key]?.star === true : false);

/** The preset at `key`'s rating, 1–5, or null when unrated. */
export const ratingOf = (data: api.LibraryData | null, key: string | null): number | null => (key ? (data?.presets[key]?.rating ?? null) : null);

/** A rating as stars: "★★★☆☆". */
export const starsText = (rating: number): string => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

/**
 * Whether live mode plays in the window rather than opening the output: asked to
 * (first run), or only one display is connected, so a full-screen output would
 * cover the controls. Unknown displays (the call failed) keep the old behaviour.
 */
export const playsWindowed = (windowed: boolean, displays: readonly output.Display[] | null): boolean => windowed || (displays !== null && displays.length <= 1);

/** The "next" line's when, from Link's next change: "in 3 beats"; null when changes aren't on the beat. */
export function whenText(beats: number | null): string | null {
  if (beats === null || !Number.isFinite(beats)) return null;
  const n = Math.max(1, Math.ceil(beats - 1e-6));
  return `in ${n} beat${n === 1 ? '' : 's'}`;
}

/** When the next preset comes: on Link's beat ("in 3 beats") when changes are on it, else "every 20 s" while the deck moves on by itself, else null. */
export function nextWhenText(frame: link.Frame | null, deck: pl.Deck | null, now: number): string | null {
  const beats = frame ? whenText(link.beatsToNext(frame, now)) : null;
  if (beats) return beats;
  if (deck?.auto) return `every ${Math.round(deck.seconds)} s`;
  return null;
}

/** What the Next line names: the item stepping on opens (and whether it's missing from the library), or, quietly, why nothing is next. */
export function nextName(says: pl.NextSays): { text: string; quiet: boolean; missing?: boolean } {
  if (says.kind === 'held') return { text: 'held — it stays until you let go of Hold (H)', quiet: true };
  if (says.kind === 'item' || says.kind === 'filter') return { text: says.item.name, quiet: false, missing: says.item.missing };
  if (says.kind === 'empty') return { text: `${says.up.playlist.name} is empty — add presets in the library`, quiet: true };
  return { text: 'any preset in the library', quiet: true };
}

/**
 * Whether the Next line should say where the next preset comes from (to screen
 * readers, after its name): only when it adds something — a playlist with
 * presets in it, a mood or a filter — not when the name already said it (the
 * whole library, an empty playlist).
 */
export const saysWhere = (says: pl.NextSays, up: pl.Up | null, deck: pl.Deck | null): boolean =>
  says.kind !== 'held' && says.kind !== 'empty' && says.kind !== 'library' && (up !== null || !!deck?.query);

/** Where the next preset comes from, for the Next line's tooltip: "From Chill, 1 of 20", the mood, or the whole library. */
export function whereText(up: pl.Up | null, deck: pl.Deck | null): string {
  if (up) return `From ${up.playlist.name}${up.index !== null ? `, ${up.index + 1} of ${up.count}` : ''}`;
  if (deck?.query) return isMood(deck.query) ? `From the mood ${(deck.query.groups.tags ?? []).join(' + ')}` : `From ${say('library query')}`;
  return 'From the whole library: play a playlist or a mood to set the order';
}

/** The same, read after the Next line's name for screen readers, which don't get its tooltip: ", from Chill, 1 of 20". */
export const whereSr = (up: pl.Up | null, deck: pl.Deck | null): string => `, from${whereText(up, deck).slice('From'.length)}`;

/** "More effects…": the More effects sheet, over live mode (it takes Esc while open). */
export const openEffects = () => openSheet('effects');

/** A pad's accessible name: the control's name from the help list, or `name` instead, then its keys: "Previous (← ↑)". */
export function padLabel(id: ControlId, name?: string): string {
  const c = control(id);
  return `${name ?? c.name}${c.keys ? ` (${c.keys})` : ''}`;
}
