import type { GridRow, SetGrid } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import { roleOf } from './show.ts';

/**
 * The set's shape, as the coverage matrix reads it.
 *
 * `buildShow` answers "what is on screen now"; this answers "what is there to
 * decide about" — every song against every track, whether or not either is
 * playing. They are different questions, and it took building the second one to
 * see it: the show resolves one cell of this grid, the one the transport is
 * sitting in, and a rig configured only from that cell is a rig configured one
 * night at a time.
 *
 * **Nothing here reads the scheme.** Which cells are *answered* is the browser's
 * to work out and changes on every keystroke in the editor; which cells *exist*
 * is the set's, and changes when someone records a clip. Resolving both here
 * would put a full grid on the wire after every edit.
 */
export function buildGrid(set: SetState): SetGrid {
  // The same filter the show uses: a group track carries no clips of its own,
  // so a column for one would be empty everywhere and mean nothing. It comes
  // back as a *grouping* below rather than as a column.
  const tracks = set.tracks.filter((track) => !track.isGroup);
  const byIndex = new Map(set.tracks.map((track) => [track.i, track]));

  /** The distinct clip names a set of scenes holds, per track. */
  const clipsOver = (scenes: number[]): Record<number, string[]> => {
    const clips: Record<number, string[]> = {};
    for (const track of tracks) {
      const names = new Set<string>();
      for (const scene of scenes) {
        const clip = set.clips.get(`${track.i}:${scene}`);
        if (clip?.name) names.add(clip.name);
      }
      // Only when the row actually uses the track. An empty array and an absent
      // key read the same to anyone who wrote `?? []`, and "not here at all"
      // has to survive that.
      if (names.size > 0) clips[track.i] = [...names];
    }
    return clips;
  };

  const rolesOver = (scenes: number[]): string[] => [
    ...new Set(
      scenes.map((s) => roleOf(set.scenes[s]?.name ?? '')).filter((r): r is string => !!r),
    ),
  ];

  const songs: GridRow[] = (set.model?.songs ?? []).map((song) => ({
    name: song.name,
    key: song.songKey,
    bpm: song.bpm,
    tonality: song.key,
    roles: rolesOver(song.scenes),
    clips: clipsOver(song.scenes),
  }));

  // Every scene naming a role, gathered by role. A section row is the whole set
  // asked "what does a chorus use", which is the question that finds a track
  // configured for the verses and forgotten for the choruses.
  const byRole = new Map<string, number[]>();
  for (const scene of set.scenes) {
    const role = roleOf(scene.name);
    if (!role) continue;
    const held = byRole.get(role);
    if (held) held.push(scene.i);
    else byRole.set(role, [scene.i]);
  }

  const sections: GridRow[] = [...byRole.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, scenes]) => ({
      name: role,
      key: role,
      roles: [role],
      clips: clipsOver(scenes),
    }));

  return {
    tracks: tracks.map((track) => ({
      t: track.i,
      name: track.name,
      group: track.groupIndex >= 0 ? (byIndex.get(track.groupIndex)?.name ?? null) : null,
    })),
    songs,
    sections,
  };
}
