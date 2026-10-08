import { useCallback, useEffect, useRef, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { notice, type Notice } from './shell.ts';

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
