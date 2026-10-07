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
