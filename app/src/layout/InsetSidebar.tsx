import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Pane } from '../home.ts';
import type { Lists } from '../playlists.ts';
import { plural } from '../controls.ts';
import { rowSays } from '../Sources.tsx';
import { say } from '../words.ts';
import { Icon } from './icons.tsx';
import { paneKey, samePane, type SidebarRow, type SidebarSection } from './sidebar-model.ts';
import './inset-sidebar.css';

export { paneKey, samePane, sidebarSections, type SidebarRow, type SidebarSection } from './sidebar-model.ts';

/**
 * The inset sidebar's content (HomeLayout's `sidebar` slot, inside its `nav`):
 * collapsible sections ("Library", "Playlists", "Smart playlists"), each a
 * quiet heading with a chevron over its rows; a row an icon, a name, a count
 * and, for the playlist playing, the green dot after its name, as today's
 * source list (Sources.tsx) has it. The row picked is a soft pill in --fg.
 *
 * One tab stop: the arrow keys walk the headings and the rows shown, Home and
 * End jump to the first and the last, Enter or Space picks a row or folds a
 * section, and ← folds a section (from a row, goes to its heading) and →
 * unfolds it.
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
  /** The app's playlists, when there are: a playlist's row then says what today's source list says of it (`rowSays`), such as what a smart one fills itself with. */
  lists?: Lists | null;
}

/** A heading's key and a row's, for the keyboard's walk. */
const headKey = (id: string) => `head:${id}`;
const rowKey = (r: SidebarRow) => `row:${paneKey(r.pane)}`;

/** What a row says to a screen reader: a playlist's as today's source list says it, the library's and starred's their name. */
function rowLabel(r: SidebarRow, lists: Lists | null | undefined): string | undefined {
  if (r.pane.kind !== 'list') return undefined;
  const id = r.pane.id;
  const p = lists?.playlists.find((x) => x.id === id);
  if (p) return rowSays(p, !!r.playing);
  // Without the playlists: what the row itself knows.
  const what = r.icon === 'smart-playlist' ? 'smart playlist' : r.count === null || r.count === undefined ? 'playlist' : `playlist, ${plural(r.count, 'preset')}`;
  return `${r.name}, ${what}${r.playing ? ', playing' : ''}`;
}

/** What an empty section says, as today's source list does. */
const emptySays = (id: string) => (id === 'smart' ? `Filter the library, then ${say('save query')}.` : 'None yet.');

/** The sections and their rows. */
export function InsetSidebar({ sections, selected, onSelect, collapsed, onToggle, lists }: InsetSidebarProps) {
  const uid = useId();
  const items = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState<string | null>(null);

  // What the keyboard walks, in order: each heading, then its rows while it is open.
  const order: { key: string; section: SidebarSection; row?: SidebarRow }[] = [];
  for (const s of sections) {
    order.push({ key: headKey(s.id), section: s });
    if (!collapsed.includes(s.id)) for (const r of s.rows) order.push({ key: rowKey(r), section: s, row: r });
  }
  // The one tab stop: the item focused last, else the row picked, else the first heading.
  const stop = order.find((o) => o.key === active)?.key ?? order.find((o) => o.row && samePane(o.row.pane, selected))?.key ?? order[0]?.key;

  const focus = (key: string | undefined) => {
    if (!key) return;
    setActive(key);
    items.current.get(key)?.focus();
  };
  const bind = (key: string) => ({
    ref: (el: HTMLButtonElement | null) => {
      if (el) items.current.set(key, el);
      else items.current.delete(key);
    },
    tabIndex: key === stop ? 0 : -1,
    onFocus: () => setActive(key),
  });

  const onKeyDown = (e: KeyboardEvent) => {
    const at = order.findIndex((o) => items.current.get(o.key) === e.target);
    if (at < 0) return;
    const here = order[at];
    const open = !collapsed.includes(here.section.id);
    let to: string | undefined;
    if (e.key === 'ArrowDown') to = order[Math.min(at + 1, order.length - 1)].key;
    else if (e.key === 'ArrowUp') to = order[Math.max(at - 1, 0)].key;
    else if (e.key === 'Home') to = order[0].key;
    else if (e.key === 'End') to = order[order.length - 1].key;
    else if (e.key === 'ArrowLeft') {
      if (here.row) to = headKey(here.section.id);
      else if (open) onToggle(here.section.id);
      else return;
    } else if (e.key === 'ArrowRight') {
      if (!here.row && !open) onToggle(here.section.id);
      else if (!here.row && here.section.rows[0]) to = rowKey(here.section.rows[0]);
      else return;
    } else return;
    e.preventDefault();
    focus(to);
  };

  return (
    <div className="isb" onKeyDown={onKeyDown}>
      {sections.map((s) => {
        const open = !collapsed.includes(s.id);
        const body = `${uid}-isb-${s.id}`;
        return (
          <div key={s.id} className="isb-section">
            <h2 className="isb-head">
              <button
                type="button"
                className="isb-toggle"
                aria-expanded={open}
                aria-controls={body}
                title={open ? `Hide ${s.title.toLowerCase()}` : `Show ${s.title.toLowerCase()}`}
                onClick={() => onToggle(s.id)}
                {...bind(headKey(s.id))}
              >
                <span className="isb-title">{s.title}</span>
                <Icon className="isb-chevron" name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
            </h2>
            <ul id={body} className="isb-rows" hidden={!open}>
              {s.rows.map((r) => {
                const picked = samePane(r.pane, selected);
                return (
                  <li key={paneKey(r.pane)}>
                    <button
                      type="button"
                      className="isb-row"
                      aria-label={rowLabel(r, lists)}
                      aria-current={picked ? 'true' : undefined}
                      data-playing={r.playing ? '' : undefined}
                      title={r.name}
                      onClick={() => onSelect(r.pane)}
                      {...bind(rowKey(r))}
                    >
                      <Icon className="isb-icon" name={r.icon} />
                      <span className="isb-name">{r.name}</span>
                      {/* The playlist playing: a small green dot after its name. */}
                      {r.playing && <span className="isb-dot" aria-hidden="true" />}
                      {r.count !== null && r.count !== undefined && (
                        <i className="isb-count" aria-hidden="true">
                          {r.count.toLocaleString('en-US')}
                        </i>
                      )}
                    </button>
                  </li>
                );
              })}
              {!s.rows.length && <li className="isb-empty">{emptySays(s.id)}</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
