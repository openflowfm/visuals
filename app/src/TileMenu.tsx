import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryChange } from './api.ts';
import type { Prepared } from './librarySearch.ts';
import { flipFor, pressedFor } from './PresetDrawer.tsx';
import * as pl from './playlists.ts';
import type { Lists, Playlist } from './playlists.ts';
import { Icon } from './layout/icons.tsx';
import { say, Say } from './words.ts';
import './popover.css';
import './tile-menu.css';

/**
 * A tile's context menu on the home (right-click or ⌃-click on a tile, or the
 * context-menu key or ⇧F10 on the focused one): the inspector's header actions
 * in its order — Play, Star, Add to playlist, then Never set apart — acting on
 * the tile, or on every tile picked when it is one of several picked. In a
 * playlist's grid it ends with "Remove from" the playlist.
 *
 * What the actions do is the inspector's: Home hands the same handlers it hands
 * the inspector (`onSet`, `onAddTo`) through `TileMenuContext`, and the toggles
 * flip as the inspector's do (`flipFor`, `pressedFor`: on for all unless every
 * one has it). The panel is the app's popover panel (popover.css) as a menu,
 * hung at the pointer instead of under a button.
 */

/** What the menu's actions do: the inspector's own handlers, from Home. */
export interface TileMenuActions {
  /** The playlists, for "Add to playlist"; null until read. */
  playlists: readonly Playlist[] | null;
  /** Star or never-play these presets (by index key), as the inspector's toggles do. */
  onSet(keys: string[], change: LibraryChange): void;
  /** Add these presets (by path) to the playlist `id`, as the inspector's "Playlist" menu does. */
  onAddTo(id: string, paths: string[]): void;
}

/** Home's handlers for the tiles' menus; none (the lab editor's column) means no menu. */
export const TileMenuContext = createContext<TileMenuActions | null>(null);
export const useTileMenuActions = (): TileMenuActions | null => useContext(TileMenuContext);

/** The keys that open a focused tile's menu: the context-menu key, or ⇧F10. */
export const opensMenu = (e: { key: string; shiftKey: boolean }): boolean => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

/** Where the menu hangs, in the window's pixels. */
export interface MenuAt {
  x: number;
  y: number;
}

/** Where a menu opened from the keyboard hangs: just inside the tile's top left. */
export function menuAtElement(el: Element | null): MenuAt {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(24, r.height / 2) } : { x: 0, y: 0 };
}

/**
 * What a menu opened on the tile `key` acts on: every one picked, in the
 * grid's order, when it is one of several picked; otherwise it alone (the
 * picks are left as they are).
 */
export function menuChosen<T>(key: string, picked: ReadonlySet<string>, all: readonly T[], keyOf: (t: T) => string): T[] {
  if (picked.size > 1 && picked.has(key)) return all.filter((t) => picked.has(keyOf(t)));
  const one = all.find((t) => keyOf(t) === key);
  return one === undefined ? [] : [one];
}

/** Take the places `indexes` out of the playlist `id`, the last first, so each place still names its preset; the playlists after the last. */
export function removeItems(id: string, indexes: readonly number[]): Promise<Lists | void> {
  const order = [...new Set(indexes)].sort((a, b) => b - a);
  return order.reduce<Promise<Lists | void>>((was, at) => was.then(() => pl.removeItem(id, at)), Promise.resolve());
}

/**
 * A ⌃-click opens the menu, and on some engines then clicks too, which would
 * pick the tile as a ⌘-click does: the grid asks `justOpened` before such a
 * pick and drops it.
 */
export function useMenuGuard() {
  const at = useRef(0);
  return {
    opened: () => void (at.current = Date.now()),
    justOpened: () => Date.now() - at.current < 500,
  };
}

export interface TileMenuProps {
  at: MenuAt;
  /** The presets it acts on; none (a tile gone from the library) leaves Star and Never disabled. */
  chosen: readonly Prepared[];
  actions: TileMenuActions;
  /** Play the tile; left out with several chosen, when Play shows disabled. */
  onPlay?: () => void;
  /** In a playlist's grid: take the chosen tiles out of the playlist named `name`. */
  remove?: { name: string; onRemove(): void };
  /** The menu closes: a choice made, Esc, Tab, or a press outside. */
  onClose(): void;
  /** Where the menu goes in the page: the home's root, so it takes the home's look; the body by default. */
  container?: Element | null;
}

