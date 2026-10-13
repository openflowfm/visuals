import { useEffect, useRef } from 'react';
import * as fx from './fx';
import type * as pl from './playlists';
import { isTyping } from './shell';

/** A rating, in stars. */
export type Stars = 1 | 2 | 3 | 4 | 5;

/**
 * How long Esc is held to leave live (ms). ✕ and ⌘⇧L leave at once, as they are
 * deliberate; a short Esc only shows hidden panels or puts a laid-over crate
 * away, so a stray press mid-set never closes the output.
 */
export const LEAVE_HOLD_MS = 3000;

/** Where live mode's keys go. */
export interface LiveKeyTargets {
  /** ⌘⇧L at once, or Esc held for `LEAVE_HOLD_MS`: leave live. */
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
  /** \: hide the Stage's panels, or show them again (only the Stage has them). */
  panels?: () => void;
  /** E: open the Stage's effects panel, or close it (only the Stage has it). */
  effects?: () => void;
  /** Esc pressed: shows the Stage's hidden panels or puts a laid-over crate away; true when it was used. Only Esc held leaves. */
  escape?: () => boolean;
  /** Esc went down and is being held toward leaving (true), or the hold ended: let go, cancelled or done (false). */
  holding?: (on: boolean) => void;
}

/** Whether `target` is inside a dialog, which answers its own Esc. */
function inDialog(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

/** An open sheet (⚙ Settings, More effects) or modal; the status bar's popovers, and Home's (`Popover`, the Stage's lights), are dialogs too, but not modal. */
// zen: the app's popover panel is `.vs-popover-panel` (a float Layer), its sheets `.vs-sheet`.
const MODAL = '[aria-modal="true"], .vs-sheet, [role="dialog"]:not(.live-status-pop):not(.vs-popover-panel)';

/** Whether a modal (a sheet, the ? overlay) is open in the page. */
export const modalOpen = (): boolean => typeof document !== 'undefined' && document.querySelector(MODAL) !== null;

/** What the handlers read of a key event. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'target' | 'preventDefault'> & Partial<Pick<KeyboardEvent, 'defaultPrevented'>>;

/**
 * Live mode's keys, without the window: a press, a release, and the window
 * losing focus. It keeps the hold keys that are down, so their release (or the
 * blur) lets go of the effect they hold.
 *
 * Esc held for `holdMs` leaves live (`editor`), timed from its first press:
 * its repeats don't start it again, and letting go, or the window losing
 * focus, before then cancels it. `holding` follows the hold, for the progress
 * the Stage shows. The output's Esc (which the page hears from Rust, as down
 * and up) holds the same way, through `escapeDown` and `escapeUp`.
 */
export function liveKeys(to: LiveKeyTargets, holdMs = LEAVE_HOLD_MS) {
  const down = new Set<fx.Hit>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Esc down: start timing the hold, unless it is already held (a repeat, or held on both windows). */
  const escapeDown = () => {
    if (timer !== null) return;
    to.holding?.(true);
    timer = setTimeout(() => {
      timer = null;
      to.holding?.(false);
      // A sheet or modal that opened mid-hold (⌘, opens Settings) takes the hold: never leave live under it.
      if (to.sheetOpen?.()) return;
      to.editor();
    }, holdMs);
  };
  /** Esc up, or focus lost: the hold ends before leaving. */
  const escapeUp = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    to.holding?.(false);
  };
  return {
    down,
    escapeDown,
    escapeUp,
    /** Whether Esc is being held toward leaving. */
    get holding() {
      return timer !== null;
    },
    /** Stop timing a hold without telling anyone (the keys are going away). */
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
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
        // A press shows hidden panels or puts a laid-over crate away; only Esc held leaves, so a stray Esc mid-set can't
        // close the output. Its repeats change nothing: the hold is timed from the first press.
        if (e.repeat) return e.preventDefault();
        // A menu or the laid-over crate that took its own Esc keeps the press (decision 17q: the ⚙ sheet takes Esc before
        // live does, above); held on, it still leaves.
        if (!e.defaultPrevented) {
          e.preventDefault();
          to.escape?.();
        }
        escapeDown();
        return;
      }
      if (e.key === '\\') {
        if (!to.panels) return;
        e.preventDefault();
        if (!e.repeat) to.panels();
        return;
      }
      if (e.key.toLowerCase() === 'e' && !e.shiftKey) {
        if (!to.effects) return;
        e.preventDefault();
        if (!e.repeat) to.effects();
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
      if (e.key === 'Escape') return escapeUp();
      const hit = fx.HOLD_KEYS[e.key.toLowerCase()];
      if (hit && down.delete(hit)) to.fx(fx.hitAction(hit, false));
    },
    blur() {
      escapeUp();
      for (const hit of down) to.fx(fx.hitAction(hit, false));
      down.clear();
    },
  };
}

/** Esc from outside the window (the output's, from Rust), held the same way as the window's own. */
export interface EscapeFeed {
  escapeDown(): void;
  escapeUp(): void;
}

/**
 * {@link liveKeys} on the window, for as long as the component is shown. It
 * gives back where to feed Esc pressed and let go elsewhere (the output).
 */
export function useLiveKeys(to: LiveKeyTargets): EscapeFeed {
  const latest = useRef(to);
  latest.current = to;
  const live = useRef<ReturnType<typeof liveKeys> | null>(null);
  const feed = useRef<EscapeFeed>({ escapeDown: () => live.current?.escapeDown(), escapeUp: () => live.current?.escapeUp() });
  useEffect(() => {
    const keys = liveKeys({
      editor: () => latest.current.editor(),
      act: (a) => latest.current.act(a),
      fx: (a) => latest.current.fx(a),
      rate: (s) => latest.current.rate(s),
      favourite: () => latest.current.favourite(),
      help: () => latest.current.help(),
      sheetOpen: () => (latest.current.sheetOpen ?? modalOpen)(),
      panels: () => latest.current.panels?.(),
      effects: () => latest.current.effects?.(),
      escape: () => latest.current.escape?.() === true,
      holding: (on) => latest.current.holding?.(on),
    });
    live.current = keys;
    const keydown = (e: KeyboardEvent) => keys.keydown(e);
    const keyup = (e: KeyboardEvent) => keys.keyup(e);
    const blur = () => keys.blur();
    // The page hidden (the app left while Esc was held on the output, with no window of ours key to blur): let go too.
    const visibility = () => {
      if (document.visibilityState === 'hidden') keys.blur();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      keys.dispose();
      live.current = null;
    };
  }, []);
  return feed.current;
}
