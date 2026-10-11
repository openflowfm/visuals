import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { Pane } from '../home.ts';
import type { Lists, Playlist } from '../playlists.ts';
import { plural } from '../controls.ts';
import { useDrag } from '../drag.ts';
import { queryName } from '../librarySearch.ts';
import { Mark } from '../views.tsx';
import { say } from '../words.ts';
import { rowSays, type SidebarActions } from './home-model.ts';
import { Icon } from './icons.tsx';
import { canToggle, dropState, menuAt, menuStep, paneKey, renamed, rowMenu, samePane, toggleTitle, type MenuAction, type MenuItem, type SidebarRow, type SidebarSection } from './sidebar-model.ts';
// The menu's glass and items are the popovers' (`.vf-pop-panel`).
import '../popover.css';
import './inset-sidebar.css';

export { paneKey, samePane, sidebarSections, type SidebarRow, type SidebarSection } from './sidebar-model.ts';

/**
 * The home's sidebar (HomeLayout's `sidebar` slot, inside its `nav`): the
 * visual[flow] mark at its top, just under the window buttons' band; then
 * collapsible sections ("Library", "Playlists", "Smart playlists"), each a
 * quiet heading with a chevron over its rows; a row an icon, a name, a count
 * and, for the playlist playing, the green dot after its name. The row picked
 * is a soft pill in --fg.
 *
 * A playlist's row also plays: its icon turns into a play (or stop) button on
 * hover, a double-click plays or stops it, and it is a place to drop a preset
 * (a smart one refuses, faded, while one is dragged). Its menu, drawn by the
 * page (decision D11), opens on a right-click, ⇧F10 (or the menu key) and the
 * "…" that shows on hover: play or stop, quick add (a manual playlist's), show
 * info (the playlist's card in the inspector), rename (in place), save to a
 * file, delete (asking first). The playlists' heading has + (a new playlist)
 * and ⤓ (add one from a file). At the foot, pinned under the rows, a quiet
 * Settings row (⚙) opens Settings.
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
  /** The app's playlists: a playlist's row then says what it is (`rowSays`), and plays, takes drops and has its menu. */
  lists?: Lists | null;
  /** What the rows, their menus and the playlists' heading do; without it the sidebar only picks and folds. */
  actions?: SidebarActions;
}

/** A heading's key and a row's, for the keyboard's walk. */
const headKey = (id: string) => `head:${id}`;
const rowKey = (r: SidebarRow) => `row:${paneKey(r.pane)}`;

/** The playlist a row opens, when it opens one. */
const listOf = (r: SidebarRow, lists: Lists | null | undefined): Playlist | undefined =>
  r.pane.kind === 'list' ? lists?.playlists.find((p) => r.pane.kind === 'list' && p.id === r.pane.id) : undefined;

/** What a row says to a screen reader: a playlist's as `rowSays` has it, the library's and starred's their name. */
function rowLabel(r: SidebarRow, p: Playlist | undefined): string | undefined {
  if (r.pane.kind !== 'list') return undefined;
  if (p) return rowSays(p, !!r.playing);
  // Without the playlists: what the row itself knows.
  const what = r.icon === 'smart-playlist' ? 'smart playlist' : r.count === null || r.count === undefined ? 'playlist' : `playlist, ${plural(r.count, 'preset')}`;
  return `${r.name}, ${what}${r.playing ? ', playing' : ''}`;
}

