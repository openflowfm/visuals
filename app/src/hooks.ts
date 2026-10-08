import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import * as api from './api.ts';
import { notice, type Notice } from './shell.ts';

type Rect = { left: number; top: number; width: number; height: number };
type Place = { x: number; y: number; width: number; height: number };

/** A check to run with a rect over and over: it calls `send` only when the rect differs from the last one sent. */
export function sendOnChange(send: (place: Place) => void) {
  let last = '';
  return (r: Rect) => {
    const key = `${r.left},${r.top},${r.width},${r.height}`;
    if (key === last) return;
    last = key;
    send({ x: r.left, y: r.top, width: r.width, height: r.height });
  };
}

/**
 * Report the bench's hole to the app, which moves the native view under it.
 * Anything above the hole (a notice banner, the effects, wrapping text) or a
 * scroll can move it without resizing it, so its rect is read every animation
 * frame and sent only when it actually changed.
 */
export function usePlaceBench(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = sendOnChange((place) => api.placeBench(place).catch(() => {}));
    let frame = 0;
    const tick = () => {
      check(el.getBoundingClientRect());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}

/**
 * Follow one of the app's events (`pl.onLive`, `fx.onFx`, `link.onFrame`…) while
 * the component is shown. The handler is read fresh on every event, so it can
 * use the latest props and state without resubscribing.
 */
export function useTauriEvent<T>(subscribe: (f: (payload: T) => void) => Promise<UnlistenFn>, handler: (payload: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const off = subscribe((payload) => latest.current(payload));
    return () => {
      off.then((f) => f());
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
