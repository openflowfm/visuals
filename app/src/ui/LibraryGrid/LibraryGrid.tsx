import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { PresetTile, tileBy, tileName } from '../PresetTile/PresetTile';
import { tileFor, type Prepared } from '../model/librarySearch';
import { FAILED_SAYS, useFailedPresets } from '../model/survive';
import { useHoverPreview } from '../model/previews';
import './LibraryGrid.css';

/**
 * The narrowest a tile gets, the gap between tiles, the title line under a thumbnail
 * and the padding round the grid. Narrow enough for two across the 220 px library
 * column, less a scrollbar.
 */
export const TILE = { min: 84, gap: 6, label: 18, pad: 8 };

/** How a grid's tiles are spaced: the gaps between columns and rows, the labels under a picture, the padding, and the picture's height over its width. */
export interface Look {
  gap: number;
  rowGap: number;
  label: number;
  padX: number;
  /** The right padding, when not `padX`: the home's gives up to a scrollbar's width, so the bar sits in the gutter. */
  padRight?: number;
  padTop: number;
  padBottom: number;
  aspect: number;
  /** How much of the view's top a pinned region covers (the home's preview, which the grid scrolls behind): a row under it is out of view. Included in `padTop`. Default 0. */
  under?: number;
  /** How much of the view's bottom a pinned region covers (the home's transport bar, which the grid also scrolls behind): a row under it is out of view. Included in `padBottom`. Default 0. */
  over?: number;
}

/** The lab editor's column: `TILE`, 4:3 pictures with a title line. */
export const LAB_LOOK: Look = { gap: TILE.gap, rowGap: TILE.gap, label: TILE.label, padX: TILE.pad, padTop: TILE.pad, padBottom: TILE.pad, aspect: 3 / 4 };

/** The home's padding (`--mat-plate-inset`, the original's `--pad`) when it can't be read. */
export const HOME_PAD = 22;

/**
 * The home's look (decision 68): 16:9 pictures with their name and author on
 * the picture itself (PresetTile), so no label line under it; 12 px between
 * columns and rows alike, on the main pane's padding `pad`, with room above for
 * a ring and a lift. A scrollbar that takes room (`scrollbar` px: a classic one,
 * not an overlay) comes out of the right padding, so the columns don't change
 * with it (3 at 900 px). `under` px of the view's top are covered by the pinned preview the grid
 * scrolls behind (the home's `--vs-grid-reach`): the first row starts below it, and a row under
 * it counts as out of view. `over` px of its bottom are covered likewise by the pinned transport
 * bar (`--vs-grid-reach-down`): the last row comes to rest above it, and a row under it is out of view.
 */
export const homeLook = (pad: number = HOME_PAD, scrollbar = 0, under = 0, over = 0): Look => ({
  gap: 12,
  rowGap: 12,
  label: 0,
  padX: pad,
  padRight: Math.max(0, pad - scrollbar),
  padTop: 8 + under,
  padBottom: 22 + over,
  aspect: 9 / 16,
  ...(under ? { under } : {}),
  ...(over ? { over } : {}),
});

export interface Layout {
  columns: number;
  /** A tile's width; its thumbnail is 4:3 (16:9 on the home). */
  tile: number;
  /** A row of tiles, with the gap under it. */
  rowHeight: number;
  rows: number;
}

