import type { FlowDef, LabRoom, Scheme, Show } from '../../protocol.ts';
import { packColor } from '../state/useRoom.ts';
import { RESTING } from '../state/useShow.ts';

/**
 * Staging a frozen candidate: the pieces the train view and the review tab
 * share, because both put a judged graph on the bench under a stored room and
 * two stagings that could disagree would make the review tab a liar about
 * what the train view saw.
 */

/** The id a parked candidate is drawn under. A tilde so it is never a person's. */
export const CANDIDATE_FLOW = '~candidate';

/** The renderer's packed colour back to the `#rrggbb` a `LabRoom` stores. */
export const hexOf = (packed: number): string =>
  `#${(packed & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * The set as a room, sampled at one moment — what a live judgment freezes.
 *
 * Everything by value, the way a dealt room already rides the submission: the
 * challenge this lands in must stay legible years after tonight's set is gone.
 * `seed: 'live'` where a dealt room carries its seed, which is honest — this
 * room cannot be re-dealt, only re-staged from the values stored here.
 */
export const heardRoom = (heard: Show): LabRoom => ({
  tempo: Math.round(heard.tempo * 10) / 10,
  quantum: heard.quantum,
  energy: Math.round(heard.master * 100) / 100,
  section: heard.role ?? '',
  sections: [...heard.roles],
  key: heard.key === null ? null : Math.round(heard.key * 12) % 12,
  colors: heard.colors.map(hexOf),
  seed: 'live',
});

/** A frozen candidate as a scheme of its own, for the bench to draw. */
export function parkedScheme(flow: FlowDef, bundle: Record<string, FlowDef>): Scheme {
  return {
    flows: { ...bundle, [CANDIDATE_FLOW]: flow },
    colorways: {},
    rotation: { flows: [], colorways: [], bars: 0, onClip: false, colorEvery: 0 },
    songs: {},
    defaults: { colorway: '', flow: CANDIDATE_FLOW, pace: 0, draws: 'by name' },
  };
}

/** A room as a `Show`, which is all the renderer understands. */
export function stagedShow(room: LabRoom, songSeed: string): Show {
  const colors = (room.colors.length ? room.colors : ['#ffffff']).map(packColor);
  return {
    ...RESTING,
    playing: true,
    tempo: room.tempo,
    quantum: room.quantum,
    master: room.energy,
    colors,
    // Reviews pass a candidate id; comparisons pass one encounter id to both
    // sides. Either way a `song seed` node is reproducible without becoming a
    // hidden difference inside a controlled pair.
    song: songSeed,
    key: room.key === null ? null : room.key / 12,
    role: room.section,
    roles: [...room.sections],
  };
}
