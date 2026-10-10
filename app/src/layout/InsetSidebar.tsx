import type { Lists, Playlist } from '../playlists.ts';
import { recentList, sections, type Pane } from '../home.ts';
import { Icon, type IconName } from './icons.tsx';
import './inset-sidebar.css';

/**
 * The inset sidebar's content (HomeLayout's `sidebar` slot, inside its `nav`):
 * collapsible sections ("Library", "Playlists", "Smart playlists"), each a
 * heading with a chevron over its rows, a row an icon and a name, the one
 * picked a soft pill. Stub: the sidebar lane draws it (rows of `--lay-row`,
 * the pill of `--lay-row-radius`), keeping these props.
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

export interface InsetSidebarProps {
  sections: SidebarSection[];
  /** The pane picked, whose row is the pill. */
  selected: Pane | null;
  onSelect(pane: Pane): void;
  /** The ids of the sections folded away. */
  collapsed: readonly string[];
  /** Fold or unfold a section. */
  onToggle(id: string): void;
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

/** The sections and their rows. */
export function InsetSidebar({ sections, selected, onSelect, collapsed, onToggle }: InsetSidebarProps) {
  return (
    <div className="isb">
      {sections.map((s) => {
        const open = !collapsed.includes(s.id);
        const body = `isb-${s.id}`;
        return (
          <div key={s.id} className="isb-section">
            <h2 className="isb-head">
              <button type="button" className="isb-toggle" aria-expanded={open} aria-controls={body} onClick={() => onToggle(s.id)}>
                <span className="isb-title">{s.title}</span>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
            </h2>
            <ul id={body} className="isb-rows" hidden={!open}>
              {s.rows.map((r) => {
                const picked = samePane(r.pane, selected);
                return (
                  <li key={paneKey(r.pane)}>
                    <button type="button" className="isb-row" aria-current={picked ? 'true' : undefined} data-playing={r.playing ? '' : undefined} onClick={() => onSelect(r.pane)}>
                      <Icon name={r.icon} />
                      <span className="isb-name">{r.name}</span>
                      {r.count !== null && r.count !== undefined && <i className="isb-count">{r.count.toLocaleString('en-US')}</i>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
