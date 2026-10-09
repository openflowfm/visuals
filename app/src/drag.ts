import { useSyncExternalStore } from 'react';
import * as pl from './playlists.ts';

/**
 * Dragging inside the page: a library tile onto a playlist, a playlist's preset
 * to a new place in it. Done with pointer events rather than HTML drag and drop,
 * which the app's own file drop (Tauri's, for adding presets from Finder)
 * intercepts at the window.
 *
 * A drag starts on a press and only becomes one once the pointer has moved
 * `THRESHOLD` px, so a click stays a click. Drop targets are elements with a
 * `data-drop` attribute; its value says what the target is (`list:<id>`,
 * `item:<id>:<index>`), and the one who started the drag decides what a drop
 * there does.
 */

/** What is being dragged. */
export type Payload =
  /** A preset from the library. */
  | { kind: 'preset'; path: string; name: string; thumbnail: string | null }
  /** A playlist's item, from its place in the list. */
  | { kind: 'item'; list: string; index: number; path: string; name: string; thumbnail: string | null };

/**
 * What a drop of `payload` on `target` does to the playlists, or null when the
 * target doesn't take it. `list:<id>` adds to the end of a playlist;
 * `item:<id>:<index>` puts the preset at that place, which for one of the same
 * playlist's own items is a move. Smart playlists pick their own presets, and
 * take none.
 */
export type DropAction = { kind: 'add'; list: string; path: string; at: number | null } | { kind: 'move'; list: string; from: number; to: number };

export function dropAction(payload: Payload, target: string, playlists: readonly { id: string; kind: 'manual' | 'smart'; items: readonly unknown[] }[]): DropAction | null {
  const [what, id, index] = target.split(':');
  const list = playlists.find((p) => p.id === id);
  if (!list || list.kind !== 'manual') return null;
  if (what === 'list') {
    if (payload.kind === 'item' && payload.list === id) return null;
    return { kind: 'add', list: id, path: payload.path, at: null };
  }
  if (what !== 'item') return null;
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at > list.items.length) return null;
  if (payload.kind === 'item' && payload.list === id) {
    const to = Math.min(at, list.items.length - 1);
    return to === payload.index ? null : { kind: 'move', list: id, from: payload.index, to };
  }
  return { kind: 'add', list: id, path: payload.path, at };
}

/** Make the change a drop asks for; resolves to the playlists after it. */
export const runDrop = (a: DropAction): Promise<pl.Lists> => (a.kind === 'add' ? pl.add(a.list, a.path, a.at) : pl.moveItem(a.list, a.from, a.to));

/** Where an item goes when Alt+arrow moves it `by` places, or null at an end. */
export function nudge(index: number, by: number, length: number): number | null {
  const to = index + by;
  return to < 0 || to >= length || by === 0 ? null : to;
}

/** The drop target for a playlist as a whole. */
export const listTarget = (id: string) => `list:${id}`;
/** The drop target for a place in a playlist. */
export const itemTarget = (id: string, index: number) => `item:${id}:${index}`;

/** A drag under way: what, where the pointer is, and the target under it that would take it (null for none). */
export interface Drag {
  payload: Payload;
  x: number;
  y: number;
  target: string | null;
}

/** How far the pointer moves, in px, before a press becomes a drag. */
export const THRESHOLD = 5;

/** Whether the pointer has gone far enough from where it was pressed to be dragging. */
export const movedEnough = (from: { x: number; y: number }, to: { x: number; y: number }): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= THRESHOLD;

export interface DragHandlers {
  /** Whether `target` takes this drag; one that doesn't isn't highlighted and gets no drop. */
  accepts(target: string, payload: Payload): boolean;
  /** Dropped on a target that takes it. */
  onDrop(target: string, payload: Payload): void;
}

/**
 * The drag going on, if any: one at a time in the page. `hit` names the drop
 * target at a point (the page's elements in the app; a fixture in tests).
 */
export class DragStore {
  private drag: Drag | null = null;
  private listeners = new Set<() => void>();
  private pending: { from: { x: number; y: number }; payload: Payload; handlers: DragHandlers } | null = null;
  private handlers: DragHandlers | null = null;

  constructor(private hit: (x: number, y: number) => string | null) {}

  get = (): Drag | null => this.drag;

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  private set(drag: Drag | null) {
    this.drag = drag;
    for (const f of this.listeners) f();
  }

  private targetAt(x: number, y: number, payload: Payload, handlers: DragHandlers): string | null {
    const t = this.hit(x, y);
    return t !== null && handlers.accepts(t, payload) ? t : null;
  }

  /** A press that may become a drag of `payload`. */
  press(x: number, y: number, payload: Payload, handlers: DragHandlers) {
    this.pending = { from: { x, y }, payload, handlers };
  }

  /** The pointer moved; true when a drag is (now) under way. */
  move(x: number, y: number): boolean {
    if (this.pending && !this.drag) {
      if (!movedEnough(this.pending.from, { x, y })) return false;
      this.handlers = this.pending.handlers;
    }
    const payload = this.drag?.payload ?? this.pending?.payload;
    if (!payload || !this.handlers) return false;
    this.set({ payload, x, y, target: this.targetAt(x, y, payload, this.handlers) });
    return true;
  }

  /** The pointer let go; true when it ended a drag (so the click that follows is not a click). */
  release(x: number, y: number): boolean {
    this.pending = null;
    const drag = this.drag;
    const handlers = this.handlers;
    this.handlers = null;
    if (!drag || !handlers) return false;
    this.set(null);
    const target = this.targetAt(x, y, drag.payload, handlers);
    if (target !== null) handlers.onDrop(target, drag.payload);
    return true;
  }

  /** Escape, or the pointer lost: no drop. */
  cancel() {
    this.pending = null;
    this.handlers = null;
    if (this.drag) this.set(null);
  }
}

/** The drop target at a point in the page: the nearest `data-drop` element's value. */
function pageHit(x: number, y: number): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  return el?.dataset.drop ?? null;
}

/** The page's one drag. */
export const drags = new DragStore(pageHit);

/**
 * Start a possible drag of `payload` from a primary-button press. It follows the
 * pointer on the window until it lets go; a drag that happened swallows the click
 * the release would otherwise make.
 */
export function beginDrag(ev: { button: number; clientX: number; clientY: number }, payload: Payload, handlers: DragHandlers) {
  if (ev.button !== 0 || typeof window === 'undefined') return;
  drags.press(ev.clientX, ev.clientY, payload, handlers);
  const move = (e: PointerEvent) => {
    if (drags.move(e.clientX, e.clientY)) {
      e.preventDefault();
      document.body.dataset.dragging = '';
    }
  };
  const done = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    delete document.body.dataset.dragging;
  };
  const up = (e: PointerEvent) => {
    done();
    if (drags.release(e.clientX, e.clientY)) {
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      // A release off the element makes no click; don't let the swallow linger to eat the next one.
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };
  const cancel = () => {
    done();
    drags.cancel();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !drags.get()) return;
    e.stopPropagation();
    e.preventDefault();
    cancel();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/** The drag under way, re-rendering as it moves; null when there is none. */
export const useDrag = (): Drag | null => useSyncExternalStore(drags.subscribe, drags.get, () => null);

/** Whether `target` is where the drag under way would drop: for a target's highlight. */
export const isOver = (drag: Drag | null, target: string): boolean => drag?.target === target;
