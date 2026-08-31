import { useEffect, useState } from 'react';

/**
 * Where a floating panel sits, and how big it is. Pixels, in its container.
 *
 * Not a rectangle in the abstract — `x` and `y` are an offset from the top-left
 * of whatever the panel floats over, so a place written on a laptop still means
 * something on a monitor twice the size. Clamping it back inside that container
 * is the caller's, because only the caller knows how big the container is.
 */
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A panel's place, kept in the browser rather than in the scheme.
 *
 * The same argument [`useOutput`](./useOutput.ts) makes about the projector
 * corners, and it is worth making twice because the pull to put it in the file
 * is strong: the scheme is a document you commit and carry to the gig laptop,
 * and everything in it is a decision about *the show*. Where somebody parked a
 * preview is a decision about **their screen** — it would arrive wrong on any
 * other one, and it would put a diff in `git` every time a window was nudged.
 *
 * Keyed rather than fixed so a second floating panel does not have to invent
 * this again, and so one of them moving cannot displace another.
 */
export function usePlace(key: string, initial: Place) {
  const [place, setPlace] = useState<Place>(() => load(key, initial));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(place));
    } catch {
      // Private browsing, or a full quota. The panel still moves for this
      // session; it just will not be where it was left next time.
    }
  }, [key, place]);

  return [place, setPlace] as const;
}

function load(key: string, initial: Place): Place {
  try {
    const held = JSON.parse(localStorage.getItem(key) ?? '') as Partial<Place>;
    const at = (name: keyof Place) =>
      Number.isFinite(held?.[name]) ? (held[name] as number) : initial[name];
    return { x: at('x'), y: at('y'), w: at('w'), h: at('h') };
  } catch {
    // Nothing stored, or something else wrote this key. Every field falls back
    // on its own above, so a half-written place still opens somewhere sensible.
    return initial;
  }
}

/**
 * A place, forced back inside a box of `width` × `height`.
 *
 * A panel dragged past the edge of a canvas — or left there by a window that
 * has since been made smaller — is a panel whose header is unreachable, and a
 * header you cannot grab is a panel you cannot get back. Size is clamped before
 * position for the same reason `min` comes first: a panel bigger than what it
 * floats over has no legal position at all.
 */
export function inside(place: Place, width: number, height: number, min: number): Place {
  const w = Math.max(min, Math.min(place.w, width));
  const h = Math.max(min, Math.min(place.h, height));
  return {
    w,
    h,
    x: Math.max(0, Math.min(place.x, width - w)),
    y: Math.max(0, Math.min(place.y, height - h)),
  };
}
