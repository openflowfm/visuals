import type { LibraryQuery } from './api.ts';
import * as pl from './playlists.ts';
import type { Playlist, PlaylistSettings } from './playlists.ts';
import { facet, type Prepared } from './librarySearch.ts';

/**
 * The home's logic, kept out of `Home.tsx` so it can be tested without a page:
 * the starter smart playlists, the sidebar's sections, a playlist's strip of
 * thumbnails, and its settings.
 */

/** A smart playlist the home makes once, on a fresh install. */
export interface Starter {
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
    name: 'Calm',
    query: { groups: { speed: ['low', 'mid'], intensity: ['low'] }, text: '' },
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 45 }, order: 'shuffle', transition: 5 },
  },
  {
    name: 'Peak-time',
    query: { groups: { speed: ['mid', 'high'], intensity: ['high'] }, text: '' },
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 15 }, order: 'shuffle', transition: 1 },
  },
  {
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
}

/** What seeding needs from the app. */
export interface Seeding {
  save(name: string, query: LibraryQuery): Promise<string>;
  settings(id: string, settings: PlaylistSettings): Promise<unknown>;
}

/**
 * Make the starter smart playlists the first time the home opens: each one
 * whose name no smart playlist has yet, with its own settings. Marked as done
 * once they are made, so they are never made again, even after one is deleted.
 * Without storage to keep the mark, nothing is made (rather than again on every
 * start). Resolves to how many it made.
 */
export async function seedStarters(playlists: readonly Playlist[], mark: Mark | null, app: Seeding): Promise<number> {
  if (!mark || mark.get(SEEDED_KEY)) return 0;
  const have = new Set(playlists.filter((p) => p.kind === 'smart').map((p) => p.name));
  let made = 0;
  for (const s of STARTERS) {
    if (have.has(s.name)) continue;
    const id = await app.save(s.name, s.query);
    await app.settings(id, s.settings);
    made++;
  }
  mark.set(SEEDED_KEY, '1');
  return made;
}

/** The page's local storage, or null where it can't be used. */
export function localMark(): Mark | null {
  try {
    const s = window.localStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v) };
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

/** The presets a smart playlist's query picks, in the order they play unshuffled: the library's (by key), or newest first with `recent`. Never a hidden one. */
export function matches(query: LibraryQuery, rows: readonly Prepared[], played: readonly string[]): Prepared[] {
  const shown = facet(rows, { groups: query.groups, text: query.text }).shown.filter((p) => !p.hidden);
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

/** Switch how a playlist moves on between seconds and bars, to that unit's usual amount. */
export const changeUnit = (s: PlaylistSettings, unit: pl.Change['unit']): PlaylistSettings =>
  s.change.unit === unit ? s : withSetting(s, 'change', unit === 'bars' ? { unit, every: 8 } : { unit, every: pl.DEFAULT_SETTINGS.change.every });

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
