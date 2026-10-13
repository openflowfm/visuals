/**
 * **Job.** The inspector's field (Field.tsx) without the drawing: every measured preset in the
 * library placed by two axes the user picks (`MapAxes`: across and up, each one of `AXES`) in a
 * box, coloured by a third choice (`COLOURINGS`) and grouped by that colour so the whole
 * library draws as a dozen SVG paths rather than a node per preset; the two ways to reach one
 * (the dot nearest the pointer, and the nearest dot in an arrow key's direction); and a trail
 * through the presets played (`trailPoints`). The box is any shape (`boxOf`), 4:3 (`BOX`) unless
 * the caller measures another; the dots, the trail and the tuned marks are placed in it, and the
 * two ways to reach a dot work in its units whatever its shape.
 *
 * **Changed.** The axes were fixed (speed across, brightness up) and the colour was always the
 * hue band; now any two of speed, brightness, intensity, hue, colourfulness, my rating and style,
 * and colour by hue, style or rating. `Dot.band` is the dot's colour group under the colouring
 * (`groupColour` paints it). A preset's own speed (`tunedAt`) moves it on whichever axis shows
 * speed, and only then is it marked tuned. The trail is new. The box was a fixed 4:3; now it is a
 * `Box` (`boxOf(w, h)`) that `xOf`, `yOf` and `dotsOf` take, so the library's Map view fills a
 * wide room.
 *
 * **Kept.** The default box (`W`, `H`, `M`; `xOf`, `yOf` and `dotsOf` without one), its units
 * (about a CSS px), `placeOf`'s reading of speed and brightness,
 * the hue bands, `nearest`, `step`, `dotOf`, `tunedPath`, `tunedSays`.
 */
import type { LibraryRow, Mine, Overrides } from './api';
import { placeOf, scaleOf } from './inspector-model';

/**
 * The field's drawing box, in its own units, about a CSS px each (the 4:3 panel draws it at
 * about its size, and the library's Map view measures its room in px), so the dots, the rings
 * and the pointer's reach look the same at any shape. The plot is inset by a margin that holds
 * the ticks.
 */
export interface Box {
  w: number;
  h: number;
}
/** The default box's width and height: 4:3, the inspector's and live mode's panels. */
export const W = 240;
export const H = 180;
export const M = 8;
/** A box is at least this each way: room for the margins and a little plot. */
const MIN = 4 * M;
/** A box `w` by `h`, rounded, at least `MIN` each way; a non-number side takes the default's. */
export const boxOf = (w: number, h: number): Box => ({
  w: Number.isFinite(w) ? Math.max(MIN, Math.round(w)) : W,
  h: Number.isFinite(h) ? Math.max(MIN, Math.round(h)) : H,
});
/** The default box: 240 by 180. */
export const BOX: Box = { w: W, h: H };
/** Where a 0–1 place across and up land in the box (the default's when left out). */
export const xOf = (at: number, box: Box = BOX) => M + at * (box.w - 2 * M);
export const yOf = (at: number, box: Box = BOX) => M + (1 - at) * (box.h - 2 * M);

/** A measure the map can lay out along an axis. */
export type AxisId = 'speed' | 'brightness' | 'intensity' | 'hue' | 'colourfulness' | 'rating' | 'style';
/** What the dots' colour says. */
export type ColourBy = 'hue' | 'style' | 'rating';
/** The map's choice: the measure across, the one up, and the colour. Across and up always differ. */
export interface MapAxes {
  across: AxisId;
  up: AxisId;
  colour: ColourBy;
}
export const DEFAULT_AXES: MapAxes = { across: 'speed', up: 'brightness', colour: 'hue' };

