import { useMemo } from 'react';
import type { LibraryRow, Mine } from '../model/api';
import { axisOf } from '../model/field';
import type { Prepared } from '../model/librarySearch';
import { characterOf, fieldSays } from '../model/inspector-model';
import { useMapAxes } from '../model/mapPrefs';
import { Field } from './Field';
import './LibraryMapView.css';

export interface LibraryMapViewProps {
  /** What the grid would show (the source, narrowed by the search and the filter): every measured one is a dot. */
  rows: readonly LibraryRow[];
  /** The user's data by key: overrides, ratings and a preset's own speed move its dot. */
  mine?: Readonly<Record<string, Mine>>;
  /** The preset playing (lit, its hue and intensity on its ring), or null. */
  playing: Prepared | null;
  /** What the dots are, for a screen reader's name: "Starred", a playlist's name; the library's own name when left out. */
  source?: string;
  /** A dot picked (click, or Enter on the keyboard's cursor): the caller plays it, as a tile of the grid plays. */
  onPick(row: LibraryRow): void;
}

/**
 * **Job.** The library's Map view (wireframe B): in the grid's room under the hero, the Field over
 * what the grid would show, filling the room's height at the Field's 4:3, centred; across's and
 * up's pickers on its edges (colour's is in the library's head), the same axes as the inspector's
 * map and live mode's (`useMapAxes`). The preset playing is lit, hover names a dot, a click (or
 * Enter on the field's cursor) plays it.
 *
 * **Changed.** New. The inspector's `LibraryMap` always draws the whole library; this draws the
 * source as narrowed, so a search or a filter thins the dots.
 *
 * **Kept.** The Field, its keys, its tip and its words (`fieldSays`).
 *
 * **Tuning knobs** (LibraryMapView.css): `--vs-map-room-pickers`, the room the across picker and
 * the gaps take under the plot, so the plot's 4:3 fits the room's height.
 */
export function LibraryMapView({ rows, mine, playing, source, onPick }: LibraryMapViewProps) {
  const [axes, setAxes] = useMapAxes();
  const c = useMemo(() => (playing ? characterOf(playing) : null), [playing]);
  const drawn = useMemo(() => rows.reduce((n, r) => (r.look ? n + 1 : n), 0), [rows]);
  const by = `${axisOf(axes.across).label.toLowerCase()} and ${axisOf(axes.up).label.toLowerCase()}`;
  return (
    <div className="vs-map-room">
      <div className="vs-map-room-field">
        <Field
          library={rows}
          mine={mine}
          axes={axes}
          onAxes={setAxes}
          playing={playing?.row.key ?? null}
          intensity={c?.intensity.at ?? null}
          hue={c?.hues[0]?.css ?? 'var(--text-1)'}
          description={fieldSays(c, drawn, rows.length, [axes.across, axes.up])}
          name={source ? `${source} by ${by}` : undefined}
          onPick={onPick}
        />
      </div>
    </div>
  );
}
