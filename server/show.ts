import type { Scheme, Show, Track } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { atOne, bumped, reOne, turnsAt, whatIsUp, type Wheel } from '../resolve.ts';
import type { SchemeSource } from './scheme.ts';

/**
 * A Live set into a show.
 *
 * This used to be a cascade: four levels, resolved per track, sixty times a
 * minute. It is two questions now — **which look is up**, and **what are the
 * tracks doing** — because everything the cascade decided is decided in a graph
 * instead.
 *
 * What is left here is what only a *running* set can supply: the mixer, the
 * meters, the scene, and the two events the rotation turns on.
 */

/** Hex, `#rrggbb` or `#rgb`, to the packed integer the renderer wants. */
function packColor(text: string): number {
  const clean = text.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/./g, '$&$&') : clean;
  const value = Number.parseInt(full, 16);
  return Number.isFinite(value) ? value & 0xffffff : 0xffffff;
}

/**
 * Live's own `[ROLE]` prefix, which is the convention the set is named with.
 *
 * Exported for `grid.ts`, which asks the same question of every scene rather
 * than of the playing one. Two readings of a scene name is exactly the drift
 * `SetModel` exists to prevent.
 */
export function roleOf(name: string): string | null {
  const match = /^\s*\[([^\]]+)\]/.exec(name);
  return match ? match[1].trim().toUpperCase() : null;
}

/** Semitones above C, for the seven letters a key can be named with. */
const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A key label into a pitch class, 0–1. Null when the label states no key.
 *
 * The bridge hands keys over as **names** — `Bm`, `F#m`, `Db` — because that is
 * what the set is written with, and a song whose scenes disagree renders as the
 * collection `Bm / D`. So this takes the first key stated: a song that modulates
 * is in the first one when it starts, and there is no honest way to average two
 * tonics.
 *
 * **The mode is deliberately dropped.** A minor key is not a *position* between
 * two other keys, and a 0–1 number is a position — squeezing a boolean into the
 * continuum would put `Cm` between `C` and `C#` and make a look wired key → hue
 * jump a semitone when a song went minor. Chromatic rather than the circle of
 * fifths for the same reason: adjacent numbers should be adjacent pitches, so
 * the picture moves by a semitone when the music does.
 */
