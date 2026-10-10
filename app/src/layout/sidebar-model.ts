import type { Lists, Playlist } from '../playlists.ts';
import { recentList, sections, type Pane } from '../home.ts';
import type { IconName } from './icons.tsx';

/**
 * The inset sidebar's data (contract-owned, so the fixtures and the sidebar
 * lane share it without the lane's component): its sections and rows, and
 * the builder that makes them from the app's playlists.
 */

/** One row: the pane it opens, what it is called, its icon, how many presets (null: unknown, show nothing), and whether it plays. */
export interface SidebarRow {
  pane: Pane;
  name: string;
  icon: IconName;
  count?: number | null;
  playing?: boolean;
}

/** One section: an id (for its collapse state), its heading, its rows. */
export interface SidebarSection {
  id: string;
  title: string;
  rows: SidebarRow[];
}

/** Whether a row opens the pane picked. */
export const samePane = (a: Pane, b: Pane | null): boolean => !!b && a.kind === b.kind && (a.kind !== 'list' || (b.kind === 'list' && a.id === b.id));

/** A row's key, for React and for tests. */
export const paneKey = (p: Pane): string => (p.kind === 'list' ? `list:${p.id}` : p.kind);

/** The sections from the app's playlists, as today's source list groups them (Sources.tsx): the library, starred and recently played; the playlists; the smart playlists. */
export function sidebarSections(lists: Lists | null, counts?: { library?: number | null; starred?: number | null }): SidebarSection[] {
  const playlists = lists?.playlists ?? [];
  const recent = recentList(playlists);
  const { manual, smart } = sections(playlists);
  const playing = lists?.deck.playlist ?? null;
  const listRow = (p: Playlist, icon: IconName): SidebarRow => ({
    pane: { kind: 'list', id: p.id },
    name: p.name,
    icon,
    count: p.kind === 'manual' ? p.items.length : null,
    playing: playing === p.id,
  });
  const library: SidebarRow[] = [
    { pane: { kind: 'library' }, name: 'Library', icon: 'library', count: counts?.library ?? null },
    { pane: { kind: 'starred' }, name: 'Starred', icon: 'star', count: counts?.starred ?? null },
  ];
  if (recent) library.push(listRow(recent, 'recent'));
  return [
    { id: 'library', title: 'Library', rows: library },
    { id: 'playlists', title: 'Playlists', rows: manual.map((p) => listRow(p, 'playlist')) },
    { id: 'smart', title: 'Smart playlists', rows: smart.filter((p) => p !== recent).map((p) => listRow(p, 'smart-playlist')) },
  ];
}
