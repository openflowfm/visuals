import { useCallback, useEffect, useState } from 'react';
import { SQUARE, type Corner, type CornerName, type Corners } from '../render/output.ts';

/**
 * How bright, and where it lands. Both belong to the projector and the room.
 *
 * The scheme travels and this must not: a rig in a bright hall wants a different
 * number from the same show in a black box, and carrying one to the other would
 * be wrong in whichever room it was not set in.
 */
export interface Output {
  corners: Corners;
  gain: number;
}

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

/** Enough headroom to drive a dim hall, and enough travel to tame a dark room. */
export const GAIN_RANGE = { min: 0.2, max: 1.5 } as const;

function load(): Output {
  try {
    const held = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Corners> & {
      gain?: number;
    };
    const corner = (name: CornerName): Corner => {
      const value = held?.[name];
      return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
        ? [value[0], value[1]]
        : SQUARE[name];
    };
    const gain = Number(held?.gain);
    return {
      corners: { tl: corner('tl'), tr: corner('tr'), br: corner('br'), bl: corner('bl') },
      gain: Number.isFinite(gain)
        ? Math.max(GAIN_RANGE.min, Math.min(GAIN_RANGE.max, gain))
        : 1,
    };
  } catch {
    // No stored output, or one written by something else. Square and unity are
    // correct, and are also what a projector pointed straight at a wall wants.
    return { corners: SQUARE, gain: 1 };
  }
}

export function useOutput() {
  const [output, setOutput] = useState<Output>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...output.corners, gain: output.gain }));
    } catch {
      // Private browsing, or a full quota. The output still works for this
      // session; it just will not be there next time.
    }
  }, [output]);

  const moveCorner = useCallback((name: CornerName, to: Corner) => {
    // Clamped to the frame: a corner pushed outside it is a corner the projector
    // has already cropped, so the handle would leave the screen and never come
    // back.
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    setOutput((held) => ({
      ...held,
      corners: { ...held.corners, [name]: [clamp(to[0]), clamp(to[1])] as Corner },
    }));
  }, []);

  const setGain = useCallback((gain: number) => {
    setOutput((held) => ({
      ...held,
      gain: Math.max(GAIN_RANGE.min, Math.min(GAIN_RANGE.max, gain)),
    }));
  }, []);

  // Only the corners: brightness is a room, and squaring a projector should not
  // also undo an hour of finding the right level for the hall it is in.
  const reset = useCallback(() => setOutput((held) => ({ ...held, corners: SQUARE })), []);

  return { output, moveCorner, setGain, reset };
}
