import { useCallback, useEffect, useState } from 'react';
import { SQUARE, type Corner, type CornerName, type Corners } from '../render/keystone.ts';

/**
 * Where the picture lands, kept on the machine that is projecting it.
 *
 * **Deliberately not in the scheme.** The scheme is a file you commit and carry
 * to the gig laptop, and a show that looked different there would be a bug. A
 * keystone is the exact opposite: it describes one projector at one angle in one
 * room, so one that travelled would be wrong everywhere except where it was set.
 * `localStorage` is the right scope — it belongs to this browser on this machine
 * and survives a restart, which is what a rig left powered on overnight needs.
 */
const KEY = 'bsv.visuals.output';

function load(): Corners {
  try {
    const held = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Corners>;
    const corner = (name: CornerName): Corner => {
      const value = held?.[name];
      return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
        ? [value[0], value[1]]
        : SQUARE[name];
    };
    return { tl: corner('tl'), tr: corner('tr'), br: corner('br'), bl: corner('bl') };
  } catch {
    // No stored alignment, or one written by something else. Square is correct
    // and is also what a projector pointed straight at a wall wants.
    return SQUARE;
  }
}

export function useOutput() {
  const [corners, setCorners] = useState<Corners>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(corners));
    } catch {
      // Private browsing, or a full quota. The alignment still works for this
      // session; it just will not be there next time.
    }
  }, [corners]);

  const moveCorner = useCallback((name: CornerName, to: Corner) => {
    // Clamped to the frame: a corner pushed outside it is a corner the projector
    // has already cropped, so the handle would leave the screen and never come
    // back.
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    setCorners((held) => ({ ...held, [name]: [clamp(to[0]), clamp(to[1])] as Corner }));
  }, []);

  const reset = useCallback(() => setCorners(SQUARE), []);

  return { corners, moveCorner, reset };
}