/** How `count` tiles at least `min` px wide lay out across `width` px (the grid's inner width, padding taken off). */
export function layout(width: number, count: number, min: number = TILE.min, look: Look = LAB_LOOK): Layout {
  const inner = Math.max(min, width - look.padX - (look.padRight ?? look.padX));
  const columns = Math.max(1, Math.floor((inner + look.gap) / (min + look.gap)));
  const tile = (inner - (columns - 1) * look.gap) / columns;
  const rowHeight = Math.round(tile * look.aspect + look.label + look.rowGap);
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
export function scrollFor(row: number, rowHeight: number, top: number, height: number, look: Look = LAB_LOOK): number | null {
  // The view's top `under` px are covered (the pinned preview) and its bottom `over` px (the pinned bar): what is visible lies between.
  const under = look.under ?? 0;
  const over = look.over ?? 0;
  const y = look.padTop + row * rowHeight;
  if (y < top + under) return Math.max(0, y - look.padTop);
  const bottom = y + rowHeight - look.rowGap + look.padTop - under;
  if (bottom > top + height - over) return bottom - (height - over);
  return null;
}

/**
 * Where to scroll so that `row` sits in the middle of a view `height` px tall (as
 * near as the top allows): how the playing tile is revealed. The view starts on a
 * whole row, so no row is cut off at the top; `row` lands as near the middle as that allows.
 */
export function centreFor(row: number, rowHeight: number, height: number, look: Look = LAB_LOOK): number {
  if (rowHeight <= 0) return 0;
  // In the middle of what is visible: below the `under` px a pinned preview covers and above the `over` px a pinned bar does.
  const under = look.under ?? 0;
  const over = look.over ?? 0;
  const middle = look.padTop - under + row * rowHeight + (rowHeight - look.rowGap) / 2;
  const first = Math.max(0, Math.round((middle - (height - under - over) / 2) / rowHeight));
  return Math.min(first, row) * rowHeight;
}

/**
 * How a tile was picked: a plain click or Enter (`load`: it plays, decision 71),
 * ⌘-click (add or take it out of the selection), ⇧-click (select up to it), or,
 * while quick add is on, a plain click or Enter (`add`: into the playlist, or out
 * of it when already in).
 */
export type Pick = 'load' | 'toggle' | 'range' | 'add';

/** What a click with these modifiers picks: a plain one loads, or while quick add is on (`adding`) adds, ⌥ then loading instead. */
export const pickOf = (ev: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }, adding = false): Pick =>
  ev.shiftKey ? 'range' : ev.metaKey || ev.ctrlKey ? 'toggle' : adding && !ev.altKey ? 'add' : 'load';

/** The selection (keys) after the tile at `index` in `shown` is picked by `how`; a run starts at `anchor`. An add leaves it as it was. */
export function pickInto(selection: readonly string[], shown: readonly Prepared[], index: number, how: Pick, anchor: string | null): string[] {
  const key = shown[index].row.key;
  if (how === 'add') return [...selection];
  if (how === 'load') return [key];
  if (how === 'toggle') return selection.includes(key) ? selection.filter((k) => k !== key) : [...selection, key];
  const from = anchor === null ? -1 : shown.findIndex((p) => p.row.key === anchor);
  if (from < 0) return [key];
  const [a, b] = from < index ? [from, index] : [index, from];
  // The run is rebuilt from the anchor each time, so moving back towards it shrinks it.
  return shown.slice(a, b + 1).map((p) => p.row.key);
}

/** The anchor a ⇧ pick runs from: the one set, or (the first time) the highlighted tile. */
export function rangeAnchor(anchor: string | null, active: string | null, shown: readonly Prepared[]): string | null {
  if (anchor !== null && shown.some((p) => p.row.key === anchor)) return anchor;
  return active;
}

/** True the first time the grid has both a measured size and rows, when the playing tile is revealed again. */
export const firstLaidOut = (done: boolean, width: number, rows: number): boolean => !done && width > 0 && rows > 0;

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
  /** A press on a tile that may become a drag (onto a playlist, on the home); none makes tiles plain. */
  onPress?(index: number, ev: PointerEvent): void;
  /** The narrowest a tile gets, in px; `TILE.min` (two across the library column) by default. */
  tileMin?: number;
  /** The home's grid (decision 71): its hint says a click plays; without it, the lab editor's column ("Enter loads"). */
  home?: boolean;
  /**
   * Quick add on (the home): the playlist a plain click or Enter adds a tile to, and
   * the paths already in it, which show ✓ and a click takes out; Space or ⌥-click
   * plays. Null or left out: off.
   */
  adding?: { name: string; has: ReadonlySet<string> } | null;
  /** The id of the panel its picks show (the home's inspector), as the grid's `aria-controls`. */
  controls?: string;
}

/** How the grid is used: the lab editor's column (`load`), the home's (`play`), or the home's while quick add is on (`add`). */
export type GridUse = 'load' | 'play' | 'add';

/** The grid's spoken hint: how its keys and clicks pick. */
export const gridHint = (use: GridUse, into: string | null): string =>
  use === 'add'
    ? `click or Enter adds to ${into ?? 'the playlist'} or takes out one already in it, Space or ⌥-click plays, arrows move, ⌘-click selects, ⇧ selects a run, Esc is done`
    : `${use === 'play' ? 'click or Enter plays, arrows move' : 'arrows move, Enter loads'}, Space or ⌘-click selects more, ⇧ selects a run, Esc lets go${into !== null ? `, + or A adds to ${into}` : ''}`;

