import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import './tile.css';

/**
 * The name a tile shows: the preset's title, or its file name (the path's base
 * name without `.milk`) when the title says nothing — only a number, or under
 * four characters (decision 68).
 */
export function tileName(title: string, path: string): string {
  const t = title.trim();
  if (t.length >= 4 && !/^[\d\s.,#_-]+$/.test(t)) return t;
  const base = path.split(/[\\/]/).pop() ?? '';
  const file = base.replace(/\.milk$/i, '').trim();
  return file || t;
}

/** The line under a tile's name: its authors joined with " & ", else its style. */
export const tileBy = (authors: readonly string[], style: string): string => (authors.length ? authors.join(' & ') : style);

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
}

/**
 * One preset on the home (decision 68), the same in the library's grid and a
 * playlist's strip: a 16:9 picture, cover-cropped, with its name and author
 * under it. Playing shows a green level badge on the picture and ▶ before the
 * name. Its look is tile.css; whatever else the element needs (role, label,
 * handlers, data- states) comes in as attributes.
 */
export function PresetTile({ as = 'div', thumbnail, empty = '', name, by, playing = false, star = false, marks, tools, className, ...rest }: PresetTileProps) {
  return createElement(
    as,
    { ...rest, className: className ? `tile ${className}` : 'tile', 'data-playing': playing ? '' : undefined },
    <div className="tile-pic">
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : empty ? <span className="tile-none">{empty}</span> : null}
      {star && (
        <span className="tile-star" aria-hidden="true">
          ★
        </span>
      )}
      {playing && <LevelMark />}
      {marks}
    </div>,
    <span className="tile-name">{name}</span>,
    <span className="tile-by">{by}</span>,
    tools,
  );
}

/** The playing mark: a few green bars on a dark chip, bottom left of the picture. */
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
