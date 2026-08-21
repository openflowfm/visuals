import type { SetGrid } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import { roleOf } from './show.ts';

/**
 * The set's shape: its tracks, and its songs in running order.
 *
 * Far smaller than it was. It used to carry every distinct clip name on every
 * track of every song *and* of every section, because a coverage matrix asked a
 * question at that resolution — which for a real set is tens of kilobytes, sent
 * whenever anyone recorded a clip.
 *
 * Nothing asks that question any more. What a track draws is wired rather than
 * bound, so there is no per-track-per-song cell to be missing, and the only
 * thing a song can say is which colourway and which looks. Both are facts about
 * a song, so the songs are all this needs to carry.
 *
 * **Nothing here reads the scheme**, which is what keeps it rare on the wire:
 * it changes when the set does, not when an edit does.
 */
export function buildGrid(set: SetState): SetGrid {
  // A group track carries no clips of its own, so it comes back as a *grouping*
  // rather than as a track of its own.
  const tracks = set.tracks.filter((track) => !track.isGroup);
  const byIndex = new Map(set.tracks.map((track) => [track.i, track]));

  const rolesOver = (scenes: number[]): string[] => [
    ...new Set(
      scenes.map((s) => roleOf(set.scenes[s]?.name ?? '')).filter((r): r is string => !!r),
    ),
  ];

  return {
    tracks: tracks.map((track) => ({
      t: track.i,
      name: track.name,
      group: track.groupIndex >= 0 ? (byIndex.get(track.groupIndex)?.name ?? null) : null,
    })),
    songs: (set.model?.songs ?? []).map((song) => ({
      name: song.name,
      key: song.songKey,
      bpm: song.bpm,
      tonality: song.key,
      roles: rolesOver(song.scenes),
    })),
  };
}
