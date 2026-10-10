import { useId } from 'react';
import type { LibraryRow } from '../api.ts';
import { PresetTile, tileBy, tileName } from '../PresetTile.tsx';
import './section.css';

/**
 * One titled section of the main column ("Recently played", a playlist, a
 * style): its title, an action at its right ("See all"), and a row of today's
 * `PresetTile`s. A region named by its title. Stub: the sections lane draws
 * it (tiles of `--lay-tile`, `--lay-tile-gap` apart), keeping these props.
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
  /** Play a preset (a tile's click). */
  onPlay?(row: LibraryRow): void;
  /** What an empty section says. */
  empty?: string;
}

/** The section. */
export function Section({ title, action, rows, playing = null, starred = [], onPlay, empty = 'Nothing here yet' }: SectionProps) {
  const id = useId();
  return (
    <section className="sec" aria-labelledby={id}>
      <div className="sec-head">
        <h2 className="sec-title" id={id}>
          {title}
        </h2>
        {action && (
          <button type="button" className="sec-action" onClick={action.onPress}>
            {action.label}
          </button>
        )}
      </div>
      {rows.length ? (
        <ul className="sec-row">
          {rows.map((r) => (
            <PresetTile
              key={r.key}
              as="li"
              thumbnail={r.thumbnail}
              name={tileName(r.title, r.path)}
              by={tileBy(r.authors, r.style)}
              playing={r.path === playing}
              star={starred.includes(r.key)}
              onClick={onPlay && (() => onPlay(r))}
            />
          ))}
        </ul>
      ) : (
        <p className="sec-empty">{empty}</p>
      )}
    </section>
  );
}
