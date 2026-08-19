import type { AppliedEffect, EffectKind, Layer, Show } from '../protocol.ts';
import type { SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { compile, type Rule, type Scheme, type SchemeSource } from './scheme.ts';

/**
 * Resolving a Live set into a show, through a cascade.
 *
 * Four levels, each owning what it is actually in a position to know, and each
 * more specific than the last:
 *
 * | level | owns | because |
 * |---|---|---|
 * | **song** | the colours | a song has an identity that outlives any one section of it |
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
 * Scalars — `source`, `blend`, `floor` — are **overridden**, most specific
 * winning, which is what "a clip is an exception" has to mean.
 *
 * `effects` are **added**, and that is the difference between this and a lookup
 * table. "The chorus should mix in more frenetic effects" is additive by
 * construction: the archetype contributes the section's character, the track
 * contributes what that instrument always does, and both survive. `maxEffects`
 * caps the pile, and energy decides how many of them actually reach the picture.
 *
 * `energyBias` **accumulates**, which is what makes energy per layer rather than
 * per show. A drum track can run hotter than the pad under it in the same
 * chorus — the thing a single global number cannot say.
 */

/** Hex, `#rrggbb` or `#rgb`, to the packed integer the renderer wants. */
function packColor(text: string): number {
  const clean = text.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/./g, '$&$&') : clean;
  const value = Number.parseInt(full, 16);
  return Number.isFinite(value) ? value & 0xffffff : 0xffffff;
}

/** Live's own `[ROLE]` prefix, which is the convention the set is named with. */
function roleOf(name: string): string | null {
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
 * How many of the offered effects actually land, and how hard.
 *
 * The first fades in across the bottom half of the energy range and the second
 * across the top, so a section never acquires two effects at once — it grows
 * into them. Below a tenth an effect is dropped rather than drawn, because a
 * pass that changes nothing visible still costs a full-screen draw.
 */
function dialEffects(kinds: EffectKind[], energy: number, max: number): AppliedEffect[] {
  const applied: AppliedEffect[] = [];
  for (let i = 0; i < Math.min(kinds.length, max); i++) {
    const opensAt = i * 0.45;
    const amount = clamp01((energy - opensAt) / 0.45);
    if (amount > 0.1) applied.push({ kind: kinds[i], amount });
  }
  return applied;
}

export function buildShow(set: SetState, link: LinkFrame, source: SchemeSource): Show {
  const scheme: Scheme = source.current();
  const strips = new Map((set.mixer?.tracks ?? []).map((strip) => [strip.t, strip]));
  const trackRules = compile(scheme.tracks);
  const clipRules = compile(scheme.clips);

  // Group tracks are not layers: they carry no clips of their own, and drawing
  // one would double every layer inside it.
  const tracks = set.tracks.filter((track) => !track.isGroup);

  const scene = set.play.find((p) => p && p.playing >= 0)?.playing ?? -1;
  const songKey = scene >= 0 ? (set.model?.songByScene[String(scene)] ?? null) : null;
  const role = scene >= 0 ? roleOf(set.scenes[scene]?.name ?? '') : null;

  const archetypeName = role && scheme.archetypes[role] ? role : null;
  const archetype = archetypeName ? scheme.archetypes[archetypeName] : null;
  const baseEnergy = archetype?.energy ?? scheme.defaults.energy;

  // A song with no assignment still gets colours: an unstyled song would be a
  // black screen for the one thing nobody remembered to configure.
  const named = songKey ? scheme.songs[songKey] : undefined;
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

    let kind = scheme.defaults.sources[depth % scheme.defaults.sources.length];
    let blend = scheme.defaults.blend[depth % scheme.defaults.blend.length];
    // Derived so the bottom layer is always in and a tall stack's top needs a
    // fairly loud section to appear. A rule may say otherwise.
    let floor = tracks.length > 1 ? (depth / (tracks.length - 1)) * 0.45 : 0;
    let energy = baseEnergy;
    const kinds: EffectKind[] = [...(archetype?.effects ?? [])];

    const apply = (rule: Rule) => {
      if (rule.source) kind = rule.source;
      if (rule.blend) blend = rule.blend;
      if (rule.floor !== undefined) floor = rule.floor;
      if (rule.energyBias) energy += rule.energyBias;
      for (const effect of rule.effects ?? []) if (!kinds.includes(effect)) kinds.push(effect);
    };

    for (const { test, rule } of trackRules) {
      if (test.test(track.name)) {
        apply(rule);
        break;
      }
    }
    if (clip) {
      for (const { test, rule } of clipRules) {
        if (test.test(clip.name)) {
          apply(rule);
          break;
        }
      }
    }

    energy = clamp01(energy);

    // Energy thinning the stack, as a fade rather than a cut: a layer just under
    // its floor is dim, not absent, so a quiet section reads as the picture
    // closing down rather than as something having failed.
    //
    // **Tested against the section's energy, not the layer's.** They are
    // different questions and conflating them was a real bug: a pad track with
    // `energyBias: -0.15` is asking to be *calmer*, and the biased value made it
    // *absent* for the whole verse instead. Presence belongs to the section —
    // "the chorus brings everything in" is a fact about the chorus — while the
    // bias only ever describes how frenetic a layer is once it is there.
    const admitted = floor <= 0 ? 1 : clamp01((baseEnergy - floor) / 0.2 + 1);
    const fader = strip && !strip.active ? 0 : positionOf(strip?.volume);

    return {
      t: track.i,
      name: track.name,
      // By depth out of the song's colourway, so the stack reads as one scheme.
      // Never from the clip — that colour is navigation and belongs to whoever
      // is reading the grid to find their place.
      color: packColor(colors[depth % colors.length]),
      source: kind,
      effects: dialEffects(kinds, energy, scheme.defaults.maxEffects),
      blend,
      opacity: fader * admitted,
      level: set.levels.get(track.i) ?? 0,
      energy,
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
  };
}
