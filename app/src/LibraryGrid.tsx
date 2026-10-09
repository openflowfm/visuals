import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { tileFor, type Prepared } from './librarySearch.ts';

/**
 * The narrowest a tile gets, the gap between tiles, the title line under a thumbnail
 * and the padding round the grid. Narrow enough for two across the 220 px library
 * column, less a scrollbar.
 */
export const TILE = { min: 84, gap: 6, label: 18, pad: 8 };

export interface Layout {
  columns: number;
  /** A tile's width; its thumbnail is 4:3. */
  tile: number;
  /** A row of tiles, with the gap under it. */
  rowHeight: number;
  rows: number;
}

/** How `count` tiles lay out across `width` px (the grid's inner width, padding taken off). */
export function layout(width: number, count: number): Layout {
  const inner = Math.max(TILE.min, width - 2 * TILE.pad);
  const columns = Math.max(1, Math.floor((inner + TILE.gap) / (TILE.min + TILE.gap)));
  const tile = (inner - (columns - 1) * TILE.gap) / columns;
  const rowHeight = Math.round((tile * 3) / 4 + TILE.label + TILE.gap);
  return { columns, tile, rowHeight, rows: Math.ceil(count / columns) };
}

/** The rows to draw (`first` to `last`, inclusive) for a view `height` px tall scrolled to `top`, with `overscan` rows either side. */
export function windowOf(top: number, height: number, rowHeight: number, rows: number, overscan = 3): { first: number; last: number } {
  if (rows <= 0 || rowHeight <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(rows - 1, Math.ceil((top + Math.max(height, rowHeight)) / rowHeight) + overscan);
  return { first, last };
}

/** Where to scroll so that `row` is fully in a view `height` px tall now at `top`; null when it already is. */
export function scrollFor(row: number, rowHeight: number, top: number, height: number): number | null {
  const y = TILE.pad + row * rowHeight;
  if (y < top) return Math.max(0, y - TILE.pad);
  const bottom = y + rowHeight - TILE.gap + TILE.pad;
  if (bottom > top + height) return bottom - height;
  return null;
}

/** How a tile was picked: a plain click, ⌘-click (add or take it out of the selection), or ⇧-click (select up to it). */
export type Pick = 'load' | 'toggle' | 'range';

export const pickOf = (ev: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): Pick => (ev.shiftKey ? 'range' : ev.metaKey || ev.ctrlKey ? 'toggle' : 'load');

/** The selection (keys) after the tile at `index` in `shown` is picked by `how`; a run starts at `anchor`. */
export function pickInto(selection: readonly string[], shown: readonly Prepared[], index: number, how: Pick, anchor: string | null): string[] {
  const key = shown[index].row.key;
  if (how === 'load') return [key];
  if (how === 'toggle') return selection.includes(key) ? selection.filter((k) => k !== key) : [...selection, key];
  const from = anchor === null ? -1 : shown.findIndex((p) => p.row.key === anchor);
  if (from < 0) return [key];
  const [a, b] = from < index ? [from, index] : [index, from];
  const run = shown.slice(a, b + 1).map((p) => p.row.key);
  return [...selection.filter((k) => !run.includes(k)), ...run];
}

export interface LibraryGridProps {
  rows: Prepared[];
  /** The highlighted tile (keyboard), or -1. */
  active: number;
  /** Keys of the selected presets. */
  selected: ReadonlySet<string>;
  /** Path of the preset playing. */
  current: string | null;
  /** The playlist + adds to; null hides +. */
  into: { name: string } | null;
  onMove(index: number): void;
  onPick(index: number, how: Pick): void;
  onAdd(index: number): void;
  /** Escape: let go of the selection. */
  onClear(): void;
  /** Bumped to bring the playing preset into view. */
  reveal: number;
}

/**
 * The library as a grid of thumbnails, drawing only the rows in view (and a few
 * either side), so the whole pack scrolls without a cap.
 *
 * The grid is one tab stop and moves a highlighted tile with `aria-activedescendant`;
 * arrows move by a tile or a row, Enter loads, Space adds the tile to the selection.
 */
export function LibraryGrid({ rows, active, selected, current, into, onMove, onPick, onAdd, onClear, reveal }: LibraryGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The first row in view: state changes only when a scroll crosses a row.
  const [topRow, setTopRow] = useState(0);
  const lay = layout(size.width, rows.length);
  const { first, last } = windowOf(topRow * lay.rowHeight, size.height, lay.rowHeight, lay.rows);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (el) setTopRow(Math.floor(el.scrollTop / lay.rowHeight));
  };
  // A reflow changes the row height, and so which row is at the top.
  useLayoutEffect(onScroll, [lay.rowHeight]);

  const show = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el || index < 0) return;
      const to = scrollFor(Math.floor(index / lay.columns), lay.rowHeight, el.scrollTop, el.clientHeight);
      if (to !== null) el.scrollTop = to;
    },
    [lay.columns, lay.rowHeight],
  );

  // Keep the highlighted tile in view as it moves, or as the grid reflows.
  useEffect(() => show(active), [active, show]);

  // Bring the playing tile into view when asked.
  useEffect(() => {
    if (reveal && current !== null) show(rows.findIndex((p) => p.row.path === current));
  }, [reveal]); // only when asked, not on every filter change

  // A new filter starts at the top.
  const firstKey = rows[0]?.row.key;
  useEffect(() => {
    if (active < 0 && ref.current) ref.current.scrollTop = 0;
  }, [rows.length, firstKey]);

  const id = (i: number) => `lib-tile-${i}`;
  const page = Math.max(1, Math.floor(size.height / Math.max(1, lay.rowHeight)));

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return; // keys on the grid itself, not a tile's + button
    const to = tileFor(ev.key, active, rows.length, lay.columns, page);
    if (to !== null) {
      if (to >= 0) onMove(to);
      if (ev.shiftKey && to >= 0) onPick(to, 'range');
    } else if (ev.key === 'Enter' && active >= 0) {
      onPick(active, 'load');
    } else if (ev.key === ' ' && active >= 0) {
      onPick(active, 'toggle');
    } else if ((ev.key === '+' || ev.key === 'a' || ev.key === 'A') && active >= 0 && into) {
      onAdd(active);
    } else if (ev.key === 'Escape' && selected.size) {
      onClear();
    } else {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onFocus = (ev: FocusEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget || active >= 0 || !rows.length) return;
    const playing = current === null ? -1 : rows.findIndex((p) => p.row.path === current);
    onMove(playing >= 0 ? playing : 0);
  };

  const tiles = [];
  for (let r = first; r <= last; r++) {
    for (let c = 0; c < lay.columns; c++) {
      const i = r * lay.columns + c;
      if (i >= rows.length) break;
      const p = rows[i];
      tiles.push(
        <Tile
          key={p.row.key}
          id={id(i)}
          index={i}
          p={p}
          active={i === active}
          selected={selected.has(p.row.key)}
          playing={p.row.path === current}
          intoName={into?.name ?? null}
          onPick={onPick}
          onAdd={onAdd}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      className="lib-grid"
      role="listbox"
      aria-label="presets"
      aria-multiselectable
      tabIndex={rows.length ? 0 : -1}
      aria-activedescendant={active >= 0 && active < rows.length ? id(active) : undefined}
      data-hint={`arrows move, Enter loads, Space or ⌘-click selects more, ⇧ selects a run, Esc lets go${into ? `, + or A adds to ${into.name}` : ''}`}
      onKeyDown={onKey}
      onFocus={onFocus}
      onScroll={onScroll}
    >
      <div className="lib-grid-space" role="presentation" style={{ height: lay.rows * lay.rowHeight + TILE.pad * 2 - TILE.gap }}>
        <div
          className="lib-grid-window"
          role="presentation"
          style={{
            transform: `translateY(${first * lay.rowHeight}px)`,
            gridTemplateColumns: `repeat(${lay.columns}, minmax(0, 1fr))`,
            gridAutoRows: `${lay.rowHeight - TILE.gap}px`,
            gap: `${TILE.gap}px`,
            padding: `${TILE.pad}px`,
          }}
        >
          {tiles}
        </div>
      </div>
    </div>
  );
}

interface TileProps {
  id: string;
  index: number;
  p: Prepared;
  active: boolean;
  selected: boolean;
  playing: boolean;
  intoName: string | null;
  onPick(index: number, how: Pick): void;
  onAdd(index: number): void;
}

/** One preset: its thumbnail (or its style, when it has none) and its title. */
const Tile = memo(function Tile({ id, index, p, active, selected, playing, intoName, onPick, onAdd }: TileProps) {
  const full = `${p.title} — ${p.subStyle ? `${p.style} › ${p.subStyle}` : p.style}${p.authors.length ? `, by ${p.authors.join(' & ')}` : ''}`;
  const says = [full, playing && 'playing', p.star && 'starred', p.hidden && 'never played'].filter(Boolean).join(' · ');
  return (
    <div
      id={id}
      className="lib-tile"
      role="option"
      aria-selected={selected}
      data-active={active ? '' : undefined}
      data-playing={playing ? '' : undefined}
      data-hidden={p.hidden ? '' : undefined}
      title={says}
      onClick={(ev: MouseEvent) => onPick(index, pickOf(ev))}
    >
      <div className="lib-thumb">
        {p.row.thumbnail ? <img src={p.row.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="lib-thumb-none">{p.style}</span>}
        {p.star && (
          <span className="lib-star" aria-hidden="true">
            ★
          </span>
        )}
      </div>
      <span className="lib-title">{p.title}</span>
      {intoName !== null && (
        // Out of the tab order: the grid is one tab stop, and + on the grid adds the active tile.
        <div className="wdg wdg-button lib-add">
          <ButtonFace
            tone="quiet"
            tabIndex={-1}
            aria-label={`add “${p.title}” to ${intoName} (+ key)`}
            title={`add “${p.title}” to ${intoName} (+ key)`}
            onClick={(ev) => {
              ev.stopPropagation();
              onAdd(index);
            }}
          >
            +
          </ButtonFace>
        </div>
      )}
    </div>
  );
});
