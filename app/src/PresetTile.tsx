import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import './tile.css';

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
 * One preset on the home (decision 68), the same in the library's grid and a
 * playlist's strip: a 16:9 picture, cover-cropped, with its name and author on
 * the picture's foot over a soft scrim. Playing shows green level bars before
 * the name. Its look is tile.css; whatever else the element needs (role, label,
 * handlers, data- states) comes in as attributes.
 */
export function PresetTile({ as = 'div', thumbnail, empty = '', name, by, playing = false, star = false, marks, tools, motion, className, ...rest }: PresetTileProps) {
  return createElement(
    as,
    { ...rest, className: className ? `tile ${className}` : 'tile', 'data-playing': playing ? '' : undefined },
    <div className="tile-pic">
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : empty ? <span className="tile-none">{empty}</span> : null}
      {motion}
      <span className="tile-caption">
        <span className="tile-name">
          {playing && <LevelMark />}
          {name}
        </span>
        {by && <span className="tile-by">{by}</span>}
      </span>
      {star && (
        <span className="tile-star" aria-hidden="true">
          ★
        </span>
      )}
      {marks}
    </div>,
    tools,
  );
}

/** The playing mark: a few green bars, before the name. */
function LevelMark() {
  return (
    <span className="tile-live" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
