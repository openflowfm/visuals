import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Preset, Report } from './api.ts';

/** `actions::Action`: one live action, from the page, the auto-advance timer or a controller. */
export type Action =
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'random' }
  | { kind: 'go'; index: number }
  | { kind: 'load'; playlist: number; index: number | null }
  | { kind: 'unload' }
  | { kind: 'auto'; on: boolean | null }
  | { kind: 'seconds'; seconds: number };

/** `playlists::Item`. */
export interface Item {
  path: string;
  name: string;
  group: string;
  /** The file is not there (any more). */
  missing: boolean;
}

/** `playlists::View`. */
export interface Playlist {
  id: string;
  name: string;
  items: Item[];
}

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
  /** Link's change interval in bars, 0 when off. */
  bars: number;
}

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
  /** What `next` opens: null only when the playlist is empty. */
  next: Item | null;
  nextIndex: number | null;
}

/**
 * The active playlist and its next item, stepping the way `actions::decide`
 * does: one on from the playing item, round to the first after the last, and
 * the first when nothing in it has played yet. Missing files are not skipped
 * (the engine doesn't skip them either). Null when no playlist is playing.
 */
export function upNext(lists: Lists | null): Up | null {
  if (!lists?.deck.playlist) return null;
  const playlist = lists.playlists.find((p) => p.id === lists.deck.playlist);
  if (!playlist) return null;
  const len = playlist.items.length;
  const index = lists.deck.index !== null && lists.deck.index < len ? lists.deck.index : null;
  if (len === 0) return { playlist, index: null, next: null, nextIndex: null };
  const nextIndex = index === null ? 0 : (index + 1) % len;
  return { playlist, index, next: playlist.items[nextIndex], nextIndex };
}

/** What live mode's "next" line can honestly say. */
export type NextSays =
  /** HOLD is on: next, auto-advance and Link's changes are refused, so nothing is next. */
  | { kind: 'held' }
  /** The item → (and auto-advance, and Link's change) opens. */
  | { kind: 'item'; up: Up; item: Item }
  /** The playing playlist is empty. */
  | { kind: 'empty'; up: Up }
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
  if (!up) return { kind: 'library' };
  return up.next ? { kind: 'item', up, item: up.next } : { kind: 'empty', up };
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
export const onLive = (f: (now: Now) => void): Promise<UnlistenFn> => listen<Now>('live', (e) => f(e.payload));
