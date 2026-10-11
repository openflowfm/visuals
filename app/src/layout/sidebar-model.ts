import type { Lists, Playlist } from '../playlists.ts';
import { recentList, sections, type Pane } from '../home.ts';
import { isOver, listTarget, type Drag } from '../drag.ts';
import { say, Say } from '../words.ts';
import { offersQuickAdd } from './home-model.ts';
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

/** Whether a playlist can be played or stopped from its row: one playing can always stop; an empty manual one has nothing to play. */
export const canToggle = (p: Playlist, playing: boolean): boolean => playing || p.kind !== 'manual' || p.items.length > 0;

/** What a row's play (or stop) button and menu item say on hover. */
export const toggleTitle = (p: Playlist, playing: boolean): string => (playing ? `Stop ${p.name}` : canToggle(p, playing) ? `Play ${p.name}` : 'Add presets to play it');

/** One item in a row's menu. */
export type MenuAction = 'play' | 'stop' | 'quickadd' | 'info' | 'rename' | 'export' | 'delete';
export interface MenuItem {
  action: MenuAction;
  label: string;
  title: string;
  disabled?: boolean;
  /** Undoes nothing: drawn in red. */
  danger?: boolean;
}

/**
 * A row's menu: play (or stop), quick add (a manual playlist's), show info
 * (when `info`: the page shows a playlist's card in the inspector), rename,
 * save to a file, and delete (which asks first), for a playlist; nothing for
 * the library and starred, which are not playlists. "Recently played" is the
 * app's own: it plays, shows its info and saves, but keeps its name and can't
 * be deleted.
 */
export function rowMenu(p: Playlist | null | undefined, playing: boolean, lists: Lists | null | undefined, opts: { info?: boolean } = {}): MenuItem[] {
  if (!p) return [];
  const items: MenuItem[] = [
    playing ? { action: 'stop', label: 'Stop', title: toggleTitle(p, true) } : { action: 'play', label: 'Play', title: toggleTitle(p, false), disabled: !canToggle(p, false) },
  ];
  if (offersQuickAdd(p)) items.push({ action: 'quickadd', label: Say('quickadd'), title: `Add presets to ${p.name} with a click on each in the library` });
  if (opts.info) items.push({ action: 'info', label: Say('show inspector'), title: `Show ${p.name}'s card in the ${say('inspector')} pane` });
  const own = recentList(lists?.playlists ?? []) === p;
  if (!own) items.push({ action: 'rename', label: 'Rename', title: `Give ${p.name} another name` });
  items.push({ action: 'export', label: 'Save to a file', title: 'Save to a file, to keep or to give someone: its presets by name and content' });
  if (!own) items.push({ action: 'delete', label: 'Delete…', title: 'Delete the playlist (asks first)', danger: true });
  return items;
}

/** A playlist row as a drop target while a preset is dragged: a manual playlist takes it (`drop`, lit when `over`); a smart one fills itself, so it refuses (faded) while anything is dragged. */
export function dropState(p: Playlist | null | undefined, drag: Drag | null): { drop?: string; over: boolean; refuses: boolean } {
  if (!p) return { over: false, refuses: false };
  if (p.kind === 'smart') return { over: false, refuses: !!drag };
  const drop = listTarget(p.id);
  return { drop, over: isOver(drag, drop), refuses: false };
}

/** The name a rename box gives, or null when it gives none: blank, or the name it had. */
export function renamed(before: string, typed: string): string | null {
  const name = typed.trim();
  return name && name !== before ? name : null;
}

/** Where focus goes in a menu on a key: the next or previous item that can be chosen (wrapping), the first or the last; null for any other key or no such item. */
export function menuStep(disabled: readonly boolean[], at: number, key: string): number | null {
  const open = disabled.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
  if (!open.length) return null;
  if (key === 'Home') return open[0];
  if (key === 'End') return open[open.length - 1];
  if (key === 'ArrowDown') return open.find((i) => i > at) ?? open[0];
  if (key === 'ArrowUp') return [...open].reverse().find((i) => i < at) ?? open[open.length - 1];
  return null;
}

/** Where a menu `size` big opens at `at`, kept `margin` px inside a window `view` big: flipped to the left of (or above) the point when it would run past the right (or bottom) edge. */
export function menuAt(at: { x: number; y: number }, size: { w: number; h: number }, view: { w: number; h: number }, margin = 8): { x: number; y: number } {
  let x = at.x + size.w > view.w - margin ? at.x - size.w : at.x;
  let y = at.y + size.h > view.h - margin ? at.y - size.h : at.y;
  x = Math.max(margin, Math.min(x, view.w - margin - size.w));
  y = Math.max(margin, Math.min(y, view.h - margin - size.h));
  return { x, y };
}
