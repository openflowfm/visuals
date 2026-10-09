import { useEffect, useRef } from 'react';
import * as fx from './fx.ts';
import type * as pl from './playlists.ts';
import { isTyping } from './shell.ts';

/** A rating, in stars. */
export type Stars = 1 | 2 | 3 | 4 | 5;

/** Where live mode's keys go. */
export interface LiveKeyTargets {
  /** ⌘⇧L or Esc: back to the editor. */
  editor: () => void;
  /** A step: previous, next, random. */
  act: (action: pl.Action) => void;
  /** An effect. */
  fx: (action: fx.FxAction) => void;
  /** 1–5: rate the current preset. */
  rate: (stars: Stars) => void;
  /** L: favourite the current preset. */
  favourite: () => void;
  /** ?: show or hide the list of live controls. */
  help: () => void;
  /** Whether a sheet (⚙ Settings, More effects) or another modal is open over live mode: it takes Esc, so live doesn't leave. */
  sheetOpen?: () => boolean;
}

/** Whether `target` is inside a dialog, which answers its own Esc. */
function inDialog(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

/** An open sheet (⚙ Settings, More effects) or modal; the status bar's popovers are dialogs too, but not modal. */
const MODAL = '[aria-modal="true"], .vf-sheet, [role="dialog"]:not(.live-status-pop)';

/** Whether a modal (a sheet, the ? overlay) is open in the page. */
export const modalOpen = (): boolean => typeof document !== 'undefined' && document.querySelector(MODAL) !== null;

/** What the handlers read of a key event. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'target' | 'preventDefault'> & Partial<Pick<KeyboardEvent, 'defaultPrevented'>>;

/**
 * Live mode's keys, without the window: a press, a release, and the window
 * losing focus. It keeps the hold keys that are down, so their release (or the
 * blur) lets go of the effect they hold.
 */
export function liveKeys(to: LiveKeyTargets) {
  const down = new Set<fx.Hit>();
  return {
    down,
    keydown(e: KeyLike) {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        to.editor();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Keys pressed in a field, or in a sheet or dialog, are theirs.
      if (isTyping(e) || inDialog(e.target)) return;
      // An open sheet or modal takes every key, even with focus still outside it (on ⚙), ? too: the help would open over the
      // sheet (or close the sheet under someone mid-choice), so ? waits until it is closed. The open help closes itself on ?.
      if (to.sheetOpen?.()) return;
      if (e.key === 'Escape') {
        // A menu, sheet or dialog that took its own Esc keeps it (decision 17q: the ⚙ sheet takes Esc before live does).
        if (e.defaultPrevented) return;
        e.preventDefault();
        to.editor();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to.act({ kind: 'next' });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to.act({ kind: 'previous' });
      else if (e.key.toLowerCase() === 'r') to.act({ kind: 'random' });
      else if (e.key === '?') {
        if (!e.repeat) to.help();
      } else if (/^[1-5]$/.test(e.key)) {
        if (!e.repeat) to.rate(Number(e.key) as Stars);
      } else if (e.key.toLowerCase() === 'l') {
        if (!e.repeat) to.favourite();
      } else {
        // The effect keys, as everywhere: F freezes while held and ⇧F latches it (decision 57).
        const press = fx.effectKey(e.key, e.shiftKey);
        if (!press) return;
        e.preventDefault();
        if (e.repeat) return;
        if ('hold' in press) {
          down.add(press.hold);
          to.fx(fx.hitAction(press.hold, true));
        } else to.fx(press.action);
        return;
      }
      e.preventDefault();
    },
    keyup(e: Pick<KeyboardEvent, 'key'>) {
      const hit = fx.HOLD_KEYS[e.key.toLowerCase()];
      if (hit && down.delete(hit)) to.fx(fx.hitAction(hit, false));
    },
    blur() {
      for (const hit of down) to.fx(fx.hitAction(hit, false));
      down.clear();
    },
  };
}

/** {@link liveKeys} on the window, for as long as the component is shown. */
export function useLiveKeys(to: LiveKeyTargets) {
  const latest = useRef(to);
  latest.current = to;
  useEffect(() => {
    const keys = liveKeys({
      editor: () => latest.current.editor(),
      act: (a) => latest.current.act(a),
      fx: (a) => latest.current.fx(a),
      rate: (s) => latest.current.rate(s),
      favourite: () => latest.current.favourite(),
      help: () => latest.current.help(),
      sheetOpen: () => (latest.current.sheetOpen ?? modalOpen)(),
    });
    const keydown = (e: KeyboardEvent) => keys.keydown(e);
    const keyup = (e: KeyboardEvent) => keys.keyup(e);
    const blur = () => keys.blur();
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
