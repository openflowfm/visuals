import type { AppliedLook, Layer, Scheme, Show } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { liveOffers, resolveLayer } from '../resolve.ts';
import type { SchemeSource } from './scheme.ts';

/**
 * Resolving a Live set into a show, through a cascade.
 *
 * Four levels, each owning what it is actually in a position to know, and each
 * more specific than the last:
 *
 * | level | owns | because |
 * |---|---|---|
 * | **song** | the colours, and how hard it plays | a song has an identity that outlives any one section of it |
 * | **archetype** | energy and character | a section is a feeling, and the same chorus should differ between two songs |
 * | **track** | what a layer does with content | a track is an instrument; its layer should stay recognisable across a whole song |
 * | **clip** | the exception | the most specific thing there is, and the only level that can say "not this time" |
 *
 * **Live signals are not a level.** The meter, the beat, the phase and the
 * tempo thread through everything as uniforms rather than being resolved at one
 * step, because they are not a description of what the picture should be — they
 * are what makes it move once it has been decided. Anything can be modulated by
 * them, and nothing in the cascade has to know they exist.
 *
 * ## What the levels do to each other
 *
 * Scalars — `source`, `blend`, `floor`, `bias`, `hide` — are **overridden**,
 * most specific winning, field by field. That is what "a clip is an exception"
 * has to mean, and it is also why binding one field of a track leaves the rest
 * to the name hint: an entry saying `{ bias: 0.2 }` on a drum track is asking
 * for one change, not for everything else to be forgotten.
 *
 * `effects` are **added**, and that is the difference between this and a lookup
 * table. "The chorus should mix in more frenetic effects" is additive by
 * construction: the archetype contributes the section's character, the track
 * contributes what that instrument always does, and both survive. `maxEffects`
 * caps the pile, and energy decides how many of them actually reach the picture.
 *
 * `bias` **accumulates** down the levels, which is what makes energy per layer
 * rather than per show. A drum track can run hotter than the pad under it in the
 * same chorus — the thing a single global number cannot say.
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

function positionOf(p: BSV.MixerParameterState | null | undefined): number {
  if (!p) return 1;
  const span = p.max - p.min;
  if (Math.abs(span) < 1e-9) return 1;
  return Math.max(0, Math.min(1, (p.value - p.min) / span));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * How much of the offered stack actually lands, and how hard.
 *
 * The base is always in. Above it, the first transformer fades in across the
 * bottom half of the energy range and the second across the top, so a section
 * never acquires two at once — it grows into them. Below a tenth a pass is
 * dropped rather than drawn, because one that changes nothing visible still
 * costs a full-screen draw.
 */
function dialStack(ids: string[], energy: number, max: number): AppliedLook[] {
  if (ids.length === 0) return [];
  // The base always draws at full. It is what the layer *is*, and a section
  // being quiet should thin the stack rather than fade the thing underneath it
  // — that is what the floor gate is for, and doing both would dim twice.
  const applied: AppliedLook[] = [{ id: ids[0], amount: 1 }];
  for (let i = 1; i < Math.min(ids.length, max); i++) {
    const opensAt = (i - 1) * 0.45;
    const amount = clamp01((energy - opensAt) / 0.45);
    if (amount > 0.1) applied.push({ id: ids[i], amount });
  }
  return applied;
}

