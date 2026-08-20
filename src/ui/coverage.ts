import type { GridRow, Scheme, SetGrid } from '../../protocol.ts';

/**
 * Who answered for one cell of the coverage matrix.
 *
 * The four states are the cascade seen from the outside. A show is configured
 * by saying things at the right level, and the failure this view exists to
 * catch is not a wrong answer but a *missing* one — a track nobody ever decided
 * about, drawing whatever its name suggested, on the one song where that reads
 * wrong. So the interesting colour is the pale one.
 */
export type Answer =
  /** A clip in this row carries an exception. The most specific thing there is. */
  | 'said'
  /** The track is bound, and this row inherits it along with every other. */
  | 'inherited'
  /** Nothing is bound. The name hint and the defaults are drawing it. */
  | 'backstop'
  /** The row never uses this track, so there is nothing here to decide. */
  | 'absent';

/** The order specificity runs in, so aggregating a group can take the strongest. */
const RANK: Record<Answer, number> = { said: 3, inherited: 2, backstop: 1, absent: 0 };

export interface Cell {
  answer: Answer;
  /** Every clip name this row holds on the track. */
  clips: string[];
  /** Those of them that carry an exception — what `said` is said *by*. */
  exceptions: string[];
}

/** What one column stands for. A track is itself; a group is its members. */
export interface Column {
  key: string;
  label: string;
  tracks: { t: number; name: string }[];
}

export type Cut = 'tracks' | 'groups';

/**
 * Columns for either cut.
 *
 * The groups cut collapses on the parent group's *name* rather than its index,
 * because the name is what the label has to be and two group tracks never
 * usefully share one. A track outside every group stands as its own column
 * rather than being gathered into an "ungrouped" bucket — it is still a track,
 * and hiding it behind a bucket is how a forgotten layer stays forgotten.
 */
export function columnsOf(grid: SetGrid, cut: Cut): Column[] {
  if (cut === 'tracks') {
    return grid.tracks.map((track) => ({
      key: `t${track.t}`,
      label: track.name,
      tracks: [track],
    }));
  }
  const out: Column[] = [];
  const byGroup = new Map<string, Column>();
  for (const track of grid.tracks) {
    if (!track.group) {
      out.push({ key: `t${track.t}`, label: track.name, tracks: [track] });
      continue;
    }
    const held = byGroup.get(track.group);
    if (held) {
      held.tracks.push(track);
      continue;
    }
    const column: Column = { key: `g:${track.group}`, label: track.group, tracks: [track] };
    byGroup.set(track.group, column);
    out.push(column);
  }
  return out;
}

/** One track, in one row. */
export function cellFor(scheme: Scheme, row: GridRow, track: { t: number; name: string }): Cell {
  const clips = row.clips[track.t] ?? [];
  if (clips.length === 0) return { answer: 'absent', clips, exceptions: [] };
  const exceptions = clips.filter((name) => scheme.clips[name]);
  if (exceptions.length > 0) return { answer: 'said', clips, exceptions };
  if (scheme.layers[track.name]) return { answer: 'inherited', clips, exceptions };
  return { answer: 'backstop', clips, exceptions };
}

/**
 * A column, in one row — the same answer when the column is one track.
 *
 * A group takes the **strongest** answer any member gave, not the weakest. A
 * group reading `backstop` while one track inside it carries a clip exception
 * would be a lie in the direction that matters: it would send you looking for
 * work that is already done.
 */
export function cellForColumn(scheme: Scheme, row: GridRow, column: Column): Cell {
  let best: Cell = { answer: 'absent', clips: [], exceptions: [] };
  for (const track of column.tracks) {
    const cell = cellFor(scheme, row, track);
    if (RANK[cell.answer] > RANK[best.answer]) best = cell;
    else if (cell.answer === best.answer) {
      best = {
        answer: best.answer,
        clips: [...best.clips, ...cell.clips],
        exceptions: [...best.exceptions, ...cell.exceptions],
      };
    }
  }
  return best;
}

export type Filter = 'all' | 'gaps' | 'bound';

/** Whether a cell survives the toolbar's filter. */
export function passes(cell: Cell, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (cell.answer === 'absent') return false;
  return filter === 'gaps' ? cell.answer === 'backstop' : cell.answer !== 'backstop';
}

/**
 * Everywhere one effect is used, counted the way the inspector says it.
 *
 * "Also uses soft-bloom: 5 other layers, 4 songs" is the sentence that stops a
 * look being edited as if it were local. An effect reached by six layers is a
 * shared thing, and changing it changes all six — which you want to know before
 * you turn the knob, not after.
 */
export function usesOf(
  scheme: Scheme,
  grid: SetGrid | null,
  id: string,
): { layers: string[]; songs: string[]; sections: string[] } {
  const layers = Object.entries(scheme.layers)
    .filter(([, spec]) => spec.looks?.includes(id))
    .map(([name]) => name);
  const sections = Object.entries(scheme.archetypes)
    .filter(([, arch]) => arch.looks?.includes(id))
    .map(([name]) => name);
  const clipNames = new Set(
    Object.entries(scheme.clips)
      .filter(([, spec]) => spec.looks?.includes(id))
      .map(([name]) => name),
  );
  // A song counts when a layer it uses carries the effect, or when one of its
  // own clips names it — the two ways an effect reaches a song at all.
  const songs = (grid?.songs ?? [])
    .filter((row) =>
      grid!.tracks.some((track) => {
        const clips = row.clips[track.t];
        if (!clips) return false;
        return layers.includes(track.name) || clips.some((name) => clipNames.has(name));
      }),
    )
    .map((row) => row.name);
  return { layers, songs, sections };
}
