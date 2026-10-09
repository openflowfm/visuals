import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LibraryQuery, Preset, Report } from './api.ts';
import { nameOf } from './shell.ts';

/** `actions::Action`: one live action, from the page, the auto-advance timer or a controller. */
export type Action =
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'random' }
  | { kind: 'go'; index: number }
  | { kind: 'load'; playlist: number; index: number | null }
  | { kind: 'unload' }
  | { kind: 'auto'; on: boolean | null }
  | { kind: 'seconds'; seconds: number }
  /** HOLD on or off; null flips it. */
  | { kind: 'hold'; on: boolean | null }
  /** Change on Link's bar lines every this many bars. */
  | { kind: 'bars'; bars: number }
  /** Play the presets matching a filter, as an unsaved smart playlist; hidden ones never. */
  | { kind: 'query'; query: LibraryQuery };

/** `playlists::Change`: when a playlist moves on — every so many seconds, or on Link's bar lines every so many bars. */
export type Change = { unit: 'seconds'; every: number } | { unit: 'bars'; every: number };

/** `playlists::Order`: the items as listed, or shuffled. */
export type Order = 'in_order' | 'shuffle';

/** `playlists::Settings`: how a playlist plays, kept with it and applied when it loads. */
export interface PlaylistSettings {
  change: Change;
  order: Order;
  /** Crossfade between presets, in seconds, 0–10. */
  transition: number;
  /** How fast the presets run, 0.25–4. */
  speed: number;
  /** Trails, 0–1. */
  trails: number;
  /** Hue shift, 0–1. */
  hue: number;
}

/** One of a playlist's settings, by name; what `Deck.differs` lists. */
export type SettingName = keyof PlaylistSettings;

/** What a new playlist starts with: a change every 30 s, in order, a 2 s crossfade, nothing else changed. */
export const DEFAULT_SETTINGS: PlaylistSettings = { change: { unit: 'seconds', every: 30 }, order: 'in_order', transition: 2, speed: 1, trails: 0, hue: 0 };

/** `playlists::Item`. */
export interface Item {
  path: string;
  name: string;
  group: string;
  /** The file is not there (any more). */
  missing: boolean;
  /** The file's content hash, how a moved preset is found again; null when it wasn't known. */
  hash: string | null;
}

/** `playlists::View`. */
export interface Playlist {
  id: string;
  name: string;
  /** A manual playlist's presets, in order. A smart playlist's is empty: it is resolved when it loads (the library filter shows its matches). */
  items: Item[];
  /** Manual (a list of presets) or smart (whatever matches `query`). */
  kind: 'manual' | 'smart';
  /** A smart playlist's filter; null for a manual one. */
  query: LibraryQuery | null;
  settings: PlaylistSettings;
}

/** A manual playlist with the default settings, as a new one is: for fixtures and placeholders. */
export const manual = (id: string, name: string, items: Item[]): Playlist => ({ id, name, items, kind: 'manual', query: null, settings: DEFAULT_SETTINGS });

/** `actions::DeckView`: what is playing, and how it moves on. */
export interface Deck {
  /** The active playlist's id. */
  playlist: string | null;
  index: number | null;
  auto: boolean;
  seconds: number;
  current: string | null;
  /** HOLD: steps, auto-advance and Link's changes are refused until it is let go. */
  hold: boolean;
  /** Link's change interval in bars; 0 when off or when the schedule is in beats. */
  bars: number;
  /** In order or shuffled. */
  order: Order;
  /** The loaded playlist's settings; null when none is loaded. */
  settings: PlaylistSettings | null;
  /** The settings the live deck has been tweaked away from the playlist's; a tweak lasts until the next playlist loads. */
  differs: SettingName[];
  /** The path `next` opens, knowing shuffle and smart lists; null when no playlist or filter plays. */
  next: string | null;
  /** Where `next` is in what is playing: an index into the playlist's items, or the resolved smart list's or the filter's; null when nothing plays or nothing is next. The same preset can be in a playlist twice, so this, not the path, says which. */
  next_index: number | null;
  /** How many presets are in what is playing: the playlist, the resolved smart list or the filter; 0 for the library. */
  count: number;
  /** Playing an unsaved filter (a mood chip, say); null otherwise. */
  query: LibraryQuery | null;
}

/** The deck before anything has loaded, as the app starts. */
export const EMPTY_DECK: Deck = {
  playlist: null,
  index: null,
  auto: false,
  seconds: 30,
  current: null,
  hold: false,
  bars: 0,
  order: 'in_order',
  settings: null,
  differs: [],
  next: null,
  next_index: null,
  count: 0,
  query: null,
};

/** `actions::Lists`, which every playlist command returns. */
export interface Lists {
  playlists: Playlist[];
  deck: Deck;
}

/** `actions::Now`, the `live` event: what an action did, whoever sent it. */
export interface Now {
  deck: Deck;
  opened: { preset: Preset; report: Report } | null;
  path: string | null;
  error: string | null;
}

/** What the deck is playing from a playlist, and what `next` will open after it. */
export interface Up {
  playlist: Playlist;
  /** The playing item's position, or null before the first. */
  index: number | null;
  /** What `next` opens: null only when the playlist is empty (or, for a smart one, when the deck didn't say). */
  next: Item | null;
  /** Where `next` is: in `playlist.items` for a manual playlist, in the resolved matches for a smart one (whose items are empty); null when the deck didn't say. */
  nextIndex: number | null;
  /** How many presets are playing: a smart playlist's resolved matches, otherwise its items. */
  count: number;
}