const them = (n: number) => (n > 1 ? 'them' : 'it');
const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** The menu itself: a fixed panel at `at`, kept inside the window, its first action focused. */
export function TileMenu({ at, chosen, actions, onPlay, remove, onClose, container }: TileMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  const [adding, setAdding] = useState(false);
  // Where focus was before, to go back to once the menu closes.
  const back = useRef<Element | null>(null);
  const keys = chosen.map((p) => p.row.key);
  const paths = chosen.map((p) => p.row.path);
  const n = chosen.length;
  const star = flipFor(chosen, (p) => p.star);
  const hide = flipFor(chosen, (p) => p.hidden);
  const manuals = (actions.playlists ?? []).filter((l) => l.kind === 'manual');

  const close = () => {
    onClose();
    const to = back.current;
    if (to instanceof HTMLElement && to.isConnected) to.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Kept inside the window: flipped to the pointer's left, or above it, where it would run past an edge.
  useLayoutEffect(() => {
    const r = panel.current?.getBoundingClientRect();
    if (!r) return;
    const x = at.x + r.width > window.innerWidth - 8 ? Math.max(8, at.x - r.width) : at.x;
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y;
    setPlace({ x, y });
  }, [at.x, at.y, adding]);

  useLayoutEffect(() => {
    back.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, []);

  useEffect(() => {
    const press = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const away = () => onClose();
    window.addEventListener('pointerdown', press, { capture: true });
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('pointerdown', press, { capture: true });
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
    };
  }, [onClose]);

  const move = (by: number | 'first' | 'last') => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = by === 'first' ? 0 : by === 'last' ? items.length - 1 : (at + by + items.length) % items.length;
    items[to].focus();
  };
  const addButton = useRef<HTMLButtonElement>(null);
  const openAdding = () => {
    setAdding(true);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`.tile-menu-sub ${ITEMS}`)?.focus());
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const inSub = !!(e.target as Element).closest('.tile-menu-sub');
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') move('first');
    else if (e.key === 'End') move('last');
    else if (e.key === 'ArrowRight' && e.target === addButton.current && !adding) openAdding();
    else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && inSub) {
      setAdding(false);
      addButton.current?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const choose = (act: () => void) => () => {
    act();
    close();
  };

  return createPortal(
    <div
      ref={panel}
      className="vf-pop-panel tile-menu"
      role="menu"
      aria-label={n > 1 ? `${n} presets` : (chosen[0]?.title ?? 'preset')}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKey}
      // Its events bubble through React to the grid it was opened from: a right-click on it opens nothing more.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button type="button" role="menuitem" disabled={!onPlay} title={onPlay ? 'Play it now' : 'Pick one preset to play it'} onClick={onPlay && choose(onPlay)}>
        <Icon name="play" />
        Play
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={pressedFor(chosen, (p) => p.star)}
        disabled={!n}
        title={star ? `Star ${them(n)}` : 'Take the star off'}
        onClick={choose(() => actions.onSet(keys, { star }))}
      >
        <Icon name="star" />
        {star ? 'Star' : 'Take the star off'}
      </button>
      <button
        ref={addButton}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={adding}
        disabled={!n}
        title={`Add ${them(n)} to a playlist`}
        onClick={() => (adding ? setAdding(false) : openAdding())}
      >
        <Icon name="plus" />
        Add to playlist
        <Icon name="chevron-right" size={12} className="tile-menu-more" />
      </button>
      {adding && (
        <div className="tile-menu-sub" role="menu" aria-label="add to a playlist">
          {manuals.length ? (
            manuals.map((l) => (
              <button key={l.id} type="button" role="menuitem" onClick={choose(() => actions.onAddTo(l.id, paths))}>
                {l.name}
              </button>
            ))
          ) : (
            <button type="button" role="menuitem" disabled>
              No playlists yet: + in the sidebar makes one
            </button>
          )}
        </div>
      )}
      <div className="tile-menu-rule" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={pressedFor(chosen, (p) => p.hidden)}
        disabled={!n}
        title={hide ? `Never play ${them(n)}: random, shuffle and ${say('auto-advance')} skip ${them(n)}. A playlist you made still plays ${them(n)}.` : `Play ${them(n)} again`}
        onClick={choose(() => actions.onSet(keys, { hidden: hide }))}
      >
        <Icon name="never" />
        {hide ? Say('hidden') : `Play ${them(n)} again`}
      </button>
      {remove && (
        <>
          <div className="tile-menu-rule" role="separator" />
          <button type="button" role="menuitem" data-danger="" onClick={choose(remove.onRemove)}>
            <Icon name="close" />
            Remove from {remove.name}
          </button>
        </>
      )}
    </div>,
    container ?? document.body,
  );
}
