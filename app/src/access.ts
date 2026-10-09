import { useEffect, useState } from 'react';
import * as api from './api.ts';
import './access.css';

/**
 * Accessibility (#100): the app's reduced-motion setting (`api.reducedMotion`),
 * which follows macOS's "Reduce motion" until a choice is made in Settings.
 * While it is on, the app caps the strobe and flashes (in `fx.rs`) and the page
 * calms its own motion: the document is marked `data-reduced-motion`, which
 * `access.css` reads. `access.css` also gives every control a visible keyboard
 * focus ring.
 */

/** The media query WebKit answers from macOS's Reduce motion. */
export const SYSTEM_QUERY = '(prefers-reduced-motion: reduce)';

let motion: api.Motion | null = null;
const listeners = new Set<(m: api.Motion) => void>();

/** Mark the document (or `root`) for `m`: `data-reduced-motion` while motion is reduced. */
export function mark(m: api.Motion, root: { dataset: DOMStringMap } | undefined = typeof document === 'undefined' ? undefined : document.documentElement) {
  if (!root) return;
  if (m.reduced) root.dataset.reducedMotion = '';
  else delete root.dataset.reducedMotion;
}

/** Take `m` as the setting now: mark the document and tell every `useMotion`. */
export function publish(m: api.Motion) {
  motion = m;
  mark(m);
  for (const l of listeners) l(m);
}

/** Ask the app again (macOS's setting may have changed), and publish what it says. */
export const refresh = (): Promise<api.Motion> => api.reducedMotion().then((m) => (publish(m), m));

/**
 * Reduce motion (true), don't (false), or follow macOS again (null); publishes
 * what the app says is in effect. If the choice couldn't be kept, the app still
 * put it in force for this run: that is read back and published, and the error
 * is passed on to be shown.
 */
export const setMotion = (on: boolean | null): Promise<api.Motion> =>
  api.reducedMotionSet(on).then(
    (m) => (publish(m), m),
    (e) => {
      refresh().catch(() => {});
      throw e;
    },
  );

/** The reduced-motion setting, null until the app has said; it follows changes made anywhere in the page and in macOS. */
export function useMotion(): api.Motion | null {
  const [m, setM] = useState<api.Motion | null>(motion);
  useEffect(() => {
    listeners.add(setM);
    if (motion) setM(motion);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}

/**
 * Mounted once by `App`: reads the setting, marks the document, and reads it
 * again whenever macOS's Reduce motion changes (WebKit says so through the
 * media query) or the window comes back to the front.
 */
export function useAccessibility(): void {
  useEffect(() => {
    const again = () => {
      refresh().catch(() => {});
    };
    again();
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_QUERY) : null;
    query?.addEventListener('change', again);
    window.addEventListener('focus', again);
    return () => {
      query?.removeEventListener('change', again);
      window.removeEventListener('focus', again);
    };
  }, []);
}