/**
 * **Job.** The library as a grid of thumbnails, drawing only the rows in view (and a few either
 * side), so the whole pack scrolls without a cap. The grid is one tab stop and moves a highlighted
 * tile with `aria-activedescendant`; arrows move by a tile or a row, Enter loads, Space adds the
 * tile to the selection. Every key it handles is `preventDefault`ed and stopped; Escape with
 * nothing selected is let through.
 *
 * **Changed.** The home's look is chosen by sitting inside the app's root (`.vs-root`, the
 * original's `.app.home`), on the main column's padding `--mat-plate-inset` (was `--pad`); the lab
 * editor isn't part of this port, so its 4:3 column is kept only for a grid outside the root.
 * Classes are `vs-lib-grid*`. The lab tile's lines go (near borderless): no picture edge, the
 * selection ring in the ink rather than amber (caution only), playing as a green ▶. The tile's +
 * is the core `ButtonFace`. Nothing animates.
 *
 * **Kept.** Every export and its maths, the props, the keyboard (`tileFor`, Enter, Space, + / A,
 * Esc), focus (one tab stop, the playing tile or the first highlighted on focus), the reveal and
 * reflow rules, the hover preview, roles, labels, hints and copy.
 *
 * **Tuning knobs** (LibraryGrid.css): `--vs-grid-reach` (unitless px, set by Home.css): how far
 * the grid reaches up behind the home's pinned preview; the first row starts below it, and
 * keeping a tile in view (`scrollFor`, `centreFor`) counts that much of the top as covered.
 * `--vs-grid-head` (a length, set by Home.css): the library's head row laid over the grid's top
 * under the preview, counted with the reach. `--vs-grid-reach-down` likewise: how far it reaches down behind the home's pinned transport
 * bar; the last row comes to rest above it, and that much of the bottom counts as covered.
 */
