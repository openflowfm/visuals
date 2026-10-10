/**
 * The sums behind a section of the macOS layout (Section.tsx), kept apart from
 * the component so they can be tested in node: how many tiles a row fits, and
 * what a tile says to a screen reader.
 */
import type { LibraryRow } from '../api.ts';
import { tileName } from '../PresetTile.tsx';

/**
 * How many tiles fit across a row `width` px wide, each at least `tile` px,
 * `gap` px apart: the count CSS's `repeat(auto-fill, minmax(tile, 1fr))`
 * makes, and never under one. Unmeasured (a width of 0, as in a DOM without
 * layout): every tile, `Infinity`.
 */
export function fitCount(width: number, tile: number, gap: number): number {
  if (!(width > 0) || !(tile > 0)) return Infinity;
  return Math.max(1, Math.floor((width + Math.max(0, gap)) / (tile + Math.max(0, gap))));
}

/**
 * What a section's tile says when pointed at, and to a screen reader, in the
 * library grid's words (LibraryGrid's `tileSays`): its name, style and
 * authors, then what's true of it now.
 */
export function sectionTileSays(row: LibraryRow, playing: boolean, starred: boolean): string {
  const authors = row.authors.filter((a) => a.trim() && a.trim().toLowerCase() !== 'unknown');
  const style = row.sub_style ? `${row.style} › ${row.sub_style}` : row.style;
  const full = `${tileName(row.title, row.path)} — ${style}${authors.length ? `, by ${authors.join(' & ')}` : ''}`;
  return [full, playing && 'playing', starred && 'starred'].filter(Boolean).join(' · ');
}
