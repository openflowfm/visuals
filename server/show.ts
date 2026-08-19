import type { Blend, EffectKind, Layer, Show, SourceKind } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';

/**
 * Turning a Live set into a show, with nothing to configure.
 *
 * This is `docs/direction.md`'s argument applied one module over: **the mapping
 * is derived, not declared.** The song mapping is read back out of scene names
 * rather than stored beside the set, and the same reasoning works here — a set
 * that has been named and coloured has already said what its sections are and
 * what its tracks play, and asking someone to say it a second time in a visuals
 * app would be asking them to keep two records in step.
 *
 * Point this at a set that has been through the session view and it has an
 * opinion immediately. Point it at an unnamed set and it still runs, on the
 * positional fallbacks below.
 *
 * ## What decides what, and why it is split this way
 *
 * | | comes from | because |
 * |---|---|---|
 * | source | the **track** | a track is an instrument, and its layer should stay recognisable across a whole song |
 * | effect | the **scene's role** | a section is a change of treatment, and it should be visible the moment the chorus lands |
 * | blend | the layer's **depth** | something has to be opaque at the bottom, and stacked light adds |
 * | colour | the **clip** | the set is already colour-coded; that work should not be done twice |
 * | opacity | the **track fader** | a layer stack with a level per layer *is* a mixer |
 *
 * The first row was the mistake worth recording. Keying the source off the role
 * looked right — the section is what changed, so let it pick the picture — but a
 * role belongs to the *scene*, which is a whole column of the grid, so every
 * layer in that column drew the identical thing on top of itself. Sections
 * change together; instruments differ from each other. They are perpendicular,
 * and the two axes of the grid are exactly that distinction.
 *
 * An explicit override — this cell draws *that* — is the obvious next thing and
 * deliberately isn't here. Derivation first is what keeps the override optional,
 * which is the difference between a tool and a chore.
 */

/**
 * Track name to source, because people name tracks after what plays on them.
 *
 * Matched loosely and on a first hit, so "Drum Bus", "drums 2" and "DRUMS" all
 * land together. An unmatched track falls through to its position, which is how
 * a set of tracks called "1" through "5" still gets five different layers.
 */
const BY_NAME: readonly (readonly [RegExp, SourceKind])[] = [
  [/\b(kick|drum|beat|perc|snare)/i, 'strobe'],
  [/\b(bass|sub|808)/i, 'bars'],
  [/\b(lead|solo|gtr|guitar|vox|vocal)/i, 'rings'],
  [/\b(pad|string|atmos|amb)/i, 'noise'],
  [/\b(key|synth|chord|piano|organ)/i, 'grid'],
];

const BY_POSITION: readonly SourceKind[] = ['bars', 'rings', 'grid', 'noise', 'strobe', 'solid'];

/**
 * Role to effect. The section changes the treatment of every layer at once,
 * which is what makes a chorus land as a chorus.
 *
 * Most sections get nothing on purpose: an effect distinguishes a moment only
 * while the moments around it are plain, so a table where every row is an
 * effect is a table that has stopped saying anything.
 *
 * And even in a section that has one, it lands on **alternate layers only**.
 * Kaleidoscoping all five at once was the first thing this did and it read as
 * a single texture — every source lost the identity the row above works to
 * give it. Half the stack changing is enough to say the chorus arrived while
 * the other half still says which instrument is which.
 */
const BY_ROLE: Record<string, EffectKind> = {
  INTRO: 'pixelate',
  VERSE: 'none',
  CHORUS: 'kaleido',
  JAM1: 'shift',
  JAM2: 'mirror',
  ENDING: 'pixelate',
  PRACTICE: 'none',
};

/**
 * Layers stack, so their blends have to differ or the top one simply wins.
 *
 * The bottom is `over` because something has to be opaque, and most of what is
 * above it adds — which is what a stack of light does, and where a VJ mixer
 * defaults too.
 */
const BY_DEPTH: readonly Blend[] = ['over', 'add', 'screen', 'add', 'multiply', 'add'];

/** Live's own `[ROLE]` prefix, which is the convention the set is named with. */
function roleOf(name: string): string | null {
  const match = /^\s*\[([^\]]+)\]/.exec(name);
  return match ? match[1].trim().toUpperCase() : null;
}

function sourceFor(name: string, depth: number): SourceKind {
  for (const [pattern, kind] of BY_NAME) if (pattern.test(name)) return kind;
  return BY_POSITION[depth % BY_POSITION.length];
}

/**
 * A parameter's 0–1 position, given Live's own range for it.
 *
 * `MixerDevice.volume` is already the fader's own 0–1 position rather than
 * decibels, so this is a normalisation against the reported range and not a
 * taper of its own. A missing parameter reads fully open: a layer that vanished
 * because the mixer had not arrived yet would look like a renderer bug.
 */
function positionOf(p: BSV.MixerParameterState | null | undefined): number {
  if (!p) return 1;
  const span = p.max - p.min;
  if (Math.abs(span) < 1e-9) return 1;
  return Math.max(0, Math.min(1, (p.value - p.min) / span));
}

export function buildShow(set: SetState, link: LinkFrame): Show {
  const strips = new Map((set.mixer?.tracks ?? []).map((strip) => [strip.t, strip]));

  // Group tracks are not layers: they carry no clips of their own, and drawing
  // one would double every layer inside it.
  const layers: Layer[] = set.tracks
    .filter((track) => !track.isGroup)
    .map((track, depth): Layer => {
      const play = set.play[track.i];
      const playing = play?.playing ?? -1;
      const clip = playing >= 0 ? set.clips.get(`${track.i}:${playing}`) : undefined;
      const scene = playing >= 0 ? set.scenes[playing] : undefined;
      const role = scene ? roleOf(scene.name) : null;
      const strip = strips.get(track.i);

      return {
        t: track.i,
        name: track.name,
        color: track.color,
        source: sourceFor(track.name, depth),
        effect: role && depth % 2 === 0 ? (BY_ROLE[role] ?? 'none') : 'none',
        blend: BY_DEPTH[depth % BY_DEPTH.length],
        // A muted track draws nothing, which is what its Track Activator means
        // for the sound and should mean here too.
        opacity: strip && !strip.active ? 0 : positionOf(strip?.volume),
        level: set.levels.get(track.i) ?? 0,
        playing,
        clipColor: clip?.color ?? track.color,
        clipName: clip?.name ?? '',
      };
    });

  const scene = set.play.find((p) => p && p.playing >= 0)?.playing ?? -1;
  const songKey = scene >= 0 ? (set.model?.songByScene[String(scene)] ?? null) : null;

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
    layers,
    song: songKey,
    role: scene >= 0 ? roleOf(set.scenes[scene]?.name ?? '') : null,
  };
}
