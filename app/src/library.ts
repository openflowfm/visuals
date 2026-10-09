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

/**
 * A step sent to the deck. The deck sends the `live` event (what it opened) and then
 * its answer, but the page can get them either way round: the step is in flight until
 * it has both, so nothing reads the page's preset while it still shows the old one.
 */
interface Step {
  sent: boolean;
  answered: boolean;
  live: boolean;
}

/** Steps sent to the deck and not settled yet. */
const steps = new Set<Step>();

/** How long an answered step waits for its `live` event before it counts as settled anyway, in ms. */
export const LIVE_WAIT = 2000;

/** The `live` event came: every step already sent has had its event. */
function sawLive() {
  for (const s of steps) {
    if (!s.sent) continue;
    s.live = true;
    if (s.answered) steps.delete(s);
  }
}

/** Listening for `live`, started by the first step; false when it can't (outside the app). */
let listening: Promise<boolean> | null = null;
function listenLive(): Promise<boolean> {
  if (!listening) {
    try {
      listening = pl.onLive(sawLive).then(
        () => true,
        () => false,
      );
    } catch {
      listening = Promise.resolve(false);
    }
  }
  return listening;
}

/**
 * Step the deck (next, previous, random), counting it as in flight until it has
 * both answered and sent its `live` event, whichever comes first; a refused step
 * sends no event and settles with its answer.
 */
export function stepDeck(action: pl.Action): Promise<void> {
  const s: Step = { sent: false, answered: false, live: false };
  steps.add(s);
  const sent = listenLive().then((heard) => {
    s.live = !heard;
    s.sent = true;
    return pl.act(action);
  });
  return sent.then(
    () => {
      s.answered = true;
      if (s.live) steps.delete(s);
      else setTimeout(() => steps.delete(s), LIVE_WAIT);
    },
    (e) => {
      steps.delete(s);
      throw e;
    },
  );
}

/** A step is in flight: what the page shows may not be what the deck plays yet. */
export const stepping = () => steps.size > 0;

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