/** An item for a path the deck names that no listed playlist item has (a smart list's or a filter's). */
const itemAt = (path: string): Item => ({ path, name: nameOf(path), group: path.split('/').slice(-2, -1)[0] ?? '', missing: false, hash: null });

/**
 * The active playlist and its next item. The deck's own `next` comes first, as
 * it knows shuffle and smart lists, found by the deck's `next_index` (never by
 * path: a playlist can hold one preset twice); without it, stepping the way
 * `actions::decide` does: one on from the playing item, round to the first after
 * the last, and the first when nothing in it has played yet. Missing files are
 * not skipped (the engine doesn't skip them either). Null when no playlist is
 * playing.
 */
export function upNext(lists: Lists | null): Up | null {
  if (!lists?.deck.playlist) return null;
  const deck = lists.deck;
  const playlist = lists.playlists.find((p) => p.id === deck.playlist);
  if (!playlist) return null;
  const items = playlist.items;
  const count = playlist.kind === 'smart' ? deck.count : items.length;
  const index = deck.index !== null && deck.index < count ? deck.index : null;
  if (deck.next) {
    const at = deck.next_index;
    if (playlist.kind === 'manual' && at !== null && at >= 0 && at < items.length) return { playlist, index, next: items[at], nextIndex: at, count };
    return { playlist, index, next: itemAt(deck.next), nextIndex: playlist.kind === 'smart' ? at : null, count };
  }
  if (items.length === 0) return { playlist, index: null, next: null, nextIndex: null, count };
  const nextIndex = index === null ? 0 : (index + 1) % items.length;
  return { playlist, index, next: items[nextIndex], nextIndex, count };
}

/** What live mode's "next" line can honestly say. */
export type NextSays =
  /** HOLD is on: next, auto-advance and Link's changes are refused, so nothing is next. */
  | { kind: 'held' }
  /** The item → (and auto-advance, and Link's change) opens. */
  | { kind: 'item'; up: Up; item: Item }
  /** The playing playlist is empty. */
  | { kind: 'empty'; up: Up }
  /** No playlist, but the deck says what → opens: from a filter (`query`, a mood chip say) or the library (null). */
  | { kind: 'filter'; item: Item; query: LibraryQuery | null }
  /** No playlist: the next file in the library, which the page doesn't know by name. */
  | { kind: 'library' };

/**
 * What → will open. Only `next` is predictable — R picks any other item, so the
 * line names what stepping on gives, never a random pick — and while held nothing
 * steps at all.
 */
export function nextSays(lists: Lists | null, held: boolean): NextSays {
  if (held) return { kind: 'held' };
  const up = upNext(lists);
  if (!up) return lists?.deck.next ? { kind: 'filter', item: itemAt(lists.deck.next), query: lists.deck.query ?? null } : { kind: 'library' };
  if (up.next) return { kind: 'item', up, item: up.next };
  return up.count === 0 ? { kind: 'empty', up } : { kind: 'library' };
}

/** The name a new playlist gets: the first "playlist N" not taken. */
export function freshName(playlists: readonly Playlist[]): string {
  const taken = new Set(playlists.map((p) => p.name));
  let n = playlists.length + 1;
  while (taken.has(`playlist ${n}`)) n++;
  return `playlist ${n}`;
}

export const act = (action: Action) => invoke<void>('act', { action });
export const lists = () => invoke<Lists>('playlists');
export const create = (name: string) => invoke<Lists>('playlist_create', { name });
export const rename = (id: string, name: string) => invoke<Lists>('playlist_rename', { id, name });
export const remove = (id: string) => invoke<Lists>('playlist_delete', { id });
export const add = (id: string, path: string, at: number | null = null) => invoke<Lists>('playlist_add', { id, path, at });
export const removeItem = (id: string, index: number) => invoke<Lists>('playlist_remove', { id, index });
export const moveItem = (id: string, from: number, to: number) => invoke<Lists>('playlist_move_item', { id, from, to });
export const move = (id: string, to: number) => invoke<Lists>('playlist_move', { id, to });
/** Keep `settings` with the playlist `id`; they apply when it loads (and now, if it is playing). */
export const setSettings = (id: string, settings: PlaylistSettings) => invoke<Lists>('playlist_settings', { id, settings });
/** Change a smart playlist's filter. */
export const setQuery = (id: string, query: LibraryQuery) => invoke<Lists>('playlist_set_query', { id, query });
/** `playlists::Export`: a playlist as a file to save. */
export interface Exported {
  file_name: string;
  /** JSON: name, kind, query, settings, and items as `{ path, hash }`. */
  text: string;
}
/** A playlist as a file's name and text, for the page to save. */
export const exportList = (id: string) => invoke<Exported>('playlist_export', { id });
/** Add the playlist in `text` (what `exportList` wrote) to the playlists. */
export const importList = (text: string) => invoke<Lists>('playlist_import', { text });
/** The paths playing, in play order: the playlist (shuffled when it is), the resolved smart list or the filter. */
export const deckItems = () => invoke<string[]>('deck_items');
/** The presets played lately, newest first. */
export const recentlyPlayed = () => invoke<string[]>('recently_played');
/** The playlists, when they change other than by a command here (presets that moved). */
export const onLists = (f: (lists: Lists) => void): Promise<UnlistenFn> => listen<Lists>('lists', (e) => f(e.payload));
export const onLive = (f: (now: Now) => void): Promise<UnlistenFn> => listen<Now>('live', (e) => f(e.payload));
