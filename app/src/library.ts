import { useEffect, useMemo, useRef, useState } from 'react';
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
 * What the app put back at launch (`resume::resume_state`, which answers once that
 * has settled); null when nothing was (nothing to pick up, or it couldn't be
 * opened again), or outside the app. The page opens a preset of its own only then.
 */
export const resumed = (): Promise<api.Resume | null> => {
  try {
    return api.resumeState().then(
      (r) => r ?? null,
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
};

/**
 * What the page opens once the library is read: `start` when it was given one;
 * otherwise nothing of its own when the app put a preset back (`resume`), only
 * showing what the deck plays (`playing`, or the preset put back); else
 * {@link firstToOpen}'s pick, so something always plays.
 */
export function startFrom(library: Entry[], start: string | null, resume: api.Resume | null, pick: number, playing: string | null = null): { open: Entry | null; show: Entry | null } {
  if (start || !resume) return { open: firstToOpen(library, start, pick), show: null };
  const at = playing ?? resume.current;
  return { open: null, show: at ? (library.find((e) => e.path === at) ?? { path: at, name: nameOf(at), group: '' }) : null };
}

/** The preset the deck plays now; null when none, or it can't be asked. */
const deckPlaying = (): Promise<string | null> => {
  try {
    return pl
      .lists()
      .then((l) => l?.deck?.current ?? null)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

/**
 * Live mode starting with nothing playing on the deck: `start` when it was given
 * one; otherwise, once the app has settled what it put back, nothing of its own
 * when it put a preset back (`shown` is told which), and a random one when it
 * didn't, so the picture is never left black.
 */
export async function startLive(
  start: string | null,
  does: { open(path: string): void; random(): void; shown(path: string): void },
  resume: () => Promise<api.Resume | null> = resumed,
): Promise<void> {
  if (start) return does.open(start);
  const r = await resume();
  if (!r) return does.random();
  const at = (await deckPlaying()) ?? r.current;
  if (at) does.shown(at);
}

/** The filter the app resumed playing, until a library has shown it or the user changed the filter; then none. */
let resumedFilter: Promise<LibraryQuery | null> | null = null;

/** Two filters the same, whatever order their groups came in. */
export function sameQuery(a: LibraryQuery | null | undefined, b: LibraryQuery | null | undefined): boolean {
  if (!a || !b) return a === b;
  const norm = (q: LibraryQuery) =>
    JSON.stringify([
      Object.entries(q.groups ?? {})
        .filter(([, v]) => v?.length)
        .map(([g, v]) => [g, [...v!].sort()])
        .sort(([x], [y]) => String(x).localeCompare(String(y))),
      q.text ?? '',
      q.recent ?? null,
    ]);
  return norm(a) === norm(b);
}

/**
 * The unsaved filter the app picked up playing (no playlist was), for a library
 * to show; null when none, once the deck has moved on from it (a playlist loaded
 * from the home, another filter), and once a library has shown it
 * ({@link forgetResumedQuery}, called by the one that does).
 */
export function resumedQuery(): Promise<LibraryQuery | null> {
  resumedFilter ??= resumed().then((r) => (r && !r.playlist && r.query ? r.query : null));
  return resumedFilter.then(async (q) => {
    if (!q) return null;
    const deck = await (async () => {
      try {
        return (await pl.lists()).deck;
      } catch {
        return null;
      }
    })();
    return deck && !deck.playlist && sameQuery(deck.query, q) ? q : null;
  });
}

/** A library showed the resumed filter, or the user changed the filter: no library shows it after. `again` reads it afresh (tests). */
export function forgetResumedQuery(again = false): void {
  resumedFilter = again ? null : Promise.resolve(null);
}

/**
 * The preset library and its search. Once the folders are read it opens `start`,
 * or a random preset when there's none, unless the app is picking up where it left
 * off: then the preset it puts back stays, and `onResumed` is told which it is.
 */
export function useLibrary(start: string | null, load: (e: Entry) => void, fail: (message: string) => (e: unknown) => void, onResumed?: (e: Entry) => void) {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const found = useMemo(() => searchLibrary(library, search), [library, search]);
  const told = useRef(onResumed);
  told.current = onResumed;

  useEffect(() => {
    api.presets().then(
      async (l) => {
        setLibrary(l);
        setLoaded(true);
        // Asked after the library shows: the answer waits for the deck to be put back.
        const resume = start ? null : await resumed();
        const playing = resume ? await deckPlaying() : null;
        const { open, show } = startFrom(l, start, resume, Math.random(), playing);
        if (open) load(open);
        if (show) told.current?.(show);
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
