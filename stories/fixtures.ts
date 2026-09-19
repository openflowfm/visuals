import { MOODS, type Mood, type Scheme, type Show } from '../protocol.ts';
import { palettes, seeded } from '../randomize.ts';
import { RESTING } from '../client/state/useShow.ts';
import type { Clock } from '../client/state/useShow.ts';

/**
 * What the stories run on: a show in a few states, a scheme with a library of
 * colourways in it, and a clock that ticks without Link.
 *
 * Dealt from fixed seeds so a story looks the same every time it opens — a
 * fixture that changed under a screenshot would make every diff a lie.
 */

export const NAMES = ['dawn', 'neon', 'ember', 'tide'] as const;

export const MOOD_OF: Record<string, Mood> = { neon: 'neon', ember: 'sunset', tide: 'ice' };

/** A scheme with nothing in it but a library, which is all the colourway editor reads. */
export const SCHEME: Scheme = {
  flows: {},
  colorways: palettes(seeded('storybook'), NAMES, MOOD_OF),
  moods: MOOD_OF,
  rotation: { flows: [], colorways: [], bars: 8, onClip: false, colorEvery: 1 },
  songs: {},
  seed: 'storybook',
  defaults: { colorway: 'dawn', flow: '', pace: 0, draws: 'fill' },
};

/** The show at rest, and the show with every link in the chain up. */
export const SHOW = {
  resting: RESTING,
  serverOnly: { ...RESTING },
  connected: { ...RESTING, connected: true },
  live: {
    ...RESTING,
    connected: true,
    lomReady: true,
    playing: true,
    peers: 2,
    clock: true,
    tempo: 124,
    flow: 'ripple',
    colorway: 'dawn',
    song: 'After the rain',
  },
} satisfies Record<string, Show>;

/**
 * A clock off the wall, at a tempo, with an optional kink.
 *
 * `every` seconds the beat jumps by `by`, which is what a Link correction looks
 * like from the browser's side and the thing the Beat harness exists to show.
 */
export function wallClock(bpm: number, kink?: { every: number; by: number }): Clock {
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  return {
    seconds,
    beat: () => {
      const s = seconds();
      const jumps = kink ? Math.floor(s / kink.every) * kink.by : 0;
      return (s * bpm) / 60 + jumps;
    },
    advance: () => {},
  };
}

export { MOODS };
