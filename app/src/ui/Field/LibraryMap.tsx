import { useMemo } from 'react';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { LibraryRow, Mine } from '../model/api';
import type { Prepared } from '../model/librarySearch';
import { characterOf, fieldSays } from '../model/inspector-model';
import { Field } from './Field';
import './LibraryMap.css';

export interface LibraryMapProps {
  /** The library's rows: every measured one is a dot. */
  library: readonly LibraryRow[];
  /** The user's data by key: overrides and a preset's own speed move its dot. */
  mine?: Readonly<Record<string, Mine>>;
  /** The preset playing, with the user's data on it (its hue and how intense it is light its dot), or null when nothing plays. */
  playing: Prepared | null;
  /** A dot picked (click, or Enter on the keyboard's cursor): the caller plays it. */
  onPick(row: LibraryRow): void;
}

/** "Speed × Brightness": the axes the map shows, across × up. */
export const MAP_AXES = 'Speed × Brightness';

/** "9,791 presets", or "250 of 9,791 presets" while the index hasn't drawn them all. */
export function mapCount(drawn: number, total: number): string {
  const n = drawn.toLocaleString('en-US');
  return drawn >= total ? `${n} ${drawn === 1 ? 'preset' : 'presets'}` : `${n} of ${total.toLocaleString('en-US')} presets`;
}

/**
 * **Job.** The library map: the inspector region's bottom section, a plain part of the same
 * panel under the preset's details. Its heading says what it is ("Library map", how many presets
 * it draws and its axes, "Speed × Brightness"), then the Field under it at the region's width
 * (its 4:3). It shows the whole library always, the preset playing lit with its ring, whatever
 * the details above it are about (the preset playing, a tile picked, several, a playlist, or
 * nothing). A dot played is the Field's `onPick`. With nothing playing, a line under the heading
 * says what the dots are and that a click plays one.
 *
 * **Changed.** New: the field was a section inside the inspector's details, in the order of the
 * preset's facts, and gave its place to the pictures of several picked or to a playlist's card;
 * it is now its own section, pinned under them, and never gives way. It paints nothing: the
 * panel's surface is behind it, and a hairline in the ink (the Field's own markings' hairline)
 * parts it from the details.
 *
 * **Kept.** The Field, its words to a screen reader ("The library by speed and brightness"), and
 * the empty state's words, moved here from the inspector's.
 *
 * **Tuning knobs**
 * - `--vs-map-hair`: the hairline over the section.
 */
export function LibraryMap({ library, mine, playing, onPick }: LibraryMapProps) {
  const c = useMemo(() => (playing ? characterOf(playing) : null), [playing]);
  const drawn = useMemo(() => library.reduce((n, r) => (r.look ? n + 1 : n), 0), [library]);
  return (
    <Group
      name="Library map"
      direction="column"
      gap={0}
      className="vs-map"
      aside={
        <Text role="caption" tabular className="vs-map-aside">
          {mapCount(drawn, library.length)} · {MAP_AXES}
        </Text>
      }
    >
      {!playing && (
        <Text as="p" role="caption" className="vs-map-help">
          Each dot is a preset, by how fast it moves and how bright it is. Click one to play it.
        </Text>
      )}
      <Field
        library={library}
        mine={mine}
        playing={playing?.row.key ?? null}
        intensity={c?.intensity.at ?? null}
        hue={c?.hues[0]?.css ?? 'var(--text-1)'}
        description={fieldSays(c, drawn, library.length)}
        onPick={onPick}
      />
    </Group>
  );
}