/** One axis as the pickers say it: its name and its ends' words. */
export interface AxisInfo {
  id: AxisId;
  label: string;
  low: string;
  high: string;
  /** Lanes rather than a scale (style): its ends are the first and last lane's names (`endsOf`). */
  categorical: boolean;
}
export const AXES: readonly AxisInfo[] = [
  { id: 'speed', label: 'Speed', low: 'slow', high: 'fast', categorical: false },
  { id: 'brightness', label: 'Brightness', low: 'dark', high: 'bright', categorical: false },
  { id: 'intensity', label: 'Intensity', low: 'calm', high: 'intense', categorical: false },
  { id: 'hue', label: 'Hue', low: 'red', high: 'violet', categorical: false },
  { id: 'colourfulness', label: 'Colourfulness', low: 'grey', high: 'many colours', categorical: false },
  { id: 'rating', label: 'My rating', low: 'unrated', high: '★★★★★', categorical: false },
  { id: 'style', label: 'Style', low: 'first style', high: 'last style', categorical: true },
];
export const COLOURINGS: readonly { id: ColourBy; label: string }[] = [
  { id: 'hue', label: 'Hue' },
  { id: 'style', label: 'Style' },
  { id: 'rating', label: 'Rating' },
];

/** An axis's info by id. */
export const axisOf = (id: AxisId): AxisInfo => AXES.find((a) => a.id === id)!;

/** An axis's ends' words: its own, or for style the first and last style name of `styles`. */
export function endsOf(id: AxisId, styles: readonly string[]): { low: string; high: string } {
  const a = axisOf(id);
  if (id === 'style' && styles.length) return { low: styles[0], high: styles[styles.length - 1] };
  return { low: a.low, high: a.high };
}

/** The choice with `which` axis showing `id`: when the other axis shows it already, the two swap. */
export function withAxis(axes: MapAxes, which: 'across' | 'up', id: AxisId): MapAxes {
  const other = which === 'across' ? 'up' : 'across';
  if (axes[which] === id) return axes;
  return axes[other] === id ? { ...axes, [which]: id, [other]: axes[which] } : { ...axes, [which]: id };
}

/** How many bands the hue circle is cut into; a preset with no hue is in the grey band, `BANDS`. */
export const BANDS = 12;
const BAND = 360 / BANDS;

/** One preset's mark in the field. */
export interface Dot {
  row: LibraryRow;
  x: number;
  y: number;
  /** Its colour group under the colouring: the hue band (0 to BANDS - 1, BANDS for grey), the style's index in `stylesOf`, or the rating (0 unrated, 1–5). */
  band: number;
  /** With the user's own speed (`Mine.tune.speed`, not 1) on an axis showing speed: that multiplier and where the preset sits as made (one of the two equals x or y). */
  tuned?: { speed: number; madeX: number; madeY: number };
}

/**
 * Where a preset sits along speed once the user's speed multiplier is applied:
 * the axis reads motion on a square-root scale (`scaleOf.speed`, √(v/8)), so
 * motion times `k` moves the place by √k (twice as fast, about 1.41 times as far
 * along), clamped to the field. An unmeasured place stays one.
 */
export const tunedAt = (at: number, k: number | undefined): number => (k === undefined || !(k > 0) || k === 1 ? at : Math.min(1, Math.max(0, at * Math.sqrt(k))));

/** A speed multiplier as said: "0.5×", "2×", "1.25×". */
export const timesOf = (k: number): string => `${Math.round(k * 100) / 100}×`;

/** The band a hue falls in. */
export const bandOf = (hue: number | undefined): number => (hue === undefined ? BANDS : Math.floor((((hue % 360) + 360) % 360) / BAND) % BANDS);

/** A band's colour: its middle hue, at the dots' lightness; grey takes the caption's colour. */
export const bandColour = (band: number): string => (band >= BANDS ? 'var(--caption)' : `hsl(${Math.round(band * BAND + BAND / 2)} 70% 62%)`);

/** A colour group's colour: a hue band's; a style's, the styles spread round the hue circle; a rating's, grey unrated and an amber ramp from one star (dim) to five (bright). */
export function groupColour(colour: ColourBy, group: number, styles: readonly string[]): string {
  if (colour === 'hue') return bandColour(group);
  if (colour === 'style') return `hsl(${Math.round((group * 360) / Math.max(1, styles.length))} 65% 62%)`;
  return group <= 0 ? 'var(--caption)' : `hsl(${30 + group * 3} ${50 + group * 9}% ${36 + group * 6}%)`;
}

