import type { LibraryQuery } from './api.ts';
import * as pl from './playlists.ts';
import type { Playlist, PlaylistSettings } from './playlists.ts';
import { facet, type Prepared } from './librarySearch.ts';
import { say } from './words.ts';

/**
 * The home's logic, kept out of `Home.tsx` so it can be tested without a page:
 * the starter smart playlists, the sidebar's sections, a playlist's strip of
 * thumbnails, and its settings.
 */

/** A smart playlist the home makes once, on a fresh install. */
export interface Starter {
  /** Kept on the playlist (`Playlist.starter`): how seeding knows it made it, whatever it's called now. */
  id: string;
  name: string;
  query: LibraryQuery;
  settings: PlaylistSettings;
}

/** How many presets "Recently played" keeps. */
export const RECENT = 50;

/**
 * The starter smart playlists, from the library's Speed and Intensity groups
 * (AND across groups, OR within one), and the presets played lately.
 */
export const STARTERS: readonly Starter[] = [
  {
    id: 'calm',
    name: 'Calm',
    query: { groups: { speed: ['low', 'mid'], intensity: ['low'] }, text: '' },
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 45 }, order: 'shuffle', transition: 5 },
  },
  {
    id: 'peak-time',
    name: 'Peak-time',
    query: { groups: { speed: ['mid', 'high'], intensity: ['high'] }, text: '' },
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 15 }, order: 'shuffle', transition: 1 },
  },
  {
    id: 'recently-played',
    name: 'Recently played',
    query: { groups: {}, text: '', recent: RECENT },
    settings: { ...pl.DEFAULT_SETTINGS },
  },
];

/** The browser storage key saying the starters were made, so they are made only once (and a deleted one stays deleted). */
export const SEEDED_KEY = 'visuals.home.starters';