/** What a row says on hover. */
function rowTitle(r: SidebarRow, p: Playlist | undefined): string {
  if (r.pane.kind === 'library') return 'Every preset: search, filter, and drag them onto a playlist';
  if (r.pane.kind === 'starred') return 'The presets you starred';
  if (!p) return r.name;
  return p.kind === 'smart' ? `${p.name}: fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `${p.name}: drop presets here to add them`;
}

/** What an empty section says. */
const emptySays = (id: string) => (id === 'smart' ? `Filter the library, then ${say('save query')}.` : id === 'playlists' ? 'None yet: + makes one.' : 'None yet.');

/** A row's menu open: whose, where, and what opened it (focus goes back there when it closes). */
interface OpenMenu {
  key: string;
  list: Playlist;
  playing: boolean;
  x: number;
  y: number;
  opener: HTMLElement | null;
}

/** The sections and their rows. */
export function InsetSidebar({ sections, selected, onSelect, collapsed, onToggle, lists, actions }: InsetSidebarProps) {
  const uid = useId();
  const items = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // A row to focus once it is drawn again (after a rename).
  const refocus = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const drag = useDrag();

  useEffect(() => {
    if (refocus.current && items.current.has(refocus.current)) {
      items.current.get(refocus.current)?.focus();
      refocus.current = null;
    }
  });

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
    // Arrows, Home and End with a modifier belong to the system (text moves, window switches): pass them through.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
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
    } else if (e.key === 'ArrowRight') {
      if (!here.row && !open) onToggle(here.section.id);
      else if (!here.row && here.section.rows[0]) to = rowKey(here.section.rows[0]);
    } else return;
    // The walk's keys are the sidebar's: the home's window keys (← → step presets) never see them.
    e.preventDefault();
    e.stopPropagation();
    focus(to);
  };

  const toggle = (p: Playlist, playing: boolean) => {
    if (!actions || !canToggle(p, playing)) return;
    if (playing) actions.onStop();
    else actions.onPlay(p.id);
  };

  const openMenu = (r: SidebarRow, p: Playlist, x: number, y: number, opener: HTMLElement | null) => {
    if (!actions) return;
    setMenu({ key: rowKey(r), list: p, playing: !!r.playing, x, y, opener });
  };

  const closeMenu = (refocusOpener: boolean) => {
    const was = menu;
    setMenu(null);
    if (refocusOpener && was?.opener?.isConnected) was.opener.focus();
  };

  // Whether a menu's playlist is playing now (the deck may have moved on since the menu opened).
  const playingNow = (m: OpenMenu) => (lists ? lists.deck.playlist === m.list.id : m.playing);

  const choose = (action: MenuAction) => {
    if (!menu || !actions) return;
    const p = menu.list;
    if (action === 'rename') {
      setMenu(null);
      setRenaming(p.id);
      return;
    }
    if (action === 'delete') {
      // Focus goes to the next row in the section, else the one before, else its heading.
      const at = order.findIndex((o) => o.key === menu.key);
      const here = order[at];
      const near = [order[at + 1], order[at - 1]].find((o) => o?.row && o.section === here?.section);
      setMenu(null);
      const to = near?.key ?? (here ? headKey(here.section.id) : undefined);
      if (to) {
        refocus.current = to;
        setActive(to);
        items.current.get(to)?.focus();
      }
      actions.onDelete(p.id);
      return;
    }
    closeMenu(true);
    if (action === 'play' || action === 'stop') toggle(p, playingNow(menu));
    else if (action === 'quickadd') actions.onQuickAdd(p.id);
    else if (action === 'info') actions.onInfo?.(p.id);
    else if (action === 'export') actions.onExport(p.id);
  };

  const finishRename = (r: SidebarRow, p: Playlist, typed: string | null, back: boolean) => {
    setRenaming(null);
    if (back) refocus.current = rowKey(r);
    const name = typed === null ? null : renamed(p.name, typed);
    if (name && actions) actions.onRename(p.id, name);
  };

  return (
    // The webview's own menu (Reload, Inspect…) never opens over the sidebar: a row's is the page's.
    <div
      className="isb"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // But for the rename box, which keeps its own (cut, copy, paste).
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {/* The mark, the sidebar's first item, just under the window buttons' band (HomeLayout's, which stays the drag region). */}
      <div className="isb-mark">
        <Mark />
      </div>
      <div className="isb-sections">
        {sections.map((s) => {
          const open = !collapsed.includes(s.id);
          const body = `${uid}-isb-${s.id}`;
          return (
            <div key={s.id} className="isb-section">
              <div className="isb-headrow">
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
                {/* Beside the heading, not in it: a heading's name is just its title. */}
                {s.id === 'playlists' && actions && (
                  <span className="isb-tools">
                    <button type="button" className="isb-tool" aria-label="new playlist" title="Make a new, empty playlist" onClick={() => actions.onCreate()}>
                      <Icon name="plus" size={14} />
                    </button>
                    <button type="button" className="isb-tool" aria-label="add from a file" title="Add from a file: a playlist someone saved" onClick={() => file.current?.click()}>
                      <Icon name="import" size={14} />
                    </button>
                    <input
                      ref={file}
                      type="file"
                      accept=".json,application/json"
                      hidden
                      data-testid="isb-import"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) f.text().then((text) => actions.onImport(text), actions.onError('read that file'));
                      }}
                    />
                  </span>
                )}
              </div>
              <ul id={body} className="isb-rows" hidden={!open}>
                {s.rows.map((r) => {
                  const picked = samePane(r.pane, selected);
                  const p = listOf(r, lists);
                  const playing = !!r.playing;
                  const live = !!(p && actions);
                  const drop = dropState(live ? p : null, drag);
                  const count = p && actions ? actions.count(p) : r.count;
                  const key = rowKey(r);
                  const menuOpen = menu?.key === key;
                  const onContextMenu = (e: ReactMouseEvent) => {
                    if (e.target instanceof HTMLInputElement) return;
                    e.preventDefault();
                    if (p) openMenu(r, p, e.clientX, e.clientY, items.current.get(key) ?? null);
                  };
                  return (
                    <li
                      key={paneKey(r.pane)}
                      className="isb-item"
                      data-live={live ? '' : undefined}
                      data-menu={menuOpen ? '' : undefined}
                      // Set here, on the row's whole box, so whatever part of it the pointer is over (the play button, the "…") finds the target.
                      data-drop={drop.drop}
                      data-over={drop.over ? '' : undefined}
                      data-refuses={drop.refuses ? '' : undefined}
                      onContextMenu={onContextMenu}
                    >
                      {live && p && renaming === p.id ? (
                        <div className="isb-row" data-renaming="">
                          <Icon className="isb-icon" name={r.icon} />
                          <RenameBox name={p.name} onDone={(typed, back) => finishRename(r, p, typed, back)} />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="isb-row"
                          aria-label={rowLabel(r, p)}
                          aria-current={picked ? 'true' : undefined}
                          aria-haspopup={live ? 'menu' : undefined}
                          data-playing={playing ? '' : undefined}
                          title={rowTitle(r, p)}
                          onClick={() => onSelect(r.pane)}
                          onDoubleClick={() => p && toggle(p, playing)}
                          onKeyDown={(e) => {
                            if (!p || !live) return;
                            if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                              e.preventDefault();
                              e.stopPropagation();
                              const box = e.currentTarget.getBoundingClientRect();
                              openMenu(r, p, box.left + 24, box.bottom, e.currentTarget);
                            }
                          }}
                          {...bind(key)}
                        >
                          <Icon className="isb-icon" name={r.icon} />
                          <span className="isb-name">{r.name}</span>
                          {/* The playlist playing: a small green dot after its name. */}
                          {playing && <span className="isb-dot" aria-hidden="true" />}
                          {count !== null && count !== undefined && (
                            <i className="isb-count" aria-hidden="true">
                              {count.toLocaleString('en-US')}
                            </i>
                          )}
                        </button>
                      )}
                      {live && p && renaming !== p.id && (
                        <>
                          {/* Over the icon on hover: play or stop. The keyboard plays from the menu (⇧F10), so this is no tab stop. */}
                          <button
                            type="button"
                            className="isb-play"
                            tabIndex={-1}
                            aria-label={playing ? `Stop ${p.name}` : `Play ${p.name}`}
                            title={toggleTitle(p, playing)}
                            disabled={!canToggle(p, playing)}
                            onClick={() => toggle(p, playing)}
                          >
                            <Icon name={playing ? 'stop' : 'play'} size={12} />
                          </button>
                          {/* The row's menu, from the pointer; over the count on hover. */}
                          <button
                            type="button"
                            className="isb-more"
                            tabIndex={-1}
                            aria-label={`More for ${p.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            title="Play, show info, rename, save to a file or delete"
                            onClick={(e) => {
                              if (menuOpen) return closeMenu(false);
                              const box = e.currentTarget.getBoundingClientRect();
                              openMenu(r, p, box.left, box.bottom + 4, items.current.get(key) ?? e.currentTarget);
                            }}
                          >
                            <Icon name="more" size={14} />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
                {!s.rows.length && <li className="isb-empty">{emptySays(s.id)}</li>}
              </ul>
            </div>
          );
        })}
      </div>
      {/* The foot, pinned under the rows (it stays put while they scroll): a quiet Settings row. */}
      {actions?.onSettings && (
        <div className="isb-foot">
          <button type="button" className="isb-settings" title="Settings (⌘,)" onClick={() => actions.onSettings?.()}>
            <Icon className="isb-gear" name="gear" />
            <span className="isb-name">Settings</span>
          </button>
        </div>
      )}
      {menu && <RowMenu name={menu.list.name} items={rowMenu(menu.list, playingNow(menu), lists, { info: !!actions?.onInfo })} at={menu} onChoose={choose} onClose={closeMenu} />}
    </div>
  );
}