function pitchOf(label: string | null | undefined): number | null {
  const first = (label ?? '').split('/')[0].trim();
  const match = /^([A-G])([#b]?)/.exec(first);
  if (!match) return null;
  const shift = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return ((((PITCH[match[1]] + shift) % 12) + 12) % 12) / 12;
}

function positionOf(p: BSV.MixerParameterState | null | undefined): number {
  if (!p) return 1;
  const span = p.max - p.min;
  if (Math.abs(span) < 1e-9) return 1;
  return Math.max(0, Math.min(1, (p.value - p.min) / span));
}

/**
 * What the rotation has to remember between frames.
 *
 * A wheel that turns on *events* needs somewhere to count them, and a show built
 * from scratch every second has nowhere. Three fields, and all three are about
 * noticing that something changed rather than about what it changed to.
 *
 * Held by the server and handed in, rather than a module-level variable, because
 * a module-level one is a second place the truth lives and the tests would have
 * to reach into it to reset.
 */
export interface Turning {
  /** Per track, the scene index that was playing when we last looked. */
  was: number[];
  /** Where the phrase starts, and what has turned by hand. See `resolve.ts`. */
  wheel: Wheel;
  /** Whether Live's transport was running when we last looked. */
  rolling: boolean;
}

export const noTurning = (): Turning => ({ was: [], wheel: atOne(), rolling: false });

/**
 * The scene most of the set is playing, and whether anyone has departed from it.
 *
 * A **scene** launch moves every track at once; a **clip** launch moves one. So
 * the dominant playing index is the scene, and a track that has moved to some
 * other index on its own is somebody reaching past the grid — which is already
 * the "and now something else" gesture of a live set, and the only one the rig
 * can hear without being told.
 *
 * A scene change is deliberately not a trigger. Scenes fire constantly and a
 * picture that changed with every one of them would never settle into anything.
 */
function readPlaying(set: SetState, turning: Turning): { scene: number; bumped: boolean } {
  const counts = new Map<number, number>();
  const now: number[] = [];
  for (const track of set.tracks) {
    const playing = set.play[track.i]?.playing ?? -1;
    now[track.i] = playing;
    if (playing >= 0) counts.set(playing, (counts.get(playing) ?? 0) + 1);
  }
  let scene = -1;
  let most = 0;
  for (const [at, count] of counts) {
    if (count > most) {
      most = count;
      scene = at;
    }
  }

  // Something moved, and it did not move with everything else. A first read has
  // nothing to compare against and must not count as a change, or the wheel
  // would advance every time a browser connected.
  let bumped = false;
  if (turning.was.length > 0) {
    for (let t = 0; t < now.length; t++) {
      const before = turning.was[t] ?? -1;
      const after = now[t] ?? -1;
      if (before === after) continue;
      if (after >= 0 && after !== scene) bumped = true;
    }
  }
  turning.was = now;
  return { scene, bumped };
}

export function buildShow(
  set: SetState,
  link: LinkFrame,
  source: SchemeSource,
  turning: Turning = noTurning(),
): Show {
  const scheme: Scheme = source.current();
  const strips = new Map((set.mixer?.tracks ?? []).map((strip) => [strip.t, strip]));

  // Group tracks carry no clips of their own, so drawing one would double
  // everything inside it.
  const tracks = set.tracks.filter((track) => !track.isGroup);

  const { scene, bumped: departed } = readPlaying(set, turning);
  if (departed && scheme.rotation.onClip) turning.wheel = bumped(turning.wheel);

  // **Live starting is the one.** A transport that has just been rolled is the
  // clearest statement of where a phrase begins that this rig will ever get,
  // and it costs nobody a gesture — so the wheel re-phases itself on every
  // start and the shortcut is for the times a set never stops.
  //
  // Nothing turns; see `reOne`. And a first read counts, because until then the
  // phrase was being counted from whenever the first Link peer in the building
  // opened its laptop, which is not a worse guess to replace.
  if (set.playing && !turning.rolling) {
    turning.wheel = reOne(scheme.rotation, link.beat, link.quantum, turning.wheel);
  }
  turning.rolling = set.playing;

  const songKey = scene >= 0 ? (set.model?.songByScene[String(scene)] ?? null) : null;
  const role = scene >= 0 ? roleOf(set.scenes[scene]?.name ?? '') : null;

  // The playing scene's own key before the song's, because a scene states one
  // exactly when it disagrees with the song — which is where a song modulates,
  // and the only moment the distinction is worth anything.
  const stated =
    (scene >= 0 ? set.model?.factsByScene?.[String(scene)]?.key : null) ??
    set.model?.songs?.find((entry) => entry.songKey === songKey)?.key;

  const turns = turnsAt(scheme.rotation, link.beat, link.quantum, turning.wheel);
  const up = whatIsUp(scheme, songKey, turns);

  // A colourway nobody assigned still has colours: an unstyled song would be a
  // black screen for the one thing nobody remembered to configure.
  const hex = (up.colorway ? scheme.colorways[up.colorway] : null) ?? ['#ffffff'];
  const colors = hex.map(packColor);

  const drawn: Track[] = tracks.map((track, depth): Track => {
    const play = set.play[track.i];
    const playing = play?.playing ?? -1;
    const clip = playing >= 0 ? set.clips.get(`${track.i}:${playing}`) : undefined;
    const strip = strips.get(track.i);
    return {
      t: track.i,
      name: track.name,
      // By position in the set out of the colourway, so the picture reads as one
      // scheme. Never from the clip — that colour is navigation, and belongs to
      // whoever is reading the grid to find their place.
      color: colors[depth % colors.length],
      opacity: strip && !strip.active ? 0 : positionOf(strip?.volume),
      level: set.levels.get(track.i) ?? 0,
      playing,
      clipName: clip?.name ?? '',
    };
  });

  return {
    connected: set.connected,
    lomReady: set.lomReady,
    // Live's transport, deliberately, not Link's — a peer joining a session
    // that is already playing is never told so. See `link.ts`.
    playing: set.playing,
    peers: link.peers,
    clock: true,
    // Link's tempo is the shared one and the bridge's is Live's own. They agree
    // whenever Live has Link on; when it doesn't, Link is still the clock the
    // beat below was measured against, so taking Live's here would put the
    // tempo and the beat into different time.
    tempo: link.tempo,
    quantum: link.quantum,
    beat: link.beat,
    at: link.at,
    master: set.masterLevel,
    tracks: drawn,
    look: up.look,
    pinned: up.pinned,
    colorway: up.colorway,
    colors,
    song: songKey,
    key: pitchOf(stated),
    role,
    one: turning.wheel.one,
    schemeError: source.error(),
    // What the set actually contains, so the editor can offer it rather than
    // asking anyone to type it.
    roles: [
      ...new Set(set.scenes.map((s) => roleOf(s.name)).filter((r): r is string => !!r)),
    ].sort(),
    songs: [...new Set(Object.values(set.model?.songByScene ?? {}))].sort(),
  };
}