/** A preset's style, the user's override first. */
const styleOf = (row: LibraryRow, o: Overrides | undefined): string => o?.style ?? row.style;

/** The library's distinct styles (the user's overrides applied), sorted: the style axis's lanes and the style colouring's groups. */
export function stylesOf(library: readonly LibraryRow[], mine?: Readonly<Record<string, Mine>>): string[] {
  return [...new Set(library.map((r) => styleOf(r, mine?.[r.key]?.overrides)))].sort((a, b) => a.localeCompare(b));
}

/** A key's hash, 0 to 1, salted, for a deterministic jitter. */
function hash01(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** `at` moved by up to ±`spread`, from the key's hash, folded back inside 0–1. */
function jitter(at: number, key: string, salt: number, spread: number): number {
  const v = at + (hash01(key, salt) * 2 - 1) * spread;
  return v < 0 ? -v : v > 1 ? 2 - v : v;
}

/** Where a measure with a level and maybe a raw value sits, 0–1, as `placeOf` reads speed and brightness. */
const levelAt = (level: string | null | undefined, raw: number | null | undefined, scale: (v: number) => number): number | null =>
  raw === null || raw === undefined ? (level ? ({ low: 1 / 6, mid: 1 / 2, high: 5 / 6 } as Record<string, number>)[level] : null) : scale(raw);

/** Rating's jitter: ±6% of the axis, so a rating's dots spread round it. */
const RATING_SPREAD = 0.06;
/** Style's jitter: ±35% of a lane, so a style's dots stay in it. */
const STYLE_SPREAD = 0.35;

/**
 * Where a preset sits along one axis, 0–1, or null for none: speed, brightness and intensity
 * as `characterOf` reads them (the user's overrides applied); hue its strongest hue over 360,
 * none for a grey preset (it has no place on a hue axis, so it is left out rather than put at
 * red); colourfulness its number of hues, up to four, over four; rating the user's stars over
 * five (unrated 0); style its lane's middle among `styles`. Rating and style are jittered by the
 * key (`salt` keeps the two axes' jitters apart).
 */
function axisAt(id: AxisId, row: LibraryRow, m: Mine | undefined, styles: readonly string[], salt: number): number | null {
  const look = row.look;
  const o = m?.overrides;
  switch (id) {
    case 'speed':
      return placeOf(look, o).speed;
    case 'brightness':
      return placeOf(look, o).brightness;
    case 'intensity':
      return levelAt(o?.intensity ?? look?.intensity_level, o?.intensity === undefined ? look?.intensity : null, scaleOf.intensity);
    case 'hue': {
      const h = (o?.hues ?? look?.hues ?? [])[0];
      return h === undefined ? null : (((h % 360) + 360) % 360) / 360;
    }
    case 'colourfulness':
      return Math.min((o?.hues ?? look?.hues ?? []).length, 4) / 4;
    case 'rating':
      return jitter((m?.rating ?? 0) / 5, row.key, salt, RATING_SPREAD);
    case 'style': {
      const n = Math.max(1, styles.length);
      const i = Math.max(0, styles.indexOf(styleOf(row, o)));
      return jitter((i + 0.5) / n, row.key, salt, STYLE_SPREAD / n);
    }
  }
}

/**
 * Every preset the index has measured, as a dot where the two axes place it, its group the
 * colouring's; on an axis showing speed it is moved by the user's own speed for it (`tunedAt`),
 * so it sits at its speed as it plays, and marked tuned. A preset not drawn yet, or with no place
 * on either axis (a grey one on a hue axis), has no dot. The dots are placed in `box` (the
 * default 4:3 one when left out).
 */
export function dotsOf(library: readonly LibraryRow[], mine?: Readonly<Record<string, Mine>>, axes: MapAxes = DEFAULT_AXES, box: Box = BOX): Dot[] {
  const styles = axes.across === 'style' || axes.up === 'style' || axes.colour === 'style' ? stylesOf(library, mine) : [];
  const dots: Dot[] = [];
  for (const row of library) {
    if (!row.look) continue;
    const m = mine?.[row.key];
    const o = m?.overrides;
    const ax = axisAt(axes.across, row, m, styles, 1);
    const ay = axisAt(axes.up, row, m, styles, 2);
    if (ax === null || ay === null) continue;
    const band =
      axes.colour === 'hue' ? bandOf((o?.hues ?? row.look.hues)[0]) : axes.colour === 'style' ? Math.max(0, styles.indexOf(styleOf(row, o))) : Math.max(0, Math.min(5, Math.round(m?.rating ?? 0)));
    const dot: Dot = { row, x: xOf(ax, box), y: yOf(ay, box), band };
    const k = m?.tune?.speed;
    if (k !== undefined && k > 0 && k !== 1 && (axes.across === 'speed' || axes.up === 'speed')) {
      dot.tuned = { speed: k, madeX: dot.x, madeY: dot.y };
      if (axes.across === 'speed') dot.x = xOf(tunedAt(ax, k), box);
      else dot.y = yOf(tunedAt(ay, k), box);
    }
    dots.push(dot);
  }
  return dots;
}

/** "Played at 0.5× speed, so it sits slower than measured": what the field says about a tuned preset; empty for one as made. */
export function tunedSays(d: Dot): string {
  if (!d.tuned) return '';
  // Faster is right across and up the box (smaller y).
  const shift = d.x - d.tuned.madeX + (d.tuned.madeY - d.y);
  const way = shift === 0 ? 'at the edge, as measured' : shift < 0 ? 'slower than measured' : 'faster than measured';
  return `Played at ${timesOf(d.tuned.speed)} speed, so it sits ${way}`;
}

/**
 * The marks of the presets the user has sped up or slowed down, as one path: a
 * fine ring round each, and a hairline back along the speed axis to where it
 * sits as made, stopping at the ring, ending in a small tick across it, so the
 * shift reads at a glance.
 */
export function tunedPath(dots: readonly Dot[]): string {
  const R = 2.8;
  let d = '';
  for (const { x, y, tuned } of dots) {
    if (!tuned) continue;
    d += `M${(x - R).toFixed(1)} ${y.toFixed(1)}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0`;
    const run = tuned.madeX - x;
    const rise = tuned.madeY - y;
    if (Math.abs(run) > R) d += `M${(x + Math.sign(run) * R).toFixed(1)} ${y.toFixed(1)}H${tuned.madeX.toFixed(1)}v-1.5v3`;
    else if (Math.abs(rise) > R) d += `M${x.toFixed(1)} ${(y + Math.sign(rise) * R).toFixed(1)}V${tuned.madeY.toFixed(1)}h-1.5h3`;
  }
  return d;
}

/** The dots as one path per colour group: each dot a zero-length segment that a round cap draws as a disc. */
export function bandPaths(dots: readonly Dot[]): { band: number; d: string }[] {
  const parts = new Map<number, string[]>();
  for (const d of dots) {
    let p = parts.get(d.band);
    if (!p) parts.set(d.band, (p = []));
    p.push(`M${d.x.toFixed(1)} ${d.y.toFixed(1)}h0`);
  }
  return [...parts.entries()].sort(([a], [b]) => a - b).map(([band, p]) => ({ band, d: p.join('') }));
}

/**
 * The trail's points: the dots of the presets at `paths` (each a `LibraryRow.path`, oldest
 * first), in that order; a path with no dot in the field is skipped, and so is one that
 * repeats the point before it.
 */
export function trailPoints(dots: readonly Dot[], paths: readonly string[]): { x: number; y: number }[] {
  const byPath = new Map<string, Dot>();
  for (const d of dots) if (!byPath.has(d.row.path)) byPath.set(d.row.path, d);
  const out: { x: number; y: number }[] = [];
  let last: Dot | null = null;
  for (const p of paths) {
    const d = byPath.get(p);
    if (!d || d === last) continue;
    out.push({ x: d.x, y: d.y });
    last = d;
  }
  return out;
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