/** Where the seeding mark is kept: the page's local storage in the app, a map in tests. */
export interface Mark {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What seeding needs from the app. */
export interface Seeding {
  /** Save a smart playlist carrying the starter id `starter`. */
  save(name: string, query: LibraryQuery, starter: string): Promise<string>;
  settings(id: string, settings: PlaylistSettings): Promise<unknown>;
}

/**
 * Make the starter smart playlists the first time the home opens, each with its
 * own settings and its starter id. Marked as done once they are made, so they
 * are never made again, even after one is deleted. Without storage to keep the
 * mark, nothing is made (rather than again on every start). Resolves to how many
 * it made.
 *
 * A run that failed part way is finished on the next start: a playlist carrying
 * a starter's id gets that starter's settings again. Nothing without the id is
 * ever changed, so a user's own Calm keeps its settings; and a starter isn't made
 * while a smart playlist of its name but no id is there (the user's own, or one
 * seeded before starters carried an id), so there are never two of one name.
 */
export function seedStarters(playlists: readonly Playlist[], mark: Mark | null, app: Seeding): Promise<number> {
  // One run at a time in this page (StrictMode mounts twice, effects re-run); the
  // mark, set before the first await, keeps a second window out too.
  seeding ??= seedOnce(playlists, mark, app).finally(() => (seeding = null));
  return seeding;
}

let seeding: Promise<number> | null = null;

async function seedOnce(playlists: readonly Playlist[], mark: Mark | null, app: Seeding): Promise<number> {
  if (!mark || mark.get(SEEDED_KEY)) return 0;
  mark.set(SEEDED_KEY, '1');
  try {
    const smart = playlists.filter((p) => p.kind === 'smart');
    const ours = new Map(smart.filter((p) => p.starter).map((p) => [p.starter, p.id]));
    const named = new Set(smart.filter((p) => !p.starter).map((p) => p.name));
    let made = 0;
    for (const s of STARTERS) {
      // One already made by a run that failed part way gets its settings again.
      const old = ours.get(s.id);
      if (old !== undefined) {
        await app.settings(old, s.settings);
        continue;
      }
      if (named.has(s.name)) continue;
      const id = await app.save(s.name, s.query, s.id);
      made++;
      await app.settings(id, s.settings);
    }
    return made;
  } catch (err) {
    // Not done: the next start tries again.
    mark.remove(SEEDED_KEY);
    throw err;
  }
}

/** Where focus goes after a strip tile moves to `to`: that tile, or the last one drawn when it moved past the cap. */
export const tileFocus = (to: number, drawn: number): number => Math.max(0, Math.min(to, drawn - 1));

/**
 * The rename box's commit rule: Enter or leaving it commits once; Esc cancels,
 * and the blur that follows the box closing commits nothing.
 */
export class NameEdit {
  private done = false;
  /** The name to save on Enter or blur, or null. */
  commit(draft: string | null, current: string): string | null {
    if (this.done) return null;
    this.done = true;
    const name = draft?.trim();
    return name && name !== current ? name : null;
  }
  cancel() {
    this.done = true;
  }
  /** A new edit begins. */
  open() {
    this.done = false;
  }
}

/** The page's local storage, or null where it can't be used. */
export function localMark(): Mark | null {
  try {
    const s = window.localStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

/** The sidebar's two kinds of playlist, each in the order kept. */
export function sections(playlists: readonly Playlist[]): { manual: Playlist[]; smart: Playlist[] } {
  return { manual: playlists.filter((p) => p.kind === 'manual'), smart: playlists.filter((p) => p.kind === 'smart') };
}

/** One preset in a playlist's strip. */
export interface StripTile {
  /** Unique within the strip. */
  key: string;
  path: string;
  name: string;
  thumbnail: string | null;
  missing: boolean;
  /**
   * Where it is in the playlist: an index into a manual playlist's items, or into
   * a smart one's matches as they resolve in order; null for a smart playlist
   * shown in its shuffled play order, whose places the page can't name.
   */
  index: number | null;
}

/** The most tiles a strip draws; a smart playlist can match the whole library. */
export const STRIP_CAP = 300;

/** What a strip is built from: the library (with the user's data), the presets played lately, and what the deck plays when this playlist is playing. */
export interface StripContext {
  rows: readonly Prepared[];
  played: readonly string[];
  /** The deck's play order (`deckItems`) when this playlist is the one playing; null otherwise. */
  playing: readonly string[] | null;
}

const fileName = (path: string) => (path.split('/').pop() ?? path).replace(/\.milk$/i, '');

/**
 * The presets a smart playlist's query picks, in the order they play unshuffled: the library's (curated
 * picks, then by key), or newest first with `recent`. Never a hidden one, and a utility preset only when
 * the query asks for it (`reachesUtility`; `recent` does). As Rust's `query::resolve` works it out.
 */
export function matches(query: LibraryQuery, rows: readonly Prepared[], played: readonly string[]): Prepared[] {
  const shown = facet(rows, query).shown.filter((p) => !p.hidden);
  if (query.recent === undefined) return shown;
  const byPath = new Map(shown.map((p) => [p.row.path, p]));
  const out: Prepared[] = [];
  for (const path of played.slice(0, query.recent)) {
    const p = byPath.get(path);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * A playlist's presets as the strip shows them, in play order: a manual one's
 * items as listed (as the deck shuffled them, when it plays shuffled), a smart
 * one's matches. `total` is how many there are; `tiles` stops at `STRIP_CAP`.
 */
export function strip(list: Playlist, ctx: StripContext): { tiles: StripTile[]; total: number } {
  const byPath = new Map(ctx.rows.map((p) => [p.row.path, p]));
  const byHash = new Map(ctx.rows.filter((p) => p.row.hash).map((p) => [p.row.hash, p]));
  const shuffled = ctx.playing !== null && list.settings.order === 'shuffle';
  let tiles: StripTile[];
  if (list.kind === 'manual') {
    const look = list.items.map((item, index) => {
      const p = byPath.get(item.path) ?? (item.hash ? byHash.get(item.hash) : undefined);
      return { key: `${index}`, path: item.path, name: item.name, thumbnail: p?.row.thumbnail ?? null, missing: item.missing, index };
    });
    if (shuffled) {
      // The deck names paths only; a preset listed twice takes its places in turn.
      const left = [...look];
      tiles = [];
      for (const path of ctx.playing!) {
        const at = left.findIndex((t) => t?.path === path);
        if (at >= 0) {
          tiles.push(left[at]);
          left.splice(at, 1);
        }
      }
      tiles.push(...left);
    } else {
      tiles = look;
    }
  } else if (shuffled) {
    tiles = ctx.playing!.map((path, i) => {
      const p = byPath.get(path);
      return { key: `${i}:${path}`, path, name: p?.title ?? fileName(path), thumbnail: p?.row.thumbnail ?? null, missing: false, index: null };
    });
  } else {
    const found = list.query ? matches(list.query, ctx.rows, ctx.played) : [];
    tiles = found.map((p, i) => ({ key: p.row.key, path: p.row.path, name: p.title, thumbnail: p.row.thumbnail, missing: false, index: i }));
  }
  return { tiles: tiles.slice(0, STRIP_CAP), total: tiles.length };
}

/** The playlist's settings with one changed, kept within what the app allows. */
export function withSetting<K extends keyof PlaylistSettings>(s: PlaylistSettings, name: K, value: PlaylistSettings[K]): PlaylistSettings {
  const next = { ...s, [name]: value };
  next.transition = clamp(next.transition, 0, 10);
  next.speed = clamp(next.speed, 0.25, 4);
  next.trails = clamp(next.trails, 0, 1);
  next.hue = clamp(next.hue, 0, 1);
  next.change = { unit: next.change.unit, every: clamp(Math.round(next.change.every), 1, next.change.unit === 'bars' ? 64 : 3600) };
  return next;
}

/**
 * Switch how a playlist moves on between seconds, bars and off: bars to their usual amount; seconds and off
 * keep the seconds between them (off remembers what it goes back to), or take the usual amount coming from bars.
 */
export function changeUnit(s: PlaylistSettings, unit: pl.Change['unit']): PlaylistSettings {
  if (s.change.unit === unit) return s;
  const every = unit === 'bars' ? 8 : s.change.unit === 'bars' ? pl.DEFAULT_SETTINGS.change.every : s.change.every;
  return withSetting(s, 'change', { unit, every });
}

/**
 * Where the preset playing comes from, as the bottom bar's second line and the
 * Now Playing panel say it: "from Chill · 3 of 20", "from the library · 7 of
 * 412" while the deck follows the library's filter, else "opened on its own".
 * `place` false leaves out "· n of m" (the panel's line).
 */
export function playsFrom(deck: pl.Deck, playlists: readonly Playlist[], place = true): string {
  const of = (index: number | null, count: number) => (place && index !== null && count > 0 ? ` · ${(index + 1).toLocaleString('en-US')} of ${count.toLocaleString('en-US')}` : '');
  const up = pl.upNext({ deck, playlists: [...playlists] });
  if (up) return `from ${up.playlist.name}${of(up.index, up.count)}`;
  if (deck.query) return `from ${say('library query')}${of(deck.index, deck.count)}`;
  return say('played alone');
}

/** What the main pane shows: a playlist, by id; the library; or the library's starred presets. */
export type Pane = { kind: 'list'; id: string } | { kind: 'library' } | { kind: 'starred' };

/** The smart playlist the sidebar shows as "Recently played", beside the library, rather than with the other smart playlists: the one filling itself with the presets played lately. */
export const recentList = (playlists: readonly Playlist[]): Playlist | null => playlists.find((p) => p.kind === 'smart' && p.query?.recent !== undefined) ?? null;

/** How often a playlist moves on, said plainly: "moves on every 30 s", "every 8 bars", "stays on each preset". */
export function movesOn(change: pl.Change): string {
  if (change.unit === 'off') return 'stays on each preset';
  if (change.unit === 'bars') return `moves on every ${change.every === 1 ? 'bar' : `${change.every} bars`}`;
  return `moves on every ${change.every} s`;
}

/**
 * A playlist's one-line summary under its name: how many presets, how it moves
 * on, its order and crossfade, then any look it sets ("20 presets · moves on
 * every 30 s · in order · crossfade 2 s"). `total` is how many it holds (a
 * smart one's matches).
 */
export function playsLike(list: Playlist, total: number): string {
  const s = list.settings;
  const n = `${total.toLocaleString('en-US')} preset${total === 1 ? '' : 's'}`;
  const look = [s.speed !== 1 && `speed ${s.speed.toFixed(2)}×`, s.trails > 0 && `trails ${Math.round(s.trails * 100)}%`, s.hue > 0 && `colour shift ${Math.round(s.hue * 360)}°`];
  return [n, movesOn(s.change), s.order === 'shuffle' ? 'shuffled' : 'in order', `crossfade ${Number(s.transition.toFixed(1))} s`, ...look].filter(Boolean).join(' · ');
}

/** The browser storage keys for what a viewer leaves open on the home: the library's filter chips, and the Now Playing panel in a wide window. */
export const FILTERS_KEY = 'visuals.home.filters';
export const PANEL_KEY = 'visuals.home.panel';

/** A remembered open-or-closed, `fallback` when nothing was kept or storage can't be read. */
export function remembered(key: string, fallback: boolean): boolean {
  const v = localMark()?.get(key);
  return v === '1' ? true : v === '0' ? false : fallback;
}

/** Keep an open-or-closed for next time; nothing when storage can't be used. */
export function remember(key: string, open: boolean): void {
  try {
    localMark()?.set(key, open ? '1' : '0');
  } catch {
    // Storage full or refused: it opens as it would next time.
  }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** A file to save in the page: a link to it, clicked. */
export function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