export function LibraryGrid({ rows, active, selected, current, into, onMove, onPick, onAdd, onClear, reveal, onPress, tileMin, home: homeGrid = false, adding = null, controls }: LibraryGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Its size, and whether it is on the home (decision 68's look, on the main pane's `--mat-plate-inset`) or in the lab editor's column.
  const [size, setSize] = useState({ width: 0, height: 0, home: false, pad: HOME_PAD, bar: 0, under: 0, over: 0 });
  // The first row in view: state changes only when a scroll crosses a row.
  const [topRow, setTopRow] = useState(0);
  // The tile the pointer is on (its key), whose preset moves in it on the home (`useHoverPreview`).
  const [hovered, setHovered] = useState<string | null>(null);
  const onHover = useCallback((key: string, on: boolean) => setHovered((h) => (on ? key : h === key ? null : h)), []);
  const failed = useFailedPresets();
  const look = useMemo(() => (size.home ? homeLook(size.pad, size.bar, size.under, size.over) : LAB_LOOK), [size.home, size.pad, size.bar, size.under, size.over]);
  const lay = layout(size.width, rows.length, tileMin, look);
  const { first, last } = windowOf(topRow * lay.rowHeight, size.height, lay.rowHeight, lay.rows);
  // The measure below, for a render that changes the tile size in the same commit as the grid's width.
  const remeasure = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const home = el.closest<HTMLElement>('.vs-root');
      // The grid inherits the inset; read where the theme sets it too, for a DOM that doesn't inherit custom properties (happy-dom).
      const read = home ? parseFloat(getComputedStyle(el).getPropertyValue('--mat-plate-inset') || getComputedStyle(home).getPropertyValue('--mat-plate-inset')) : NaN;
      const pad = Number.isFinite(read) ? read : HOME_PAD;
      // A scrollbar that takes room (none when it overlays): the home's grid gives it from its right padding.
      const bar = Math.max(0, el.offsetWidth - el.clientWidth);
      // How far it reaches up behind the home's pinned preview (`--vs-grid-reach`, unitless px; Home.css), and behind the
      // library's head row over it (`--vs-grid-head`, a length Home.css registers, so it reads as px).
      const reached = home ? parseFloat(getComputedStyle(el).getPropertyValue('--vs-grid-reach')) : NaN;
      const headed = home ? parseFloat(getComputedStyle(el).getPropertyValue('--vs-grid-head')) : NaN;
      const under = (Number.isFinite(reached) && reached > 0 ? reached : 0) + (Number.isFinite(headed) && headed > 0 ? headed : 0);
      // And down behind its pinned transport bar (`--vs-grid-reach-down`).
      const down = home ? parseFloat(getComputedStyle(el).getPropertyValue('--vs-grid-reach-down')) : NaN;
      const over = Number.isFinite(down) && down > 0 ? down : 0;
      setSize((s) =>
        s.width === el.clientWidth && s.height === el.clientHeight && s.home === !!home && s.pad === pad && s.bar === bar && s.under === under && s.over === over
          ? s
          : { width: el.clientWidth, height: el.clientHeight, home: !!home, pad, bar, under, over },
      );
    };
    measure();
    remeasure.current = measure;
    if (typeof ResizeObserver === 'undefined') return;
    // A resize lays the tiles out again before the frame paints (an observer runs after layout,
    // before paint, and flushSync commits there), so a sidebar closing never paints a frame of
    // the old width's layout: with the pane's new tile size on the old width the window held
    // fewer tiles, the rest unmounted, and they came back a frame later with their thumbnails
    // still loading, which read as the grid blinking out and back.
    const ro = new ResizeObserver(() => flushSync(measure));
    ro.observe(el);
    return () => {
      remeasure.current = null;
      ro.disconnect();
    };
  }, []);
  // The pane's tile size changes in the same commit as the width the screen gives it (the sidebar
  // closing): measure the new width now, before paint, rather than lay the new size on the old.
  useLayoutEffect(() => remeasure.current?.(), [tileMin]);

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
      const to = scrollFor(Math.floor(index / lay.columns), lay.rowHeight, el.scrollTop, el.clientHeight, look);
      if (to !== null) el.scrollTop = to;
    },
    [lay.columns, lay.rowHeight, look],
  );

  // Since the playing tile was last revealed, has the viewer scrolled or moved by key? Then a reflow leaves the view where they put it.
  const touched = useRef(false);
  const revealPlaying = useCallback(() => {
    const el = ref.current;
    const index = current === null ? -1 : rows.findIndex((p) => p.row.path === current);
    if (!el || index < 0) return;
    el.scrollTop = centreFor(Math.floor(index / lay.columns), lay.rowHeight, el.clientHeight, look);
    touched.current = false;
  }, [current, rows, lay.columns, lay.rowHeight, look]);

  // Keep the highlighted tile in view as it moves, or as the grid reflows: the least scroll that shows it.
  useEffect(() => show(active), [active, show]);

  // Bring the playing tile into the middle of the view when asked.
  useEffect(() => {
    if (reveal) revealPlaying();
  }, [reveal]); // only when asked, not on every filter change

  // On first mount the grid has no size yet, so reveal again once it has one and rows,
  // and again as the rows change height (the window resized, the home's look measured),
  // which would otherwise leave the playing row cut off at the top.
  const laidOut = useRef(false);
  const revealedAt = useRef(0);
  useEffect(() => {
    if (firstLaidOut(laidOut.current, size.width, rows.length)) laidOut.current = true;
    else if (!laidOut.current || revealedAt.current === lay.rowHeight || touched.current) return;
    revealedAt.current = lay.rowHeight;
    revealPlaying();
  }, [size.width, rows.length, lay.rowHeight]); // not on `current`: the reveal effect above follows that

  // New rows (a new filter, or the index read in place of the plain list) start at the
  // top, unless the viewer hasn't moved since the playing tile was revealed and it is
  // still among them: then it stays in the middle (the index arriving after the first
  // reveal used to throw the view back to the top, the playing row out of sight).
  const firstKey = rows[0]?.row.key;
  useEffect(() => {
    if (active >= 0 || !ref.current || !laidOut.current || !rows.length) return;
    if (!touched.current && current !== null && rows.some((p) => p.row.path === current)) return revealPlaying();
    ref.current.scrollTop = 0;
    touched.current = true;
  }, [rows.length, firstKey]);

  const id = (i: number) => `lib-tile-${i}`;
  const page = Math.max(1, Math.floor((size.height - (look.under ?? 0) - (look.over ?? 0)) / Math.max(1, lay.rowHeight)));
  const touch = () => void (touched.current = true);

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return; // keys on the grid itself, not a tile's + button
    touch();
    const to = tileFor(ev.key, active, rows.length, lay.columns, page);
    if (to !== null) {
      // ⇧ extends the run from the anchor (a pick also moves); a plain move lets the anchor go.
      if (to >= 0) {
        if (ev.shiftKey) onPick(to, 'range');
        else onMove(to);
      }
    } else if (ev.key === 'Enter' && active >= 0) {
      onPick(active, adding ? 'add' : 'load');
    } else if (ev.key === ' ' && active >= 0) {
      // While quick add is on, Space plays the tile (a click adds it).
      onPick(active, adding ? 'load' : 'toggle');
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

  // A hovered tile scrolled out (or gone from the rows) unmounts without a mouseleave: forget it, so it never starts a preview with no pointer on it when it comes back.
  const shownFrom = first * lay.columns;
  const shownTo = Math.min(rows.length, (last + 1) * lay.columns);
  useEffect(() => {
    if (hovered === null) return;
    let shown = false;
    for (let i = shownFrom; i < shownTo && !shown; i++) shown = rows[i].row.key === hovered;
    if (!shown) setHovered(null);
  }, [hovered, rows, shownFrom, shownTo]);

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
          failed={failed.has(p.row.path)}
          intoName={into?.name ?? null}
          onPick={onPick}
          onAdd={onAdd}
          onPress={onPress}
          home={size.home}
          adding={!!adding}
          addedTo={adding?.has.has(p.row.path) ? adding.name : null}
          hovered={hovered === p.row.key}
          onHover={onHover}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      className="vs-lib-grid"
      role="listbox"
      aria-label="presets"
      aria-multiselectable
      aria-controls={controls}
      tabIndex={rows.length ? 0 : -1}
      aria-activedescendant={active >= 0 && active < rows.length ? id(active) : undefined}
      data-hint={adding ? gridHint('add', adding.name) : gridHint(homeGrid ? 'play' : 'load', into?.name ?? null)}
      data-adding={adding ? '' : undefined}
      onKeyDown={onKey}
      onFocus={onFocus}
      onScroll={onScroll}
      onWheel={touch}
      onPointerDown={touch}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="vs-lib-grid-space" role="presentation" style={{ height: lay.rows * lay.rowHeight + look.padTop + look.padBottom - look.rowGap }}>
        <div
          className="vs-lib-grid-window"
          role="presentation"
          style={{
            transform: `translateY(${first * lay.rowHeight}px)`,
            gridTemplateColumns: `repeat(${lay.columns}, minmax(0, 1fr))`,
            gridAutoRows: `${lay.rowHeight - look.rowGap}px`,
            gap: look.rowGap === look.gap ? `${look.gap}px` : `${look.rowGap}px ${look.gap}px`,
            padding: look === LAB_LOOK ? `${TILE.pad}px` : `${look.padTop}px ${look.padRight ?? look.padX}px ${look.padBottom}px ${look.padX}px`,
          }}
        >
          {tiles}
        </div>
      </div>
    </div>
  );
}

