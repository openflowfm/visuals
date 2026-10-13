/**
 * "This set" on Live's map: the paths of what the deck plays (`deck_items`), and when to read them
 * again (`deckSetKey`).
 */
import { useEffect, useState } from 'react';
import type { LiveState } from '../model/live-model';
import * as pl from '../model/playlists';

/** FNV-1a over `text`, as 8 hex digits: a short key for a long list. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * What "this set" is read for: a key that changes whenever what the deck plays may have, so its
 * `deck_items` are read again; null when the deck plays the whole library (no playlist, no
 * filter). It names the playlist, the filter, the order and the count, and the contents: a manual
 * playlist's items (each one's path and hash, in order, so one replaced at the same count is
 * news); a smart playlist's query; and, for a set chosen by a query (a smart playlist or a filter),
 * `libraryChanges`, how many times the user's library data changed (a star or a tag can move a
 * preset in or out).
 */
export function deckSetKey(deck: pl.Deck | null | undefined, playlists: readonly pl.Playlist[] | undefined, libraryChanges: number): string | null {
  if (!deck || (!deck.playlist && !deck.query)) return null;
  const list = deck.playlist ? playlists?.find((p) => p.id === deck.playlist) : undefined;
  const items = list ? fnv(list.items.map((i) => `${i.path}\u0000${i.hash ?? ''}`).join('\u0001')) : '';
  const byQuery = deck.query !== null || list?.kind === 'smart';
  return [deck.playlist ?? '', JSON.stringify(deck.query), deck.order, deck.count, list?.kind ?? '', JSON.stringify(list?.query ?? null), items, byQuery ? libraryChanges : ''].join('|');
}

/** How many times `value` has changed (by identity) since the component mounted. */
function useChanges(value: unknown): number {
  const [seen, setSeen] = useState({ value, n: 0 });
  if (seen.value === value) return seen.n;
  const next = { value, n: seen.n + 1 };
  setSeen(next);
  return next.n;
}

/**
 * The paths of what the deck plays (`deck_items`), read again whenever `deckSetKey` changes (the
 * playlist, its contents, the filter, order or count, or the library's data under a query).
 * `whole` when the deck plays the whole library (no playlist, no filter); `paths` is the last set
 * read while reading again, null before the first read or when the latest failed (`failed`).
 */
export function useDeckSet(live: LiveState): { whole: boolean; paths: string[] | null; failed: boolean } {
  const libraryChanges = useChanges(live.data);
  const key = deckSetKey(live.deck, live.lists?.playlists, libraryChanges);
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
  // While reading again, the last set read stays shown (a star needn't empty the map for a moment).
  const done = read?.key === key;
  return { whole: false, paths: read?.paths ?? null, failed: done && read.paths === null };
}
