/**
 * **Job.** The library's view on Home: Grid (its tiles) or Map (the Field in the grid's room),
 * the rule for where the map shows, and what the map draws. The choice is the page's, kept as
 * `mapPrefs` keeps the map's axes: in the page's storage, one for the app (not per source or
 * playlist), every mounted `useLibraryView` following a change.
 */
import { useSyncExternalStore } from 'react';
import type { LibraryQuery, LibraryRow } from './api';
import { localMark, matches } from './home';
import { facet, STARRED, type Prepared } from './librarySearch';
import type { Playlist } from './playlists';

/** How the library's room shows its presets. */
export type LibraryView = 'grid' | 'map';

/** The views, in the switch's order, with its words. */
export const LIBRARY_VIEWS: readonly LibraryView[] = ['grid', 'map'];
export const LIBRARY_VIEW_WORDS = ['Grid', 'Map'] as const;

/** Where the choice is kept: `grid` or `map`. */
export const LIBRARY_VIEW_KEY = 'visuals.library.view';

/** The choice kept: `map`, else the grid (nothing kept, or anything else). */
export const readLibraryView = (raw: string | null | undefined): LibraryView => (raw === 'map' ? 'map' : 'grid');

// The choice while storage can't keep it (none, blocked or full): the session's.
let memory: LibraryView = 'grid';
let saved = true;
const listeners = new Set<() => void>();

/** The choice now: read from storage each time (a string, so the snapshot is stable), the session's when storage couldn't keep it. */
function now(): LibraryView {
  if (!saved) return memory;
  try {
    const m = localMark();
    if (m) return readLibraryView(m.get(LIBRARY_VIEW_KEY));
  } catch {
    // Unreadable: the session's.
  }
  return memory;
}

/** Keep a new choice and tell every mounted `useLibraryView`. */
export function setLibraryView(next: LibraryView): void {
  memory = next;
  try {
    const m = localMark();
    m?.set(LIBRARY_VIEW_KEY, next);
    saved = !!m;
  } catch {
    saved = false;
  }
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The library's view and the way to change it, shared by everything on the page. */
export function useLibraryView(): [LibraryView, (next: LibraryView) => void] {
  return [useSyncExternalStore(subscribe, now, now), setLibraryView];
}

/** Whether the library's room shows the map: in Map view, except while quick add is on (a click there adds, which is the grid's). */
export const roomShowsMap = (view: LibraryView, quickAdd: boolean): boolean => view === 'map' && !quickAdd;

/** Whether the inspector keeps its library map section: only while the room doesn't show the map, so there is never two. */
export const inspectorShowsMap = (view: LibraryView, quickAdd: boolean): boolean => !roomShowsMap(view, quickAdd);

/**
 * What the library's pane shows, as a query: the groups and the text the viewer picked, with
 * Starred's star always picked, browsing (decision 68) on the home. The grid and its map both
 * show what this finds.
 */
export function paneQuery(starred: boolean, groups: LibraryQuery['groups'], text: string, browse: boolean): LibraryQuery {
  return { groups: starred ? { ...groups, star: [STARRED] } : groups, text, ...(browse ? { browse } : {}) };
}

/** The rows the map draws for the library's pane: what the grid shows for `query`, from the prepared rows (browse-ordered on the home). */
export const mapRows = (prepared: readonly Prepared[], query: LibraryQuery): LibraryRow[] => facet(prepared, query).shown.map((p) => p.row);

/**
 * The rows the map draws for a playlist: a manual one's presets (found by path, else by hash, as
 * its grid finds them; a preset listed twice is one dot, one gone from the library none), a smart
 * one's matches. No cap: the grid stops at `STRIP_CAP` tiles, the map draws them all.
 */
export function listRows(list: Playlist, rows: readonly Prepared[], played: readonly string[]): LibraryRow[] {
  if (list.kind !== 'manual') return list.query ? matches(list.query, rows, played).map((p) => p.row) : [];
  const byPath = new Map(rows.map((p) => [p.row.path, p]));
  const byHash = new Map(rows.filter((p) => p.row.hash).map((p) => [p.row.hash, p]));
  const seen = new Set<string>();
  const out: LibraryRow[] = [];
  for (const item of list.items) {
    const p = byPath.get(item.path) ?? (item.hash ? byHash.get(item.hash) : undefined);
    if (!p || seen.has(p.row.key)) continue;
    seen.add(p.row.key);
    out.push(p.row);
  }
  return out;
}
