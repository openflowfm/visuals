/**
 * The home's shape as the inspector view lays it out (contract-owned, so the
 * shell, the sidebar, the inspector and Home's wiring share it): which panes
 * show at a window's width, what is picked, what the sidebar can do, and the
 * words a playlist's row and a pane's title say.
 */
import { plural } from '../controls.ts';
import type { Pane } from '../home.ts';
import { queryName } from '../librarySearch.ts';
import type { Lists, Playlist } from '../playlists.ts';

/** The sidebar: in the window beside the main column, put away, or laid over the main column (opened in a narrow window). */
export type SidebarMode = 'docked' | 'hidden' | 'overlay';

/** The inspector: in the window beside the main column, laid over it (a narrow window), or closed (null). */
export type InspectorMode = 'docked' | 'overlay' | null;

/** What the inspector is about: the source playing, or presets picked in the grid (by index key). */
export type Selection = { kind: 'source' } | { kind: 'presets'; keys: string[] };

/** What the sidebar's rows and their menus can do; Home makes these from the playlists' commands. */
export interface SidebarActions {
  /** Play a playlist, by id. */
  onPlay(id: string): void;
  /** Stop the playlist playing. */
  onStop(): void;
  /** Make a new playlist. */
  onCreate(): void;
  /** Add the playlist in a file's text. */
  onImport(text: string): void;
  onRename(id: string, name: string): void;
  /** Save a playlist to a file. */
  onExport(id: string): void;
  onDelete(id: string): void;
  /** How many presets a playlist holds (manual: items; smart: its matches); null while unknown. */
  count(p: Playlist): number | null;
  /** Something failed: `what` it was doing, then the error, as the home says it. */
  onError(what: string): (e: unknown) => void;
}

/** What the viewer chose, kept between runs: whether they showed (true) or hid (false) the sidebar, and opened or closed the inspector; null: never chose. */
export interface LayoutPrefs {
  sidebar: boolean | null;
  inspector: boolean | null;
}

/** The narrowest window the sidebar docks in, and the inspector. */
export const SIDEBAR_AT = 900;
export const INSPECTOR_AT = 1200;

/** The browser storage keys for the sidebar shown or hidden, and the inspector open or closed. */
export const SIDEBAR_KEY = 'visuals.home.sidebar';
export const INSPECTOR_KEY = 'visuals.home.inspector';

/**
 * Which panes show in a window `width` px wide: the sidebar docks from
 * `SIDEBAR_AT` unless the viewer hid it, and under it is hidden unless they
 * opened it (laid over the main column then); the inspector, when open, docks
 * from `INSPECTOR_AT` and is laid over below it, and is open by default only
 * where it docks.
 */
export function modesFor(width: number, prefs: LayoutPrefs): { sidebar: SidebarMode; inspector: InspectorMode } {
  const sidebar: SidebarMode = width >= SIDEBAR_AT ? (prefs.sidebar === false ? 'hidden' : 'docked') : prefs.sidebar === true ? 'overlay' : 'hidden';
  const wide = width >= INSPECTOR_AT;
  const open = prefs.inspector ?? wide;
  return { sidebar, inspector: open ? (wide ? 'docked' : 'overlay') : null };
}

/** What a playlist's row says to a screen reader: its name, what kind it is, how many presets (a manual one), and whether it plays. */
export function rowSays(p: Playlist, playing: boolean): string {
  const what = p.kind === 'smart' ? `smart playlist, fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `playlist, ${plural(p.items.length, 'preset')}`;
  return `${p.name}, ${what}${playing ? ', playing' : ''}`;
}

/** The name a pane goes by: "Library", "Starred", or the playlist's name ("Recently played" for that one). */
export function paneName(pane: Pane | null, lists: Lists | null): string {
  if (!pane || pane.kind === 'library') return 'Library';
  if (pane.kind === 'starred') return 'Starred';
  return lists?.playlists.find((p) => p.id === pane.id)?.name ?? 'Library';
}