/**
 * A playlist's name being edited in its row: Enter or leaving keeps what was typed, Esc puts the old name back.
 * `back` is whether focus returns to the row: on Enter and Esc, not when focus left for somewhere else.
 */
function RenameBox({ name, onDone }: { name: string; onDone(typed: string | null, back: boolean): void }) {
  const done = useRef(false);
  const finish = (typed: string | null, back: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(typed, back);
  };
  return (
    <input
      className="isb-rename"
      aria-label={`New name for ${name}`}
      defaultValue={name}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null, true);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value, false)}
    />
  );
}

/**
 * A row's menu, drawn by the page in popover.css's glass, at a point (kept in
 * the window). Arrow keys, Home and End walk its items; Enter or Space
 * chooses; Esc or Tab closes it, putting focus back where it came from, and a
 * press outside closes it. Delete asks first, in the menu itself.
 */
function RowMenu({ name, items, at, onChoose, onClose }: { name: string; items: MenuItem[]; at: { x: number; y: number }; onChoose(a: MenuAction): void; onClose(refocus: boolean): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [place, setPlace] = useState(at);
  const shown: MenuItem[] = asking
    ? [
        { action: 'delete', label: `Delete ${name}?`, title: `Delete ${name} for good`, danger: true },
        // Keep: closes the menu (its action is not used).
        { action: 'stop', label: 'Keep', title: 'Keep the playlist' },
      ]
    : items;

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPlace(menuAt(at, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }));
  }, [at, asking]);

  // Focus the first item that can be chosen, on opening and on asking.
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
  }, [asking]);

  // A press anywhere else closes it; but for the "…" that opened it, whose click closes it.
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (panel.current?.contains(t) || t?.closest?.('.isb-item[data-menu] .isb-more')) return;
      onClose(false);
    };
    window.addEventListener('pointerdown', press, { capture: true });
    return () => window.removeEventListener('pointerdown', press, { capture: true });
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose(true);
      return;
    }
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const to = menuStep(
      buttons.map((b) => b.disabled),
      buttons.indexOf(document.activeElement as HTMLButtonElement),
      e.key,
    );
    if (to === null) return;
    e.preventDefault();
    buttons[to]?.focus();
  };

  return (
    <div ref={panel} className="vf-pop-panel isb-menu" role="menu" aria-label={name} style={{ left: place.x, top: place.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {shown.map((it) => (
        <button
          key={`${asking}-${it.action}`}
          type="button"
          role="menuitem"
          title={it.title}
          disabled={it.disabled}
          data-danger={it.danger ? '' : undefined}
          onClick={() => {
            if (asking) {
              if (it.action === 'delete') onChoose('delete');
              else onClose(true);
            } else if (it.action === 'delete') setAsking(true);
            else onChoose(it.action);
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
