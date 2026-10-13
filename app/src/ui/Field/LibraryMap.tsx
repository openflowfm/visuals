import { useMemo } from 'react';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { LibraryRow, Mine } from '../model/api';
import { axisOf, type AxisId, type MapAxes } from '../model/field';
import type { Prepared } from '../model/librarySearch';
import { characterOf, fieldSays } from '../model/inspector-model';
import { useMapAxes } from '../model/mapPrefs';
import { ColourPicker, Field } from './Field';
import './LibraryMap.css';

export interface LibraryMapProps {
  /** The library's rows: every measured one is a dot. */
  library: readonly LibraryRow[];
  /** The user's data by key: overrides, ratings and a preset's own speed move its dot. */
  mine?: Readonly<Record<string, Mine>>;
  /** The preset playing, with the user's data on it (its hue and how intense it is light its dot), or null when nothing plays. */
  playing: Prepared | null;
  /** A dot picked (click, or Enter on the keyboard's cursor): the caller plays it. */
  onPick(row: LibraryRow): void;
  /** The keys of several presets picked together, each ringed on the map (none or one: no rings). */
  marked?: readonly string[];
}

/** "Speed × Brightness": the axes the map shows, across × up. */
export const mapAxes = (axes: MapAxes): string => `${axisOf(axes.across).label} × ${axisOf(axes.up).label}`;

/** "9,791 presets", or "250 of 9,791 presets" while the index hasn't drawn them all. */
export function mapCount(drawn: number, total: number): string {
  const n = drawn.toLocaleString('en-US');
  return drawn >= total ? `${n} ${drawn === 1 ? 'preset' : 'presets'}` : `${n} of ${total.toLocaleString('en-US')} presets`;
}

/** What an axis places a dot by, as the help line says it. */
const BY: Record<AxisId, string> = {
  speed: 'how fast it moves',
  brightness: 'how bright it is',
  intensity: 'how intense it is',
  hue: 'its colour',
  colourfulness: 'how many colours it has',
  rating: 'your rating',
  style: 'its style',
};

/**
 * **Job.** The library map: the inspector region's bottom section, a plain part of the same
 * panel under the preset's details. Its heading says what it is ("Library map", how many presets
 * it draws and its axes, "Speed × Brightness") with the colour's picker beside the count, then
 * the Field under it at the region's width (its 4:3) with its axes' pickers. The choice of axes
 * and colour is the page's (`useMapAxes`): kept across restarts and shared with live mode's map.
 * It shows the whole library always, the preset playing lit with its ring, whatever the details
 * above it are about (the preset playing, a tile picked, several, a playlist, or nothing). A dot
 * played is the Field's `onPick`. With several picked (`marked`), each is ringed. With nothing playing, a line under the heading says what the
 * dots are and that a click plays one.
 *
 * **Changed.** The axes and the colour are a choice (pickers on the Field's edges and in the
 * heading); the heading's axes (`mapAxes`, was `MAP_AXES`), the help line and the Field's words
 * follow it. Before that: the field was a section inside the inspector's details, and is now its
 * own section, pinned under them, never giving way. It paints nothing: the panel's surface is
 * behind it, and a hairline in the ink (the Field's own markings' hairline) parts it from the
 * details.
 *
 * **Kept.** The Field, its words to a screen reader ("The library by speed and brightness" by
 * default), and the empty state's words.
 *
 * **Tuning knobs**
 * - `--vs-map-hair`: the hairline over the section.
 */
export function LibraryMap({ library, mine, playing, onPick, marked }: LibraryMapProps) {
  const [axes, setAxes] = useMapAxes();
  const c = useMemo(() => (playing ? characterOf(playing) : null), [playing]);
  const drawn = useMemo(() => library.reduce((n, r) => (r.look ? n + 1 : n), 0), [library]);
  return (
    <Group
      name="Library map"
      direction="column"
      gap={0}
      className="vs-map"
      aside={
        <span className="vs-map-head">
          <Text role="caption" tabular className="vs-map-aside">
            {mapCount(drawn, library.length)} · {mapAxes(axes)}
          </Text>
          <ColourPicker axes={axes} onAxes={setAxes} />
        </span>
      }
    >
      {!playing && (
        <Text as="p" role="caption" className="vs-map-help">
          Each dot is a preset, by {BY[axes.across]} and {BY[axes.up]}. Click one to play it.
        </Text>
      )}
      <Field
        library={library}
        mine={mine}
        axes={axes}
        onAxes={setAxes}
        playing={playing?.row.key ?? null}
        intensity={c?.intensity.at ?? null}
        hue={c?.hues[0]?.css ?? 'var(--text-1)'}
        description={fieldSays(c, drawn, library.length, [axes.across, axes.up])}
        marked={marked}
        onPick={onPick}
      />
    </Group>
  );
}
