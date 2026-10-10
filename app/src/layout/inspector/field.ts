/**
 * The inspector's field (Field.tsx) without the drawing: every measured preset
 * in the library placed by speed (across) and brightness (up) in a 4:3 box,
 * grouped into hue bands so the whole library draws as a dozen SVG paths
 * rather than a node per preset, and the two ways to reach one: the dot
 * nearest the pointer, and the nearest dot in an arrow key's direction.
 */
import type { LibraryRow, Mine } from '../../api.ts';
import { placeOf } from './model.ts';

/** The field's drawing box, in its own units: 4:3, the plot inset by a margin that holds the ticks. */
export const W = 240;
export const H = 180;
export const M = 8;
const PW = W - 2 * M;
const PH = H - 2 * M;
/** Where a 0–1 speed and brightness land in the box. */
export const xOf = (at: number) => M + at * PW;
export const yOf = (at: number) => M + (1 - at) * PH;

/** How many bands the hue circle is cut into; a preset with no hue is in the grey band, `BANDS`. */
export const BANDS = 12;
const BAND = 360 / BANDS;

/** One preset's mark in the field. */
export interface Dot {
  row: LibraryRow;
  x: number;
  y: number;
  /** Its strongest hue's band, 0 to BANDS - 1, or BANDS for grey. */
  band: number;
}

/** The band a hue falls in. */
export const bandOf = (hue: number | undefined): number => (hue === undefined ? BANDS : Math.floor((((hue % 360) + 360) % 360) / BAND) % BANDS);

/** A band's colour: its middle hue, at the dots' lightness; grey takes the caption's colour. */
export const bandColour = (band: number): string => (band >= BANDS ? 'var(--caption)' : `hsl(${Math.round(band * BAND + BAND / 2)} 70% 62%)`);

/**
 * Every preset the index has measured, as a dot where `characterOf` reads it
 * (the user's speed and brightness overrides applied); a preset not drawn yet,
 * or with no speed or brightness at all, has no place.
 */
export function dotsOf(library: readonly LibraryRow[], mine?: Readonly<Record<string, Mine>>): Dot[] {
  const dots: Dot[] = [];
  for (const row of library) {
    if (!row.look) continue;
    const o = mine?.[row.key]?.overrides;
    const at = placeOf(row.look, o);
    if (at.speed === null || at.brightness === null) continue;
    dots.push({ row, x: xOf(at.speed), y: yOf(at.brightness), band: bandOf((o?.hues ?? row.look.hues)[0]) });
  }
  return dots;
}

/** The dots as one path per band: each dot a zero-length segment that a round cap draws as a disc. */
export function bandPaths(dots: readonly Dot[]): { band: number; d: string }[] {
  const parts: string[][] = Array.from({ length: BANDS + 1 }, () => []);
  for (const d of dots) parts[d.band].push(`M${d.x.toFixed(1)} ${d.y.toFixed(1)}h0`);
  return parts.flatMap((p, band) => (p.length ? [{ band, d: p.join('') }] : []));
}

/** The dot nearest (x, y), within `reach` units; -1 when none is that close. */
export function nearest(dots: readonly Dot[], x: number, y: number, reach: number): number {
  let best = -1;
  let bestD = reach * reach;
  for (let i = 0; i < dots.length; i++) {
    const dx = dots[i].x - x;
    const dy = dots[i].y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** An arrow key's direction. */
export type Direction = 'left' | 'right' | 'up' | 'down';
const VECTORS: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * The dot an arrow key moves to from dot `from`: the nearest one within 45° of
 * that direction, a sideways step counting double, so the cursor runs along a
 * row of dots rather than jumping across. Dots on the same spot are taken in
 * order (right and down go on to the later, left and up back to the earlier),
 * so each is reachable. `from` itself when there is none that way.
 */
export function step(dots: readonly Dot[], from: number, dir: Direction): number {
  const o = dots[from];
  if (!o) return from;
  const [vx, vy] = VECTORS[dir];
  const onward = vx + vy > 0;
  let best = from;
  let bestScore = Infinity;
  for (let i = 0; i < dots.length; i++) {
    if (i === from) continue;
    const dx = dots[i].x - o.x;
    const dy = dots[i].y - o.y;
    const along = dx * vx + dy * vy;
    const side = Math.abs(dx * vy - dy * vx);
    if (along === 0 && side === 0) {
      if (onward ? i < from : i > from) continue;
    } else if (along <= 0 || side > along) {
      continue;
    }
    const score = along + 2 * side;
    // Among dots on the same spot, the next in order.
    if (score < bestScore || (score === bestScore && (onward ? i < best : i > best))) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** The index of the dot for preset `key`, or -1. */
export const dotOf = (dots: readonly Dot[], key: string | null | undefined): number => (key ? dots.findIndex((d) => d.row.key === key) : -1);
