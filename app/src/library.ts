import { useEffect, useMemo, useState } from 'react';
import * as api from './api.ts';
import type { Entry, LibraryQuery } from './api.ts';
import { searchLibrary } from './librarySearch.ts';
import { nameOf } from './shell.ts';
import { onChanged } from './pack.ts';
import * as pl from './playlists.ts';

/**
 * The deck's action for following the grid: `at` was just opened from the grid
 * filtered by `query`, so previous, next and random go through what the grid shows,
 * in its order and on across its groups (`actions::Action::Query` with `at`).
 */
export const followAction = (query: LibraryQuery, at: string): pl.Action => ({ kind: 'query', query, at });

/** Steps sent to the deck and not answered yet. */
let pending = 0;

/** Step the deck (next, previous, random), counting it as in flight until it answers. */
export function stepDeck(action: pl.Action): Promise<void> {
  pending += 1;
  let sent: Promise<void>;
  try {
    sent = pl.act(action);
  } catch (e) {
    sent = Promise.reject(e);
  }
  return sent.finally(() => {
    pending -= 1;
  });
}

/** A step is in flight: what the page shows may not be what the deck plays yet. */
export const stepping = () => pending > 0;

/** The grid's contents as one value: it changes when what the grid shows does. */
export const gridKey = (paths: string[]) => paths.join('\n');

/**
 * Tell the deck to follow the grid ({@link followAction}), in the library and in live.
 * The deck never plays a hidden preset and skips a failed one; while a playlist is
 * loaded it changes nothing. Outside the app, or when it can't, nothing happens:
 * stepping goes through the library as before.
 */
export function followGrid(query: LibraryQuery, at: string): void {
  try {
    pl.act(followAction(query, at)).catch(() => {});
  } catch {
    // not in the app
  }
}

/**
 * The preset to open once the library is read: `start` (found in the library,
 * or as a bare path when it isn't there), else the one at `pick` (0–1) through
 * the library, else none for an empty library.
 */
export function firstToOpen(library: Entry[], start: string | null, pick: number): Entry | null {
  if (start) return library.find((e) => e.path === start) ?? { path: start, name: nameOf(start), group: '' };
  if (!library.length) return null;
  return library[Math.min(library.length - 1, Math.floor(pick * library.length))];
}

/**
 * Call `reread` each time `subscribe` fires, until the returned stop is called;
 * a stop before the subscription settles still unsubscribes.
 */
export function rereadOn(subscribe: (f: () => void) => Promise<() => void>, reread: () => void): () => void {
  let stopped = false;
  const unlisten = subscribe(() => {
    if (!stopped) reread();
  });
  return () => {
    stopped = true;
    void unlisten.then(
      (u) => u(),
      () => {},
    );
  };
}

/**
 * The preset library and its search. Once the folders are read it opens `start`,
 * or a random preset when there's none.
 */
export function useLibrary(start: string | null, load: (e: Entry) => void, fail: (message: string) => (e: unknown) => void) {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const found = useMemo(() => searchLibrary(library, search), [library, search]);

  useEffect(() => {
    api.presets().then(
      (l) => {
        setLibrary(l);
        setLoaded(true);
        const first = firstToOpen(l, start, Math.random());
        if (first) load(first);
      },
      (e) => {
        setLoaded(true);
        fail("Couldn't read the preset folder.")(e);
      },
    );
  }, [load, fail]);

  // The presets folder changed (a download, a drop): read the library again.
  useEffect(() => rereadOn(onChanged, () => void api.presets().then(setLibrary, () => {})), []);

  return { library, loaded, search, setSearch, found };
}