export function buildShow(set: SetState, link: LinkFrame, source: SchemeSource): Show {
  const scheme: Scheme = source.current();
  const strips = new Map((set.mixer?.tracks ?? []).map((strip) => [strip.t, strip]));

  // Group tracks are not layers: they carry no clips of their own, and drawing
  // one would double every layer inside it.
  const tracks = set.tracks.filter((track) => !track.isGroup);

  const scene = set.play.find((p) => p && p.playing >= 0)?.playing ?? -1;
  const songKey = scene >= 0 ? (set.model?.songByScene[String(scene)] ?? null) : null;
  const role = scene >= 0 ? roleOf(set.scenes[scene]?.name ?? '') : null;

  const archetypeName = role && scheme.archetypes[role] ? role : null;
  const archetype = archetypeName ? scheme.archetypes[archetypeName] : null;
  const song = songKey ? scheme.songs[songKey] : undefined;

  // The song's bias is part of the *section's* energy rather than of any one
  // layer's, so a song that plays hard brings the whole picture up with it —
  // including the floor gate, which is what decides how much of the stack is in.
  const baseEnergy = clamp01((archetype?.energy ?? scheme.defaults.energy) + (song?.bias ?? 0));

  // A song with no assignment still gets colours: an unstyled song would be a
  // black screen for the one thing nobody remembered to configure.
  const named = song?.colorway;
  const colorwayName =
    (named && scheme.colorways[named] ? named : undefined) ??
    (scheme.colorways[scheme.defaults.colorway] ? scheme.defaults.colorway : undefined) ??
    Object.keys(scheme.colorways)[0] ??
    null;
  const colors = (colorwayName ? scheme.colorways[colorwayName] : null) ?? ['#ffffff'];

  const layers: Layer[] = tracks.map((track, depth): Layer => {
    const play = set.play[track.i];
    const playing = play?.playing ?? -1;
    const clip = playing >= 0 ? set.clips.get(`${track.i}:${playing}`) : undefined;
    const strip = strips.get(track.i);

    // The cascade itself lives in `resolve.ts`, shared with the editor. What is
    // left here is what only a *running* set can supply: the mixer, the meter,
    // and the energy gate — the parts of a layer that are facts about now
    // rather than decisions about the show.
    const r = resolveLayer(scheme, {
      name: track.name,
      depth,
      count: tracks.length,
      section: archetype?.looks,
      clip: clip?.name ?? null,
    });

    const energy = clamp01(baseEnergy + r.bias);

    // Energy thinning the stack, as a fade rather than a cut: a layer just under
    // its floor is dim, not absent, so a quiet section reads as the picture
    // closing down rather than as something having failed.
    //
    // **Tested against the section's energy, not the layer's.** They are
    // different questions and conflating them was a real bug: a pad track with
    // `bias: -0.15` is asking to be *calmer*, and the biased value made it
    // *absent* for the whole verse instead. Presence belongs to the section —
    // "the chorus brings everything in" is a fact about the chorus — while the
    // bias only ever describes how frenetic a layer is once it is there.
    const admitted = r.floor <= 0 ? 1 : clamp01((baseEnergy - r.floor) / 0.2 + 1);
    const fader = strip && !strip.active ? 0 : positionOf(strip?.volume);

    const live = liveOffers(scheme, r.offers);

    return {
      t: track.i,
      name: track.name,
      // By depth out of the song's colourway, so the stack reads as one scheme.
      // Never from the clip — that colour is navigation and belongs to whoever
      // is reading the grid to find their place.
      color: packColor(colors[depth % colors.length]),
      looks: r.hidden ? [] : dialStack(live, energy, scheme.defaults.maxLooks),
      offers: live,
      blend: r.blend,
      floor: r.floor,
      opacity: r.hidden ? 0 : fader * admitted,
      level: set.levels.get(track.i) ?? 0,
      energy,
      hidden: r.hidden,
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
    layers,
    song: songKey,
    role,
    archetype: archetypeName,
    colorway: colorwayName,
    energy: baseEnergy,
    schemeError: source.error(),
    // What the set actually contains, so the editor can offer it rather than
    // asking anyone to type it. Track names arrive on the layers themselves,
    // which is also where their resolved answer is.
    roles: [
      ...new Set(set.scenes.map((s) => roleOf(s.name)).filter((r): r is string => !!r)),
    ].sort(),
    songs: [...new Set(Object.values(set.model?.songByScene ?? {}))].sort(),
  };
}
