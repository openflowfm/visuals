import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UnlistenFn } from './ipc';
import * as api from './api';
import { notice, type Notice } from './shell';

type Rect = { left: number; top: number; width: number; height: number };
type Place = { x: number; y: number; width: number; height: number; radius?: number };

/**
 * A check to run with a rect (and the hole's corner radius) over and over: it
 * calls `send` only when either differs from the last one sent. A radius of 0
 * is left out, so a square hole's place is just its rect.
 */
export function sendOnChange(send: (place: Place) => void) {
  let last = '';
  return (r: Rect, radius = 0) => {
    const key = `${r.left},${r.top},${r.width},${r.height},${radius}`;
    if (key === last) return;
    last = key;
    send({ x: r.left, y: r.top, width: r.width, height: r.height, ...(radius > 0 ? { radius } : {}) });
  };
}

/** A hole's corner radius in CSS pixels from its computed `border-top-left-radius` ("18px", or "18px 12px" for an elliptical one, whose first is taken); 0 for none, or for a percentage. */
export function holeRadius(computed: string): number {
  const first = computed.trim().split(/\s+/)[0] ?? '';
  const px = first.endsWith('px') ? parseFloat(first) : 0;
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/**
 * Report the bench's hole to the app, which moves the native view under it.
 * Anything above the hole (a notice banner, the effects, wrapping text) or a
 * scroll can move it without resizing it, so its rect is read every animation
 * frame and sent only when it actually changed. Its corners go too: the
 * native view is rounded to the hole's own border-radius (Home's hero's
 * --lay-hero-radius), and every other hole, square, stays square.
 */
export function usePlaceBench(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = sendOnChange((place) => api.placeBench(place).catch(() => {}));
    let frame = 0;
    const tick = () => {
      check(el.getBoundingClientRect(), holeRadius(getComputedStyle(el).borderTopLeftRadius));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}

/**
 * Follow one of the app's events (`pl.onLive`, `fx.onFx`, `link.onFrame`…) while
 * the component is shown. The handler is read fresh on every event, so it can
 * use the latest props and state without resubscribing. It unlistens on unmount
 * (at once when the subscription has resolved, else as soon as it does), and a
 * subscribe that throws or rejects (not in the app: a browser tab, a test)
 * follows nothing, quietly.
 */
export function useTauriEvent<T>(subscribe: (f: (payload: T) => void) => Promise<UnlistenFn>, handler: (payload: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    let live = true;
    let unlisten: UnlistenFn | undefined;
    let pending: Promise<UnlistenFn>;
    try {
      pending = subscribe((payload) => latest.current(payload));
    } catch {
      return;
    }
    pending.then(
      (u) => (live ? (unlisten = u) : u()),
      () => {},
    );
    return () => {
      live = false;
      unlisten?.();
    };
  }, [subscribe]);
}

/**
 * The failure a view is showing, if any. `fail(message)` is a rejection handler
 * that shows `message` with what was thrown as its detail; `set` shows a notice
 * made elsewhere, or null to put it away.
 */
export function useNotice() {
  const [shown, set] = useState<Notice | null>(null);
  const fail = useCallback((message: string) => (e: unknown) => set(notice(message, e)), []);
  const dismiss = useCallback(() => set(null), []);
  return { notice: shown, set, fail, dismiss };
}