export interface TileProps {
  id: string;
  index: number;
  p: Prepared;
  active: boolean;
  selected: boolean;
  playing: boolean;
  /** The preset failed to open or draw (and its file hasn't changed since), so live mode skips it. */
  failed: boolean;
  intoName: string | null;
  onPick(index: number, how: Pick): void;
  onAdd(index: number): void;
  onPress?(index: number, ev: PointerEvent): void;
  /** On the home: the shared tile (PresetTile, decision 68); otherwise the lab editor's own. */
  home?: boolean;
  /** Quick add is on: a plain click adds it (or takes it out), ⌥-click plays it. */
  adding?: boolean;
  /** The playlist quick add fills, when the preset is already in it: it shows ✓. */
  addedTo?: string | null;
  /** The pointer is on it: on the home, its preset moves in it (the hover preview). */
  hovered?: boolean;
  /** The pointer came onto (true) or left (false) the tile with key `key`. */
  onHover?(key: string, on: boolean): void;
}

/** The hovered tile's preset, moving: a canvas over the thumbnail, shown once its first picture is in. */
export function TileMotion({ path }: { path: string }) {
  const { ref, drawn } = useHoverPreview(path);
  return <canvas ref={ref} className="vs-tile-motion" data-drawn={drawn ? '' : undefined} aria-hidden="true" />;
}

