import { useEffect, useRef } from 'react';
import * as fx from './fx.ts';
import type * as pl from './playlists.ts';
import { isTyping } from './shell.ts';

/** Where live mode's keys go. */
export interface LiveKeyTargets {
  /** ⌘⇧L: back to the editor. */
  editor: () => void;
  /** A step: previous, next, random. */
  act: (action: pl.Action) => void;
  /** An effect. */
  fx: (action: fx.FxAction) => void;
}

/** What the handlers read of a key event. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'target' | 'preventDefault'>;

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
      if (isTyping(e)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to.act({ kind: 'next' });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to.act({ kind: 'previous' });
      else if (e.key.toLowerCase() === 'r') to.act({ kind: 'random' });
      else {
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
