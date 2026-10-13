import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Layer } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Icon } from '../Icon/Icon';
import './PresetTile.css';

/**
 * The name a tile shows: the preset's title, or its file name (the path's base
 * name without `.milk`) when the title says nothing, being only a number or
 * empty (decision 68). A short real name ("Orb") stays.
 */
export function tileName(title: string, path: string): string {
  const t = title.trim();
  if (t && !/^[\d\s.,#_-]+$/.test(t)) return t;
  const base = path.split(/[\\/]/).pop() ?? '';
  const file = base.replace(/\.milk$/i, '').trim();
  return file || t;
}

/** The line under a tile's name: its authors joined with " & ", else its style. The index's "unknown" isn't an author: it says nothing a style wouldn't say better. */
export function tileBy(authors: readonly string[], style: string): string {
  const known = authors.filter((a) => a.trim() && a.trim().toLowerCase() !== 'unknown');
  return known.length ? known.join(' & ') : style;
}

export interface PresetTileProps extends HTMLAttributes<HTMLElement> {
  /** The element: a grid's option (`div`) or a strip's place (`li`). */
  as?: 'div' | 'li';
  thumbnail: string | null;
  /** What the empty picture says when there is no thumbnail; '' for nothing. */
  empty?: string;
  name: string;
  by: string;
  playing?: boolean;
  star?: boolean;
  /** More marks over the picture (the strip's number, "next", a failed mark, +). */
  marks?: ReactNode;
  /** After the labels: tools shown on hover (the strip's ✕). */
  tools?: ReactNode;
  /** Over the thumbnail, under the name: the preset moving while the pointer rests on it (the library's hover preview). */
  motion?: ReactNode;
}

/**
 * **Job.** One preset on the home (decision 68), the same in the library's grid and a playlist's
 * strip: a 16:9 picture, cover-cropped, with its name and author on the picture's foot over a soft
 * scrim. Playing shows green level bars before the name. Whatever else the element needs (role,
 * label, handlers, `data-` states) comes in as attributes.
 *
 * **Changed.** Classes are `vs-tile*` (the original's `tile*`) and no longer hang off `.home`: the
 * lab editor's tile is LibraryGrid's own. Nothing animates (principles, Motion): the hover lift and
 * the moving preview show at once, without the 140/160 ms transitions. The ink on the picture is
 * `--key-white` and the scrim `--key-black`, light over dark in every mode, as the picture is. The
 * marks' small dark chips (✓, +) keep their fill and drop the 6px blur: glass is only for floats.
 * The strip's states (`data-picked`, `data-next`, `data-missing`, `data-dragged`, `data-over`) are
 * keyed on the tile's own data attributes rather than Home's `.home-tile` class, so the strip only
 * passes them. Only three lines: the selection ring (`--text-1`), the focus ring
 * (`--vs-focus-ring`) and the playing mark (`--vs-playing`); the drop bar is in `--accent` (the
 * primary is selection and the active mark) where the original used amber, which is caution only.
 * The words on the picture (name, author, the empty picture's words, the star) are caption
 * `Text`s at the original's sizes and leadings, set in their knobs.
 *
 * **Kept.** The props, the element (`div` or `li`), the DOM order (picture, then tools), the
 * caption on the picture, the level bars, the star, `tileName` and `tileBy`.
 *
 * **Tuning knobs.** `--vs-tile-*`, on `.vs-tile`: `--vs-tile-radius` (the picture's 6px corners,
 * a hairline pair under `--radius-control`; the scale has no thumbnail radius), `--vs-tile-ink-2`
 * (the author's ink on the picture), `--vs-tile-shade` (the text's shadow), `--vs-tile-chip` (the ✓
 * chip's fill), `--vs-tile-ghost-radius` (the dragged tile's 4px picture corners) and `--vs-tile-label` (the line under the picture: 0, which LibraryGrid's
 * `homeLook` counts on).
 */
export function PresetTile({ as = 'div', thumbnail, empty = '', name, by, playing = false, star = false, marks, tools, motion, className, ...rest }: PresetTileProps) {
  return createElement(
    as,
    { ...rest, className: className ? `vs-tile ${className}` : 'vs-tile', 'data-playing': playing ? '' : undefined },
    <div className="vs-tile-pic">
      {thumbnail ? (
        <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : empty ? (
        <Text role="caption" className="vs-tile-none">
          {empty}
        </Text>
      ) : null}
      {motion}
      <span className="vs-tile-caption">
        <Text role="caption" className="vs-tile-name">
          {name}
        </Text>
        {by && (
          <Text role="caption" className="vs-tile-by">
            {by}
          </Text>
        )}
      </span>
      {playing && <PlayingMark />}
      {star && (
        <Text role="caption" className="vs-tile-star" aria-hidden="true">
          ★
        </Text>
      )}
      {marks}
    </div>,
    tools,
  );
}

/** The playing mark: a dark chip at the picture's foot, the transport's loop glyph and "Playing". */
function PlayingMark() {
  return (
    <Text role="caption" className="vs-tile-live" aria-hidden="true">
      <Icon name="loop" size={12} />
      Playing
    </Text>
  );
}

export interface TileGhostProps {
  /** Where the pointer is, in the page's px. */
  x: number;
  y: number;
  thumbnail: string | null;
  name: string;
  /** Over a place it can land: drawn at full strength. */
  ok?: boolean;
}

/**
 * **Job.** The preset being dragged, following the pointer: a small card (its picture and name)
 * lifted on the float layer, brighter over a place it can land.
 *
 * **Changed.** New here: the original drew this inside Home.tsx (`DragGhost`, home.css
 * `.home-ghost`) with its own glass fill, blur, edge and lift. Here it is a `Layer level="float"`,
 * so the theme's float layer gives all four, and it lives beside the tile it stands for.
 *
 * **Kept.** Fixed at the pointer plus 12px, out of the pointer's way and of what is read
 * (`aria-hidden`), 0.7 strength until it is over a target.
 */
export function TileGhost({ x, y, thumbnail, name, ok = false }: TileGhostProps) {
  return (
    <Layer level="float" className="vs-tile-ghost" data-ok={ok ? '' : undefined} aria-hidden="true" style={{ transform: `translate(${x + 12}px, ${y + 12}px)` } as CSSProperties}>
      {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
      <Text role="caption" className="vs-tile-ghost-name">
        {name}
      </Text>
    </Layer>
  );
}