/** What a tile says when pointed at, and to a screen reader: title, style and authors, then what's true of it now (in the playlist quick add fills, `addedTo`). */
export function tileSays(p: Prepared, playing: boolean, failed: boolean, addedTo: string | null = null): string {
  const full = `${p.title} — ${p.subStyle ? `${p.style} › ${p.subStyle}` : p.style}${p.authors.length ? `, by ${p.authors.join(' & ')}` : ''}`;
  return [full, playing && 'playing', addedTo !== null && `in ${addedTo}`, failed && FAILED_SAYS, p.star && 'starred', p.hidden && 'never played'].filter(Boolean).join(' · ');
}

/** One preset: its thumbnail (or its style, when it has none) and its title. */
export const Tile = memo(function Tile({
  id,
  index,
  p,
  active,
  selected,
  playing,
  failed,
  intoName,
  onPick,
  onAdd,
  onPress,
  home = false,
  adding = false,
  addedTo = null,
  hovered = false,
  onHover,
}: TileProps) {
  const says = tileSays(p, playing, failed, addedTo);
  // A double-click's second click does nothing more: the first already played it (or added it, which a second would undo).
  const click = (ev: MouseEvent) => ev.detail < 2 && onPick(index, pickOf(ev, adding));
  if (home) {
    const add = `add “${p.title}” to ${intoName} (+ key)`;
    return (
      <PresetTile
        id={id}
        role="option"
        aria-selected={selected}
        aria-label={says}
        data-active={active ? '' : undefined}
        data-hidden={p.hidden ? '' : undefined}
        data-failed={failed ? '' : undefined}
        data-added={addedTo !== null ? '' : undefined}
        title={says}
        onClick={click}
        onPointerDown={onPress && ((ev: PointerEvent) => onPress(index, ev))}
        onMouseEnter={onHover && (() => onHover(p.row.key, true))}
        onMouseLeave={onHover && (() => onHover(p.row.key, false))}
        motion={hovered ? <TileMotion path={p.row.path} /> : undefined}
        thumbnail={p.row.thumbnail}
        empty={p.style}
        name={tileName(p.title, p.row.path)}
        by={tileBy(p.authors, p.style)}
        playing={playing}
        star={p.star}
        marks={
          <>
            {failed && (
              <Text weight="strong" className="vs-tile-failed" aria-hidden="true">
                !
              </Text>
            )}
            {addedTo !== null && (
              <Text weight="strong" leading="tight" className="vs-tile-added" aria-hidden="true">
                ✓
              </Text>
            )}
            {intoName !== null && (
              // Out of the tab order and what is read: the grid is one tab stop, and + on the grid adds the active tile.
              <Text
                as="button"
                leading="tight"
                type="button"
                className="vs-tile-add"
                tabIndex={-1}
                aria-hidden="true"
                aria-label={add}
                title={add}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onAdd(index);
                }}
              >
                +
              </Text>
            )}
            {adding && addedTo === null && (
              // The cue that a click adds, shown on hover over the + (a click on it is the tile's).
              <Text leading="tight" className="vs-lib-cue" aria-hidden="true">
                +
              </Text>
            )}
          </>
        }
      />
    );
  }
  return (
    <div
      id={id}
      className="vs-lib-tile"
      role="option"
      aria-selected={selected}
      aria-label={says}
      data-active={active ? '' : undefined}
      data-playing={playing ? '' : undefined}
      data-hidden={p.hidden ? '' : undefined}
      data-failed={failed ? '' : undefined}
      title={says}
      onClick={click}
      onPointerDown={onPress && ((ev) => onPress(index, ev))}
    >
      <div className="vs-lib-thumb">
        {p.row.thumbnail ? (
          <img src={p.row.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <Text size="caption" leading="normal" className="vs-lib-thumb-none">
            {p.style}
          </Text>
        )}
        {p.star && (
          <Text size="caption" leading="normal" className="vs-lib-star" aria-hidden="true">
            ★
          </Text>
        )}
        {failed && (
          <Text weight="strong" className="vs-lib-failed" aria-hidden="true">
            !
          </Text>
        )}
        {playing && (
          <Text leading="normal" className="vs-lib-playing" aria-hidden="true">
            ▶
          </Text>
        )}
      </div>
      <Text size="caption" leading="normal" className="vs-lib-title">
        {p.title}
      </Text>
      {intoName !== null && (
        // Out of the tab order: the grid is one tab stop, and + on the grid adds the active tile.
        <div className="vs-lib-add" aria-hidden="true">
          <ButtonFace
            tone="quiet"
            size="small"
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
