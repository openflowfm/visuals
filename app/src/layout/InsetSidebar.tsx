import { useId } from 'react';
import type { Pane } from '../home.ts';
import { Icon } from './icons.tsx';
import { paneKey, samePane, type SidebarSection } from './sidebar-model.ts';
import './inset-sidebar.css';

export { paneKey, samePane, sidebarSections, type SidebarRow, type SidebarSection } from './sidebar-model.ts';

/**
 * The inset sidebar's content (HomeLayout's `sidebar` slot, inside its `nav`):
 * collapsible sections ("Library", "Playlists", "Smart playlists"), each a
 * heading with a chevron over its rows, a row an icon and a name, the one
 * picked a soft pill. Stub: the sidebar lane draws it (rows of `--lay-row`,
 * the pill of `--lay-row-radius`), keeping these props.
 */

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

/** The sections and their rows. */
export function InsetSidebar({ sections, selected, onSelect, collapsed, onToggle }: InsetSidebarProps) {
  const uid = useId();
  return (
    <div className="isb">
      {sections.map((s) => {
        const open = !collapsed.includes(s.id);
        const body = `${uid}-isb-${s.id}`;
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
