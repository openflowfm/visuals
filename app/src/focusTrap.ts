import { useEffect, type RefObject } from 'react';

/** What Tab can land on inside a dialog. */
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Where Tab (or ⇧Tab, `back`) goes next among `items`, the dialog's focusable
 * controls in order, from `at` (what has focus now): round from the last to
 * the first and back, so focus never leaves the dialog. Null when the browser's
 * own step stays inside, so it is left alone. With nothing focusable, focus
 * stays where it is (`at`, or the dialog itself, which the caller gives as `home`).
 */
export function wrapFocus<T>(items: readonly T[], at: T | null, back: boolean, home: T): T | null {
  if (!items.length) return at ?? home;
  const i = at === null ? -1 : items.indexOf(at);
  if (i < 0) return back ? items[items.length - 1] : items[0];
  if (back && i === 0) return items[items.length - 1];
  if (!back && i === items.length - 1) return items[0];
  return null;
}

/** The controls Tab can reach inside `root`, in document order, leaving out hidden and inert ones. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert], [hidden], [aria-hidden="true"]') && el.getClientRects().length > 0);
}

/**
 * Keeps keyboard focus inside the element `ref` points at while it is mounted:
 * focus moves into it (to itself, which takes `tabIndex={-1}`), Tab and ⇧Tab
 * go round its controls, and focus that escapes (a click behind a drawer with
 * no backdrop) is let be, but the next Tab comes back in. On unmount, focus
 * goes back to whatever had it before (the button that opened it), if that is
 * still in the page.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) root.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && document.activeElement !== root ? document.activeElement : null;
      const to = wrapFocus(focusables(root), active, e.shiftKey, root);
      if (!to) return;
      e.preventDefault();
      to.focus();
    };
    // Capturing, on the window, so Tab from outside (focus that escaped) comes back in too.
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
