import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LibraryRow } from '../api.ts';
import { PresetTile, tileBy, tileName } from '../PresetTile.tsx';
import { Icon } from './icons.tsx';
import { fitCount, sectionTileSays } from './sections-model.ts';
import './section.css';

/**
 * One titled section of the main column ("Recently played", a playlist, a
 * style): its title, an action at its right ("See all"), and one row of
 * today's `PresetTile`s. A region named by its title.
 *
 * The row shows as many tiles as fit its width at `--lay-tile`, `--lay-tile-gap`
 * apart, stretched to end on the column's edge, and leaves the rest out (they
 * aren't drawn, so the keyboard never lands on one out of sight): no wrap, no
 * sideways scroll. The action is where the rest are.
 */
export interface SectionProps {
  title: string;
  /** The action at the title's right, e.g. "See all"; none when the row shows them all. */
  action?: { label: string; onPress(): void };
  /** The presets, in order. */
  rows: readonly LibraryRow[];
  /** The path of the preset playing, whose tile shows it; null: none. */
  playing?: string | null;
  /** The keys of the starred presets. */
  starred?: readonly string[];
  /** Play a preset (a tile's click); without it the tiles are only pictures. */
  onPlay?(row: LibraryRow): void;
  /** What an empty section says. */
  empty?: string;
}

/** How many tiles the row at `el` fits, from its width and the `--lay-*` sizes it is laid out by; kept up as it resizes. */
function useFit(el: { current: HTMLElement | null }, watching: boolean): number {
  const [fit, setFit] = useState(Infinity);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !watching) return;
    const measure = () => {
      const css = getComputedStyle(node);
      const tile = parseFloat(css.getPropertyValue('--lay-tile'));
      const gap = parseFloat(css.columnGap);
      setFit(fitCount(node.clientWidth, tile, Number.isFinite(gap) ? gap : 0));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el, watching]);
  return fit;
}

/** Enter or Space plays, as a button's would. */
const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  run();
};

/** The section. */
export function Section({ title, action, rows, playing = null, starred = [], onPlay, empty = 'Nothing here yet' }: SectionProps) {
  const id = useId();
  const row = useRef<HTMLUListElement>(null);
  const fit = useFit(row, rows.length > 0);
  const shown = rows.slice(0, fit);
  return (
    <section className="sec" aria-labelledby={id}>
      <div className="sec-head">
        <h2 className="sec-title" id={id} title={title}>
          {title}
        </h2>
        {action && (
          <button type="button" className="sec-action" onClick={action.onPress}>
            {action.label}
            <Icon name="chevron-right" size={12} />
          </button>
        )}
      </div>
      {rows.length ? (
        <ul className="sec-row" ref={row} data-shown={shown.length} data-total={rows.length}>
          {shown.map((r) => {
            const on = r.path === playing;
            const star = starred.includes(r.key);
            const says = sectionTileSays(r, on, star);
            return (
              <li key={r.key} className="sec-cell">
                <PresetTile
                  className="sec-tile"
                  thumbnail={r.thumbnail}
                  empty={r.style}
                  name={tileName(r.title, r.path)}
                  by={tileBy(r.authors, r.style)}
                  playing={on}
                  star={star}
                  title={says}
                  {...(onPlay
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': says,
                        'aria-current': on ? 'true' : undefined,
                        onClick: () => onPlay(r),
                        onKeyDown: onActivate(() => onPlay(r)),
                      }
                    : {})}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sec-empty">{empty}</p>
      )}
    </section>
  );
}
